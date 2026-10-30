-- The real-outlet setup script loads cleanly next to the demo outlet and gives the
-- counter the full Street Heaven menu (no fake data, no costs).
\i supabase/setup/street-heaven.sql

insert into public.devices (outlet_id, code, name, token_hash)
select id, 'T1', 'Counter tablet', public._hash_key('real-test-key') from public.outlets where name = 'Street Heaven';
insert into public.staff (outlet_id, name, role, pin_hash)
select id, 'Shrey', 'owner', extensions.crypt('4321', extensions.gen_salt('bf')) from public.outlets where name = 'Street Heaven';

set role anon;
do $$
declare b jsonb; s jsonb;
begin
  b := public.pos_bootstrap('real-test-key');
  perform test.ok(b#>>'{outlet,name}' = 'Street Heaven' and (b#>>'{outlet,isDemo}')::boolean = false, 'real outlet is not a demo');
  perform test.ok(jsonb_array_length(b#>'{menu,variants}') = 66, 'real outlet has all 66 menu options');
  perform test.ok(jsonb_array_length(b#>'{menu,categories}') = 9 and jsonb_array_length(b#>'{menu,items}') = 33, 'real outlet: 9 sections, 33 dishes');
  perform test.ok(b#>>'{menu,categories,0,name}' = 'Momo' and b#>>'{menu,categories,8,name}' = 'New Entries', 'sections in the same order as the old POS');
  perform test.ok(exists (select 1 from jsonb_array_elements(b#>'{menu,items}') i join jsonb_array_elements(b#>'{menu,variants}') v on v->>'itemId' = i->>'id'
                          where i->>'name' = 'Paneer Gravy' and v->>'name' = 'Full' and (v->>'pricePaise')::int = 16000), 'Paneer Gravy Full is ₹160');
  s := public.pos_login('real-test-key', '4321');
  perform test.ok(s#>>'{staff,name}' = 'Shrey', 'real outlet staff can log in');
  perform test.ok(public.pos_login('real-test-key', '1234') is null, 'demo PINs do not work on the real outlet');
  perform test.ok(public.pos_current_day((s->>'session')::uuid) is null, 'real outlet starts with no history');
end $$;
reset role;

do $$
begin
  perform test.ok(not exists (select 1 from public.price_history p join public.outlets o on o.id = p.outlet_id
                              where o.name = 'Street Heaven' and p.cost_paise is not null), 'real outlet costs are left for Shrey to enter');
end $$;
