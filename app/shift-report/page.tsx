"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

interface Staff {
  id: string;
  auth_user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface ShiftReport {
  id: string;
  work_date: string;
  shift: "TRUA" | "TOI";
  total_groups: number | null;
  staff_absent: string | null;
  incidents_summary: string | null;
  handover_notes: string;
  general_note: string | null;
  created_at: string;
  created_by: string;
}

function ShiftReportContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Filters
  const [workDate, setWorkDate] = useState<string>("");
  const [shift, setShift] = useState<"TRUA" | "TOI">("TRUA");

  // Form states
  const [totalGroups, setTotalGroups] = useState("");
  const [staffAbsent, setStaffAbsent] = useState("");
  const [incidentsSummary, setIncidentsSummary] = useState("");
  const [handoverNotes, setHandoverNotes] = useState("");
  const [generalNote, setGeneralNote] = useState("");

  // Existing report state
  const [existingReport, setExistingReport] = useState<ShiftReport | null>(null);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showSupplementalModal, setShowSupplementalModal] = useState(false);

  // Initialize date and shift
  useEffect(() => {
    const today = new Date();
    const currentHour = today.getHours();
    setShift(currentHour >= 15 ? "TOI" : "TRUA");

    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setWorkDate(`${yyyy}-${mm}-${dd}`);
  }, []);

  // 1. Auth check
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
        .select("*")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (!staffData || !staffData.is_active) {
        router.push("/home");
        return;
      }

      setStaff(staffData);
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  // 2. Fetch existing report
  useEffect(() => {
    if (checkingAuth || !workDate) return;

    let isSubscribed = true;
    async function fetchReport() {
      setIsLoading(true);
      setExistingReport(null);
      setCreatorName(null);
      setMessage(null);

      const supabase = createClient();
      try {
        const { data, error } = await supabase
          .from("shift_reports")
          .select("*")
          .eq("work_date", workDate)
          .eq("shift", shift)
          .maybeSingle();

        if (isSubscribed) {
          if (!error && data) {
            setExistingReport(data);
            // Fetch creator's name
            const { data: creator } = await supabase
              .from("staff")
              .select("full_name")
              .eq("id", data.created_by)
              .maybeSingle();
            if (creator) {
              setCreatorName(creator.full_name);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching report:", err);
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    }
    fetchReport();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth, workDate, shift]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || !workDate || isSubmitting) return;

    if (!handoverNotes.trim()) {
      setMessage({ type: "error", text: "Vui lòng nhập việc bàn giao ca sau!" });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    const supabase = createClient();
    try {
      const groupsVal = totalGroups ? parseInt(totalGroups, 10) : null;

      const { data, error } = await supabase
        .from("shift_reports")
        .insert({
          work_date: workDate,
          shift,
          total_groups: groupsVal,
          staff_absent: staffAbsent.trim() || null,
          incidents_summary: incidentsSummary.trim() || null,
          handover_notes: handoverNotes.trim(),
          general_note: generalNote.trim() || null,
          created_by: staff.id,
        })
        .select()
        .maybeSingle();

      if (error) {
        setMessage({ type: "error", text: `Lỗi gửi báo cáo: ${error.message}` });
      } else {
        setMessage({ type: "success", text: "Gửi báo cáo thành công ✓" });
        if (data) {
          setExistingReport(data);
          setCreatorName(staff.full_name);
        }
        // Clear form
        setTotalGroups("");
        setStaffAbsent("");
        setIncidentsSummary("");
        setHandoverNotes("");
        setGeneralNote("");
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Lỗi kết nối máy chủ!" });
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
      <header className="sticky top-0 z-50 border-b border-zinc-900 bg-zinc-950/80 px-4 py-4 backdrop-blur flex items-center justify-between">
        <button
          onClick={() => router.push("/home")}
          className="flex items-center space-x-1 text-sm text-zinc-400 hover:text-white transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Trang chủ</span>
        </button>
        <h1 className="text-base font-bold text-white">Báo Cáo Cuối Ca</h1>
        <div className="w-16"></div>
      </header>

      <div className="w-full max-w-lg mx-auto px-4 mt-6">
        {/* Date / Shift selectors */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-4 mb-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                Chọn ngày
              </label>
              <input
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                Ca báo cáo
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShift("TRUA")}
                  className={`py-2 rounded-xl text-xs font-bold transition border ${
                    shift === "TRUA"
                      ? "bg-amber-500 border-amber-500 text-zinc-950"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  ☀️ Trưa
                </button>
                <button
                  onClick={() => setShift("TOI")}
                  className={`py-2 rounded-xl text-xs font-bold transition border ${
                    shift === "TOI"
                      ? "bg-amber-500 border-amber-500 text-zinc-950"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  🌙 Tối
                  </button>
              </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-zinc-500 text-sm">Đang tải thông tin báo cáo ca...</div>
        ) : existingReport ? (
          /* Report Exists View */
          <div className="space-y-6">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6 space-y-5 backdrop-blur-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 rounded-bl-2xl bg-emerald-500/10 border-l border-b border-emerald-500/20 px-3 py-1 text-[10px] font-bold text-emerald-400">
                ĐÃ KHÓA
              </div>

              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">Báo cáo Ca {shift === "TRUA" ? "Trưa" : "Tối"}</h2>
                <p className="text-[10px] text-zinc-500">
                  Ngày {new Date(existingReport.work_date).toLocaleDateString("vi-VN")} | Gửi bởi:{" "}
                  <span className="text-zinc-300 font-semibold">{creatorName || "N/A"}</span> lúc{" "}
                  {new Date(existingReport.created_at).toLocaleTimeString("vi-VN")}
                </p>
              </div>

              <div className="border-t border-zinc-850 pt-4 space-y-4 text-sm">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                    Tổng đoàn phục vụ
                  </span>
                  <p className="font-semibold text-zinc-200">{existingReport.total_groups ?? "—"}</p>
                </div>

                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                    Nhân sự vắng/muộn
                  </span>
                  <p className="text-zinc-300">{existingReport.staff_absent ?? "—"}</p>
                </div>

                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                    Tóm tắt sự cố
                  </span>
                  <p className="text-zinc-300">{existingReport.incidents_summary ?? "—"}</p>
                </div>

                <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1">
                    📌 Việc bàn giao ca sau (Quan trọng nhất)
                  </span>
                  <p className="text-zinc-200 font-medium whitespace-pre-wrap">
                    {existingReport.handover_notes}
                  </p>
                </div>

                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                    Ghi chú chung
                  </span>
                  <p className="text-zinc-300 whitespace-pre-wrap">{existingReport.general_note ?? "—"}</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSupplementalModal(true)}
              className="w-full py-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-sm font-bold text-zinc-300 transition"
            >
              ➕ Gửi Báo Cáo Bổ Sung
            </button>
          </div>
        ) : (
          /* Create Report View */
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/20 p-6 shadow-2xl backdrop-blur-xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">Gửi báo cáo Ca {shift === "TRUA" ? "Trưa" : "Tối"}</h2>
                <p className="text-xs text-zinc-500">Mẫu báo cáo tiêu chuẩn, điền trong 2 phút.</p>
              </div>

              <div className="space-y-4 pt-2">
                <div>
                  <label htmlFor="totalGroups" className="block text-xs font-semibold text-zinc-400 mb-1">
                    1. Tổng đoàn/bàn phục vụ (số)
                  </label>
                  <input
                    id="totalGroups"
                    type="number"
                    value={totalGroups}
                    onChange={(e) => setTotalGroups(e.target.value)}
                    placeholder="Ví dụ: 18"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                  />
                </div>

                <div>
                  <label htmlFor="staffAbsent" className="block text-xs font-semibold text-zinc-400 mb-1">
                    2. Nhân sự vắng/đi muộn (nếu có)
                  </label>
                  <input
                    id="staffAbsent"
                    type="text"
                    value={staffAbsent}
                    onChange={(e) => setStaffAbsent(e.target.value)}
                    placeholder="Ví dụ: Minh vắng không phép, Hoa đi muộn 15p"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                  />
                </div>

                <div>
                  <label htmlFor="incidentsSummary" className="block text-xs font-semibold text-zinc-400 mb-1">
                    3. Tóm tắt sự cố (chi tiết ghi ở /log)
                  </label>
                  <input
                    id="incidentsSummary"
                    type="text"
                    value={incidentsSummary}
                    onChange={(e) => setIncidentsSummary(e.target.value)}
                    placeholder="Ví dụ: 1 món chậm ca trưa, đã giải quyết"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                  />
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <label htmlFor="handoverNotes" className="block text-xs font-bold text-amber-400 mb-1">
                    4. Việc bàn giao ca sau (Bắt buộc)*
                  </label>
                  <p className="text-[10px] text-zinc-450 mb-2">Trường quan trọng nhất. Ghi cụ thể các việc cần lưu ý.</p>
                  <textarea
                    id="handoverNotes"
                    rows={4}
                    value={handoverNotes}
                    onChange={(e) => setHandoverNotes(e.target.value)}
                    placeholder="Ví dụ: Còn 2 đoàn đặt mai trưa chưa xác nhận; Thiếu đá lạnh, đã gọi nhà cung cấp giao trước 8h sáng mai..."
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="generalNote" className="block text-xs font-semibold text-zinc-400 mb-1">
                    5. Ghi chú chung (nếu có)
                  </label>
                  <textarea
                    id="generalNote"
                    rows={2}
                    value={generalNote}
                    onChange={(e) => setGeneralNote(e.target.value)}
                    placeholder="Các thông tin lưu ý khác..."
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                  />
                </div>
              </div>

              {message && (
                <div
                  className={`rounded-xl p-4 text-sm border text-center font-semibold ${
                    message.type === "success"
                      ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                      : "bg-rose-950/40 border-rose-980/50 text-rose-300"
                  }`}
                >
                  {message.text}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full justify-center rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 py-4 text-base font-bold text-zinc-950 transition hover:from-amber-400 hover:to-amber-500 disabled:opacity-55 disabled:cursor-not-allowed shadow-lg shadow-amber-500/10"
              >
                {isSubmitting ? "Đang gửi báo cáo..." : "GỬI BÁO CÁO"}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Supplemental Info Modal */}
      {showSupplementalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-zinc-850 bg-zinc-900 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-amber-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="text-base font-bold text-white">Giới hạn Báo cáo Ca</h3>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Mỗi ca làm việc chỉ được phép gửi **duy nhất 1 báo cáo** để tránh ghi đè dữ liệu gây lộn xộn. Báo cáo ca đã được gửi và khóa an toàn.
            </p>
            <p className="text-xs text-zinc-450 leading-relaxed">
              Nếu bạn có sự cố phát sinh thêm, hãy sử dụng trang **Ghi Nhận Sự Cố (Incidents)** để ghi nhận độc lập, hoặc liên hệ trực tiếp Quản lý/Owner.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowSupplementalModal(false);
                  router.push("/log");
                }}
                className="flex-1 py-3 rounded-xl bg-amber-500 text-zinc-950 font-bold text-xs hover:bg-amber-400 transition"
              >
                ⚠️ Ghi nhận Sự Cố
              </button>
              <button
                onClick={() => setShowSupplementalModal(false)}
                className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-350 font-semibold text-xs hover:bg-zinc-750 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ShiftReportPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải...</div>
      </main>
    }>
      <ShiftReportContent />
    </Suspense>
  );
}
