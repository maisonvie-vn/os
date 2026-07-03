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

---

## 8. Hướng dẫn Vận hành & Bàn giao Hệ thống (Module Khách & Agency)

### 8.1. Quy trình thêm agency mới và gộp tên thô (Merge Raw Entries)
*   **Ai thực hiện**: Owner hoặc Giám sát (vai trò `manager`).
*   **Khi nào thực hiện**: Mỗi tuần 1 lần (vào sáng Thứ 2) hoặc khi thấy danh sách tên thô chưa khớp xuất hiện nhiều.
*   **Cách gộp**:
    1.  Mở trang **Quản Lý Agency** (`/agencies`) -> chọn tab **Gộp Tên Thô**.
    2.  Tại đây sẽ hiện danh sách các tên agency do Duty Manager gõ tay (chưa chọn dropdown chuẩn) và số lần xuất hiện.
    3.  Chọn agency chuẩn từ danh sách thả xuống bên cạnh tên thô đó, sau đó bấm nút **Gộp**.
    4.  Hệ thống sẽ tự động cập nhật ID của agency chuẩn cho toàn bộ các lượt đón đoàn (group visits) và toàn bộ các sự cố (incidents) liên quan đến tên thô đó trong lịch sử dữ liệu, đồng thời dọn sạch tên thô.

### 8.2. Quy ước ghi nhận đoàn (Log Đoàn Hằng Ngày)
*   **Quy tắc 100%**: Duty Manager bắt buộc phải log **TẤT CẢ** các đoàn khách lữ hành/agency phục vụ trong ca tại trang `/visits`, **kể cả các đoàn không có sự cố**.
*   **Tại sao quan trọng**: Dữ liệu log đoàn đầy đủ làm mẫu số (denominator) để tính toán tỷ lệ sự cố và vẽ biểu đồ hiệu suất. Nếu Duty Manager chỉ log đoàn có sự cố, mọi tỷ lệ thống kê trên Dashboard sẽ bị sai lệch (tỷ lệ lỗi vọt lên 100% thay vì thực tế chỉ khoảng 1-2%).
*   **Kiểm soát chất lượng**: Cuối mỗi ca, Giám sát ca đối chiếu số lượng đoàn log trên MVOS với số liệu thực tế ghi nhận trên phần mềm hóa đơn/sổ đặt trước khi khóa ca.

### 8.3. Hướng dẫn đọc Dashboard "Sức Khỏe Agency" (Dành cho Owner)
*   Truy cập **Báo Cáo Tổng Hợp** (`/dashboard`) -> chọn tab **Sức Khỏe Agency**.
*   **Ý nghĩa các chỉ số**:
    *   **Tháng này vs Tháng trước**: So sánh số lượng đoàn và số lượng khách của từng agency để biết đối tác nào đang tăng trưởng hoặc sụt giảm doanh số (hiển thị mũi tên ↑↓ kèm chênh lệch pax).
    *   **Sự cố (180 ngày)**: Đếm số lượng sự cố lặp lại của từng agency để biết đoàn của họ hay gặp lỗi phục vụ/món ăn, hỗ trợ đàm phán giảm phàn nàn.
    *   **Lần cuối đón đoàn**: Thời gian từ ngày đoàn cuối cùng của agency đó ghé nhà hàng đến ngày xem báo cáo.
        *   🟢 **Mới đón (X ngày trước / Xanh)**: Quan hệ đối tác duy trì tốt.
        *   🟡 **Nguy cơ (>30 ngày / Vàng)**: Đối tác đã im lặng hơn 1 tháng. Owner cần lên kế hoạch gửi email, gọi điện hỏi thăm hoặc gửi ưu đãi mới.
        *   🔴 **Ngừng hoạt động (>60 ngày / Đỏ)**: Đối tác im lặng hơn 2 tháng, có dấu hiệu đã dịch chuyển đoàn sang đối thủ. Cần gọi điện trực tiếp hoặc tổ chức gặp mặt gấp để xử lý.



---

## 9. Hướng dẫn Vận hành & Bàn giao Hệ thống (Module Booking)

