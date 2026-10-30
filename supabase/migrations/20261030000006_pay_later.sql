-- "Not paid" for dine in: a dine-in bill can be saved before the customer pays, and paid
-- later from Orders today. Safe to run again.
--
-- * pos_submit_order accepts payLater: true on dine-in bills, saved with no payments.
-- * _order_json says unpaid: true for bills with no payments yet.
-- * pos_settle_order adds the payments to such a bill (once; retrying is safe).
-- * pos_close_day refuses while any bill of the day is still not paid (and not voided).
-- Bills are still never changed: payments are added as new rows, like everything else.

create or replace function public._order_json(p_order uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id,
    'billNo', o.bill_no,
    'token', o.token,
    'deviceCode', d.code,
    'staffId', o.staff_id,
    'staffName', st.name,
    'daySessionId', o.day_session_id,
    'channel', o.channel,
    'service', o.service,
    -- a dine-in bill saved as "not paid" has no payments until it is settled
    'unpaid', not exists (select 1 from public.payments p where p.order_id = o.id),
    'externalOrderId', o.external_order_id,
    'note', o.note,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', l.id,
        'kind', l.kind,
        'refId', l.ref_id,
        'name', l.name,
        'qty', l.qty,
        'unitPricePaise', l.unit_price_paise,
        'unitCostPaise', null, -- costs stay on the server; the counter never needs them
        'modifiers', coalesce((
          select jsonb_agg(jsonb_build_object('modifierId', m.modifier_id, 'name', m.name, 'pricePaise', m.price_paise, 'costPaise', null))
          from public.order_line_modifiers m where m.order_line_id = l.id), '[]'::jsonb)
      ) order by l.line_no)
      from public.order_lines l where l.order_id = o.id), '[]'::jsonb),
    'subtotalPaise', o.subtotal_paise,
    'discount', case when o.discount_paise > 0 then jsonb_build_object(
      'amountPaise', o.discount_paise,
      'reason', o.discount_reason,
      'approvedBy', (select name from public.staff where id = o.discount_approved_by)) end,
    'totalPaise', o.total_paise,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('method', p.method, 'amountPaise', p.amount_paise, 'cashReceivedPaise', p.cash_received_paise)
                       order by p.method)
      from public.payments p where p.order_id = o.id), '[]'::jsonb),
    'createdAt', o.client_created_at,
    'menuVersion', o.menu_version,
    'voided', (select jsonb_build_object(
                 'reason', v.reason,
                 'by', (select name from public.staff where id = v.staff_id),
                 'approvedBy', (select name from public.staff where id = v.approved_by),
                 'at', v.created_at)
               from public.order_voids v where v.order_id = o.id)
  )
  from public.orders o
  join public.devices d on d.id = o.device_id
  join public.staff st on st.id = o.staff_id
  where o.id = p_order;
$$;

