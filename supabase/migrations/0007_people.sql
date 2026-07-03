create table employee_profiles (
  staff_id uuid primary key references staff(id) on delete cascade,
  position text,                -- 'Phục vụ', 'Bếp nóng', 'Thu ngân'...
  department text check (department in ('FOH','BOH','OFFICE')),
  start_date date,
  phone text,
  emergency_contact text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id)
);

create table sop_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,           -- 'SOP Phục vụ 7 bước', 'SPEC Bò sốt vang'...
  department text check (department in ('FOH','BOH','ALL')),
  content text,                  -- nội dung hoặc link file
  version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);

create table sop_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references sop_documents(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (sop_id, staff_id)     -- mỗi người xác nhận 1 lần / SOP (version mới = SOP mới)
);

-- Enable RLS
alter table employee_profiles enable row level security;
alter table sop_documents enable row level security;
alter table sop_acknowledgements enable row level security;

-- employee_profiles: read: self or manager/owner. write: manager/owner
create policy ep_read on employee_profiles for select using (
  staff_id = (select id from current_staff()) or
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
);
create policy ep_write on employee_profiles for all using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
) with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
);

-- sop_documents: read: all active staff. write: manager/owner
create policy sop_read on sop_documents for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active)
);
create policy sop_write on sop_documents for all using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
) with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
);

-- sop_acknowledgements: read: self or manager/owner. write (insert): self only. update/delete: none.
create policy ack_read on sop_acknowledgements for select using (
  staff_id = (select id from current_staff()) or
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active and s.role in ('owner','manager'))
);
create policy ack_insert on sop_acknowledgements for insert with check (
  staff_id = (select id from current_staff())
);

-- Seed default SOPs
do $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id from staff where is_active = true order by role = 'owner' desc, role = 'manager' desc limit 1;

  if v_staff_id is not null then
    insert into sop_documents (title, department, content, version, is_active, created_by) values
    (
      'SOP Phục vụ 7 bước', 
      'FOH', 
      '1. Chào đón khách và xếp chỗ ngồi ấm cúng.' || chr(10) ||
      '2. Giới thiệu thực đơn nước, món đặc trưng hôm nay.' || chr(10) ||
      '3. Ghi nhận order cẩn thận và xác nhận lại với khách.' || chr(10) ||
      '4. Chuyển order vào bếp nóng/bếp lạnh thông qua hệ thống.' || chr(10) ||
      '5. Phục vụ món ăn kèm nụ cười thân thiện.' || chr(10) ||
      '6. Chăm sóc khách trong bữa ăn (rót nước, hỏi han hương vị).' || chr(10) ||
      '7. Thanh toán, tiễn khách chu đáo và xin phản hồi.', 
      1, 
      true, 
      v_staff_id
    ),
    (
      'SPEC Bò sốt vang', 
      'BOH', 
      'Mô tả: Thịt bò chín mềm ngọt, nước sốt sánh đỏ nâu, hương vị đậm đà.' || chr(10) ||
      'Định lượng chuẩn:' || chr(10) ||
      '- Nạc vai bò: 200g thái vuông quân cờ.' || chr(10) ||
      '- Khoai tây, cà rốt thái miếng: mỗi loại 50g.' || chr(10) ||
      '- Hành tây thái múi cau: 30g.' || chr(10) ||
      '- Rượu vang đỏ Đà Lạt: 50ml.' || chr(10) ||
      '- Sốt cà chua & gia vị hầm (thảo quả, quế, hồi).' || chr(10) ||
      'Quy trình chế biến: Ướp bò 15 phút -> Xào săn bò -> Thêm vang đỏ, nước dùng hầm nhỏ lửa 45 phút -> Cho rau củ hầm thêm 15 phút -> Hoàn thiện sốt sánh vừa.', 
      1, 
      true, 
      v_staff_id
    ),
    (
      'SPEC Soup hải sản', 
      'BOH', 
      'Mô tả: Soup sánh trong, màu trắng ngà điểm sắc xanh của hành hoa và đỏ của tôm.' || chr(10) ||
      'Định lượng chuẩn:' || chr(10) ||
      '- Tôm bóc vỏ cắt hạt lựu: 50g.' || chr(10) ||
      '- Mực ống tươi cắt hạt lựu: 30g.' || chr(10) ||
      '- Thịt ghẹ: 20g.' || chr(10) ||
      '- Trứng gà (lòng trắng): 1 quả đánh tan.' || chr(10) ||
      '- Nấm hương, ngô ngọt, hành tây.' || chr(10) ||
      '- Bột năng tạo sánh.', 
      1, 
      true, 
      v_staff_id
    ),
    (
      'SPEC Gà nướng mật ong', 
      'BOH', 
      'Mô tả: Thịt gà mềm ngọt bên trong, da gà vàng óng giòn rụm bên ngoài thơm mùi mật ong rừng.' || chr(10) ||
      'Định lượng chuẩn:' || chr(10) ||
      '- Đùi tỏi gà tươi: 250g.' || chr(10) ||
      '- Mật ong nhãn tự nhiên: 20ml.' || chr(10) ||
      '- Ngũ vị hương, dầu hào, sả, ớt băm.' || chr(10) ||
      'Quy trình chế biến: Khía đùi gà, ướp gia vị sả ớt trong 30 phút -> Nướng lò nhiệt độ 180 độ trong 20 phút -> Phết mật ong đều lên mặt da gà -> Nướng tiếp 5 phút nhiệt 200 độ cho vàng giòn.', 
      1, 
      true, 
      v_staff_id
    )
    on conflict do nothing;
  end if;
end $$;