### 9.1. Quy trình tiếp nhận cuộc gọi đặt đoàn từ Agency
1.  **Bước 1 - Kiểm lịch**: Nhân viên tiếp nhận mở trang **Đặt Sảnh & Sự Kiện** (`/bookings`) để kiểm tra lưới lịch tuần (sảnh × khung giờ) xem có bị trùng lịch hay không.
2.  **Bước 2 - Tạo Tạm Đặt**: Nếu sảnh trống, bấm **Đặt chỗ mới** và lưu thông tin ở trạng thái **Tạm đặt (TENTATIVE)**. Điền đầy đủ số lượng khách (pax). Nếu pax vượt quá sức chứa của sảnh, giao diện sẽ hiện cảnh báo màu vàng nhưng vẫn cho phép tạo tạm.
3.  **Bước 3 - Xác Nhận/Chốt Đoàn**: Theo quy ước, chỉ Giám sát (`manager`) hoặc Chủ sở hữu (`owner`) mới có quyền chỉnh sửa trạng thái từ **TENTATIVE** sang **CONFIRMED** (Xác nhận) hoặc **CANCELLED** (Hủy bỏ).

### 9.2. Cảnh báo quá hạn 48h trên Dashboard
*   Đoàn tạm đặt (TENTATIVE) có thời gian tạo quá 48 giờ mà chưa được chuyển sang CONFIRMED hoặc CANCELLED sẽ tự động bị tô vàng cảnh báo nguy cơ trễ lịch trên Dashboard của Owner. Giám sát ca phải rà soát mục này hằng ngày để liên hệ chốt giữ chỗ hoặc giải phóng sảnh.

---

## 10. Hướng dẫn Vận hành & Bàn giao Hệ thống (Module Kho & Đối chiếu 3 chân)

### 10.1. Quy trình mua hàng & nhập kho 3 chân (PO ↔ GR ↔ Invoice)
MVOS tự động hóa quy trình kiểm soát thất thoát mua hàng thông qua chuỗi đối chiếu độc lập giữa 3 vai trò:
1.  **Đặt hàng (PO)**: Người mua hàng (quy ước là Nam) tạo đơn đặt hàng PO tại trang `/purchasing`, điền mặt hàng, đơn vị tính, số lượng và đơn giá dự kiến.
2.  **Nhận hàng (GR)**: Người nhận hàng (quy ước là Linh) mở trang `/receiving`, chọn PO tương ứng và nhập số lượng thực nhận khi giao hàng.
    *   **Nguyên tắc vạch đỏ**: Nếu số lượng thực nhận lệch so với số lượng đặt trên PO, Linh **bắt buộc** phải nhập ghi chú chênh lệch (ví dụ: thiếu 0.5kg thịt bò do dập nát) thì hệ thống mới cho phép lưu phiếu kho.
3.  **Hóa đơn (Invoice)**: Kế toán (hoặc người phụ trách nhập liệu) mở trang `/invoices` để nhập thông tin hóa đơn đỏ giao từ nhà cung cấp (số hóa đơn, ngày, tổng tiền thanh toán thực tế).
4.  **Duyệt chi (Approvals)**: Anh Thành (Owner) mở trang **Duyệt Chi Hóa Đơn** (`/approvals`) để duyệt tiền. Hệ thống tự động so khớp chéo dòng mặt hàng và cảnh báo đỏ nếu phát hiện lệch số lượng hoặc ghi nhận chênh lệch ở kho, hoặc hóa đơn không đi kèm PO. Anh Thành chọn **APPROVED** để đồng ý chi tiền, **REJECTED** để bác bỏ, hoặc **HOLD** để tạm hoãn điều tra.

### 10.2. Quy tắc bảo mật giá nhập (Owner Only)
*   **Bảo mật dữ liệu**: Đơn giá mặt hàng (`unit_price`) và tổng tiền hóa đơn (`total_amount`) là thông tin tuyệt mật, chỉ có tài khoản Chủ sở hữu (`owner`) được quyền đọc trực tiếp.
*   **Kỹ thuật tách cột**: Các nhân viên thông thường truy cập dữ liệu PO và hóa đơn thông qua các database views (`po_lines_public`, `invoices_public`) đã được lược bỏ cột tiền bằng hàm `security definer`.

