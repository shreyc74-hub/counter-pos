-- One-person outlet: device key signs straight in; admin panel works with the same device.
-- Runs after 03_real_outlet.test.sql (Street Heaven exists, with owner 'Shrey' PIN 4321 and device T1).

delete from public.device_key_failures;
insert into public.devices (outlet_id, code, name, token_hash, auto_staff_id)
select o.id, 'T2', 'Street Heaven', public._hash_key('test-key-two'),
       (select id from public.staff s where s.outlet_id = o.id and s.role = 'owner' limit 1)
from public.outlets o where o.name = 'Street Heaven';
update public.devices set name = 'Shrey', auto_staff_id = (select id from public.staff where name = 'Shrey' and role = 'owner'
  and outlet_id = devices.outlet_id) where code = 'T1' and outlet_id = (select id from public.outlets where name = 'Street Heaven');

set role anon;
do $$
declare c jsonb; b jsonb; l jsonb; me jsonb; m jsonb; f jsonb; ses uuid; outlet uuid;
begin
  c := public.pos_device_choices();
  perform test.ok(c @> '[{"code":"T1","name":"Shrey"},{"code":"T2","name":"Street Heaven"}]'::jsonb, 'first screen lists both devices by name');
  perform test.ok(not c::text like '%Demo%' and not c::text like '%key%', 'demo outlet and keys are not listed');

  b := public.pos_bootstrap('test-key-two');
  perform test.ok((b->>'autoLogin')::boolean and b#>>'{device,name}' = 'Street Heaven', 'bootstrap says this device signs in without a PIN');

  l := public.pos_device_login('test-key-two');
  perform test.ok(l#>>'{staff,name}' = 'Shrey' and l#>>'{staff,role}' = 'owner', 'device key signs straight in as the owner');
  ses := (l->>'session')::uuid;
  outlet := (l->>'outletId')::uuid;
  perform test.ok(public.pos_device_login('nope')->>'error' = 'no_device', 'wrong key is refused');
  perform test.ok(public.pos_current_day(ses) is null, 'device session works for billing');

  -- admin panel with the same device session
  me := public.admin_me(ses);
  perform test.ok(me#>>'{outlets,0,name}' = 'Street Heaven', 'admin opens with the device session');
  m := public.admin_menu(outlet, ses);
  perform test.ok(jsonb_array_length(m->'variants') = 66, 'admin menu loads with the device session');
  perform public.admin_save_variant(outlet, (m#>>'{variants,0,id}')::uuid, (m#>>'{variants,0,itemId}')::uuid,
                                    m#>>'{variants,0,name}', 1, true, (m#>>'{variants,0,pricePaise}')::int, 2500, ses);
  perform test.ok(exists (select 1 from jsonb_array_elements(public.admin_menu(outlet, ses)->'variants') v
                          where v->>'id' = m#>>'{variants,0,id}' and (v->>'costPaise')::int = 2500),
                  'admin can enter a cost with the device session');
  f := public.admin_facts(outlet, current_date - 7, current_date, ses);
  perform test.ok(f ? 'orders', 'dashboard facts load with the device session');
  perform test.expect_error(format('select public.admin_menu(%L, %L)', test.id('outlet'), ses), 'not_allowed');
  perform test.ok(true, 'a device session cannot read another outlet');
  begin
    perform public.admin_menu(outlet);
    raise exception 'anon could call admin_menu without a session';
  exception when insufficient_privilege then
    perform test.ok(true, 'admin functions still need a session or email sign-in');
  end;
end $$;

-- a cashier (PIN) device session can't open the admin panel
reset role;
insert into public.staff (outlet_id, name, role, pin_hash)
select id, 'Helper', 'cashier', extensions.crypt('5555', extensions.gen_salt('bf')) from public.outlets where name = 'Street Heaven';
set role anon;
do $$
declare s jsonb;
begin
  s := public.pos_login('real-test-key', '5555');
  perform test.expect_error(format('select public.admin_me(%L::uuid)', s->>'session'), 'not_allowed');
  perform test.ok(true, 'cashier sessions cannot open the admin panel');
end $$;

-- wrong keys: after 10 in an hour, key entry pauses for everyone
reset role;
delete from public.device_key_failures;
set role anon;
do $$
begin
  for i in 1..10 loop perform public.pos_device_login('guess-' || i); end loop;
  perform test.expect_error($q$select public.pos_device_login('test-key-two')$q$, 'locked');
  perform test.ok(true, '10 wrong device keys pause key entry');
end $$;
reset role;
delete from public.device_key_failures;
