-- Create is_owner_or_finance helper function
create or replace function is_owner_or_finance()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from staff
    where auth_user_id = auth.uid() and role in ('owner', 'finance') and is_active = true
  );
$$;

-- Create booking_deposits table
create table booking_deposits (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  received_at timestamptz not null default now(),
  received_by uuid not null references staff(id),
  payment_method text not null check (payment_method in ('CASH', 'TRANSFER', 'CARD', 'OTHER')),
  note text,
  created_at timestamptz not null default now()
);

-- Create agency_ledger table (append-only)
create table agency_ledger (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  amount numeric not null, -- positive for DEBT (phải thu), negative for PAYMENT (đã thanh toán)
  type text not null check (type in ('DEBT', 'PAYMENT')),
  note text,
  created_by uuid not null references staff(id),
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table booking_deposits enable row level security;
alter table agency_ledger enable row level security;

-- Policies for booking_deposits (select is owner or finance; insert/update is active staff; delete NOT allowed)
create policy bd_select on booking_deposits for select using (
  is_owner_or_finance()
);

create policy bd_insert on booking_deposits for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- Policies for agency_ledger (strictly owner or finance; select and insert only, append-only)
create policy al_select on agency_ledger for select using (
  is_owner_or_finance()
);

create policy al_insert on agency_ledger for insert with check (
  is_owner_or_finance()
);

-- Public view for booking_deposits: hides amount column for normal staff
create or replace function get_booking_deposits_public()
returns table (
  id uuid,
  booking_id uuid,
  received_at timestamptz,
  received_by uuid,
  payment_method text,
  note text,
  created_at timestamptz
) language plpgsql security definer as $$
begin
  if exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true) then
    return query select b.id, b.booking_id, b.received_at, b.received_by, b.payment_method, b.note, b.created_at from booking_deposits b;
  end if;
end;
$$;

create or replace view booking_deposits_public as
select * from get_booking_deposits_public();
