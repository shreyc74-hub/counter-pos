-- Dashboard counts sales on the date they happened. Safe to run again.
--
-- Before, admin_facts grouped everything by the date a day was *opened*, so a day left
-- open overnight (or for several days) showed all its sales on the opening date and the
-- later dates looked empty. Now sales, expenses and cash movements are picked by their
-- own date (India time), and days are the ones that were open at some point in the range.
-- Cash movements also carry their time. Nothing stored changes.

create or replace function public.admin_facts(p_outlet uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner(p_outlet);
  if p_to < p_from or p_to - p_from > 400 then perform public._fail('Pick a range of up to 400 days.', 'invalid'); end if;
  return jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'date', to_char(d.business_date, 'YYYY-MM-DD'), 'openedAt', d.opened_at, 'closedAt', d.closed_at,
        'openingFloatPaise', d.opening_float_paise, 'expectedCashPaise', d.expected_cash_paise,
        'countedCashPaise', d.counted_cash_paise, 'variancePaise', d.variance_paise,
        'closedBy', (select name from public.staff where id = d.closed_by),
        'leftovers', coalesce((select jsonb_agg(jsonb_build_array(variant_id, plates)) from public.leftovers where day_session_id = d.id), '[]'::jsonb))
        order by d.business_date)
      -- days that were open at some point in the range (opened before it and left open count too)
      from public.day_sessions d where d.outlet_id = p_outlet and d.business_date <= p_to
        and coalesce((d.closed_at at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) >= p_from), '[]'::jsonb),
    -- order: [id, epoch seconds, dayId, staff, channel, subtotal, discount, total, cash, upi, voided?, voidedBy, lines]
    -- line:  [refId, kind, qty, lineTotal, costTotal or null]
    'orders', coalesce((
      select jsonb_agg(jsonb_build_array(
        o.id, extract(epoch from o.client_created_at)::bigint, o.day_session_id, st.name, o.channel,
        o.subtotal_paise, o.discount_paise, o.total_paise,
        coalesce((select sum(amount_paise) from public.payments where order_id = o.id and method = 'cash'), 0),
        coalesce((select sum(amount_paise) from public.payments where order_id = o.id and method = 'upi'), 0),
        v.order_id is not null, (select name from public.staff where id = v.staff_id),
        (select jsonb_agg(jsonb_build_array(
                  l.ref_id, l.kind, l.qty, l.line_total_paise,
                  case when l.unit_cost_paise is null then null
                       else l.unit_cost_paise * l.qty
                            + coalesce((select sum(coalesce(m.cost_paise, 0)) from public.order_line_modifiers m where m.order_line_id = l.id), 0) * l.qty
                  end) order by l.line_no)
         from public.order_lines l where l.order_id = o.id))
        order by o.client_created_at)
      from public.orders o
      join public.staff st on st.id = o.staff_id
      left join public.order_voids v on v.order_id = o.id
      where o.outlet_id = p_outlet
        and (o.client_created_at at time zone 'Asia/Kolkata')::date between p_from and p_to), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_array(e.day_session_id, e.category, e.amount_paise, e.method, extract(epoch from e.created_at)::bigint)
                       order by e.created_at)
      from public.expenses e
      where e.outlet_id = p_outlet and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_array(m.day_session_id, m.direction, m.amount_paise, extract(epoch from m.created_at)::bigint) order by m.created_at)
      from public.cash_movements m
      where m.outlet_id = p_outlet and (m.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to), '[]'::jsonb),
    'stockOuts', coalesce((
      select jsonb_agg(jsonb_build_array(s.ref_id, extract(epoch from s.marked_out_at)::bigint) order by s.marked_out_at)
      from public.stock_outs s
      where s.outlet_id = p_outlet
        and (s.marked_out_at at time zone 'Asia/Kolkata')::date between p_from and p_to), '[]'::jsonb));
end $$;
