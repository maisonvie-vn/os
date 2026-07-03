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
}

interface InvoicePublic {
  id: string;
  supplier_id: string;
  po_id: string | null;
  invoice_number: string;
  invoice_date: string;
  note: string | null;
  created_at: string;
  created_by: string;
  suppliers?: Supplier;
  purchase_orders?: POView;
  total_amount?: number; // Only for owner
}

function InvoicesContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<InvoicePublic[]>([]);
  const [pos, setPos] = useState<POView[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [note, setNote] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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

  // 2. Fetch suppliers and POs
  useEffect(() => {
    if (checkingAuth) return;

    let isSubscribed = true;
    async function fetchMasterData() {
      const supabase = createClient();
      try {
        const { data: supData } = await supabase
          .from("suppliers")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true });

        const { data: poData } = await supabase
          .from("purchase_orders")
          .select("id, po_number")
          .order("created_at", { ascending: false });

        if (isSubscribed) {
          if (supData) setSuppliers(supData);
          if (poData) setPos(poData);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchMasterData();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth]);

  // 3. Fetch invoices
  useEffect(() => {
    if (checkingAuth) return;

    let isSubscribed = true;
    async function fetchInvoices() {
      setIsLoading(true);
      const supabase = createClient();
      try {
        if (staff?.role === "owner") {
          // Owner reads from original invoices_in table with total_amount
          const { data: invData } = await supabase
            .from("invoices_in")
            .select("*, suppliers(*), purchase_orders(*)")
            .order("created_at", { ascending: false });
          
          if (isSubscribed && invData) {
            setInvoices(invData);
          }
        } else {
          // Staff reads from invoices_public view (no total_amount)
          const { data: invData } = await supabase
            .from("invoices_public")
            .select("*, suppliers(*), purchase_orders(*)")
            .order("created_at", { ascending: false });

          if (isSubscribed && invData) {
            setInvoices(invData);
          }
        }
      } catch (err) {
        console.error("Lỗi fetch invoices:", err);
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    }
    fetchInvoices();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth, staff]);

  // Reset form
  const resetForm = () => {
    setSupplierId("");
    setPoId("");
    setInvoiceNumber("");
    setInvoiceDate(new Date().toLocaleDateString("en-CA"));
    setTotalAmount(0);
    setNote("");
    setSelectedFile(null);
    setFeedback(null);
  };

  // Submit invoice
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!supplierId || !invoiceNumber || !invoiceDate || totalAmount < 0) {
      setFeedback({ type: "error", text: "Vui lòng điền đầy đủ và đúng định dạng các cột bắt buộc!" });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    const supabase = createClient();

    try {
      // 1. Insert invoice and retrieve generated ID
      const { data: newInvoice, error } = await supabase
        .from("invoices_in")
        .insert({
          supplier_id: supplierId,
          po_id: poId || null,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate,
          total_amount: totalAmount,
          note: note.trim() || null,
          created_by: staff.id,
        })
        .select()
        .single();

      if (error) throw error;

      // 2. Upload file to Supabase Storage if selected
      if (selectedFile && newInvoice) {
        const fileExt = selectedFile.name.split(".").pop();
        const filePath = `${newInvoice.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("invoices")
          .upload(filePath, selectedFile);

        if (uploadError) throw uploadError;

        // 3. Insert record in invoice_attachments
        const { error: attachError } = await supabase
          .from("invoice_attachments")
          .insert({
            invoice_id: newInvoice.id,
            file_path: filePath,
            uploaded_by: staff.id,
          });

        if (attachError) throw attachError;
      }

      setFeedback({ type: "success", text: "Nhập hóa đơn thành công ✓" });
      resetForm();

      // Refresh list
      if (staff.role === "owner") {
        const { data: invData } = await supabase
          .from("invoices_in")
          .select("*, suppliers(*), purchase_orders(*)")
          .order("created_at", { ascending: false });
        if (invData) setInvoices(invData);
      } else {
        const { data: invData } = await supabase
          .from("invoices_public")
          .select("*, suppliers(*), purchase_orders(*)")
          .order("created_at", { ascending: false });
        if (invData) setInvoices(invData);
      }

      setTimeout(() => setIsFormOpen(false), 800);
    } catch (err: any) {
      console.error(err);
      if (err.code === "23505") {
        setFeedback({
          type: "error",
          text: "Hóa đơn số này đã tồn tại đối với nhà cung cấp này!",
        });
      } else {
        setFeedback({ type: "error", text: `Lỗi lưu DB: ${err.message || err}` });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAddForm = () => {
    resetForm();
    setIsFormOpen(true);
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
        <h1 className="text-base font-bold text-white">Nhập Hóa Đơn Nhà Cung Cấp</h1>
        <button
          onClick={openAddForm}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
        >
          Nhập hóa đơn mới
        </button>
      </header>

      {/* Invoice List */}
      <div className="mx-auto w-full max-w-5xl px-4 mt-6">
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-white">Lịch sử hóa đơn đầu vào</h3>
            <span className="text-[10px] text-zinc-500 italic">Mọi bản ghi là APPEND-ONLY, không thể sửa đổi hoặc xóa</span>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-zinc-500 text-xs">Đang tải danh sách hóa đơn...</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-8 text-zinc-650 text-xs italic">Chưa có hóa đơn nào được nhập.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/50 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Số Hóa Đơn</th>
                    <th className="py-3 px-4">Nhà cung cấp</th>
                    <th className="py-3 px-4">Đơn PO</th>
                    <th className="py-3 px-4">Ngày hóa đơn</th>
                    <th className="py-3 px-4 text-right">Tổng số tiền</th>
                    <th className="py-3 px-4">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-zinc-900/20 transition">
                      <td className="py-3.5 px-4 font-bold text-zinc-200">
                        {inv.invoice_number}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-350">
                        {inv.suppliers?.name}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-450 font-mono text-[10px]">
                        {inv.purchase_orders?.po_number || "—"}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-zinc-400">
                        {new Date(inv.invoice_date).toLocaleDateString("vi-VN")}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-zinc-200">
                        {staff?.role === "owner" ? (
                          <span className="text-amber-500">{inv.total_amount?.toLocaleString("vi-VN")}đ</span>
                        ) : (
                          <span className="text-zinc-600 bg-zinc-900/60 px-2 py-0.5 rounded text-[9px]">🔒 Owner Only</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-500 italic max-w-[200px] truncate" title={inv.note || ""}>
                        {inv.note || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Invoice Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col my-8">
            <header className="border-b border-zinc-800 bg-zinc-900/80 px-6 py-4 flex items-center justify-between sticky top-0 backdrop-blur z-10">
              <h3 className="text-sm font-bold text-white">➕ Nhập Hóa Đơn Mới</h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="p-1 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label htmlFor="invSupplier" className="block text-xs font-semibold text-zinc-400 mb-1">Nhà cung cấp*</label>
                <select
                  id="invSupplier"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  required
                >
                  <option value="">-- Chọn nhà cung cấp --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="invPO" className="block text-xs font-semibold text-zinc-400 mb-1">Liên kết đơn đặt hàng (PO)</label>
                <select
                  id="invPO"
                  value={poId}
                  onChange={(e) => setPoId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                >
                  <option value="">-- Không có PO / Mua trực tiếp --</option>
                  {pos.map((po) => (
                    <option key={po.id} value={po.id}>{po.po_number}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="invNo" className="block text-xs font-semibold text-zinc-400 mb-1">Số hóa đơn*</label>
                  <input
                    id="invNo"
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Ví dụ: HD00123"
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="invDate" className="block text-xs font-semibold text-zinc-400 mb-1">Ngày hóa đơn*</label>
                  <input
                    id="invDate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="invAmount" className="block text-xs font-semibold text-zinc-400 mb-1">Tổng tiền thanh toán (VNĐ)*</label>
                <input
                  id="invAmount"
                  type="number"
                  value={totalAmount}
                  min={0}
                  onChange={(e) => setTotalAmount(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 font-bold"
                  required
                />
                <p className="text-[10px] text-zinc-500 mt-1">
                  Nhập số tiền chính xác trên hóa đơn đỏ. Dữ liệu này sẽ được đối chiếu và duyệt chi bởi Owner.
                </p>
              </div>

              <div>
                <label htmlFor="invNote" className="block text-xs font-semibold text-zinc-400 mb-1">Ghi chú hóa đơn</label>
                <textarea
                  id="invNote"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú thêm về mặt hàng hoặc điều khoản thanh toán..."
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">
                  Đính kèm ảnh hóa đơn gốc (Chụp ảnh từ điện thoại / Tải file)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-zinc-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-zinc-800 file:text-zinc-200 file:hover:bg-zinc-700 cursor-pointer"
                />
                {selectedFile && (
                  <p className="text-[10px] text-emerald-400 mt-1">
                    ✓ Đã chọn: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
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
                  {isSubmitting ? "Đang lưu..." : "Lưu hóa đơn"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải trang hóa đơn...</div>
      </main>
    }>
      <InvoicesContent />
    </Suspense>
  );
}
