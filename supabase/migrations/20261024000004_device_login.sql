-- Device sign-in for a one-person outlet, and admin access with the same device. Safe to run again.
--
-- * A device can be linked to a staff member (auto_staff_id). Entering that device's key
--   signs straight in as them: no PIN step. Used when one person does all the billing.
-- * The first screen lists the outlet's devices by name (pos_device_choices) so the user
--   taps theirs and types its key.
-- * Wrong device keys are throttled for everyone: after 10 wrong keys in an hour, key
--   entry pauses until the hour has passed. Short keys can't be guessed over the internet.
-- * The admin panel can use a device session (owner devices only) instead of email sign-in:
--   every admin_* function gets an overload with p_session.

alter table public.devices add column if not exists auto_staff_id uuid references public.staff(id);

create table if not exists public.device_key_failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);
alter table public.device_key_failures enable row level security;
revoke all on public.device_key_failures from anon, authenticated;

-- Looks up a device by key. Wrong keys are recorded and return null (no exception,
-- so the record isn't rolled back); callers turn null into a 'no_device' answer.
create or replace function public._device(p_device_key text) returns public.devices
language plpgsql security definer set search_path = public, extensions as $$
declare d public.devices;
begin
  if (select count(*) from public.device_key_failures where at > now() - interval '1 hour') >= 10 then
    perform public._fail('Too many wrong device keys. Key entry is paused for up to an hour.', 'locked');
  end if;
  select * into d from public.devices where token_hash = public._hash_key(p_device_key) and active;
  if not found then
    insert into public.device_key_failures default values;
    delete from public.device_key_failures where at < now() - interval '1 day';
    return null;
  end if;
  update public.devices set last_seen_at = now() where id = d.id;
  return d;
end $$;

create or replace function public.pos_bootstrap(p_device_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.devices;
  o public.outlets;
begin
  d := public._device(p_device_key);
  if d.id is null then
    return jsonb_build_object('error', 'no_device');
  end if;
  select * into o from public.outlets where id = d.outlet_id;
  return jsonb_build_object(
    'outlet', jsonb_build_object(
      'id', o.id, 'name', o.name, 'addressLine', o.address_line, 'phone', o.phone,
      'fssaiNo', o.fssai_no, 'receiptFooter', o.receipt_footer, 'isDemo', o.is_demo,
      'cashierDiscountLimitPaise', o.cashier_discount_limit_paise),
    'device', jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name),
    'autoLogin', d.auto_staff_id is not null,
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

create or replace function public.pos_login(p_device_key text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.devices;
  s public.staff;
  tok uuid;
begin
  d := public._device(p_device_key);
  if d.id is null then
    return jsonb_build_object('error', 'no_device');
  end if;
  s := public._check_pin(d, p_pin, false);
  if s.id is null then
    return null;
  end if;
  insert into public.staff_sessions (staff_id, device_id) values (s.id, d.id) returning token into tok;
  perform public._log(d.outlet_id, 'login', s.id, s.id, d.id);
  return jsonb_build_object('session', tok, 'staff', jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role));
end $$;

-- Device names for the first screen (real outlets only; no keys, no ids).
create or replace function public.pos_device_choices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'name', coalesce(nullif(d.name, ''), d.code), 'outlet', o.name)
                            order by o.name, d.code), '[]'::jsonb)
  from public.devices d join public.outlets o on o.id = d.outlet_id
  where d.active and not o.is_demo;
$$;

-- Sign in with just the device key, for devices linked to a staff member.
create or replace function public.pos_device_login(p_device_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.devices;
  s public.staff;
  tok uuid;
begin
  d := public._device(p_device_key);
  if d.id is null then return jsonb_build_object('error', 'no_device'); end if;
  if d.auto_staff_id is null then return jsonb_build_object('error', 'pin_required'); end if;
  select * into s from public.staff where id = d.auto_staff_id and active;
  if not found then return jsonb_build_object('error', 'pin_required'); end if;
  insert into public.staff_sessions (staff_id, device_id) values (s.id, d.id) returning token into tok;
  perform public._log(d.outlet_id, 'login', s.id, s.id, d.id, jsonb_build_object('by', 'device_key'));
  return jsonb_build_object('session', tok, 'staff', jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role),
                            'outletId', d.outlet_id, 'device', jsonb_build_object('code', d.code, 'name', d.name));
