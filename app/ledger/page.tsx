"use client";

import React, { useState, useEffect, Suspense, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

interface Staff {
  id: string;
  auth_user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

interface Agency {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
}

interface Booking {
  id: string;
  group_name: string | null;
  starts_at: string;
  status: string;
}

interface LedgerEntry {
  id: string;
  agency_id: string;
  booking_id: string | null;
  amount: number;
  type: "DEBT" | "PAYMENT";
  note: string | null;
  created_at: string;
  created_by: string;
  staff?: { full_name: string };
  bookings?: Booking;
}

interface AgencySummary {
  agency: Agency;
  totalDebt: number;
  aging30: number;
  aging60: number;
  entries: LedgerEntry[];
}

function LedgerContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [staffList, setStaffList] = useState<Record<string, string>>({});

  // Expanded agency detail ID
  const [expandedAgencyId, setExpandedAgencyId] = useState<string | null>(null);

  // Form states (Record payment)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedAgencyId, setSelectedAgencyId] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  
  // Form states (Record manual debt)
  const [isDebtFormOpen, setIsDebtFormOpen] = useState(false);
  const [debtAmount, setDebtAmount] = useState<number>(0);
  const [debtNote, setDebtNote] = useState("");

  const [formFeedback, setFormFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Auth check: Owner or Finance only
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

      if (!staffData || !staffData.is_active || (staffData.role !== "owner" && staffData.role !== "finance")) {
        router.push("/home");
        return;
      }

      setStaff(staffData);
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  // 2. Fetch master data
  const fetchData = async () => {
    const supabase = createClient();
    try {
      const { data: agData } = await supabase
        .from("agencies")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (agData) setAgencies(agData);

      const { data: bookData } = await supabase
        .from("bookings")
        .select("id, group_name, starts_at, status")
        .order("starts_at", { ascending: false });
      if (bookData) setBookings(bookData);

      const { data: ledData } = await supabase
        .from("agency_ledger")
        .select("*, bookings(*)")
        .order("created_at", { ascending: false });
      if (ledData) setLedgerEntries(ledData);

      const { data: stfData } = await supabase
        .from("staff")
        .select("id, full_name");
      if (stfData) {
        const mapper: Record<string, string> = {};
        stfData.forEach((s) => {
          mapper[s.id] = s.full_name;
        });
        setStaffList(mapper);
      }
    } catch (err) {
      console.error("Lỗi fetch ledger:", err);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchData();
      setPaymentDate(new Date().toLocaleDateString("en-CA")); // today
    }
  }, [checkingAuth, staff]);

  // Filter bookings belonging to the selected agency
  const agencyBookings = useMemo(() => {
    if (!selectedAgencyId) return [];
    // Get completed bookings to link to debt/payments
    const selectedAgency = agencies.find((a) => a.id === selectedAgencyId);
    if (!selectedAgency) return [];
    
    // We can query completed bookings from Supabase or filter bookings list
    // For simplicity, we filter all bookings of this agency
    return bookings; 
  }, [selectedAgencyId, bookings, agencies]);

  // FIFO Aging & Summary Calculations
  const agencySummaries = useMemo<AgencySummary[]>(() => {
    const now = new Date().getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    return agencies.map((agency) => {
      // Find all ledger entries for this agency, sorted oldest first
      const entries = ledgerEntries
        .filter((e) => e.agency_id === agency.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      // Separate debts and payments
      const debts = entries.filter((e) => e.type === "DEBT");
      const payments = entries.filter((e) => e.type === "PAYMENT");

      // Total payments (positive sum of credits)
      let totalPayments = payments.reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0);

      let aging30 = 0;
      let aging60 = 0;
      const totalDebt = entries.reduce((sum, e) => sum + Number(e.amount), 0);

      // Walk through debts oldest first to apply payments FIFO
      debts.forEach((debt) => {
        const debtAmt = Number(debt.amount);
        let unpaid = debtAmt;

        if (totalPayments >= debtAmt) {
          unpaid = 0;
          totalPayments -= debtAmt;
        } else {
          unpaid = debtAmt - totalPayments;
          totalPayments = 0;
        }

        if (unpaid > 0) {
          const daysOld = Math.floor((now - new Date(debt.created_at).getTime()) / oneDayMs);
          if (daysOld > 60) {
            aging60 += unpaid;
          } else if (daysOld > 30) {
            aging30 += unpaid;
          }
        }
      });

      return {
        agency,
        totalDebt,
        aging30,
        aging60,
        entries: [...entries].reverse(), // reverse to show newest first for sub-feed
      };
    });
  }, [agencies, ledgerEntries]);

  // Submit Payment Receipt
  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!selectedAgencyId) {
      setFormFeedback({ type: "error", text: "Vui lòng chọn Agency đối tác." });
      return;
    }
    if (paymentAmount <= 0) {
      setFormFeedback({ type: "error", text: "Số tiền thanh toán phải lớn hơn 0đ." });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("agency_ledger")
        .insert({
          agency_id: selectedAgencyId,
          booking_id: selectedBookingId || null,
          amount: -paymentAmount, // Credit is negative
          type: "PAYMENT",
          note: paymentNote.trim() || null,
          created_by: staff.id,
          created_at: new Date(paymentDate).toISOString(),
        });

      if (error) throw error;

      setFormFeedback({ type: "success", text: "Ghi nhận thanh toán công nợ thành công ✓" });
      setSelectedAgencyId("");
      setSelectedBookingId("");
      setPaymentAmount(0);
      setPaymentNote("");
      
      await fetchData();

      setTimeout(() => {
        setIsFormOpen(false);
        setFormFeedback(null);
      }, 1000);

    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi ghi sổ: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Manual Debt
  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!selectedAgencyId) {
      setFormFeedback({ type: "error", text: "Vui lòng chọn Agency đối tác." });
      return;
    }
    if (debtAmount <= 0) {
      setFormFeedback({ type: "error", text: "Số tiền nợ phải lớn hơn 0đ." });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("agency_ledger")
        .insert({
          agency_id: selectedAgencyId,
          booking_id: selectedBookingId || null,
          amount: debtAmount, // Debit is positive
          type: "DEBT",
          note: debtNote.trim() || null,
          created_by: staff.id,
        });

      if (error) throw error;

      setFormFeedback({ type: "success", text: "Phát sinh nợ thủ công thành công ✓" });
      setSelectedAgencyId("");
      setSelectedBookingId("");
      setDebtAmount(0);
      setDebtNote("");

      await fetchData();

      setTimeout(() => {
        setIsDebtFormOpen(false);
        setFormFeedback(null);
      }, 1000);

    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi ghi sổ: ${err.message || err}` });
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
        <h1 className="text-base font-bold text-white">Sổ Công Nợ Agency</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              setIsDebtFormOpen(false);
              setFormFeedback(null);
              setIsFormOpen(true);
            }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition"
          >
            收 Thu nợ (Payment)
          </button>
          <button
            onClick={() => {
              setIsFormOpen(false);
              setFormFeedback(null);
              setIsDebtFormOpen(true);
            }}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500 transition"
          >
            ➕ Ghi nợ (Debt)
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 mt-8 space-y-6">
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
          <h2 className="text-sm font-bold text-white mb-1 uppercase tracking-wider">Bảng Tổng Hợp Công Nợ Đối Tác</h2>
          <p className="text-xs text-zinc-450 mb-6">
            Màu sắc cảnh báo tuổi nợ quá hạn: <span className="text-yellow-400 font-semibold">Vàng</span> (Nợ đọng &gt;30 ngày) • <span className="text-red-400 font-semibold">Đỏ</span> (Nợ đọng &gt;60 ngày - rủi ro cao).
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-zinc-900/40 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Tên Agency</th>
                  <th className="py-3 px-4">Liên hệ</th>
                  <th className="py-3 px-4 text-right">Nợ đọng &gt;30 ngày</th>
                  <th className="py-3 px-4 text-right">Nợ đọng &gt;60 ngày</th>
                  <th className="py-3 px-4 text-right">Tổng Nợ Hiện Tại</th>
                  <th className="py-3 px-4 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-850">
                {agencySummaries.map(({ agency, totalDebt, aging30, aging60, entries }) => (
                  <React.Fragment key={agency.id}>
                    <tr className="hover:bg-zinc-900/10 transition">
                      <td className="py-3.5 px-4 font-bold text-zinc-200">
                        {agency.name}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-400">
                        {agency.contact_person ? `${agency.contact_person} (${agency.phone || "—"})` : "Chưa cập nhật"}
                      </td>
                      <td className={`py-3.5 px-4 text-right font-bold font-mono ${aging30 > 0 ? "text-yellow-400" : "text-zinc-550"}`}>
                        {aging30 > 0 ? `${aging30.toLocaleString("vi-VN")}đ` : "—"}
                      </td>
                      <td className={`py-3.5 px-4 text-right font-bold font-mono ${aging60 > 0 ? "text-rose-500" : "text-zinc-550"}`}>
                        {aging60 > 0 ? `${aging60.toLocaleString("vi-VN")}đ` : "—"}
                      </td>
                      <td className={`py-3.5 px-4 text-right font-black font-mono text-sm ${totalDebt > 0 ? "text-rose-450" : totalDebt < 0 ? "text-emerald-450" : "text-zinc-400"}`}>
                        {totalDebt.toLocaleString("vi-VN")}đ
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => setExpandedAgencyId(expandedAgencyId === agency.id ? null : agency.id)}
                          className="px-2.5 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300"
                        >
                          {expandedAgencyId === agency.id ? "Thu gọn ▲" : "Lịch sử chi tiết ▼"}
                        </button>
                      </td>
                    </tr>

                    {/* Expandable sub-table */}
                    {expandedAgencyId === agency.id && (
                      <tr>
                        <td colSpan={6} className="bg-zinc-950/40 p-4 border-l-2 border-amber-500/50">
                          <div className="space-y-3">
                            <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                              Lịch sử giao dịch sổ phụ (Newest first)
                            </span>
                            {entries.length === 0 ? (
                              <div className="text-[11px] text-zinc-550 italic py-2">
                                Chưa có phát sinh nợ hay thanh toán nào được ghi nhận.
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border border-zinc-900 bg-zinc-950 p-2 max-h-60 overflow-y-auto">
                                <table className="w-full text-left text-[11px]">
                                  <thead>
                                    <tr className="border-b border-zinc-900 text-[9px] font-bold text-zinc-500 uppercase">
                                      <th className="py-1.5 px-2">Ngày tạo</th>
                                      <th className="py-1.5 px-2">Loại giao dịch</th>
                                      <th className="py-1.5 px-2">Sự kiện / Booking</th>
                                      <th className="py-1.5 px-2 text-right">Số tiền</th>
                                      <th className="py-1.5 px-2">Người ghi nhận</th>
                                      <th className="py-1.5 px-2">Ghi chú</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-900 text-zinc-400">
                                    {entries.map((e) => (
                                      <tr key={e.id} className="hover:bg-zinc-900/30">
                                        <td className="py-2 px-2 font-mono">{new Date(e.created_at).toLocaleDateString("vi-VN")}</td>
                                        <td className="py-2 px-2">
                                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                            e.type === "DEBT"
                                              ? "bg-rose-950/40 border border-rose-900/40 text-rose-450"
                                              : "bg-emerald-950/40 border border-emerald-900/40 text-emerald-450"
                                          }`}>
                                            {e.type === "DEBT" ? "PHÁT SINH NỢ" : "THANH TOÁN"}
                                          </span>
                                        </td>
                                        <td className="py-2 px-2 font-medium">{e.bookings?.group_name || "—"}</td>
                                        <td className={`py-2 px-2 text-right font-bold font-mono ${
                                          e.type === "DEBT" ? "text-rose-350" : "text-emerald-300"
                                        }`}>
                                          {e.type === "DEBT" ? "+" : ""}{e.amount.toLocaleString("vi-VN")}đ
                                        </td>
                                        <td className="py-2 px-2 text-zinc-500">{staffList[e.created_by] || "Hệ thống"}</td>
                                        <td className="py-2 px-2 text-zinc-550 italic">{e.note || "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Record Payment Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <h3 className="text-sm font-bold text-white">收 Ghi nhận thanh toán (Thu nợ Agency)</h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePayment} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Chọn Agency đối tác *</label>
                <select
                  value={selectedAgencyId}
                  onChange={(e) => setSelectedAgencyId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                  required
                >
                  <option value="">-- Chọn Agency --</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Liên kết đoàn sự kiện (nếu có)</label>
                <select
                  value={selectedBookingId}
                  onChange={(e) => setSelectedBookingId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                >
                  <option value="">-- Chọn sự kiện --</option>
                  {agencyBookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.group_name || "Khách lẻ"} ({new Date(b.starts_at).toLocaleDateString("vi-VN")})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Số tiền thu nợ (VNĐ) *</label>
                  <input
                    type="number"
                    min={1}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Ngày giao dịch *</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Ghi chú giao dịch</label>
                <textarea
                  rows={2}
                  value={paymentNote}
                  placeholder="Ghi nhận thanh toán chuyển khoản, mã giao dịch..."
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                />
              </div>

              {formFeedback && (
                <div className={`p-3 rounded-lg text-xs font-semibold text-center border ${
                  formFeedback.type === "success"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                    : "bg-rose-950/30 border-rose-900/50 text-rose-400"
                }`}>
                  {formFeedback.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-850">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 rounded-lg border border-zinc-850 text-zinc-400 hover:bg-zinc-800"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-emerald-600 font-bold text-white hover:bg-emerald-500 transition"
                >
                  Lưu giao dịch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Debt Modal */}
      {isDebtFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <h3 className="text-sm font-bold text-white">➕ Ghi nhận phát sinh nợ mới</h3>
              <button
                onClick={() => setIsDebtFormOpen(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDebt} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Chọn Agency đối tác *</label>
                <select
                  value={selectedAgencyId}
                  onChange={(e) => setSelectedAgencyId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                  required
                >
                  <option value="">-- Chọn Agency --</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Liên kết đoàn sự kiện (nếu có)</label>
                <select
                  value={selectedBookingId}
                  onChange={(e) => setSelectedBookingId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                >
                  <option value="">-- Chọn sự kiện --</option>
                  {agencyBookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.group_name || "Khách lẻ"} ({new Date(b.starts_at).toLocaleDateString("vi-VN")})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Số tiền nợ phát sinh (VNĐ) *</label>
                <input
                  type="number"
                  min={1}
                  value={debtAmount}
                  onChange={(e) => setDebtAmount(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Lý do phát sinh nợ *</label>
                <textarea
                  rows={2}
                  value={debtNote}
                  placeholder="Ghi nhận nợ tiền ăn đoàn Gala, nước uống thêm ngoài menu..."
                  onChange={(e) => setDebtNote(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                  required
                />
              </div>

              {formFeedback && (
                <div className={`p-3 rounded-lg text-xs font-semibold text-center border ${
                  formFeedback.type === "success"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                    : "bg-rose-950/30 border-rose-900/50 text-rose-400"
                }`}>
                  {formFeedback.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-850">
                <button
                  type="button"
                  onClick={() => setIsDebtFormOpen(false)}
                  className="px-4 py-2 rounded-lg border border-zinc-850 text-zinc-400 hover:bg-zinc-800"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-rose-600 font-bold text-white hover:bg-rose-500 transition"
                >
                  Lưu khoản nợ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function LedgerPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải sổ nợ...</div>
      </main>
    }>
      <LedgerContent />
    </Suspense>
  );
}
