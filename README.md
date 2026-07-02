# Maison Vie OS (MVOS) - Nền tảng Kỹ thuật

Dự án này là bộ khung nền tảng vận hành nội bộ (MVOS) của biệt thự neoclassical Maison Vie, được xây dựng bằng Next.js 14 (App Router), TypeScript, Tailwind CSS và Supabase (Auth & Postgres).

---

## 1. Khởi tạo dự án Supabase

1. Truy cập [Supabase Dashboard](https://supabase.com/) và tạo một project mới.
2. Lưu lại các thông tin:
   - **Project URL**
   - **Anon Public API Key**
   - **Service Role Secret Key**

---

## 2. Thiết lập cơ sở dữ liệu (Migrations)

Để tạo cấu trúc bảng `staff`, các hàm bổ trợ và chính sách RLS baseline, hãy chạy file migration sau trong mục **SQL Editor** của Supabase Dashboard hoặc qua CLI:

Đường dẫn file: [supabase/migrations/0001_foundation.sql](file:///d:/OS/supabase/migrations/0001_foundation.sql)

```sql
-- staff: Danh sách nhân sự được phép sử dụng MVOS
create table staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade unique,
  full_name text not null,
  role text not null default 'staff',   -- 'owner' | 'manager' | 'staff'
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- helper: lấy thông tin staff của user đang đăng nhập
create or replace function current_staff()
returns staff language sql stable security definer as $$
  select * from staff
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
$$;

-- helper: kiểm tra user có phải là owner không
create or replace function is_owner()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from staff
    where auth_user_id = auth.uid() and role = 'owner' and is_active = true
  );
$$;

-- RLS staff: user tự đọc chính mình; owner đọc toàn bộ; chỉ owner ghi
create policy staff_read on staff for select
  using (auth_user_id = auth.uid() or is_owner());
create policy staff_write on staff for all
  using (is_owner()) with check (is_owner());
```

---

## 3. Chạy dự án dưới local

1. Tạo file `.env.local` từ mẫu `.env.local.example`:
   ```bash
   cp .env.local.example .env.local
   ```
2. Điền giá trị thực của `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Cài đặt các thư viện phụ thuộc:
   ```bash
   npm install
   ```
4. Khởi chạy môi trường phát triển:
   ```bash
   npm run dev
   ```
5. Truy cập [http://localhost:3000](http://localhost:3000).

---

## 4. Deploy lên Vercel (Preview Mode)

1. Đẩy mã nguồn lên kho chứa GitHub.
2. Import repo vào Vercel.
3. Trong phần cấu hình **Environment Variables** trên Vercel, cấu hình hai biến môi trường sau:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy dự án. Lưu ý: Chỉ deploy ở chế độ **Preview**, chưa promote lên Production cho đến khi được duyệt.

---

## 5. Lệnh Seed tài khoản Chủ sở hữu (Owner)

Sau khi tài khoản người dùng đăng ký/đăng nhập lần đầu bằng email magic link hoặc email + mật khẩu qua trang `/login`, họ sẽ được tạo một bản ghi `uid` tương ứng trong bảng `auth.users` của Supabase.

Để cấp quyền Chủ sở hữu (Owner) cho tài khoản có email của anh Thành, chạy lệnh SQL sau trong **SQL Editor** trên Supabase (thay thế `<uuid>` bằng ID thực tế của user trong bảng `auth.users`):

```sql
insert into staff(auth_user_id, full_name, role) 
values ('<uuid>', 'Thành', 'owner')
on conflict (auth_user_id) do nothing;
```

---

## 6. Hướng dẫn Vận hành & Bàn giao Hệ thống (Module Sự cố)

Để MVOS hoạt động ổn định và hỗ trợ đội ngũ vận hành kế nhiệm, hãy tuân thủ 3 nguyên tắc kỹ thuật sau:

1. **Khi thêm nhân viên mới được ghi sự cố**:
   - **Bước 1**: Tạo tài khoản người dùng trong Supabase Dashboard (`Authentication` -> `Users` -> `Add user` -> `Create new user`, điền email + mật khẩu và tích chọn `Auto Confirm User`).
   - **Bước 2**: Sao chép ID người dùng vừa tạo (UID).
   - **Bước 3**: Chạy lệnh SQL sau trong `SQL Editor` để liên kết người dùng với bảng `staff` (không có bản ghi này, hệ thống sẽ chặn quyền ghi nhận sự cố):
     ```sql
     insert into staff (auth_user_id, full_name, role)
     values ('<UID_CỦA_NHÂN_VIÊN>', 'Tên Nhân Viên', 'staff');
     ```

2. **Khi `/log` báo lỗi "relation does not exist"**:
   - Lỗi này xảy ra khi mã nguồn trang ghi sự cố được deploy lên nhưng cấu trúc cơ sở dữ liệu tương ứng chưa được chạy trên Supabase.
   - **Cách xử lý**: Sao chép nội dung file migration mới nhất (đường dẫn: [supabase/migrations/0002_incidents.sql](file:///d:/OS/supabase/migrations/0002_incidents.sql)), truy cập Supabase Dashboard -> `SQL Editor` -> tạo Query mới và bấm `Run`.

3. **Khi đổi loại sự cố**:
   - Không được tự ý chỉnh sửa cấu trúc enum bằng tay trên giao diện dashboard của Supabase.
   - Phải tạo một file migration SQL mới để cập nhật kiểu dữ liệu enum `incident_type` nhằm đảm bảo tính thống nhất trong lịch sử phiên bản cơ sở dữ liệu.

---

## 7. Hướng dẫn Vận hành & Bàn giao Hệ thống (Module Checklist & Báo Cáo Ca)

### 7.1. Cách thêm/sửa mục checklist
*   **Qua Giao Diện (Khuyên dùng)**: Người dùng có vai trò `owner` hoặc `manager` truy cập vào trang `/checklist` và chọn tab **Thiết Lập Mẫu**. Tại đây, bạn có thể:
    *   Thêm mới mục checklist (nhập nội dung, thứ tự hiển thị `item_order`, chọn ca `TRUA`/`TOI` và giai đoạn `MO_CA`/`DONG_CA`).
    *   Bật/Tắt trạng thái hoạt động (`is_active`) của từng mục mà không cần xóa để tránh làm mất lịch sử các ca cũ.
    *   Sửa đổi trực tiếp nội dung hoặc số thứ tự sắp xếp của từng mục.
*   **Qua SQL Editor (Supabase)**: Trong trường hợp cần thực hiện hàng loạt bằng SQL, có thể chạy mẫu lệnh sau:
    ```sql
    insert into checklist_templates (shift, phase, item_order, content, created_by)
    values ('TRUA', 'MO_CA', 10, 'Kiểm tra vệ sinh sảnh đón khách', '<ID_NHÂN_VIÊN>');
    ```

### 7.2. Quy trình khi Duty Manager quên gửi báo cáo ca
*   **Quy trình nhắc nhở**: Vào cuối mỗi ca (khoảng 14:30 đối với ca Trưa và 22:30 đối với ca Tối), Duty Manager ca tiếp theo hoặc Giám sát khu vực phải mở trang **Báo Cáo Tổng Hợp** (Dashboard) để kiểm tra cột trạng thái báo cáo ca. Nếu hiện **Chưa gửi**, cần nhắc nhở trực tiếp qua bộ đàm hoặc điện thoại để yêu cầu Duty Manager ca trước hoàn tất ngay.
*   **Trách nhiệm**: Duty Manager trực ca chịu trách nhiệm hoàn toàn về việc ghi nhận đầy đủ checklist và gửi báo cáo trước khi giao ca. Do báo cáo cuối ca là **Append-only** (sau khi gửi sẽ khóa, không cho phép sửa đổi qua app), Duty Manager phải rà soát kỹ lưỡng các thông tin (đặc biệt là việc bàn giao ca sau) trước khi bấm gửi.

### 7.3. Quy ước vận hành kênh thông tin
*   **Kênh trao đổi nhanh**: Kênh WhatsApp nội bộ vẫn duy trì để trao đổi nhanh, cập nhật thời gian thực các vấn đề phát sinh tức thời hoặc trao đổi nghiệp vụ nhanh.
*   **Báo cáo chính thức**: Báo cáo tổng kết ca và việc bàn giao ca sau **CHỈ TÍNH HỢP LỆ** trên hệ thống MVOS qua trang `/shift-report`. Mọi thông tin gửi tự do trên WhatsApp không được coi là báo cáo ca chính thức. Quy ước này đã được thống nhất với anh Thành (Owner) để làm cơ sở đánh giá chất lượng vận hành ca.


