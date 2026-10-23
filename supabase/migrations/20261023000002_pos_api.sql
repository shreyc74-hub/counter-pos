-- Counter API. The web app (and later the Android app) only calls these functions.
-- They run as the table owner (security definer) and check the device key and the
-- staff session themselves, so every business rule lives in one place.
-- Errors carry a hint the app understands: no_device, no_session, no_open_day,
-- not_allowed, invalid, conflict, locked.

-- ---------------------------------------------------------------- owner read access to child rows

create policy owner_read on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.is_outlet_owner(o.outlet_id)));
create policy owner_read on public.order_line_modifiers for select to authenticated
  using (exists (select 1 from public.order_lines l join public.orders o on o.id = l.order_id
                 where l.id = order_line_id and public.is_outlet_owner(o.outlet_id)));
create policy owner_read on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.is_outlet_owner(o.outlet_id)));
create policy owner_read on public.order_voids for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.is_outlet_owner(o.outlet_id)));
create policy owner_read on public.leftovers for select to authenticated
  using (exists (select 1 from public.day_sessions d where d.id = day_session_id and public.is_outlet_owner(d.outlet_id)));
grant select on public.order_lines, public.order_line_modifiers, public.payments, public.order_voids, public.leftovers to authenticated;

-- ---------------------------------------------------------------- helpers (not callable by clients)

create function public._fail(p_message text, p_hint text) returns void
language plpgsql as $$
begin
  raise exception '%', p_message using errcode = 'P0001', hint = p_hint;
end $$;

