-- Admin API for the owner's admin panel. Safe to run again. Callers are signed in with Supabase Auth
-- (email one-time code). An outlet's owner_email links the signed-in user to the outlet
-- on first sign-in; after that, outlet_owners decides access.
-- Errors use the same hints as the counter API (no_session, not_allowed, invalid).

alter table public.outlets add column if not exists owner_email text;

-- Created only if missing: migration 0004 replaces it with a version that also accepts
-- device sessions, and re-running this file afterwards must not undo that.
do $do$
begin
  if to_regprocedure('public._require_owner(uuid)') is null then
    execute $f$
create function public._require_owner(p_outlet uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    perform public._fail('Please sign in.', 'no_session');
  end if;
  if not public.is_outlet_owner(p_outlet) then
    perform public._fail('You are not an owner of this outlet.', 'not_allowed');
  end if;
end $$;
$f$;
  end if;
end $do$;

create or replace function public._bump_menu(p_outlet uuid, p_what text, p_id uuid, p_payload jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.outlets set menu_version = menu_version + 1 where id = p_outlet;
  perform public._log(p_outlet, p_what, p_id, null, null, p_payload || jsonb_build_object('by', auth.uid()));
end $$;

-- Adds a price/cost row only when something changed (history is never rewritten).
create or replace function public._set_price(p_outlet uuid, p_kind text, p_ref uuid, p_price integer, p_cost integer)
returns void language plpgsql security definer set search_path = public as $$
declare cur public.price_history;
begin
  if p_price is null or p_price < 0 then perform public._fail('Price must be zero or more.', 'invalid'); end if;
  if p_cost is not null and p_cost < 0 then perform public._fail('Cost must be zero or more.', 'invalid'); end if;
  cur := public._price(p_ref);
  if cur.id is null or cur.price_paise <> p_price or cur.cost_paise is distinct from p_cost then
    insert into public.price_history (outlet_id, ref_kind, ref_id, price_paise, cost_paise)
    values (p_outlet, p_kind, p_ref, p_price, p_cost);
  end if;
end $$;

-- Outlets the signed-in user owns. Links the user on first sign-in by matching owner_email.
create or replace function public.admin_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare email text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if auth.uid() is null then perform public._fail('Please sign in.', 'no_session'); end if;
  if email <> '' then
    insert into public.outlet_owners (outlet_id, user_id)
    select id, auth.uid() from public.outlets where lower(owner_email) = email
    on conflict do nothing;
  end if;
  return jsonb_build_object(
    'email', email,
    'outlets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'addressLine', o.address_line, 'phone', o.phone, 'fssaiNo', o.fssai_no,
        'receiptFooter', o.receipt_footer, 'isDemo', o.is_demo, 'cashierDiscountLimitPaise', o.cashier_discount_limit_paise)
        order by o.created_at)
      from public.outlets o join public.outlet_owners w on w.outlet_id = o.id and w.user_id = auth.uid()), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- menu (with costs)

create or replace function public.admin_menu(p_outlet uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner(p_outlet);
  return jsonb_build_object(
    'version', (select menu_version from public.outlets where id = p_outlet),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort, 'active', active) order by sort, name)
                            from public.categories where outlet_id = p_outlet), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', i.id, 'categoryId', i.category_id, 'name', i.name, 'batchCooked', i.batch_cooked,
                         'sort', i.sort, 'active', i.active,
                         'modifierIds', coalesce((select jsonb_agg(modifier_id order by sort) from public.item_modifiers where item_id = i.id), '[]'::jsonb))
                         order by i.sort, i.name)
                       from public.items i where i.outlet_id = p_outlet), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', v.id, 'itemId', v.item_id, 'name', v.name, 'sort', v.sort, 'active', v.active,
                            'pricePaise', p.price_paise, 'costPaise', p.cost_paise, 'priceSince', p.effective_from)
                            order by v.sort, v.name)
                          from public.variants v left join lateral (select * from public._price(v.id)) p on true
                          where v.outlet_id = p_outlet), '[]'::jsonb),
    'modifiers', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', m.id, 'name', m.name, 'active', m.active,
                             'pricePaise', coalesce(p.price_paise, 0), 'costPaise', p.cost_paise) order by m.name)
                           from public.modifiers m left join lateral (select * from public._price(m.id)) p on true
                           where m.outlet_id = p_outlet), '[]'::jsonb),
    'combos', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', c.id, 'name', c.name, 'description', c.description, 'active', c.active,
                          'pricePaise', p.price_paise, 'costPaise', p.cost_paise,
                          'parts', coalesce((select jsonb_agg(jsonb_build_object('variantId', variant_id, 'qty', qty))
                                             from public.combo_items where combo_id = c.id), '[]'::jsonb)) order by c.name)
                        from public.combos c left join lateral (select * from public._price(c.id)) p on true
                        where c.outlet_id = p_outlet), '[]'::jsonb),
    'favourites', coalesce((select jsonb_agg(ref_id order by sort) from public.favourites where outlet_id = p_outlet), '[]'::jsonb));
