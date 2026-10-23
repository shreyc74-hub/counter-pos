-- API tests. Run by supabase/tests/run-local.sh after migrations + seed.
-- Calls go through the anon role, exactly like the counter app.

create schema test;
grant usage on schema test to anon;

-- Runs a statement and checks it fails with the expected hint.
create function test.expect_error(p_sql text, p_hint text) returns void language plpgsql as $$
declare h text; msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics h = pg_exception_hint, msg = message_text;
    if h is distinct from p_hint then
      raise exception 'expected hint % but got % (%): %', p_hint, h, msg, p_sql;
    end if;
    return;
  end;
  raise exception 'expected error % but statement succeeded: %', p_hint, p_sql;
end $$;
grant execute on function test.expect_error(text, text) to anon;

create function test.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_what; end if;
  raise notice 'ok - %', p_what;
end $$;
grant execute on function test.ok(boolean, text) to anon;

create function test.id(t text) returns uuid language sql immutable as $$ select md5('cpos:' || t)::uuid $$;
grant execute on function test.id(text) to anon;

-- A priced add-on for the tests (the real menu's add-ons are all free).
insert into public.modifiers (id, outlet_id, name) values (test.id('mod-test-mayo'), test.id('outlet'), 'Extra mayo');
insert into public.item_modifiers (item_id, modifier_id) values (test.id('it-veg-momos'), test.id('mod-test-mayo'));
insert into public.price_history (outlet_id, ref_kind, ref_id, price_paise, cost_paise, effective_from)
values (test.id('outlet'), 'modifier', test.id('mod-test-mayo'), 1000, 300, now() - interval '1 day');

-- A second device so PIN lockout tests don't lock the main one.
insert into public.devices (outlet_id, code, token_hash)
values (test.id('outlet'), 'T2', public._hash_key('demo-t2-key'));

-- ---------------------------------------------------------------- seed sanity (as postgres)
do $$
declare sita numeric; ramesh numeric; pack_recent numeric; pack_before numeric;
begin
  perform test.ok((select count(*) from public.day_sessions where closed_at is not null) = 90, 'seed: 90 closed demo days');
  perform test.ok((select count(*) from public.orders) > 15000, 'seed: realistic order volume');
  select avg((exists (select 1 from public.order_voids v where v.order_id = o.id))::int) into sita
    from public.orders o where staff_id = test.id('staff-sita');
  select avg((exists (select 1 from public.order_voids v where v.order_id = o.id))::int) into ramesh
    from public.orders o where staff_id = test.id('staff-ramesh');
  perform test.ok(sita > ramesh * 2, format('seed: Sita voids more (%s vs %s)', round(sita, 3), round(ramesh, 3)));
  select avg(amount_paise) into pack_recent from public.expenses e join public.day_sessions d on d.id = e.day_session_id
    where category = 'packaging' and d.business_date > current_date - 30;
  select avg(amount_paise) into pack_before from public.expenses e join public.day_sessions d on d.id = e.day_session_id
    where category = 'packaging' and d.business_date <= current_date - 30;
  perform test.ok(pack_recent > pack_before * 1.2, 'seed: packaging spend rises in the last 30 days');
  perform test.ok((select count(*) from public.stock_outs) >= 10, 'seed: Friday sell-outs logged');
  perform test.ok(
    (select bool_and(o.total_paise = (select sum(amount_paise) from public.payments p where p.order_id = o.id)) from public.orders o),
    'seed: every bill''s payments add up to its total');
end $$;

set role anon;

-- ---------------------------------------------------------------- no direct table access
do $$
begin
  begin
    perform 1 from public.orders limit 1;
    raise exception 'anon could read orders';
  exception when insufficient_privilege then
    perform test.ok(true, 'anon cannot read tables directly');
  end;
  begin
    perform public._device('demo-t1-key');
    raise exception 'anon could call a private helper';
  exception when insufficient_privilege then
    perform test.ok(true, 'anon cannot call private helpers');
  end;
end $$;

-- ---------------------------------------------------------------- bootstrap + login
do $$
declare b jsonb; s jsonb;
begin
  perform test.expect_error($q$select public.pos_bootstrap('wrong-key')$q$, 'no_device');
  b := public.pos_bootstrap('demo-t1-key');
  perform test.ok(b#>>'{device,code}' = 'T1', 'bootstrap returns the device');
  perform test.ok(jsonb_array_length(b#>'{menu,favourites}') = 12, 'bootstrap returns 12 favourites');
  perform test.ok(jsonb_array_length(b#>'{menu,variants}') = 60, 'bootstrap returns all 60 menu options');
  perform test.ok(not exists (select 1 from jsonb_array_elements(b#>'{menu,variants}') v where v->>'costPaise' is not null),
                  'costs are never sent to the counter');
  perform test.ok((b->>'lastBillSeq')::int > 15000, 'bootstrap tells the device where its bill numbers are');

  perform test.ok(public.pos_login('demo-t1-key', '9999') is null, 'wrong PIN returns nothing');
  s := public.pos_login('demo-t1-key', '1111');
  perform test.ok(s#>>'{staff,name}' = 'Ramesh', 'right PIN logs in');
  perform test.expect_error($q$select public.pos_current_day('00000000-0000-0000-0000-000000000000')$q$, 'no_session');
end $$;

do $$
begin
  for i in 1..5 loop perform public.pos_login('demo-t2-key', '0000'); end loop;
  perform test.expect_error($q$select public.pos_login('demo-t2-key', '1111')$q$, 'locked');
  perform test.ok(true, 'five wrong PINs lock the device for a minute');
end $$;

-- ---------------------------------------------------------------- a full day
do $$
declare
  ses uuid; owner_ses uuid; d jsonb; o jsonb; r jsonb; ap jsonb; dayid uuid; seq int;
  veg uuid := test.id('veg-stm-f'); roll uuid := test.id('spring-roll-h'); mayo uuid := test.id('mod-test-mayo');
  base jsonb;
begin
  ses := (public.pos_login('demo-t1-key', '1111')->>'session')::uuid;
  owner_ses := (public.pos_login('demo-t1-key', '1234')->>'session')::uuid;
  perform test.ok(public.pos_current_day(ses) is null, 'no day open after seed');
  perform test.expect_error(format('select public.pos_add_expense(%L, %L, 100, %L)', ses, 'gas', 'cash'), 'no_open_day');
  d := public.pos_open_day(ses, 100000);
  dayid := (d->>'id')::uuid;
  perform test.ok((d->>'openingFloatPaise')::int = 100000, 'day opens with float');
  perform test.expect_error(format('select public.pos_open_day(%L, 0)', ses), 'conflict');
  seq := (public.pos_bootstrap('demo-t1-key')->>'lastBillSeq')::int;

  base := jsonb_build_object(
    'id', gen_random_uuid(), 'billNo', 'T1-' || lpad((seq + 1)::text, 6, '0'), 'token', 1,
    'daySessionId', dayid, 'channel', 'counter', 'menuVersion', 1, 'createdAt', now(),
    'lines', jsonb_build_array(
      jsonb_build_object('kind', 'variant', 'refId', veg, 'name', 'Veg Momos Steamed Full', 'qty', 2, 'unitPricePaise', 7900,
                         'modifiers', jsonb_build_array(jsonb_build_object('modifierId', mayo, 'pricePaise', 1000))),
      jsonb_build_object('kind', 'variant', 'refId', roll, 'name', 'Spring Roll Half', 'qty', 1, 'unitPricePaise', 4900,
                         'modifiers', '[]'::jsonb)),
    'totalPaise', 22700,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', 22700, 'cashReceivedPaise', 50000)));

  -- wrong price is refused
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses,
    jsonb_set(base, '{lines,1,unitPricePaise}', '4000')), 'conflict');
  -- payments must add up
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses,
    jsonb_set(base, '{payments,0,amountPaise}', '20000')), 'invalid');
  -- bill number must belong to the device
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses,
    jsonb_set(base, '{billNo}', '"T2-000001"')), 'invalid');

  o := public.pos_submit_order(ses, base);
  perform test.ok((o->>'totalPaise')::int = 22700 and (o->>'subtotalPaise')::int = 22700, 'valid bill is saved with server-checked totals');
  perform test.ok(o->>'staffName' = 'Ramesh', 'bill is saved under the logged-in staff member');
  r := public.pos_submit_order(ses, base);
  perform test.ok(r->>'id' = o->>'id', 'resubmitting the same bill returns it instead of duplicating');

  -- discount above the cashier limit needs an owner approval token, used once
  base := base || jsonb_build_object('id', gen_random_uuid(), 'billNo', 'T1-' || lpad((seq + 2)::text, 6, '0'), 'token', 2,
            'totalPaise', 12700,
            'discount', jsonb_build_object('amountPaise', 10000, 'reason', 'Complaint'),
            'payments', jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise', 12700)));
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses, base), 'not_allowed');
  perform test.ok(public.pos_owner_approval(ses, '1111') is null, 'cashier PIN is not an owner approval');
  ap := public.pos_owner_approval(ses, '1234');
  perform test.ok(ap->>'name' = 'Shrey', 'owner PIN gives an approval');
  o := public.pos_submit_order(ses, jsonb_set(base, '{discount,approvalToken}', to_jsonb(ap->>'approvalToken')));
  perform test.ok(o#>>'{discount,approvedBy}' = 'Shrey' and (o->>'totalPaise')::int = 12700, 'approved discount saved');
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses,
    jsonb_set(base || jsonb_build_object('id', gen_random_uuid(), 'billNo', 'T1-' || lpad((seq + 3)::text, 6, '0')),
              '{discount,approvalToken}', to_jsonb(ap->>'approvalToken'))), 'not_allowed');
  perform test.ok(true, 'an approval can only be used once');

  -- a small discount needs no approval; split payment
  o := public.pos_submit_order(ses, base || jsonb_build_object(
         'id', gen_random_uuid(), 'billNo', 'T1-' || lpad((seq + 3)::text, 6, '0'), 'token', 3, 'totalPaise', 20700,
         'discount', jsonb_build_object('amountPaise', 2000, 'reason', 'Staff meal'),
         'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', 10000),
                                       jsonb_build_object('method', 'upi', 'amountPaise', 10700))));
  perform test.ok(jsonb_array_length(o->'payments') = 2 and o->'discount'->>'approvedBy' is null, 'small discount + split payment');

  -- voids: cashier needs the owner PIN; the bill itself never changes
  r := public.pos_void_order(ses, (o->>'id')::uuid, 'Wrong item entered', '2222');
  perform test.ok(r->>'error' = 'owner_pin', 'cashier void with a non-owner PIN is refused');
  perform test.expect_error(format('select public.pos_void_order(%L, %L, %L)', ses, o->>'id', ' '), 'invalid');
  r := public.pos_void_order(ses, (o->>'id')::uuid, 'Wrong item entered', '1234');
  perform test.ok(r#>>'{voided,approvedBy}' = 'Shrey' and r#>>'{voided,by}' = 'Ramesh', 'void recorded with who and who approved');
  r := public.pos_void_order(owner_ses, (base->>'id')::uuid, 'Duplicate bill');
  perform test.ok(r#>>'{voided,by}' = 'Shrey', 'owner can void without approval');

  perform test.ok(jsonb_array_length(public.pos_list_orders(ses, dayid)) = 3, 'orders today lists all bills incl. voided');

  -- money out
  r := public.pos_add_expense(ses, 'packaging', 8500, 'cash', 'Boxes');
  perform test.ok(r->>'staffName' = 'Ramesh', 'expense saved');
  perform test.expect_error(format('select public.pos_add_expense(%L, %L, 0, %L)', ses, 'gas', 'cash'), 'invalid');
  r := public.pos_add_cash_movement(ses, 'out', 20000, 'Paid supplier');
  perform test.expect_error(format('select public.pos_add_cash_movement(%L, %L, 100, %L)', ses, 'in', ''), 'invalid');
  perform test.ok(jsonb_array_length(public.pos_list_expenses(ses, dayid)) = 1, 'expenses listed');

  -- sold out
  perform public.pos_set_sold_out(ses, veg, true);
  perform public.pos_set_sold_out(ses, veg, true);
  perform test.ok(public.pos_bootstrap('demo-t1-key')->'soldOut' @> to_jsonb(array[veg]), 'sold out shows on bootstrap');
  perform public.pos_set_sold_out(ses, veg, false);
  perform test.ok(not (public.pos_bootstrap('demo-t1-key')->'soldOut' @> to_jsonb(array[veg])), 'back in stock');

  -- close: float 1000 + cash 227 (bill 1) − 85 expense − 200 cash out = 942; bill 3 (cash 100) is voided
  d := public.pos_close_day(ses, 93200, jsonb_build_array(jsonb_build_object('variantId', veg, 'plates', 3)));
  perform test.ok((d->>'expectedCashPaise')::int = 94200, format('expected cash computed on the server (%s)', d->>'expectedCashPaise'));
  perform test.ok((d->>'variancePaise')::int = -1000, 'difference saved');
  perform test.ok(jsonb_array_length(d->'leftovers') = 1, 'leftovers saved');
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses,
    base || jsonb_build_object('id', gen_random_uuid(), 'billNo', 'T1-' || lpad((seq + 9)::text, 6, '0'))), 'no_open_day');
