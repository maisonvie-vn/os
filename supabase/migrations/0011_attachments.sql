-- Create storage bucket invoices as private
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- Create invoice_attachments table (append-only)
create table invoice_attachments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices_in(id) on delete cascade,
  file_path text not null,
  uploaded_by uuid not null references staff(id),
  uploaded_at timestamptz not null default now()
);

-- Enable RLS
alter table invoice_attachments enable row level security;

-- Policies for invoice_attachments (select: active staff; insert: active staff; update/delete: blocked)
create policy ia_select on invoice_attachments for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

create policy ia_insert on invoice_attachments for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- Policies for storage.objects (for private bucket 'invoices')
-- Insert: active staff can upload
create policy "Upload invoice attachments"
on storage.objects for insert
with check (
  bucket_id = 'invoices'
  and exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- Select: active staff can read (to fetch signed URL)
create policy "Read invoice attachments"
on storage.objects for select
using (
  bucket_id = 'invoices'
  and exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
