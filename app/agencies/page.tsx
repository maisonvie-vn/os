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

interface Agency {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

interface RawGroupVisit {
  id: string;
  agency_name_raw: string | null;
  agency_id: string | null;
}

function AgenciesContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<"list" | "merge">("list");

  // Data states
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [last30DaysVisits, setLast30DaysVisits] = useState<Record<string, number>>({});
  const [unmatchedVisits, setUnmatchedVisits] = useState<RawGroupVisit[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Form states (Add/Edit)
  const [isEditingId, setIsEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formFeedback, setFormFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Merge states
  const [selectedMergeTarget, setSelectedMergeTarget] = useState<Record<string, string>>({}); // rawName -> agencyId mapping
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);

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

      // Check Owner/Manager role
      if (staffData.role !== "owner" && staffData.role !== "manager") {
        router.push("/home");
        return;
      }

      setStaff(staffData);
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  // 2. Fetch master data
  useEffect(() => {
    if (checkingAuth) return;

    let isSubscribed = true;
    async function fetchData() {
      setIsLoading(true);
      const supabase = createClient();

      try {
        // Fetch all agencies
        const { data: agData } = await supabase
          .from("agencies")
          .select("*")
          .order("name", { ascending: true });

        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

        // Fetch visits in the last 30 days to calculate performance count
        const { data: visitsData } = await supabase
          .from("group_visits")
          .select("agency_id")
          .gte("visit_date", dateStr)
          .not("agency_id", "is", null);

        // Fetch unmatched visits with raw names for the merge tab
        const { data: unmatchedData } = await supabase
          .from("group_visits")
          .select("id, agency_name_raw, agency_id")
          .is("agency_id", null)
          .not("agency_name_raw", "is", null);

        if (isSubscribed) {
          if (agData) setAgencies(agData);
          
          if (visitsData) {
            const counts: Record<string, number> = {};
            visitsData.forEach((v) => {
              if (v.agency_id) {
                counts[v.agency_id] = (counts[v.agency_id] || 0) + 1;
              }
            });
            setLast30DaysVisits(counts);
          }

          if (unmatchedData) {
            setUnmatchedVisits(unmatchedData);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    }
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth]);

  // Group raw unmatched visits for merge list
  const rawMergeList = useMemo(() => {
    const counts: Record<string, number> = {};
    unmatchedVisits.forEach((v) => {
      if (v.agency_name_raw) {
        counts[v.agency_name_raw] = (counts[v.agency_name_raw] || 0) + 1;
      }
    });

    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
    })).sort((a, b) => b.count - a.count);
  }, [unmatchedVisits]);

  // Handle Add/Edit Form submit
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!name.trim()) {
      setFormFeedback({ type: "error", text: "Tên agency không được để trống!" });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    try {
      if (isEditingId) {
        // Edit mode
        const { error } = await supabase
          .from("agencies")
          .update({
            name: name.trim(),
            contact_person: contactPerson.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            note: note.trim() || null,
            is_active: isActive,
          })
          .eq("id", isEditingId);

        if (error) {
          setFormFeedback({ type: "error", text: `Lỗi sửa: ${error.message}` });
        } else {
          setFormFeedback({ type: "success", text: "Cập nhật thành công ✓" });
          setAgencies((prev) =>
            prev.map((a) =>
              a.id === isEditingId
                ? {
                    ...a,
                    name: name.trim(),
                    contact_person: contactPerson.trim() || null,
                    phone: phone.trim() || null,
                    email: email.trim() || null,
                    note: note.trim() || null,
                    is_active: isActive,
                  }
                : a
            ).sort((a, b) => a.name.localeCompare(b.name))
          );
          resetForm();
        }
      } else {
        // Add mode
        const { data, error } = await supabase
          .from("agencies")
          .insert({
            name: name.trim(),
            contact_person: contactPerson.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            note: note.trim() || null,
            is_active: true,
            created_by: staff.id,
          })
          .select();

        if (error) {
          setFormFeedback({ type: "error", text: `Lỗi thêm: ${error.message}` });
        } else {
          setFormFeedback({ type: "success", text: "Đã thêm agency thành công ✓" });
          if (data) {
            setAgencies((prev) => [...prev, data[0]].sort((a, b) => a.name.localeCompare(b.name)));
          }
          resetForm();
        }
      }
    } catch (err) {
      console.error(err);
      setFormFeedback({ type: "error", text: "Lỗi kết nối!" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (agency: Agency) => {
    setIsEditingId(agency.id);
    setName(agency.name);
    setContactPerson(agency.contact_person || "");
    setPhone(agency.phone || "");
    setEmail(agency.email || "");
    setNote(agency.note || "");
    setIsActive(agency.is_active);
    setFormFeedback(null);
  };

  const resetForm = () => {
    setIsEditingId(null);
    setName("");
    setContactPerson("");
    setPhone("");
    setEmail("");
    setNote("");
    setIsActive(true);
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("agencies")
        .update({ is_active: !currentActive })
        .eq("id", id);

      if (error) {
        alert("Lỗi: " + error.message);
      } else {
        setAgencies((prev) =>
          prev.map((a) => (a.id === id ? { ...a, is_active: !currentActive } : a))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Handle Merge logic
  const handleMerge = async (rawName: string) => {
    const targetAgencyId = selectedMergeTarget[rawName];
    if (!targetAgencyId) {
      alert("Vui lòng chọn agency đích!");
      return;
    }

    setMergeFeedback(`Đang gộp "${rawName}"...`);
    const supabase = createClient();

    try {
      // 1. Update group visits
      const { error: visitErr } = await supabase
        .from("group_visits")
        .update({
          agency_id: targetAgencyId,
          agency_name_raw: null,
        })
        .eq("agency_name_raw", rawName)
        .is("agency_id", null);

      // 2. Update incidents with the same raw name
      const { error: incErr } = await supabase
        .from("incidents")
        .update({
          agency_id: targetAgencyId,
          agency: null, // clear text name if desired, or keep both as fallback
        })
        .eq("agency", rawName)
        .is("agency_id", null);

      if (visitErr || incErr) {
        const errorMsg = (visitErr?.message || "") + " " + (incErr?.message || "");
        alert(`Lỗi khi gộp: ${errorMsg}`);
        setMergeFeedback(null);
      } else {
        // Remove merged visits from state
        setUnmatchedVisits((prev) => prev.filter((v) => v.agency_name_raw !== rawName));
        setMergeFeedback(`Đã gộp thành công "${rawName}" ✓`);

        // Recalculate last 30 days count: increase target agency's count by merged visits count
        const mergedCount = unmatchedVisits.filter((v) => v.agency_name_raw === rawName).length;
        setLast30DaysVisits((prev) => ({
          ...prev,
          [targetAgencyId]: (prev[targetAgencyId] || 0) + mergedCount,
        }));

        setTimeout(() => setMergeFeedback(null), 1500);
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi kết nối máy chủ");
      setMergeFeedback(null);
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
      <header className="sticky top-0 z-40 border-b border-zinc-900 bg-zinc-950/80 px-4 py-4 backdrop-blur flex items-center justify-between">
        <button
          onClick={() => router.push("/home")}
          className="flex items-center space-x-1 text-sm text-zinc-400 hover:text-white transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Trang chủ</span>
        </button>
        <h1 className="text-base font-bold text-white">Quản Lý Khách & Agency</h1>
        <div className="w-16"></div>
      </header>

      {/* Tabs */}
      <div className="mx-auto w-full max-w-2xl px-4 mt-6">
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setActiveTab("list")}
            className={`flex-1 py-3 text-center text-sm font-semibold border-b-2 transition ${
              activeTab === "list"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-300"
            }`}
          >
            🏢 Danh sách Agency
          </button>
          <button
            onClick={() => setActiveTab("merge")}
            className={`flex-1 py-3 text-center text-sm font-semibold border-b-2 transition ${
              activeTab === "merge"
                ? "border-amber-500 text-white"
                : "border-transparent text-zinc-450 hover:text-zinc-300"
            }`}
          >
            🔄 Gộp Tên Thô ({rawMergeList.length})
          </button>
        </div>
      </div>

      {activeTab === "list" ? (
        <div className="mx-auto w-full max-w-2xl px-4 mt-6 space-y-6">
          
          {/* Add / Edit Form Card */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5">
            <h3 className="text-sm font-bold text-white mb-4">
              {isEditingId ? "✏️ Sửa Thông Tin Agency" : "➕ Thêm Agency Mới"}
            </h3>
            
            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="agencyName" className="block text-xs font-semibold text-zinc-400 mb-1">
                    Tên Agency chuẩn*
                  </label>
                  <input
                    id="agencyName"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ví dụ: LuxTravel"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:bg-zinc-950"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="contactName" className="block text-xs font-semibold text-zinc-400 mb-1">
                    Người liên hệ (Sales / Hướng dẫn viên)
                  </label>
                  <input
                    id="contactName"
                    type="text"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    placeholder="Ví dụ: Ms. Hương"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:bg-zinc-950"
                  />
                </div>
                <div>
                  <label htmlFor="agencyPhone" className="block text-xs font-semibold text-zinc-400 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    id="agencyPhone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ví dụ: 0912345678"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:bg-zinc-950"
                  />
                </div>
                <div>
                  <label htmlFor="agencyEmail" className="block text-xs font-semibold text-zinc-400 mb-1">
                    Email
                  </label>
                  <input
                    id="agencyEmail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Ví dụ: booking@luxtravel.vn"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:bg-zinc-950"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="agencyNote" className="block text-xs font-semibold text-zinc-400 mb-1">
                  Ghi chú nội bộ
                </label>
                <input
                  id="agencyNote"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú về thói quen, đối tượng khách của tour..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:bg-zinc-950"
                />
              </div>

              {isEditingId && (
                <div className="flex items-center space-x-3 pt-1">
                  <span className="text-xs font-semibold text-zinc-400">Trạng thái hoạt động:</span>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    className={`text-xs px-3 py-1 rounded-lg border font-bold transition ${
                      isActive
                        ? "bg-emerald-950/40 border-emerald-800 text-emerald-450"
                        : "bg-zinc-900 border-zinc-800 text-zinc-500"
                    }`}
                  >
                    {isActive ? "Đang hoạt động (Active)" : "Ngừng nhận (Inactive)"}
                  </button>
                </div>
              )}

              {formFeedback && (
                <div
                  className={`rounded-xl p-3 text-xs border text-center font-bold ${
                    formFeedback.type === "success"
                      ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                      : "bg-rose-950/40 border-rose-980/50 text-rose-300"
                  }`}
                >
                  {formFeedback.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                {isEditingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-5 py-2.5 rounded-xl border border-zinc-850 hover:bg-zinc-800 text-xs font-semibold text-zinc-350 transition"
                  >
                    Hủy sửa
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold text-xs transition"
                >
                  {isEditingId ? "Cập Nhật" : "Thêm mới"}
                </button>
              </div>
            </form>
          </div>

          {/* Master List Table */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 overflow-hidden">
            <h3 className="text-sm font-bold text-white mb-4">Danh sách Master List chuẩn</h3>
            
            {isLoading ? (
              <div className="text-center py-8 text-zinc-500 text-xs">Đang tải danh sách...</div>
            ) : agencies.length === 0 ? (
              <div className="text-center py-8 text-zinc-600 text-xs italic">Chưa có dữ liệu agency nào.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="bg-zinc-900/50 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                    <tr>
                      <th className="py-3 px-4">Tên Agency</th>
                      <th className="py-3 px-4">Liên hệ</th>
                      <th className="py-3 px-4 text-center">Đoàn (30 ngày)</th>
                      <th className="py-3 px-4 text-center">Trạng thái</th>
                      <th className="py-3 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-850">
                    {agencies.map((agency) => (
                      <tr key={agency.id} className="hover:bg-zinc-900/20 transition">
                        <td className="py-3.5 px-4 font-bold text-zinc-200">
                          {agency.name}
                          {agency.note && (
                            <span className="block font-normal text-[10px] text-zinc-500 mt-0.5 truncate max-w-[150px]">
                              {agency.note}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 space-y-0.5 text-zinc-400">
                          <div>{agency.contact_person || "—"}</div>
                          {agency.phone && <div className="font-mono text-[10px]">{agency.phone}</div>}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono font-bold text-zinc-200">
                          {last30DaysVisits[agency.id] || 0}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleToggleActive(agency.id, agency.is_active)}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold border transition ${
                              agency.is_active
                                ? "bg-emerald-950/50 border-emerald-900 text-emerald-400"
                                : "bg-rose-950/50 border-rose-900 text-rose-400"
                            }`}
                          >
                            {agency.is_active ? "Bật" : "Tắt"}
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => startEdit(agency)}
                            className="text-[10px] font-bold text-amber-500 hover:underline"
                          >
                            Sửa
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
      ) : (
        /* MERGE RAW ENTRIES TAB */
        <div className="mx-auto w-full max-w-2xl px-4 mt-6 space-y-6">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white">🔄 Gộp Tên Thô Chưa Khớp</h3>
              <p className="text-xs text-zinc-450 mt-1">
                Khi Duty Manager nhập tên thô chưa có trong danh sách chuẩn ở trang ghi sự cố hoặc ghi đoàn, bạn có thể gộp nhanh tất cả các bản ghi đó vào một đại lý chuẩn dưới đây để làm sạch dữ liệu.
              </p>
            </div>

            {mergeFeedback && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center text-xs font-bold text-amber-400 animate-pulse">
                {mergeFeedback}
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-8 text-zinc-500 text-xs">Đang xử lý dữ liệu...</div>
            ) : rawMergeList.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-zinc-850 rounded-2xl text-zinc-550 text-xs">
                Tuyệt vời! Hiện tại không có tên raw thô nào chưa khớp trong dữ liệu log đoàn.
              </div>
            ) : (
              <div className="space-y-3">
                {rawMergeList.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-zinc-850 bg-zinc-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-zinc-200 text-sm">&quot;{item.name}&quot;</span>
                        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-bold font-mono">
                          {item.count} lần lặp
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-500 block mt-1">
                        Tên thô ghi nhận từ log của Duty Manager
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={selectedMergeTarget[item.name] || ""}
                        onChange={(e) =>
                          setSelectedMergeTarget((prev) => ({
                            ...prev,
                            [item.name]: e.target.value,
                          }))
                        }
                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500 max-w-[200px]"
                      >
                        <option value="">-- Chọn Agency đích --</option>
                        {agencies
                          .filter((a) => a.is_active)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => handleMerge(item.name)}
                        disabled={!selectedMergeTarget[item.name]}
                        className="px-4 py-2 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-extrabold text-xs transition disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Gộp
                      </button>
                    </div>
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

export default function AgenciesPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải...</div>
      </main>
    }>
      <AgenciesContent />
    </Suspense>
  );
}
