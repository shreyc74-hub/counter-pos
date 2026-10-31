-- Dashboard facts count sales on the date they happened, even in a day left open for days.
-- Runs after 06 (Street Heaven device 'test-key-two'; its last day is closed).

set role anon;
do $$
declare
  ses uuid; outlet uuid; b jsonb; d jsonb; v jsonb; seq int; o jsonb; f jsonb; price int;
  today date := (now() at time zone 'Asia/Kolkata')::date; -- the app's dates are India dates
  later date := today + 2;
begin
  ses := (public.pos_device_login('test-key-two')->>'session')::uuid;
  b := public.pos_bootstrap('test-key-two');
  outlet := (b#>>'{outlet,id}')::uuid;
  seq := (b->>'lastBillSeq')::int;
  d := public.pos_open_day(ses, 0); -- opened today and (in this test) never closed
  select x into v from jsonb_array_elements(b#>'{menu,variants}') x limit 1;
  price := (v->>'pricePaise')::int;
  -- a sale made two days later, in the same still-open day
  o := public.pos_submit_order(ses, jsonb_build_object(
    'id', gen_random_uuid(), 'billNo', 'T2-' || lpad((seq + 1)::text, 6, '0'), 'token', 1,
    'daySessionId', d->>'id', 'channel', 'counter', 'service', 'takeaway', 'menuVersion', 1,
    'createdAt', (later::timestamp + time '19:30') at time zone 'Asia/Kolkata',
    'lines', jsonb_build_array(jsonb_build_object('kind', 'variant', 'refId', v->>'id', 'name', 'x', 'qty', 1,
                                                  'unitPricePaise', price, 'modifiers', '[]'::jsonb)),
    'totalPaise', price, 'payments', jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise', price))));

  f := public.admin_facts(outlet, later, later, ses);
  perform test.ok(exists (select 1 from jsonb_array_elements(f->'orders') x where x->>0 = o->>'id'),
                  'a sale shows on the date it happened, not the date the day was opened');
  -- (that the open day itself counts on later dates up to today is covered by lib/admin/metrics.test.ts;
  -- here "later" is in the future, which an open day can't reach yet)
  perform test.ok(exists (select 1 from jsonb_array_elements(public.admin_facts(outlet, today - 1, today - 1, ses)->'days') x
                          where x->>'id' = d->>'id') = false, 'a day opened today is not part of yesterday');
  f := public.admin_facts(outlet, today, today, ses);
  perform test.ok(not exists (select 1 from jsonb_array_elements(f->'orders') x where x->>0 = o->>'id'),
                  'and it does not show on the opening date');
  perform public.pos_add_cash_movement(ses, 'in', 5000, 'Change top-up');
  f := public.admin_facts(outlet, today, today, ses);
  perform test.ok(jsonb_array_length(f->'movements'->-1) = 4, 'cash movements carry their time');
end $$;
reset role;
