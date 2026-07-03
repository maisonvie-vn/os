create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,          -- 'Sảnh tầng 3', 'Khu A tầng 1'...
  capacity int not null check (capacity > 0),
  is_active boolean not null default true
);

create type booking_status as enum ('TENTATIVE','CONFIRMED','CANCELLED','COMPLETED');

create table bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  agency_id uuid references agencies(id),
  agency_name_raw text,
  group_name text,
  pax int not null check (pax > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status booking_status not null default 'TENTATIVE',
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id),
  updated_at timestamptz,
  updated_by uuid references staff(id),
  check (ends_at > starts_at)
);
create index idx_bookings_venue_time on bookings(venue_id, starts_at);

-- CHẶN TRÙNG Ở TẦNG DATABASE (không tin riêng UI):
create extension if not exists btree_gist;
alter table bookings add constraint no_overlap
  exclude using gist (
    venue_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('TENTATIVE','CONFIRMED'));

alter table venues enable row level security;
alter table bookings enable row level security;

create policy v_read on venues for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy v_write on venues for all using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')))
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')));

create policy b_read on bookings for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy b_insert on bookings for insert with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy b_update on bookings for update using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')));

-- Seed default venues
insert into venues (name, capacity, is_active) values
('Sảnh tầng 3', 120, true),
('Khu A tầng 1', 50, true),
('Phòng VIP tầng 2', 20, true)
on conflict (name) do nothing;
