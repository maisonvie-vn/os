-- Migration: Document Archive Management (0015_document_archive.sql)

-- 1. Create document types and categories
create type doc_category as enum (
  'GIAY_PHEP',        -- ATTP, PCCC, ĐKKD, môi trường, biển hiệu...
  'HOP_DONG',         -- thuê nhà, NCC lớn, bảo hiểm, lao động
  'CONG_VAN',         -- văn bản đến/đi với cơ quan
  'THANH_TRA',        -- biên bản, kết luận, quyết định
  'QUY_DINH',         -- văn bản luật/nghị định/thông tư liên quan ngành
  'NOI_BO'            -- quy chế, quyết định nội bộ đã ban hành
);

create type doc_confidentiality as enum ('CONG_KHAI','QUAN_LY','CHU_SO_HUU');
-- CONG_KHAI: mọi staff đọc (vd quy định ngành)
-- QUAN_LY: manager + owner (vd công văn, giấy phép)
-- CHU_SO_HUU: chỉ owner (vd hợp đồng thuê nhà, hồ sơ nhạy cảm)

-- 2. Create document records table
create table document_records (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category doc_category not null,
  authority text,                        -- cơ quan liên quan: 'Chi cục ATTP HN'...
  doc_number text,                       -- số hiệu văn bản nếu có
  issued_on date,
  expires_on date,                       -- nullable: công văn không có hạn
  confidentiality doc_confidentiality not null default 'QUAN_LY',
  license_id uuid references licenses(id),   -- gắn giấy phép 0013 nếu là bản scan của nó
  responsible_staff_id uuid references staff(id),
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);
create index idx_docs_category on document_records(category);
create index idx_docs_expiry on document_records(expires_on);

-- 3. Create document files table (append-only)
create table document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document_records(id),
  file_path text not null,               -- đường dẫn trong bucket 'documents'
  file_name text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references staff(id)
);

-- 4. Enable RLS
alter table document_records enable row level security;
alter table document_files enable row level security;

-- 5. Row Level Security policies for document_records
create policy dr_read on document_records for select using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid() and s.is_active
    and (
      document_records.confidentiality = 'CONG_KHAI'
      or (document_records.confidentiality = 'QUAN_LY' and s.role in ('owner','manager'))
      or (document_records.confidentiality = 'CHU_SO_HUU' and s.role = 'owner')
    )));

create policy dr_write on document_records for insert with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')));

create policy dr_update on document_records for update using (
  exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')));

-- 6. Row Level Security policies for document_files (append-only: no update/delete)
create policy df_read on document_files for select using (
  exists (
    select 1 from document_records dr
    join staff s on s.auth_user_id = auth.uid()
    where dr.id = document_files.document_id
      and s.is_active
      and (
        dr.confidentiality = 'CONG_KHAI'
        or (dr.confidentiality = 'QUAN_LY' and s.role in ('owner','manager'))
        or (dr.confidentiality = 'CHU_SO_HUU' and s.role = 'owner')
      )
  )
);

create policy df_insert on document_files for insert with check (
  exists (select 1 from staff s where s.auth_user_id = auth.uid()
          and s.is_active and s.role in ('owner','manager')));

-- 7. Cấu hình Storage Bucket 'documents' làm private
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Policies cho storage.objects tương ứng với bucket 'documents'
-- Insert: Chỉ quản lý (manager) hoặc chủ sở hữu (owner) hoạt động mới được tải lên
create policy "Upload documents bucket"
on storage.objects for insert
with check (
  bucket_id = 'documents'
  and exists (
    select 1 from staff s
    where s.auth_user_id = auth.uid()
      and s.is_active
      and s.role in ('owner','manager')
  )
);

-- Select: Đọc tệp dựa trên phân quyền bảo mật (confidentiality) của tài liệu cha
create policy "Read documents bucket"
on storage.objects for select
using (
  bucket_id = 'documents'
  and exists (
    select 1 from document_files df
    join document_records dr on dr.id = df.document_id
    join staff s on s.auth_user_id = auth.uid()
    where df.file_path = name
      and s.is_active
      and (
        dr.confidentiality = 'CONG_KHAI'
        or (dr.confidentiality = 'QUAN_LY' and s.role in ('owner','manager'))
        or (dr.confidentiality = 'CHU_SO_HUU' and s.role = 'owner')
      )
  )
);
