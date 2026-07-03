"use client";

import React, { useState, useEffect, Suspense, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Staff {
  id: string;
  auth_user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

interface DailyRevenue {
  id: string;
  business_date: string;
  gross_revenue: number;
  guest_count: number | null;
  note: string | null;
  created_at: string;
}

function FinanceContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Financial data states
  const [revenues, setRevenues] = useState<DailyRevenue[]>([]);
  const [approvedInvoicesTotal, setApprovedInvoicesTotal] = useState(0);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalGuests, setTotalGuests] = useState(0);
  const [totalIncidents, setTotalIncidents] = useState(0);

  // Form states (daily revenue entry)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [businessDate, setBusinessDate] = useState("");
  const [grossRevenue, setGrossRevenue] = useState(0);
  const [guestCount, setGuestCount] = useState(0);
  const [revNote, setRevNote] = useState("");
  
  const [formFeedback, setFormFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Auth check (Owner only)
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

      if (!staffData || !staffData.is_active || staffData.role !== "owner") {
        router.push("/home");
        return;
      }

      setStaff(staffData);
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  // 2. Fetch financial report data
  const fetchFinancials = async () => {
    const supabase = createClient();
    try {
      // a. Fetch daily revenues
      const { data: revData } = await supabase
        .from("daily_revenue")
        .select("*")
        .order("business_date", { ascending: true });

      if (revData) setRevenues(revData);

      // b. Fetch total approved invoice amount (costs)
      const { data: invData } = await supabase
        .from("invoices_in")
        .select("total_amount, payment_approvals!inner(decision)")
        .eq("payment_approvals.decision", "APPROVED");

      const costSum = (invData || []).reduce((sum, item) => sum + (Number(item.total_amount) || 0), 0);
      setApprovedInvoicesTotal(costSum);

      // c. Fetch total group visits & pax counts
      const { data: visitsData } = await supabase
        .from("group_visits")
        .select("pax");
      
      if (visitsData) {
        setTotalGroups(visitsData.length);
        const paxSum = visitsData.reduce((sum, item) => sum + (item.pax || 0), 0);
        setTotalGuests(paxSum);
      }

      // d. Fetch incidents count
      const { data: incData } = await supabase
        .from("incidents")
        .select("id");
      
      if (incData) {
        setTotalIncidents(incData.length);
      }

    } catch (err) {
      console.error("Lỗi fetch financials:", err);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchFinancials();
      setBusinessDate(new Date().toLocaleDateString("en-CA")); // Today default
    }
  }, [checkingAuth, staff]);

  // Submit daily revenue entry
  const handleSubmitRevenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!businessDate || grossRevenue < 0 || guestCount < 0) {
      setFormFeedback({ type: "error", text: "Vui lòng điền đúng và đủ thông tin doanh thu!" });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("daily_revenue")
        .insert({
          business_date: businessDate,
          gross_revenue: grossRevenue,
          guest_count: guestCount || null,
          note: revNote.trim() || null,
          created_by: staff.id,
        });

      if (error) throw error;

      setFormFeedback({ type: "success", text: "Ghi nhận doanh thu ngày thành công ✓" });
      setGrossRevenue(0);
      setGuestCount(0);
      setRevNote("");
      
      await fetchFinancials();
      setTimeout(() => {
        setIsFormOpen(false);
        setFormFeedback(null);
      }, 1000);
    } catch (err: any) {
      console.error(err);
      if (err.code === "23505") {
        setFormFeedback({ type: "error", text: "Doanh thu cho ngày này đã được nhập trước đó!" });
      } else {
        setFormFeedback({ type: "error", text: `Lỗi DB: ${err.message || err}` });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Organize data for daily revenue chart (last 7 days or all)
  const chartData = useMemo(() => {
    return revenues.slice(-7).map((rev) => {
      const parts = rev.business_date.split("-");
      const label = `${parts[2]}/${parts[1]}`; // DD/MM
      return {
        name: label,
        "Doanh thu": rev.gross_revenue,
      };
    });
  }, [revenues]);

  const totalRevenuesSum = useMemo(() => {
    return revenues.reduce((sum, r) => sum + r.gross_revenue, 0);
  }, [revenues]);

  const totalRevenueGuests = useMemo(() => {
    return revenues.reduce((sum, r) => sum + (r.guest_count || 0), 0);
  }, [revenues]);

  const avgSpentPerGuest = useMemo(() => {
    if (totalRevenueGuests === 0) return 0;
    return totalRevenuesSum / totalRevenueGuests;
  }, [totalRevenuesSum, totalRevenueGuests]);

  const incidentRate = useMemo(() => {
    if (totalGroups === 0) return 0;
    return (totalIncidents / totalGroups) * 100;
  }, [totalIncidents, totalGroups]);

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 text-sm">Đang xác thực quyền Owner...</div>
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
        <h1 className="text-base font-bold text-white">Báo Cáo Tài Chính & Doanh Thu</h1>
        <button
          onClick={() => setIsFormOpen(true)}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
        >
          Nhập doanh thu ngày
        </button>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 mt-6 space-y-6">
        
        {/* Intro */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5">
          <h2 className="text-sm font-bold text-white mb-1">📊 Tổng Quan Chỉ Số Sức Khỏe Nhà Hàng</h2>
          <p className="text-xs text-zinc-450">
            Dữ liệu tổng hợp trực tiếp từ dòng tiền đã đối chiếu, doanh thu POS thực tế và nhật ký phục vụ cuối ca.
          </p>
        </div>

        {/* 4 Financial Blocks */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Block 1: Revenue */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-2">
            <span className="text-[10px] uppercase font-bold text-zinc-450 tracking-wider">Tổng Doanh Thu POS</span>
            <div className="text-2xl font-black text-emerald-400">{totalRevenuesSum.toLocaleString("vi-VN")}đ</div>
            <span className="text-[10px] text-zinc-550 block">Tổng doanh thu lũy kế từ POS đã nhập</span>
          </div>

          {/* Block 2: APPROVED Costs */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-2">
            <span className="text-[10px] uppercase font-bold text-zinc-450 tracking-wider">Chi Phí Mua Hàng</span>
            <div className="text-2xl font-black text-rose-450">{approvedInvoicesTotal.toLocaleString("vi-VN")}đ</div>
            <span className="text-[10px] text-zinc-550 block">Tổng hóa đơn NCC đã APPROVED duyệt chi</span>
          </div>

          {/* Block 3: Visits */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-2">
            <span className="text-[10px] uppercase font-bold text-zinc-450 tracking-wider">Đoàn & Khách phục vụ</span>
            <div className="text-2xl font-black text-sky-400">{totalGroups} đoàn</div>
            <span className="text-[10px] text-zinc-550 block">Tổng cộng: {totalGuests} khách hàng</span>
          </div>

          {/* Block 4: Incidents */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-2">
            <span className="text-[10px] uppercase font-bold text-zinc-450 tracking-wider">Tỷ Lệ Sự Cố Bình Quân</span>
            <div className="text-2xl font-black text-yellow-500">{incidentRate.toFixed(1)}%</div>
            <span className="text-[10px] text-zinc-550 block">{totalIncidents} sự cố phát sinh trên {totalGroups} ca đoàn</span>
          </div>
        </div>

        {/* Charts and Tables grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Revenue Chart */}
          <div className="lg:col-span-2 rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Biểu đồ doanh thu POS (7 ngày nhập gần nhất)</h3>
            {chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-zinc-600 text-xs italic">
                Chưa có dữ liệu doanh thu ngày để vẽ biểu đồ.
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={10} tickLine={false} tickFormatter={(v) => `${(v/1000000).toFixed(1)}M`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "12px" }}
                      labelStyle={{ color: "#ffffff", fontWeight: "bold" }}
                      itemStyle={{ color: "#f59e0b" }}
                      formatter={(v) => [`${Number(v).toLocaleString("vi-VN")} VNĐ`]}
                    />
                    <Bar dataKey="Doanh thu" fill="#10b981" radius={[4, 4, 0, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Additional Analytics */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Phân tích hiệu quả</h3>
            <div className="space-y-4 text-xs divide-y divide-zinc-850">
              <div className="pt-2">
                <span className="block text-[10px] text-zinc-550 uppercase font-bold tracking-wider mb-1">Mức chi tiêu bình quân/Khách</span>
                <span className="text-lg font-bold text-zinc-200">{Math.round(avgSpentPerGuest).toLocaleString("vi-VN")}đ</span>
                <span className="block text-[9px] text-zinc-600 mt-0.5">Lấy tổng doanh thu / tổng lượng khách từ POS</span>
              </div>
              <div className="pt-3">
                <span className="block text-[10px] text-zinc-550 uppercase font-bold tracking-wider mb-1">Tình trạng ngân sách</span>
                <div className="flex items-center space-x-2">
                  <span className={`text-base font-bold ${totalRevenuesSum - approvedInvoicesTotal >= 0 ? "text-emerald-450" : "text-rose-450"}`}>
                    {(totalRevenuesSum - approvedInvoicesTotal).toLocaleString("vi-VN")}đ
                  </span>
                </div>
                <span className="block text-[9px] text-zinc-600 mt-0.5">Dòng tiền thô (Doanh thu POS - Tiền mua hàng APPROVED)</span>
              </div>
            </div>
          </div>

        </div>

        {/* History Table */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 overflow-hidden">
          <h3 className="text-sm font-bold text-white mb-4">Chi tiết lịch sử doanh thu POS</h3>
          {revenues.length === 0 ? (
            <div className="text-center py-6 text-zinc-600 text-xs italic">Chưa nhập doanh thu ngày nào.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/50 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Ngày kinh doanh</th>
                    <th className="py-3 px-4 text-right">Doanh thu POS</th>
                    <th className="py-3 px-4 text-center">Tổng khách (POS)</th>
                    <th className="py-3 px-4 text-right">Chi tiêu/Khách</th>
                    <th className="py-3 px-4">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {revenues.map((rev) => {
                    const guestCount = rev.guest_count || 0;
                    const guestAvg = guestCount > 0 ? Math.round(rev.gross_revenue / guestCount) : 0;
                    return (
                      <tr key={rev.id} className="hover:bg-zinc-900/20 transition">
                        <td className="py-3.5 px-4 font-mono font-bold text-zinc-200">
                          {new Date(rev.business_date).toLocaleDateString("vi-VN", { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' })}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-emerald-400">
                          {rev.gross_revenue.toLocaleString("vi-VN")}đ
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono font-semibold text-zinc-300">
                          {guestCount > 0 ? guestCount : "—"}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-zinc-400">
                          {guestAvg > 0 ? `${guestAvg.toLocaleString("vi-VN")}đ` : "—"}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-500 italic">
                          {rev.note || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Daily Revenue Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col my-8">
            <header className="border-b border-zinc-800 bg-zinc-900/80 px-6 py-4 flex items-center justify-between sticky top-0 backdrop-blur z-10">
              <h3 className="text-sm font-bold text-white">➕ Ghi nhận doanh thu POS ngày</h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="p-1 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <form onSubmit={handleSubmitRevenue} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label htmlFor="revDate" className="block text-xs font-semibold text-zinc-400 mb-1">Ngày kinh doanh*</label>
                <input
                  id="revDate"
                  type="date"
                  value={businessDate}
                  onChange={(e) => setBusinessDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="revAmount" className="block text-xs font-semibold text-zinc-400 mb-1">Tổng doanh thu thực tế (VNĐ)*</label>
                <input
                  id="revAmount"
                  type="number"
                  value={grossRevenue}
                  min={0}
                  onChange={(e) => setGrossRevenue(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 font-bold"
                  required
                />
              </div>

              <div>
                <label htmlFor="revGuestCount" className="block text-xs font-semibold text-zinc-400 mb-1">Số lượng khách hàng giao dịch (POS)*</label>
                <input
                  id="revGuestCount"
                  type="number"
                  value={guestCount}
                  min={0}
                  onChange={(e) => setGuestCount(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 font-bold"
                  required
                />
              </div>

              <div>
                <label htmlFor="revNote" className="block text-xs font-semibold text-zinc-400 mb-1">Ghi chú đối chiếu POS</label>
                <textarea
                  id="revNote"
                  rows={2}
                  value={revNote}
                  onChange={(e) => setRevNote(e.target.value)}
                  placeholder="Ghi chú chênh lệch POS, tiền mặt hoặc thẻ nếu có..."
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
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

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-850">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-zinc-850 hover:bg-zinc-800 text-xs font-semibold text-zinc-350 transition"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold text-xs transition disabled:opacity-30"
                >
                  {isSubmitting ? "Đang lưu..." : "Ghi nhận doanh thu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải báo cáo tài chính...</div>
      </main>
    }>
      <FinanceContent />
    </Suspense>
  );
}
