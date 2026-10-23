-- Admin API tests: owner sign-in linking, menu edits with price history, dashboard facts.
-- Runs after 01_counter_api.test.sql (which creates the test schema and helpers).

update public.outlets set owner_email = 'Owner@Example.com' where id = test.id('outlet');
grant execute on function test.expect_error(text, text), test.ok(boolean, text), test.id(text) to authenticated;
grant usage on schema test to authenticated;

set role authenticated;

-- not signed in
select set_config('request.jwt.claims', '', false) \g /dev/null
select test.expect_error('select public.admin_me()', 'no_session');

-- a stranger sees nothing
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","email":"someone@else.com"}', false) \g /dev/null
do $$
begin
  perform test.ok(jsonb_array_length(public.admin_me()->'outlets') = 0, 'a stranger owns no outlets');
  perform test.expect_error(format('select public.admin_menu(%L)', test.id('outlet')), 'not_allowed');
  perform test.expect_error(format('select public.admin_facts(%L, current_date - 7, current_date)', test.id('outlet')), 'not_allowed');
  begin
    perform 1 from public.orders limit 1;
    perform test.ok((select count(*) from public.orders) = 0, 'a stranger reads no orders through row security');
  end;
end $$;

-- the owner, matched by email on first sign-in
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","email":"owner@example.com"}', false) \g /dev/null
do $$
declare me jsonb; menu jsonb; vid uuid; iid uuid; cid uuid; hist jsonb; f jsonb; b jsonb;
begin
  me := public.admin_me();
  perform test.ok(me#>>'{outlets,0,name}' = 'Demo Momo Corner', 'owner is linked to the outlet by email');
  perform test.ok((select count(*) from public.orders) > 15000, 'owner can read their outlet''s orders');

  menu := public.admin_menu(test.id('outlet'));
  perform test.ok(exists (select 1 from jsonb_array_elements(menu->'variants') v
                          where v->>'id' = test.id('v-veg-stm-full')::text and (v->>'costPaise')::int = 4200),
                  'admin menu includes costs');

  -- change a price: new history row, menu version goes up, counter sees the new price
  perform public.admin_save_variant(test.id('outlet'), test.id('v-veg-stm-full'), test.id('it-veg-momos'),
                                    'Steamed · Full', 2, true, 11000, 4500);
  perform public.admin_save_variant(test.id('outlet'), test.id('v-veg-stm-full'), test.id('it-veg-momos'),
                                    'Steamed · Full', 2, true, 11000, 4500);
  hist := public.admin_price_history(test.id('outlet'), test.id('v-veg-stm-full'));
  perform test.ok(jsonb_array_length(hist) = 2, 'a price change adds one history row (saving unchanged adds none)');
  perform test.ok((hist->0->>'pricePaise')::int = 11000 and (hist->1->>'pricePaise')::int = 10000, 'old price kept in history');
  perform test.ok((public.admin_menu(test.id('outlet'))->>'version')::int > (menu->>'version')::int, 'menu version goes up');

  -- add a category, item, size and combo
  cid := public.admin_save_category(test.id('outlet'), null, 'Soups', 4, true);
  iid := public.admin_save_item(test.id('outlet'), null, cid, 'Hot & Sour Soup', false, 1, true, array[test.id('mod-less-spicy')]);
  vid := public.admin_save_variant(test.id('outlet'), null, iid, 'Regular', 1, true, 8000, null);
  perform public.admin_save_combo(test.id('outlet'), null, 'Soup combo', 'Soup + Veg Stm Half', true, 12500, null,
    jsonb_build_array(jsonb_build_object('variantId', vid, 'qty', 1), jsonb_build_object('variantId', test.id('v-veg-stm-half'), 'qty', 1)));
  perform test.expect_error(format('select public.admin_save_variant(%L, null, %L, %L, 1, true, -5, null)',
                                   test.id('outlet'), iid, 'Bad'), 'invalid');
  perform public.admin_set_favourites(test.id('outlet'), array[vid, test.id('v-veg-stm-full'), vid]);

  reset role;
  b := public.pos_bootstrap('demo-t1-key');
  perform test.ok(exists (select 1 from jsonb_array_elements(b#>'{menu,variants}') v where v->>'id' = vid::text and (v->>'pricePaise')::int = 8000),
                  'new item reaches the counter');
  perform test.ok((b#>'{menu,favourites}') = to_jsonb(array[vid, test.id('v-veg-stm-full')]), 'favourites saved in order without duplicates');
  perform test.ok(exists (select 1 from jsonb_array_elements(b#>'{menu,variants}') v
                          where v->>'id' = test.id('v-veg-stm-full')::text and (v->>'pricePaise')::int = 11000), 'counter sees the new price');
  set role authenticated;

  -- dashboard facts
  f := public.admin_facts(test.id('outlet'), current_date - 7, current_date);
  perform test.ok(jsonb_array_length(f->'days') between 7 and 9, 'facts: days in range');
  perform test.ok(jsonb_array_length(f->'orders') > 1000, 'facts: orders in range');
  perform test.ok(jsonb_array_length(f->'orders'->0) = 13, 'facts: compact order rows');
  perform test.ok((select bool_and((o->>7)::int = (o->>8)::int + (o->>9)::int) from jsonb_array_elements(f->'orders') o),
                  'facts: cash + UPI = total on every bill');
  perform test.expect_error(format('select public.admin_facts(%L, current_date, current_date - 1)', test.id('outlet')), 'invalid');
end $$;

-- the counter (anon) cannot call admin functions
reset role;
set role anon;
do $$
begin
  begin
    perform public.admin_me();
    raise exception 'anon could call admin_me';
  exception when insufficient_privilege then
    perform test.ok(true, 'the counter cannot call admin functions');
  end;
end $$;
reset role;
