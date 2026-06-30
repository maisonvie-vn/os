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

Sau khi tài khoản người dùng đăng ký/đăng nhập lần đầu bằng email magic link qua trang `/login`, họ sẽ được tạo một bản ghi `uid` tương ứng trong bảng `auth.users` của Supabase.

Để cấp quyền Chủ sở hữu (Owner) cho tài khoản có email của anh Thành, chạy lệnh SQL sau trong **SQL Editor** trên Supabase (thay thế `<uuid>` bằng ID thực tế của user trong bảng `auth.users`):

```sql
insert into staff(auth_user_id, full_name, role) 
values ('<uuid>', 'Thành', 'owner');
```
