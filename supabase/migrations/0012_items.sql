-- Create items table
create table items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null,
  category text not null check (category in ('DRY', 'FRESH', 'BEVERAGE', 'SUPPLIES')),
  min_qty numeric not null default 0 check (min_qty >= 0),
  max_qty numeric check (max_qty >= min_qty),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table items enable row level security;

-- Policies for items
create policy items_select on items for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

create policy items_write on items for all using (
  exists (select 1 from staff where auth_user_id = auth.uid() and role in ('owner', 'manager') and is_active = true)
);

-- Alter po_lines and gr_lines tables to add item_id
alter table po_lines add column item_id uuid references items(id) on delete set null;
alter table gr_lines add column item_id uuid references items(id) on delete set null;

-- Seed 30+ standardized items
insert into items (name, unit, category, min_qty, max_qty) values
-- FRESH
('Thịt bò Tenderloin', 'kg', 'FRESH', 5, 20),
('Thịt ba chỉ heo', 'kg', 'FRESH', 10, 30),
('Cá hồi Nauy', 'kg', 'FRESH', 3, 10),
('Tôm sú tươi', 'kg', 'FRESH', 5, 15),
('Cà chua Đà Lạt', 'kg', 'FRESH', 5, 25),
('Hành tây', 'kg', 'FRESH', 5, 20),
('Hành lá', 'kg', 'FRESH', 2, 8),
('Tỏi củ', 'kg', 'FRESH', 3, 10),
('Ớt chỉ thiên', 'kg', 'FRESH', 1, 5),
('Chanh tươi', 'kg', 'FRESH', 2, 10),
('Sả cây', 'kg', 'FRESH', 2, 8),
('Rau xà lách', 'kg', 'FRESH', 3, 12),
-- DRY
('Nước mắm Nam Ngư', 'chai', 'DRY', 5, 20),
('Hạt tiêu đen xay', 'kg', 'DRY', 1, 5),
('Đường cát trắng', 'kg', 'DRY', 10, 50),
('Muối tinh sấy', 'kg', 'DRY', 5, 25),
('Dầu ăn Simply 5L', 'can', 'DRY', 4, 16),
('Mì chính Ajinomoto', 'kg', 'DRY', 2, 10),
('Gạo tám thơm', 'kg', 'DRY', 50, 200),
('Sữa đặc Ông Thọ', 'lon', 'DRY', 12, 48),
('Cà phê hạt Robusta', 'kg', 'DRY', 5, 25),
-- BEVERAGE
('Bia Hà Nội lon', 'thùng', 'BEVERAGE', 10, 40),
('Heineken bạc lon', 'thùng', 'BEVERAGE', 10, 35),
('Coca Cola lon', 'thùng', 'BEVERAGE', 10, 40),
('Nước suối Aquafina 500ml', 'thùng', 'BEVERAGE', 15, 60),
('Rượu vang đỏ Bordeaux', 'chai', 'BEVERAGE', 6, 24),
-- SUPPLIES
('Khăn lạnh Maison Vie', 'cái', 'SUPPLIES', 200, 1000),
('Giấy ăn rút', 'gói', 'SUPPLIES', 20, 80),
('Nước rửa bát Sunlight', 'can', 'SUPPLIES', 2, 8),
('Cồn thạch nấu lẩu', 'thùng', 'SUPPLIES', 3, 12),
('Màng bọc thực phẩm', 'cuộn', 'SUPPLIES', 5, 20)
on conflict (name) do nothing;

-- Recreate create_goods_receipt to copy item_id from po_lines to gr_lines
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
  v_item_id uuid;
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

    -- Get item_id and ordered qty from po_lines
    select item_id, qty_ordered into v_item_id, v_qty_ordered from po_lines where id = v_po_line_id;

    insert into gr_lines (gr_id, po_line_id, item_id, qty_received, discrepancy_note)
    values (v_gr_id, v_po_line_id, v_item_id, v_qty_received, v_line->>'discrepancy_note');

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
