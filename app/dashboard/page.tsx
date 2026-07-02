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

interface ChecklistTemplate {
  id: string;
  shift: "TRUA" | "TOI";
  phase: "MO_CA" | "DONG_CA";
  item_order: number;
  content: string;
  is_active: boolean;
}

interface ChecklistEntry {
  id: string;
  work_date: string;
  shift: "TRUA" | "TOI";
  template_id: string;
  is_done: boolean;
  note: string | null;
  checked_at: string | null;
  checked_by: string | null;
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

  // Tabs
  const [activeTab, setActiveTab] = useState<"incidents" | "reports">("incidents");

  // Date filters
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Data lists
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [reports, setReports] = useState<ShiftReport[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [checklistEntries, setChecklistEntries] = useState<ChecklistEntry[]>([]);
  const [staffList, setStaffList] = useState<Record<string, string>>({}); // id -> full_name mapping

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Modal details state
  const [selectedShiftDetails, setSelectedShiftDetails] = useState<{
    dateStr: string;
    shift: "TRUA" | "TOI";
  } | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 1. Auth check and metadata fetching
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

  // Date-only strings for querying date columns in Supabase
  const startDateOnly = useMemo(() => {
    const y = startOfWeek.getFullYear();
    const m = String(startOfWeek.getMonth() + 1).padStart(2, "0");
    const d = String(startOfWeek.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [startOfWeek]);

  const endDateOnly = useMemo(() => {
    const y = endOfWeek.getFullYear();
    const m = String(endOfWeek.getMonth() + 1).padStart(2, "0");
    const d = String(endOfWeek.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [endOfWeek]);

  // Calculate 7-day reports & checklists mapping
  const weekDaysList = useMemo(() => {
    const list = [];
    const temp = new Date(startOfWeek);
    for (let i = 0; i < 7; i++) {
      const d = new Date(temp);
      d.setDate(temp.getDate() + i);
      list.push(d);
    }
    return list;
  }, [startOfWeek]);

  const shiftReportsList = useMemo(() => {
    return weekDaysList.map((dayDate) => {
      const y = dayDate.getFullYear();
      const m = String(dayDate.getMonth() + 1).padStart(2, "0");
      const d = String(dayDate.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;

      const dayName = dayDate.toLocaleDateString("vi-VN", { weekday: "long" });
      const dayFormatted = `${dayName} (${d}/${m})`;

      // TRUA shift
      const reportTrua = reports.find(r => r.work_date === dateStr && r.shift === "TRUA");
      const templatesTrua = checklistTemplates.filter(t => t.shift === "TRUA" && t.is_active);
      const entriesTrua = checklistEntries.filter(e => e.work_date === dateStr && e.shift === "TRUA");
      const doneTrua = entriesTrua.filter(e => e.is_done && templatesTrua.some(t => t.id === e.template_id)).length;

      // TOI shift
      const reportToi = reports.find(r => r.work_date === dateStr && r.shift === "TOI");
      const templatesToi = checklistTemplates.filter(t => t.shift === "TOI" && t.is_active);
      const entriesToi = checklistEntries.filter(e => e.work_date === dateStr && e.shift === "TOI");
      const doneToi = entriesToi.filter(e => e.is_done && templatesToi.some(t => t.id === e.template_id)).length;

      return {
        dateStr,
        dayFormatted,
        trua: {
          report: reportTrua || null,
          senderName: reportTrua ? staffList[reportTrua.created_by] || "N/A" : null,
          checklistDone: doneTrua,
          checklistTotal: templatesTrua.length,
        },
        toi: {
          report: reportToi || null,
          senderName: reportToi ? staffList[reportToi.created_by] || "N/A" : null,
          checklistDone: doneToi,
          checklistTotal: templatesToi.length,
        }
      };
    });
  }, [weekDaysList, reports, checklistTemplates, checklistEntries, staffList]);

  // Selected Shift Detail calculations for Modal
  const modalData = useMemo(() => {
    if (!selectedShiftDetails) return null;
    const { dateStr, shift } = selectedShiftDetails;

    const report = reports.find(r => r.work_date === dateStr && r.shift === shift);
    const templates = checklistTemplates.filter(t => t.shift === shift && t.is_active);
    const entries = checklistEntries.filter(e => e.work_date === dateStr && e.shift === shift);

    const checklistWithStatus = templates.map(t => {
      const ent = entries.find(e => e.template_id === t.id);
      return {
        content: t.content,
        isDone: ent ? ent.is_done : false,
        note: ent ? ent.note : null,
        checkedAt: ent ? ent.checked_at : null,
        checkedByName: ent && ent.checked_by ? staffList[ent.checked_by] || "Nhân viên" : null,
        order: t.item_order,
      };
    }).sort((a, b) => a.order - b.order);

    const creatorName = report ? staffList[report.created_by] || "N/A" : null;

    return {
      dateStr,
      shift,
      report,
      creatorName,
      checklist: checklistWithStatus,
    };
  }, [selectedShiftDetails, reports, checklistTemplates, checklistEntries, staffList]);

  // 2. Fetch all required data for the selected week
  useEffect(() => {
    if (checkingAuth || !isOwnerUser) return;

    let isSubscribed = true;

    async function fetchDashboardData() {
      setIsLoadingData(true);
      try {
        const supabase = createClient();

        // Query incidents
        const incidentsPromise = supabase
          .from("incidents")
          .select("*")
          .gte("occurred_at", startOfWeekIso)
          .lte("occurred_at", endOfWeekIso)
          .order("occurred_at", { ascending: true });

        // Query shift reports
        const reportsPromise = supabase
          .from("shift_reports")
          .select("*")
          .gte("work_date", startDateOnly)
          .lte("work_date", endDateOnly)
          .order("work_date", { ascending: true });

        // Query checklist templates (fetch all active)
        const templatesPromise = supabase
          .from("checklist_templates")
          .select("*")
          .order("item_order", { ascending: true });

        // Query checklist entries for the week
        const entriesPromise = supabase
          .from("shift_checklist_entries")
          .select("*")
          .gte("work_date", startDateOnly)
          .lte("work_date", endDateOnly);

        // Query staff
        const staffPromise = supabase
          .from("staff")
          .select("id, full_name");

        const [incRes, repRes, tplRes, entRes, stfRes] = await Promise.all([
          incidentsPromise,
          reportsPromise,
          templatesPromise,
          entriesPromise,
          staffPromise,
        ]);

        if (isSubscribed) {
          if (!incRes.error && incRes.data) setIncidents(incRes.data);
          if (!repRes.error && repRes.data) setReports(repRes.data);
          if (!tplRes.error && tplRes.data) setChecklistTemplates(tplRes.data);
          if (!entRes.error && entRes.data) setChecklistEntries(entRes.data);
          if (!stfRes.error && stfRes.data) {
            const mapper: Record<string, string> = {};
            stfRes.data.forEach((s) => {
              mapper[s.id] = s.full_name;
            });
            setStaffList(mapper);
          }
        }
      } catch (err) {
        console.error("Lỗi lấy dữ liệu dashboard:", err);
      } finally {
        if (isSubscribed) {
          setIsLoadingData(false);
        }
      }
    }

    fetchDashboardData();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth, isOwnerUser, startOfWeekIso, endOfWeekIso, startDateOnly, endDateOnly]);

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

  // Calculate Statistics for Incidents Tab
  const totalIncidents = incidents.length;

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

  const daysOfWeek = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
  const chartData = daysOfWeek.map((dayName, idx) => {
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
        <h1 className="text-base font-bold text-white">Báo Cáo Tổng Hợp</h1>
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

      {/* Tabs */}
      <div className="mx-auto w-full max-w-4xl px-4 mt-6">
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setActiveTab("incidents")}
            className={`py-3 px-6 text-sm font-semibold border-b-2 transition ${
              activeTab === "incidents"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-350"
            }`}
          >
            ⚠️ Sự Cố & Chỉ Số
          </button>
          <button
            onClick={() => setActiveTab("reports")}
            className={`py-3 px-6 text-sm font-semibold border-b-2 transition ${
              activeTab === "reports"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-350"
            }`}
          >
            📝 Báo Cáo Ca & Checklist
          </button>
        </div>
      </div>

      {isLoadingData ? (
        <div className="flex-1 flex items-center justify-center py-24 text-zinc-400 text-sm">
          Đang tổng hợp dữ liệu...
        </div>
      ) : activeTab === "incidents" ? (
        /* INCIDENTS TAB CONTENT */
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
                    <div className="text-xs text-zinc-550">
                      Ca: {inc.shift === "TRUA" ? "Trưa" : "Tối"} | Bàn: {inc.group_name || "—"} | Agency: {inc.agency || "—"} | Thời điểm: {new Date(inc.occurred_at).toLocaleTimeString("vi-VN")} - {formatDate(new Date(inc.occurred_at))}
                    </div>
                    {inc.description && (
                      <div className="text-zinc-450 mt-1 font-mono text-xs">
                        Chi tiết: {inc.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* SHIFT REPORTS TAB CONTENT */
        <div className="mx-auto w-full max-w-4xl px-4 mt-6 space-y-6">
          <div className="space-y-4">
            {shiftReportsList.map((day, dIdx) => (
              <div key={dIdx} className="rounded-2xl border border-zinc-900 bg-zinc-900/10 p-5 space-y-4">
                {/* Date Header */}
                <h3 className="text-sm font-bold text-zinc-300 border-b border-zinc-850/50 pb-2 flex items-center">
                  <span className="mr-2">📅</span>
                  {day.dayFormatted}
                </h3>

                {/* Shifts Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Ca Trưa */}
                  <div
                    onClick={() => setSelectedShiftDetails({ dateStr: day.dateStr, shift: "TRUA" })}
                    className="group rounded-xl border border-zinc-850/60 bg-zinc-950/30 p-4 hover:border-zinc-700/80 cursor-pointer transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-white flex items-center">
                          <span className="mr-1.5 text-amber-400">☀️</span> Ca Trưa
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          day.trua.checklistTotal === 0
                            ? "bg-zinc-800 text-zinc-450"
                            : day.trua.checklistDone === day.trua.checklistTotal
                            ? "bg-emerald-950/50 text-emerald-450 border border-emerald-900"
                            : "bg-amber-950/50 text-amber-450 border border-amber-900"
                        }`}>
                          Checklist: {day.trua.checklistTotal === 0 ? "—" : `${day.trua.checklistDone}/${day.trua.checklistTotal}`}
                        </span>
                      </div>

                      {day.trua.report ? (
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center text-zinc-400">
                            <span className="font-semibold text-zinc-200">Đoàn: {day.trua.report.total_groups ?? 0}</span>
                            <span className="mx-1.5 text-zinc-700">|</span>
                            <span className="text-[10px] text-zinc-500">Gửi bởi: {day.trua.senderName}</span>
                          </div>
                          {day.trua.report.handover_notes && (
                            <p className="text-[11px] text-zinc-450 line-clamp-2 bg-zinc-950/50 p-2 rounded-lg mt-2 italic border border-zinc-900">
                              &quot;Bàn giao: {day.trua.report.handover_notes}&quot;
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-600 italic py-2">Chưa gửi báo cáo ca</p>
                      )}
                    </div>

                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-zinc-900/80">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        day.trua.report ? "text-emerald-450" : "text-rose-450"
                      }`}>
                        {day.trua.report ? "✓ Đã gửi" : "✗ Chưa gửi"}
                      </span>
                      <span className="text-[10px] font-bold text-amber-500 group-hover:underline">
                        Xem chi tiết &rarr;
                      </span>
                    </div>
                  </div>

                  {/* Ca Tối */}
                  <div
                    onClick={() => setSelectedShiftDetails({ dateStr: day.dateStr, shift: "TOI" })}
                    className="group rounded-xl border border-zinc-850/60 bg-zinc-950/30 p-4 hover:border-zinc-700/80 cursor-pointer transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-white flex items-center">
                          <span className="mr-1.5 text-indigo-400">🌙</span> Ca Tối
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          day.toi.checklistTotal === 0
                            ? "bg-zinc-800 text-zinc-450"
                            : day.toi.checklistDone === day.toi.checklistTotal
                            ? "bg-emerald-950/50 text-emerald-450 border border-emerald-900"
                            : "bg-amber-950/50 text-amber-450 border border-amber-900"
                        }`}>
                          Checklist: {day.toi.checklistTotal === 0 ? "—" : `${day.toi.checklistDone}/${day.toi.checklistTotal}`}
                        </span>
                      </div>

                      {day.toi.report ? (
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center text-zinc-400">
                            <span className="font-semibold text-zinc-200">Đoàn: {day.toi.report.total_groups ?? 0}</span>
                            <span className="mx-1.5 text-zinc-700">|</span>
                            <span className="text-[10px] text-zinc-500">Gửi bởi: {day.toi.senderName}</span>
                          </div>
                          {day.toi.report.handover_notes && (
                            <p className="text-[11px] text-zinc-450 line-clamp-2 bg-zinc-950/50 p-2 rounded-lg mt-2 italic border border-zinc-900">
                              &quot;Bàn giao: {day.toi.report.handover_notes}&quot;
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-600 italic py-2">Chưa gửi báo cáo ca</p>
                      )}
                    </div>

                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-zinc-900/80">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        day.toi.report ? "text-emerald-450" : "text-rose-450"
                      }`}>
                        {day.toi.report ? "✓ Đã gửi" : "✗ Chưa gửi"}
                      </span>
                      <span className="text-[10px] font-bold text-amber-500 group-hover:underline">
                        Xem chi tiết &rarr;
                      </span>
                    </div>
                  </div>

                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shift Detail Modal */}
      {modalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 my-8 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="border-b border-zinc-800 bg-zinc-900/80 px-6 py-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur">
              <div>
                <h3 className="text-base font-bold text-white flex items-center">
                  <span className="mr-2">{modalData.shift === "TRUA" ? "☀️" : "🌙"}</span>
                  Chi tiết Ca {modalData.shift === "TRUA" ? "Trưa" : "Tối"}
                </h3>
                <p className="text-xs text-zinc-550">
                  Ngày {new Date(modalData.dateStr).toLocaleDateString("vi-VN")}
                </p>
              </div>
              <button
                onClick={() => setSelectedShiftDetails(null)}
                className="p-1 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Scroll Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              
              {/* Report Section */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 border-l-2 border-amber-500 pl-2">
                  📝 Báo cáo ca
                </h4>

                {modalData.report ? (
                  <div className="rounded-2xl border border-zinc-850 bg-zinc-950/40 p-4 space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-0.5">Tổng đoàn phục vụ</span>
                        <span className="font-semibold text-zinc-200">{modalData.report.total_groups ?? "—"}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-0.5">Người lập báo cáo</span>
                        <span className="font-semibold text-zinc-200">{modalData.creatorName}</span>
                      </div>
                    </div>

                    <div>
                      <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-0.5">Nhân sự vắng/muộn</span>
                      <p className="text-zinc-300">{modalData.report.staff_absent ?? "—"}</p>
                    </div>

                    <div>
                      <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-0.5">Tóm tắt sự cố ca</span>
                      <p className="text-zinc-300">{modalData.report.incidents_summary ?? "—"}</p>
                    </div>

                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-3">
                      <span className="block text-[10px] font-bold text-amber-400 uppercase tracking-wide mb-1">📌 Việc bàn giao ca sau</span>
                      <p className="text-zinc-250 font-medium whitespace-pre-wrap leading-relaxed">
                        {modalData.report.handover_notes}
                      </p>
                    </div>

                    <div>
                      <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-0.5">Ghi chú chung</span>
                      <p className="text-zinc-350 whitespace-pre-wrap">{modalData.report.general_note ?? "—"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-850 p-6 text-center text-xs text-zinc-500">
                    Ca này chưa được nhân viên trực gửi báo cáo cuối ca.
                  </div>
                )}
              </div>

              {/* Checklist Section */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 border-l-2 border-amber-500 pl-2">
                  📋 Chi tiết checklist ca
                </h4>

                {modalData.checklist.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-850 p-6 text-center text-xs text-zinc-500">
                    Chưa cấu hình hoặc không có checklist cho ca này.
                  </div>
                ) : (
                  <div className="border border-zinc-850 rounded-2xl overflow-hidden divide-y divide-zinc-850">
                    {modalData.checklist.map((item, idx) => (
                      <div key={idx} className="p-4 bg-zinc-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                        <div className="flex items-start space-x-3">
                          <span className={`h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-xs border ${
                            item.isDone
                              ? "bg-emerald-950 border-emerald-800 text-emerald-450"
                              : "bg-zinc-900 border-zinc-800 text-zinc-500"
                          }`}>
                            {item.isDone ? "✓" : "—"}
                          </span>
                          <div>
                            <p className={`font-medium ${item.isDone ? "text-zinc-300" : "text-zinc-500"}`}>
                              {item.content}
                            </p>
                            {item.note && (
                              <p className="text-xs text-zinc-400 mt-1 font-mono italic">
                                Ghi chú: {item.note}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {item.isDone && item.checkedByName && (
                          <span className="text-[10px] text-zinc-550 shrink-0 self-end sm:self-center">
                            Xong bởi {item.checkedByName}
                            {item.checkedAt ? ` lúc ${new Date(item.checkedAt).toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' })}` : ""}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="border-t border-zinc-850 bg-zinc-900/50 px-6 py-4 flex justify-end">
              <button
                onClick={() => setSelectedShiftDetails(null)}
                className="rounded-xl bg-zinc-800 hover:bg-zinc-750 px-5 py-2.5 text-xs font-bold text-white transition"
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
