create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_person text,
  phone text,
  email text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);

-- Log đoàn hằng ngày: mỗi đoàn phục vụ = 1 dòng
create table group_visits (
  id uuid primary key default gen_random_uuid(),
  visit_date date not null,
  shift shift_type not null,
  agency_id uuid references agencies(id),   -- nullable: khách lẻ / agency lạ
  agency_name_raw text,                     -- fallback khi agency chưa có trong list
  group_name text,
  pax int check (pax > 0),                  -- số khách
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);
create index idx_visits_date on group_visits(visit_date);
create index idx_visits_agency on group_visits(agency_id);

-- Nối nhiệt kế với master list (giữ cột text cũ nguyên vẹn)
alter table incidents add column agency_id uuid references agencies(id);

alter table agencies enable row level security;
alter table group_visits enable row level security;

-- agencies: staff đọc; manager/owner ghi
create policy ag_read on agencies for select
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy ag_write on agencies for all
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid()
                 and s.is_active and s.role in ('owner','manager')))
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid()
                 and s.is_active and s.role in ('owner','manager')));

-- group_visits: mọi staff active insert + select; manager/owner được update
-- (sửa sai số khách trong ngày); KHÔNG delete.
create policy gv_read on group_visits for select
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy gv_insert on group_visits for insert
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy gv_update on group_visits for update
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid()
                 and s.is_active and s.role in ('owner','manager')));

-- Seed default agencies dynamically using an active staff member (e.g. Owner/Manager)
do $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id from staff where is_active = true order by role = 'owner' desc, role = 'manager' desc limit 1;

  if v_staff_id is not null then
    insert into agencies (name, contact_person, phone, email, note, created_by) values
    ('LuxTravel', 'Ms. Hương', '0912345678', 'huong@luxtravel.vn', 'Agency phòng tour cao cấp biệt thự', v_staff_id),
    ('Saigontourist', 'Mr. Nam', '0903456789', 'nam.n@saigontourist.com.vn', 'Khách đoàn miền Nam', v_staff_id),
    ('Vietravel', 'Ms. Lan', '0987654321', 'lan.vt@vietravel.com', 'Đoàn khách lữ hành Hà Nội', v_staff_id),
    ('Exotissimo', 'Ms. Julie', '0904123456', 'julie@exotissimo.com', 'Khách nước ngoài (Pháp, Tây Âu)', v_staff_id),
    ('Buffalo Tours', 'Mr. John', '0915999888', 'john@buffalotours.com', 'Khách Úc & Mỹ', v_staff_id)
    on conflict (name) do nothing;
  end if;
end $$;
