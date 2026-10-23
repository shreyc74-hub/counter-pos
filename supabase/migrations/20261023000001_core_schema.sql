-- Core schema for the counter POS.
-- Money is integer paise. Financial records are append-only (enforced below).
-- Every table carries outlet_id so more outlets can be added later.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- setup

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line text not null default '',
  phone text not null default '',
  fssai_no text not null default '',
  receipt_footer text not null default 'Thank you! Visit again',
  timezone text not null default 'Asia/Kolkata',
  is_demo boolean not null default false,
  cashier_discount_limit_paise integer not null default 5000 check (cashier_discount_limit_paise >= 0),
  menu_version integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  code text not null check (code ~ '^[A-Z][A-Z0-9]{0,3}$'),
  name text not null default '',
  -- sha256 of the device key the tablet stores; the key itself is never kept
  token_hash text not null unique,
  last_bill_seq integer not null default 0,
  failed_pin_attempts integer not null default 0,
  pin_locked_until timestamptz,
  last_seen_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (outlet_id, code)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  name text not null,
  role text not null check (role in ('owner', 'cashier')),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff_sessions (
  token uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  device_id uuid not null references public.devices(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '16 hours',
  ended_at timestamptz
);

-- Short-lived, single-use owner approvals (e.g. a discount above the cashier limit).
create table public.owner_approvals (
  token uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.staff(id),
  device_id uuid not null references public.devices(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz
);

-- Supabase Auth users who own an outlet (for the admin panel).
create table public.outlet_owners (
  outlet_id uuid not null references public.outlets(id),
  user_id uuid not null,
  primary key (outlet_id, user_id)
);

-- ---------------------------------------------------------------- menu

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  name text not null,
  sort integer not null default 0,
  active boolean not null default true
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  category_id uuid not null references public.categories(id),
  name text not null,
  batch_cooked boolean not null default false,
  sort integer not null default 0,
  active boolean not null default true
);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  item_id uuid not null references public.items(id),
  name text not null,
  sort integer not null default 0,
  active boolean not null default true
);

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  name text not null,
  active boolean not null default true
);

create table public.item_modifiers (
  item_id uuid not null references public.items(id),
  modifier_id uuid not null references public.modifiers(id),
  sort integer not null default 0,
  primary key (item_id, modifier_id)
);

create table public.combos (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  name text not null,
  description text not null default '',
  active boolean not null default true
);

create table public.combo_items (
  combo_id uuid not null references public.combos(id),
  variant_id uuid not null references public.variants(id),
  qty integer not null default 1 check (qty > 0),
  primary key (combo_id, variant_id)
);

-- Effective-dated price and cost for a variant, combo or modifier. Never updated:
-- a change is a new row, so old bills and old margins stay correct.
create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  ref_kind text not null check (ref_kind in ('variant', 'combo', 'modifier')),
  ref_id uuid not null,
  price_paise integer not null check (price_paise >= 0),
  cost_paise integer check (cost_paise is null or cost_paise >= 0),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index price_history_ref on public.price_history (ref_id, effective_from desc);

create table public.favourites (
  outlet_id uuid not null references public.outlets(id),
  ref_id uuid not null,
  sort integer not null default 0,
  primary key (outlet_id, ref_id)
);

-- One row per "marked sold out" period. Logged with times so forecasts know demand was cut short.
create table public.stock_outs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  ref_id uuid not null,
  marked_out_at timestamptz not null default now(),
  marked_out_by uuid not null references public.staff(id),
  marked_in_at timestamptz,
  marked_in_by uuid references public.staff(id)
);
create unique index stock_outs_open on public.stock_outs (outlet_id, ref_id) where marked_in_at is null;

-- ---------------------------------------------------------------- day

create table public.day_sessions (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  business_date date not null,
  opened_at timestamptz not null default now(),
  opened_by uuid not null references public.staff(id),
  opening_float_paise integer not null check (opening_float_paise >= 0),
  closed_at timestamptz,
  closed_by uuid references public.staff(id),
  expected_cash_paise integer,
  counted_cash_paise integer,
  variance_paise integer
);
-- At most one open day per outlet.
create unique index day_sessions_one_open on public.day_sessions (outlet_id) where closed_at is null;

create table public.leftovers (
  day_session_id uuid not null references public.day_sessions(id),
  variant_id uuid not null references public.variants(id),
  plates integer not null check (plates > 0),
  primary key (day_session_id, variant_id)
);

-- ---------------------------------------------------------------- sales