end $$;

-- ---------------------------------------------------------------- admin with a device session

-- Marks this request as made by an owner's device session (checked by _require_owner).
create or replace function public._use_admin_session(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ses public.pos_session;
begin
  ses := public._session(p_session);
  if ses.role <> 'owner' then
    perform public._fail('Only the owner can open the admin panel.', 'not_allowed');
  end if;
  perform set_config('pos.admin_outlet', ses.outlet_id::text, true);
end $$;

create or replace function public._require_owner(p_outlet uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if nullif(current_setting('pos.admin_outlet', true), '') is not null then
    if current_setting('pos.admin_outlet', true)::uuid is distinct from p_outlet then
      perform public._fail('This device belongs to a different outlet.', 'not_allowed');
    end if;
    return;
  end if;
  if auth.uid() is null then
    perform public._fail('Please sign in.', 'no_session');
  end if;
  if not public.is_outlet_owner(p_outlet) then
    perform public._fail('You are not an owner of this outlet.', 'not_allowed');
  end if;
end $$;

-- admin_me for a device session: the session's outlet.
create or replace function public.admin_me(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  perform public._use_admin_session(p_session);
  o := current_setting('pos.admin_outlet', true)::uuid;
  return jsonb_build_object(
    'email', null,
    'outlets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'addressLine', x.address_line, 'phone', x.phone, 'fssaiNo', x.fssai_no,
        'receiptFooter', x.receipt_footer, 'isDemo', x.is_demo, 'cashierDiscountLimitPaise', x.cashier_discount_limit_paise))
      from public.outlets x where x.id = o), '[]'::jsonb));
end $$;


create or replace function public.admin_menu(p_outlet uuid, p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_menu(p_outlet);
end $$;

create or replace function public.admin_price_history(p_outlet uuid, p_ref uuid, p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_price_history(p_outlet, p_ref);
end $$;

create or replace function public.admin_save_category(p_outlet uuid, p_id uuid, p_name text, p_sort integer, p_active boolean, p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_save_category(p_outlet, p_id, p_name, p_sort, p_active);
end $$;

create or replace function public.admin_save_item(p_outlet uuid, p_id uuid, p_category uuid, p_name text, p_batch_cooked boolean, p_sort integer, p_active boolean, p_modifier_ids uuid[], p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_save_item(p_outlet, p_id, p_category, p_name, p_batch_cooked, p_sort, p_active, p_modifier_ids);
end $$;

create or replace function public.admin_save_variant(p_outlet uuid, p_id uuid, p_item uuid, p_name text, p_sort integer, p_active boolean, p_price_paise integer, p_cost_paise integer, p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_save_variant(p_outlet, p_id, p_item, p_name, p_sort, p_active, p_price_paise, p_cost_paise);
end $$;

create or replace function public.admin_save_modifier(p_outlet uuid, p_id uuid, p_name text, p_active boolean, p_price_paise integer, p_cost_paise integer, p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_save_modifier(p_outlet, p_id, p_name, p_active, p_price_paise, p_cost_paise);
end $$;

create or replace function public.admin_save_combo(p_outlet uuid, p_id uuid, p_name text, p_description text, p_active boolean, p_price_paise integer, p_cost_paise integer, p_parts jsonb, p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_save_combo(p_outlet, p_id, p_name, p_description, p_active, p_price_paise, p_cost_paise, p_parts);
end $$;

create or replace function public.admin_set_favourites(p_outlet uuid, p_ids uuid[], p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  perform public.admin_set_favourites(p_outlet, p_ids);
end $$;

create or replace function public.admin_facts(p_outlet uuid, p_from date, p_to date, p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._use_admin_session(p_session);
  return public.admin_facts(p_outlet, p_from, p_to);
end $$;

-- ---------------------------------------------------------------- permissions

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'pos\_%' or p.proname like 'admin\_%' or p.proname like '\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'pos\_%' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    elsif f.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
      -- the device-session versions are callable from the app without email sign-in
      if f.args like '%p_session uuid%' then
        execute format('grant execute on function %s to anon', f.sig);
      end if;
    end if;
  end loop;
end $$;
