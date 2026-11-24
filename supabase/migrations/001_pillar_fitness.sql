-- =====================================================================
-- PILLAR FITNESS - gym management database (Supabase / PostgreSQL)
-- Run this whole file once in: Supabase dashboard > SQL Editor > New query
-- Use a NEW Supabase project made for this gym.
-- =====================================================================

-- ---------- helpers ----------------------------------------------------
create or replace function public.gym_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- keeps only the 10 digit Indian mobile number (drops +91 / 91 / 0 prefix)
create or replace function public.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 12 and left(d, 2) = '91' then d := right(d, 10);
  elsif length(d) = 11 and left(d, 1) = '0' then d := right(d, 10);
  end if;
  return d;
end $$;

-- ---------- staff ------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  role        text not null default 'none' check (role in ('owner', 'receptionist', 'none')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  full_name   text,
  email       text,
  phone       text,
  role        text not null default 'receptionist' check (role in ('owner', 'receptionist')),
  claimed_by  uuid references auth.users(id) on delete set null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  check (email is not null or phone is not null)
);

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('owner', 'receptionist'), false)
$$;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'owner', false)
$$;

-- New sign-ups get NO access unless the owner invited their mobile/email.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_inv   public.staff_invites%rowtype;
  v_phone text := public.normalize_phone(new.phone);
  v_role  text := 'none';
begin
  select * into v_inv from public.staff_invites
   where claimed_by is null
     and ((email is not null and new.email is not null and lower(email) = lower(new.email))
       or (phone is not null and v_phone <> '' and phone = v_phone))
   order by created_at limit 1;
  if found then
    v_role := v_inv.role;
    update public.staff_invites set claimed_by = new.id where id = v_inv.id;
  end if;
  insert into public.profiles (id, full_name, email, phone, role)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), v_inv.full_name),
          new.email, nullif(v_phone, ''), v_role);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- settings, plans -------------------------------------------
create table public.gym_settings (
  id                            int primary key default 1 check (id = 1),
  gym_name                      text not null default 'PILLAR FITNESS',
  address                       text not null default 'Kothri, Madhya Pradesh, India',
  instagram                     text default 'raja_pillar8',
  owner_name                    text not null default 'Raja Pillar',
  owner_phone                   text default '8319917857',
  owner_instagram               text default 'raja_pillar8',
  receptionist_max_discount_pct numeric(5,2) not null default 0 check (receptionist_max_discount_pct between 0 and 100),
  default_due_days              int not null default 0 check (default_due_days between 0 and 60),
  updated_at                    timestamptz not null default now()
);
insert into public.gym_settings (id) values (1);

