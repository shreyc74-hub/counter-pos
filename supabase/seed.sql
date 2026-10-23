-- Demo outlet for building and testing (D-220). Never mixed with the real outlet.
-- Device key for the counter app: demo-t1-key   PINs: Shrey 1234 (owner), Ramesh 1111, Sita 2222
-- Prices and costs are the placeholders from docs/menu.md.

create or replace function pg_temp.id(t text) returns uuid language sql immutable as $$ select md5('cpos:' || t)::uuid $$;

insert into public.outlets (id, name, address_line, phone, fssai_no, is_demo, cashier_discount_limit_paise)
values (pg_temp.id('outlet'), 'Demo Momo Corner', '[Address line, City]', '[PHONE]', '[14-DIGIT FSSAI]', true, 5000);

insert into public.devices (id, outlet_id, code, name, token_hash)
values (pg_temp.id('device-t1'), pg_temp.id('outlet'), 'T1', 'Counter tablet', public._hash_key('demo-t1-key'));

insert into public.staff (id, outlet_id, name, role, pin_hash) values
  (pg_temp.id('staff-shrey'), pg_temp.id('outlet'), 'Shrey', 'owner', extensions.crypt('1234', extensions.gen_salt('bf'))),
  (pg_temp.id('staff-ramesh'), pg_temp.id('outlet'), 'Ramesh', 'cashier', extensions.crypt('1111', extensions.gen_salt('bf'))),
  (pg_temp.id('staff-sita'), pg_temp.id('outlet'), 'Sita', 'cashier', extensions.crypt('2222', extensions.gen_salt('bf')));

insert into public.categories (id, outlet_id, name, sort) values
  (pg_temp.id('cat-momos'), pg_temp.id('outlet'), 'Momos', 1),
  (pg_temp.id('cat-chinese'), pg_temp.id('outlet'), 'Chinese', 2),
  (pg_temp.id('cat-drinks'), pg_temp.id('outlet'), 'Drinks', 3);

insert into public.items (id, outlet_id, category_id, name, batch_cooked, sort) values
  (pg_temp.id('it-veg-momos'), pg_temp.id('outlet'), pg_temp.id('cat-momos'), 'Veg Momos', true, 1),
  (pg_temp.id('it-chk-momos'), pg_temp.id('outlet'), pg_temp.id('cat-momos'), 'Chicken Momos', true, 2),
  (pg_temp.id('it-pan-momos'), pg_temp.id('outlet'), pg_temp.id('cat-momos'), 'Paneer Momos', true, 3),
  (pg_temp.id('it-veg-chow'), pg_temp.id('outlet'), pg_temp.id('cat-chinese'), 'Veg Chowmein', false, 1),
  (pg_temp.id('it-chilli-paneer'), pg_temp.id('outlet'), pg_temp.id('cat-chinese'), 'Chilli Paneer', false, 2),
  (pg_temp.id('it-cold-drink'), pg_temp.id('outlet'), pg_temp.id('cat-drinks'), 'Cold drink', false, 1);

