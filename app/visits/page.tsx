"use client";

import React, { useState, useEffect, Suspense, useRef, useMemo } from "react";
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
  created_at: string;
  created_by: string;
}

function VisitsContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Filters / Date controls
  const [visitDate, setVisitDate] = useState("");
  const [shift, setShift] = useState<"TRUA" | "TOI">("TRUA");

  // Form states
  const [agencySearch, setAgencySearch] = useState("");
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null);
  const [groupName, setGroupName] = useState("");
  const [pax, setPax] = useState("");
  const [note, setNote] = useState("");

  // Autocomplete UI states
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [filteredAgencies, setFilteredAgencies] = useState<Agency[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionRef = useRef<HTMLDivElement>(null);

  // List states
  const [visits, setVisits] = useState<GroupVisit[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Initialize date & shift
  useEffect(() => {
    const today = new Date();
    const currentHour = today.getHours();
    setShift(currentHour >= 15 ? "TOI" : "TRUA");

    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setVisitDate(`${yyyy}-${mm}-${dd}`);
  }, []);

  // 1. Auth check & fetch agencies
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

      // Load active agencies
      const { data: agData } = await supabase
        .from("agencies")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (agData) {
        setAgencies(agData);
      }
    }
    checkAuth();
  }, [router]);

  // 2. Fetch logged visits for the selected day and shift
  useEffect(() => {
    if (checkingAuth || !visitDate) return;

    let isSubscribed = true;
    async function fetchVisits() {
      setIsLoadingList(true);
      const supabase = createClient();
      try {
        const { data, error } = await supabase
          .from("group_visits")
          .select("*")
          .eq("visit_date", visitDate)
          .eq("shift", shift)
          .order("created_at", { ascending: false });

        if (isSubscribed && !error && data) {
          setVisits(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isSubscribed) setIsLoadingList(false);
      }
    }
    fetchVisits();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth, visitDate, shift]);

  // Handle Autocomplete filtering
  useEffect(() => {
    if (agencySearch.length < 1) {
      setFilteredAgencies([]);
      return;
    }

    const searchLower = agencySearch.toLowerCase();
    const matches = agencies.filter((a) =>
      a.name.toLowerCase().includes(searchLower)
    );
    setFilteredAgencies(matches);
  }, [agencySearch, agencies]);

  // Close suggestion dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSelectAgency = (agency: Agency) => {
    setSelectedAgency(agency);
    setAgencySearch(agency.name);
    setShowSuggestions(false);
  };

  const handleSearchChange = (val: string) => {
    setAgencySearch(val);
    setSelectedAgency(null); // Reset selected agency if user edits input
    setShowSuggestions(true);
  };

  // Determine if typed agency name is unrecognized
  const isUnrecognizedAgency = useMemo(() => {
    if (!agencySearch.trim()) return false;
    if (selectedAgency) return false;

    // Check if input matches exactly with any existing agency (case-insensitive)
    const exactMatch = agencies.find(
      (a) => a.name.toLowerCase() === agencySearch.trim().toLowerCase()
    );
    return !exactMatch;
  }, [agencySearch, selectedAgency, agencies]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || !visitDate || isSubmitting) return;

    const paxNum = parseInt(pax, 10);
    if (isNaN(paxNum) || paxNum <= 0) {
      setFeedback({ type: "error", text: "Số lượng khách phải lớn hơn 0" });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const supabase = createClient();
    try {
      let finalAgencyId = null;
      let finalAgencyNameRaw = null;

      if (agencySearch.trim()) {
        const exactMatch = agencies.find(
          (a) => a.name.toLowerCase() === agencySearch.trim().toLowerCase()
        );

        if (exactMatch) {
          finalAgencyId = exactMatch.id;
        } else if (selectedAgency) {
          finalAgencyId = selectedAgency.id;
        } else {
          finalAgencyNameRaw = agencySearch.trim();
        }
      }

      const { data, error } = await supabase
        .from("group_visits")
        .insert({
          visit_date: visitDate,
          shift,
          agency_id: finalAgencyId,
          agency_name_raw: finalAgencyNameRaw,
          group_name: groupName.trim() || null,
          pax: paxNum,
          note: note.trim() || null,
          created_by: staff.id,
        })
        .select()
        .single();

      if (error) {
        setFeedback({ type: "error", text: `Lỗi: ${error.message}` });
      } else {
        setFeedback({ type: "success", text: "Đã ghi ✓" });
        
        // Add to top of list immediately
        if (data) {
          setVisits((prev) => [data, ...prev]);
        }

        // Reset input fields to enable rapid consecutive logging
        setAgencySearch("");
        setSelectedAgency(null);
        setGroupName("");
        setPax("");
        setNote("");

        setTimeout(() => {
          setFeedback(null);
        }, 1000);
      }
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", text: "Lỗi kết nối máy chủ" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to map visits to agency names
  const getAgencyDisplayName = (visit: GroupVisit) => {
    if (visit.agency_id) {
      const match = agencies.find((a) => a.id === visit.agency_id);
      return match ? match.name : "Agency";
    }
    return visit.agency_name_raw || "Khách lẻ (Không tên)";
  };

  // Stats calculation
  const totalPaxInShift = useMemo(() => {
    return visits.reduce((sum, v) => sum + v.pax, 0);
  }, [visits]);

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
        <h1 className="text-base font-bold text-white">Log Đoàn Hằng Ngày</h1>
        <div className="w-16"></div>
      </header>

      <div className="w-full max-w-lg mx-auto px-4 mt-6 space-y-6">
        
        {/* Form Container */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/20 p-6 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Date + Shift controls */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                  Ngày đón đoàn
                </label>
                <input
                  type="date"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">
                  Ca làm việc
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
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
                    type="button"
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

            {/* Agency Autocomplete field */}
            <div className="relative" ref={suggestionRef}>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="agencySelect" className="block text-xs font-semibold text-zinc-400">
                  Agency (Đại lý lữ hành / Khách lẻ)*
                </label>
                {isUnrecognizedAgency && (
                  <span className="text-[10px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    ⚠ Chưa có trong danh sách
                  </span>
                )}
              </div>
              <input
                id="agencySelect"
                type="text"
                autoComplete="off"
                placeholder="Gõ tìm tên agency (ví dụ: LuxTravel)..."
                value={agencySearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                required
              />

              {/* Autocomplete Dropdown list */}
              {showSuggestions && filteredAgencies.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 max-h-56 overflow-y-auto z-50 rounded-xl border border-zinc-850 bg-zinc-900 shadow-2xl divide-y divide-zinc-850">
                  {filteredAgencies.map((agency) => (
                    <div
                      key={agency.id}
                      onClick={() => handleSelectAgency(agency)}
                      className="px-4 py-3 text-sm text-zinc-200 hover:bg-zinc-800 hover:text-white cursor-pointer transition"
                    >
                      {agency.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Group Name & Pax */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="paxInput" className="block text-xs font-semibold text-zinc-400 mb-1">
                  Số khách (Pax)*
                </label>
                <input
                  id="paxInput"
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pax}
                  onChange={(e) => setPax(e.target.value)}
                  placeholder="Ví dụ: 25"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                  required
                />
              </div>
              <div>
                <label htmlFor="groupNameInput" className="block text-xs font-semibold text-zinc-400 mb-1">
                  Tên đoàn (Nếu có)
                </label>
                <input
                  id="groupNameInput"
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Ví dụ: Đoàn Pháp"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
                />
              </div>
            </div>

            {/* Note field */}
            <div>
              <label htmlFor="noteInput" className="block text-xs font-semibold text-zinc-400 mb-1">
                Ghi chú thêm (Tùy chọn)
              </label>
              <input
                id="noteInput"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú về thực đơn, bàn VIP..."
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-700 outline-none transition focus:border-amber-500 focus:bg-zinc-950"
              />
            </div>

            {/* Success/Error Feedback */}
            {feedback && (
              <div
                className={`rounded-xl p-3 text-xs border text-center font-bold transition-all duration-300 ${
                  feedback.type === "success"
                    ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                    : "bg-rose-950/40 border-rose-980/50 text-rose-300"
                }`}
              >
                {feedback.text}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full justify-center rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 py-3.5 text-sm font-bold text-zinc-950 transition hover:from-amber-400 hover:to-amber-500 disabled:opacity-55 shadow-lg shadow-amber-500/10"
            >
              {isSubmitting ? "Đang ghi nhận..." : "Ghi nhận đoàn"}
            </button>
          </form>
        </div>

        {/* List of Visits Logged Today */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-white">Đoàn đã log trong ca</h2>
            <div className="text-[10px] font-bold text-zinc-450">
              {visits.length} đoàn | {totalPaxInShift} khách
            </div>
          </div>

          {isLoadingList ? (
            <div className="text-center py-6 text-zinc-500 text-xs">Đang tải danh sách ca...</div>
          ) : visits.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-zinc-850 rounded-2xl text-zinc-550 text-xs">
              Chưa có đoàn nào được ghi nhận cho ca này.
            </div>
          ) : (
            <div className="space-y-2">
              {visits.map((visit) => (
                <div key={visit.id} className="rounded-xl border border-zinc-850 bg-zinc-900/10 p-3.5 flex justify-between items-center text-sm">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-zinc-200">{getAgencyDisplayName(visit)}</span>
                      {visit.agency_name_raw && (
                        <span className="text-[9px] bg-amber-950/50 text-amber-450 border border-amber-900/50 px-1.5 py-0.5 rounded font-bold">
                          Raw thô
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 flex items-center space-x-1">
                      <span>Đoàn: {visit.group_name || "—"}</span>
                      {visit.note && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-[150px]">{visit.note}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-extrabold text-amber-400 text-base">{visit.pax}</span>
                    <span className="text-[10px] text-zinc-500 ml-0.5">pax</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}

export default function VisitsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải...</div>
      </main>
    }>
      <VisitsContent />
    </Suspense>
  );
}
