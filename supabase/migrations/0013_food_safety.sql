-- Migration: Food Safety & Compliance (0013_food_safety.sql)

create table equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,           -- 'Tủ đông 1', 'Kho lạnh rau', 'Tủ mát bar'
  zone text,                           -- 'Bếp nóng', 'Bếp lạnh', 'Bar', 'Kho'
  min_temp numeric not null,
  max_temp numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (max_temp > min_temp)
);

create table temp_logs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id),
  temp_c numeric not null,
  is_out_of_range boolean not null,    -- app tự tính lúc ghi, lưu cứng để audit
  logged_at timestamptz not null default now(),
  logged_by uuid not null references staff(id),
  note text                            -- bắt buộc nhập khi out_of_range
);
create index idx_temp_logs_time on temp_logs(logged_at);

create table food_samples (
  id uuid primary key default gen_random_uuid(),
  sample_date date not null,
  shift shift_type not null,
  dish_or_group text not null,         -- món hoặc đoàn được lưu mẫu
  stored_at timestamptz not null default now(),
  stored_by uuid not null references staff(id),
  discard_due_at timestamptz not null, -- stored_at + 24h, app tự tính
  discarded_at timestamptz,
  discarded_by uuid references staff(id)
);

create table licenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,                  -- 'Giấy chứng nhận ATTP', 'PCCC'...
  issuer text,
  expires_on date not null,
  owner_staff_id uuid references staff(id),  -- ai phụ trách gia hạn
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);

-- Mở rộng checklist 0003: thêm phase ATTP
alter table checklist_templates drop constraint if exists checklist_templates_phase_check;
alter table checklist_templates add constraint checklist_templates_phase_check
  check (phase in ('MO_CA','DONG_CA','ATTP'));

-- RLS
alter table equipment enable row level security;
alter table temp_logs enable row level security;
alter table food_samples enable row level security;
alter table licenses enable row level security;

create policy eq_read on equipment for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy eq_write on equipment for all using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')))
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')));

-- temp_logs: staff active insert + select. KHÔNG update/delete — APPEND-ONLY
create policy tl_read on temp_logs for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy tl_insert on temp_logs for insert with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));

-- food_samples: staff insert/select; update CHỈ để ghi discarded (một lần).
create policy fs_read on food_samples for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy fs_insert on food_samples for insert with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy fs_discard on food_samples for update using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active)
  and discarded_at is null);   -- chỉ update được khi CHƯA hủy; sau đó khóa

-- licenses: staff đọc; manager/owner ghi.
create policy lc_read on licenses for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy lc_write on licenses for all using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')))
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')));

-- SEED DATA
do $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id from staff where is_active = true and role = 'owner' limit 1;

  if v_staff_id is not null then
    -- Seeding equipment
    insert into equipment (name, zone, min_temp, max_temp) values
    ('Kho lạnh đông thực phẩm', 'Kho', -22, -15),
    ('Kho mát rau củ quả', 'Kho', 2, 8),
    ('Tủ mát bảo quản thịt bếp nóng', 'Bếp nóng', 0, 4),
    ('Tủ mát hải sản sống', 'Bếp nóng', 0, 3),
    ('Tủ mát quầy bar', 'Bar', 2, 8),
    ('Tủ mát bánh ngọt & hoa quả', 'Bếp lạnh', 2, 6)
    on conflict (name) do nothing;

    -- Seeding licenses
    insert into licenses (name, issuer, expires_on, owner_staff_id, note, created_by) values
    ('Giấy chứng nhận cơ sở đủ điều kiện ATTP', 'Chi cục An toàn thực phẩm Hà Nội', current_date + interval '360 days', v_staff_id, 'Phụ trách gia hạn hàng năm.', v_staff_id),
    ('Giấy chứng nhận thẩm duyệt thiết kế PCCC', 'Phòng Cảnh sát PCCC & CNCH', current_date + interval '720 days', v_staff_id, 'Hồ sơ pháp lý cơ sở.', v_staff_id),
    ('Hợp đồng thuê mặt bằng nhà hàng', 'Công ty quản lý tòa nhà', current_date + interval '45 days', v_staff_id, 'Hạn chót đàm phán gia hạn trước 30 ngày.', v_staff_id),
    ('Bảo hiểm trách nhiệm công cộng', 'Tổng công ty bảo hiểm PVI', current_date + interval '6 days', v_staff_id, 'Liên hệ đại lý bảo hiểm trước 7 ngày.', v_staff_id)
    on conflict do nothing;

    -- Seeding checklist templates for ATTP phase (trưa & tối)
    insert into checklist_templates (shift, phase, item_order, content, created_by) values
    ('TRUA', 'ATTP', 1, 'Kiểm tra nhiệt độ tủ lạnh, tủ đông đầu ca trưa', v_staff_id),
    ('TRUA', 'ATTP', 2, 'Vệ sinh thớt dao riêng biệt (Đỏ: sống, Xanh: chín)', v_staff_id),
    ('TRUA', 'ATTP', 3, 'Thực hiện lưu mẫu thức ăn các món ăn phục vụ đoàn ca trưa', v_staff_id),
    ('TRUA', 'ATTP', 4, 'Kiểm tra HSD nguyên liệu trong kho mát đầu ca', v_staff_id),
    ('TOI', 'ATTP', 1, 'Kiểm tra nhiệt độ tủ lạnh, tủ đông đầu ca tối', v_staff_id),
    ('TOI', 'ATTP', 2, 'Thực hiện lưu mẫu thức ăn các món ăn phục vụ đoàn ca tối', v_staff_id),
    ('TOI', 'ATTP', 3, 'Vệ sinh bẫy mỡ bếp nóng và cống rãnh sơ chế cuối ngày', v_staff_id),
    ('TOI', 'ATTP', 4, 'Sát khuẩn toàn bộ bề mặt bàn chia đồ chín bằng cồn 70 độ', v_staff_id)
    on conflict do nothing;
  end if;
end $$;
