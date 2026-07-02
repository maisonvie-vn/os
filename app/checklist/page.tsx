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
  created_at: string;
}

interface ChecklistTemplate {
  id: string;
  shift: "TRUA" | "TOI";
  phase: "MO_CA" | "DONG_CA";
  item_order: number;
  content: string;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

interface ChecklistEntry {
  id?: string;
  work_date: string;
  shift: "TRUA" | "TOI";
  template_id: string;
  is_done: boolean;
  note: string | null;
  checked_at: string | null;
  checked_by: string | null;
  staff_name?: string;
}

function ChecklistContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<"execute" | "manage">("execute");

  // Filters for checklist execution
  const [workDate, setWorkDate] = useState<string>("");
  const [shift, setShift] = useState<"TRUA" | "TOI">("TRUA");
  const [phase, setPhase] = useState<"MO_CA" | "DONG_CA">("MO_CA");

  // Data states
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [entries, setEntries] = useState<ChecklistEntry[]>([]);
  const [staffList, setStaffList] = useState<Record<string, string>>({}); // id -> name mapping
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Template management states
  const [manageShift, setManageShift] = useState<"TRUA" | "TOI">("TRUA");
  const [managePhase, setManagePhase] = useState<"MO_CA" | "DONG_CA">("MO_CA");
  const [newContent, setNewContent] = useState("");
  const [newOrder, setNewOrder] = useState("");
  const [isEditingTemplateId, setIsEditingTemplateId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingOrder, setEditingOrder] = useState("");

