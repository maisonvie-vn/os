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

interface Item {
  id: string;
  name: string;
  unit: string;
  category: "DRY" | "FRESH" | "BEVERAGE" | "SUPPLIES";
  min_qty: number;
  max_qty: number | null;
  is_active: boolean;
}

interface UnstandardizedGroup {
  item_name: string;
  count: number;
}

interface GRLine {
  qty_received: number;
  item_id: string | null;
  goods_receipts?: {
    received_at: string;
  };
}

function ItemsContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data states
  const [items, setItems] = useState<Item[]>([]);
  const [unstandardized, setUnstandardized] = useState<UnstandardizedGroup[]>([]);
  const [grLines, setGrLines] = useState<GRLine[]>([]);
  
  // Selection map for merging: item_name -> selected item_id
  const [mergeSelections, setMergeSelections] = useState<Record<string, string>>({});

  // Form states (Add new item)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [category, setCategory] = useState<"DRY" | "FRESH" | "BEVERAGE" | "SUPPLIES">("FRESH");
  const [minQty, setMinQty] = useState(0);
  const [maxQty, setMaxQty] = useState("");

  // Edit inline threshold state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editMinQty, setEditMinQty] = useState(0);
  const [editMaxQty, setEditMaxQty] = useState("");

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

  // 2. Fetch inventory items and unstandardized counts
  const fetchData = async () => {
    const supabase = createClient();
    try {
      const { data: itemData } = await supabase
        .from("items")
        .select("*")
        .order("category", { ascending: true })
        .order("name", { ascending: true });
      if (itemData) setItems(itemData);

      // Fetch unstandardized line items
      const { data: poLines } = await supabase
        .from("po_lines_public")
        .select("item_name")
        .is("item_id", null);

      if (poLines) {
        // Group by distinct name and count
        const counts: Record<string, number> = {};
        poLines.forEach((l) => {
          if (l.item_name) {
            counts[l.item_name] = (counts[l.item_name] || 0) + 1;
          }
        });
        const grouped = Object.entries(counts).map(([item_name, count]) => ({
          item_name,
          count,
        })).sort((a, b) => b.count - a.count);
        setUnstandardized(grouped);
      }

      // Fetch GR lines for stock alerts
      const { data: grData } = await supabase
        .from("gr_lines")
        .select("qty_received, item_id, goods_receipts(received_at)");
      if (grData) setGrLines(grData as any);

    } catch (err) {
      console.error("Lỗi fetch items:", err);
    }
  };

  useEffect(() => {
    if (!checkingAuth && staff) {
      fetchData();
    }
  }, [checkingAuth, staff]);

  // Stock alerts computation
  const stockAlerts = useMemo(() => {
    const now = new Date().getTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const alerts: { itemId: string; name: string; type: "FRESH_DELAY" | "UNDER_STOCK"; text: string }[] = [];

    items.forEach((item) => {
      // Filter GR receipts for this item
      const itemReceipts = grLines.filter((g) => g.item_id === item.id);
      
      // Calculate total cumulative received
      const totalReceived = itemReceipts.reduce((sum, g) => sum + (Number(g.qty_received) || 0), 0);

      // Alert if below min_qty
      if (totalReceived < item.min_qty) {
        alerts.push({
          itemId: item.id,
          name: item.name,
          type: "UNDER_STOCK",
          text: `Hàng tồn định mức thấp: Lũy kế nhập (${totalReceived} ${item.unit}) dưới định mức tối thiểu (${item.min_qty} ${item.unit}).`,
        });
      }

      // Fresh food check: must receive at least once every 3 days
      if (item.category === "FRESH") {
        let lastReceivedAt = 0;
        itemReceipts.forEach((r) => {
          if (r.goods_receipts?.received_at) {
            const time = new Date(r.goods_receipts.received_at).getTime();
            if (time > lastReceivedAt) lastReceivedAt = time;
          }
        });

        if (lastReceivedAt === 0) {
          alerts.push({
            itemId: item.id,
            name: item.name,
            type: "FRESH_DELAY",
            text: `Chưa có lịch sử nhập kho đối với thực phẩm tươi sống này.`,
          });
        } else if (now - lastReceivedAt > threeDaysMs) {
          const days = Math.floor((now - lastReceivedAt) / (24 * 60 * 60 * 1000));
          alerts.push({
            itemId: item.id,
            name: item.name,
            type: "FRESH_DELAY",
            text: `Hơn 3 ngày chưa nhập mới: Lần cuối nhập thực phẩm tươi này là ${days} ngày trước.`,
          });
        }
      }
    });

    return alerts;
  }, [items, grLines]);

  // Submit New Item Form
  const handleSubmitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    if (staff.role !== "owner" && staff.role !== "manager") {
      setFeedback({ type: "error", text: "Bạn không có quyền quản trị danh mục hàng hóa." });
      return;
    }
    if (!name.trim()) {
      setFeedback({ type: "error", text: "Vui lòng điền tên mặt hàng chuẩn." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("items")
        .insert({
          name: name.trim(),
          unit: unit.trim(),
          category,
          min_qty: minQty,
          max_qty: maxQty ? Number(maxQty) : null,
        });

      if (error) throw error;

      setFeedback({ type: "success", text: "Thêm mặt hàng chuẩn thành công ✓" });
      setName("");
      setUnit("kg");
      setMinQty(0);
      setMaxQty("");
      setIsFormOpen(false);
      await fetchData();

    } catch (err: any) {
      console.error(err);
      if (err.code === "23505") {
        setFeedback({ type: "error", text: "Tên mặt hàng này đã tồn tại trong danh mục!" });
      } else {
        setFeedback({ type: "error", text: `Lỗi kết nối DB: ${err.message || err}` });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Inline edit item min/max thresholds
  const handleEditThresholds = (item: Item) => {
    setEditingItemId(item.id);
    setEditMinQty(item.min_qty);
    setEditMaxQty(item.max_qty ? String(item.max_qty) : "");
  };

  const handleSaveThresholds = async (itemId: string) => {
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("items")
        .update({
          min_qty: editMinQty,
          max_qty: editMaxQty ? Number(editMaxQty) : null,
        })
        .eq("id", itemId);

      if (error) throw error;

      setEditingItemId(null);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert("Lỗi lưu định mức: " + err.message);
    }
  };

  // Merge unstandardized items into standardized catalog
  const handleMergeItem = async (rawName: string) => {
    const targetItemId = mergeSelections[rawName];
    if (!targetItemId) {
      alert("Vui lòng chọn mặt hàng chuẩn để gộp.");
      return;
    }

    const confirmMerge = window.confirm(`Bạn có chắc muốn gộp tất cả các dòng tên "${rawName}" về mặt hàng chuẩn này? Thao tác này sẽ đồng bộ lịch sử mua và nhận kho.`);
    if (!confirmMerge) return;

    const supabase = createClient();
    try {
      // 1. Update po_lines
      const { error: poErr } = await supabase
        .from("po_lines")
        .update({ item_id: targetItemId })
        .eq("item_name", rawName);

      if (poErr) throw poErr;

      // 2. Update gr_lines
      // Note: we can map gr_lines by linking gr_lines to the updated po_lines
      // To ensure historic synchronization, we run an update query in gr_lines
      // looking up matching po_lines:
      const { data: matchedPoLines } = await supabase
        .from("po_lines")
        .select("id")
        .eq("item_name", rawName);

      if (matchedPoLines && matchedPoLines.length > 0) {
        const poLineIds = matchedPoLines.map((l) => l.id);
        const { error: grErr } = await supabase
          .from("gr_lines")
          .update({ item_id: targetItemId })
          .in("po_line_id", poLineIds);

        if (grErr) throw grErr;
      }

      alert(`Gộp và đồng bộ hóa đơn hàng "${rawName}" thành công ✓`);
      
      // Clean selection
      setMergeSelections((prev) => {
        const next = { ...prev };
        delete next[rawName];
        return next;
      });

      await fetchData();

    } catch (err: any) {
      console.error(err);
      alert("Lỗi đồng bộ dữ liệu: " + err.message);
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
        <h1 className="text-base font-bold text-white">Danh Mục & Định Mức Tồn</h1>
        {isWriteAllowed ? (
          <button
            onClick={() => {
              setFeedback(null);
              setIsFormOpen(true);
            }}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
          >
            Thêm mặt hàng mới
          </button>
        ) : (
          <div className="w-20"></div>
        )}
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left column: Alerts and Unstandardized items */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Inventory Disclaimer */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-950/5 p-4 space-y-2 text-xs">
            <span className="font-bold text-amber-300 block">⚠️ Lưu ý kỹ thuật về định mức</span>
            <p className="text-zinc-400 leading-relaxed">
              Cảnh báo định mức tồn kho hiện tại chỉ mang tính chất dự báo dựa trên <strong>lượng nhập kho lũy kế (GR)</strong> và định mức tối thiểu. Hệ thống chưa triển khai phân hệ ghi xuất kho, do đó chưa phản ánh tồn kho chính xác theo thời gian thực.
            </p>
          </div>

          {/* Alert Feed */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-900 pb-2">
              🚨 Cảnh báo định mức & Vệ sinh hàng tươi
            </h3>
            {stockAlerts.length === 0 ? (
              <div className="text-center py-4 text-emerald-450 text-[11px] font-semibold">
                ✓ Tất cả mặt hàng đều trong định mức an toàn.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {stockAlerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg text-[11px] border flex items-start space-x-2 ${
                      alert.type === "FRESH_DELAY"
                        ? "bg-rose-950/20 border-rose-900/35 text-rose-300"
                        : "bg-amber-950/20 border-amber-900/35 text-amber-300"
                    }`}
                  >
                    <span className="text-xs shrink-0">{alert.type === "FRESH_DELAY" ? "🍅" : "📉"}</span>
                    <div className="space-y-0.5">
                      <span className="font-bold block text-zinc-200">{alert.name}</span>
                      <p className="leading-relaxed opacity-90">{alert.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unstandardized Merge block */}
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-5 space-y-4">
            <div className="border-b border-zinc-900 pb-2">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                🔄 Gộp tên hàng gõ tay chưa khớp
              </h3>
              <p className="text-[10px] text-zinc-500 mt-1">
                Danh sách các tên mặt hàng do Linh/Nam gõ tự do trên PO cũ chưa khớp danh mục chuẩn. Hãy chọn một mặt hàng chuẩn để gộp và cập nhật lịch sử.
              </p>
            </div>

            {unstandardized.length === 0 ? (
              <div className="text-center py-4 text-zinc-550 text-xs italic">
                Không có mặt hàng nào chưa chuẩn hóa!
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1 divide-y divide-zinc-900">
                {unstandardized.map((group) => (
                  <div key={group.item_name} className="pt-3 first:pt-0 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-zinc-300" title={group.item_name}>
                        {group.item_name}
                      </span>
                      <span className="bg-zinc-900 px-2 py-0.5 rounded text-[10px] text-zinc-550 font-semibold font-mono">
                        {group.count} dòng
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <select
                        value={mergeSelections[group.item_name] || ""}
                        onChange={(e) =>
                          setMergeSelections((prev) => ({
                            ...prev,
                            [group.item_name]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-300 outline-none"
                      >
                        <option value="">-- Chọn hàng chuẩn để gộp --</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMergeItem(group.item_name)}
                        disabled={!mergeSelections[group.item_name]}
                        className="px-3 rounded-lg bg-amber-500 text-zinc-950 font-bold text-[11px] hover:bg-amber-400 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      >
                        Gộp
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Standard Directory */}
        <div className="lg:col-span-8">
          <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 p-6 space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Danh Mục Hàng Hóa Chuẩn</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-350">
                <thead className="bg-zinc-900/40 text-[10px] font-bold uppercase tracking-wider text-zinc-450 border-b border-zinc-800">
                  <tr>
                    <th className="py-2.5 px-3">Phân nhóm</th>
                    <th className="py-2.5 px-3">Tên mặt hàng chuẩn</th>
                    <th className="py-2.5 px-3">Đơn vị</th>
                    <th className="py-2.5 px-3 text-right">Định mức Min</th>
                    <th className="py-2.5 px-3 text-right">Định mức Max</th>
                    {isWriteAllowed && <th className="py-2.5 px-3 text-center">Hành động</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {items.map((item) => {
                    const isEditing = editingItemId === item.id;
                    return (
                      <tr key={item.id} className="hover:bg-zinc-900/10 transition">
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                            item.category === "FRESH"
                              ? "bg-rose-950/40 border border-rose-900/40 text-rose-350"
                              : item.category === "DRY"
                              ? "bg-amber-950/40 border border-amber-900/40 text-amber-350"
                              : item.category === "BEVERAGE"
                              ? "bg-blue-950/40 border border-blue-900/40 text-blue-350"
                              : "bg-zinc-800 border border-zinc-700 text-zinc-400"
                          }`}>
                            {item.category === "FRESH"
                              ? "TƯƠI SỐNG"
                              : item.category === "DRY"
                              ? "KHÔ"
                              : item.category === "BEVERAGE"
                              ? "ĐỒ UỐNG"
                              : "VẬT TƯ"}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-bold text-zinc-200">{item.name}</td>
                        <td className="py-3 px-3 text-zinc-550 font-mono">{item.unit}</td>
                        <td className="py-3 px-3 text-right font-bold font-mono">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editMinQty}
                              onChange={(e) => setEditMinQty(Number(e.target.value))}
                              className="w-16 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-right font-mono text-xs text-white"
                            />
                          ) : (
                            item.min_qty
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold font-mono text-zinc-400">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editMaxQty}
                              placeholder="vô hạn"
                              onChange={(e) => setEditMaxQty(e.target.value)}
                              className="w-16 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-right font-mono text-xs text-white"
                            />
                          ) : (
                            item.max_qty || "—"
                          )}
                        </td>
                        {isWriteAllowed && (
                          <td className="py-3 px-3 text-center">
                            {isEditing ? (
                              <div className="flex justify-center space-x-1.5">
                                <button
                                  onClick={() => handleSaveThresholds(item.id)}
                                  className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-bold"
                                >
                                  Lưu
                                </button>
                                <button
                                  onClick={() => setEditingItemId(null)}
                                  className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleEditThresholds(item)}
                                className="text-amber-500 hover:underline font-bold text-[10px]"
                              >
                                Sửa định mức
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>

      {/* Add Item Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <h3 className="text-sm font-bold text-white">➕ Thêm mặt hàng chuẩn mới</h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitItem} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-400">Tên mặt hàng chuẩn *</label>
                <input
                  type="text"
                  required
                  value={name}
                  placeholder="Ví dụ: Thịt thăn bò úc"
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Đơn vị đo lường *</label>
                  <input
                    type="text"
                    required
                    value={unit}
                    placeholder="kg, thùng, hộp, m..."
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Phân loại nhóm *</label>
                  <select
                    value={category}
                    onChange={(e: any) => setCategory(e.target.value)}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                    required
                  >
                    <option value="FRESH">Tươi sống (FRESH)</option>
                    <option value="DRY">Thực phẩm khô (DRY)</option>
                    <option value="BEVERAGE">Đồ uống (BEVERAGE)</option>
                    <option value="SUPPLIES">Vật tư tiêu hao (SUPPLIES)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Định mức Min *</label>
                  <input
                    type="number"
                    min={0}
                    value={minQty}
                    onChange={(e) => setMinQty(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-400">Định mức Max (để trống nếu vô hạn)</label>
                  <input
                    type="number"
                    min={0}
                    value={maxQty}
                    placeholder="Không giới hạn"
                    onChange={(e) => setMaxQty(e.target.value)}
                    className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-white outline-none"
                  />
                </div>
              </div>

              {feedback && (
                <div className={`p-3 rounded-lg text-xs font-semibold text-center border ${
                  feedback.type === "success"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                    : "bg-rose-950/30 border-rose-900/50 text-rose-450"
                }`}>
                  {feedback.text}
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
                  Thêm mặt hàng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ItemsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400 font-mono">Đang nạp danh mục hàng hóa...</div>
      </main>
    }>
      <ItemsContent />
    </Suspense>
  );
}