create function public._hash_key(p_key text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
$$;

create function public._device(p_device_key text) returns public.devices
language plpgsql security definer set search_path = public, extensions as $$
declare d public.devices;
begin
  select * into d from public.devices where token_hash = public._hash_key(p_device_key) and active;
  if not found then
    perform public._fail('This device is not registered. Ask the owner for a device key.', 'no_device');
  end if;
  update public.devices set last_seen_at = now() where id = d.id;
  return d;
end $$;

create type public.pos_session as (
  staff_id uuid,
  staff_name text,
  role text,
  device_id uuid,
  device_code text,
  outlet_id uuid
);

create function public._session(p_session uuid) returns public.pos_session
language plpgsql security definer set search_path = public as $$
declare s public.pos_session;
begin
  select st.id, st.name, st.role, d.id, d.code, d.outlet_id into s
  from public.staff_sessions ss
  join public.staff st on st.id = ss.staff_id and st.active
  join public.devices d on d.id = ss.device_id and d.active
  where ss.token = p_session and ss.ended_at is null and ss.expires_at > now();
  if s.staff_id is null then
    perform public._fail('Please log in again with your PIN.', 'no_session');
  end if;
  return s;
end $$;

create function public._open_day(p_outlet uuid) returns public.day_sessions
language plpgsql security definer set search_path = public as $$
declare d public.day_sessions;
begin
  select * into d from public.day_sessions where outlet_id = p_outlet and closed_at is null;
  if not found then
    perform public._fail('Open the day first.', 'no_open_day');
  end if;
  return d;
end $$;

-- Current price/cost row for a variant, combo or modifier.
create function public._price(p_ref uuid) returns public.price_history
language sql stable security definer set search_path = public as $$
  select * from public.price_history
  where ref_id = p_ref and effective_from <= now()
  order by effective_from desc, created_at desc
  limit 1;
$$;

-- Checks a PIN against the outlet's active staff, with a short lock after repeated failures.
create function public._check_pin(p_device public.devices, p_pin text, p_owner_only boolean)
returns public.staff
language plpgsql security definer set search_path = public, extensions as $$
declare s public.staff;
begin
  if p_device.pin_locked_until is not null and p_device.pin_locked_until > now() then
    perform public._fail('Too many wrong PINs. Wait a minute and try again.', 'locked');
  end if;
  select * into s from public.staff
  where outlet_id = p_device.outlet_id and active and pin_hash = extensions.crypt(p_pin, pin_hash)
    and (not p_owner_only or role = 'owner')
  limit 1;
  if found then
    update public.devices set failed_pin_attempts = 0, pin_locked_until = null where id = p_device.id;
    return s;
  end if;
  update public.devices
    set failed_pin_attempts = failed_pin_attempts + 1,
        pin_locked_until = case when failed_pin_attempts + 1 >= 5 then now() + interval '1 minute' end
    where id = p_device.id;
  -- Keep the failed-attempt count: return null instead of raising (which would roll it back).
  return null;
end $$;

create function public._log(p_outlet uuid, p_type text, p_entity uuid, p_staff uuid, p_device uuid, p_payload jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.events (outlet_id, type, entity_id, staff_id, device_id, payload)
  values (p_outlet, p_type, p_entity, p_staff, p_device, coalesce(p_payload, '{}'));
$$;

create function public._day_json(d public.day_sessions) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d.id,
    'businessDate', to_char(d.business_date, 'YYYY-MM-DD'),
    'openedAt', d.opened_at,
    'openedBy', (select name from public.staff where id = d.opened_by),
    'openingFloatPaise', d.opening_float_paise,
    'closedAt', d.closed_at,
    'closedBy', (select name from public.staff where id = d.closed_by),
    'expectedCashPaise', d.expected_cash_paise,
    'countedCashPaise', d.counted_cash_paise,
    'variancePaise', d.variance_paise,
    'leftovers', coalesce((select jsonb_agg(jsonb_build_object('variantId', variant_id, 'plates', plates))
                           from public.leftovers where day_session_id = d.id), '[]'::jsonb)
  );
$$;

-- Order in the same shape the app uses (lib/domain/types.ts → Order).
create function public._order_json(p_order uuid) returns jsonb
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

-- ---------------------------------------------------------------- device + login

create function public.pos_bootstrap(p_device_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.devices;
  o public.outlets;
begin
  d := public._device(p_device_key);
  select * into o from public.outlets where id = d.outlet_id;
  return jsonb_build_object(
    'outlet', jsonb_build_object(
      'id', o.id, 'name', o.name, 'addressLine', o.address_line, 'phone', o.phone,
      'fssaiNo', o.fssai_no, 'receiptFooter', o.receipt_footer, 'isDemo', o.is_demo,
      'cashierDiscountLimitPaise', o.cashier_discount_limit_paise),
    'device', jsonb_build_object('id', d.id, 'code', d.code),
    'lastBillSeq', d.last_bill_seq,
    'soldOut', coalesce((select jsonb_agg(ref_id) from public.stock_outs
                         where outlet_id = o.id and marked_in_at is null), '[]'::jsonb),
    'menu', jsonb_build_object(
      'version', o.menu_version,
      'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort', sort) order by sort)
                              from public.categories where outlet_id = o.id and active), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', i.id, 'categoryId', i.category_id, 'name', i.name, 'batchCooked', i.batch_cooked, 'sort', i.sort,
                           'modifierIds', coalesce((select jsonb_agg(im.modifier_id order by im.sort)
                                                    from public.item_modifiers im
                                                    join public.modifiers m on m.id = im.modifier_id and m.active
                                                    where im.item_id = i.id), '[]'::jsonb))
                           order by i.sort)
                         from public.items i where i.outlet_id = o.id and i.active), '[]'::jsonb),
      'variants', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', v.id, 'itemId', v.item_id, 'name', v.name, 'sort', v.sort, 'active', v.active,
                              'pricePaise', (public._price(v.id)).price_paise, 'costPaise', null)
                              order by v.sort)
                            from public.variants v join public.items i on i.id = v.item_id and i.active
                            where v.outlet_id = o.id and v.active and (public._price(v.id)).id is not null), '[]'::jsonb),
      'modifiers', coalesce((select jsonb_agg(jsonb_build_object(
                               'id', m.id, 'name', m.name, 'pricePaise', coalesce((public._price(m.id)).price_paise, 0), 'costPaise', null))
                             from public.modifiers m where m.outlet_id = o.id and m.active), '[]'::jsonb),
      'combos', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', c.id, 'name', c.name, 'description', c.description, 'active', c.active,
                            'pricePaise', (public._price(c.id)).price_paise, 'costPaise', null,
                            'parts', coalesce((select jsonb_agg(jsonb_build_object('variantId', variant_id, 'qty', qty))
                                               from public.combo_items where combo_id = c.id), '[]'::jsonb)))
                          from public.combos c where c.outlet_id = o.id and c.active and (public._price(c.id)).id is not null), '[]'::jsonb),
      'favourites', coalesce((select jsonb_agg(ref_id order by sort) from public.favourites where outlet_id = o.id), '[]'::jsonb)
    )
  );