  // Get local date in YYYY-MM-DD format
  useEffect(() => {
    const today = new Date();
    // Default shift based on hour (before 15:00 is TRUA, after is TOI)
    const currentHour = today.getHours();
    setShift(currentHour >= 15 ? "TOI" : "TRUA");
    setManageShift(currentHour >= 15 ? "TOI" : "TRUA");

    // Local YYYY-MM-DD string
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

  // Fetch all staff for mapper
  useEffect(() => {
    if (checkingAuth) return;
    async function fetchStaffList() {
      const supabase = createClient();
      const { data } = await supabase.from("staff").select("id, full_name");
      if (data) {
        const mapper: Record<string, string> = {};
        data.forEach((s) => {
          mapper[s.id] = s.full_name;
        });
        setStaffList(mapper);
      }
    }
    fetchStaffList();
  }, [checkingAuth]);

  // 2. Fetch Templates & Entries for the execution view
  useEffect(() => {
    if (checkingAuth || !workDate) return;

    let isSubscribed = true;
    async function fetchData() {
      setIsLoading(true);
      const supabase = createClient();

      try {
        // Fetch all active templates for current shift & phase
        const { data: tpls, error: tplsErr } = await supabase
          .from("checklist_templates")
          .select("*")
          .eq("shift", shift)
          .eq("phase", phase)
          .order("item_order", { ascending: true });

        // Fetch entries for this day + shift
        const { data: ents, error: entsErr } = await supabase
          .from("shift_checklist_entries")
          .select("*")
          .eq("work_date", workDate)
          .eq("shift", shift);

        if (isSubscribed) {
          if (!tplsErr && tpls) setTemplates(tpls);
          if (!entsErr && ents) setEntries(ents);
        }
      } catch (err) {
        console.error("Error fetching checklist data:", err);
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    }
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth, workDate, shift, phase]);

  // 3. Fetch templates for management view
  const [manageTemplates, setManageTemplates] = useState<ChecklistTemplate[]>([]);
  useEffect(() => {
    if (checkingAuth || activeTab !== "manage") return;
    async function fetchManageTemplates() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("checklist_templates")
        .select("*")
        .eq("shift", manageShift)
        .eq("phase", managePhase)
        .order("item_order", { ascending: true });
      if (!error && data) {
        setManageTemplates(data);
      }
    }
    fetchManageTemplates();
  }, [checkingAuth, activeTab, manageShift, managePhase]);

  // Auto-fill template order suggestion
  useEffect(() => {
    if (manageTemplates.length > 0) {
      const maxOrder = Math.max(...manageTemplates.map((t) => t.item_order));
      setNewOrder(String(maxOrder + 10));
    } else {
      setNewOrder("10");
    }
  }, [manageTemplates]);

  // Combined data for Execution
  const checklistItems = useMemo(() => {
    return templates.map((template) => {
      const entry = entries.find((e) => e.template_id === template.id);
      return {
        templateId: template.id,
        content: template.content,
        isDone: entry ? entry.is_done : false,
        note: entry ? entry.note || "" : "",
        checkedAt: entry ? entry.checked_at : null,
        checkedBy: entry ? entry.checked_by : null,
        checkedByName: entry && entry.checked_by ? staffList[entry.checked_by] || "Nhan vien" : null,
        entryId: entry?.id,
      };
    });
  }, [templates, entries, staffList]);

  // Calculate Progress
  const progressStats = useMemo(() => {
    const total = checklistItems.filter(item => {
      const tpl = templates.find(t => t.id === item.templateId);
      return tpl?.is_active !== false; // only count active ones
    }).length;
    
    const done = checklistItems.filter(item => {
      const tpl = templates.find(t => t.id === item.templateId);
      return (tpl?.is_active !== false) && item.isDone;
    }).length;

    return {
      total,
      done,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [checklistItems, templates]);

  // Handle Tick Box Save immediately
  const handleToggleCheck = async (templateId: string, currentDone: boolean, note: string) => {
    if (!staff || !workDate) return;
    
    setSaveStatus("Đang lưu...");
    const supabase = createClient();
    const isDone = !currentDone;
    const nowStr = isDone ? new Date().toISOString() : null;
    const checkedBy = isDone ? staff.id : null;

    // Optimistic Update
    setEntries((prev) => {
      const exists = prev.some((e) => e.template_id === templateId);
      if (exists) {
        return prev.map((e) =>
          e.template_id === templateId
            ? { ...e, is_done: isDone, checked_by: checkedBy, checked_at: nowStr }
            : e
        );
      } else {
        return [
          ...prev,
          {
            work_date: workDate,
            shift,
            template_id: templateId,
            is_done: isDone,
            note: note || null,
            checked_at: nowStr,
            checked_by: checkedBy,
          },
        ];
      }
    });

    try {
      const { error } = await supabase
        .from("shift_checklist_entries")
        .upsert(
          {
            work_date: workDate,
            shift,
            template_id: templateId,
            is_done: isDone,
            note: note || null,
            checked_by: checkedBy,
            checked_at: nowStr,
          },
          { onConflict: "work_date,shift,template_id" }
        );

      if (error) {
        console.error("Lỗi lưu checklist:", error.message);
        setSaveStatus("Lỗi lưu dữ liệu!");
        // Revert optimistic update by refetching entries
        const { data: refetched } = await supabase
          .from("shift_checklist_entries")
          .select("*")
          .eq("work_date", workDate)
          .eq("shift", shift);
        if (refetched) setEntries(refetched);
      } else {
        setSaveStatus("Đã lưu ✓");
        setTimeout(() => setSaveStatus(null), 1000);
      }
    } catch (err) {
      console.error(err);
      setSaveStatus("Lỗi kết nối!");
    }
  };

  // Handle Note Update on Blur
  const handleNoteBlur = async (templateId: string, currentDone: boolean, noteValue: string) => {
    if (!staff || !workDate) return;

    setSaveStatus("Đang lưu ghi chú...");
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("shift_checklist_entries")
        .upsert(
          {
            work_date: workDate,
            shift,
            template_id: templateId,
            is_done: currentDone,
            note: noteValue || null,
          },
          { onConflict: "work_date,shift,template_id" }
        );

      if (error) {
        console.error("Lỗi lưu ghi chú:", error.message);
        setSaveStatus("Lỗi ghi chú!");
      } else {
        // Sync local state
        setEntries((prev) => {
          const exists = prev.some((e) => e.template_id === templateId);
          if (exists) {
            return prev.map((e) =>
              e.template_id === templateId ? { ...e, note: noteValue || null } : e
            );
          } else {
            return [
              ...prev,
              {
                work_date: workDate,
                shift,
                template_id: templateId,
                is_done: currentDone,
                note: noteValue || null,
                checked_at: null,
                checked_by: null,
              },
            ];
          }
        });
        setSaveStatus("Đã lưu ghi chú ✓");
        setTimeout(() => setSaveStatus(null), 1000);
      }
    } catch (err) {
      console.error(err);
      setSaveStatus("Lỗi kết nối!");
    }
  };

  // TEMPLATE MANAGEMENT HANDLERS
  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || !newContent.trim()) return;

    const supabase = createClient();
    const orderNum = parseInt(newOrder, 10) || 10;

    try {
      const { data, error } = await supabase
        .from("checklist_templates")
        .insert({
          shift: manageShift,
          phase: managePhase,
          item_order: orderNum,
          content: newContent.trim(),
          is_active: true,
          created_by: staff.id,
        })
        .select();

      if (error) {
        alert("Lỗi thêm mẫu: " + error.message);
      } else {
        setNewContent("");
        if (data) {
          setManageTemplates((prev) => [...prev, data[0]].sort((a, b) => a.item_order - b.item_order));
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleTemplateActive = async (id: string, currentActive: boolean) => {
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("checklist_templates")
        .update({ is_active: !currentActive })
        .eq("id", id);

      if (error) {
        alert("Lỗi: " + error.message);
      } else {
        setManageTemplates((prev) =>
          prev.map((t) => (t.id === id ? { ...t, is_active: !currentActive } : t))
        );
        // Also refresh execution templates if the filtered view matches
        if (shift === manageShift && phase === managePhase) {
          setTemplates((prev) =>
            prev.map((t) => (t.id === id ? { ...t, is_active: !currentActive } : t))
          );
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const startEditTemplate = (tpl: ChecklistTemplate) => {
    setIsEditingTemplateId(tpl.id);
    setEditingContent(tpl.content);
    setEditingOrder(String(tpl.item_order));
  };

  const handleSaveEditTemplate = async (id: string) => {
    if (!editingContent.trim()) return;
    const supabase = createClient();
    const orderNum = parseInt(editingOrder, 10) || 10;

    try {
      const { error } = await supabase
        .from("checklist_templates")
        .update({
          content: editingContent.trim(),
          item_order: orderNum,
        })
        .eq("id", id);

      if (error) {
        alert("Lỗi sửa: " + error.message);
      } else {
        setManageTemplates((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, content: editingContent.trim(), item_order: orderNum } : t
          ).sort((a, b) => a.item_order - b.item_order)
        );
        setIsEditingTemplateId(null);
        // Refresh active execution list
        if (shift === manageShift && phase === managePhase) {
          const { data } = await supabase
            .from("checklist_templates")
            .select("*")
            .eq("shift", shift)
            .eq("phase", phase)
            .order("item_order", { ascending: true });
          if (data) setTemplates(data);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 text-sm">Đang xác thực quyền truy cập...</div>
      </main>
    );
  }

  const isManagerOrOwner = staff ? (staff.role === "owner" || staff.role === "manager") : false;

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
        <h1 className="text-base font-bold text-white">Checklist Ca</h1>
        {saveStatus ? (
          <span className="text-xs font-semibold text-amber-400 animate-pulse">{saveStatus}</span>
        ) : (
          <div className="w-16"></div>
        )}
      </header>

      {/* Tabs */}
      <div className="mx-auto w-full max-w-lg px-4 mt-6">
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setActiveTab("execute")}
            className={`flex-1 py-3 text-center text-sm font-semibold border-b-2 transition ${
              activeTab === "execute"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-300"
            }`}
          >
            📋 Thực Hiện Ca
          </button>
          {isManagerOrOwner && (
            <button
              onClick={() => setActiveTab("manage")}
              className={`flex-1 py-3 text-center text-sm font-semibold border-b-2 transition ${
                activeTab === "manage"
                  ? "border-amber-500 text-white"
                  : "border-transparent text-zinc-450 hover:text-zinc-300"
              }`}
            >
              ⚙️ Thiết Lập Mẫu
            </button>
          )}
        </div>
      </div>

      {activeTab === "execute" ? (
        <div className="mx-auto w-full max-w-lg px-4 mt-6 space-y-6">
          {/* Controls */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-4 space-y-4">
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
                  Ca làm việc
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

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">
                Giai đoạn
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPhase("MO_CA")}
                  className={`py-3 rounded-xl text-xs font-bold transition border flex items-center justify-center space-x-2 ${
                    phase === "MO_CA"
                      ? "bg-amber-500/10 border-amber-500 text-amber-300"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  <span className="text-sm">🔓</span>
                  <span>Mở Ca</span>
                </button>
                <button
                  onClick={() => setPhase("DONG_CA")}
                  className={`py-3 rounded-xl text-xs font-bold transition border flex items-center justify-center space-x-2 ${
                    phase === "DONG_CA"
                      ? "bg-amber-500/10 border-amber-500 text-amber-300"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  <span className="text-sm">🔒</span>
                  <span>Đóng Ca</span>
                </button>
              </div>
            </div>
          </div>

          {/* Progress Indicator */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-4">
            <div className="flex items-center justify-between text-sm font-semibold mb-2">
              <span className="text-zinc-300">Tiến độ ca</span>
              <span className="text-amber-400 font-mono">
                Đã xong {progressStats.done}/{progressStats.total} mục ({progressStats.percent}%)
              </span>
            </div>
            <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-zinc-800">
              <div
                className="bg-gradient-to-r from-amber-500 to-amber-400 h-full transition-all duration-300"
                style={{ width: `${progressStats.percent}%` }}
              ></div>
            </div>
          </div>

          {/* Checklist Items */}
          {isLoading ? (
            <div className="text-center py-12 text-zinc-500 text-sm">Đang tải danh sách checklist...</div>
          ) : checklistItems.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-zinc-800 rounded-2xl text-zinc-500 text-sm">
              Chưa có cấu hình mẫu checklist cho ca này.
              {isManagerOrOwner && (
                <button
                  onClick={() => setActiveTab("manage")}
                  className="mt-3 block mx-auto text-xs font-bold text-amber-400 hover:underline"
                >
                  + Thiết lập mẫu ngay
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {checklistItems.map((item) => (
                <div
                  key={item.templateId}
                  className={`rounded-2xl border p-4 transition-all duration-200 ${
                    item.isDone
                      ? "border-emerald-500/30 bg-emerald-950/5"
                      : "border-zinc-850 bg-zinc-900/10 hover:border-zinc-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Big Checkbox on Left */}
                    <button
                      type="button"
                      onClick={() => handleToggleCheck(item.templateId, item.isDone, item.note)}
                      className={`h-6 w-6 rounded-lg border flex items-center justify-center shrink-0 transition ${
                        item.isDone
                          ? "bg-emerald-500 border-emerald-500 text-zinc-950"
                          : "border-zinc-700 bg-zinc-950 hover:border-zinc-650"
                      }`}
                    >
                      {item.isDone && (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>

                    {/* Content & Metadata */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${item.isDone ? "text-zinc-400 line-through" : "text-white"}`}>
                        {item.content}
                      </p>
                      {item.isDone && item.checkedByName && (
                        <span className="inline-block mt-1 text-[10px] text-zinc-500">
                          ✓ Xong bởi {item.checkedByName} lúc{" "}
                          {item.checkedAt ? new Date(item.checkedAt).toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' }) : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Note Input */}
                  <div className="mt-3">
                    <input
                      type="text"
                      placeholder="Ghi chú nhanh (nếu có)..."
                      defaultValue={item.note}
                      onBlur={(e) => handleNoteBlur(item.templateId, item.isDone, e.target.value)}
                      className="w-full text-xs rounded-lg border border-zinc-850 bg-zinc-950/40 px-3 py-2 text-zinc-300 outline-none transition focus:border-zinc-700 focus:bg-zinc-950"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* MANAGE TEMPLATES TAB */
        <div className="mx-auto w-full max-w-lg px-4 mt-6 space-y-6">
          {/* Shift/Phase Selector */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                  Mẫu theo ca
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setManageShift("TRUA")}
                    className={`py-2 rounded-xl text-xs font-bold transition border ${
                      manageShift === "TRUA"
                        ? "bg-amber-500 border-amber-500 text-zinc-950"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    ☀️ Trưa
                  </button>
                  <button
                    onClick={() => setManageShift("TOI")}
                    className={`py-2 rounded-xl text-xs font-bold transition border ${
                      manageShift === "TOI"
                        ? "bg-amber-500 border-amber-500 text-zinc-950"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    🌙 Tối
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                  Mẫu giai đoạn
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setManagePhase("MO_CA")}
                    className={`py-2 rounded-xl text-xs font-bold transition border ${
                      managePhase === "MO_CA"
                        ? "bg-amber-500/10 border-amber-500 text-amber-300"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Mở Ca
                  </button>
                  <button
                    onClick={() => setManagePhase("DONG_CA")}
                    className={`py-2 rounded-xl text-xs font-bold transition border ${
                      managePhase === "DONG_CA"
                        ? "bg-amber-500/10 border-amber-500 text-amber-300"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Đóng Ca
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Add Template Form */}
          <form onSubmit={handleAddTemplate} className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Thêm mục checklist mới</h3>
            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-3">
                <input
                  type="text"
                  placeholder="Nội dung mục checklist..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <input
                  type="number"
                  placeholder="Thứ tự"
                  value={newOrder}
                  onChange={(e) => setNewOrder(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                  required
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-amber-500 text-zinc-950 py-2.5 text-xs font-bold hover:bg-amber-400 transition"
            >
              + Thêm Vào Mẫu
            </button>
          </form>

          {/* Template List */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">Danh sách mẫu hiện tại</h3>
            {manageTemplates.length === 0 ? (
              <div className="text-center py-8 text-zinc-650 text-xs border border-dashed border-zinc-850 rounded-xl">
                Chưa có mẫu nào cho ca và giai đoạn được chọn.
              </div>
            ) : (
              <div className="space-y-2">
                {manageTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className={`rounded-xl border p-3 flex flex-col space-y-2 ${
                      tpl.is_active ? "border-zinc-850 bg-zinc-900/10" : "border-zinc-900 bg-zinc-950/20 opacity-55"
                    }`}
                  >
                    {isEditingTemplateId === tpl.id ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-4 gap-2">
                          <input
                            type="text"
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            className="col-span-3 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
                          />
                          <input
                            type="number"
                            value={editingOrder}
                            onChange={(e) => setEditingOrder(e.target.value)}
                            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
                          />
                        </div>
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => setIsEditingTemplateId(null)}
                            className="px-2.5 py-1 rounded bg-zinc-800 text-[10px] font-semibold text-zinc-400 hover:text-white"
                          >
                            Hủy
                          </button>
                          <button
                            onClick={() => handleSaveEditTemplate(tpl.id)}
                            className="px-2.5 py-1 rounded bg-amber-500 text-[10px] font-bold text-zinc-950"
                          >
                            Lưu
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center space-x-2 min-w-0">
                          <span className="text-[10px] font-mono text-zinc-500 shrink-0">#{tpl.item_order}</span>
                          <span className={`text-xs font-medium truncate ${tpl.is_active ? "text-zinc-200" : "text-zinc-550 line-through"}`}>
                            {tpl.content}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <button
                            onClick={() => startEditTemplate(tpl)}
                            className="text-[10px] font-bold text-zinc-450 hover:text-white hover:underline px-1"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => handleToggleTemplateActive(tpl.id, tpl.is_active)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded transition ${
                              tpl.is_active
                                ? "bg-rose-950/50 border border-rose-900/50 text-rose-350 hover:bg-rose-900/50"
                                : "bg-emerald-950/50 border border-emerald-900/50 text-emerald-350 hover:bg-emerald-900/50"
                            }`}
                          >
                            {tpl.is_active ? "Tắt" : "Bật"}
                          </button>
                        </div>
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

export default function ChecklistPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải...</div>
      </main>
    }>
      <ChecklistContent />
    </Suspense>
  );
}
