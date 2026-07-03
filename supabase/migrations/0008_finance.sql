create table daily_revenue (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  gross_revenue numeric not null check (gross_revenue >= 0),
  guest_count int,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references staff(id)
);

alter table daily_revenue enable row level security;

-- read: only owner
create policy dr_select on daily_revenue for select using (
  is_owner()
);

-- insert: only owner
create policy dr_insert on daily_revenue for insert with check (
  is_owner()
);

-- Seed 7 days of daily revenue
do $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id from staff where is_active = true and role = 'owner' limit 1;

  if v_staff_id is not null then
    insert into daily_revenue (business_date, gross_revenue, guest_count, note, created_by) values
    (current_date - interval '7 days', 18500000, 92, 'POS Doanh thu ngày ' || (current_date - interval '7 days')::date::text, v_staff_id),
    (current_date - interval '6 days', 15200000, 78, 'POS Doanh thu ngày ' || (current_date - interval '6 days')::date::text, v_staff_id),
    (current_date - interval '5 days', 19800000, 105, 'POS Doanh thu ngày ' || (current_date - interval '5 days')::date::text, v_staff_id),
    (current_date - interval '4 days', 22400000, 110, 'POS Doanh thu ngày ' || (current_date - interval '4 days')::date::text, v_staff_id),
    (current_date - interval '3 days', 25100000, 128, 'POS Doanh thu ngày ' || (current_date - interval '3 days')::date::text, v_staff_id),
    (current_date - interval '2 days', 31500000, 142, 'POS Doanh thu ngày ' || (current_date - interval '2 days')::text, v_staff_id),
    (current_date - interval '1 days', 28900000, 131, 'POS Doanh thu ngày ' || (current_date - interval '1 days')::text, v_staff_id)
    on conflict (business_date) do nothing;
  end if;
end $$;
