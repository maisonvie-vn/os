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
  agency_id: string | null;
  type: "PHUC_VU_MAY_MOC" | "MON_LECH_CHUAN" | "MON_CHAM" | "ORDER_SAI" | "KHIEU_NAI_KHAC";
  description: string | null;
  severity: number;
  total_groups_in_shift: number | null;
  created_at: string;
  created_by: string;
  status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "FOLLOWED_UP";
  assigned_to?: string | null;
  resolution_note?: string | null;
  resolved_at?: string | null;
  agency_followed_up?: boolean;
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
  phase: "MO_CA" | "DONG_CA" | "ATTP" | "TAP_VU" | "BAO_VE";
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

interface Agency {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  is_active: boolean;
}

interface GroupVisit {
  id: string;
  visit_date: string;
  shift: "TRUA" | "TOI";
  agency_id: string | null;
  agency_name_raw: string | null;
  group_name: string | null;
  pax: number;
  note: string | null;
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

// Helper for date differences in days (timezone-safe date-only comparison)
const getDaysDiff = (date1: Date, date2: Date) => {
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
  const diffTime = d1.getTime() - d2.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

const incidentTypes = [
  { value: "PHUC_VU_MAY_MOC", label: "⚙️ Phục vụ máy móc" },
  { value: "MON_LECH_CHUAN", label: "🍲 Món lệch chuẩn" },
  { value: "MON_CHAM", label: "⏱️ Món chậm" },
  { value: "ORDER_SAI", label: "📝 Order sai" },
  { value: "KHIEU_NAI_KHAC", label: "💬 Khiếu nại khác" },
];

const daysOfWeek = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];

function DashboardContent() {
  const router = useRouter();
  const [isOwnerUser, setIsOwnerUser] = useState<boolean | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"incidents" | "reports" | "agencies" | "bookings" | "staff" | "safety">("incidents");

  // Date filters
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Data lists
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [reports, setReports] = useState<ShiftReport[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [checklistEntries, setChecklistEntries] = useState<ChecklistEntry[]>([]);
  const [groupVisits, setGroupVisits] = useState<GroupVisit[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [staffList, setStaffList] = useState<Record<string, string>>({}); // id -> full_name mapping
  const [staffRawList, setStaffRawList] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [sopDocuments, setSopDocuments] = useState<any[]>([]);
  const [sopAcknowledgements, setSopAcknowledgements] = useState<any[]>([]);
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [tempLogs, setTempLogs] = useState<any[]>([]);
  const [foodSamples, setFoodSamples] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Incident editing states
  const [editingIncident, setEditingIncident] = useState<Incident | null>(null);
  const [editStatus, setEditStatus] = useState<string>("OPEN");
  const [editAssignedTo, setEditAssignedTo] = useState<string>("");
  const [editResolutionNote, setEditResolutionNote] = useState<string>("");
  const [editResolvedAt, setEditResolvedAt] = useState<string>("");
  const [editAgencyFollowedUp, setEditAgencyFollowedUp] = useState<boolean>(false);
  const [isSavingIncident, setIsSavingIncident] = useState<boolean>(false);

  // Modal details state
  const [selectedShiftDetails, setSelectedShiftDetails] = useState<{
    dateStr: string;
    shift: "TRUA" | "TOI";
  } | null>(null);

  // Auto set resolved_at when status is RESOLVED
  useEffect(() => {
    if (editStatus === "RESOLVED" && !editResolvedAt) {
      const now = new Date();
      const offsetMs = now.getTimezoneOffset() * 60 * 1000;
      const localISOTime = new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
      setEditResolvedAt(localISOTime);
    }
  }, [editStatus, editResolvedAt]);

  const isWriteAllowed = currentUser?.role === "owner" || currentUser?.role === "manager";

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

      setCurrentUser(staffData);

      if (staffData.role !== "owner" && staffData.role !== "manager" && staffData.role !== "finance") {
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

  // Fetch range: 180 days before selected week
  const fetchStartDateOnly = useMemo(() => {
    const temp = new Date(startOfWeek);
    temp.setDate(startOfWeek.getDate() - 180);
    const y = temp.getFullYear();
    const m = String(temp.getMonth() + 1).padStart(2, "0");
    const d = String(temp.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [startOfWeek]);

  const fetchStartIso = useMemo(() => {
    const temp = new Date(startOfWeek);
    temp.setDate(startOfWeek.getDate() - 180);
    return temp.toISOString();
  }, [startOfWeek]);

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

  // 2. Fetch all required data for the selected week & last 180 days
  useEffect(() => {
    if (checkingAuth || !isOwnerUser) return;

    let isSubscribed = true;

    async function fetchDashboardData() {
      setIsLoadingData(true);
      try {
        const supabase = createClient();

        // Query incidents (last 180 days)
        const incidentsPromise = supabase
          .from("incidents")
          .select("*")
          .gte("occurred_at", fetchStartIso)
          .lte("occurred_at", endOfWeekIso)
          .order("occurred_at", { ascending: true });

        // Query shift reports (selected week)
        const reportsPromise = supabase
          .from("shift_reports")
          .select("*")
          .gte("work_date", startDateOnly)
          .lte("work_date", endDateOnly)
          .order("work_date", { ascending: true });

        // Query checklist templates (all)
        const templatesPromise = supabase
          .from("checklist_templates")
          .select("*")
          .order("item_order", { ascending: true });

        // Query checklist entries (selected week)
        const entriesPromise = supabase
          .from("shift_checklist_entries")
          .select("*")
          .gte("work_date", startDateOnly)
          .lte("work_date", endDateOnly);

        // Query group visits (last 180 days)
        const visitsPromise = supabase
          .from("group_visits")
          .select("*")
          .gte("visit_date", fetchStartDateOnly)
          .lte("visit_date", endDateOnly)
          .order("visit_date", { ascending: true });

        // Query agencies
        const agenciesPromise = supabase
          .from("agencies")
          .select("*")
          .order("name", { ascending: true });

        // Query staff
        const staffPromise = supabase
          .from("staff")
          .select("id, full_name");

        // Query bookings
        const bookingsPromise = supabase
          .from("bookings")
          .select("*, venues(*), agencies(*)")
          .order("starts_at", { ascending: true });

        // Query venues
        const venuesPromise = supabase
          .from("venues")
          .select("*")
          .order("name", { ascending: true });

        // Query sop_documents
        const sopDocsPromise = supabase
          .from("sop_documents")
          .select("*")
          .eq("is_active", true)
          .order("title", { ascending: true });

        // Query sop_acknowledgements
        const sopAcksPromise = supabase
          .from("sop_acknowledgements")
          .select("*");

        const eqPromise = supabase
          .from("equipment")
          .select("*")
          .eq("is_active", true);

        const tlPromise = supabase
          .from("temp_logs")
          .select("*, equipment(*)")
          .order("logged_at", { ascending: false });

        const fsPromise = supabase
          .from("food_samples")
          .select("*")
          .order("stored_at", { ascending: false });

        const licPromise = supabase
          .from("licenses")
          .select("*")
          .eq("is_active", true)
          .order("expires_on", { ascending: true });

        const [incRes, repRes, tplRes, entRes, visRes, agRes, stfRes, bookRes, venRes, sopDocRes, sopAckRes, eqRes, tlRes, fsRes, licRes] = await Promise.all([
          incidentsPromise,
          reportsPromise,
          templatesPromise,
          entriesPromise,
          visitsPromise,
          agenciesPromise,
          staffPromise,
          bookingsPromise,
          venuesPromise,
          sopDocsPromise,
          sopAcksPromise,
          eqPromise,
          tlPromise,
          fsPromise,
          licPromise,
        ]);

        if (isSubscribed) {
          if (!incRes.error && incRes.data) setIncidents(incRes.data);
          if (!repRes.error && repRes.data) setReports(repRes.data);
          if (!tplRes.error && tplRes.data) setChecklistTemplates(tplRes.data);
          if (!entRes.error && entRes.data) setChecklistEntries(entRes.data);
          if (!visRes.error && visRes.data) setGroupVisits(visRes.data);
          if (!agRes.error && agRes.data) setAgencies(agRes.data);
          if (!bookRes.error && bookRes.data) setBookings(bookRes.data);
          if (!venRes.error && venRes.data) setVenues(venRes.data);
          if (!sopDocRes.error && sopDocRes.data) setSopDocuments(sopDocRes.data);
          if (!sopAckRes.error && sopAckRes.data) setSopAcknowledgements(sopAckRes.data);
          if (!eqRes.error && eqRes.data) setEquipmentList(eqRes.data);
          if (!tlRes.error && tlRes.data) setTempLogs(tlRes.data);
          if (!fsRes.error && fsRes.data) setFoodSamples(fsRes.data);
          if (!licRes.error && licRes.data) setLicenses(licRes.data);
          if (!stfRes.error && stfRes.data) {
            setStaffRawList(stfRes.data);
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
  }, [checkingAuth, isOwnerUser, fetchStartIso, endOfWeekIso, startDateOnly, endDateOnly, fetchStartDateOnly]);

  // Statistics calculations for the Incident Tab (week only)
  const weekIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      const date = new Date(inc.occurred_at);
      return date >= startOfWeek && date <= endOfWeek;
    });
  }, [incidents, startOfWeek, endOfWeek]);

  const totalIncidents = weekIncidents.length;

  const totalGroupsServed = useMemo(() => {
    // Sum total pax in group_visits for the selected week
    const weekVisits = groupVisits.filter(v => v.visit_date >= startDateOnly && v.visit_date <= endDateOnly);
    return weekVisits.length;
  }, [groupVisits, startDateOnly, endDateOnly]);

  const overallIncidentRate = totalGroupsServed > 0 ? (totalIncidents / totalGroupsServed) * 100 : 0;

  // Food Safety computations
  const outOfRangeLogsToday = useMemo(() => {
    const todayStr = new Date().toLocaleDateString("en-CA");
    return tempLogs.filter((log) => {
      const logDayStr = new Date(log.logged_at).toLocaleDateString("en-CA");
      return logDayStr === todayStr && log.is_out_of_range;
    });
  }, [tempLogs]);

  const totalTempLogsToday = useMemo(() => {
    const todayStr = new Date().toLocaleDateString("en-CA");
    return tempLogs.filter((log) => {
      const logDayStr = new Date(log.logged_at).toLocaleDateString("en-CA");
      return logDayStr === todayStr;
    }).length;
  }, [tempLogs]);

  const foodSamplesToday = useMemo(() => {
    const todayStr = new Date().toLocaleDateString("en-CA");
    return foodSamples.filter((sample) => {
      return sample.sample_date === todayStr;
    });
  }, [foodSamples]);

  const attpChecklistStats = useMemo(() => {
    const todayStr = new Date().toLocaleDateString("en-CA");
    const attpTemplates = checklistTemplates.filter((t) => t.phase === "ATTP" && t.is_active);
    const attpEntries = checklistEntries.filter((e) => e.work_date === todayStr);

    const total = attpTemplates.length;
    const done = attpEntries.filter((e) => e.is_done && attpTemplates.some((t) => t.id === e.template_id)).length;

    return {
      total,
      done,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [checklistTemplates, checklistEntries]);

  const expiringLicenses = useMemo(() => {
    const now = new Date().getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    return licenses.slice(0, 5).map((l) => {
      const daysLeft = Math.ceil((new Date(l.expires_on).getTime() - now) / oneDayMs);
      let badgeColor = "bg-emerald-950/40 border-emerald-900 text-emerald-450";
      if (daysLeft < 7) {
        badgeColor = "bg-rose-950/40 border-rose-900 text-rose-450 animate-pulse";
      } else if (daysLeft < 30) {
        badgeColor = "bg-orange-950/40 border-orange-900 text-orange-400";
      } else if (daysLeft < 60) {
        badgeColor = "bg-yellow-950/30 border-yellow-900 text-yellow-450";
      }
      return {
        ...l,
        daysLeft,
        badgeColor,
      };
    });
  }, [licenses]);

  const next7DaysBookings = useMemo(() => {
    const now = new Date();
    const next7Days = new Date();
    next7Days.setDate(now.getDate() + 7);

    return bookings.filter((b) => {
      const bStart = new Date(b.starts_at);
      return bStart >= now && bStart <= next7Days;
    }).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [bookings]);

  const isTentativeAndTooOld = (b: any) => {
    if (b.status !== "TENTATIVE") return false;
    const createdAt = new Date(b.created_at).getTime();
    const now = new Date().getTime();
    return (now - createdAt) > (48 * 60 * 60 * 1000); // 48 hours
  };

  const missingAcks = useMemo(() => {
    return sopDocuments.map((sop) => {
      const missingStaff = staffRawList.filter((sMember) => {
        return !sopAcknowledgements.some(
          (ack) => ack.sop_id === sop.id && ack.staff_id === sMember.id
        );
      });
      return {
        sop,
        missingStaff,
      };
    });
  }, [sopDocuments, staffRawList, sopAcknowledgements]);

  const typeSummary = useMemo(() => {
    return incidentTypes.map((t) => {
      const matched = weekIncidents.filter((inc) => inc.type === t.value);
      const count = matched.length;
      const rate = totalGroupsServed > 0 ? (count / totalGroupsServed) * 100 : 0;

      const agenciesMap: Record<string, number> = {};
      matched.forEach((inc) => {
        if (inc.agency_id) {
          const match = agencies.find(a => a.id === inc.agency_id);
          if (match) {
            agenciesMap[match.name] = (agenciesMap[match.name] || 0) + 1;
          }
        } else if (inc.agency) {
          const agencyName = inc.agency.trim();
          agenciesMap[agencyName] = (agenciesMap[agencyName] || 0) + 1;
        }
      });

      let topAgency = "—";
      let maxCount = 0;
      Object.entries(agenciesMap).forEach(([name, val]) => {
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
  }, [weekIncidents, totalGroupsServed, agencies]);

  const chartData = useMemo(() => {
    return daysOfWeek.map((dayName, idx) => {
      const targetDayNum = idx === 6 ? 0 : idx + 1;
      const count = weekIncidents.filter((inc) => {
        const dateObj = new Date(inc.occurred_at);
        return dateObj.getDay() === targetDayNum;
      }).length;
      return { name: dayName, "Số sự cố": count };
    });
  }, [weekIncidents]);

  // Agency Health calculations (relatives to selectedDate)
  const agencyHealthList = useMemo(() => {
    // Month boundaries
    const thisMonthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const thisMonthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59, 999);

    const lastMonthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
    const lastMonthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 0, 23, 59, 59, 999);

    return agencies.map((agency) => {
      // 1. Filter visits
      const agencyVisits = groupVisits.filter(v => v.agency_id === agency.id);

      // This Month
      const thisMonthMatched = agencyVisits.filter(v => {
        const d = new Date(v.visit_date);
        return d >= thisMonthStart && d <= thisMonthEnd;
      });
      const thisMonthGroups = thisMonthMatched.length;
      const thisMonthPax = thisMonthMatched.reduce((sum, v) => sum + v.pax, 0);

      // Last Month
      const lastMonthMatched = agencyVisits.filter(v => {
        const d = new Date(v.visit_date);
        return d >= lastMonthStart && d <= lastMonthEnd;
      });
      const lastMonthGroups = lastMonthMatched.length;
      const lastMonthPax = lastMonthMatched.reduce((sum, v) => sum + v.pax, 0);

      // Trend
      const paxTrend = thisMonthPax - lastMonthPax;

      // 2. Incident Count (180 days)
      const agencyIncidents = incidents.filter(inc => inc.agency_id === agency.id);
      const incidentsCount = agencyIncidents.length;

      // 3. Last visit date & days diff
      let lastVisitDate: Date | null = null;
      let daysSinceLast = -1;

      if (agencyVisits.length > 0) {
        // Find latest date
        const sorted = [...agencyVisits].sort((a, b) =>
          new Date(b.visit_date).getTime() - new Date(a.visit_date).getTime()
        );
        lastVisitDate = new Date(sorted[0].visit_date);
        daysSinceLast = getDaysDiff(selectedDate, lastVisitDate);
      }

      return {
        id: agency.id,
        name: agency.name,
        contactPerson: agency.contact_person,
        phone: agency.phone,
        is_active: agency.is_active,
        thisMonthGroups,
        thisMonthPax,
        lastMonthGroups,
        lastMonthPax,
        paxTrend,
        incidentsCount,
        lastVisitDate,
        daysSinceLast,
      };
    }).sort((a, b) => {
      // Sort by status risk: active but silent longest first, followed by others
      if (a.daysSinceLast === -1) return 1;
      if (b.daysSinceLast === -1) return -1;
      return b.daysSinceLast - a.daysSinceLast;
    });
  }, [agencies, groupVisits, incidents, selectedDate]);

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

  const handleSaveIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIncident || isSavingIncident) return;

    setIsSavingIncident(true);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("incidents")
        .update({
          status: editStatus,
          assigned_to: editAssignedTo || null,
          resolution_note: editResolutionNote || null,
          resolved_at: editResolvedAt ? new Date(editResolvedAt).toISOString() : null,
          agency_followed_up: editAgencyFollowedUp,
        })
        .eq("id", editingIncident.id);

      if (error) throw error;

      // Update local state
      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === editingIncident.id
            ? {
                ...inc,
                status: editStatus as any,
                assigned_to: editAssignedTo || null,
                resolution_note: editResolutionNote || null,
                resolved_at: editResolvedAt ? new Date(editResolvedAt).toISOString() : null,
                agency_followed_up: editAgencyFollowedUp,
              }
            : inc
        )
      );

      setEditingIncident(null);
    } catch (err: any) {
      alert("Lỗi cập nhật sự cố: " + err.message);
    } finally {
      setIsSavingIncident(false);
    }
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
          <button
            onClick={() => setActiveTab("agencies")}
            className={`py-3 px-6 text-sm font-semibold border-b-2 transition ${
              activeTab === "agencies"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-350"
            }`}
          >
            🏢 Sức Khỏe Agency
          </button>
          <button
            onClick={() => setActiveTab("bookings")}
            className={`py-3 px-6 text-sm font-semibold border-b-2 transition ${
              activeTab === "bookings"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-350"
            }`}
          >
            📅 Booking 7 Ngày
          </button>
          <button
            onClick={() => setActiveTab("staff")}
            className={`py-3 px-6 text-sm font-semibold border-b-2 transition ${
              activeTab === "staff"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-350"
            }`}
          >
            👥 Ký SOP Đội Ngũ
          </button>
          <button
            onClick={() => setActiveTab("safety" as any)}
            className={`py-3 px-6 text-sm font-semibold border-b-2 transition ${
              activeTab === ("safety" as any)
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-355"
            }`}
          >
            🛡️ An Toàn & Tuân Thủ
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

          {/* Raw List (Selected Week Only) */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
            <h2 className="text-base font-bold text-white mb-4">Danh sách sự cố thô (Tuần này)</h2>
            {weekIncidents.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-sm">Chưa có sự cố nào được ghi nhận.</div>
            ) : (
              <div className="space-y-3">
                {weekIncidents.map((inc) => {
                  const statusColors: Record<string, string> = {
                    OPEN: "bg-red-950/50 text-red-400 border-red-900/40",
                    IN_PROGRESS: "bg-amber-950/50 text-amber-400 border-amber-900/40",
                    RESOLVED: "bg-emerald-950/50 text-emerald-450 border-emerald-900/40",
                    FOLLOWED_UP: "bg-blue-950/50 text-blue-400 border-blue-900/40",
                  };
                  const statusLabels: Record<string, string> = {
                    OPEN: "Mở (Open)",
                    IN_PROGRESS: "Đang xử lý",
                    RESOLVED: "Đã giải quyết",
                    FOLLOWED_UP: "Đã chăm sóc agency",
                  };
                  const currentStatus = inc.status || "OPEN";
                  const statusClass = statusColors[currentStatus] || "bg-zinc-850 text-zinc-400 border-zinc-750";
                  const statusLabel = statusLabels[currentStatus] || currentStatus;

                  return (
                    <div key={inc.id} className="rounded-xl border border-zinc-850 bg-zinc-900/30 p-4 text-sm space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-zinc-200">
                              {incidentTypes.find(t => t.value === inc.type)?.label || inc.type}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-550">
                            Ca: {inc.shift === "TRUA" ? "Trưa" : "Tối"} | Bàn: {inc.group_name || "—"} | Agency: {inc.agency_id ? agencies.find(a=>a.id===inc.agency_id)?.name : inc.agency || "—"} | Thời điểm: {new Date(inc.occurred_at).toLocaleTimeString("vi-VN")} - {formatDate(new Date(inc.occurred_at))}
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${
                          inc.severity === 3 
                            ? "bg-rose-950/60 text-rose-300 border border-rose-800" 
                            : inc.severity === 2
                            ? "bg-orange-950/60 text-orange-300 border border-orange-800"
                            : "bg-emerald-950/60 text-emerald-300 border border-emerald-800"
                        }`}>
                          Mức {inc.severity}
                        </span>
                      </div>
                      
                      {inc.description && (
                        <div className="text-zinc-400 font-mono text-xs bg-zinc-950/40 p-2.5 rounded border border-zinc-900">
                          <strong>Chi tiết:</strong> {inc.description}
                        </div>
                      )}

                      {/* Display Handling Info */}
                      {(inc.assigned_to || inc.resolution_note || inc.resolved_at || inc.agency_followed_up) && (
                        <div className="text-xs space-y-1.5 border-t border-zinc-900/50 pt-2 text-zinc-400">
                          {inc.assigned_to && (
                            <div>
                              👤 <strong>Nhân sự xử lý:</strong> {staffList[inc.assigned_to] || "N/A"}
                            </div>
                          )}
                          {inc.resolution_note && (
                            <div className="italic text-zinc-300 bg-zinc-950/20 p-2 rounded border border-zinc-900/50">
                              💬 <strong>Giải pháp:</strong> {inc.resolution_note}
                            </div>
                          )}
                          {inc.resolved_at && (
                            <div className="text-[10px] text-zinc-500">
                              ✓ <strong>Hoàn thành lúc:</strong> {new Date(inc.resolved_at).toLocaleString("vi-VN")}
                            </div>
                          )}
                          {inc.agency_followed_up && (
                            <div className="text-blue-400 font-semibold flex items-center gap-1">
                              📞 Đã liên hệ chăm sóc lại Agency
                            </div>
                          )}
                        </div>
                      )}

                      {/* Edit Button for Manager/Owner */}
                      {isWriteAllowed && (
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingIncident(inc);
                              setEditStatus(inc.status || "OPEN");
                              setEditAssignedTo(inc.assigned_to || "");
                              setEditResolutionNote(inc.resolution_note || "");
                              setEditResolvedAt(inc.resolved_at ? new Date(inc.resolved_at).toISOString().slice(0, 16) : "");
                              setEditAgencyFollowedUp(!!inc.agency_followed_up);
                            }}
                            className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-750 text-xs font-semibold text-zinc-300 transition"
                          >
                            ⚙️ Cập nhật xử lý
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Edit Incident Modal */}
          {editingIncident && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                  <h3 className="text-sm font-bold text-white">⚙️ Cập nhật xử lý sự cố</h3>
                  <button
                    onClick={() => setEditingIncident(null)}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    ✕
                  </button>
                </div>

                {/* Read-only Context Fields */}
                <div className="bg-zinc-950/40 p-3 rounded-xl border border-zinc-850 text-xs space-y-1.5 text-zinc-400">
                  <div>
                    <strong>Loại sự cố:</strong> {incidentTypes.find(t => t.value === editingIncident.type)?.label || editingIncident.type}
                  </div>
                  <div>
                    <strong>Mức độ:</strong> Mức {editingIncident.severity}
                  </div>
                  <div>
                    <strong>Thời điểm xảy ra:</strong> {new Date(editingIncident.occurred_at).toLocaleString("vi-VN")}
                  </div>
                  {editingIncident.description && (
                    <div>
                      <strong>Mô tả:</strong> {editingIncident.description}
                    </div>
                  )}
                </div>

                <form onSubmit={handleSaveIncident} className="space-y-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-zinc-400">Trạng thái xử lý *</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                      required
                    >
                      <option value="OPEN">Mở (Open)</option>
                      <option value="IN_PROGRESS">Đang xử lý (In Progress)</option>
                      <option value="RESOLVED">Đã giải quyết (Resolved)</option>
                      <option value="FOLLOWED_UP">Đã chăm sóc agency (Followed Up)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-zinc-400">Nhân sự phụ trách xử lý</label>
                    <select
                      value={editAssignedTo}
                      onChange={(e) => setEditAssignedTo(e.target.value)}
                      className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                    >
                      <option value="">-- Chọn nhân sự --</option>
                      {staffRawList.map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-zinc-400">Ghi chú giải pháp / Hướng khắc phục</label>
                    <textarea
                      rows={2}
                      placeholder="Ghi chú rõ phương án đền bù, xử lý hoặc giải quyết với khách..."
                      value={editResolutionNote}
                      onChange={(e) => setEditResolutionNote(e.target.value)}
                      className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-zinc-400">Thời điểm giải quyết xong</label>
                    <input
                      type="datetime-local"
                      value={editResolvedAt}
                      onChange={(e) => setEditResolvedAt(e.target.value)}
                      className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-1">
                    <input
                      id="agencyFollowedUp"
                      type="checkbox"
                      checked={editAgencyFollowedUp}
                      onChange={(e) => setEditAgencyFollowedUp(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-800 bg-zinc-950 text-amber-500 accent-amber-500"
                    />
                    <label htmlFor="agencyFollowedUp" className="font-semibold text-zinc-300 cursor-pointer">
                      Đã chăm sóc / Liên hệ phản hồi lại với Agency?
                    </label>
                  </div>

                  <div className="flex justify-end gap-3 pt-3 border-t border-zinc-850">
                    <button
                      type="button"
                      onClick={() => setEditingIncident(null)}
                      className="px-4 py-2 rounded-lg border border-zinc-850 text-zinc-400 hover:bg-zinc-800"
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingIncident}
                      className="px-5 py-2 rounded-lg bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400 transition disabled:opacity-50"
                    >
                      {isSavingIncident ? "Đang lưu..." : "Lưu thay đổi"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === "reports" ? (
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
      ) : activeTab === "agencies" ? (
        /* AGENCY HEALTH TAB CONTENT */
        <div className="mx-auto w-full max-w-4xl px-4 mt-6 space-y-6">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
            <h2 className="text-base font-bold text-white mb-2">Bảng Theo Dõi Sức Khỏe Quan Hệ Agency</h2>
            <p className="text-xs text-zinc-450 mb-6">
              Màu sắc lần cuối mang đoàn: <span className="text-emerald-400 font-semibold">Xanh</span> (đón gần đây) • <span className="text-amber-400 font-semibold">Vàng</span> (&gt;30 ngày chưa có đoàn - cần hỏi thăm) • <span className="text-rose-400 font-semibold">Đỏ</span> (&gt;60 ngày chưa có đoàn - nguy cơ mất đối tác).
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/40 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Tên Agency</th>
                    <th className="py-3 px-4 text-center">Đoàn/Khách tháng này</th>
                    <th className="py-3 px-4 text-center">Đoàn/Khách tháng trước</th>
                    <th className="py-3 px-4 text-center">Xu Hướng Khách</th>
                    <th className="py-3 px-4 text-center">Sự Cố (180 ngày)</th>
                    <th className="py-3 px-4 text-center">Lần cuối đón đoàn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {agencyHealthList.map((row, idx) => {
                    // Decide status color
                    let statusColor = "text-zinc-400 bg-zinc-900/50 border border-zinc-850";
                    let statusLabel = "Chưa có đoàn";
                    
                    if (row.daysSinceLast !== -1) {
                      if (row.daysSinceLast > 60) {
                        statusColor = "text-rose-400 bg-rose-950/20 border border-rose-900/40";
                        statusLabel = `Im lặng ${row.daysSinceLast} ngày`;
                      } else if (row.daysSinceLast > 30) {
                        statusColor = "text-amber-400 bg-amber-950/20 border border-amber-900/40";
                        statusLabel = `Im lặng ${row.daysSinceLast} ngày`;
                      } else {
                        statusColor = "text-emerald-400 bg-emerald-950/20 border border-emerald-900/40";
                        statusLabel = `${row.daysSinceLast === 0 ? "Hôm nay" : `${row.daysSinceLast} ngày trước`}`;
                      }
                    }

                    return (
                      <tr key={idx} className="hover:bg-zinc-900/20 transition">
                        <td className="py-3.5 px-4 font-bold text-zinc-200">
                          {row.name}
                          <span className="block font-normal text-[10px] text-zinc-500 mt-0.5">
                            {row.contactPerson ? `${row.contactPerson} (${row.phone || "—"})` : "Chưa cập nhật liên hệ"}
                          </span>
                        </td>
                        
                        <td className="py-3.5 px-4 text-center">
                          <span className="font-semibold text-zinc-200">{row.thisMonthGroups} đoàn</span>
                          <span className="block text-[10px] text-zinc-500 mt-0.5">{row.thisMonthPax} khách</span>
                        </td>
                        
                        <td className="py-3.5 px-4 text-center">
                          <span className="text-zinc-400">{row.lastMonthGroups} đoàn</span>
                          <span className="block text-[10px] text-zinc-500 mt-0.5">{row.lastMonthPax} khách</span>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          {row.paxTrend > 0 ? (
                            <span className="text-emerald-450 font-bold text-xs flex items-center justify-center">
                              ↑ (+{row.paxTrend})
                            </span>
                          ) : row.paxTrend < 0 ? (
                            <span className="text-rose-450 font-bold text-xs flex items-center justify-center">
                              ↓ ({row.paxTrend})
                            </span>
                          ) : (
                            <span className="text-zinc-555 font-bold text-xs flex items-center justify-center">
                              →
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          {row.incidentsCount > 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/50 border border-rose-900/50 text-rose-350">
                              {row.incidentsCount} lần
                            </span>
                          ) : (
                            <span className="text-zinc-550">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <div className="flex flex-col items-center justify-center space-y-1">
                            <span className="text-[10px] text-zinc-350 font-mono">
                              {row.lastVisitDate ? new Date(row.lastVisitDate).toLocaleDateString("vi-VN") : "—"}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${statusColor}`}>
                              {statusLabel}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === "bookings" ? (
        /* BOOKINGS TAB CONTENT */
        <div className="mx-auto w-full max-w-4xl px-4 mt-6 space-y-6">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
            <h2 className="text-base font-bold text-white mb-2">Đoàn & Sự Kiện Trong 7 Ngày Tới</h2>
            <p className="text-xs text-zinc-450 mb-6">
              Danh sách đặt đoàn sắp tới trong vòng 7 ngày. Các đoàn ở trạng thái <span className="text-yellow-400 font-semibold">Tạm đặt (TENTATIVE) quá 48 giờ</span> kể từ lúc tạo sẽ được tô vàng cảnh báo để Owner kịp thời liên hệ chốt giữ chỗ.
            </p>

            {next7DaysBookings.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-zinc-850 rounded-2xl text-zinc-550 text-xs italic">
                Không có lịch đặt đoàn nào trong 7 ngày tới.
              </div>
            ) : (
              <div className="space-y-3">
                {next7DaysBookings.map((b) => {
                  const tooOld = isTentativeAndTooOld(b);
                  const startStr = new Date(b.starts_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
                  const endStr = new Date(b.ends_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
                  const name = b.group_name || b.agency_name_raw || b.agencies?.name || "Khách lẻ";

                  return (
                    <div
                      key={b.id}
                      className={`rounded-xl border p-4 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition ${
                        tooOld 
                          ? "bg-yellow-950/20 border-yellow-500/50 shadow-md shadow-yellow-500/5" 
                          : "bg-zinc-950/40 border-zinc-850"
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-zinc-200">{name}</span>
                          {tooOld && (
                            <span className="bg-yellow-500 text-zinc-950 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider animate-pulse">
                              ⚠️ Quá 48h chưa chốt
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-450 font-medium">
                          Sảnh: <span className="text-zinc-300 font-bold">{b.venues?.name}</span> • Số khách: <span className="text-zinc-300 font-bold">{b.pax} pax</span> (Sức chứa: {b.venues?.capacity})
                        </div>
                        <div className="text-zinc-550 font-mono text-[10px]">
                          Thời gian: {startStr} - {endStr}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${
                          b.status === "CONFIRMED"
                            ? "bg-emerald-950/60 border-emerald-900 text-emerald-440"
                            : b.status === "TENTATIVE"
                            ? "bg-yellow-950/60 border-yellow-900/60 text-yellow-400"
                            : "bg-zinc-800 border-zinc-750 text-zinc-450"
                        }`}>
                          {b.status === "CONFIRMED" ? "XÁC NHẬN" : b.status === "TENTATIVE" ? "TẠM ĐẶT" : b.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === "staff" ? (
        /* STAFF TAB CONTENT */
        <div className="mx-auto w-full max-w-4xl px-4 mt-6 space-y-6">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
            <h2 className="text-base font-bold text-white mb-2">Báo Cáo Xác Nhận SOP & SPEC Nhân Sự</h2>
            <p className="text-xs text-zinc-450 mb-6">
              Bảng đối chiếu kiểm tra xem những nhân viên nào chưa nhấn đọc và cam kết đối với các tài liệu quy trình vận hành (SOP) hoặc công thức món chuẩn (SPEC).
            </p>

            <div className="space-y-4">
              {missingAcks.map((item) => (
                <div key={item.sop.id} className="rounded-xl border border-zinc-850 bg-zinc-950/40 p-4 space-y-3">
                  <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                    <div>
                      <span className="font-bold text-zinc-250 text-sm">{item.sop.title}</span>
                      <span className="text-[9px] bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-550 font-mono ml-2">v{item.sop.version}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500">
                      Áp dụng: <span className="font-bold text-zinc-450">{item.sop.department}</span>
                    </span>
                  </div>

                  {item.missingStaff.length === 0 ? (
                    <div className="text-xs text-emerald-450 font-semibold flex items-center py-1">
                      <span className="mr-1.5">✓</span> 100% nhân sự đã đọc và cam kết!
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-rose-350 font-bold uppercase tracking-wider block">
                        ⚠️ Chưa cam kết ({item.missingStaff.length} người):
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {item.missingStaff.map((s) => (
                          <span
                            key={s.id}
                            className="bg-rose-950/30 border border-rose-900/40 text-rose-300 px-2 py-0.5 rounded text-[10px] font-medium"
                          >
                            {s.full_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : activeTab === ("safety" as any) ? (
        /* FOOD SAFETY & COMPLIANCE TAB CONTENT */
        <div className="mx-auto w-full max-w-4xl px-4 mt-6 space-y-6">
          {/* Disclaimer / Warning Banner */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-950/5 p-4 space-y-2 text-xs">
            <span className="font-bold text-amber-300 block">⚠️ Lưu ý kỹ thuật về định mức</span>
            <p className="text-zinc-400 leading-relaxed">
              Cảnh báo định mức tồn kho hiện tại chỉ mang tính chất dự báo dựa trên lượng nhập kho lũy kế (GR) và định mức tối thiểu. Hệ thống chưa triển khai phân hệ ghi xuất kho, do đó chưa phản ánh tồn kho chính xác theo thời gian thực.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Box 1: Thiết bị lệch nhiệt hôm nay */}
            <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-4">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
                ❄️ Hôm nay: Thiết bị lệch nhiệt độ
              </h3>
              {outOfRangeLogsToday.length === 0 ? (
                <div className="text-center py-8 text-emerald-450 text-xs font-semibold">
                  ✓ Tất cả thiết bị đều hoạt động trong ngưỡng an toàn!
                </div>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {outOfRangeLogsToday.map((log: any) => (
                    <div key={log.id} className="p-3 rounded-lg border border-rose-900/35 bg-rose-950/20 text-rose-300 text-xs space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-zinc-200">{log.equipment?.name}</span>
                        <span className="font-mono text-rose-400">{log.temp_c}°C ⚠️</span>
                      </div>
                      <div className="text-[10px] text-zinc-450 flex justify-between">
                        <span>Chuẩn: {log.equipment?.min_temp}°C đến {log.equipment?.max_temp}°C</span>
                        <span>Log: {new Date(log.logged_at).toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-[10.5px] italic text-zinc-305 pt-1 border-t border-rose-900/20">
                        &quot;Lý do: {log.note || "chưa ghi nhận"}&quot;
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Box 2: Trạng thái Log & Lưu mẫu hôm nay */}
            <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-4">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
                📋 Hôm nay: Nhật ký & Lưu mẫu ca
              </h3>
              
              <div className="space-y-4 text-xs">
                {/* Temperature Logs Count */}
                <div className="flex justify-between items-center bg-zinc-950/40 p-3 rounded-xl border border-zinc-850">
                  <div>
                    <span className="font-bold text-zinc-200 block">Lượt log nhiệt tủ lạnh</span>
                    <span className="text-[10px] text-zinc-500">Bắt buộc 2 lượt/ca cho toàn sảnh</span>
                  </div>
                  <span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${
                    totalTempLogsToday >= equipmentList.length * 2
                      ? "bg-emerald-950/40 border-emerald-900 text-emerald-450"
                      : totalTempLogsToday > 0
                      ? "bg-yellow-950/40 border-yellow-900/40 text-yellow-450"
                      : "bg-rose-950/40 border-rose-900/40 text-rose-450"
                  }`}>
                    {totalTempLogsToday > 0 ? `Đã log ${totalTempLogsToday} lượt` : "Chưa log ca nào"}
                  </span>
                </div>

                {/* Food Samples Count */}
                <div className="flex justify-between items-center bg-zinc-950/40 p-3 rounded-xl border border-zinc-850">
                  <div>
                    <span className="font-bold text-zinc-200 block">Mẫu thực phẩm đã lưu</span>
                    <span className="text-[10px] text-zinc-500">Giám sát 24h đối với bếp ăn lớn</span>
                  </div>
                  <span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${
                    foodSamplesToday.length > 0
                      ? "bg-emerald-950/40 border-emerald-900 text-emerald-450"
                      : "bg-amber-950/40 border-amber-900/40 text-amber-450 animate-pulse"
                  }`}>
                    {foodSamplesToday.length > 0 ? `Đã lưu ${foodSamplesToday.length} mẫu` : "⚠️ Bếp chưa lưu mẫu nào hôm nay"}
                  </span>
                </div>

                {/* Checklist ATTP entries completed today */}
                <div className="flex justify-between items-center bg-zinc-950/40 p-3 rounded-xl border border-zinc-850">
                  <div>
                    <span className="font-bold text-zinc-200 block">Checklist an toàn vệ sinh</span>
                    <span className="text-[10px] text-zinc-500">Phase ATTP kiểm soát bếp & FOH</span>
                  </div>
                  <span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${
                    attpChecklistStats.percent === 100
                      ? "bg-emerald-950/40 border-emerald-900 text-emerald-450"
                      : attpChecklistStats.done > 0
                      ? "bg-yellow-950/40 border-yellow-900/40 text-yellow-450"
                      : "bg-zinc-850 border-zinc-750 text-zinc-450"
                  }`}>
                    {attpChecklistStats.done}/{attpChecklistStats.total} mục ({attpChecklistStats.percent}%)
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* Box 3: Giấy phép sắp hết hạn nhất */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
              📜 Giấy phép & Cam kết vận hành sắp hết hạn
            </h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-350">
                <thead>
                  <tr className="border-b border-zinc-900 text-[10px] font-bold text-zinc-550 uppercase tracking-wider">
                    <th className="py-2 px-3">Tài liệu pháp lý</th>
                    <th className="py-2 px-3">Đơn vị cấp</th>
                    <th className="py-2 px-3">Ngày hết hạn</th>
                    <th className="py-2 px-3 text-center">Hạn còn lại</th>
                    <th className="py-2 px-3">Phụ trách</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {expiringLicenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-4 text-zinc-650 italic">Không có tài liệu nào sắp hết hạn.</td>
                    </tr>
                  ) : (
                    expiringLicenses.map((l: any) => (
                      <tr key={l.id} className="hover:bg-zinc-900/10 transition">
                        <td className="py-3 px-3 font-bold text-zinc-200">{l.name}</td>
                        <td className="py-3 px-3 text-zinc-450">{l.issuer || "—"}</td>
                        <td className="py-3 px-3 font-mono">{new Date(l.expires_on).toLocaleDateString("vi-VN")}</td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${l.badgeColor}`}>
                            {l.daysLeft <= 0 ? "Quá hạn" : `${l.daysLeft} ngày`}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-zinc-300 font-semibold">{staffList[l.owner_staff_id] || "Chưa giao"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

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
