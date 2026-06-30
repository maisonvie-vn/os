-- staff: ai được phép dùng MVOS
create table staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade unique,
  full_name text not null,
  role text not null default 'staff',   -- 'owner' | 'manager' | 'staff'
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- helper: staff row của user đang đăng nhập
create or replace function current_staff()
returns staff language sql stable security definer as $$
  select * from staff
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
$$;

-- helper: có phải owner không
create or replace function is_owner()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from staff
    where auth_user_id = auth.uid() and role = 'owner' and is_active = true
  );
$$;

-- RLS staff: user đọc chính mình; owner đọc tất cả; chỉ owner ghi
create policy staff_read on staff for select
  using (auth_user_id = auth.uid() or is_owner());
create policy staff_write on staff for all
  using (is_owner()) with check (is_owner());
