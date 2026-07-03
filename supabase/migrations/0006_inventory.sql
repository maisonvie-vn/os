create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact text, phone text, note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);

create type po_status as enum ('DRAFT','SENT','RECEIVED_PARTIAL','RECEIVED_FULL','CLOSED');

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,        -- sinh tự động PO-YYYYMMDD-XX
  supplier_id uuid not null references suppliers(id),
  status po_status not null default 'DRAFT',
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)   -- Nam
);

create table po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id),
  item_name text not null,
  unit text not null,
  qty_ordered numeric not null check (qty_ordered > 0),
  unit_price numeric,                     -- CHỈ owner đọc (qua view)
  created_at timestamptz not null default now()
);

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id),
  received_at timestamptz not null default now(),
  received_by uuid not null references staff(id), -- Linh
  note text
);

create table gr_lines (
  id uuid primary key default gen_random_uuid(),
  gr_id uuid not null references goods_receipts(id),
  po_line_id uuid not null references po_lines(id),
  qty_received numeric not null check (qty_received >= 0),
  discrepancy_note text                   -- lệch thì ghi tại chỗ
);

create table invoices_in (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  po_id uuid references purchase_orders(id),
  invoice_number text not null,
  invoice_date date not null,
  total_amount numeric not null check (total_amount >= 0),  -- CHỈ owner đọc
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id),
  unique (supplier_id, invoice_number)
);

create type approval_decision as enum ('APPROVED','REJECTED','HOLD');

create table payment_approvals (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices_in(id) unique,
  decision approval_decision not null,
  decided_at timestamptz not null default now(),
  decided_by uuid not null references staff(id),  -- PHẢI là owner (RLS ép)
  note text
);

-- Enable RLS
alter table suppliers enable row level security;
alter table purchase_orders enable row level security;
alter table po_lines enable row level security;
alter table goods_receipts enable row level security;
alter table gr_lines enable row level security;
alter table invoices_in enable row level security;
alter table payment_approvals enable row level security;

-- suppliers
create policy sup_select on suppliers for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
create policy sup_insert on suppliers for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true and role in ('owner', 'manager'))
);

-- purchase_orders
create policy po_select on purchase_orders for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
create policy po_insert on purchase_orders for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- po_lines: select is owner-only, insert is active staff
create policy pol_select on po_lines for select using (
  is_owner()
);
create policy pol_insert on po_lines for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- goods_receipts
create policy gr_select on goods_receipts for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
create policy gr_insert on goods_receipts for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- gr_lines
create policy grl_select on gr_lines for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
create policy grl_insert on gr_lines for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- invoices_in: select is owner-only, insert is active staff
create policy inv_select on invoices_in for select using (
  is_owner()
);
create policy inv_insert on invoices_in for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- payment_approvals: select is owner-only, insert is owner-only
create policy pa_select on payment_approvals for select using (
  is_owner()
);
create policy pa_insert on payment_approvals for insert with check (
  is_owner() and decided_by = (select id from current_staff())
);

-- Security definer functions to let non-owner staff view non-sensitive columns
create or replace function get_po_lines_public()
returns table (
  id uuid,
  po_id uuid,
  item_name text,
  unit text,
  qty_ordered numeric,
  created_at timestamptz
) language plpgsql security definer as $$
begin
  if exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true) then
    return query select p.id, p.po_id, p.item_name, p.unit, p.qty_ordered, p.created_at from po_lines p;
  end if;
end;
$$;

create or replace view po_lines_public as
select * from get_po_lines_public();

create or replace function get_invoices_public()
returns table (
  id uuid,
  supplier_id uuid,
  po_id uuid,
  invoice_number text,
  invoice_date date,
  note text,
  created_at timestamptz,
  created_by uuid
) language plpgsql security definer as $$
begin
  if exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true) then
    return query select i.id, i.supplier_id, i.po_id, i.invoice_number, i.invoice_date, i.note, i.created_at, i.created_by from invoices_in i;
  end if;
end;
$$;

create or replace view invoices_public as
select * from get_invoices_public();

-- Seed suppliers
do $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id from staff where is_active = true order by role = 'owner' desc, role = 'manager' desc limit 1;

  if v_staff_id is not null then
    insert into suppliers (name, contact, phone, note, created_by) values
    ('Đà Lạt Gap', 'Anh Tuấn', '0912000111', 'Nhà cung cấp rau củ quả hữu cơ', v_staff_id),
    ('Meat Deli', 'Chị Hạnh', '0903222333', 'Nhà cung cấp thịt heo, thịt bò sạch', v_staff_id),
    ('Metro Wholesale', 'Phòng Kinh Doanh', '0243999888', 'Nhà cung cấp gia vị, hàng khô', v_staff_id)
    on conflict (name) do nothing;
  end if;
end $$;

-- Security definer transaction for goods receipt ingestion & PO status update
create or replace function create_goods_receipt(
  p_po_id uuid,
  p_received_by uuid,
  p_note text,
  p_lines jsonb
) returns uuid language plpgsql security definer as $$
declare
  v_gr_id uuid;
  v_line jsonb;
  v_all_received boolean := true;
  v_any_received boolean := false;
  v_qty_ordered numeric;
  v_qty_received numeric;
  v_po_line_id uuid;
begin
  -- 1. Insert goods receipt
  insert into goods_receipts (po_id, received_by, note)
  values (p_po_id, p_received_by, p_note)
  returning id into v_gr_id;

  -- 2. Insert gr lines
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_po_line_id := (v_line->>'po_line_id')::uuid;
    v_qty_received := (v_line->>'qty_received')::numeric;

    insert into gr_lines (gr_id, po_line_id, qty_received, discrepancy_note)
    values (v_gr_id, v_po_line_id, v_qty_received, v_line->>'discrepancy_note');

    -- Get ordered qty to compare
    select qty_ordered into v_qty_ordered from po_lines where id = v_po_line_id;

    if v_qty_received >= v_qty_ordered then
      v_any_received := true;
    elsif v_qty_received > 0 then
      v_any_received := true;
      v_all_received := false;
    else
      v_all_received := false;
    end if;
  end loop;

  -- 3. Update PO status
  if v_all_received then
    update purchase_orders set status = 'RECEIVED_FULL' where id = p_po_id;
  elsif v_any_received then
    update purchase_orders set status = 'RECEIVED_PARTIAL' where id = p_po_id;
  end if;

  return v_gr_id;
end;
$$;