create table public.orders (
  id uuid primary key, -- generated on the device: resubmitting never duplicates
  outlet_id uuid not null references public.outlets(id),
  device_id uuid not null references public.devices(id),
  bill_no text not null,
  bill_seq integer not null,
  token integer not null check (token > 0),
  staff_id uuid not null references public.staff(id),
  day_session_id uuid not null references public.day_sessions(id),
  channel text not null check (channel in ('counter', 'swiggy', 'zomato', 'phone')),
  external_order_id text,
  note text,
  subtotal_paise integer not null check (subtotal_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  discount_reason text,
  discount_approved_by uuid references public.staff(id),
  total_paise integer not null check (total_paise >= 0),
  menu_version integer not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (outlet_id, bill_no),
  check (total_paise = subtotal_paise - discount_paise),
  check (discount_paise = 0 or discount_reason is not null)
);
create index orders_day on public.orders (day_session_id, client_created_at);
create index orders_outlet_time on public.orders (outlet_id, client_created_at);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  line_no integer not null,
  kind text not null check (kind in ('variant', 'combo')),
  ref_id uuid not null,
  name text not null,
  qty integer not null check (qty > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  unit_cost_paise integer, -- snapshot at time of sale (null if no cost entered yet)
  line_total_paise integer not null check (line_total_paise >= 0),
  unique (order_id, line_no)
);
create index order_lines_ref on public.order_lines (ref_id);

create table public.order_line_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references public.order_lines(id),
  modifier_id uuid not null references public.modifiers(id),
  name text not null,
  price_paise integer not null check (price_paise >= 0),
  cost_paise integer
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  method text not null check (method in ('cash', 'upi')),
  amount_paise integer not null check (amount_paise > 0),
  cash_received_paise integer check (cash_received_paise is null or (method = 'cash' and cash_received_paise >= amount_paise))
);
create index payments_order on public.payments (order_id);

-- A void is a separate record; the order itself is never changed.
create table public.order_voids (
  order_id uuid primary key references public.orders(id),
  reason text not null check (length(trim(reason)) > 0),
  staff_id uuid not null references public.staff(id),
  approved_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- money out

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  day_session_id uuid not null references public.day_sessions(id),
  category text not null check (category in ('ingredients', 'packaging', 'gas', 'rent', 'salary', 'electricity', 'maintenance', 'other')),
  amount_paise integer not null check (amount_paise > 0),
  method text not null check (method in ('cash', 'upi')),
  note text,
  staff_id uuid not null references public.staff(id),
  created_at timestamptz not null default now()
);
create index expenses_day on public.expenses (day_session_id);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  day_session_id uuid not null references public.day_sessions(id),
  direction text not null check (direction in ('in', 'out')),
  amount_paise integer not null check (amount_paise > 0),
  reason text not null check (length(trim(reason)) > 0),
  staff_id uuid not null references public.staff(id),
  created_at timestamptz not null default now()
);
create index cash_movements_day on public.cash_movements (day_session_id);

-- ---------------------------------------------------------------- audit

create table public.events (
  id bigint generated always as identity primary key,
  outlet_id uuid not null references public.outlets(id),
  type text not null,
  entity_id uuid,
  staff_id uuid references public.staff(id),
  device_id uuid references public.devices(id),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_outlet_time on public.events (outlet_id, created_at);

-- ---------------------------------------------------------------- append-only rules

create function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% rows cannot be changed or deleted (append-only)', tg_table_name
    using errcode = 'P0001', hint = 'not_allowed';
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'orders', 'order_lines', 'order_line_modifiers', 'payments', 'order_voids',
    'expenses', 'cash_movements', 'events', 'price_history', 'leftovers'
  ] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.forbid_change()',
      t || '_append_only', t);
  end loop;
end $$;

-- A day can be closed once; after that it is frozen.
create function public.day_sessions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.closed_at is not null then
    raise exception 'A closed day cannot be changed' using errcode = 'P0001', hint = 'not_allowed';
  end if;
  if new.opened_at <> old.opened_at or new.opening_float_paise <> old.opening_float_paise
     or new.opened_by <> old.opened_by or new.business_date <> old.business_date then
    raise exception 'Opening details cannot be changed' using errcode = 'P0001', hint = 'not_allowed';
  end if;
  return new;
end $$;
create trigger day_sessions_guard before update or delete on public.day_sessions
  for each row execute function public.day_sessions_guard();

-- ---------------------------------------------------------------- row level security
-- The counter never touches tables directly: it calls the pos_* functions, which check
-- the device key and staff session. Owners signed in to the admin panel can read
-- their own outlet's data.

do $$
declare t text;
begin
  foreach t in array array[
    'outlets', 'devices', 'staff', 'staff_sessions', 'owner_approvals', 'outlet_owners',
    'categories', 'items', 'variants', 'modifiers', 'item_modifiers', 'combos', 'combo_items',
    'price_history', 'favourites', 'stock_outs', 'day_sessions', 'leftovers', 'orders',
    'order_lines', 'order_line_modifiers', 'payments', 'order_voids', 'expenses',
    'cash_movements', 'events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

create function public.is_outlet_owner(p_outlet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.outlet_owners where outlet_id = p_outlet and user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'outlets', 'devices', 'categories', 'items', 'variants', 'modifiers', 'combos',
    'price_history', 'favourites', 'stock_outs', 'day_sessions', 'orders', 'expenses',
    'cash_movements', 'events'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy owner_read on public.%I for select to authenticated using (public.is_outlet_owner(%s))',
      t, case when t = 'outlets' then 'id' else 'outlet_id' end);
  end loop;
end $$;
