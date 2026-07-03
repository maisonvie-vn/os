"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

interface Staff {
  id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  employee_profiles?: EmployeeProfile | null;
}

interface EmployeeProfile {
  staff_id: string;
  position: string | null;
  department: "FOH" | "BOH" | "OFFICE" | null;
  start_date: string | null;
  phone: string | null;
  emergency_contact: string | null;
  note: string | null;
}

function TeamContent() {
  const router = useRouter();
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Form states
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState<"FOH" | "BOH" | "OFFICE">("FOH");
  const [startDate, setStartDate] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [note, setNote] = useState("");

  const [formFeedback, setFormFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Auth check (manager/owner only)
  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: staffData } = await supabase
        .from("staff")
        .select("*, employee_profiles(*)")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (!staffData || !staffData.is_active || (staffData.role !== "owner" && staffData.role !== "manager")) {
        router.push("/home");
        return;
      }

      setCurrentStaff(staffData);
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  // 2. Fetch all staff with profiles
  const fetchStaffData = async () => {
    setIsLoading(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("staff")
        .select("*, employee_profiles(*)")
        .eq("is_active", true)
        .order("full_name", { ascending: true });

      if (error) throw error;
      if (data) setStaffList(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!checkingAuth && currentStaff) {
      fetchStaffData();
    }
  }, [checkingAuth, currentStaff]);

  // Open edit profile
  const handleEditProfile = (staff: Staff) => {
    setSelectedStaff(staff);
    const p = staff.employee_profiles;
    setPosition(p?.position || "");
    setDepartment(p?.department || "FOH");
    setStartDate(p?.start_date || "");
    setPhone(p?.phone || "");
    setEmergencyContact(p?.emergency_contact || "");
    setNote(p?.note || "");
    setFormFeedback(null);
  };

  // Submit profile edit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentStaff || !selectedStaff || isSubmitting) return;

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("employee_profiles")
        .upsert({
          staff_id: selectedStaff.id,
          position: position.trim() || null,
          department,
          start_date: startDate || null,
          phone: phone.trim() || null,
          emergency_contact: emergencyContact.trim() || null,
          note: note.trim() || null,
          updated_at: new Date().toISOString(),
          updated_by: currentStaff.id,
        });

      if (error) throw error;

      setFormFeedback({ type: "success", text: "Lưu hồ sơ nhân sự thành công ✓" });
      await fetchStaffData();
      
      setTimeout(() => {
        setSelectedStaff(null);
        setFormFeedback(null);
      }, 1000);
    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi DB: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 text-sm">Đang xác thực quyền truy cập...</div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 pb-16">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-900 bg-zinc-950/80 px-6 py-4 backdrop-blur flex items-center justify-between">
        <button
          onClick={() => router.push("/home")}
          className="flex items-center space-x-1 text-sm text-zinc-400 hover:text-white transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Trang chủ</span>
        </button>
        <h1 className="text-base font-bold text-white">Quản Lý Hồ Sơ Nhân Sự</h1>
        <div className="w-16"></div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Team Members List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5">
            <h3 className="text-sm font-bold text-white mb-4">Danh sách Thành viên Nhóm</h3>

            {isLoading ? (
              <div className="text-center py-8 text-zinc-500 text-xs">Đang tải hồ sơ nhân viên...</div>
            ) : staffList.length === 0 ? (
              <div className="text-center py-8 text-zinc-600 text-xs italic">Chưa có thành viên nào hoạt động.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="bg-zinc-900/50 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                    <tr>
                      <th className="py-3 px-4">Tên Nhân Viên</th>
                      <th className="py-3 px-4">Bộ phận</th>
                      <th className="py-3 px-4">Vị trí</th>
                      <th className="py-3 px-4">Điện thoại</th>
                      <th className="py-3 px-4">Hệ Thống Role</th>
                      <th className="py-3 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-850">
                    {staffList.map((member) => (
                      <tr key={member.id} className="hover:bg-zinc-900/20 transition">
                        <td className="py-3.5 px-4 font-bold text-zinc-200">
                          {member.full_name}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-350">
                          {member.employee_profiles?.department || "—"}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-400">
                          {member.employee_profiles?.position || "—"}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-zinc-450">
                          {member.employee_profiles?.phone || "—"}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            member.role === "owner"
                              ? "bg-amber-950/60 border-amber-900 text-amber-450"
                              : member.role === "manager"
                              ? "bg-indigo-950/60 border-indigo-900 text-indigo-400"
                              : "bg-zinc-800 border-zinc-750 text-zinc-450"
                          }`}>
                            {member.role === "owner" ? "Owner" : member.role === "manager" ? "Manager" : "Staff"}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => handleEditProfile(member)}
                            className="text-[10px] font-bold text-amber-500 hover:underline"
                          >
                            Hồ sơ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Profile Editor Card */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 sticky top-24">
            <h3 className="text-sm font-bold text-white mb-4">✍️ Chi tiết & Cập nhật Hồ Sơ</h3>

            {selectedStaff ? (
              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                <div className="border-b border-zinc-850 pb-3">
                  <span className="text-[10px] text-zinc-550 block uppercase tracking-wider font-bold">Đang cập nhật cho</span>
                  <span className="text-base font-bold text-white">{selectedStaff.full_name}</span>
                </div>

                <div>
                  <label htmlFor="epPosition" className="block text-xs font-semibold text-zinc-400 mb-1">Vị trí công việc</label>
                  <input
                    id="epPosition"
                    type="text"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="Ví dụ: Phục vụ, Bếp nóng, Thu ngân..."
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label htmlFor="epDepartment" className="block text-xs font-semibold text-zinc-400 mb-1">Bộ phận phòng ban</label>
                  <select
                    id="epDepartment"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value as any)}
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-xs text-white"
                  >
                    <option value="FOH">Front of House (FOH) - Phục vụ/Sảnh</option>
                    <option value="BOH">Back of House (BOH) - Bếp/Kho</option>
                    <option value="OFFICE">Office (Văn phòng/Kế toán)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="epStartDate" className="block text-xs font-semibold text-zinc-400 mb-1">Ngày làm việc chính thức</label>
                  <input
                    id="epStartDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label htmlFor="epPhone" className="block text-xs font-semibold text-zinc-400 mb-1">Số điện thoại liên hệ</label>
                  <input
                    id="epPhone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ví dụ: 0912345678"
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label htmlFor="epEmergency" className="block text-xs font-semibold text-zinc-400 mb-1">Liên hệ khẩn cấp (Tên - SĐT)</label>
                  <input
                    id="epEmergency"
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    placeholder="Ví dụ: Bố (Nguyễn Văn A) - 0987654321"
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label htmlFor="epNote" className="block text-xs font-semibold text-zinc-400 mb-1">Ghi chú nội bộ</label>
                  <textarea
                    id="epNote"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Các ghi chú đặc biệt về sức khỏe, kinh nghiệm, ca làm..."
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-xs text-white"
                  />
                </div>

                {formFeedback && (
                  <div
                    className={`rounded-xl p-3 text-xs border text-center font-bold ${
                      formFeedback.type === "success"
                        ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                        : "bg-rose-950/40 border-rose-980/50 text-rose-350"
                    }`}
                  >
                    {formFeedback.text}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStaff(null)}
                    className="px-4 py-2 rounded-xl border border-zinc-800 hover:bg-zinc-800 text-zinc-400"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold"
                  >
                    Lưu hồ sơ
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-12 text-zinc-650 text-xs italic">
                Chọn một nhân viên từ danh sách bên trái để cập nhật hoặc xem chi tiết hồ sơ nhân sự của họ.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải trang nhân sự...</div>
      </main>
    }>
      <TeamContent />
    </Suspense>
  );
}
