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

function LogContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Form states
  const [shift, setShift] = useState<"TRUA" | "TOI">("TRUA");
  const [type, setType] = useState<"PHUC_VU_MAY_MOC" | "MON_LECH_CHUAN" | "MON_CHAM" | "ORDER_SAI" | "KHIEU_NAI_KHAC">("PHUC_VU_MAY_MOC");
  const [severity, setSeverity] = useState<number>(1);
  const [groupName, setGroupName] = useState("");
  const [agency, setAgency] = useState("");
  const [totalGroupsInShift, setTotalGroupsInShift] = useState("");
  const [description, setDescription] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff) return;

    setIsLoading(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const totalGroups = totalGroupsInShift ? parseInt(totalGroupsInShift, 10) : null;

      const { error } = await supabase.from("incidents").insert({
        shift,
        type,
        severity,
        group_name: groupName || null,
        agency: agency || null,
        total_groups_in_shift: totalGroups,
        description: description || null,
        created_by: staff.id,
      });

      if (error) {
        setMessage({ type: "error", text: `Lỗi: ${error.message}` });
      } else {
        setMessage({ type: "success", text: "Đã ghi ✓" });
        // Reset inputs that change between incidents. 
        // Keep shift and totalGroupsInShift intact for convenience if they record multiple incidents in a row.
        setTimeout(() => {
          setGroupName("");
          setAgency("");
          setDescription("");
          setMessage(null);
        }, 1000);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Không rõ nguyên nhân";
      setMessage({
        type: "error",
        text: `Đã xảy ra lỗi kết nối: ${errorMessage}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 text-sm">Đang kiểm tra quyền truy cập...</div>
      </main>
    );
  }

  type IncidentTypeVal = "PHUC_VU_MAY_MOC" | "MON_LECH_CHUAN" | "MON_CHAM" | "ORDER_SAI" | "KHIEU_NAI_KHAC";
  const incidentTypes: { value: IncidentTypeVal; label: string }[] = [
    { value: "PHUC_VU_MAY_MOC", label: "⚙️ Phục vụ máy móc" },
    { value: "MON_LECH_CHUAN", label: "🍲 Món lệch chuẩn" },
    { value: "MON_CHAM", label: "⏱️ Món chậm" },
    { value: "ORDER_SAI", label: "📝 Order sai" },
    { value: "KHIEU_NAI_KHAC", label: "💬 Khiếu nại khác" },
  ];

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 pb-12">
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
        <h1 className="text-base font-bold text-white">Ghi Nhận Sự Cố</h1>
        <div className="w-16"></div> {/* Spacer to center title */}
      </header>

      {/* Form Card Container */}
      <div className="w-full max-w-lg mx-auto px-4 mt-6">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/20 p-6 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* 1. Shift type selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                1. Ca làm việc
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setShift("TRUA")}
                  className={`py-3.5 rounded-xl text-sm font-semibold transition border ${
                    shift === "TRUA"
                      ? "bg-amber-500 border-amber-500 text-zinc-950 font-bold shadow-md shadow-amber-500/10"
                      : "bg-zinc-900/50 border-zinc-800 text-zinc-300 hover:text-white"
                  }`}
                >
                  ☀️ Ca Trưa
                </button>
                <button
                  type="button"
                  onClick={() => setShift("TOI")}
                  className={`py-3.5 rounded-xl text-sm font-semibold transition border ${
                    shift === "TOI"
                      ? "bg-amber-500 border-amber-500 text-zinc-950 font-bold shadow-md shadow-amber-500/10"
                      : "bg-zinc-900/50 border-zinc-800 text-zinc-300 hover:text-white"
                  }`}
                >
                  🌙 Ca Tối
                </button>
              </div>
            </div>

            {/* 2. Incident type selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                2. Loại sự cố
              </label>
              <div className="flex flex-col space-y-2">
                {incidentTypes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setType(item.value)}
                    className={`w-full py-3 px-4 rounded-xl text-left text-sm font-medium transition border flex items-center justify-between ${
                      type === item.value
                        ? "bg-amber-500/10 border-amber-500 text-amber-300 shadow-sm"
                        : "bg-zinc-900/40 border-zinc-850 text-zinc-300 hover:text-white"
                    }`}
                  >
                    <span>{item.label}</span>
                    {type === item.value && (
                      <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Severity Level */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                3. Mức độ nghiêm trọng
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { val: 1, label: "Nhẹ", colorClass: "border-emerald-500 text-emerald-400 bg-emerald-500/5" },
                  { val: 2, label: "Vừa", colorClass: "border-orange-500 text-orange-400 bg-orange-500/5" },
                  { val: 3, label: "Nặng (Khách mắng)", colorClass: "border-rose-500 text-rose-400 bg-rose-500/5" },
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    onClick={() => setSeverity(item.val)}
                    className={`py-3 rounded-xl text-xs font-semibold transition border flex flex-col items-center justify-center ${
                      severity === item.val
                        ? `${item.colorClass} ring-1 ring-offset-1 ring-offset-zinc-900 ${
                            item.val === 1 ? "ring-emerald-500" : item.val === 2 ? "ring-orange-500" : "ring-rose-500"
                          }`
                        : "bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-300"
                    }`}
                  >
                    <span className="text-sm font-bold">{item.val}</span>
                    <span className="mt-0.5 opacity-90">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 4 & 5. Table and Agency */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="groupName" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  4. Đoàn / Bàn
                </label>
                <input
                  id="groupName"
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Bàn 12 / Đoàn A"
                  className="mt-1.5 block w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-650 outline-none transition focus:border-amber-500 focus:bg-zinc-900"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label htmlFor="agency" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  5. Agency (Nguồn khách)
                </label>
                <input
                  id="agency"
                  type="text"
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  placeholder="LuxTravel / Tự do"
                  className="mt-1.5 block w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-650 outline-none transition focus:border-amber-500 focus:bg-zinc-900"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* 6. Total groups in shift */}
            <div>
              <label htmlFor="totalGroupsInShift" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                6. Tổng đoàn ca này (để tính % tỉ lệ sự cố)
              </label>
              <input
                id="totalGroupsInShift"
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={totalGroupsInShift}
                onChange={(e) => setTotalGroupsInShift(e.target.value)}
                placeholder="Ví dụ: 15"
                className="mt-1.5 block w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-650 outline-none transition focus:border-amber-500 focus:bg-zinc-900"
                disabled={isLoading}
              />
            </div>

            {/* 7. Description */}
            <div>
              <label htmlFor="description" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                7. Mô tả ngắn (1 dòng)
              </label>
              <input
                id="description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Bếp ra nhầm món, điều hòa rò nước..."
                className="mt-1.5 block w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-650 outline-none transition focus:border-amber-500 focus:bg-zinc-900"
                disabled={isLoading}
              />
            </div>

            {/* Feedback message */}
            {message && (
              <div
                className={`rounded-xl p-4 text-sm border text-center font-semibold ${
                  message.type === "success"
                    ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                    : "bg-rose-950/40 border-rose-980/50 text-rose-300"
                } transition-all duration-300`}
              >
                {message.text}
              </div>
            )}

            {/* 8. Save Button */}
            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative flex w-full justify-center rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 py-4 text-base font-bold text-zinc-950 transition duration-200 hover:from-amber-400 hover:to-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-55 disabled:cursor-not-allowed shadow-lg shadow-amber-500/10"
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <svg className="h-5 w-5 animate-spin text-zinc-950" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Đang ghi nhận sự cố...</span>
                  </div>
                ) : (
                  <span>Ghi Nhận Sự Cố</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LogPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải...</div>
      </main>
    }>
      <LogContent />
    </Suspense>
  );
}