-- variants: key, item, name, sort, price ₹, cost ₹ (null = not entered yet)
create temp table seed_variants (k text, item text, name text, sort int, price int, cost int);
insert into seed_variants values
  ('v-veg-stm-half', 'it-veg-momos', 'Steamed · Half', 1, 60, 24),
  ('v-veg-stm-full', 'it-veg-momos', 'Steamed · Full', 2, 100, 42),
  ('v-veg-fry-half', 'it-veg-momos', 'Fried · Half', 3, 70, 30),
  ('v-veg-fry-full', 'it-veg-momos', 'Fried · Full', 4, 120, 55),
  ('v-chk-stm-half', 'it-chk-momos', 'Steamed · Half', 1, 80, 40),
  ('v-chk-stm-full', 'it-chk-momos', 'Steamed · Full', 2, 130, 68),
  ('v-chk-fry-half', 'it-chk-momos', 'Fried · Half', 3, 90, 48),
  ('v-chk-fry-full', 'it-chk-momos', 'Fried · Full', 4, 150, 84),
  ('v-pan-stm-half', 'it-pan-momos', 'Steamed · Half', 1, 80, 35),
  ('v-pan-stm-full', 'it-pan-momos', 'Steamed · Full', 2, 130, 58),
  ('v-pan-fry-half', 'it-pan-momos', 'Fried · Half', 3, 90, 42),
  ('v-pan-fry-full', 'it-pan-momos', 'Fried · Full', 4, 150, 71),
  ('v-veg-chow-half', 'it-veg-chow', 'Half', 1, 60, 24),
  ('v-veg-chow-full', 'it-veg-chow', 'Full', 2, 100, 38),
  ('v-chilli-pan-dry', 'it-chilli-paneer', 'Dry', 1, 140, null),
  ('v-chilli-pan-gravy', 'it-chilli-paneer', 'Gravy', 2, 150, null),
  ('v-drink-250', 'it-cold-drink', '250 ml', 1, 25, 18),
  ('v-drink-500', 'it-cold-drink', '500 ml', 2, 40, 30);

insert into public.variants (id, outlet_id, item_id, name, sort)
select pg_temp.id(k), pg_temp.id('outlet'), pg_temp.id(item), name, sort from seed_variants;

insert into public.modifiers (id, outlet_id, name) values
  (pg_temp.id('mod-mayo'), pg_temp.id('outlet'), 'Extra mayo'),
  (pg_temp.id('mod-chutney'), pg_temp.id('outlet'), 'Extra chutney'),
  (pg_temp.id('mod-egg'), pg_temp.id('outlet'), 'Extra egg'),
  (pg_temp.id('mod-less-spicy'), pg_temp.id('outlet'), 'Less spicy'),
  (pg_temp.id('mod-no-onion'), pg_temp.id('outlet'), 'No onion');

insert into public.item_modifiers (item_id, modifier_id, sort)
select pg_temp.id(i), pg_temp.id(m), s
from (values
  ('it-veg-momos', 'mod-mayo', 1), ('it-veg-momos', 'mod-chutney', 2), ('it-veg-momos', 'mod-less-spicy', 3),
  ('it-chk-momos', 'mod-mayo', 1), ('it-chk-momos', 'mod-chutney', 2), ('it-chk-momos', 'mod-less-spicy', 3),
  ('it-pan-momos', 'mod-mayo', 1), ('it-pan-momos', 'mod-chutney', 2), ('it-pan-momos', 'mod-less-spicy', 3),
  ('it-veg-chow', 'mod-egg', 1), ('it-veg-chow', 'mod-less-spicy', 2), ('it-veg-chow', 'mod-no-onion', 3),
  ('it-chilli-paneer', 'mod-less-spicy', 1), ('it-chilli-paneer', 'mod-no-onion', 2)
) x(i, m, s);

insert into public.combos (id, outlet_id, name, description)
values (pg_temp.id('combo-1'), pg_temp.id('outlet'), 'Combo 1', 'Veg Stm Full + drink 250');
insert into public.combo_items (combo_id, variant_id, qty) values
  (pg_temp.id('combo-1'), pg_temp.id('v-veg-stm-full'), 1),
  (pg_temp.id('combo-1'), pg_temp.id('v-drink-250'), 1);

