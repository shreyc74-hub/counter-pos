-- "Not paid" dine-in bills. Runs after 05 (Street Heaven device 'test-key-two', its day is open).

set role anon;
do $$
declare
  ses uuid; b jsonb; d jsonb; v jsonb; seq int; base jsonb; o jsonb; price int; r jsonb;
begin
  ses := (public.pos_device_login('test-key-two')->>'session')::uuid;
  b := public.pos_bootstrap('test-key-two');
  seq := (b->>'lastBillSeq')::int;
  d := public.pos_current_day(ses);
  select x into v from jsonb_array_elements(b#>'{menu,variants}') x where x->>'name' = 'Full' limit 1;
  price := (v->>'pricePaise')::int;
  base := jsonb_build_object(
    'id', gen_random_uuid(), 'billNo', 'T2-' || lpad((seq + 1)::text, 6, '0'), 'token', 11,
    'daySessionId', d->>'id', 'channel', 'counter', 'service', 'dine_in', 'payLater', true, 'menuVersion', 1, 'createdAt', now(),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'variant', 'refId', v->>'id', 'name', 'x', 'qty', 1,
                                                  'unitPricePaise', price, 'modifiers', '[]'::jsonb)),
    'totalPaise', price, 'payments', '[]'::jsonb);

  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses, base || '{"service": "takeaway"}'), 'invalid');
  perform test.ok(true, 'only dine-in bills can be paid later');
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses, base - 'payLater'), 'invalid');
  perform test.ok(true, 'without payLater a bill still needs its payments');

  o := public.pos_submit_order(ses, base);
  perform test.ok((o->>'unpaid')::boolean and jsonb_array_length(o->'payments') = 0, 'dine-in bill saved as not paid');

  perform test.expect_error(format('select public.pos_close_day(%L, 0)', ses), 'conflict');
  perform test.ok(true, 'the day cannot close while a bill is not paid');

  perform test.expect_error(format('select public.pos_settle_order(%L, %L, %L)', ses, o->>'id',
    jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise', price - 100))), 'invalid');
  perform test.ok(true, 'settling needs the full amount');
  r := public.pos_settle_order(ses, (o->>'id')::uuid,
         jsonb_build_array(jsonb_build_object('method', 'cash', 'amountPaise', price, 'cashReceivedPaise', price + 1000)));
  perform test.ok(not (r->>'unpaid')::boolean and r#>>'{payments,0,method}' = 'cash', 'bill paid later by cash');
  r := public.pos_settle_order(ses, (o->>'id')::uuid, jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise', price)));
  perform test.ok(jsonb_array_length(r->'payments') = 1 and r#>>'{payments,0,method}' = 'cash', 'settling again changes nothing');

  -- a not-paid bill that gets voided doesn't block closing
  o := public.pos_submit_order(ses, base || jsonb_build_object('id', gen_random_uuid(), 'billNo', 'T2-' || lpad((seq + 2)::text, 6, '0'), 'token', 12));
  perform public.pos_void_order(ses, (o->>'id')::uuid, 'Customer left');
  perform test.expect_error(format('select public.pos_settle_order(%L, %L, %L)', ses, o->>'id',
    jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise', price))), 'conflict');
  perform test.ok(true, 'a voided bill cannot be paid');
  d := public.pos_close_day(ses, 0);
  perform test.ok(d->>'closedAt' is not null, 'day closes once every bill is paid or voided');
  perform test.ok((d->>'expectedCashPaise')::int >= 50000 + price, 'the later cash payment counts in the drawer');
end $$;
reset role;
