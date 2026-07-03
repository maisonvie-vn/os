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

interface Supplier {
  id: string;
  name: string;
}

interface POView {
  id: string;
  po_number: string;
  supplier_id: string;
  status: "DRAFT" | "SENT" | "RECEIVED_PARTIAL" | "RECEIVED_FULL" | "CLOSED";
  note: string | null;
  created_at: string;
  suppliers?: Supplier;
}


interface GRLineInput {
  po_line_id: string;
  item_name: string;
  unit: string;
  qty_ordered: number;
  qty_received: number;
  discrepancy_note: string;
}

function ReceivingContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [pendingPOs, setPendingPOs] = useState<POView[]>([]);
  const [isLoadingPOs, setIsLoadingPOs] = useState(false);

  // Form states
  const [selectedPoId, setSelectedPoId] = useState("");
  const [grNote, setGrNote] = useState("");
  const [lines, setLines] = useState<GRLineInput[]>([]);
  const [isLoadingLines, setIsLoadingLines] = useState(false);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
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

  // 2. Fetch pending POs
  useEffect(() => {
    if (checkingAuth) return;

    let isSubscribed = true;
    async function fetchPOs() {
      setIsLoadingPOs(true);
      const supabase = createClient();
      try {
        const { data: poData } = await supabase
          .from("purchase_orders")
          .select("*, suppliers(*)")
          .in("status", ["SENT", "RECEIVED_PARTIAL"])
          .order("created_at", { ascending: false });

        if (isSubscribed && poData) {
          setPendingPOs(poData);
        }
      } catch (err) {
        console.error("Lỗi fetch POs:", err);
      } finally {
        if (isSubscribed) setIsLoadingPOs(false);
      }
    }
    fetchPOs();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth]);

  // 3. Fetch PO lines when selection changes
  useEffect(() => {
    if (!selectedPoId) {
      setLines([]);
      return;
    }

    let isSubscribed = true;
    async function fetchLines() {
      setIsLoadingLines(true);
      const supabase = createClient();
      try {
        const { data: lineData } = await supabase
          .from("po_lines_public")
          .select("*")
          .eq("po_id", selectedPoId)
          .order("created_at", { ascending: true });

        if (isSubscribed && lineData) {
          const inputs: GRLineInput[] = lineData.map((l) => ({
            po_line_id: l.id,
            item_name: l.item_name,
            unit: l.unit,
            qty_ordered: l.qty_ordered,
            qty_received: l.qty_ordered, // default to matching ordered qty
            discrepancy_note: "",
          }));
          setLines(inputs);
        }
      } catch (err) {
        console.error("Lỗi fetch lines:", err);
      } finally {
        if (isSubscribed) setIsLoadingLines(false);
      }
    }
    fetchLines();

    return () => {
      isSubscribed = false;
    };
  }, [selectedPoId]);

  const updateLineQty = (idx: number, qty: number) => {
    const updated = [...lines];
    updated[idx].qty_received = qty;
    setLines(updated);
  };

  const updateLineNote = (idx: number, note: string) => {
    const updated = [...lines];
    updated[idx].discrepancy_note = note;
    setLines(updated);
  };

  // Submit Goods Receipt
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!selectedPoId) {
      setFeedback({ type: "error", text: "Vui lòng chọn đơn hàng PO!" });
      return;
    }

    // Validation: if qty_received != qty_ordered, discrepancy_note must be filled
    let missingNote = false;
    lines.forEach((l) => {
      if (l.qty_received !== l.qty_ordered && !l.discrepancy_note.trim()) {
        missingNote = true;
      }
    });

    if (missingNote) {
      setFeedback({
        type: "error",
        text: "Yêu cầu bắt buộc: Phải ghi chú lý do chênh lệch cho các mặt hàng nhận thiếu/thừa!",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    const supabase = createClient();

    try {
      const linesPayload = lines.map((l) => ({
        po_line_id: l.po_line_id,
        qty_received: l.qty_received,
        discrepancy_note: l.discrepancy_note.trim() || null,
      }));

      // Call database secure RPC function
      const { error } = await supabase.rpc("create_goods_receipt", {
        p_po_id: selectedPoId,
        p_received_by: staff.id,
        p_note: grNote.trim() || null,
        p_lines: linesPayload,
      });

      if (error) throw error;

      setFeedback({ type: "success", text: "Xác nhận nhận hàng và lưu phiếu kho thành công ✓" });
      
      // Reset form
      setSelectedPoId("");
      setGrNote("");
      setLines([]);

      // Reload PO list
      const { data: updatedPOs } = await supabase
        .from("purchase_orders")
        .select("*, suppliers(*)")
        .in("status", ["SENT", "RECEIVED_PARTIAL"])
        .order("created_at", { ascending: false });
      if (updatedPOs) setPendingPOs(updatedPOs);

    } catch (err: any) {
      console.error(err);
      setFeedback({ type: "error", text: `Lỗi lưu DB: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
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
        <h1 className="text-base font-bold text-white">Xác Nhận Nhận Hàng (Phiếu Kho)</h1>
        <div className="w-16"></div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-4 mt-6">
        <div className="rounded-3xl border border-zinc-850 bg-zinc-900/20 p-6 md:p-8 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Step 1: Choose PO */}
            <div className="space-y-2">
              <label htmlFor="poSelect" className="block text-sm font-bold text-white">1. Chọn Đơn đặt hàng (PO) cần nhận hàng</label>
              {isLoadingPOs ? (
                <div className="text-xs text-zinc-500">Đang tải danh sách PO chờ nhận...</div>
              ) : pendingPOs.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-zinc-550 text-xs italic text-center">
                  Hiện không có đơn hàng PO nào đang ở trạng thái chờ nhận hàng.
                </div>
              ) : (
                <select
                  id="poSelect"
                  value={selectedPoId}
                  onChange={(e) => setSelectedPoId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white focus:border-amber-500"
                  required
                >
                  <option value="">-- Chọn đơn hàng PO đang chờ giao --</option>
                  {pendingPOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} - {po.suppliers?.name} (Lập ngày: {new Date(po.created_at).toLocaleDateString("vi-VN")}) [{po.status === "SENT" ? "Chờ nhận" : "Nhận một phần"}]
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPoId && (
              <>
                {/* Step 2: Note */}
                <div className="space-y-2">
                  <label htmlFor="grNote" className="block text-sm font-bold text-zinc-300">2. Ghi chú nhận hàng chung</label>
                  <input
                    id="grNote"
                    type="text"
                    value={grNote}
                    onChange={(e) => setGrNote(e.target.value)}
                    placeholder="Ví dụ: Giao đủ, rau tươi ngon, thịt bò bảo quản lạnh..."
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white focus:border-amber-500"
                  />
                </div>

                {/* Step 3: Lines Check */}
                <div className="space-y-3 pt-2">
                  <label className="block text-sm font-bold text-white">3. Xác nhận số lượng chi tiết từng mặt hàng</label>

                  {isLoadingLines ? (
                    <div className="text-center py-8 text-zinc-500 text-xs">Đang tải chi tiết mặt hàng từ PO...</div>
                  ) : (
                    <div className="space-y-3">
                      {lines.map((line, idx) => {
                        const isMismatch = line.qty_received !== line.qty_ordered;
                        return (
                          <div
                            key={line.po_line_id}
                            className={`rounded-2xl border p-4 text-xs space-y-3 transition ${
                              isMismatch 
                                ? "bg-rose-950/10 border-rose-900/60" 
                                : "bg-zinc-950/40 border-zinc-850"
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                              <div>
                                <span className="font-bold text-sm text-zinc-200">{line.item_name}</span>
                                <span className="block text-[10px] text-zinc-500 mt-0.5">
                                  Đơn vị tính: {line.unit} • Đã đặt: <span className="font-bold text-zinc-350">{line.qty_ordered}</span>
                                </span>
                              </div>
                              <div className="flex items-center space-x-2 shrink-0">
                                <label htmlFor={`qtyRec-${idx}`} className="text-[10px] text-zinc-400 font-medium">Thực nhận:</label>
                                <input
                                  id={`qtyRec-${idx}`}
                                  type="number"
                                  value={line.qty_received}
                                  min={0}
                                  step={0.1}
                                  onChange={(e) => updateLineQty(idx, parseFloat(e.target.value) || 0)}
                                  className="w-24 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-center text-xs text-white focus:border-amber-500 font-bold font-mono"
                                  required
                                />
                              </div>
                            </div>

                            {isMismatch && (
                              <div className="space-y-1">
                                <label htmlFor={`discrepancyNote-${idx}`} className="block text-[10px] text-rose-350 font-bold">
                                  ⚠️ Lý do lệch số lượng (Bắt buộc)*:
                                </label>
                                <input
                                  id={`discrepancyNote-${idx}`}
                                  type="text"
                                  value={line.discrepancy_note}
                                  onChange={(e) => updateLineNote(idx, e.target.value)}
                                  placeholder="Ví dụ: Cân thiếu 0.5kg, dập nát trả lại..."
                                  className="w-full rounded-xl border border-rose-900/40 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-rose-500"
                                  required
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {feedback && (
                  <div
                    className={`rounded-xl p-3 text-xs border text-center font-bold ${
                      feedback.type === "success"
                        ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                        : "bg-rose-950/40 border-rose-980/50 text-rose-350"
                    }`}
                  >
                    {feedback.text}
                  </div>
                )}

                <div className="pt-4 border-t border-zinc-850 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting || lines.length === 0}
                    className="w-full sm:w-auto px-8 py-3 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold text-sm transition disabled:opacity-30"
                  >
                    {isSubmitting ? "Đang lưu..." : "Xác nhận nhận hàng"}
                  </button>
                </div>
              </>
            )}

          </form>
        </div>
      </div>
    </main>
  );
}

export default function ReceivingPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải...</div>
      </main>
    }>
      <ReceivingContent />
    </Suspense>
  );
}