-- prices effective from before the demo history starts
insert into public.price_history (outlet_id, ref_kind, ref_id, price_paise, cost_paise, effective_from)
select pg_temp.id('outlet'), 'variant', pg_temp.id(k), price * 100, cost * 100, now() - interval '400 days' from seed_variants;
insert into public.price_history (outlet_id, ref_kind, ref_id, price_paise, cost_paise, effective_from) values
  (pg_temp.id('outlet'), 'combo', pg_temp.id('combo-1'), 11500, 6000, now() - interval '400 days'),
  (pg_temp.id('outlet'), 'modifier', pg_temp.id('mod-mayo'), 1000, 300, now() - interval '400 days'),
  (pg_temp.id('outlet'), 'modifier', pg_temp.id('mod-chutney'), 0, 100, now() - interval '400 days'),
  (pg_temp.id('outlet'), 'modifier', pg_temp.id('mod-egg'), 1500, 700, now() - interval '400 days'),
  (pg_temp.id('outlet'), 'modifier', pg_temp.id('mod-less-spicy'), 0, 0, now() - interval '400 days'),
  (pg_temp.id('outlet'), 'modifier', pg_temp.id('mod-no-onion'), 0, 0, now() - interval '400 days');

insert into public.favourites (outlet_id, ref_id, sort)
select pg_temp.id('outlet'), pg_temp.id(k), n
from unnest(array['v-veg-stm-full', 'v-veg-fry-full', 'v-chk-stm-full', 'v-chk-fry-full', 'v-pan-stm-full', 'v-pan-fry-full',
                  'v-veg-stm-half', 'v-veg-chow-full', 'v-chilli-pan-dry', 'v-drink-250', 'combo-1', 'v-drink-500'])
     with ordinality as f(k, n);

-- ---------------------------------------------------------------- 90 days of fake history
-- Planted patterns (the insights must find these):
--   evening peak 7–9 pm, weekends +30%, a few rain days +20%
--   drink add-on ~12%, combo ~8% of orders
--   Paneer Fried Full sells out on Fridays around 8:30 pm
--   Sita voids ~6% of her bills vs ~1.5% for Ramesh, and her days run cash-short
--   packaging spend rises ~30% over the last 30 days
--   ~15% of orders from Swiggy/Zomato

create or replace function pg_temp.generate_history(p_days int) returns void language plpgsql as $$
declare
  o_id uuid := pg_temp.id('outlet');
  dev uuid := pg_temp.id('device-t1');
  owner uuid := pg_temp.id('staff-shrey');
  hour_weights int[] := array[4, 14, 18, 10, 7, 9, 15, 24, 36, 33, 26, 18]; -- 11:00 .. 22:00
  -- [variant key, weight]
  picks text[] := array['v-veg-stm-full','v-veg-stm-full','v-veg-stm-full','v-veg-stm-full','v-veg-stm-full',
                        'v-chk-fry-full','v-chk-fry-full','v-chk-fry-full','v-chk-stm-full','v-chk-stm-full',
                        'v-veg-fry-full','v-veg-fry-full','v-pan-stm-full','v-pan-stm-full','v-pan-fry-full',
                        'v-veg-stm-half','v-veg-stm-half','v-chk-stm-half','v-pan-stm-half','v-veg-fry-half',
                        'v-veg-chow-full','v-veg-chow-full','v-veg-chow-half','v-chilli-pan-dry','v-chilli-pan-gravy'];
  seq int := 0;
  d date;
  day_id uuid;
  cashier uuid;
  dow int;
  factor numeric;
  n_orders int;
  h int;
  k int;
  tok int;
  t timestamptz;
  ord uuid;
  n_lines int;
  ln int;
  vkey text;
  pr public.price_history;
  sub int;
  disc int;
  total int;
  r numeric;
  cash_sales int;
  exp_cash int;
  expected int;
  pan_out_at timestamptz;
  pack_factor numeric;
  lid uuid;
