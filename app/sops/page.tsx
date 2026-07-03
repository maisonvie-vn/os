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
}

interface SOPDocument {
  id: string;
  title: string;
  department: "FOH" | "BOH" | "ALL";
  content: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

interface SOPAcknowledgement {
  id: string;
  sop_id: string;
  staff_id: string;
  acknowledged_at: string;
}

function SOPsContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [sops, setSops] = useState<SOPDocument[]>([]);
  const [acknowledgements, setAcknowledgements] = useState<SOPAcknowledgement[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Create SOP Form (manager/owner only)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<"FOH" | "BOH" | "ALL">("ALL");
  const [content, setContent] = useState("");
  const [version, setVersion] = useState(1);

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

  // 2. Fetch active SOPs and acknowledgements
  const fetchSOPData = async () => {
    setIsLoading(true);
    const supabase = createClient();
    try {
      const { data: sopData } = await supabase
        .from("sop_documents")
        .select("*")
        .eq("is_active", true)
        .order("title", { ascending: true });

      const { data: ackData } = await supabase
        .from("sop_acknowledgements")
        .select("*");

      if (sopData) setSops(sopData);
      if (ackData) setAcknowledgements(ackData);
    } catch (err) {
      console.error("Lỗi fetch SOPs:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchSOPData();
    }
  }, [checkingAuth, staff]);

  // Handle acknowledge
  const handleAcknowledge = async (sopId: string) => {
    if (!staff) return;

    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("sop_acknowledgements")
        .insert({
          sop_id: sopId,
          staff_id: staff.id,
        });

      if (error) throw error;

      // Update state local
      await fetchSOPData();
    } catch (err: any) {
      console.error(err);
      alert(`Không thể xác nhận SOP: ${err.message || err}`);
    }
  };

