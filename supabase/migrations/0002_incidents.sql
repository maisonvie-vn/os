create type shift_type as enum ('TRUA', 'TOI');
create type incident_type as enum (
  'PHUC_VU_MAY_MOC',
  'MON_LECH_CHUAN',
  'MON_CHAM',
  'ORDER_SAI',
  'KHIEU_NAI_KHAC'
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  shift shift_type not null,
  group_name text,                 -- tên đoàn / bàn
  agency text,                     -- agency nào (để biết nguồn lặp)
  type incident_type not null,
  description text,
  severity int not null check (severity between 1 and 3),
  total_groups_in_shift int,       -- tổng đoàn ca đó, để tính %
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);

create index idx_incidents_occurred_at on incidents(occurred_at);
create index idx_incidents_type on incidents(type);

alter table incidents enable row level security;

-- Mọi staff active được GHI và ĐỌC. KHÔNG cấp update/delete cho bất kỳ ai.
create policy incidents_read on incidents for select
  using (exists (select 1 from staff s
                 where s.auth_user_id = auth.uid() and s.is_active));

create policy incidents_insert on incidents for insert
  with check (exists (select 1 from staff s
                      where s.auth_user_id = auth.uid() and s.is_active));