end $$;

create or replace function public.admin_price_history(p_outlet uuid, p_ref uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner(p_outlet);
  return coalesce((select jsonb_agg(jsonb_build_object('pricePaise', price_paise, 'costPaise', cost_paise, 'from', effective_from)
                                    order by effective_from desc)
                   from public.price_history where outlet_id = p_outlet and ref_id = p_ref), '[]'::jsonb);
end $$;

create or replace function public.admin_save_category(p_outlet uuid, p_id uuid, p_name text, p_sort integer, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public._require_owner(p_outlet);
  if nullif(trim(coalesce(p_name, '')), '') is null then perform public._fail('Name is required.', 'invalid'); end if;
  if p_id is null then
    insert into public.categories (outlet_id, name, sort, active) values (p_outlet, trim(p_name), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into rid;
  else
    update public.categories set name = trim(p_name), sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
    where id = p_id and outlet_id = p_outlet returning id into rid;
    if rid is null then perform public._fail('Category not found.', 'invalid'); end if;
  end if;
  perform public._bump_menu(p_outlet, 'category_saved', rid, jsonb_build_object('name', trim(p_name)));
  return rid;
end $$;

create or replace function public.admin_save_item(p_outlet uuid, p_id uuid, p_category uuid, p_name text, p_batch_cooked boolean,
                                       p_sort integer, p_active boolean, p_modifier_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public._require_owner(p_outlet);
  if nullif(trim(coalesce(p_name, '')), '') is null then perform public._fail('Name is required.', 'invalid'); end if;
  if not exists (select 1 from public.categories where id = p_category and outlet_id = p_outlet) then
    perform public._fail('Pick a category.', 'invalid');
  end if;
  if exists (select 1 from unnest(coalesce(p_modifier_ids, '{}')) m
             where not exists (select 1 from public.modifiers where id = m and outlet_id = p_outlet)) then
    perform public._fail('Unknown add-on.', 'invalid');
  end if;
  if p_id is null then
    insert into public.items (outlet_id, category_id, name, batch_cooked, sort, active)
    values (p_outlet, p_category, trim(p_name), coalesce(p_batch_cooked, false), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into rid;
  else
    update public.items set category_id = p_category, name = trim(p_name), batch_cooked = coalesce(p_batch_cooked, batch_cooked),
                            sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
    where id = p_id and outlet_id = p_outlet returning id into rid;
    if rid is null then perform public._fail('Item not found.', 'invalid'); end if;
  end if;
  delete from public.item_modifiers where item_id = rid;
  insert into public.item_modifiers (item_id, modifier_id, sort)
  select rid, m, n from unnest(coalesce(p_modifier_ids, '{}')) with ordinality as x(m, n);
  perform public._bump_menu(p_outlet, 'item_saved', rid, jsonb_build_object('name', trim(p_name)));
  return rid;
end $$;

create or replace function public.admin_save_variant(p_outlet uuid, p_id uuid, p_item uuid, p_name text, p_sort integer,
                                          p_active boolean, p_price_paise integer, p_cost_paise integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public._require_owner(p_outlet);
  if nullif(trim(coalesce(p_name, '')), '') is null then perform public._fail('Name is required.', 'invalid'); end if;
  if not exists (select 1 from public.items where id = p_item and outlet_id = p_outlet) then
    perform public._fail('Item not found.', 'invalid');
  end if;
  if p_id is null then
    insert into public.variants (outlet_id, item_id, name, sort, active)
    values (p_outlet, p_item, trim(p_name), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into rid;
  else
    update public.variants set name = trim(p_name), sort = coalesce(p_sort, sort), active = coalesce(p_active, active)
    where id = p_id and outlet_id = p_outlet and item_id = p_item returning id into rid;
    if rid is null then perform public._fail('Size not found.', 'invalid'); end if;
  end if;
  perform public._set_price(p_outlet, 'variant', rid, p_price_paise, p_cost_paise);
  perform public._bump_menu(p_outlet, 'variant_saved', rid,
    jsonb_build_object('name', trim(p_name), 'pricePaise', p_price_paise, 'costPaise', p_cost_paise));
  return rid;
end $$;

create or replace function public.admin_save_modifier(p_outlet uuid, p_id uuid, p_name text, p_active boolean,
                                           p_price_paise integer, p_cost_paise integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public._require_owner(p_outlet);
  if nullif(trim(coalesce(p_name, '')), '') is null then perform public._fail('Name is required.', 'invalid'); end if;
  if p_id is null then
    insert into public.modifiers (outlet_id, name, active) values (p_outlet, trim(p_name), coalesce(p_active, true))
    returning id into rid;
  else
    update public.modifiers set name = trim(p_name), active = coalesce(p_active, active)
    where id = p_id and outlet_id = p_outlet returning id into rid;
    if rid is null then perform public._fail('Add-on not found.', 'invalid'); end if;
  end if;
  perform public._set_price(p_outlet, 'modifier', rid, coalesce(p_price_paise, 0), p_cost_paise);
  perform public._bump_menu(p_outlet, 'modifier_saved', rid, jsonb_build_object('name', trim(p_name)));
  return rid;
end $$;

create or replace function public.admin_save_combo(p_outlet uuid, p_id uuid, p_name text, p_description text, p_active boolean,
                                        p_price_paise integer, p_cost_paise integer, p_parts jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public._require_owner(p_outlet);
  if nullif(trim(coalesce(p_name, '')), '') is null then perform public._fail('Name is required.', 'invalid'); end if;
  if jsonb_array_length(coalesce(p_parts, '[]'::jsonb)) = 0 then perform public._fail('A combo needs at least one item.', 'invalid'); end if;
  if exists (select 1 from jsonb_array_elements(p_parts) x
             where not exists (select 1 from public.variants where id = (x->>'variantId')::uuid and outlet_id = p_outlet)) then
    perform public._fail('Unknown item in combo.', 'invalid');
  end if;
  if p_id is null then
    insert into public.combos (outlet_id, name, description, active)
    values (p_outlet, trim(p_name), coalesce(p_description, ''), coalesce(p_active, true)) returning id into rid;
  else
    update public.combos set name = trim(p_name), description = coalesce(p_description, ''), active = coalesce(p_active, active)
    where id = p_id and outlet_id = p_outlet returning id into rid;
    if rid is null then perform public._fail('Combo not found.', 'invalid'); end if;
  end if;
  delete from public.combo_items where combo_id = rid;
  insert into public.combo_items (combo_id, variant_id, qty)
  select rid, (x->>'variantId')::uuid, sum(greatest(1, coalesce((x->>'qty')::int, 1)))
  from jsonb_array_elements(p_parts) x group by 2;
  perform public._set_price(p_outlet, 'combo', rid, p_price_paise, p_cost_paise);
  perform public._bump_menu(p_outlet, 'combo_saved', rid, jsonb_build_object('name', trim(p_name)));
  return rid;
end $$;

create or replace function public.admin_set_favourites(p_outlet uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner(p_outlet);
  delete from public.favourites where outlet_id = p_outlet;
  insert into public.favourites (outlet_id, ref_id, sort)
  select p_outlet, r, min(n) from unnest(coalesce(p_ids, '{}')) with ordinality as x(r, n)
  where exists (select 1 from public.variants where id = r and outlet_id = p_outlet)
     or exists (select 1 from public.combos where id = r and outlet_id = p_outlet)
  group by r;
  perform public._bump_menu(p_outlet, 'favourites_saved', null);
end $$;

-- ---------------------------------------------------------------- facts for the dashboard
-- Compact rows for a business-date range; the app computes every metric from these,
-- so the dashboard, reports and insights all agree. ~300 bills/day keeps this small.

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
      from public.day_sessions d where d.outlet_id = p_outlet and d.business_date between p_from and p_to), '[]'::jsonb),
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
      join public.day_sessions d on d.id = o.day_session_id
      join public.staff st on st.id = o.staff_id
      left join public.order_voids v on v.order_id = o.id
      where o.outlet_id = p_outlet and d.business_date between p_from and p_to), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_array(e.day_session_id, e.category, e.amount_paise, e.method, extract(epoch from e.created_at)::bigint)
                       order by e.created_at)
      from public.expenses e join public.day_sessions d on d.id = e.day_session_id
      where e.outlet_id = p_outlet and d.business_date between p_from and p_to), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_array(m.day_session_id, m.direction, m.amount_paise) order by m.created_at)
      from public.cash_movements m join public.day_sessions d on d.id = m.day_session_id
      where m.outlet_id = p_outlet and d.business_date between p_from and p_to), '[]'::jsonb),
    'stockOuts', coalesce((
      select jsonb_agg(jsonb_build_array(s.ref_id, extract(epoch from s.marked_out_at)::bigint) order by s.marked_out_at)
      from public.stock_outs s
      where s.outlet_id = p_outlet
        and (s.marked_out_at at time zone 'Asia/Kolkata')::date between p_from and p_to), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- permissions

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'admin\_%' or p.proname like '\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