create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  months      int not null unique check (months between 1 and 36),
  name        text not null,
  price_men   numeric(10,2) not null check (price_men >= 0),
  price_women numeric(10,2) not null check (price_women >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
-- Only the prices Raja gave. Men and women start equal. Add 6/12 months in Settings.
insert into public.plans (months, name, price_men, price_women) values
  (1, '1 Month', 1000, 1000),
  (3, '3 Months', 2500, 2500);

-- ---------- members, memberships, payments -----------------------------
create sequence public.member_code_seq start 1;

create table public.members (
  id                uuid primary key default gen_random_uuid(),
  member_code       text not null unique default ('PF-' || lpad(nextval('public.member_code_seq')::text, 4, '0')),
  full_name         text not null check (length(trim(full_name)) >= 2),
  phone             text not null check (phone ~ '^[6-9][0-9]{9}$'),
  gender            text not null check (gender in ('men', 'women')),
  age               int check (age between 5 and 100),
  address           text,
  emergency_contact text,
  notes             text,
  joined_on         date not null default public.gym_today(),
  whatsapp_consent  boolean not null default true,
  request_key       text unique,
  archived_at       timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
create index members_phone_idx on public.members (phone);

create or replace function public.members_normalize() returns trigger
language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  new.full_name := trim(new.full_name);
  return new;
end $$;
create trigger members_normalize_trg before insert or update on public.members
  for each row execute function public.members_normalize();

create table public.memberships (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members(id) on delete restrict,
  plan_id        uuid references public.plans(id) on delete set null,
  plan_months    int not null,
  plan_name      text not null,
  kind           text not null default 'new' check (kind in ('new', 'renewal')),
  start_date     date not null,
  end_date       date not null,
  original_price numeric(10,2) not null check (original_price >= 0),
  discount       numeric(10,2) not null default 0 check (discount >= 0),
  final_amount   numeric(10,2) not null,
  due_date       date not null,
  cancelled_at   timestamptz,
  cancel_reason  text,
  cancelled_by   uuid,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  check (end_date >= start_date),
  check (discount <= original_price),
  check (final_amount = original_price - discount)
);
create index memberships_member_idx on public.memberships (member_id, start_date);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  membership_id   uuid not null references public.memberships(id) on delete restrict,
  member_id       uuid not null references public.members(id) on delete restrict,
  amount          numeric(10,2) not null check (amount > 0),
  method          text not null check (method in ('cash', 'upi', 'bank_transfer', 'other')),
  paid_at         timestamptz not null default now(),
  transaction_id  text,
  notes           text,
  idempotency_key text unique,
  received_by     uuid,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text
);
create index payments_membership_idx on public.payments (membership_id);
create index payments_paid_at_idx on public.payments (paid_at);
create unique index payments_txn_unique on public.payments (method, lower(transaction_id))
  where transaction_id is not null and voided_at is null;

-- Payment history is never edited or deleted. The only change allowed is voiding.
create or replace function public.payments_protect() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted. Void the payment instead.';
  end if;
  if old.voided_at is not null
     or new.voided_at is null
     or (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
        is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'Payment records are read-only. Void the payment instead.';
  end if;
  return new;
end $$;
create trigger payments_protect_trg before update or delete on public.payments
  for each row execute function public.payments_protect();

create table public.renewal_history (
  id                     uuid primary key default gen_random_uuid(),
  member_id              uuid not null references public.members(id) on delete restrict,
  previous_membership_id uuid references public.memberships(id) on delete set null,
  new_membership_id      uuid not null references public.memberships(id) on delete restrict,
  renewed_by             uuid,
  created_at             timestamptz not null default now()
);

-- ---------- WhatsApp ----------------------------------------------------
create table public.notification_preferences (
  kind                text primary key check (kind in ('pending_fee', 'overdue', 'expiry', 'renewal', 'payment_confirmation')),
  label               text not null,
  auto_enabled        boolean not null default false,
  offset_days         int not null default 0,
  repeat_every_days   int not null default 7 check (repeat_every_days >= 1),
  template_name       text,
  template_language   text not null default 'en'
);
insert into public.notification_preferences (kind, label, offset_days, repeat_every_days) values
  ('pending_fee',          'Pending fee reminder',        0, 7),
  ('overdue',              'Overdue payment reminder',    0, 7),
  ('expiry',               'Membership expiry reminder',  3, 30),
  ('renewal',              'Membership renewal reminder', 3, 30),
  ('payment_confirmation', 'Payment confirmation',        0, 1);

create table public.whatsapp_logs (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid references public.members(id) on delete set null,
  membership_id uuid references public.memberships(id) on delete set null,
  payment_id    uuid references public.payments(id) on delete set null,
  kind          text not null,
  channel       text not null check (channel in ('api', 'manual')),
  status        text not null check (status in ('pending', 'sent', 'failed', 'manual_opened')),
  phone         text not null,
  message_body  text,
  error         text,
  wa_message_id text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index whatsapp_logs_member_idx on public.whatsapp_logs (member_id, created_at desc);

-- Secrets: nobody can read this table from the app. Only the server functions can.
create table public.whatsapp_secrets (
  id              int primary key default 1 check (id = 1),
  phone_number_id text,
  business_account_id text,
  access_token    text,
  api_version     text not null default 'v23.0',
  updated_at      timestamptz not null default now()
);

-- ---------- views (status is always calculated, never typed in) --------
create or replace view public.v_memberships with (security_invoker = true) as
select
  ms.id, ms.member_id, m.member_code, m.full_name, m.phone, m.gender, m.archived_at,
  ms.plan_months, ms.plan_name, ms.kind, ms.start_date, ms.end_date,
  ms.original_price, ms.discount, ms.final_amount, ms.due_date, ms.cancelled_at, ms.created_at,
  coalesce(p.paid, 0)                         as amount_paid,
  ms.final_amount - coalesce(p.paid, 0)       as balance,
  p.last_paid_at,
  case when ms.cancelled_at is not null then 'cancelled'
       when ms.end_date < public.gym_today() then 'expired'
       when ms.start_date > public.gym_today() then 'upcoming'
       else 'active' end                      as membership_status,
  case when ms.cancelled_at is not null then 'cancelled'
       when ms.final_amount - coalesce(p.paid, 0) <= 0 then 'paid'
       when ms.due_date < public.gym_today() then 'overdue'
       when coalesce(p.paid, 0) > 0 then 'partial'
       else 'pending' end                     as pay_status,
  (ms.end_date - public.gym_today())          as days_left,
  not exists (select 1 from public.memberships n
               where n.member_id = ms.member_id and n.cancelled_at is null
                 and n.start_date > ms.start_date) as is_latest,
  m.whatsapp_consent
from public.memberships ms
join public.members m on m.id = ms.member_id
left join lateral (
  select sum(amount) as paid, max(paid_at) as last_paid_at
    from public.payments where membership_id = ms.id and voided_at is null
) p on true;

create or replace view public.v_members with (security_invoker = true) as
select
  m.id, m.member_code, m.full_name, m.phone, m.gender, m.age, m.address, m.emergency_contact,
  m.notes, m.joined_on, m.whatsapp_consent, m.archived_at, m.created_at,
  a.expiry_date, a.latest_plan,
  case when a.n_active > 0 then 'active'
       when a.n_upcoming > 0 then 'upcoming'
       when a.n_expired > 0 then 'expired'
       else 'none' end                        as membership_status,
  coalesce(a.outstanding, 0)                  as outstanding,
  case when a.n_overdue > 0 then 'overdue'
       when a.n_partial > 0 then 'partial'
       when a.n_pending > 0 then 'pending'
       else 'paid' end                        as fee_status
from public.members m
left join lateral (
  select
    count(*) filter (where v.membership_status = 'active')   as n_active,
    count(*) filter (where v.membership_status = 'upcoming') as n_upcoming,
    count(*) filter (where v.membership_status = 'expired')  as n_expired,
    count(*) filter (where v.pay_status = 'overdue')         as n_overdue,
    count(*) filter (where v.pay_status = 'partial')         as n_partial,
    count(*) filter (where v.pay_status = 'pending')         as n_pending,
    sum(v.balance) filter (where v.pay_status in ('pending', 'partial', 'overdue')) as outstanding,
    max(v.end_date)                                           as expiry_date,
    (array_agg(v.plan_name order by v.start_date desc))[1]    as latest_plan
  from public.v_memberships v
  where v.member_id = m.id and v.membership_status <> 'cancelled'
) a on true;

-- ---------- internal payment writer (not callable from the app) --------
create or replace function public._apply_payment(
  p_membership uuid, p_amount numeric, p_method text, p_txn text, p_notes text, p_idem text
) returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  ms   public.memberships%rowtype;
  paid numeric;
  pay  public.payments%rowtype;
  v_txn text := nullif(trim(coalesce(p_txn, '')), '');
begin
  if p_idem is not null then
    select * into pay from public.payments where idempotency_key = p_idem;
    if found then return pay; end if;
  end if;
  select * into ms from public.memberships where id = p_membership for update;
  if not found then raise exception 'Membership not found'; end if;
  if ms.cancelled_at is not null then raise exception 'This membership was cancelled'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  select coalesce(sum(amount), 0) into paid from public.payments
   where membership_id = ms.id and voided_at is null;
  if p_amount > ms.final_amount - paid then
    raise exception 'Amount ₹% is more than the balance of ₹%', p_amount, ms.final_amount - paid;
  end if;
  if v_txn is not null and exists (
      select 1 from public.payments
       where method = lower(p_method) and lower(transaction_id) = lower(v_txn) and voided_at is null) then
    raise exception 'This transaction ID is already recorded';
  end if;
  insert into public.payments (membership_id, member_id, amount, method, transaction_id, notes, idempotency_key, received_by)
  values (ms.id, ms.member_id, p_amount, lower(p_method), v_txn, nullif(trim(coalesce(p_notes, '')), ''), p_idem, auth.uid())
  returning * into pay;
  return pay;
end $$;

-- ---------- app functions ------------------------------------------------
create or replace function public.price_for(p_months int, p_gender text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_gender = 'women' then price_women else price_men end
    from public.plans where months = p_months and active
$$;

create or replace function public.check_discount(p_disc numeric, p_orig numeric) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_max numeric;
begin
  if p_disc < 0 or p_disc > p_orig then raise exception 'Discount must be between ₹0 and ₹%', p_orig; end if;
  if p_disc > 0 and not public.is_owner() then
    select receptionist_max_discount_pct into v_max from public.gym_settings where id = 1;
    if p_disc > round(p_orig * v_max / 100, 2) then
      raise exception 'Only the owner can give this discount (staff limit is % percent)', v_max;
    end if;
  end if;
end $$;

create or replace function public.register_member(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plan    public.plans%rowtype;
  v_member  public.members%rowtype;
  v_ms      public.memberships%rowtype;
  v_pay     public.payments%rowtype;
  v_orig    numeric;
  v_disc    numeric := coalesce(nullif(p ->> 'discount', '')::numeric, 0);
  v_start   date := coalesce(nullif(p ->> 'start_date', '')::date, public.gym_today());
  v_joined  date := coalesce(nullif(p ->> 'joined_on', '')::date, public.gym_today());
  v_due     date;
  v_phone   text := public.normalize_phone(p ->> 'phone');
  v_gender  text := p ->> 'gender';
  v_key     text := nullif(p ->> 'request_key', '');
  v_amt     numeric := coalesce(nullif(p #>> '{payment,amount}', '')::numeric, 0);
  v_days    int;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if length(trim(coalesce(p ->> 'full_name', ''))) < 2 then raise exception 'Enter the member''s full name'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10 digit mobile number'; end if;
  if v_gender not in ('men', 'women') then raise exception 'Select Men or Women'; end if;

  if v_key is not null then
    select * into v_member from public.members where request_key = v_key;
    if found then
      select * into v_ms from public.memberships where member_id = v_member.id order by created_at limit 1;
      return jsonb_build_object('member_id', v_member.id, 'member_code', v_member.member_code,
                                'membership_id', v_ms.id, 'duplicate_request', true);
    end if;
  end if;

  select * into v_plan from public.plans where months = (p ->> 'plan_months')::int and active;
  if not found then raise exception 'That membership plan is not available'; end if;
  v_orig := case when v_gender = 'women' then v_plan.price_women else v_plan.price_men end;
  perform public.check_discount(v_disc, v_orig);

  select default_due_days into v_days from public.gym_settings where id = 1;
  v_due := coalesce(nullif(p ->> 'due_date', '')::date, v_start + v_days);

  insert into public.members (full_name, phone, gender, age, address, emergency_contact, notes,
                              joined_on, whatsapp_consent, request_key, created_by)
  values (trim(p ->> 'full_name'), v_phone, v_gender, nullif(p ->> 'age', '')::int,
          nullif(trim(coalesce(p ->> 'address', '')), ''), nullif(trim(coalesce(p ->> 'emergency_contact', '')), ''),
          nullif(trim(coalesce(p ->> 'notes', '')), ''), v_joined,
          coalesce((p ->> 'whatsapp_consent')::boolean, true), v_key, auth.uid())
  returning * into v_member;

  insert into public.memberships (member_id, plan_id, plan_months, plan_name, kind, start_date, end_date,
                                  original_price, discount, final_amount, due_date, created_by)
  values (v_member.id, v_plan.id, v_plan.months, v_plan.name, 'new', v_start,
          (v_start + make_interval(months => v_plan.months))::date - 1,
          v_orig, v_disc, v_orig - v_disc, v_due, auth.uid())
  returning * into v_ms;

  if v_amt > 0 then
    v_pay := public._apply_payment(v_ms.id, v_amt, coalesce(p #>> '{payment,method}', 'cash'),
                                   p #>> '{payment,transaction_id}', p #>> '{payment,notes}',
                                   nullif(p #>> '{payment,idempotency_key}', ''));
  end if;

  return jsonb_build_object('member_id', v_member.id, 'member_code', v_member.member_code,
    'membership_id', v_ms.id, 'original_price', v_orig, 'discount', v_disc, 'final_amount', v_ms.final_amount,
    'payment_id', v_pay.id, 'balance', v_ms.final_amount - coalesce(v_pay.amount, 0),
    'end_date', v_ms.end_date);
end $$;

create or replace function public.record_payment(
  p_membership uuid, p_amount numeric, p_method text, p_transaction_id text default null,
  p_notes text default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay public.payments%rowtype; ms public.memberships%rowtype; paid numeric;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  pay := public._apply_payment(p_membership, p_amount, p_method, p_transaction_id, p_notes, p_idempotency_key);
  select * into ms from public.memberships where id = pay.membership_id;
  select coalesce(sum(amount), 0) into paid from public.payments where membership_id = ms.id and voided_at is null;
  return jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'paid_total', paid,
                            'balance', ms.final_amount - paid, 'end_date', ms.end_date);
end $$;

create or replace function public.renew_membership(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member public.members%rowtype;
  v_plan   public.plans%rowtype;
  v_prev   public.memberships%rowtype;
  v_ms     public.memberships%rowtype;
  v_pay    public.payments%rowtype;
  v_orig   numeric;
  v_disc   numeric := coalesce(nullif(p ->> 'discount', '')::numeric, 0);
  v_last_end date;
  v_start  date;
  v_due    date;
  v_amt    numeric := coalesce(nullif(p #>> '{payment,amount}', '')::numeric, 0);
  v_days   int;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into v_member from public.members where id = (p ->> 'member_id')::uuid for update;
  if not found then raise exception 'Member not found'; end if;
  if v_member.archived_at is not null then raise exception 'Restore this member before renewing'; end if;

  select * into v_plan from public.plans where months = (p ->> 'plan_months')::int and active;
  if not found then raise exception 'That membership plan is not available'; end if;
  v_orig := case when v_member.gender = 'women' then v_plan.price_women else v_plan.price_men end;
  perform public.check_discount(v_disc, v_orig);

  select * into v_prev from public.memberships
   where member_id = v_member.id and cancelled_at is null order by end_date desc limit 1;
  v_last_end := v_prev.end_date;
  v_start := coalesce(nullif(p ->> 'start_date', '')::date, greatest(public.gym_today(), coalesce(v_last_end + 1, public.gym_today())));
  if v_last_end is not null and v_start <= v_last_end then
    raise exception 'New membership must start after the current one ends (%)', to_char(v_last_end, 'DD/MM/YYYY');
  end if;
  select default_due_days into v_days from public.gym_settings where id = 1;
  v_due := coalesce(nullif(p ->> 'due_date', '')::date, v_start + v_days);

  insert into public.memberships (member_id, plan_id, plan_months, plan_name, kind, start_date, end_date,
                                  original_price, discount, final_amount, due_date, created_by)
  values (v_member.id, v_plan.id, v_plan.months, v_plan.name, 'renewal', v_start,
          (v_start + make_interval(months => v_plan.months))::date - 1,
          v_orig, v_disc, v_orig - v_disc, v_due, auth.uid())
  returning * into v_ms;

  insert into public.renewal_history (member_id, previous_membership_id, new_membership_id, renewed_by)
  values (v_member.id, v_prev.id, v_ms.id, auth.uid());

  if v_amt > 0 then
    v_pay := public._apply_payment(v_ms.id, v_amt, coalesce(p #>> '{payment,method}', 'cash'),
                                   p #>> '{payment,transaction_id}', p #>> '{payment,notes}',
                                   nullif(p #>> '{payment,idempotency_key}', ''));
  end if;
  return jsonb_build_object('membership_id', v_ms.id, 'start_date', v_ms.start_date, 'end_date', v_ms.end_date,
    'final_amount', v_ms.final_amount, 'payment_id', v_pay.id, 'balance', v_ms.final_amount - coalesce(v_pay.amount, 0));
end $$;

create or replace function public.void_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can void a payment' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for voiding this payment'; end if;
  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_payment and voided_at is null;
  if not found then raise exception 'Payment not found or already voided'; end if;
end $$;

create or replace function public.cancel_membership(p_membership uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can cancel a membership' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for cancelling'; end if;
  update public.memberships set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_membership and cancelled_at is null;
  if not found then raise exception 'Membership not found or already cancelled'; end if;
end $$;

create or replace function public.archive_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can archive a member' using errcode = '42501'; end if;
  update public.members set archived_at = now() where id = p_member and archived_at is null;
end $$;

create or replace function public.restore_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can restore a member' using errcode = '42501'; end if;
  update public.members set archived_at = null where id = p_member;
end $$;

-- ---------- staff management ------------------------------------------
create or replace function public.invite_staff(p_name text, p_email text, p_phone text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text := nullif(public.normalize_phone(p_phone), ''); v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not public.is_owner() then raise exception 'Only the owner can add staff' using errcode = '42501'; end if;
  if v_phone is null and v_email is null then raise exception 'Enter a mobile number or an email'; end if;
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10 digit mobile number'; end if;
  insert into public.staff_invites (full_name, email, phone, role, created_by)
  values (nullif(trim(coalesce(p_name, '')), ''), v_email, v_phone, p_role, auth.uid());
  -- if they already signed up, give access straight away
  update public.profiles set role = p_role, active = true
   where role = 'none' and ((v_email is not null and lower(email) = v_email) or (v_phone is not null and phone = v_phone));
  update public.staff_invites i set claimed_by = pr.id
    from public.profiles pr
   where i.claimed_by is null and pr.role = p_role
     and ((i.email is not null and lower(pr.email) = lower(i.email)) or (i.phone is not null and pr.phone = i.phone));
end $$;

create or replace function public.remove_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this' using errcode = '42501'; end if;
  delete from public.staff_invites where id = p_invite and claimed_by is null;
end $$;

create or replace function public.set_staff_access(p_user uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can change staff access' using errcode = '42501'; end if;
  if p_role not in ('owner', 'receptionist', 'none') then raise exception 'Unknown role'; end if;
  if (p_role <> 'owner' or not p_active)
     and exists (select 1 from public.profiles where id = p_user and role = 'owner' and active)
     and (select count(*) from public.profiles where role = 'owner' and active) <= 1 then
    raise exception 'There must always be at least one active owner';
  end if;
  update public.profiles set role = p_role, active = p_active where id = p_user;
end $$;

-- a logged in person who was invited AFTER signing up can pick up the invite
create or replace function public.claim_invite() returns text
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles%rowtype; v_inv public.staff_invites%rowtype;
begin
  select * into v_p from public.profiles where id = auth.uid();
  if not found or v_p.role <> 'none' then return coalesce(v_p.role, 'none'); end if;
  select * into v_inv from public.staff_invites
   where claimed_by is null
     and ((email is not null and v_p.email is not null and lower(email) = lower(v_p.email))
       or (phone is not null and v_p.phone is not null and phone = v_p.phone))
   order by created_at limit 1;
  if found then
    update public.staff_invites set claimed_by = v_p.id where id = v_inv.id;
    update public.profiles set role = v_inv.role, active = true,
           full_name = coalesce(full_name, v_inv.full_name) where id = v_p.id;
    return v_inv.role;
  end if;
  return 'none';
end $$;

-- ---------- WhatsApp settings / logs -------------------------------------
create or replace function public.set_whatsapp_credentials(
  p_phone_number_id text, p_waba_id text, p_access_token text, p_api_version text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this' using errcode = '42501'; end if;
  insert into public.whatsapp_secrets (id, phone_number_id, business_account_id, access_token, api_version)
  values (1, nullif(trim(p_phone_number_id), ''), nullif(trim(p_waba_id), ''), nullif(trim(p_access_token), ''),
          coalesce(nullif(trim(p_api_version), ''), 'v23.0'))
  on conflict (id) do update set
    phone_number_id = coalesce(nullif(trim(p_phone_number_id), ''), public.whatsapp_secrets.phone_number_id),
    business_account_id = coalesce(nullif(trim(p_waba_id), ''), public.whatsapp_secrets.business_account_id),
    access_token = coalesce(nullif(trim(p_access_token), ''), public.whatsapp_secrets.access_token),
    api_version = coalesce(nullif(trim(p_api_version), ''), public.whatsapp_secrets.api_version),
    updated_at = now();
end $$;

create or replace function public.clear_whatsapp_credentials() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can do this' using errcode = '42501'; end if;
  delete from public.whatsapp_secrets;
end $$;

-- the token itself is never returned
create or replace function public.whatsapp_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.whatsapp_secrets%rowtype;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into s from public.whatsapp_secrets where id = 1;
  return jsonb_build_object(
    'configured', coalesce(s.access_token is not null and s.phone_number_id is not null, false),
    'phone_number_id', case when public.is_owner() then s.phone_number_id end,
    'business_account_id', case when public.is_owner() then s.business_account_id end,
    'api_version', s.api_version);
end $$;

create or replace function public.log_manual_whatsapp(
  p_member uuid, p_membership uuid, p_payment uuid, p_kind text, p_message text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select phone into v_phone from public.members where id = p_member;
  if v_phone is null then raise exception 'Member not found'; end if;
  insert into public.whatsapp_logs (member_id, membership_id, payment_id, kind, channel, status, phone, message_body, created_by)
  values (p_member, p_membership, p_payment, p_kind, 'manual', 'manual_opened', v_phone, p_message, auth.uid());
end $$;

-- who should get which automatic message right now (used by the server function only)
create or replace function public.reminder_candidates(p_kind text)
returns table (member_id uuid, membership_id uuid, payment_id uuid, full_name text, phone text,
               amount numeric, due_date date, end_date date, plan_name text)
language plpgsql stable security definer set search_path = public as $$
declare pref public.notification_preferences%rowtype; t date := public.gym_today();
begin
  select * into pref from public.notification_preferences where kind = p_kind;
  if not found or not pref.auto_enabled then return; end if;

  if p_kind = 'payment_confirmation' then
    return query
    select p.member_id, p.membership_id, p.id, m.full_name, m.phone, p.amount, ms.due_date, ms.end_date, ms.plan_name
      from public.payments p
      join public.members m on m.id = p.member_id
      join public.memberships ms on ms.id = p.membership_id
     where p.voided_at is null and p.created_at > now() - interval '2 days'
       and m.archived_at is null and m.whatsapp_consent
       and not exists (select 1 from public.whatsapp_logs l
                        where l.payment_id = p.id and l.kind = 'payment_confirmation'
                          and l.status in ('sent', 'pending', 'manual_opened'));
    return;
  end if;

  return query
  select v.member_id, v.id, null::uuid, v.full_name, v.phone, v.balance, v.due_date, v.end_date, v.plan_name
    from public.v_memberships v
    join public.members m on m.id = v.member_id
   where v.archived_at is null and m.whatsapp_consent
     and case p_kind
           when 'pending_fee' then v.pay_status in ('pending', 'partial') and v.due_date <= t + pref.offset_days
           when 'overdue'     then v.pay_status = 'overdue'
           when 'expiry'      then v.membership_status = 'active' and v.is_latest and v.end_date <= t + pref.offset_days
           when 'renewal'     then v.membership_status = 'expired' and v.is_latest
                                   and v.end_date <= t - pref.offset_days and v.end_date >= t - 30
           else false end
     and not exists (select 1 from public.whatsapp_logs l
                      where l.membership_id = v.id and l.kind = p_kind
                        and l.status in ('sent', 'pending', 'manual_opened')
                        and l.created_at > now() - make_interval(days => pref.repeat_every_days))
     and (select count(*) from public.whatsapp_logs l
           where l.membership_id = v.id and l.kind = p_kind and l.status = 'failed'
             and l.created_at > now() - make_interval(days => pref.repeat_every_days)) < 3;
end $$;

-- ---------- dashboard and reports ----------------------------------------
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  ms date := date_trunc('month', public.gym_today())::date;
  me date := (date_trunc('month', public.gym_today()) + interval '1 month')::date - 1;
  r jsonb;
begin
  if not public.is_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select jsonb_build_object(
    'total_members',    count(*) filter (where archived_at is null),
    'archived_members', count(*) filter (where archived_at is not null),
    'active_members',   count(*) filter (where archived_at is null and membership_status = 'active'),
    'upcoming_members', count(*) filter (where archived_at is null and membership_status = 'upcoming'),
    'expired_members',  count(*) filter (where archived_at is null and membership_status = 'expired'),
    'new_this_month',   count(*) filter (where archived_at is null and joined_on between ms and me)
  ) into r from public.v_members;
  r := r || jsonb_build_object(
    'paid_this_month', (select coalesce(sum(amount), 0) from public.payments
                         where voided_at is null and (paid_at at time zone 'Asia/Kolkata')::date between ms and me),
    'payments_this_month', (select count(*) from public.payments
                         where voided_at is null and (paid_at at time zone 'Asia/Kolkata')::date between ms and me),
    'pending_total', (select coalesce(sum(balance), 0) from public.v_memberships
                       where archived_at is null and pay_status in ('pending', 'partial', 'overdue') and due_date <= me),
    'pending_members', (select count(distinct member_id) from public.v_memberships
                         where archived_at is null and pay_status in ('pending', 'partial', 'overdue') and due_date <= me));
  r := r || jsonb_build_object('total_collection', (r ->> 'paid_this_month')::numeric + (r ->> 'pending_total')::numeric);
  return r;
end $$;

create or replace function public.revenue_by_month(p_year int)
returns table (month int, collected numeric, payments bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner can view reports' using errcode = '42501'; end if;
  return query
  select g.m, coalesce(sum(p.amount), 0), count(p.id)
    from generate_series(1, 12) g(m)
    left join public.payments p on p.voided_at is null
     and extract(year from p.paid_at at time zone 'Asia/Kolkata') = p_year
     and extract(month from p.paid_at at time zone 'Asia/Kolkata') = g.m
   group by g.m order by g.m;
end $$;

create or replace function public.reports_summary(p_year int, p_month int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ms date := make_date(p_year, p_month, 1); me date := (make_date(p_year, p_month, 1) + interval '1 month')::date - 1; r jsonb;
begin
  if not public.is_owner() then raise exception 'Only the owner can view reports' using errcode = '42501'; end if;
  select jsonb_build_object(
    'registered', count(*) filter (where archived_at is null),
    'active',     count(*) filter (where archived_at is null and membership_status = 'active'),
    'expired',    count(*) filter (where archived_at is null and membership_status = 'expired'),
    'new_registrations', count(*) filter (where joined_on between ms and me)
  ) into r from public.v_members;
  return r || jsonb_build_object(
    'revenue', (select coalesce(sum(amount), 0) from public.payments
                 where voided_at is null and (paid_at at time zone 'Asia/Kolkata')::date between ms and me),
    'outstanding_total', (select coalesce(sum(balance), 0) from public.v_memberships
                 where archived_at is null and pay_status in ('pending', 'partial', 'overdue')),
    'discounts_total', (select coalesce(sum(discount), 0) from public.memberships
                 where cancelled_at is null and (created_at at time zone 'Asia/Kolkata')::date between ms and me),
    'by_method', (select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) from (
                 select method, sum(amount) as total from public.payments
                  where voided_at is null and (paid_at at time zone 'Asia/Kolkata')::date between ms and me
                  group by method) x),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('plan', plan_name, 'memberships', n, 'billed', billed) order by n desc), '[]'::jsonb)
                from (select plan_name, count(*) as n, sum(final_amount) as billed from public.memberships
                       where cancelled_at is null and start_date between ms and me group by plan_name) y));
end $$;

-- ---------- security: row level security ---------------------------------
alter table public.profiles                enable row level security;
alter table public.staff_invites           enable row level security;
alter table public.gym_settings            enable row level security;
alter table public.plans                   enable row level security;
alter table public.members                 enable row level security;
alter table public.memberships             enable row level security;
alter table public.payments                enable row level security;
alter table public.renewal_history         enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.whatsapp_logs           enable row level security;
alter table public.whatsapp_secrets        enable row level security;   -- no policies = nobody from the app

create policy profiles_read   on public.profiles for select to authenticated using (id = auth.uid() or public.is_owner());
create policy invites_owner   on public.staff_invites for select to authenticated using (public.is_owner());
create policy settings_read   on public.gym_settings for select to authenticated using (public.is_staff());
create policy settings_write  on public.gym_settings for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy plans_read      on public.plans for select to authenticated using (public.is_staff());
create policy plans_insert    on public.plans for insert to authenticated with check (public.is_owner());
create policy plans_update    on public.plans for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy members_read    on public.members for select to authenticated using (public.is_staff());
create policy members_update  on public.members for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy ms_read         on public.memberships for select to authenticated using (public.is_staff());
create policy ms_update       on public.memberships for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy pay_read        on public.payments for select to authenticated using (public.is_staff());
create policy renew_read      on public.renewal_history for select to authenticated using (public.is_staff());
create policy prefs_read      on public.notification_preferences for select to authenticated using (public.is_staff());
create policy prefs_write     on public.notification_preferences for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy wa_logs_read    on public.whatsapp_logs for select to authenticated using (public.is_staff());

-- ---------- security: privileges ----------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.profiles, public.staff_invites, public.gym_settings, public.plans, public.members,
                public.memberships, public.payments, public.renewal_history, public.notification_preferences,
                public.whatsapp_logs, public.v_members, public.v_memberships to authenticated;
grant insert on public.plans to authenticated;
grant update on public.plans, public.gym_settings, public.notification_preferences to authenticated;
grant update (full_name, phone, gender, age, address, emergency_contact, notes, joined_on, whatsapp_consent)
  on public.members to authenticated;
grant update (due_date) on public.memberships to authenticated;

grant execute on function
  public.gym_today(), public.normalize_phone(text), public.current_role_name(), public.is_staff(), public.is_owner(),
  public.price_for(int, text), public.register_member(jsonb), public.record_payment(uuid, numeric, text, text, text, text),
  public.renew_membership(jsonb), public.void_payment(uuid, text), public.cancel_membership(uuid, text),
  public.archive_member(uuid), public.restore_member(uuid), public.invite_staff(text, text, text, text),
  public.remove_invite(uuid), public.set_staff_access(uuid, text, boolean), public.claim_invite(),
  public.set_whatsapp_credentials(text, text, text, text), public.clear_whatsapp_credentials(),
  public.whatsapp_status(), public.log_manual_whatsapp(uuid, uuid, uuid, text, text),
  public.dashboard_stats(), public.revenue_by_month(int), public.reports_summary(int, int)
  to authenticated;

-- The owner: Raja Pillar. Signing in with this mobile number makes him the owner.
-- (To also allow email login, run the line in README step 3.)
insert into public.staff_invites (full_name, phone, role) values ('Raja Pillar', '8319917857', 'owner');

-- Hardening applied after Supabase's security check: fixed search paths on helper functions.
alter function public.gym_today() set search_path = public;
alter function public.normalize_phone(text) set search_path = public;
alter function public.members_normalize() set search_path = public;
alter function public.payments_protect() set search_path = public;
