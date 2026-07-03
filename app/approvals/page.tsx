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

interface Supplier {
  id: string;
  name: string;
}

interface PO {
  id: string;
  po_number: string;
  status: string;
}

interface PaymentApproval {
  id: string;
  decision: "APPROVED" | "REJECTED" | "HOLD";
  decided_at: string;
  decided_by: string;
  note: string | null;
}

interface Invoice {
  id: string;
  supplier_id: string;
  po_id: string | null;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  note: string | null;
  created_at: string;
  created_by: string;
  suppliers: Supplier;
  purchase_orders: PO | null;
  payment_approvals: PaymentApproval | null;
}

// 3-way match detail interfaces
interface POLine {
  id: string;
  item_name: string;
  unit: string;
  qty_ordered: number;
  unit_price: number;
}

interface GRLine {
  id: string;
  po_line_id: string;
  qty_received: number;
  discrepancy_note: string | null;
  goods_receipts: {
    received_at: string;
    received_by_staff: { full_name: string } | null;
  };
}

function ApprovalsContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Invoices list
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Expanded match detail
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [matchDetails, setMatchDetails] = useState<{
    poLines: POLine[];
    grLines: GRLine[];
    isLoading: boolean;
  }>({ poLines: [], grLines: [], isLoading: false });

  // Action notes
  const [approvalNote, setApprovalNote] = useState("");
  const [actionFeedback, setActionFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  // 1. Auth check (Owner only)
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

      if (!staffData || !staffData.is_active || staffData.role !== "owner") {
        // Redirect non-owners to home
        router.push("/home");
        return;
      }

      setStaff(staffData);
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  // 2. Fetch invoices needing review
  const fetchInvoices = async () => {
    setIsLoading(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("invoices_in")
        .select("*, suppliers(*), purchase_orders(*), payment_approvals(*)")
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (data) setInvoices(data);
    } catch (err) {
      console.error("Lỗi fetch invoices:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchInvoices();
    }
  }, [checkingAuth, staff]);

  // 3. Load detailed lines for PO & GR comparison
  const handleToggleExpand = async (invoice: Invoice) => {
    if (expandedInvoiceId === invoice.id) {
      setExpandedInvoiceId(null);
      setMatchDetails({ poLines: [], grLines: [], isLoading: false });
      return;
    }

    setExpandedInvoiceId(invoice.id);
    setMatchDetails({ poLines: [], grLines: [], isLoading: true });
    setApprovalNote("");
    setActionFeedback(null);
    setAttachmentUrls([]);

    const supabase = createClient();
    try {
      // Fetch attachments
      const { data: attachData } = await supabase
        .from("invoice_attachments")
        .select("*")
        .eq("invoice_id", invoice.id);

      if (attachData && attachData.length > 0) {
        const urls: string[] = [];
        for (const att of attachData) {
          const { data: signData } = await supabase.storage
            .from("invoices")
            .createSignedUrl(att.file_path, 3600); // 1 hour expiry
          if (signData?.signedUrl) {
            urls.push(signData.signedUrl);
          }
        }
        setAttachmentUrls(urls);
      }

      if (!invoice.po_id) {
        // Direct invoice without PO
        setMatchDetails({ poLines: [], grLines: [], isLoading: false });
        return;
      }
      // Fetch PO lines
      const { data: poLines } = await supabase
        .from("po_lines")
        .select("*")
        .eq("po_id", invoice.po_id)
        .order("created_at", { ascending: true });

      // Fetch GR lines linked to the PO
      const { data: grLinesData } = await supabase
        .from("gr_lines")
        .select("*, goods_receipts(*)")
        .eq("goods_receipts.po_id", invoice.po_id);

      // Join received_by staff name for display
      let formattedGrLines: GRLine[] = [];
      if (grLinesData) {
        // Resolve names manually
        const staffIds = grLinesData.map((g) => g.goods_receipts?.received_by).filter(Boolean);
        const { data: staffList } = await supabase
          .from("staff")
          .select("id, full_name")
          .in("id", staffIds);

        const staffMap = (staffList || []).reduce((acc, curr) => {
          acc[curr.id] = curr.full_name;
          return acc;
        }, {} as Record<string, string>);

        formattedGrLines = grLinesData.map((g) => ({
          id: g.id,
          po_line_id: g.po_line_id,
          qty_received: g.qty_received,
          discrepancy_note: g.discrepancy_note,
          goods_receipts: {
            received_at: g.goods_receipts?.received_at,
            received_by_staff: g.goods_receipts?.received_by
              ? { full_name: staffMap[g.goods_receipts.received_by] || "Nhân viên" }
              : null,
          },
        }));
      }

      setMatchDetails({
        poLines: poLines || [],
        grLines: formattedGrLines,
        isLoading: false,
      });
    } catch (err) {
      console.error(err);
      setMatchDetails({ poLines: [], grLines: [], isLoading: false });
    }
  };

  // Submit Approval Decision
  const handleDecision = async (invoiceId: string, decision: "APPROVED" | "REJECTED" | "HOLD") => {
    if (!staff || isSubmitting) return;

    setIsSubmitting(true);
    setActionFeedback(null);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("payment_approvals")
        .insert({
          invoice_id: invoiceId,
          decision,
          decided_by: staff.id,
          note: approvalNote.trim() || null,
        });

      if (error) throw error;

      setActionFeedback({
        type: "success",
        text: `Đã cập nhật quyết định: ${decision === "APPROVED" ? "DUYỆT CHI" : decision === "REJECTED" ? "TỪ CHỐI" : "TẠM GIỮ CHỜ XỬ LÝ"} ✓`,
      });
      setApprovalNote("");

      // Reload list
      await fetchInvoices();
      setExpandedInvoiceId(null);
    } catch (err: any) {
      console.error(err);
      setActionFeedback({ type: "error", text: `Không thể lưu quyết định: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to compare PO and GR lines
  const comparisonList = useMemo(() => {
    if (matchDetails.isLoading || !expandedInvoiceId) return [];

    return matchDetails.poLines.map((poLine) => {
      // Find matching goods receipt quantities
      const matchingGRs = matchDetails.grLines.filter((g) => g.po_line_id === poLine.id);
      const totalReceived = matchingGRs.reduce((sum, curr) => sum + curr.qty_received, 0);
      const discrepancyNotes = matchingGRs.map((g) => g.discrepancy_note).filter(Boolean);

      return {
        id: poLine.id,
        item_name: poLine.item_name,
        unit: poLine.unit,
        qty_ordered: poLine.qty_ordered,
        unit_price: poLine.unit_price,
        qty_received: totalReceived,
        discrepancy_notes: discrepancyNotes,
        hasMismatch: totalReceived !== poLine.qty_ordered,
      };
    });
  }, [matchDetails, expandedInvoiceId]);

  const hasAnyMatchMismatch = useMemo(() => {
    return comparisonList.some((item) => item.hasMismatch);
  }, [comparisonList]);

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 text-sm">Đang xác thực quyền Owner...</div>
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
        <h1 className="text-base font-bold text-white">Duyệt Chi & Đối Chiếu Hóa Đơn</h1>
        <div className="w-16"></div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 mt-6 space-y-6">
        
        {/* Instruction Card */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-2">
          <h2 className="text-sm font-bold text-white flex items-center">
            <span className="mr-2">🛡️</span> Cổng Duyệt Chi Nội Bộ (Owner Portal)
          </h2>
          <p className="text-xs text-zinc-450 leading-relaxed">
            Hệ thống đối chiếu 3 chân tự động giữa <span className="text-white font-semibold">Đơn đặt hàng (Nam tạo)</span> ↔ <span className="text-white font-semibold">Thực tế nhận kho (Linh kiểm)</span> ↔ <span className="text-white font-semibold">Hóa đơn đỏ NCC</span>. 
            Mọi phát hiện sai lệch số lượng hoặc ghi chú nghi ngờ sẽ tự động cảnh báo đỏ để Owner duyệt chi an toàn.
          </p>
        </div>

        {/* Invoice Match List */}
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 overflow-hidden">
          <h3 className="text-sm font-bold text-white mb-4">Danh sách hóa đơn đầu vào chờ xử lý</h3>

          {isLoading ? (
            <div className="text-center py-12 text-zinc-550 text-xs">Đang tải danh sách hóa đơn duyệt chi...</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-12 text-zinc-600 text-xs italic">Không có hóa đơn nào trong hệ thống.</div>
          ) : (
            <div className="space-y-4">
              {invoices.map((inv) => {
                const isExpanded = expandedInvoiceId === inv.id;
                const statusDecision = inv.payment_approvals?.decision;

                return (
                  <div
                    key={inv.id}
                    className={`rounded-2xl border transition overflow-hidden ${
                      isExpanded 
                        ? "bg-zinc-900/80 border-amber-500/50" 
                        : "bg-zinc-950/30 border-zinc-850 hover:border-zinc-800"
                    }`}
                  >
                    {/* Invoice main row */}
                    <div
                      onClick={() => handleToggleExpand(inv)}
                      className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2.5">
                          <span className="font-bold text-sm text-zinc-200">{inv.invoice_number}</span>
                          <span className="text-[10px] bg-zinc-900 px-2 py-0.5 rounded text-zinc-400 font-semibold">
                            {inv.suppliers?.name}
                          </span>
                          {!inv.po_id && (
                            <span className="bg-rose-950/50 border border-rose-900/40 text-rose-450 px-2 py-0.5 rounded text-[9px] font-bold">
                              ⚠️ Không có PO đặt
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          Ngày hóa đơn: {new Date(inv.invoice_date).toLocaleDateString("vi-VN")} • Nhập lúc: {new Date(inv.created_at).toLocaleString("vi-VN")}
                        </div>
                      </div>

                      <div className="flex items-center space-x-6 justify-between md:justify-end">
                        <div className="text-right">
                          <span className="block text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Số tiền hóa đơn</span>
                          <span className="font-bold text-sm text-amber-500">{inv.total_amount.toLocaleString("vi-VN")}đ</span>
                        </div>

                        <div className="flex items-center space-x-3">
                          {statusDecision ? (
                            <span className={`px-3 py-1 rounded-full text-[10px] font-bold border ${
                              statusDecision === "APPROVED"
                                ? "bg-emerald-950/60 border-emerald-900 text-emerald-450"
                                : statusDecision === "REJECTED"
                                ? "bg-rose-950/60 border-rose-900 text-rose-450"
                                : "bg-zinc-850 border-zinc-750 text-zinc-400"
                            }`}>
                              {statusDecision === "APPROVED" ? "✓ ĐÃ DUYỆT CHI" : statusDecision === "REJECTED" ? "✗ TỪ CHỐI CHI" : "TẠM GIỮ (HOLD)"}
                            </span>
                          ) : (
                            <span className="bg-amber-950/40 border border-amber-900/40 text-amber-400 px-3 py-1 rounded-full text-[10px] font-bold animate-pulse">
                              ⏳ Chờ đối chiếu
                            </span>
                          )}

                          <svg
                            className={`h-5 w-5 text-zinc-550 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Detailed Match Area when expanded */}
                    {isExpanded && (
                      <div className="border-t border-zinc-850 bg-zinc-950/50 p-5 space-y-5">
                        
                        {/* 3-way Matching Board */}
                        <div className="space-y-3">
                          <div className="text-xs font-bold text-zinc-350 flex items-center justify-between">
                            <span>📋 Chi tiết đối chiếu 3 chân (PO ↔ Thực nhận kho ↔ Hóa đơn)</span>
                            {hasAnyMatchMismatch && (
                              <span className="text-[10px] bg-rose-950/50 border border-rose-900 text-rose-350 px-2 py-0.5 rounded font-extrabold animate-pulse">
                                🚨 PHÁT HIỆN LỆCH SỐ LƯỢNG
                              </span>
                            )}
                          </div>

                          {matchDetails.isLoading ? (
                            <div className="text-center py-6 text-zinc-500 text-xs">Đang nạp dữ liệu chi tiết...</div>
                          ) : !inv.po_id ? (
                            <div className="p-4 rounded-xl border border-rose-900/20 bg-rose-950/5 text-rose-350 text-xs italic">
                              Hóa đơn mua trực tiếp hoặc không khai báo liên kết PO đặt hàng ban đầu. Không thể đối chiếu tự động. Cần kiểm tra hóa đơn giấy trước khi duyệt.
                            </div>
                          ) : comparisonList.length === 0 ? (
                            <div className="text-center py-4 text-zinc-600 text-xs italic">PO liên kết không có mặt hàng nào.</div>
                          ) : (
                            <div className="border border-zinc-850 rounded-xl overflow-hidden divide-y divide-zinc-850">
                              {comparisonList.map((item) => (
                                <div
                                  key={item.id}
                                  className={`p-3 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4 items-center ${
                                    item.hasMismatch 
                                      ? "bg-rose-950/10" 
                                      : "bg-zinc-950/20"
                                  }`}
                                >
                                  <div>
                                    <span className="font-bold text-zinc-200">{item.item_name}</span>
                                    <span className="block text-[10px] text-zinc-500">Đơn vị: {item.unit}</span>
                                  </div>

                                  <div className="space-y-1">
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Đặt (PO):</span>
                                      <span className="font-bold font-mono text-zinc-250">{item.qty_ordered} {item.unit}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Nhận kho (GR):</span>
                                      <span className={`font-bold font-mono ${item.hasMismatch ? "text-rose-400" : "text-emerald-400"}`}>
                                        {item.qty_received} {item.unit}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="space-y-1 text-right sm:text-left">
                                    {item.hasMismatch ? (
                                      <div className="p-2 rounded bg-rose-950/25 border border-rose-900/30 text-rose-350 text-[10px] space-y-0.5">
                                        <span className="font-bold block">⚠️ Lệch {item.qty_received - item.qty_ordered} {item.unit}</span>
                                        {item.discrepancy_notes.map((n, nIdx) => (
                                          <span key={nIdx} className="block italic">&quot;Linh ghi: {n}&quot;</span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-emerald-450 font-bold text-[10px] flex items-center justify-end sm:justify-start">
                                        ✓ Khớp hoàn toàn
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Invoice Attachment Photos */}
                        {attachmentUrls.length > 0 && (
                          <div className="space-y-2.5">
                            <span className="block text-xs font-bold text-zinc-350">
                              📎 Ảnh chứng từ gốc ({attachmentUrls.length})
                            </span>
                            <div className="flex flex-wrap gap-4">
                              {attachmentUrls.map((url, uIdx) => (
                                <div
                                  key={uIdx}
                                  onClick={() => setSelectedImageUrl(url)}
                                  className="relative w-24 h-24 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden cursor-pointer hover:border-amber-500 transition group"
                                >
                                  <img
                                    src={url}
                                    alt={`Hóa đơn đính kèm ${uIdx + 1}`}
                                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                                    <span className="text-[10px] text-white font-bold">Xem ảnh</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Owner Decision Panel */}
                        <div className="pt-4 border-t border-zinc-850 space-y-4">
                          {statusDecision ? (
                            <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 text-xs space-y-2">
                              <span className="font-bold text-zinc-400 block uppercase tracking-wider">Thông tin quyết định duyệt chi</span>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <span className="text-[10px] text-zinc-550 block">Trạng thái duyệt</span>
                                  <span className={`font-bold ${statusDecision === 'APPROVED' ? 'text-emerald-400' : statusDecision === 'REJECTED' ? 'text-rose-400' : 'text-zinc-350'}`}>
                                    {statusDecision === "APPROVED" ? "Đã duyệt chi thanh toán" : statusDecision === "REJECTED" ? "Từ chối duyệt chi" : "Tạm hoãn chi (Hold)"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-zinc-550 block">Ghi chú duyệt</span>
                                  <span className="text-zinc-200 italic font-mono">&quot;{inv.payment_approvals?.note || "không có ghi chú"}&quot;</span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div>
                                <label htmlFor="ownerApproveNote" className="block text-xs font-bold text-zinc-400 mb-1">
                                  ✍️ Ghi chú duyệt chi của Owner (Thành)
                                </label>
                                <input
                                  id="ownerApproveNote"
                                  type="text"
                                  value={approvalNote}
                                  onChange={(e) => setApprovalNote(e.target.value)}
                                  placeholder="Nhập ghi chú chỉ đạo hoặc lý do bác bỏ..."
                                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-white"
                                />
                              </div>

                              {actionFeedback && (
                                <div
                                  className={`rounded-xl p-3 text-xs border text-center font-bold ${
                                    actionFeedback.type === "success"
                                      ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                                      : "bg-rose-950/40 border-rose-980/50 text-rose-350"
                                  }`}
                                >
                                  {actionFeedback.text}
                                </div>
                              )}

                              <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-end">
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => handleDecision(inv.id, "REJECTED")}
                                  className="px-5 py-2.5 rounded-xl border border-rose-900 bg-rose-950/30 hover:bg-rose-900/30 text-rose-400 font-bold text-xs transition"
                                >
                                  Bác bỏ (REJECTED)
                                </button>
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => handleDecision(inv.id, "HOLD")}
                                  className="px-5 py-2.5 rounded-xl border border-zinc-750 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition"
                                >
                                  Tạm hoãn (HOLD)
                                </button>
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => handleDecision(inv.id, "APPROVED")}
                                  className="px-6 py-2.5 rounded-xl bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-extrabold text-xs transition shadow-md shadow-emerald-500/10"
                                >
                                  Duyệt chi (APPROVED)
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Lightbox Modal */}
      {selectedImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 backdrop-blur-sm cursor-zoom-out animate-fade-in"
          onClick={() => setSelectedImageUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={selectedImageUrl}
              alt="Hóa đơn phóng to"
              className="rounded-lg object-contain max-h-[85vh] mx-auto shadow-2xl border border-zinc-850"
            />
            <button
              onClick={() => setSelectedImageUrl(null)}
              className="absolute -top-10 right-0 bg-zinc-900/80 border border-zinc-800 text-zinc-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition"
            >
              Đóng (✕)
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải trang duyệt chi...</div>
      </main>
    }>
      <ApprovalsContent />
    </Suspense>
  );
}
