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

interface Agency {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
}

interface Template {
  id: string;
  type: "CONFIRMATION" | "THANK_YOU" | "APOLOGY" | "HOLIDAY";
  name: string;
  template_vi: string;
  template_en: string;
  template_fr: string;
}

interface Draft {
  id: string;
  agency_id: string;
  type: string;
  subject: string;
  body_vi: string;
  body_en: string;
  body_fr: string | null;
  created_at: string;
  created_by: string;
  status: string;
  agencies?: Agency;
}

function EmailsContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draftsLog, setDraftsLog] = useState<Draft[]>([]);

  // Search autocomplete state
  const [agencySearch, setAgencySearch] = useState("");
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null);
  const [showAgencyDropdown, setShowAgencyDropdown] = useState(false);

  // Form states
  const [selectedType, setSelectedType] = useState<"CONFIRMATION" | "THANK_YOU" | "APOLOGY" | "HOLIDAY">("CONFIRMATION");
  const [groupName, setGroupName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [pax, setPax] = useState<number>(1);
  const [customNote, setCustomNote] = useState("");
  const [includeFrench, setIncludeFrench] = useState(false);

  // Generation result states
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<{
    id: string;
    subject: string;
    body_vi: string;
    body_en: string;
    body_fr: string | null;
  } | null>(null);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  // 2. Fetch master data and drafts history
  const fetchData = async () => {
    const supabase = createClient();
    try {
      const { data: agData } = await supabase
        .from("agencies")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (agData) setAgencies(agData);

      const { data: tempData } = await supabase
        .from("email_templates")
        .select("*");
      if (tempData) setTemplates(tempData);

      const { data: drData } = await supabase
        .from("email_drafts")
        .select("*, agencies(*)")
        .order("created_at", { ascending: false });
      if (drData) setDraftsLog(drData);

    } catch (err) {
      console.error("Lỗi fetch dữ liệu:", err);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchData();
    }
  }, [checkingAuth, staff]);

  // Filtering agencies for autocomplete
  const filteredAgencies = agencies.filter((a) =>
    a.name.toLowerCase().includes(agencySearch.toLowerCase())
  );

  // Handle draft generation
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgency) {
      setFeedback({ type: "error", text: "Vui lòng chọn hoặc tìm kiếm Agency từ danh sách." });
      return;
    }
    if (!groupName.trim()) {
      setFeedback({ type: "error", text: "Vui lòng nhập tên đoàn hoặc sự kiện." });
      return;
    }

    setIsGenerating(true);
    setFeedback(null);
    setGeneratedDraft(null);

    const supabase = createClient();
    try {
      // Find template
      const currentTemplate = templates.find((t) => t.type === selectedType);
      if (!currentTemplate) {
        throw new Error("Không tìm thấy mẫu thư tương ứng trong cơ sở dữ liệu.");
      }

      // Call API generation route
      const res = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyName: selectedAgency.name,
          type: selectedType,
          groupName,
          eventDate,
          pax,
          customNote,
          includeFrench,
          templateVi: currentTemplate.template_vi,
          templateEn: currentTemplate.template_en,
          templateFr: currentTemplate.template_fr,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Lỗi tạo thư nháp từ AI.");
      }

      const generated = await res.json();

      // Write draft to DB (for logging and tracking)
      const { data: dbDraft, error: dbErr } = await supabase
        .from("email_drafts")
        .insert({
          agency_id: selectedAgency.id,
          type: selectedType,
          subject: generated.subject,
          body_vi: generated.body_vi,
          body_en: generated.body_en,
          body_fr: generated.body_fr,
          created_by: staff!.id,
          status: "DRAFT",
        })
        .select()
        .single();

      if (dbErr) throw dbErr;

      setGeneratedDraft({
        id: dbDraft.id,
        subject: generated.subject,
        body_vi: generated.body_vi,
        body_en: generated.body_en,
        body_fr: generated.body_fr,
      });

      setFeedback({ type: "success", text: "Đã tạo thư nháp thành công ✓" });
      fetchData(); // reload log

    } catch (err: any) {
      console.error(err);
      setFeedback({ type: "error", text: err.message || "Đã xảy ra lỗi khi tạo nháp." });
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Copy Actions and update DB status to 'COPIED'
  const handleCopyText = async (text: string, draftId: string) => {
    navigator.clipboard.writeText(text);
    const supabase = createClient();
    try {
      await supabase
        .from("email_drafts")
        .update({ status: "COPIED" })
        .eq("id", draftId);
      
      // Update local logs
      setDraftsLog((prev) =>
        prev.map((d) => (d.id === draftId ? { ...d, status: "COPIED" } : d))
      );
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
        <h1 className="text-base font-bold text-white">Soạn Thư Song Ngữ Cho Agency</h1>
        <div className="w-20"></div> {/* spacer */}
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left column: Form creator */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
              Thông Tin Khởi Tạo
            </h2>

            <form onSubmit={handleGenerate} className="space-y-4">
              
              {/* Agency Autocomplete Selection */}
              <div className="space-y-1.5 relative">
                <label className="text-xs font-semibold text-zinc-400">Chọn Agency đối tác *</label>
                <div className="flex">
                  <input
                    type="text"
                    value={agencySearch}
                    placeholder="Tìm kiếm tên agency..."
                    onChange={(e) => {
                      setAgencySearch(e.target.value);
                      setShowAgencyDropdown(true);
                      if (selectedAgency && e.target.value !== selectedAgency.name) {
                        setSelectedAgency(null);
                      }
                    }}
                    onFocus={() => setShowAgencyDropdown(true)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                  {selectedAgency && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAgency(null);
                        setAgencySearch("");
                      }}
                      className="ml-2 px-2.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white text-xs"
                    >
                      Xóa
                    </button>
                  )}
                </div>

                {showAgencyDropdown && filteredAgencies.length > 0 && !selectedAgency && (
                  <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-lg divide-y divide-zinc-900">
                    {filteredAgencies.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAgency(a);
                            setAgencySearch(a.name);
                            setShowAgencyDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white rounded"
                        >
                          <span className="font-bold">{a.name}</span>
                          {a.contact_person && <span className="text-[10px] text-zinc-500 block">Liên hệ: {a.contact_person}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Template Type Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-400">Loại thư nháp *</label>
                <select
                  value={selectedType}
                  onChange={(e: any) => setSelectedType(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                >
                  <option value="CONFIRMATION">Xác nhận lịch đặt sảnh</option>
                  <option value="THANK_YOU">Cảm ơn sau đoàn</option>
                  <option value="APOLOGY">Xin lỗi & Khắc phục sự cố</option>
                  <option value="HOLIDAY">Chúc mừng dịp lễ tết</option>
                </select>
              </div>

              {/* Event variables */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-400">Tên đoàn / Sự kiện *</label>
                <input
                  type="text"
                  required
                  value={groupName}
                  placeholder="Ví dụ: Đoàn lữ hành Pháp - Julie"
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Ngày diễn ra</label>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Số khách (Pax)</label>
                  <input
                    type="number"
                    min={1}
                    value={pax}
                    onChange={(e) => setPax(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Custom Note input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-400">Yêu cầu/Nội dung riêng biệt</label>
                <textarea
                  rows={3}
                  value={customNote}
                  placeholder="Nhập ghi chú thêm hoặc chi tiết phàn nàn/cách đền bù cần làm rõ trong thư..."
                  onChange={(e) => setCustomNote(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* Language selection */}
              <div className="flex items-center space-x-2 py-2">
                <input
                  type="checkbox"
                  id="includeFrench"
                  checked={includeFrench}
                  onChange={(e) => setIncludeFrench(e.target.checked)}
                  className="rounded border-zinc-800 bg-zinc-950 text-amber-500 focus:ring-0"
                />
                <label htmlFor="includeFrench" className="text-xs text-zinc-350 select-none">
                  Bao gồm dịch nháp tiếng Pháp (Trilingual)
                </label>
              </div>

              {/* Feedback messages */}
              {feedback && (
                <div className={`p-3 rounded-lg text-xs font-medium border ${
                  feedback.type === "success"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-450"
                    : "bg-rose-950/30 border-rose-900/50 text-rose-450"
                }`}>
                  {feedback.text}
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={isGenerating}
                className="w-full rounded-lg bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isGenerating ? "Đang xử lý thư nháp..." : "Tạo thư nháp song ngữ"}
              </button>
            </form>
          </div>
        </div>

        {/* Right column: Generated output & Logs */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Generated Result Container */}
          {generatedDraft ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-950/5 p-6 space-y-4 shadow-xl">
              <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                <h3 className="text-sm font-bold text-amber-300">Nháp Soạn Thảo Hoàn Thành</h3>
                <span className="text-[9px] bg-zinc-900 px-2 py-0.5 rounded text-zinc-550 font-mono">
                  Bản nháp ID: {generatedDraft.id.slice(0, 8)}...
                </span>
              </div>

              {/* Subject */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-400">Tiêu Đề Thư (Subject)</span>
                  <button
                    onClick={() => handleCopyText(generatedDraft.subject, generatedDraft.id)}
                    className="text-[10px] text-amber-400 hover:text-amber-300 font-bold"
                  >
                    Copy Tiêu Đề
                  </button>
                </div>
                <div className="rounded-lg border border-zinc-850 bg-zinc-950 px-3.5 py-2 text-xs font-mono text-zinc-200">
                  {generatedDraft.subject}
                </div>
              </div>

              {/* VI body */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-400">Nội Dung Tiếng Việt</span>
                  <button
                    onClick={() => handleCopyText(generatedDraft.body_vi, generatedDraft.id)}
                    className="text-[10px] text-amber-400 hover:text-amber-300 font-bold"
                  >
                    Copy Bản VI
                  </button>
                </div>
                <pre className="rounded-lg border border-zinc-850 bg-zinc-950 p-4 text-xs font-mono text-zinc-200 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {generatedDraft.body_vi}
                </pre>
              </div>

              {/* EN body */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-400">Nội Dung Tiếng Anh</span>
                  <button
                    onClick={() => handleCopyText(generatedDraft.body_en, generatedDraft.id)}
                    className="text-[10px] text-amber-400 hover:text-amber-300 font-bold"
                  >
                    Copy Bản EN
                  </button>
                </div>
                <pre className="rounded-lg border border-zinc-850 bg-zinc-950 p-4 text-xs font-mono text-zinc-200 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {generatedDraft.body_en}
                </pre>
              </div>

              {/* FR body (conditional) */}
              {generatedDraft.body_fr && (
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-zinc-400">Nội Dung Tiếng Pháp</span>
                    <button
                      onClick={() => handleCopyText(generatedDraft.body_fr!, generatedDraft.id)}
                      className="text-[10px] text-amber-400 hover:text-amber-300 font-bold"
                    >
                      Copy Bản FR
                    </button>
                  </div>
                  <pre className="rounded-lg border border-zinc-850 bg-zinc-950 p-4 text-xs font-mono text-zinc-200 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                    {generatedDraft.body_fr}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-850 p-12 text-center text-zinc-555 text-xs italic">
              Điền thông tin bên trái và bấm nút &quot;Tạo thư nháp&quot; để sinh email.
            </div>
          )}

          {/* Logs History of drafts */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
              Lịch Sử Soạn Thư Chăm Sóc Agency
            </h3>

            {draftsLog.length === 0 ? (
              <div className="text-center py-6 text-zinc-550 text-xs italic">
                Chưa có lịch sử soạn thư chăm sóc nào.
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-2 divide-y divide-zinc-900">
                {draftsLog.map((draft) => (
                  <div key={draft.id} className="pt-3 first:pt-0 flex justify-between items-start text-xs">
                    <div className="space-y-1">
                      <div className="font-bold text-zinc-200">{draft.agencies?.name}</div>
                      <div className="text-zinc-500">
                        Loại: <span className="text-zinc-400">{draft.type}</span> • Lượt: {new Date(draft.created_at).toLocaleDateString("vi-VN")}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-450 italic max-w-md truncate">
                        Tiêu đề: {draft.subject}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold border shrink-0 ${
                      draft.status === "COPIED"
                        ? "bg-emerald-950/50 border-emerald-900 text-emerald-400"
                        : "bg-zinc-800 border-zinc-750 text-zinc-500"
                    }`}>
                      {draft.status === "COPIED" ? "ĐÃ COPY" : "MỚI SOẠN"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
    </main>
  );
}

export default function EmailsPage() {
  return (
    <Suspense fallback={<div className="bg-zinc-950 text-zinc-500 text-xs p-6">Đang tải mô-đun...</div>}>
      <EmailsContent />
    </Suspense>
  );
}