create or replace function public.pos_submit_order(p_session uuid, p_order jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  d public.day_sessions;
  oid uuid := (p_order->>'id')::uuid;
  existing public.orders;
  bill text := p_order->>'billNo';
  seq integer;
  line jsonb;
  m jsonb;
  pr public.price_history;
  mpr public.price_history;
  ref_ok boolean;
  mod_name text;
  qty integer;
  mods jsonb;
  mods_total integer;
  computed jsonb := '[]'::jsonb;
  c jsonb;
  ln integer := 0;
  lid uuid;
  subtotal integer := 0;
  disc integer := coalesce((p_order#>>'{discount,amountPaise}')::int, 0);
  disc_reason text := nullif(trim(coalesce(p_order#>>'{discount,reason}', '')), '');
  approval public.owner_approvals;
  approver uuid;
  limit_paise integer;
  total integer;
  pay jsonb;
  paid integer := 0;
  svc text := nullif(p_order->>'service', '');
  pay_later boolean := coalesce((p_order->>'payLater')::boolean, false);
begin
  ses := public._session(p_session);
  if oid is null then perform public._fail('Order id missing.', 'invalid'); end if;

  select * into existing from public.orders where id = oid;
  if found then
    if existing.outlet_id <> ses.outlet_id then perform public._fail('Order id already used.', 'conflict'); end if;
    return public._order_json(oid); -- a retry of a bill that already reached us
  end if;

  d := public._open_day(ses.outlet_id);
  if (p_order->>'daySessionId')::uuid is distinct from d.id then
    perform public._fail('This bill belongs to a day that is no longer open. Reload the app.', 'no_open_day');
  end if;

  -- bill number: "<device code>-<sequence>", owned by this device
  if bill is null or bill !~ ('^' || ses.device_code || '-[0-9]{1,9}$') then
    perform public._fail('Bill number does not belong to this device.', 'invalid');
  end if;
  seq := split_part(bill, '-', 2)::int;
  if exists (select 1 from public.orders where outlet_id = ses.outlet_id and bill_no = bill) then
    perform public._fail('Bill number already used. Reload the app.', 'conflict');
  end if;
  if coalesce(p_order->>'channel', '') not in ('counter', 'swiggy', 'zomato', 'phone') then
    perform public._fail('Unknown order type.', 'invalid');
  end if;
  if svc is not null and svc not in ('dine_in', 'takeaway') then
    perform public._fail('Unknown dine-in / takeaway choice.', 'invalid');
  end if;
  if coalesce((p_order->>'token')::int, 0) <= 0 then
    perform public._fail('Token missing.', 'invalid');
  end if;
  if jsonb_array_length(coalesce(p_order->'lines', '[]'::jsonb)) = 0 then
    perform public._fail('An order needs at least one item.', 'invalid');
  end if;

  -- 1. validate lines against the current menu and compute totals
  for line in select * from jsonb_array_elements(p_order->'lines') loop
    qty := (line->>'qty')::int;
    if qty is null or qty <= 0 then perform public._fail('Quantity must be at least 1.', 'invalid'); end if;
    if line->>'kind' = 'variant' then
      select exists (select 1 from public.variants where id = (line->>'refId')::uuid and outlet_id = ses.outlet_id and active) into ref_ok;
    elsif line->>'kind' = 'combo' then
      select exists (select 1 from public.combos where id = (line->>'refId')::uuid and outlet_id = ses.outlet_id and active) into ref_ok;
    else
      ref_ok := false;
    end if;
    if not ref_ok then perform public._fail('Unknown menu item. Reload the app.', 'conflict'); end if;
    pr := public._price((line->>'refId')::uuid);
    if pr.id is null or pr.price_paise <> (line->>'unitPricePaise')::int then
      perform public._fail('A price has changed. Reload the app to get the new menu.', 'conflict');
    end if;

    mods := '[]'::jsonb;
    mods_total := 0;
    for m in select * from jsonb_array_elements(coalesce(line->'modifiers', '[]'::jsonb)) loop
      select name into mod_name from public.modifiers where id = (m->>'modifierId')::uuid and outlet_id = ses.outlet_id;
      if mod_name is null then perform public._fail('Unknown add-on. Reload the app.', 'conflict'); end if;
      mpr := public._price((m->>'modifierId')::uuid);
      if coalesce(mpr.price_paise, 0) <> coalesce((m->>'pricePaise')::int, 0) then
        perform public._fail('An add-on price has changed. Reload the app.', 'conflict');
      end if;
      mods := mods || jsonb_build_object('id', m->>'modifierId', 'name', mod_name,
                                         'price', coalesce(mpr.price_paise, 0), 'cost', mpr.cost_paise);
      mods_total := mods_total + coalesce(mpr.price_paise, 0);
    end loop;

    computed := computed || jsonb_build_object(
      'kind', line->>'kind', 'refId', line->>'refId', 'name', coalesce(nullif(line->>'name', ''), 'Item'),
      'qty', qty, 'price', pr.price_paise, 'cost', pr.cost_paise,
      'total', (pr.price_paise + mods_total) * qty, 'mods', mods);
    subtotal := subtotal + (pr.price_paise + mods_total) * qty;
  end loop;

  -- 2. discount rules
  if disc < 0 then perform public._fail('Discount cannot be negative.', 'invalid'); end if;
  if disc > subtotal then perform public._fail('Discount is more than the bill.', 'invalid'); end if;
  if disc > 0 and disc_reason is null then perform public._fail('A discount needs a reason.', 'invalid'); end if;
  if disc > 0 and ses.role <> 'owner' then
    select cashier_discount_limit_paise into limit_paise from public.outlets where id = ses.outlet_id;
    if disc > limit_paise then
      select * into approval from public.owner_approvals
        where token = (p_order#>>'{discount,approvalToken}')::uuid and used_at is null and expires_at > now()
          and device_id = ses.device_id;
      if approval.token is null then
        perform public._fail('This discount needs the owner''s PIN.', 'not_allowed');
      end if;
      update public.owner_approvals set used_at = now() where token = approval.token;
      approver := approval.owner_id;
    end if;
  end if;
  total := subtotal - disc;
  if (p_order->>'totalPaise')::int is distinct from total then
    perform public._fail('Bill total does not match the menu. Reload the app.', 'conflict');
  end if;

  -- 3. payments must add up exactly
  for pay in select * from jsonb_array_elements(coalesce(p_order->'payments', '[]'::jsonb)) loop
    if coalesce(pay->>'method', '') not in ('cash', 'upi') or coalesce((pay->>'amountPaise')::int, 0) <= 0 then
      perform public._fail('Invalid payment.', 'invalid');
    end if;
    if pay->>'method' = 'cash' and (pay->>'cashReceivedPaise')::int < (pay->>'amountPaise')::int then
      perform public._fail('Cash received is less than the cash amount.', 'invalid');
    end if;
    paid := paid + (pay->>'amountPaise')::int;
  end loop;
  if pay_later then
    -- dine in, paid after eating: saved without payments, settled later with pos_settle_order
    if svc is distinct from 'dine_in' then perform public._fail('Only dine-in bills can be paid later.', 'invalid'); end if;
    if paid <> 0 then perform public._fail('A pay-later bill has no payments yet.', 'invalid'); end if;
  elsif paid <> total then
    perform public._fail(format('Payments (%s) do not match the bill total (%s).', paid, total), 'invalid');
  end if;

  -- 4. write once
  insert into public.orders (
    id, outlet_id, device_id, bill_no, bill_seq, token, staff_id, day_session_id, channel,
    external_order_id, note, subtotal_paise, discount_paise, discount_reason, discount_approved_by,
    total_paise, menu_version, client_created_at, service)
  values (
    oid, ses.outlet_id, ses.device_id, bill, seq, (p_order->>'token')::int, ses.staff_id, d.id, p_order->>'channel',
    case when p_order->>'channel' in ('swiggy', 'zomato') then nullif(trim(coalesce(p_order->>'externalOrderId', '')), '') end,
    nullif(trim(coalesce(p_order->>'note', '')), ''),
    subtotal, disc, case when disc > 0 then disc_reason end, approver, total,
    coalesce((p_order->>'menuVersion')::int, 0), coalesce((p_order->>'createdAt')::timestamptz, now()), svc);

  for c in select * from jsonb_array_elements(computed) loop
    ln := ln + 1;
    insert into public.order_lines (order_id, line_no, kind, ref_id, name, qty, unit_price_paise, unit_cost_paise, line_total_paise)
    values (oid, ln, c->>'kind', (c->>'refId')::uuid, c->>'name', (c->>'qty')::int, (c->>'price')::int,
            (c->>'cost')::int, (c->>'total')::int)
    returning id into lid;
    insert into public.order_line_modifiers (order_line_id, modifier_id, name, price_paise, cost_paise)
    select lid, (x->>'id')::uuid, x->>'name', (x->>'price')::int, (x->>'cost')::int
    from jsonb_array_elements(c->'mods') x;
  end loop;

  insert into public.payments (order_id, method, amount_paise, cash_received_paise)
  select oid, x->>'method', (x->>'amountPaise')::int,
         case when x->>'method' = 'cash' then (x->>'cashReceivedPaise')::int end
  from jsonb_array_elements(p_order->'payments') x;

  update public.devices set last_bill_seq = greatest(last_bill_seq, seq) where id = ses.device_id;
  perform public._log(ses.outlet_id, 'order_created', oid, ses.staff_id, ses.device_id,
                      jsonb_build_object('billNo', bill, 'totalPaise', total));
  return public._order_json(oid);
end $$;

-- Takes payment for a dine-in bill that was saved as not paid. Retrying is safe: a bill
-- that already has its payments is returned as it is.
create or replace function public.pos_settle_order(p_session uuid, p_order uuid, p_payments jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  o public.orders;
  d public.day_sessions;
  pay jsonb;
  paid integer := 0;
begin
  ses := public._session(p_session);
  select * into o from public.orders where id = p_order and outlet_id = ses.outlet_id;
  if not found then perform public._fail('Bill not found.', 'invalid'); end if;
  if exists (select 1 from public.payments where order_id = o.id) then
    return public._order_json(o.id); -- already paid (e.g. a retry)
  end if;
  if exists (select 1 from public.order_voids where order_id = o.id) then
    perform public._fail('This bill was voided.', 'conflict');
  end if;
  d := public._open_day(ses.outlet_id);
  if o.day_session_id <> d.id then
    perform public._fail('This bill belongs to a day that is closed.', 'conflict');
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce(pay->>'method', '') not in ('cash', 'upi') or coalesce((pay->>'amountPaise')::int, 0) <= 0 then
      perform public._fail('Invalid payment.', 'invalid');
    end if;
    if pay->>'method' = 'cash' and (pay->>'cashReceivedPaise')::int < (pay->>'amountPaise')::int then
      perform public._fail('Cash received is less than the cash amount.', 'invalid');
    end if;
    paid := paid + (pay->>'amountPaise')::int;
  end loop;
  if paid <> o.total_paise then
    perform public._fail(format('Payments (%s) do not match the bill total (%s).', paid, o.total_paise), 'invalid');
  end if;
  insert into public.payments (order_id, method, amount_paise, cash_received_paise)
  select o.id, x->>'method', (x->>'amountPaise')::int,
         case when x->>'method' = 'cash' then (x->>'cashReceivedPaise')::int end
  from jsonb_array_elements(p_payments) x;
  perform public._log(ses.outlet_id, 'order_settled', o.id, ses.staff_id, ses.device_id,
                      jsonb_build_object('billNo', o.bill_no, 'totalPaise', o.total_paise));
  return public._order_json(o.id);
end $$;

create or replace function public.pos_close_day(p_session uuid, p_counted_cash_paise integer, p_leftovers jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  d public.day_sessions;
  t jsonb;
  expected integer;
  lo jsonb;
begin
  ses := public._session(p_session);
  d := public._open_day(ses.outlet_id);
  if p_counted_cash_paise is null or p_counted_cash_paise < 0 then
    perform public._fail('Counted cash must be zero or more.', 'invalid');
  end if;
  if exists (select 1 from public.orders o where o.day_session_id = d.id
             and not exists (select 1 from public.payments p where p.order_id = o.id)
             and not exists (select 1 from public.order_voids v where v.order_id = o.id)) then
    perform public._fail('Some dine-in bills are still not paid. Take their payment (or void them) first.', 'conflict');
  end if;
  t := public._day_totals(d.id);
  expected := d.opening_float_paise + (t->>'cashSalesPaise')::int + (t->>'cashInPaise')::int
              - (t->>'expenseCashPaise')::int - (t->>'cashOutPaise')::int;
  for lo in select * from jsonb_array_elements(coalesce(p_leftovers, '[]'::jsonb)) loop
    if coalesce((lo->>'plates')::int, 0) > 0 then
      insert into public.leftovers (day_session_id, variant_id, plates)
      select d.id, v.id, (lo->>'plates')::int
      from public.variants v where v.id = (lo->>'variantId')::uuid and v.outlet_id = ses.outlet_id;
    end if;
  end loop;
  update public.day_sessions
    set closed_at = now(), closed_by = ses.staff_id, expected_cash_paise = expected,
        counted_cash_paise = p_counted_cash_paise, variance_paise = p_counted_cash_paise - expected
    where id = d.id
    returning * into d;
  perform public._log(ses.outlet_id, 'day_closed', d.id, ses.staff_id, ses.device_id,
                      jsonb_build_object('expectedCashPaise', expected, 'countedCashPaise', p_counted_cash_paise));
  return public._day_json(d);
end $$;

-- ---------------------------------------------------------------- permissions (same rules as before)

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'pos\_%' or p.proname like 'admin\_%' or p.proname like '\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'pos\_%' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    elsif f.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
      if f.args like '%p_session uuid%' then
        execute format('grant execute on function %s to anon', f.sig);
      end if;
    end if;
  end loop;
end $$;
