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

interface License {
  id: string;
  name: string;
  issuer: string | null;
  expires_on: string;
  owner_staff_id: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

function LicensesContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [licenses, setLicenses] = useState<License[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});

  // Form states (Add new license)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState("");
  const [note, setNote] = useState("");

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
      const { data: licData } = await supabase
        .from("licenses")
        .select("*")
        .eq("is_active", true)
        .order("expires_on", { ascending: true });
      if (licData) setLicenses(licData);

      const { data: stfData } = await supabase
        .from("staff")
        .select("*")
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      if (stfData) {
        setStaffList(stfData);
        const mapper: Record<string, string> = {};
        stfData.forEach((s) => {
          mapper[s.id] = s.full_name;
        });
        setStaffMap(mapper);
      }
    } catch (err) {
      console.error("Lỗi fetch data licenses:", err);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchData();
    }
  }, [checkingAuth, staff]);

  // Submit new license
  const handleSubmitLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (staff.role !== "owner" && staff.role !== "manager") {
      setFormFeedback({ type: "error", text: "Bạn không có quyền quản trị giấy phép." });
      return;
    }

    if (!name.trim() || !expiresOn) {
      setFormFeedback({ type: "error", text: "Vui lòng nhập tên giấy phép và ngày hết hạn." });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("licenses")
        .insert({
          name: name.trim(),
          issuer: issuer.trim() || null,
          expires_on: expiresOn,
          owner_staff_id: ownerStaffId || null,
          note: note.trim() || null,
          created_by: staff.id,
        });

      if (error) throw error;

      setFormFeedback({ type: "success", text: "Thêm giấy phép thành công ✓" });
      setName("");
      setIssuer("");
      setExpiresOn("");
      setOwnerStaffId("");
      setNote("");
      setIsFormOpen(false);

      await fetchData();

    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi lưu giấy phép: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper remaining days calculation and style class determination
  const licenseDetails = useMemo(() => {
    const now = new Date().getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    return licenses.map((lic) => {
      const expTime = new Date(lic.expires_on).getTime();
      const daysLeft = Math.ceil((expTime - now) / oneDayMs);
      
      let colorClass = "text-emerald-450";
      let bgClass = "bg-emerald-950/20 border-emerald-900/30";
      let alertIcon = "✅";

      if (daysLeft < 7) {
        colorClass = "text-rose-400 font-extrabold";
        bgClass = "bg-rose-950/45 border-rose-900/40 text-rose-350";
        alertIcon = "🔥";
      } else if (daysLeft < 30) {
        colorClass = "text-orange-400 font-bold";
        bgClass = "bg-orange-950/40 border-orange-900/40 text-orange-350";
        alertIcon = "🚨";
      } else if (daysLeft < 60) {
        colorClass = "text-yellow-400 font-bold";
        bgClass = "bg-yellow-950/30 border-yellow-900/30 text-yellow-300";
        alertIcon = "⚠️";
      }

      return {
        ...lic,
        daysLeft,
        colorClass,
        bgClass,
        alertIcon,
      };
    });
  }, [licenses]);

  // Deactivate a license
  const handleDeactivate = async (licId: string) => {
    if (!staff) return;
    if (staff.role !== "owner" && staff.role !== "manager") {
      alert("Bạn không có quyền gỡ giấy phép.");
      return;
    }

    const confirmDeact = window.confirm("Xác nhận gỡ giấy phép này ra khỏi danh mục theo dõi?");
    if (!confirmDeact) return;

    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("licenses")
        .update({ is_active: false })
        .eq("id", licId);

      if (error) throw error;
      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert("Lỗi: " + err.message);
    }
  };

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 text-sm">Đang xác thực quyền truy cập...</div>
      </main>
    );
  }

  const isWriteAllowed = staff?.role === "owner" || staff?.role === "manager";

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
        <h1 className="text-base font-bold text-white">Giám Sát Giấy Phép & Gia Hạn</h1>
        {isWriteAllowed ? (
          <button
            onClick={() => {
              setFormFeedback(null);
              setIsFormOpen(true);
            }}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
          >
            Đăng ký giấy phép
          </button>
        ) : (
          <div className="w-20"></div>
        )}
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 mt-8 space-y-6">
        
        {/* Alerts panel */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">🔔 Tổng quan hạn giấy phép & mặt bằng</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-900/30 text-rose-450 text-xs">
              <span className="font-extrabold block">🔥 Nguy cấp (&lt;7 ngày):</span>
              <span className="font-bold font-mono text-sm block mt-1">
                {licenseDetails.filter((l) => l.daysLeft < 7).length} tài liệu
              </span>
            </div>
            <div className="p-3 rounded-xl bg-orange-950/20 border border-orange-900/30 text-orange-450 text-xs">
              <span className="font-bold block">🚨 Cảnh báo (&lt;30 ngày):</span>
              <span className="font-bold font-mono text-sm block mt-1">
                {licenseDetails.filter((l) => l.daysLeft >= 7 && l.daysLeft < 30).length} tài liệu
              </span>
            </div>
            <div className="p-3 rounded-xl bg-yellow-950/25 border border-yellow-900/30 text-yellow-450 text-xs">
              <span className="font-bold block">⚠️ Chuẩn bị (&lt;60 ngày):</span>
              <span className="font-bold font-mono text-sm block mt-1">
                {licenseDetails.filter((l) => l.daysLeft >= 30 && l.daysLeft < 60).length} tài liệu
              </span>
            </div>
          </div>
        </div>

        {/* Licenses list */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Danh mục giấy phép đang theo dõi</h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-350">
              <thead className="bg-zinc-900/40 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Tên hồ sơ / Hợp đồng</th>
                  <th className="py-3 px-4">Đơn vị cấp</th>
                  <th className="py-3 px-4">Ngày hết hạn</th>
                  <th className="py-3 px-4 text-center">Hạn còn lại</th>
                  <th className="py-3 px-4">Người gia hạn</th>
                  <th className="py-3 px-4">Ghi chú</th>
                  {isWriteAllowed && <th className="py-3 px-4 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-850">
                {licenseDetails.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-zinc-650 italic">Không có giấy phép nào đang được theo dõi.</td>
                  </tr>
                ) : (
                  licenseDetails.map((l) => (
                    <tr key={l.id} className="hover:bg-zinc-900/10 transition">
                      <td className="py-4 px-4 font-bold text-zinc-200">{l.name}</td>
                      <td className="py-4 px-4 text-zinc-400">{l.issuer || "—"}</td>
                      <td className="py-4 px-4 font-mono">{new Date(l.expires_on).toLocaleDateString("vi-VN")}</td>
                      <td className="py-4 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${l.bgClass} ${l.colorClass}`}>
                          {l.alertIcon} {l.daysLeft <= 0 ? "Quá hạn" : `${l.daysLeft} ngày`}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-zinc-300 font-semibold">{staffMap[l.owner_staff_id || ""] || "Chưa giao"}</td>
                      <td className="py-4 px-4 text-zinc-500 italic max-w-[200px] truncate" title={l.note || ""}>
                        {l.note || "—"}
                      </td>
                      {isWriteAllowed && (
                        <td className="py-4 px-4 text-center">
                          <button
                            onClick={() => handleDeactivate(l.id)}
                            className="text-rose-500 hover:text-rose-400 hover:underline font-bold text-[10px]"
                          >
                            Hủy theo dõi
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Register License Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <h3 className="text-sm font-bold text-white">➕ Đăng ký giám sát giấy phép mới</h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitLicense} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Tên giấy phép / Hợp đồng *</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Giấy chứng nhận vệ sinh ATTP"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Cơ quan cấp / Đối tác</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Chi cục ATTP Hà Nội"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Ngày hết hạn *</label>
                  <input
                    type="date"
                    required
                    value={expiresOn}
                    onChange={(e) => setExpiresOn(e.target.value)}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Người chịu trách nhiệm</label>
                  <select
                    value={ownerStaffId}
                    onChange={(e) => setOwnerStaffId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                  >
                    <option value="">-- Chọn nhân sự --</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Ghi chú gia hạn</label>
                <textarea
                  rows={2}
                  placeholder="Phương án dự phòng, đầu mối liên lạc cơ quan..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-amber-500"
                />
              </div>

              {formFeedback && (
                <div className={`p-3 rounded-lg text-xs font-semibold text-center border ${
                  formFeedback.type === "success"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                    : "bg-rose-950/30 border-rose-900/50 text-rose-450"
                }`}>
                  {formFeedback.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-850">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 rounded-lg border border-zinc-850 text-zinc-400 hover:bg-zinc-800"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400 transition"
                >
                  Lưu giấy phép
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function LicensesPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 font-mono">Đang tải danh mục giấy phép...</div>
      </main>
    }>
      <LicensesContent />
    </Suspense>
  );
}
