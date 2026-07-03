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

interface FoodSample {
  id: string;
  sample_date: string;
  shift: "TRUA" | "TOI";
  dish_or_group: string;
  stored_at: string;
  stored_by: string;
  discard_due_at: string;
  discarded_at: string | null;
  discarded_by: string | null;
}

function SamplesContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [samples, setSamples] = useState<FoodSample[]>([]);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});

  // Form states
  const [shift, setShift] = useState<"TRUA" | "TOI">("TRUA");
  const [dishOrGroup, setDishOrGroup] = useState("");
  
  const [formFeedback, setFormFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Determine default shift based on time
  useEffect(() => {
    const currentHour = new Date().getHours();
    setShift(currentHour >= 15 ? "TOI" : "TRUA");
  }, []);

  // 2. Fetch data
  const fetchData = async () => {
    const supabase = createClient();
    try {
      const { data: smpData } = await supabase
        .from("food_samples")
        .select("*")
        .order("stored_at", { ascending: false });
      if (smpData) setSamples(smpData);

      const { data: stfData } = await supabase
        .from("staff")
        .select("id, full_name");
      if (stfData) {
        const mapper: Record<string, string> = {};
        stfData.forEach((s) => {
          mapper[s.id] = s.full_name;
        });
        setStaffMap(mapper);
      }
    } catch (err) {
      console.error("Lỗi fetch food samples:", err);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchData();
    }
  }, [checkingAuth, staff]);

  // Submit new food sample
  const handleSubmitSample = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!dishOrGroup.trim()) {
      setFormFeedback({ type: "error", text: "Vui lòng nhập tên món ăn hoặc đoàn khách cần lưu mẫu." });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    const now = new Date();
    const storedAt = now.toISOString();
    const discardDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // +24 hours
    const todayStr = now.toLocaleDateString("en-CA"); // YYYY-MM-DD local

    try {
      const { error } = await supabase
        .from("food_samples")
        .insert({
          sample_date: todayStr,
          shift,
          dish_or_group: dishOrGroup.trim(),
          stored_at: storedAt,
          stored_by: staff.id,
          discard_due_at: discardDueAt,
        });

      if (error) throw error;

      setFormFeedback({ type: "success", text: "Đã ghi nhận mẫu lưu thức ăn thành công ✓" });
      setDishOrGroup("");
      await fetchData();

      setTimeout(() => setFormFeedback(null), 2000);

    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi lưu mẫu: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mark sample as discarded
  const handleDiscardSample = async (sampleId: string) => {
    if (!staff) return;

    const confirmDiscard = window.confirm("Xác nhận hủy mẫu lưu thực phẩm này (đủ thời hạn 24 giờ)?");
    if (!confirmDiscard) return;

    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("food_samples")
        .update({
          discarded_at: new Date().toISOString(),
          discarded_by: staff.id,
        })
        .eq("id", sampleId);

      if (error) throw error;

      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert("Lỗi cập nhật hủy mẫu: " + err.message);
    }
  };

  // Helper check: Is sample older than 24h (expired) and not yet discarded?
  const checkIsExpired = (sample: FoodSample) => {
    if (sample.discarded_at) return false;
    const now = new Date().getTime();
    const dueTime = new Date(sample.discard_due_at).getTime();
    return now > dueTime;
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
        <h1 className="text-base font-bold text-white">Lưu Mẫu Thức Ăn Bếp (24h)</h1>
        <div className="w-16"></div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-4 mt-8 space-y-6">
        
        {/* Form Quick Log */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">✍️ Ghi nhận mẫu lưu thực phẩm mới</h2>
          
          <form onSubmit={handleSubmitSample} className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end text-xs">
            <div className="sm:col-span-3 space-y-1.5">
              <label className="font-semibold text-zinc-400">Ca làm việc</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShift("TRUA")}
                  className={`flex-1 py-2 rounded-xl font-bold transition border ${
                    shift === "TRUA"
                      ? "bg-amber-500 border-amber-500 text-zinc-950"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  Trưa
                </button>
                <button
                  type="button"
                  onClick={() => setShift("TOI")}
                  className={`flex-1 py-2 rounded-xl font-bold transition border ${
                    shift === "TOI"
                      ? "bg-amber-500 border-amber-500 text-zinc-950"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  Tối
                </button>
              </div>
            </div>

            <div className="sm:col-span-6 space-y-1.5">
              <label className="font-semibold text-zinc-400">Tên món ăn / Nhóm đoàn lưu mẫu *</label>
              <input
                type="text"
                placeholder="Ví dụ: Filet bò sốt vang (Đoàn Saigontourist)"
                value={dishOrGroup}
                onChange={(e) => setDishOrGroup(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                required
              />
            </div>

            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold py-2.5 transition disabled:opacity-30"
              >
                {isSubmitting ? "Đang lưu..." : "Lưu mẫu (Stored)"}
              </button>
            </div>
          </form>

          {formFeedback && (
            <div className={`p-3 rounded-xl text-xs font-bold text-center border ${
              formFeedback.type === "success"
                ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                : "bg-rose-950/30 border-rose-900/50 text-rose-450"
            }`}>
              {formFeedback.text}
            </div>
          )}
        </div>

        {/* List of active samples */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
            📋 Danh sách mẫu lưu thực phẩm đang lưu trữ (Lưu 24 giờ)
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-350">
              <thead>
                <tr className="border-b border-zinc-900 text-[10px] font-bold text-zinc-550 uppercase tracking-wider">
                  <th className="py-2 px-3">Ngày mẫu</th>
                  <th className="py-2 px-3">Ca</th>
                  <th className="py-2 px-3">Món ăn / Nhóm đoàn</th>
                  <th className="py-2 px-3">Thời gian lưu</th>
                  <th className="py-2 px-3">Hạn hủy dự kiến</th>
                  <th className="py-2 px-3">Người lưu</th>
                  <th className="py-2 px-3 text-center">Trạng thái / Xử lý</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {samples.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-zinc-600 italic">Chưa ghi nhận mẫu lưu thức ăn nào.</td>
                  </tr>
                ) : (
                  samples.map((s) => {
                    const isExpired = checkIsExpired(s);
                    return (
                      <tr
                        key={s.id}
                        className={`hover:bg-zinc-900/10 transition ${
                          isExpired ? "bg-yellow-950/15 text-yellow-350" : ""
                        }`}
                      >
                        <td className="py-3 px-3 font-mono">{new Date(s.sample_date).toLocaleDateString("vi-VN")}</td>
                        <td className="py-3 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            s.shift === "TRUA"
                              ? "bg-amber-950/40 border border-amber-900/40 text-amber-450"
                              : "bg-blue-950/40 border border-blue-900/40 text-blue-450"
                          }`}>
                            {s.shift === "TRUA" ? "Trưa" : "Tối"}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-bold text-zinc-200">{s.dish_or_group}</td>
                        <td className="py-3 px-3 text-zinc-450 font-mono">
                          {new Date(s.stored_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td className="py-3 px-3 text-zinc-400 font-mono">
                          {new Date(s.discard_due_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td className="py-3 px-3 text-zinc-550">{staffMap[s.stored_by] || "Bếp"}</td>
                        <td className="py-3 px-3 text-center">
                          {s.discarded_at ? (
                            <span className="text-[10px] text-zinc-500 font-semibold block">
                              Đã hủy bởi {staffMap[s.discarded_by || ""] || "Bếp"} lúc {new Date(s.discarded_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          ) : (
                            <button
                              onClick={() => handleDiscardSample(s.id)}
                              className={`px-3 py-1 rounded text-[10px] font-bold transition border ${
                                isExpired
                                  ? "bg-yellow-500 text-zinc-950 border-yellow-500 hover:bg-yellow-400"
                                  : "bg-zinc-850 text-zinc-300 border-zinc-750 hover:bg-zinc-800"
                              }`}
                            >
                              {isExpired ? "⚠️ Đã hết hạn (HỦY MẪU)" : "Đã hủy mẫu"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>
  );
}

export default function SamplesPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 font-mono">Đang tải biểu mẫu lưu mẫu thực phẩm...</div>
      </main>
    }>
      <SamplesContent />
    </Suspense>
  );
}