end $$;

create function public.pos_login(p_device_key text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.devices;
  s public.staff;
  tok uuid;
begin
  d := public._device(p_device_key);
  s := public._check_pin(d, p_pin, false);
  if s.id is null then
    return null;
  end if;
  insert into public.staff_sessions (staff_id, device_id) values (s.id, d.id) returning token into tok;
  perform public._log(d.outlet_id, 'login', s.id, s.id, d.id);
  return jsonb_build_object('session', tok, 'staff', jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role));
end $$;

-- Owner approval for something a cashier can't do alone. Returns a single-use token.
create function public.pos_owner_approval(p_session uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  d public.devices;
  s public.staff;
  tok uuid;
begin
  ses := public._session(p_session);
  select * into d from public.devices where id = ses.device_id;
  s := public._check_pin(d, p_pin, true);
  if s.id is null then
    return null;
  end if;
  insert into public.owner_approvals (owner_id, device_id) values (s.id, d.id) returning token into tok;
  return jsonb_build_object('name', s.name, 'approvalToken', tok);
end $$;

create function public.pos_logout(p_session uuid) returns void
language sql security definer set search_path = public as $$
  update public.staff_sessions set ended_at = now() where token = p_session and ended_at is null;
$$;

-- ---------------------------------------------------------------- day

create function public.pos_current_day(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  d public.day_sessions;
begin
  ses := public._session(p_session);
  select * into d from public.day_sessions where outlet_id = ses.outlet_id and closed_at is null;
  if not found then return null; end if;
  return public._day_json(d)
    || jsonb_build_object('lastToken', coalesce((select max(token) from public.orders where day_session_id = d.id), 0));
end $$;

create function public.pos_open_day(p_session uuid, p_opening_float_paise integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  d public.day_sessions;
  tz text;
begin
  ses := public._session(p_session);
  if p_opening_float_paise is null or p_opening_float_paise < 0 then
    perform public._fail('Opening cash must be zero or more.', 'invalid');
  end if;
  if exists (select 1 from public.day_sessions where outlet_id = ses.outlet_id and closed_at is null) then
    perform public._fail('A day is already open.', 'conflict');
  end if;
  select timezone into tz from public.outlets where id = ses.outlet_id;
  insert into public.day_sessions (outlet_id, business_date, opened_by, opening_float_paise)
  values (ses.outlet_id, (now() at time zone tz)::date, ses.staff_id, p_opening_float_paise)
  returning * into d;
  perform public._log(ses.outlet_id, 'day_opened', d.id, ses.staff_id, ses.device_id,
                      jsonb_build_object('openingFloatPaise', p_opening_float_paise));
  return public._day_json(d) || jsonb_build_object('lastToken', 0);
end $$;

create function public._day_totals(p_day uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with live as (
    select o.* from public.orders o
    where o.day_session_id = p_day and not exists (select 1 from public.order_voids v where v.order_id = o.id)
  )
  select jsonb_build_object(
    'cashSalesPaise', coalesce((select sum(p.amount_paise) from public.payments p join live on live.id = p.order_id where p.method = 'cash'), 0),
    'upiSalesPaise', coalesce((select sum(p.amount_paise) from public.payments p join live on live.id = p.order_id where p.method = 'upi'), 0),
    'expenseCashPaise', coalesce((select sum(amount_paise) from public.expenses where day_session_id = p_day and method = 'cash'), 0),
    'cashInPaise', coalesce((select sum(amount_paise) from public.cash_movements where day_session_id = p_day and direction = 'in'), 0),
    'cashOutPaise', coalesce((select sum(amount_paise) from public.cash_movements where day_session_id = p_day and direction = 'out'), 0)
  );
$$;

create function public.pos_close_day(p_session uuid, p_counted_cash_paise integer, p_leftovers jsonb default '[]')
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

-- ---------------------------------------------------------------- orders

-- Saves a bill. Idempotent on the order id. Prices, totals and payments are checked
-- against the menu on the server, and costs are snapshotted here (never trusted from the app).
-- Everything is validated and computed first, then written once.
create function public.pos_submit_order(p_session uuid, p_order jsonb) returns jsonb
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
  if paid <> total then
    perform public._fail(format('Payments (%s) do not match the bill total (%s).', paid, total), 'invalid');
  end if;

  -- 4. write once
  insert into public.orders (
    id, outlet_id, device_id, bill_no, bill_seq, token, staff_id, day_session_id, channel,
    external_order_id, note, subtotal_paise, discount_paise, discount_reason, discount_approved_by,
    total_paise, menu_version, client_created_at)
  values (
    oid, ses.outlet_id, ses.device_id, bill, seq, (p_order->>'token')::int, ses.staff_id, d.id, p_order->>'channel',
    case when p_order->>'channel' in ('swiggy', 'zomato') then nullif(trim(coalesce(p_order->>'externalOrderId', '')), '') end,
    nullif(trim(coalesce(p_order->>'note', '')), ''),
    subtotal, disc, case when disc > 0 then disc_reason end, approver, total,
    coalesce((p_order->>'menuVersion')::int, 0), coalesce((p_order->>'createdAt')::timestamptz, now()));

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

create function public.pos_list_orders(p_session uuid, p_day uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ses public.pos_session;
begin
  ses := public._session(p_session);
  return coalesce((
    select jsonb_agg(public._order_json(o.id) order by o.client_created_at desc)
    from public.orders o where o.day_session_id = p_day and o.outlet_id = ses.outlet_id), '[]'::jsonb);
end $$;

create function public.pos_void_order(p_session uuid, p_order uuid, p_reason text, p_approver_pin text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  o public.orders;
  dev public.devices;
  owner_row public.staff;
  approver uuid;
begin
  ses := public._session(p_session);
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    perform public._fail('A reason is required.', 'invalid');
  end if;
  select * into o from public.orders where id = p_order and outlet_id = ses.outlet_id;
  if not found then perform public._fail('Order not found.', 'invalid'); end if;
  if exists (select 1 from public.order_voids where order_id = p_order) then
    return public._order_json(p_order);
  end if;
  if ses.role <> 'owner' then
    select * into dev from public.devices where id = ses.device_id;
    owner_row := public._check_pin(dev, coalesce(p_approver_pin, ''), true);
    if owner_row.id is null then
      return jsonb_build_object('error', 'owner_pin');
    end if;
    approver := owner_row.id;
  end if;
  insert into public.order_voids (order_id, reason, staff_id, approved_by)
  values (p_order, trim(p_reason), ses.staff_id, approver);
  perform public._log(ses.outlet_id, 'order_voided', p_order, ses.staff_id, ses.device_id,
                      jsonb_build_object('reason', trim(p_reason), 'approvedBy', approver, 'totalPaise', o.total_paise));
  return public._order_json(p_order);
end $$;

-- ---------------------------------------------------------------- money out

create function public.pos_add_expense(p_session uuid, p_category text, p_amount_paise integer, p_method text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  d public.day_sessions;
  e public.expenses;
begin
  ses := public._session(p_session);
  d := public._open_day(ses.outlet_id);
  if coalesce(p_amount_paise, 0) <= 0 then perform public._fail('Amount must be more than zero.', 'invalid'); end if;
  insert into public.expenses (outlet_id, day_session_id, category, amount_paise, method, note, staff_id)
  values (ses.outlet_id, d.id, p_category, p_amount_paise, p_method, nullif(trim(coalesce(p_note, '')), ''), ses.staff_id)
  returning * into e;
  perform public._log(ses.outlet_id, 'expense_added', e.id, ses.staff_id, ses.device_id,
                      jsonb_build_object('category', p_category, 'amountPaise', p_amount_paise, 'method', p_method));
  return public._expense_json(e);
end $$;

create function public._expense_json(e public.expenses) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'category', e.category, 'amountPaise', e.amount_paise, 'method', e.method, 'note', e.note,
    'staffId', e.staff_id, 'staffName', (select name from public.staff where id = e.staff_id),
    'daySessionId', e.day_session_id, 'createdAt', e.created_at);
$$;

create function public.pos_list_expenses(p_session uuid, p_day uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ses public.pos_session;
begin
  ses := public._session(p_session);
  return coalesce((select jsonb_agg(public._expense_json(e) order by e.created_at)
                   from public.expenses e where e.day_session_id = p_day and e.outlet_id = ses.outlet_id), '[]'::jsonb);
end $$;

create function public._movement_json(m public.cash_movements) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'direction', m.direction, 'amountPaise', m.amount_paise, 'reason', m.reason,
    'staffId', m.staff_id, 'staffName', (select name from public.staff where id = m.staff_id),
    'daySessionId', m.day_session_id, 'createdAt', m.created_at);
$$;

create function public.pos_add_cash_movement(p_session uuid, p_direction text, p_amount_paise integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ses public.pos_session;
  d public.day_sessions;
  m public.cash_movements;
begin
  ses := public._session(p_session);
  d := public._open_day(ses.outlet_id);
  if coalesce(p_amount_paise, 0) <= 0 then perform public._fail('Amount must be more than zero.', 'invalid'); end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then perform public._fail('A reason is required.', 'invalid'); end if;
  insert into public.cash_movements (outlet_id, day_session_id, direction, amount_paise, reason, staff_id)
  values (ses.outlet_id, d.id, p_direction, p_amount_paise, trim(p_reason), ses.staff_id)
  returning * into m;
  perform public._log(ses.outlet_id, 'cash_' || p_direction, m.id, ses.staff_id, ses.device_id,
                      jsonb_build_object('amountPaise', p_amount_paise, 'reason', trim(p_reason)));
  return public._movement_json(m);
end $$;

create function public.pos_list_cash_movements(p_session uuid, p_day uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ses public.pos_session;
begin
  ses := public._session(p_session);
  return coalesce((select jsonb_agg(public._movement_json(m) order by m.created_at)
                   from public.cash_movements m where m.day_session_id = p_day and m.outlet_id = ses.outlet_id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- sold out

create function public.pos_set_sold_out(p_session uuid, p_ref uuid, p_sold_out boolean) returns void
language plpgsql security definer set search_path = public as $$
declare ses public.pos_session;
begin
  ses := public._session(p_session);
  if p_sold_out then
    insert into public.stock_outs (outlet_id, ref_id, marked_out_by)
    values (ses.outlet_id, p_ref, ses.staff_id)
    on conflict (outlet_id, ref_id) where marked_in_at is null do nothing;
  else
    update public.stock_outs set marked_in_at = now(), marked_in_by = ses.staff_id
    where outlet_id = ses.outlet_id and ref_id = p_ref and marked_in_at is null;
  end if;
  perform public._log(ses.outlet_id, case when p_sold_out then 'sold_out' else 'back_in_stock' end, p_ref, ses.staff_id, ses.device_id);
end $$;

-- ---------------------------------------------------------------- permissions
-- Only the pos_* functions are callable from the app; helpers stay private.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'pos\_%' or p.proname like '\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'pos\_%' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