end $$;

reset role;

-- ---------------------------------------------------------------- stored rows (as postgres)
do $$
declare oid uuid;
begin
  select o.id into oid from public.orders o
  join public.day_sessions d on d.id = o.day_session_id
  where o.token = 1 order by d.opened_at desc limit 1;
  perform test.ok((select count(*) from public.order_lines where order_id = oid) = 2, 'only one copy of the resubmitted bill');
  perform test.ok((select unit_cost_paise from public.order_lines where order_id = oid and line_no = 1) = 3000,
                  'cost snapshotted on the server');
  perform test.ok((select line_total_paise from public.order_lines where order_id = oid and line_no = 1) = 17800,
                  'line total includes add-ons x qty');
  perform test.ok((select count(*) from public.events where type = 'order_voided') >= 2, 'voids are in the audit log');
end $$;

-- ---------------------------------------------------------------- append-only even for the database owner
do $$
begin
  perform test.expect_error('update public.orders set total_paise = 0 where true', 'not_allowed');
  perform test.expect_error('delete from public.payments where true', 'not_allowed');
  perform test.expect_error('update public.day_sessions set counted_cash_paise = 0 where closed_at is not null', 'not_allowed');
  perform test.expect_error('delete from public.order_voids where true', 'not_allowed');
  perform test.ok(true, 'bills, payments, voids and closed days cannot be edited or deleted');
end $$;