begin
  perform setseed(0.42);
  for i in reverse p_days..1 loop
    d := (now() at time zone 'Asia/Kolkata')::date - i;
    dow := extract(isodow from d);
    cashier := case when (i % 3) = 0 then pg_temp.id('staff-sita') else pg_temp.id('staff-ramesh') end;
    factor := case when dow in (5, 6, 7) then 1.3 when dow = 1 then 0.85 else 1.0 end
              * (case when random() < 0.06 then 1.2 else 1.0 end) * (0.88 + random() * 0.24);
    day_id := gen_random_uuid();
    insert into public.day_sessions (id, outlet_id, business_date, opened_at, opened_by, opening_float_paise)
    values (day_id, o_id, d, (d + time '11:00') at time zone 'Asia/Kolkata', owner, 100000);
    tok := 0;
    pan_out_at := case when dow = 5 then (d + time '20:30') at time zone 'Asia/Kolkata' + (random() * interval '15 minutes') end;
    if pan_out_at is not null then
      insert into public.stock_outs (outlet_id, ref_id, marked_out_at, marked_out_by, marked_in_at, marked_in_by)
      values (o_id, pg_temp.id('v-pan-fry-full'), pan_out_at, cashier, (d + time '23:00') at time zone 'Asia/Kolkata', owner);
    end if;

    for hi in 1..12 loop
      h := 10 + hi;
      n_orders := round(hour_weights[hi] * factor * (0.8 + random() * 0.4));
      for k in 1..n_orders loop
        t := (d + make_time(h, 0, 0)) at time zone 'Asia/Kolkata' + random() * interval '59 minutes';
        seq := seq + 1;
        tok := tok + 1;
        ord := gen_random_uuid();
        insert into public.orders (id, outlet_id, device_id, bill_no, bill_seq, token, staff_id, day_session_id, channel,
                                   external_order_id, subtotal_paise, discount_paise, total_paise, menu_version, client_created_at, received_at)
        values (ord, o_id, dev, 'T1-' || lpad(seq::text, 6, '0'), seq, tok, cashier, day_id, 'counter', null, 0, 0, 0, 1, t, t);
        sub := 0;
        n_lines := 1 + (random() < 0.35)::int + (random() < 0.08)::int;
        for ln in 1..n_lines loop
          if random() < 0.08 and ln = 1 then
            vkey := 'combo-1';
          else
            vkey := picks[1 + floor(random() * array_length(picks, 1))::int];
            if vkey = 'v-pan-fry-full' and pan_out_at is not null and t > pan_out_at then vkey := 'v-pan-stm-full'; end if;
          end if;
          pr := public._price(pg_temp.id(vkey));
          insert into public.order_lines (order_id, line_no, kind, ref_id, name, qty, unit_price_paise, unit_cost_paise, line_total_paise)
          select ord, ln, case when vkey like 'combo%' then 'combo' else 'variant' end, pg_temp.id(vkey),
                 coalesce((select i.name || ' ' || replace(v.name, ' · ', ' ') from public.variants v join public.items i on i.id = v.item_id
                           where v.id = pg_temp.id(vkey)), 'Combo 1'),
                 1, pr.price_paise, pr.cost_paise, pr.price_paise
          returning id into lid;
          sub := sub + pr.price_paise;
        end loop;
        -- drink add-on ~12% (on top of combos)
        if random() < 0.12 then
          pr := public._price(pg_temp.id('v-drink-250'));
          insert into public.order_lines (order_id, line_no, kind, ref_id, name, qty, unit_price_paise, unit_cost_paise, line_total_paise)
          values (ord, n_lines + 1, 'variant', pg_temp.id('v-drink-250'), 'Cold drink 250 ml', 1, pr.price_paise, pr.cost_paise, pr.price_paise);
          sub := sub + pr.price_paise;
        end if;
        disc := case when random() < 0.05 then 1000 else 0 end;
        total := sub - disc;
        perform pg_temp.set_order_totals(ord, sub, disc, total,
          case when random() < 0.15 then (array['swiggy', 'zomato'])[1 + (random() < 0.5)::int] else 'counter' end);
        r := random();
        if r < 0.63 then
          insert into public.payments (order_id, method, amount_paise) values (ord, 'upi', total);
        elsif r < 0.96 or total < 2000 then
          insert into public.payments (order_id, method, amount_paise) values (ord, 'cash', total);
        else
          insert into public.payments (order_id, method, amount_paise) values (ord, 'cash', 1000), (ord, 'upi', total - 1000);
        end if;
        if random() < (case when cashier = pg_temp.id('staff-sita') then 0.06 else 0.015 end) then
          insert into public.order_voids (order_id, reason, staff_id, approved_by, created_at)
          values (ord, (array['Customer changed mind', 'Wrong item entered', 'Customer changed mind'])[1 + floor(random() * 3)::int],
                  cashier, owner, t + interval '3 minutes');
        end if;
      end loop;
    end loop;

    -- money out
    pack_factor := case when i <= 30 then 1.3 else 1.0 end;
    insert into public.expenses (outlet_id, day_session_id, category, amount_paise, method, note, staff_id, created_at) values
      (o_id, day_id, 'ingredients', (120000 + floor(random() * 80000))::int, 'cash', 'Vegetables, flour, chicken', cashier, (d + time '10:45') at time zone 'Asia/Kolkata'),
      (o_id, day_id, 'packaging', round((40000 + floor(random() * 15000)) * pack_factor)::int, 'cash', 'Boxes and bags', cashier, (d + time '17:30') at time zone 'Asia/Kolkata');
    if i % 4 = 0 then
      insert into public.expenses (outlet_id, day_session_id, category, amount_paise, method, note, staff_id, created_at)
      values (o_id, day_id, 'gas', 110000, 'upi', 'Cylinder', owner, (d + time '13:15') at time zone 'Asia/Kolkata');
    end if;

    -- close the day
    select coalesce(sum(p.amount_paise), 0) into cash_sales
    from public.payments p join public.orders o on o.id = p.order_id
    where o.day_session_id = day_id and p.method = 'cash' and not exists (select 1 from public.order_voids v where v.order_id = o.id);
    select coalesce(sum(amount_paise), 0) into exp_cash from public.expenses where day_session_id = day_id and method = 'cash';
    expected := 100000 + cash_sales - exp_cash;
    update public.day_sessions
      set closed_at = (d + time '22:50') at time zone 'Asia/Kolkata', closed_by = owner, expected_cash_paise = expected,
          counted_cash_paise = expected + case when cashier = pg_temp.id('staff-sita') and random() < 0.5
                                               then -(10000 + floor(random() * 40000))::int
                                               when random() < 0.1 then -5000 else 0 end
      where id = day_id;
    update public.day_sessions set variance_paise = counted_cash_paise - expected_cash_paise where id = day_id and variance_paise is null;
    if random() < 0.6 then
      insert into public.leftovers (day_session_id, variant_id, plates)
      select day_id, pg_temp.id(v), 1 + floor(random() * 4)::int
      from unnest(array['v-veg-stm-full', 'v-chk-stm-full', 'v-pan-stm-full']) v where random() < 0.6;
    end if;
  end loop;
  update public.devices set last_bill_seq = seq where id = dev;
end $$;

-- Seed-only helper: orders are append-only, so totals are written by briefly lifting the
-- guard for this bulk load. The app itself never does this (pos_submit_order writes once).
create or replace function pg_temp.set_order_totals(p_order uuid, p_sub int, p_disc int, p_total int, p_channel text)
returns void language plpgsql as $$
begin
  update public.orders
    set subtotal_paise = p_sub, discount_paise = p_disc, total_paise = p_total,
        discount_reason = case when p_disc > 0 then 'Staff meal' end,
        channel = p_channel,
        external_order_id = case when p_channel <> 'counter' then upper(left(p_channel, 2)) || floor(random() * 1e8)::text end
    where id = p_order;
end $$;

alter table public.orders disable trigger orders_append_only;
alter table public.day_sessions disable trigger day_sessions_guard;
select pg_temp.generate_history(90);
alter table public.orders enable trigger orders_append_only;
alter table public.day_sessions enable trigger day_sessions_guard;
