-- Create email templates table
create table email_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null unique check (type in ('CONFIRMATION', 'THANK_YOU', 'APOLOGY', 'HOLIDAY')),
  name text not null,
  template_vi text not null,
  template_en text not null,
  template_fr text not null,
  created_at timestamptz not null default now()
);

-- Create email drafts table
create table email_drafts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id) on delete set null,
  type text not null check (type in ('CONFIRMATION', 'THANK_YOU', 'APOLOGY', 'HOLIDAY')),
  subject text not null,
  body_vi text not null,
  body_en text not null,
  body_fr text,
  created_by uuid not null references staff(id),
  created_at timestamptz not null default now(),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'COPIED'))
);

-- Enable RLS
alter table email_templates enable row level security;
alter table email_drafts enable row level security;

-- Policies for email_templates: all active staff can select, only owner/manager can write
create policy et_select on email_templates for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
create policy et_write on email_templates for all using (
  exists (select 1 from staff where auth_user_id = auth.uid() and role in ('owner', 'manager') and is_active = true)
);

-- Policies for email_drafts: all active staff can select and insert
create policy ed_select on email_drafts for select using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
create policy ed_insert on email_drafts for insert with check (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);
create policy ed_update on email_drafts for update using (
  exists (select 1 from staff where auth_user_id = auth.uid() and is_active = true)
);

-- Seed 4 corporate templates
insert into email_templates (type, name, template_vi, template_en, template_fr) values
(
  'CONFIRMATION',
  'Xác nhận đặt lịch đoàn',
  'Kính gửi quý đối tác {agency_name},\n\nMaison Vie xin trân trọng xác nhận lịch đặt sảnh cho đoàn "{group_name}" vào ngày {event_date} phục vụ {pax} khách.\n\nThông tin chi tiết dịch vụ đã được chuẩn bị chu đáo theo yêu cầu của quý đối tác. Chúng tôi rất hân hạnh được đón tiếp đoàn.\n\n{custom_note}\n\nTrân trọng,\nBan quản lý Maison Vie',
  'Dear Partner {agency_name},\n\nMaison Vie is pleased to confirm the reservation for group "{group_name}" on {event_date} for {pax} guests.\n\nAll services have been meticulously arranged as per your request. We look forward to welcoming your guests.\n\n{custom_note}\n\nBest regards,\nMaison Vie Management',
  'Chère Agence {agency_name},\n\nMaison Vie a le plaisir de confirmer la réservation pour le groupe "{group_name}" le {event_date} pour {pax} couverts.\n\nTous les services ont été soigneusement préparés selon vos exigences. Nous serons ravis d''accueillir vos clients.\n\n{custom_note}\n\nCordialement,\nLa direction de Maison Vie'
),
(
  'THANK_YOU',
  'Thư cảm ơn sau đoàn',
  'Kính gửi quý đối tác {agency_name},\n\nMaison Vie xin chân thành cảm ơn quý đối tác đã đồng hành cùng chúng tôi phục vụ đoàn "{group_name}" vào ngày {event_date} vừa qua.\n\nSự ủng hộ và hợp tác của quý vị là nguồn động lực to lớn giúp Maison Vie không ngừng nâng cao chất lượng dịch vụ. Rất mong được tiếp tục hợp tác cùng quý đối tác trong các sự kiện tiếp theo.\n\n{custom_note}\n\nTrân trọng,\nBan quản lý Maison Vie',
  'Dear Partner {agency_name},\n\nMaison Vie would like to sincerely thank you for cooperating with us to host group "{group_name}" on {event_date}.\n\nYour partnership is highly valued and drives our continuous improvement. We look forward to welcoming more of your groups in the near future.\n\n{custom_note}\n\nBest regards,\nMaison Vie Management',
  'Chère Agence {agency_name},\n\nMaison Vie tient à vous remercier sincèrement pour votre collaboration lors de l''accueil du groupe "{group_name}" le {event_date} dernier.\n\nVotre confiance nous motive à maintenir notre haut niveau d''excellence. Nous espérons vous revoir très bientôt pour de nouveaux événements.\n\n{custom_note}\n\nCordialement,\nLa direction de Maison Vie'
),
(
  'APOLOGY',
  'Thư xin lỗi & Khắc phục sự cố',
  'Kính gửi quý đối tác {agency_name},\n\nMaison Vie xin chân thành cáo lỗi cùng quý đối tác về sự cố ngoài ý muốn liên quan đến đoàn "{group_name}" phục vụ vào ngày {event_date}.\n\nChúng tôi đã nghiêm túc rà soát nội bộ và cam kết khắc phục triệt để. Maison Vie hy vọng quý đối tác lượng thứ và tiếp tục trao cơ hội đồng hành.\n\n{custom_note}\n\nTrân trọng,\nBan quản lý Maison Vie',
  'Dear Partner {agency_name},\n\nMaison Vie sincerely apologizes for the unfortunate incident regarding group "{group_name}" on {event_date}.\n\nWe have conducted a thorough internal review to prevent recurrence. We deeply value your partnership and hope for your understanding.\n\n{custom_note}\n\nBest regards,\nMaison Vie Management',
  'Chère Agence {agency_name},\n\nMaison Vie vous présente ses excuses les plus sincères pour l''incident survenu avec le groupe "{group_name}" le {event_date}.\n\nNous avons mené une enquête interne rigoureuse pour garantir que cela ne se reproduise plus. Nous espérons conserver votre confiance.\n\n{custom_note}\n\nCordialement,\nLa direction de Maison Vie'
),
(
  'HOLIDAY',
  'Chúc mừng dịp lễ tết',
  'Kính gửi quý đối tác {agency_name},\n\nNhân dịp mùa lễ hội, Maison Vie xin gửi tới quý đối tác lời chúc mừng nồng nhiệt nhất. Chúc quý công ty ngày càng phát triển, vạn sự hanh thông và gặt hái nhiều thành công rực rỡ.\n\nCảm ơn quý đối tác đã luôn đồng hành cùng Maison Vie trong suốt thời gian qua.\n\n{custom_note}\n\nTrân trọng,\nBan quản lý Maison Vie',
  'Dear Partner {agency_name},\n\nOn the occasion of the festive season, Maison Vie wishes you a joy-filled holiday and a prosperous New Year. May your company reach new heights of success in the coming year.\n\nThank you for your valuable support and partnership.\n\n{custom_note}\n\nBest regards,\nMaison Vie Management',
  'Chère Agence {agency_name},\n\nÀ l''occasion des fêtes de fin d''année, Maison Vie vous adresse ses voeux les plus chaleureux de bonheur, de santé et de réussite. Que votre entreprise prospère davantage l''année prochaine.\n\nMerci pour votre fidélité et votre précieux partenariat.\n\n{custom_note}\n\nCordialement,\nLa direction de Maison Vie'
)
on conflict (type) do nothing;
