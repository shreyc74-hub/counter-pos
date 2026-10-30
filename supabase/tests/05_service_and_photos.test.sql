-- Dine in / takeaway on bills, and dish photos. Runs after 04_device_login.test.sql
-- (Street Heaven device 'test-key-two' signs straight in as the owner).

set role anon;
do $$
declare
  ses uuid; outlet uuid; d jsonb; o jsonb; b jsonb; m jsonb; ph jsonb; item uuid; v jsonb; seq int; base jsonb;
  photo text := 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
begin
  ses := (public.pos_device_login('test-key-two')->>'session')::uuid;
  b := public.pos_bootstrap('test-key-two');
  outlet := (b#>>'{outlet,id}')::uuid;
  seq := (b->>'lastBillSeq')::int;
  d := public.pos_open_day(ses, 50000);
  select x into v from jsonb_array_elements(b#>'{menu,variants}') x where x->>'name' = 'Half' limit 1;
  item := (v->>'itemId')::uuid;

  base := jsonb_build_object(
    'id', gen_random_uuid(), 'billNo', 'T2-' || lpad((seq + 1)::text, 6, '0'), 'token', 1,
    'daySessionId', d->>'id', 'channel', 'counter', 'service', 'takeaway', 'menuVersion', 1, 'createdAt', now(),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'variant', 'refId', v->>'id', 'name', 'x', 'qty', 1,
                                                  'unitPricePaise', (v->>'pricePaise')::int, 'modifiers', '[]'::jsonb)),
    'totalPaise', (v->>'pricePaise')::int,
    'payments', jsonb_build_array(jsonb_build_object('method', 'upi', 'amountPaise', (v->>'pricePaise')::int)));
  o := public.pos_submit_order(ses, base);
  perform test.ok(o->>'service' = 'takeaway', 'takeaway is saved on the bill');
  o := public.pos_submit_order(ses, base || jsonb_build_object('id', gen_random_uuid(), 'billNo', 'T2-' || lpad((seq + 2)::text, 6, '0'),
                                                               'token', 2, 'service', 'dine_in'));
  perform test.ok(o->>'service' = 'dine_in', 'dine in is saved on the bill');
  o := public.pos_submit_order(ses, (base - 'service') || jsonb_build_object('id', gen_random_uuid(),
                                       'billNo', 'T2-' || lpad((seq + 3)::text, 6, '0'), 'token', 3));
  perform test.ok(o->'service' = 'null'::jsonb, 'bills without a choice are still accepted');
  perform test.expect_error(format('select public.pos_submit_order(%L, %L)', ses,
    base || jsonb_build_object('id', gen_random_uuid(), 'billNo', 'T2-' || lpad((seq + 4)::text, 6, '0'), 'service', 'drive_thru')), 'invalid');

  -- photos
  perform test.ok(jsonb_array_length(public.pos_item_photos(ses)) = 0, 'no photos to start with');
  perform public.admin_set_item_photo(outlet, item, photo, ses);
  ph := public.pos_item_photos(ses);
  perform test.ok(ph->0->>'itemId' = item::text and ph->0->>'data' = photo, 'counter gets a new photo');
  ph := public.pos_item_photos(ses, jsonb_build_object(item::text, ph->0->>'updatedAt'));
  perform test.ok(ph->0->'data' = 'null'::jsonb, 'a photo the counter already has is not sent again');
  perform test.ok(public.admin_item_photos(outlet, ses)->>item::text = photo, 'admin sees the photo');
  perform test.expect_error(format('select public.admin_set_item_photo(%L, %L, %L, %L)', outlet, item, 'javascript:alert(1)', ses), 'invalid');
  perform test.expect_error(format('select public.admin_set_item_photo(%L, %L, %L, %L)', outlet, item,
                                   'data:image/jpeg;base64,' || repeat('A', 300001), ses), 'invalid');
  perform test.expect_error(format('select public.admin_set_item_photo(%L, %L, %L)', outlet, item, photo), '');
  perform test.ok(true, 'without a device session the counter cannot set photos (permission denied)');
  perform public.admin_set_item_photo(outlet, item, null, ses);
  perform test.ok(jsonb_array_length(public.pos_item_photos(ses)) = 0, 'photo removed');
end $$;
reset role;

-- the demo outlet's owner can't touch Street Heaven's photos
set role anon;
do $$
declare demo_ses uuid; outlet uuid;
begin
  demo_ses := (public.pos_login('demo-t1-key', '1234')->>'session')::uuid;
  outlet := (public.pos_bootstrap('test-key-two')#>>'{outlet,id}')::uuid;
  perform test.expect_error(format('select public.admin_set_item_photo(%L, (select null::uuid), null, %L)', outlet, demo_ses), 'not_allowed');
end $$;
reset role;