  // Submit new SOP
  const handleSubmitSOP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!title.trim() || !content.trim()) {
      setFormFeedback({ type: "error", text: "Vui lòng điền đầy đủ tiêu đề và nội dung SOP!" });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("sop_documents")
        .insert({
          title: title.trim(),
          department,
          content: content.trim(),
          version,
          is_active: true,
          created_by: staff.id,
        });

      if (error) throw error;

      setFormFeedback({ type: "success", text: "Thêm SOP mới thành công ✓" });
      setTitle("");
      setContent("");
      setVersion(1);
      
      await fetchSOPData();
      setTimeout(() => {
        setIsFormOpen(false);
        setFormFeedback(null);
      }, 1000);
    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi DB: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAcknowledged = (sopId: string) => {
    return acknowledgements.some((a) => a.sop_id === sopId && a.staff_id === staff?.id);
  };

  const getAcknowledgedTime = (sopId: string) => {
    const ack = acknowledgements.find((a) => a.sop_id === sopId && a.staff_id === staff?.id);
    if (!ack) return "";
    return new Date(ack.acknowledged_at).toLocaleString("vi-VN");
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
        <h1 className="text-base font-bold text-white">Thư Viện SOP & SPEC Món Ăn</h1>
        {(staff?.role === "owner" || staff?.role === "manager") ? (
          <button
            onClick={() => setIsFormOpen(true)}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
          >
            Đăng tài liệu mới
          </button>
        ) : (
          <div className="w-16"></div>
        )}
      </header>

      <div className="mx-auto w-full max-w-4xl px-4 mt-6 space-y-6">
        
        {/* Intro */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-1.5">
          <h2 className="text-sm font-bold text-white">📚 Cam Kết Quy Trình Vận Hành Chuẩn</h2>
          <p className="text-xs text-zinc-450 leading-relaxed">
            Nhân viên mới cần đọc kỹ quy trình (SOP) phục vụ và công thức chuẩn (SPEC) món ăn dưới đây. 
            Bấm xác nhận &quot;Tôi đã đọc và cam kết&quot; sau khi đọc xong để ghi nhận sự hoàn thành bài học SOP.
          </p>
        </div>

        {/* SOPs Grid / List */}
        {isLoading ? (
          <div className="text-center py-12 text-zinc-550 text-xs">Đang tải tài liệu SOP...</div>
        ) : sops.length === 0 ? (
          <div className="text-center py-12 text-zinc-600 text-xs italic">Thư viện hiện trống.</div>
        ) : (
          <div className="space-y-6">
            {sops.map((sop) => {
              const isDone = isAcknowledged(sop.id);
              const ackTime = getAcknowledgedTime(sop.id);

              return (
                <div
                  key={sop.id}
                  className={`rounded-2xl border p-6 space-y-4 transition ${
                    isDone 
                      ? "bg-zinc-900/30 border-zinc-850/80" 
                      : "bg-zinc-900/50 border-amber-500/20 shadow-md shadow-amber-500/5"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <h3 className="text-base font-bold text-white">{sop.title}</h3>
                        <span className="text-[9px] bg-zinc-800 px-2 py-0.5 rounded font-mono text-zinc-400">
                          v{sop.version}
                        </span>
                      </div>
                      <span className="block text-[10px] text-zinc-500">
                        Phòng ban: <span className="font-semibold text-zinc-400">{sop.department}</span>
                      </span>
                    </div>

                    <div className="shrink-0">
                      {isDone ? (
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-950/60 border border-emerald-900 text-emerald-400">
                            ✓ Đã cam kết làm theo
                          </span>
                          <span className="block text-[8px] text-zinc-500 mt-1 font-mono">Xác nhận ngày {ackTime}</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleAcknowledge(sop.id)}
                          className="px-4 py-2 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-extrabold text-xs transition shadow-sm"
                        >
                          Tôi đã đọc và cam kết
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-zinc-950/50 border border-zinc-900 rounded-xl text-xs text-zinc-350 leading-relaxed font-mono whitespace-pre-wrap">
                    {sop.content}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SOP Create Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col my-8">
            <header className="border-b border-zinc-800 bg-zinc-900/80 px-6 py-4 flex items-center justify-between sticky top-0 backdrop-blur z-10">
              <h3 className="text-sm font-bold text-white">➕ Đăng Tài Liệu / SOP Mới</h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="p-1 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <form onSubmit={handleSubmitSOP} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label htmlFor="sopTitle" className="block text-xs font-semibold text-zinc-400 mb-1">Tiêu đề tài liệu*</label>
                <input
                  id="sopTitle"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ví dụ: SOP Phục vụ bàn rượu vang"
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sopDept" className="block text-xs font-semibold text-zinc-400 mb-1">Bộ phận áp dụng*</label>
                  <select
                    id="sopDept"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value as any)}
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                    required
                  >
                    <option value="ALL">Tất cả phòng ban (ALL)</option>
                    <option value="FOH">Front of House (FOH)</option>
                    <option value="BOH">Back of House (BOH)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="sopVersion" className="block text-xs font-semibold text-zinc-400 mb-1">Phiên bản (Version)*</label>
                  <input
                    id="sopVersion"
                    type="number"
                    value={version}
                    min={1}
                    onChange={(e) => setVersion(parseInt(e.target.value) || 1)}
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="sopContent" className="block text-xs font-semibold text-zinc-400 mb-1">Nội dung chi tiết (Text)*</label>
                <textarea
                  id="sopContent"
                  rows={8}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Dán nội dung SOP quy trình hoặc định lượng công thức chuẩn tại đây..."
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-xs text-white outline-none focus:border-amber-500 font-mono"
                  required
                />
              </div>

              {formFeedback && (
                <div
                  className={`rounded-xl p-3 text-xs border text-center font-bold ${
                    formFeedback.type === "success"
                      ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                      : "bg-rose-950/40 border-rose-980/50 text-rose-350"
                  }`}
                >
                  {formFeedback.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-850">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-zinc-850 hover:bg-zinc-800 text-xs font-semibold text-zinc-350 transition"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold text-xs transition disabled:opacity-30"
                >
                  {isSubmitting ? "Đang lưu..." : "Đăng tài liệu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function SOPsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải thư viện tài liệu...</div>
      </main>
    }>
      <SOPsContent />
    </Suspense>
  );
}