### 10.3. Nguyên tắc APPEND-ONLY tuyệt đối đối với số liệu tiền tệ
*   Để phòng tránh gian lận sửa số liệu sau khi duyệt chi, mọi bảng liên quan đến tiền (`purchase_orders`, `po_lines`, `goods_receipts`, `gr_lines`, `invoices_in`, `payment_approvals`) đều được bật RLS và **không cấu hình chính sách cho phép UPDATE hoặc DELETE**.
*   **Quy trình sửa sai (Bút toán đảo)**: Nếu nhập sai hóa đơn hoặc PO, kế toán không thể sửa bản ghi cũ. Quy trình bắt buộc là phải nhập một bản ghi mới có giá trị âm hoặc bản ghi đính chính tương ứng để trừ/đảo số liệu cũ, đi kèm ghi chú lý do rõ ràng.

---

## 11. Hướng dẫn Vận hành & Bàn giao Hệ thống (Module Nhân sự & SOP)

### 11.1. Quy trình Onboard nhân viên mới và Cam kết quy trình
1.  **Bước 1 - Tạo tài khoản**: Tạo user đăng nhập cho nhân viên trên Supabase.
2.  **Bước 2 - Tạo staff**: Thêm UID của nhân viên vào bảng `staff` trên Supabase SQL Editor.
3.  **Bước 3 - Hồ sơ nhân sự**: Manager/Owner mở trang `/team`, chọn nhân viên mới và cập nhật hồ sơ chi tiết (vị trí công việc, bộ phận FOH/BOH/OFFICE, ngày bắt đầu, số điện thoại liên hệ khẩn cấp).
4.  **Bước 4 - Đọc & Cam kết SOP**: Nhân viên đăng nhập vào tài khoản của mình, truy cập thư viện tại trang `/sops` để học các quy trình phục vụ và công thức món chuẩn (SPEC), sau đó bấm nút **Tôi đã đọc và cam kết**.
5.  **Bước 5 - Giám sát**: Owner mở **Báo Cáo Tổng Hợp** (`/dashboard`) -> tab **Ký SOP Đội Ngũ** để xem danh sách nhân sự chưa bấm xác nhận cam kết theo từng tài liệu.

### 11.2. Quy định khi thay đổi SOP/SPEC
*   Khi có sự thay đổi quy trình hoặc công thức món ăn, Giám sát không được sửa đè lên nội dung SOP cũ. Phải đăng một tài liệu mới có phiên bản (`version`) cao hơn. Khi đó, hệ thống sẽ tự động yêu cầu toàn bộ nhân viên thuộc bộ phận liên quan phải thực hiện bấm đọc và ký cam kết lại từ đầu cho phiên bản mới.

---

## 12. Hướng dẫn Vận hành & Bàn giao Hệ thống (Module Báo cáo Tài chính)

### 12.1. Quy trình nhập doanh thu POS hằng ngày
*   Do chưa tích hợp trực tiếp API với POS của nhà hàng, cuối mỗi ngày kinh doanh (sau khi đóng sổ ca tối), Owner hoặc người được ủy quyền (kế toán) phải mở trang **Tài Chính & Doanh Thu** (`/finance`) để nhập thủ công doanh thu POS (ngày kinh doanh, tổng doanh thu thực tế, số lượng khách giao dịch và ghi chú đối chiếu).
*   Bảng doanh thu ngày là **Append-only**. Nếu nhập nhầm số liệu, phải nhập bản ghi đính chính điều chỉnh chênh lệch cho ngày đó thay vì tìm cách sửa đè.

### 12.2. Ý nghĩa 4 khối chỉ số tài chính trên trang `/finance`
1.  **Tổng Doanh Thu POS**: Tổng số tiền thực tế ghi nhận từ POS trong khoảng thời gian đã nhập.
2.  **Chi Phí Mua Hàng**: Tổng số tiền của các hóa đơn nhà cung cấp đầu vào đã được Owner bấm **APPROVED** duyệt chi. Giúp đối chiếu cán cân thu chi thực tế của nhà hàng.
3.  **Đoàn & Khách phục vụ**: Thống kê số lượng đoàn lữ hành và tổng lượng khách hàng thực tế đã được phục vụ để đo lường công suất hoạt động.
4.  **Tỷ Lệ Sự Cố Bình Quân**: Tỷ lệ phần trăm sự cố phát sinh trên mỗi lượt đoàn phục vụ, giúp Owner giám sát chất lượng dịch vụ từ xa mà không cần túc trực tại nhà hàng.
