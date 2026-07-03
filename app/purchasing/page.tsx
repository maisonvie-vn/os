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
  contact: string | null;
  phone: string | null;
  is_active: boolean;
}

interface POLineInput {
  item_id: string | null;
  item_name: string;
  unit: string;
  qty_ordered: number;
  unit_price: number;
}

interface POView {
  id: string;
  po_number: string;
  supplier_id: string;
  status: "DRAFT" | "SENT" | "RECEIVED_PARTIAL" | "RECEIVED_FULL" | "CLOSED";
  note: string | null;
  created_at: string;
  created_by: string;
  suppliers?: Supplier;
}

interface POLinePublic {
  id: string;
  po_id: string;
  item_name: string;
  unit: string;
  qty_ordered: number;
  created_at: string;
  unit_price?: number; // Only for owner
}

function PurchasingContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<POView[]>([]);
  const [standardItems, setStandardItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [poNote, setPoNote] = useState("");
  const [lineItems, setLineItems] = useState<POLineInput[]>([
    { item_id: null, item_name: "", unit: "kg", qty_ordered: 1, unit_price: 1000 },
  ]);

  // View details state
  const [selectedPO, setSelectedPO] = useState<POView | null>(null);
  const [selectedPOLines, setSelectedPOLines] = useState<POLinePublic[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

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
  useEffect(() => {
    if (checkingAuth) return;

    let isSubscribed = true;
    async function fetchData() {
      setIsLoading(true);
      const supabase = createClient();
      try {
        const { data: supData } = await supabase
          .from("suppliers")
          .select("*")
          .eq("is_active", true)
          .order("name", { ascending: true });

        const { data: poData } = await supabase
          .from("purchase_orders")
          .select("*, suppliers(*)")
          .order("created_at", { ascending: false });

        const { data: itemData } = await supabase
          .from("items")
          .select("*")
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (isSubscribed) {
          if (supData) setSuppliers(supData);
          if (poData) setPurchaseOrders(poData);
          if (itemData) setStandardItems(itemData);
        }
      } catch (err) {
        console.error("Lỗi fetch purchasing:", err);
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    }
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth]);

  // Fetch lines for detail view
  const fetchPOLines = async (po: POView) => {
    setSelectedPO(po);
    setIsLoadingDetails(true);
    const supabase = createClient();

    try {
      if (staff?.role === "owner") {
        // Owner reads from original po_lines table (with unit_price)
        const { data: lines } = await supabase
          .from("po_lines")
          .select("*")
          .eq("po_id", po.id)
          .order("created_at", { ascending: true });
        
        if (lines) setSelectedPOLines(lines);
      } else {
        // Staff reads from po_lines_public view (no unit_price)
        const { data: lines } = await supabase
          .from("po_lines_public")
          .select("*")
          .eq("po_id", po.id)
          .order("created_at", { ascending: true });
        
        if (lines) setSelectedPOLines(lines);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Add line item
  const addLine = () => {
    setLineItems([...lineItems, { item_id: null, item_name: "", unit: "kg", qty_ordered: 1, unit_price: 0 }]);
  };

  // Remove line item
  const removeLine = (idx: number) => {
    if (lineItems.length === 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  // Update line item input
  const updateLine = (idx: number, field: keyof POLineInput, val: any) => {
    const updated = lineItems.map((item, i) => {
      if (i === idx) {
        return { ...item, [field]: val };
      }
      return item;
    });
    setLineItems(updated);
  };

  // Generate Auto PO Number (PO-YYYYMMDD-XX)
  const generatePoNumber = async () => {
    const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, ""); // YYYYMMDD
    const prefix = `PO-${todayStr}-`;
    const supabase = createClient();

    const { data } = await supabase
      .from("purchase_orders")
      .select("po_number")
      .like("po_number", `${prefix}%`);

    const count = data?.length || 0;
    const nextIndex = count + 1;
    return `${prefix}${String(nextIndex).padStart(2, "0")}`;
  };

  // Submit PO
  const handleSubmitPO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (!selectedSupplierId) {
      setFormFeedback({ type: "error", text: "Vui lòng chọn nhà cung cấp!" });
      return;
    }

    const invalidLine = lineItems.some(
      (item) => !item.item_name.trim() || item.qty_ordered <= 0 || item.unit_price < 0
    );

    if (invalidLine) {
      setFormFeedback({ type: "error", text: "Vui lòng điền đầy đủ và chính xác các cột mặt hàng!" });
      return;
    }

    setIsSubmitting(true);
    setFormFeedback(null);
    const supabase = createClient();

    try {
      // 1. Generate PO Number
      const poNum = await generatePoNumber();

      // 2. Insert PO (status default: SENT)
      const { data: newPo, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          po_number: poNum,
          supplier_id: selectedSupplierId,
          status: "SENT",
          note: poNote.trim() || null,
          created_by: staff.id,
        })
        .select()
        .single();

      if (poErr) throw poErr;

      // 3. Insert PO lines
      const poLinesPayload = lineItems.map((item) => ({
        po_id: newPo.id,
        item_id: item.item_id || null,
        item_name: item.item_name.trim(),
        unit: item.unit.trim(),
        qty_ordered: item.qty_ordered,
        unit_price: item.unit_price,
      }));

      const { error: linesErr } = await supabase
        .from("po_lines")
        .insert(poLinesPayload);

      if (linesErr) throw linesErr;

      setFormFeedback({ type: "success", text: `Đã tạo thành công đơn ${poNum} ✓` });

      // Reset form
      setSelectedSupplierId("");
      setPoNote("");
      setLineItems([{ item_id: null, item_name: "", unit: "kg", qty_ordered: 1, unit_price: 1000 }]);

      // Reload list
      const { data: refreshedPO } = await supabase
        .from("purchase_orders")
        .select("*, suppliers(*)")
        .order("created_at", { ascending: false });
      if (refreshedPO) setPurchaseOrders(refreshedPO);

      setTimeout(() => {
        setIsFormOpen(false);
        setFormFeedback(null);
      }, 1000);
    } catch (err: any) {
      console.error(err);
      setFormFeedback({ type: "error", text: `Lỗi lưu DB: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculatedTotal = useMemo(() => {
    return selectedPOLines.reduce((sum, line) => {
      return sum + (line.qty_ordered * (line.unit_price || 0));
    }, 0);
  }, [selectedPOLines]);

  const openForm = () => {
    setSelectedSupplierId("");
    setPoNote("");
    setLineItems([{ item_id: null, item_name: "", unit: "kg", qty_ordered: 1, unit_price: 1000 }]);
    setFormFeedback(null);
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
        <h1 className="text-base font-bold text-white">Yêu Cầu Đặt Hàng (PO)</h1>
        <button
          onClick={() => openForm()}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
        >
          Tạo đơn PO mới
        </button>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* PO List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5">
            <h3 className="text-sm font-bold text-white mb-4">Danh sách Đơn đặt hàng (Purchase Orders)</h3>

            {isLoading ? (
              <div className="text-center py-8 text-zinc-500 text-xs">Đang tải đơn đặt hàng...</div>
            ) : purchaseOrders.length === 0 ? (
              <div className="text-center py-8 text-zinc-600 text-xs italic">Chưa có đơn đặt hàng nào được tạo.</div>
            ) : (
              <div className="space-y-3">
                {purchaseOrders.map((po) => {
                  const isSelected = selectedPO?.id === po.id;
                  return (
                    <div
                      key={po.id}
                      onClick={() => fetchPOLines(po)}
                      className={`rounded-xl border p-4 text-xs cursor-pointer hover:border-zinc-700 transition flex items-center justify-between gap-4 ${
                        isSelected ? "bg-zinc-900 border-amber-500/50" : "bg-zinc-950/40 border-zinc-850"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-zinc-200">{po.po_number}</span>
                          <span className="font-semibold bg-zinc-900 px-2 py-0.5 rounded text-[10px] text-zinc-400">
                            {po.suppliers?.name}
                          </span>
                        </div>
                        <div className="text-zinc-550 text-[10px]">
                          Ngày tạo: {new Date(po.created_at).toLocaleString("vi-VN")}
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          po.status === "SENT"
                            ? "bg-amber-950/50 border-amber-900 text-amber-400"
                            : po.status === "RECEIVED_FULL"
                            ? "bg-emerald-950/50 border-emerald-900 text-emerald-400"
                            : po.status === "RECEIVED_PARTIAL"
                            ? "bg-sky-950/50 border-sky-900 text-sky-400"
                            : "bg-zinc-800 border-zinc-750 text-zinc-400"
                        }`}>
                          {po.status === "SENT" ? "Đang đặt hàng" : po.status === "RECEIVED_FULL" ? "Đã nhận đủ" : po.status === "RECEIVED_PARTIAL" ? "Nhận một phần" : po.status}
                        </span>
                        <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* PO Details Panel */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 sticky top-24">
            <h3 className="text-sm font-bold text-white mb-4">Chi tiết Đơn đặt</h3>

            {selectedPO ? (
              <div className="space-y-4 text-xs">
                <div className="border-b border-zinc-850 pb-3 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-zinc-550">Mã đơn hàng</div>
                  <div className="text-base font-bold text-white">{selectedPO.po_number}</div>
                  <div className="text-zinc-400 font-semibold">{selectedPO.suppliers?.name}</div>
                  {selectedPO.note && <div className="text-zinc-500 italic mt-1">&quot;{selectedPO.note}&quot;</div>}
                </div>

                {isLoadingDetails ? (
                  <div className="text-center py-6 text-zinc-500">Đang tải dòng mặt hàng...</div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-[10px] uppercase font-bold text-zinc-550">Mặt hàng đặt</div>
                    <div className="border border-zinc-850 rounded-xl divide-y divide-zinc-850 overflow-hidden">
                      {selectedPOLines.map((line) => (
                        <div key={line.id} className="p-3 bg-zinc-950/20 flex justify-between items-center gap-2">
                          <div>
                            <span className="font-semibold text-zinc-200">{line.item_name}</span>
                            <span className="block text-[10px] text-zinc-500">Số lượng: {line.qty_ordered} {line.unit}</span>
                          </div>
                          {staff?.role === "owner" && (
                            <div className="text-right">
                              <span className="font-bold text-amber-500">
                                {line.unit_price?.toLocaleString("vi-VN")}đ
                              </span>
                              <span className="block text-[10px] text-zinc-500">
                                tổng: {((line.unit_price || 0) * line.qty_ordered).toLocaleString("vi-VN")}đ
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {staff?.role === "owner" && (
                      <div className="pt-2 flex justify-between items-center font-bold text-sm text-white">
                        <span>TỔNG GIÁ TRỊ:</span>
                        <span className="text-amber-500">{calculatedTotal.toLocaleString("vi-VN")}đ</span>
                      </div>
                    )}

                    {staff?.role !== "owner" && (
                      <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-center text-zinc-500 text-[10px]">
                        🔒 Giá nhập chỉ hiển thị với vai trò Chủ sở hữu.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-650 text-xs italic">
                Chọn một đơn hàng bên trái để xem chi tiết các mặt hàng đã đặt.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PO Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col my-8">
            <header className="border-b border-zinc-800 bg-zinc-900/80 px-6 py-4 flex items-center justify-between sticky top-0 backdrop-blur z-10">
              <h3 className="text-sm font-bold text-white">➕ Tạo Yêu Cầu Đặt Hàng (PO)</h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="p-1 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <form onSubmit={handleSubmitPO} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label htmlFor="poSupplier" className="block text-xs font-semibold text-zinc-400 mb-1">Nhà cung cấp*</label>
                <select
                  id="poSupplier"
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  required
                >
                  <option value="">-- Chọn nhà cung cấp --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.contact || "không có tên LH"})</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="poNote" className="block text-xs font-semibold text-zinc-400 mb-1">Ghi chú đơn hàng</label>
                <input
                  id="poNote"
                  type="text"
                  value={poNote}
                  onChange={(e) => setPoNote(e.target.value)}
                  placeholder="Ghi chú về ngày giờ giao hàng mong muốn..."
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                />
              </div>

              {/* Order line items */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Danh sách mặt hàng đặt</span>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-xs text-amber-500 hover:underline font-bold"
                  >
                    + Thêm dòng
                  </button>
                </div>

                <div className="space-y-3">
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-zinc-950/30 p-3 border border-zinc-850 rounded-xl">
                      <div className="sm:col-span-4">
                        <label htmlFor={`itemSelect-${idx}`} className="block text-[10px] text-zinc-500 mb-0.5">Tên mặt hàng*</label>
                        <select
                          id={`itemSelect-${idx}`}
                          value={item.item_id || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "") {
                              updateLine(idx, "item_id", null);
                              updateLine(idx, "item_name", "");
                            } else {
                              const found = standardItems.find((s) => s.id === val);
                              if (found) {
                                const newLines = [...lineItems];
                                newLines[idx].item_id = found.id;
                                newLines[idx].item_name = found.name;
                                newLines[idx].unit = found.unit;
                                setLineItems(newLines);
                              }
                            }
                          }}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500 mb-1.5"
                        >
                          <option value="">-- Nhập tay (không có sẵn) --</option>
                          {standardItems.map((s) => (
                            <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>
                          ))}
                        </select>
                        
                        {item.item_id === null && (
                          <input
                            id={`itemName-${idx}`}
                            type="text"
                            value={item.item_name}
                            onChange={(e) => updateLine(idx, "item_name", e.target.value)}
                            placeholder="Tên hàng gõ tay..."
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white"
                            required
                          />
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor={`itemUnit-${idx}`} className="block text-[10px] text-zinc-500 mb-0.5">Đơn vị*</label>
                        <input
                          id={`itemUnit-${idx}`}
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateLine(idx, "unit", e.target.value)}
                          placeholder="kg, bó, thùng..."
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white"
                          required
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor={`itemQty-${idx}`} className="block text-[10px] text-zinc-500 mb-0.5">Số lượng*</label>
                        <input
                          id={`itemQty-${idx}`}
                          type="number"
                          value={item.qty_ordered}
                          min={0.1}
                          step={0.1}
                          onChange={(e) => updateLine(idx, "qty_ordered", parseFloat(e.target.value) || 0)}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white"
                          required
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label htmlFor={`itemPrice-${idx}`} className="block text-[10px] text-zinc-500 mb-0.5">Đơn giá dự kiến (VNĐ)*</label>
                        <input
                          id={`itemPrice-${idx}`}
                          type="number"
                          value={item.unit_price}
                          min={0}
                          onChange={(e) => updateLine(idx, "unit_price", parseInt(e.target.value) || 0)}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white"
                          required
                        />
                      </div>
                      <div className="sm:col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          disabled={lineItems.length === 1}
                          className="p-2 text-rose-500 hover:bg-rose-950/20 rounded-xl transition disabled:opacity-30"
                        >
                          <svg className="h-4 w-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
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
                  {isSubmitting ? "Đang tạo..." : "Gửi đặt hàng"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function PurchasingPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải trang đặt hàng...</div>
      </main>
    }>
      <PurchasingContent />
    </Suspense>
  );
}
