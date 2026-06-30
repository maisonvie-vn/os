"use client";

import React, { useState, useEffect, Suspense, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Incident {
  id: string;
  occurred_at: string;
  shift: "TRUA" | "TOI";
  group_name: string | null;
  agency: string | null;
  type: "PHUC_VU_MAY_MOC" | "MON_LECH_CHUAN" | "MON_CHAM" | "ORDER_SAI" | "KHIEU_NAI_KHAC";
  description: string | null;
  severity: number;
  total_groups_in_shift: number | null;
  created_at: string;
  created_by: string;
}

// Helper to get start and end of week (Monday - Sunday)
const getWeekRange = (d: Date) => {
  const start = new Date(d);
  const day = start.getDay();
  const diff = start.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

function DashboardContent() {
  const router = useRouter();
  const [isOwnerUser, setIsOwnerUser] = useState<boolean | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Time filters
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 1. Check Auth and Owner Role
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

      if (staffData.role !== "owner") {
        setIsOwnerUser(false);
        setCheckingAuth(false);
        return;
      }

      setIsOwnerUser(true);
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  const selectedDateStr = selectedDate.toDateString();
  const { start: startOfWeek, end: endOfWeek } = useMemo(() => {
    return getWeekRange(new Date(selectedDateStr));
  }, [selectedDateStr]);

  const startOfWeekIso = startOfWeek.toISOString();
  const endOfWeekIso = endOfWeek.toISOString();

  // 2. Fetch incidents for selected week
  useEffect(() => {
    if (checkingAuth || !isOwnerUser) return;

    let isSubscribed = true;

    async function fetchIncidents() {
      setIsLoadingData(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("incidents")
          .select("*")
          .gte("occurred_at", startOfWeekIso)
          .lte("occurred_at", endOfWeekIso)
          .order("occurred_at", { ascending: true });

        if (isSubscribed) {
          if (!error && data) {
            setIncidents(data);
          }
        }
      } catch (err) {
        console.error("Lỗi lấy dữ liệu:", err);
      } finally {
        if (isSubscribed) {
          setIsLoadingData(false);
        }
      }
    }

    fetchIncidents();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth, isOwnerUser, startOfWeekIso, endOfWeekIso]);

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 text-sm">Đang xác thực quyền truy cập...</div>
      </main>
    );
  }

  if (isOwnerUser === false) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-rose-950/40 bg-zinc-900/40 p-8 shadow-2xl backdrop-blur-xl text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-950/50 text-rose-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-rose-300">Từ chối truy cập</h2>
          <p className="text-sm text-zinc-400">Chỉ chủ sở hữu xem được.</p>
          <button
            onClick={() => router.push("/home")}
            className="mt-4 w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 py-3 text-sm font-semibold transition"
          >
            Quay lại Trang chủ
          </button>
        </div>
      </main>
    );
  }

  // Calculate Statistics
  const totalIncidents = incidents.length;

  // Calculate unique shifts' total_groups_in_shift to get clean totals without duplicate-counting
  const uniqueShifts: Record<string, number> = {};
  incidents.forEach((inc) => {
    const dateStr = new Date(inc.occurred_at).toISOString().split("T")[0];
    const shiftKey = `${dateStr}_${inc.shift}`;
    if (inc.total_groups_in_shift !== null && inc.total_groups_in_shift !== undefined) {
      uniqueShifts[shiftKey] = Math.max(uniqueShifts[shiftKey] || 0, inc.total_groups_in_shift);
    }
  });
  const totalGroupsServed = Object.values(uniqueShifts).reduce((sum, val) => sum + val, 0);
  const overallIncidentRate = totalGroupsServed > 0 ? (totalIncidents / totalGroupsServed) * 100 : 0;

  // Group by incident type
  const incidentTypes = [
    { value: "PHUC_VU_MAY_MOC", label: "⚙️ Phục vụ máy móc" },
    { value: "MON_LECH_CHUAN", label: "🍲 Món lệch chuẩn" },
    { value: "MON_CHAM", label: "⏱️ Món chậm" },
    { value: "ORDER_SAI", label: "📝 Order sai" },
    { value: "KHIEU_NAI_KHAC", label: "💬 Khiếu nại khác" },
  ];

  const typeSummary = incidentTypes.map((t) => {
    const matched = incidents.filter((inc) => inc.type === t.value);
    const count = matched.length;
    const rate = totalGroupsServed > 0 ? (count / totalGroupsServed) * 100 : 0;

    // Find top agency
    const agencies: Record<string, number> = {};
    matched.forEach((inc) => {
      if (inc.agency) {
        const agencyName = inc.agency.trim();
        agencies[agencyName] = (agencies[agencyName] || 0) + 1;
      }
    });

    let topAgency = "—";
    let maxCount = 0;
    Object.entries(agencies).forEach(([name, val]) => {
      if (val > maxCount) {
        maxCount = val;
        topAgency = `${name} (${val} lần)`;
      }
    });

    return {
      label: t.label,
      count,
      rate,
      topAgency,
    };
  });

  // Calculate daily data for Recharts
  const daysOfWeek = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
  const chartData = daysOfWeek.map((dayName, idx) => {
    // idx 0 -> Monday (getDay() === 1)
    // idx 6 -> Sunday (getDay() === 0)
    const targetDayNum = idx === 6 ? 0 : idx + 1;

    const count = incidents.filter((inc) => {
      const dateObj = new Date(inc.occurred_at);
      return dateObj.getDay() === targetDayNum;
    }).length;

    return { name: dayName, "Số sự cố": count };
  });

  const changeWeek = (offset: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + offset * 7);
    setSelectedDate(newDate);
  };

  const formatDate = (d: Date) => {
    return d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 pb-12">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-900 bg-zinc-950/80 px-6 py-4 backdrop-blur flex items-center justify-between">
        <button
          onClick={() => router.push("/home")}
          className="flex items-center space-x-1 text-sm text-zinc-400 hover:text-white transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Trang chủ</span>
        </button>
        <h1 className="text-base font-bold text-white">Bảng Tổng Hợp Tuần</h1>
        <div className="w-16"></div>
      </header>

      {/* Week navigation controller */}
      <div className="mx-auto w-full max-w-4xl px-4 mt-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 backdrop-blur-xl">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => changeWeek(-1)}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
              title="Tuần trước"
            >
              <svg className="h-5 w-5 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-sm font-semibold text-zinc-200 min-w-[220px] text-center">
              📅 {formatDate(startOfWeek)} – {formatDate(endOfWeek)}
            </div>
            <button
              onClick={() => changeWeek(1)}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
              title="Tuần sau"
            >
              <svg className="h-5 w-5 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <label htmlFor="dateJump" className="text-xs text-zinc-400">Chọn ngày:</label>
            <input
              id="dateJump"
              type="date"
              value={selectedDate.toISOString().split("T")[0]}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(new Date(e.target.value));
                }
              }}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-white outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {isLoadingData ? (
        <div className="flex-1 flex items-center justify-center py-24 text-zinc-400 text-sm">
          Đang tổng hợp dữ liệu...
        </div>
      ) : (
        <div className="mx-auto w-full max-w-4xl px-4 mt-6 space-y-6">
          
          {/* Key Metrics Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Tổng đoàn phục vụ</div>
              <div className="mt-2 text-3xl font-extrabold text-white">{totalGroupsServed}</div>
              <div className="text-xs text-zinc-550 mt-1">Đoàn thực tế ghi nhận qua ca làm việc</div>
            </div>
            <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Tổng sự cố</div>
              <div className="mt-2 text-3xl font-extrabold text-white">{totalIncidents}</div>
              <div className="text-xs text-zinc-550 mt-1">Tổng lỗi hệ thống và món lệch chuẩn</div>
            </div>
            <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Tỷ lệ sự cố chung</div>
              <div className="mt-2 flex items-baseline space-x-2">
                <span className="text-3xl font-extrabold text-amber-400">{overallIncidentRate.toFixed(1)}%</span>
                <span className="text-xs text-zinc-450">mỗi đoàn phục vụ</span>
              </div>
              <div className="text-xs text-zinc-550 mt-1">Chỉ số đo lường chuẩn xác thay cảm tính</div>
            </div>
          </div>

          {/* Table Details */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
            <h2 className="text-base font-bold text-white mb-4">Chi tiết theo loại sự cố</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-300">
                <thead className="bg-zinc-900/40 text-xs font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Loại sự cố</th>
                    <th className="py-3 px-4 text-center">Số lần</th>
                    <th className="py-3 px-4 text-center">% Trên tổng đoàn</th>
                    <th className="py-3 px-4">Agency lặp nhiều nhất</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {typeSummary.map((row, idx) => (
                    <tr key={idx} className="hover:bg-zinc-900/20 transition">
                      <td className="py-3 px-4 font-medium text-white">{row.label}</td>
                      <td className="py-3 px-4 text-center font-semibold text-zinc-200">{row.count}</td>
                      <td className="py-3 px-4 text-center text-zinc-400">{row.rate.toFixed(1)}%</td>
                      <td className="py-3 px-4 text-zinc-400">{row.topAgency}</td>
                    </tr>
                  ))}
                  <tr className="bg-zinc-900/20 font-semibold text-white border-t-2 border-zinc-800">
                    <td className="py-4 px-4 text-amber-400">TỔNG CỘNG</td>
                    <td className="py-4 px-4 text-center text-amber-400">{totalIncidents}</td>
                    <td className="py-4 px-4 text-center text-amber-400">{overallIncidentRate.toFixed(1)}%</td>
                    <td className="py-4 px-4 text-zinc-500">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily Chart */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
            <h2 className="text-base font-bold text-white mb-4">Số sự cố phát sinh theo ngày</h2>
            {isMounted ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "12px" }}
                      labelStyle={{ color: "#ffffff", fontWeight: "bold" }}
                      itemStyle={{ color: "#f59e0b" }}
                    />
                    <Bar dataKey="Số sự cố" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-zinc-500 text-xs">
                Đang vẽ biểu đồ...
              </div>
            )}
          </div>

          {/* Raw List */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
            <h2 className="text-base font-bold text-white mb-4">Danh sách sự cố thô (Tuần này)</h2>
            {incidents.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-sm">Chưa có sự cố nào được ghi nhận.</div>
            ) : (
              <div className="space-y-3">
                {incidents.map((inc) => (
                  <div key={inc.id} className="rounded-xl border border-zinc-850 bg-zinc-900/30 p-4 text-sm space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-zinc-200">
                        {incidentTypes.find(t => t.value === inc.type)?.label || inc.type}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        inc.severity === 3 
                          ? "bg-rose-950/60 text-rose-300 border border-rose-800" 
                          : inc.severity === 2
                          ? "bg-orange-950/60 text-orange-300 border border-orange-800"
                          : "bg-emerald-950/60 text-emerald-300 border border-emerald-800"
                      }`}>
                        Mức {inc.severity}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      Ca: {inc.shift === "TRUA" ? "Trưa" : "Tối"} | Bàn: {inc.group_name || "—"} | Agency: {inc.agency || "—"} | Thời điểm: {new Date(inc.occurred_at).toLocaleTimeString("vi-VN")} - {formatDate(new Date(inc.occurred_at))}
                    </div>
                    {inc.description && (
                      <div className="text-zinc-400 mt-1 font-mono text-xs">
                        Chi tiết: {inc.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải...</div>
      </main>
    }>
      <DashboardContent />
    </Suspense>
  );
}
