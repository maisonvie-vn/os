-- Migration: Guest Recovery & Maintenance (0014_recovery_maintenance.sql)

-- 1. GUEST RECOVERY: mở rộng incidents (KHÔNG đụng dữ liệu cũ)
create type incident_status as enum ('OPEN','IN_PROGRESS','RESOLVED','FOLLOWED_UP');
alter table incidents add column status incident_status not null default 'OPEN';
alter table incidents add column assigned_to uuid references staff(id);
alter table incidents add column resolution_note text;
alter table incidents add column resolved_at timestamptz;
alter table incidents add column agency_followed_up boolean not null default false;

-- 2. IMPROVEMENT ACTIONS
create type action_status as enum ('OPEN','DOING','DONE','DROPPED');
create table improvement_actions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text,                          -- 'Họp tuần 02/07', 'Sự cố #...', 'Đề xuất bếp'
  incident_id uuid references incidents(id),
  owner_staff_id uuid not null references staff(id),
  due_date date,
  status action_status not null default 'OPEN',
  result_note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id),
  updated_at timestamptz
);

-- 3. SUPPORT DEPT + BẢO DƯỠNG
alter table checklist_templates drop constraint if exists checklist_templates_phase_check;
alter table checklist_templates add constraint checklist_templates_phase_check
  check (phase in ('MO_CA','DONG_CA','ATTP','TAP_VU','BAO_VE'));

create table maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id),
  task_name text not null,              -- 'Vệ sinh dàn lạnh', 'Kiểm tra gas'...
  interval_days int not null check (interval_days > 0),
  last_done_on date,
  next_due_on date,                     -- app tự tính = last_done + interval
  assigned_to uuid references staff(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references maintenance_schedules(id),
  done_on date not null,
  done_by uuid not null references staff(id),
  note text,
  created_at timestamptz not null default now()
);  -- append-only: không update/delete

-- Enable Row Level Security (RLS)
alter table improvement_actions enable row level security;
alter table maintenance_schedules enable row level security;
alter table maintenance_logs enable row level security;

-- Policies for incidents update
create policy incidents_update on incidents for update using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
) with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
);

-- Policies for improvement_actions
create policy ia_read on improvement_actions for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active)
);

create policy ia_write on improvement_actions for all using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
) with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
);

create policy ia_update_assigned on improvement_actions for update using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.id = owner_staff_id)
) with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.id = owner_staff_id)
);

-- Policies for maintenance_schedules
create policy ms_read on maintenance_schedules for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active)
);

create policy ms_write on maintenance_schedules for all using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
) with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
);

-- Policies for maintenance_logs
create policy ml_read on maintenance_logs for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active)
);

create policy ml_insert on maintenance_logs for insert with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active)
);
