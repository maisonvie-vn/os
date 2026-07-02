-- Mẫu checklist: giám sát quản lý nội dung (từ bản giấy hiện có)
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  shift shift_type not null,              -- TRUA / TOI (enum đã có từ 0002)
  phase text not null check (phase in ('MO_CA','DONG_CA')),
  item_order int not null,
  content text not null,                  -- "Kiểm tra bàn ghế khu A", "Tắt gas"...
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);

-- Checklist thực hiện: mỗi ca một bản ghi cho từng mục
create table shift_checklist_entries (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift shift_type not null,
  template_id uuid not null references checklist_templates(id),
  is_done boolean not null default false,
  note text,
  checked_at timestamptz,
  checked_by uuid references staff(id),
  unique (work_date, shift, template_id)   -- idempotent: 1 mục / ca / ngày
);

-- Báo cáo cuối ca (thay WhatsApp tự do) — APPEND-ONLY
create table shift_reports (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift shift_type not null,
  total_groups int,                        -- tổng đoàn/bàn phục vụ
  staff_absent text,                       -- ai vắng/đi muộn (text ngắn)
  incidents_summary text,                  -- tóm tắt sự cố (chi tiết đã có ở /log)
  handover_notes text not null,            -- việc bàn giao ca sau — TRƯỜNG QUAN TRỌNG NHẤT
  general_note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id),
  unique (work_date, shift)                -- 1 báo cáo / ca / ngày
);

alter table checklist_templates enable row level security;
alter table shift_checklist_entries enable row level security;
alter table shift_reports enable row level security;

-- Templates: mọi staff đọc; owner + role 'manager' được tạo/sửa nội dung
create policy tpl_read on checklist_templates for select
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy tpl_write on checklist_templates for all
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid()
                 and s.is_active and s.role in ('owner','manager')))
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid()
                 and s.is_active and s.role in ('owner','manager')));

-- Checklist entries: mọi staff active đọc + ghi (insert/update tick trong ca)
create policy ce_read on shift_checklist_entries for select
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy ce_insert on shift_checklist_entries for insert
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy ce_update on shift_checklist_entries for update
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
-- (checklist được UPDATE trong ca vì tick dần; KHÔNG có delete)

-- Reports: mọi staff đọc + insert. KHÔNG update/delete — append-only.
create policy rp_read on shift_reports for select
  using (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));
create policy rp_insert on shift_reports for insert
  with check (exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active));

-- Seed checklist templates dynamically using an active staff member (e.g. Owner/Manager)
do $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id from staff where is_active = true order by role = 'owner' desc, role = 'manager' desc limit 1;

  if v_staff_id is not null then
    -- Shift TRUA - MO_CA
    if not exists (select 1 from checklist_templates where shift = 'TRUA' and phase = 'MO_CA') then
      insert into checklist_templates (shift, phase, item_order, content, created_by) values
      ('TRUA', 'MO_CA', 10, 'Mở khóa cửa chính, bật hệ thống đèn chiếu sáng khu vực sảnh và phòng VIP', v_staff_id),
      ('TRUA', 'MO_CA', 20, 'Kiểm tra và bật điều hòa nhiệt độ khu FOH (đặt 24 độ C)', v_staff_id),
      ('TRUA', 'MO_CA', 30, 'Kiểm tra vệ sinh tổng thể bàn ghế, sàn nhà FOH và các bình hoa trang trí', v_staff_id),
      ('TRUA', 'MO_CA', 40, 'Chuẩn bị dụng cụ set up bàn ăn (khăn trải bàn, đĩa, ly rượu, dao nĩa)', v_staff_id),
      ('TRUA', 'MO_CA', 50, 'Kiểm tra hệ thống âm thanh, bật nhạc Pháp cổ điển âm lượng nhẹ (mức 12)', v_staff_id),
      ('TRUA', 'MO_CA', 60, 'Họp giao ban nhanh đầu ca (FOH + BOH), phổ biến số lượng khách và yêu cầu đặc biệt', v_staff_id);
    end if;

    -- Shift TRUA - DONG_CA
    if not exists (select 1 from checklist_templates where shift = 'TRUA' and phase = 'DONG_CA') then
      insert into checklist_templates (shift, phase, item_order, content, created_by) values
      ('TRUA', 'DONG_CA', 10, 'Thu dọn đồ ăn thừa, thu hồi bát đĩa ly tách chuyển về khu rửa', v_staff_id),
      ('TRUA', 'DONG_CA', 20, 'Lau dọn sạch sẽ các mặt bàn, xếp lại ghế gọn gàng đúng chuẩn sơ đồ', v_staff_id),
      ('TRUA', 'DONG_CA', 30, 'Vệ sinh và lau khô các ly pha lê, dụng cụ bạc và cất vào tủ bảo quản', v_staff_id),
      ('TRUA', 'DONG_CA', 40, 'Đổ rác tại các quầy bar và khu vực phục vụ', v_staff_id),
      ('TRUA', 'DONG_CA', 50, 'Tắt bớt hệ thống đèn FOH, chuyển điều hòa sang chế độ tiết kiệm điện', v_staff_id),
      ('TRUA', 'DONG_CA', 60, 'Chuẩn bị nội dung bàn giao ca tối (viết nháp bàn giao)', v_staff_id);
    end if;

    -- Shift TOI - MO_CA
    if not exists (select 1 from checklist_templates where shift = 'TOI' and phase = 'MO_CA') then
      insert into checklist_templates (shift, phase, item_order, content, created_by) values
      ('TOI', 'MO_CA', 10, 'Kiểm tra bàn giao ca trước, cập nhật danh sách đặt bàn ca tối', v_staff_id),
      ('TOI', 'MO_CA', 20, 'Bật hệ thống đèn chùm trang trí và đèn hắt cột ngoài trời biệt thự', v_staff_id),
      ('TOI', 'MO_CA', 30, 'Kiểm tra lại set up bàn phòng VIP đảm bảo đúng chuẩn tiệc tối', v_staff_id),
      ('TOI', 'MO_CA', 40, 'Bật hệ thống nến hoặc đèn sáp trang trí trên các bàn ăn', v_staff_id),
      ('TOI', 'MO_CA', 50, 'Phối hợp bếp kiểm tra lại các món đặc biệt trong ngày (Chef specials)', v_staff_id);
    end if;

    -- Shift TOI - DONG_CA
    if not exists (select 1 from checklist_templates where shift = 'TOI' and phase = 'DONG_CA') then
      insert into checklist_templates (shift, phase, item_order, content, created_by) values
      ('TOI', 'DONG_CA', 10, 'Kiểm tra và dọn dẹp sạch sẽ toàn bộ bàn ghế khu sảnh và các phòng VIP', v_staff_id),
      ('TOI', 'DONG_CA', 20, 'Thu gom rác thải FOH chuyển về khu tập kết rác của biệt thự', v_staff_id),
      ('TOI', 'DONG_CA', 30, 'Tắt toàn bộ hệ thống điều hòa, máy pha cà phê, máy rửa bát và thiết bị quầy bar', v_staff_id),
      ('TOI', 'DONG_CA', 40, 'Tắt hệ thống âm thanh, đèn chiếu sáng trang trí và khóa toàn bộ cửa sổ/cửa ra vào biệt thự', v_staff_id),
      ('TOI', 'DONG_CA', 50, 'Khóa hệ thống van gas trung tâm bếp và kiểm tra phòng chống cháy nổ', v_staff_id),
      ('TOI', 'DONG_CA', 60, 'Hoàn tất báo cáo ca trên MVOS và ký xác nhận sổ giao ca', v_staff_id);
    end if;
  end if;
end $$;
