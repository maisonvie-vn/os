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

interface Equipment {
  id: string;
  name: string;
  zone: string | null;
  min_temp: number;
  max_temp: number;
  is_active: boolean;
}

interface TempLog {
  id: string;
  equipment_id: string;
  temp_c: number;
  is_out_of_range: boolean;
  logged_at: string;
  logged_by: string;
  note: string | null;
  equipment?: { name: string; zone: string | null };
}

interface DeviceInput {
  temp: string;
  note: string;
}

function TempsContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [devices, setDevices] = useState<Equipment[]>([]);
  const [recentLogs, setRecentLogs] = useState<TempLog[]>([]);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  
  // Interactive inputs map: deviceId -> { temp, note }
  const [inputs, setInputs] = useState<Record<string, DeviceInput>>({});

  // Feedback states
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

  // 2. Fetch master data
  const fetchData = async () => {
    const supabase = createClient();
    try {
      const { data: devData } = await supabase
        .from("equipment")
        .select("*")
        .eq("is_active", true)
        .order("zone", { ascending: true })
        .order("name", { ascending: true });
      if (devData) {
        setDevices(devData);
        // Initialize inputs
        const initialInputs: Record<string, DeviceInput> = {};
        devData.forEach((d) => {
          initialInputs[d.id] = { temp: "", note: "" };
        });
        setInputs(initialInputs);
      }

      const { data: logData } = await supabase
        .from("temp_logs")
        .select("*, equipment(*)")
        .order("logged_at", { ascending: false })
        .limit(30);
      if (logData) setRecentLogs(logData as any);

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
      console.error("Lỗi fetch data temps:", err);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchData();
    }
  }, [checkingAuth, staff]);

  // 3. Determine current shift and logging status
  const currentShiftDetails = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const shift: "TRUA" | "TOI" = currentHour >= 15 ? "TOI" : "TRUA";
    const startHour = shift === "TRUA" ? 6 : 15;
    const endHour = shift === "TRUA" ? 15 : 23;

    // Filter logs created today during this shift's hours
    const todayStr = now.toLocaleDateString("en-CA");
    const shiftLogs = recentLogs.filter((log) => {
      const logDate = new Date(log.logged_at);
      const logHour = logDate.getHours();
      const logDayStr = logDate.toLocaleDateString("en-CA");
      return logDayStr === todayStr && logHour >= startHour && logHour < endHour;
    });

    // Group logs by distinct logged_at time within 2 minutes window to count batch cycles
    const batchTimes: string[] = [];
    shiftLogs.forEach((log) => {
      const timeMs = new Date(log.logged_at).getTime();
      const belongsToExistingBatch = batchTimes.some((bt) => {
        return Math.abs(timeMs - new Date(bt).getTime()) < 2 * 60 * 1000; // 2 minutes
      });
      if (!belongsToExistingBatch) {
        batchTimes.push(log.logged_at);
      }
    });

    const batchCount = batchTimes.length;
    let badgeText = "Ca này chưa log lượt nào";
    let badgeColor = "bg-rose-950/45 border-rose-900/40 text-rose-400";
    if (batchCount === 1) {
      badgeText = "Ca này đã log 1/2 lượt";
      badgeColor = "bg-amber-950/45 border-amber-900/40 text-amber-400";
    } else if (batchCount >= 2) {
      badgeText = `Ca này đã log đủ ${batchCount}/2 lượt ✓`;
      badgeColor = "bg-emerald-950/45 border-emerald-900/40 text-emerald-400";
    }

    return {
      shift: shift === "TRUA" ? "Trưa" : "Tối",
      batchCount,
      badgeText,
      badgeColor,
    };
  }, [recentLogs]);

  // Group devices by zone
  const devicesByZone = useMemo(() => {
    const groups: Record<string, Equipment[]> = {};
    devices.forEach((d) => {
      const zoneName = d.zone || "Khác";
      if (!groups[zoneName]) groups[zoneName] = [];
      groups[zoneName].push(d);
    });
    return groups;
  }, [devices]);

  // Handle Input Changes
  const handleInputChange = (deviceId: string, field: keyof DeviceInput, value: string) => {
    setInputs((prev) => ({
      ...prev,
      [deviceId]: {
        ...prev[deviceId],
        [field]: value,
      },
    }));
  };

  // Helper validation: Check if a device's input is out of range
  const checkOutOfRange = (device: Equipment, valStr: string) => {
    if (!valStr || isNaN(Number(valStr))) return false;
    const val = Number(valStr);
    return val < device.min_temp || val > device.max_temp;
  };

  // Submit All logs at once
  const handleSubmitAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    // Validate inputs
    let hasEmpty = false;
    let missingNotes = false;
    const payload: any[] = [];

    for (const d of devices) {
      const entry = inputs[d.id];
      if (!entry || !entry.temp.trim()) {
        hasEmpty = true;
        break;
      }

      const tempNum = Number(entry.temp);
      if (isNaN(tempNum)) {
        setFormFeedback({ type: "error", text: `Nhiệt độ tủ "${d.name}" phải là một số hợp lệ.` });
        return;
      }

      const isOut = tempNum < d.min_temp || tempNum > d.max_temp;
      if (isOut && !entry.note.trim()) {
        missingNotes = true;
      }

      payload.push({
        equipment_id: d.id,
        temp_c: tempNum,
        is_out_of_range: isOut,
        note: entry.note.trim() || null,
        logged_by: staff.id,
      });
    }

    if (hasEmpty) {
      setFormFeedback({ type: "error", text: "Vui lòng nhập nhiệt độ cho tất cả các thiết bị lạnh." });
      return;
    }

    if (missingNotes) {
      setFormFeedback({
        type: "error",
        text: "Có thiết bị lệch nhiệt độ an toàn! Bắt buộc phải nhập ghi chú giải trình.",
      });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    try {
      const { error } = await supabase.from("temp_logs").insert(payload);
      if (error) throw error;

      setFormFeedback({ type: "success", text: "Đã lưu log nhiệt độ toàn bộ thiết bị thành công ✓" });
      
      // Clear form inputs
      const resetInputs: Record<string, DeviceInput> = {};
      devices.forEach((d) => {
        resetInputs[d.id] = { temp: "", note: "" };
      });
      setInputs(resetInputs);

      await fetchData();

      setTimeout(() => setFormFeedback(null), 2500);

    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi lưu log nhiệt: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
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
        <h1 className="text-base font-bold text-white">Log Nhiệt Độ Thiết Bị Lạnh</h1>
        <div className="w-16"></div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-4 mt-8 space-y-6">
        
        {/* Progress Shift tracker */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/10 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-white">Giám sát chu kỳ kiểm tra tủ lạnh</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Quy định bắt buộc: Ghi nhận nhiệt độ <strong>2 lần mỗi ca</strong> (đầu ca & cuối ca) để kiểm soát vi khuẩn.
            </p>
          </div>
          <div className={`px-4 py-2 rounded-xl text-xs font-bold border ${currentShiftDetails.badgeColor} animate-pulse`}>
            Ca {currentShiftDetails.shift}: {currentShiftDetails.badgeText}
          </div>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmitAll} className="space-y-6">
          {devices.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-zinc-800 rounded-2xl text-zinc-550 text-xs italic">
              Chưa cấu hình danh mục thiết bị lạnh nào. Liên hệ quản lý thiết lập.
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(devicesByZone).map(([zoneName, zoneDevices]) => (
                <div key={zoneName} className="rounded-2xl border border-zinc-850 bg-zinc-900/20 overflow-hidden">
                  <header className="bg-zinc-900/40 border-b border-zinc-850 px-4 py-2.5">
                    <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider">📍 Khu vực: {zoneName}</h3>
                  </header>
                  
                  <div className="divide-y divide-zinc-900">
                    {zoneDevices.map((d) => {
                      const input = inputs[d.id] || { temp: "", note: "" };
                      const isOut = checkOutOfRange(d, input.temp);
                      
                      return (
                        <div
                          key={d.id}
                          className={`p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center transition ${
                            isOut ? "bg-rose-950/10" : ""
                          }`}
                        >
                          {/* Device details */}
                          <div className="sm:col-span-4 space-y-0.5">
                            <span className="font-bold text-xs text-zinc-200">{d.name}</span>
                            <span className="block text-[10px] text-zinc-500">
                              Ngưỡng chuẩn: {d.min_temp}°C đến {d.max_temp}°C
                            </span>
                          </div>

                          {/* Temperature entry */}
                          <div className="sm:col-span-3 relative">
                            <input
                              type="number"
                              step="0.1"
                              placeholder="Nhập °C"
                              value={input.temp}
                              onChange={(e) => handleInputChange(d.id, "temp", e.target.value)}
                              className={`w-full rounded-xl border px-3 py-2 text-xs font-bold font-mono outline-none text-right pr-8 transition ${
                                isOut
                                  ? "border-rose-500 bg-rose-950/20 text-rose-300 focus:border-rose-450"
                                  : "border-zinc-800 bg-zinc-950 text-white focus:border-amber-500"
                              }`}
                              required
                            />
                            <span className="absolute right-3 top-2.5 text-[10px] font-bold text-zinc-500">°C</span>
                          </div>

                          {/* Explanatory note */}
                          <div className="sm:col-span-5">
                            <input
                              type="text"
                              placeholder={isOut ? "⚠️ Bắt buộc lý do (xả đá, cửa mở, hỏng...)" : "Ghi chú thêm (không bắt buộc)..."}
                              value={input.note}
                              onChange={(e) => handleInputChange(d.id, "note", e.target.value)}
                              className={`w-full rounded-xl border px-3 py-2 text-xs outline-none transition ${
                                isOut
                                  ? "border-rose-900 bg-rose-950/40 text-rose-200 placeholder-rose-400/60 focus:border-rose-500"
                                  : "border-zinc-800 bg-zinc-950 text-zinc-350 focus:border-amber-500"
                              }`}
                              required={isOut}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {formFeedback && (
                <div className={`p-4 rounded-2xl text-xs font-bold text-center border ${
                  formFeedback.type === "success"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-450"
                    : "bg-rose-950/30 border-rose-900/50 text-rose-450"
                }`}>
                  {formFeedback.text}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-8 py-3 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold text-xs transition shadow-md shadow-amber-500/10 disabled:opacity-30"
                >
                  {isSubmitting ? "Đang ghi sổ..." : "Lưu Tất Cả Lượt Ghi (Submit Logs)"}
                </button>
              </div>
            </div>
          )}
        </form>

        {/* History Table */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
            📊 Lịch sử nhật ký log nhiệt độ gần đây (Append-Only)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-350">
              <thead>
                <tr className="border-b border-zinc-900 text-[10px] font-bold text-zinc-550 uppercase tracking-wider">
                  <th className="py-2 px-3">Thời gian ghi</th>
                  <th className="py-2 px-3">Thiết bị</th>
                  <th className="py-2 px-3">Khu vực</th>
                  <th className="py-2 px-3 text-right">Đo nhiệt độ</th>
                  <th className="py-2 px-3">Người ghi</th>
                  <th className="py-2 px-3">Ghi chú sự cố</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {recentLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-zinc-600 italic">Chưa có nhật ký log nhiệt nào.</td>
                  </tr>
                ) : (
                  recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-900/10 transition">
                      <td className="py-2.5 px-3 text-zinc-500 font-mono">
                        {new Date(log.logged_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-zinc-200">{log.equipment?.name || "Tủ lạnh"}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{log.equipment?.zone || "—"}</td>
                      <td className={`py-2.5 px-3 text-right font-bold font-mono text-xs ${
                        log.is_out_of_range ? "text-rose-400" : "text-emerald-450"
                      }`}>
                        {log.temp_c}°C {log.is_out_of_range && "⚠️"}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-500">{staffMap[log.logged_by] || "Bếp"}</td>
                      <td className={`py-2.5 px-3 italic ${log.is_out_of_range ? "text-rose-350 font-medium" : "text-zinc-550"}`}>
                        {log.note || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>
  );
}

export default function TempsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 font-mono">Đang tải biểu mẫu log nhiệt...</div>
      </main>
    }>
      <TempsContent />
    </Suspense>
  );
}
