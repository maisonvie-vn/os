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

interface Venue {
  id: string;
  name: string;
  capacity: number;
  is_active: boolean;
}

interface Agency {
  id: string;
  name: string;
  is_active: boolean;
}

interface Booking {
  id: string;
  venue_id: string;
  agency_id: string | null;
  agency_name_raw: string | null;
  group_name: string | null;
  pax: number;
  starts_at: string;
  ends_at: string;
  status: "TENTATIVE" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
  note: string | null;
  created_at: string;
  created_by: string;
  venues?: Venue;
  agencies?: Agency;
  booking_deposits?: any[];
  booking_deposits_public?: any[];
}

const statusColors: Record<string, string> = {
  TENTATIVE: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  CONFIRMED: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  CANCELLED: "bg-zinc-800 border-zinc-700 text-zinc-400",
  COMPLETED: "bg-sky-500/10 border-sky-500/30 text-sky-400",
};

// Helper for Vietnamese day names
const getVietnameseDayName = (date: Date) => {
  const day = date.getDay();
  if (day === 0) return "Chủ Nhật";
  return `Thứ ${day + 1}`;
};

function BookingsContent() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Core data states
  const [venues, setVenues] = useState<Venue[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Selected date for weekly grid (defaults to today)
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  });

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  
  const [venueId, setVenueId] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [agencyNameRaw, setAgencyNameRaw] = useState("");
  const [groupName, setGroupName] = useState("");
  const [pax, setPax] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [status, setStatus] = useState<"TENTATIVE" | "CONFIRMED" | "CANCELLED" | "COMPLETED">("TENTATIVE");
  const [note, setNote] = useState("");
  
  // Deposit form states
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositMethod, setDepositMethod] = useState<"CASH" | "TRANSFER" | "CARD" | "OTHER">("TRANSFER");
  const [depositNote, setDepositNote] = useState("");
  
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

  // 2. Fetch master data
  useEffect(() => {
    if (checkingAuth) return;

    let isSubscribed = true;
    async function fetchData() {
      const supabase = createClient();
      try {
        const { data: venData } = await supabase
          .from("venues")
          .select("*")
          .eq("is_active", true)
          .order("name", { ascending: true });

        const { data: agData } = await supabase
          .from("agencies")
          .select("*")
          .eq("is_active", true)
          .order("name", { ascending: true });

        const { data: bookData } = await supabase
          .from("bookings")
          .select("*, venues(*), agencies(*), booking_deposits(*), booking_deposits_public(*)")
          .order("starts_at", { ascending: true });

        if (isSubscribed) {
          if (venData) setVenues(venData);
          if (agData) setAgencies(agData);
          if (bookData) setBookings(bookData);
        }
      } catch (err) {
        console.error("Lỗi fetch bookings:", err);
      }
    }
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [checkingAuth]);

  // Vietnamese week navigation helpers
  const weekDays = useMemo(() => {
    const list = [];
    const temp = new Date(selectedWeekStart);
    for (let i = 0; i < 7; i++) {
      const d = new Date(temp);
      d.setDate(temp.getDate() + i);
      list.push(d);
    }
    return list;
  }, [selectedWeekStart]);

  const changeWeek = (offset: number) => {
    const newStart = new Date(selectedWeekStart);
    newStart.setDate(selectedWeekStart.getDate() + offset * 7);
    setSelectedWeekStart(newStart);
  };

  const selectedVenueObj = useMemo(() => {
    return venues.find((v) => v.id === venueId) || null;
  }, [venueId, venues]);

  // Check venue capacity warning
  const capacityWarning = useMemo(() => {
    if (selectedVenueObj && pax > selectedVenueObj.capacity) {
      return `Cảnh báo: Số khách (${pax}) vượt quá sức chứa của ${selectedVenueObj.name} (${selectedVenueObj.capacity} khách).`;
    }
    return null;
  }, [pax, selectedVenueObj]);

  // Open Form for Add / Edit
  const openForm = (booking: Booking | null = null) => {
    setFeedback(null);
    setDepositAmount(0);
    setDepositMethod("TRANSFER");
    setDepositNote("");
    if (booking) {
      setEditingBooking(booking);
      setVenueId(booking.venue_id);
      setAgencyId(booking.agency_id || "");
      setAgencyNameRaw(booking.agency_name_raw || "");
      setGroupName(booking.group_name || "");
      setPax(booking.pax);
      
      const starts = new Date(booking.starts_at);
      const ends = new Date(booking.ends_at);
      
      setStartDate(starts.toLocaleDateString("en-CA")); // YYYY-MM-DD
      setStartTime(starts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      setEndDate(ends.toLocaleDateString("en-CA"));
      setEndTime(ends.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      setStatus(booking.status);
      setNote(booking.note || "");
    } else {
      setEditingBooking(null);
      setVenueId(venues[0]?.id || "");
      setAgencyId("");
      setAgencyNameRaw("");
      setGroupName("");
      setPax(10);
      
      const now = new Date();
      setStartDate(now.toLocaleDateString("en-CA"));
      setStartTime("18:00");
      setEndDate(now.toLocaleDateString("en-CA"));
      setEndTime("21:00");
      setStatus("TENTATIVE");
      setNote("");
    }
    setIsFormOpen(true);
  };

  // Submit Booking Form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || isSubmitting) return;

    setFeedback(null);
    setIsSubmitting(true);

    const startIso = `${startDate}T${startTime}:00+07:00`;
    const endIso = `${endDate}T${endTime}:00+07:00`;

    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    if (endMs <= startMs) {
      setFeedback({ type: "error", text: "Thời gian kết thúc phải sau thời gian bắt đầu!" });
      setIsSubmitting(false);
      return;
    }

    const supabase = createClient();

    // Client-side conflict precheck for booking overlap (TENTATIVE & CONFIRMED only)
    if (status === "TENTATIVE" || status === "CONFIRMED") {
      const conflict = bookings.find((b) => {
        if (b.id === editingBooking?.id) return false;
        if (b.venue_id !== venueId) return false;
        if (b.status !== "TENTATIVE" && b.status !== "CONFIRMED") return false;

        const bStart = new Date(b.starts_at).getTime();
        const bEnd = new Date(b.ends_at).getTime();

        return startMs < bEnd && endMs > bStart;
      });

      if (conflict) {
        const venueName = venues.find(v => v.id === venueId)?.name || "Sảnh";
        const groupNameStr = conflict.group_name || conflict.agency_name_raw || conflict.agencies?.name || "Một đoàn";
        const conflictStartStr = new Date(conflict.starts_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
        const conflictEndStr = new Date(conflict.ends_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
        
        setFeedback({
          type: "error",
          text: `Sảnh ${venueName} đã có đoàn ${groupNameStr} từ ${conflictStartStr}–${conflictEndStr}`,
        });
        setIsSubmitting(false);
        return;
      }
    }

    const payload = {
      venue_id: venueId,
      agency_id: agencyId || null,
      agency_name_raw: agencyNameRaw.trim() || null,
      group_name: groupName.trim() || null,
      pax,
      starts_at: startIso,
      ends_at: endIso,
      status,
      note: note.trim() || null,
    };

    try {
      if (editingBooking) {
        // Only managers/owners can update/confirm
        if (staff.role !== "owner" && staff.role !== "manager") {
          setFeedback({ type: "error", text: "Bạn không có quyền sửa/xác nhận đặt đoàn!" });
          setIsSubmitting(false);
          return;
        }

        const { error } = await supabase
          .from("bookings")
          .update({
            ...payload,
            updated_by: staff.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingBooking.id);

        if (error) {
          throw error;
        }

        setFeedback({ type: "success", text: "Cập nhật đặt đoàn thành công ✓" });
        
        // Refresh local state
        const { data: updatedData } = await supabase
          .from("bookings")
          .select("*, venues(*), agencies(*), booking_deposits(*), booking_deposits_public(*)")
          .order("starts_at", { ascending: true });
        if (updatedData) setBookings(updatedData);

        setTimeout(() => setIsFormOpen(false), 800);
      } else {
        const { error } = await supabase
          .from("bookings")
          .insert({
            ...payload,
            created_by: staff.id,
          });

        if (error) {
          throw error;
        }

        setFeedback({ type: "success", text: "Tạo đặt đoàn mới thành công ✓" });

        // Refresh local state
        const { data: updatedData } = await supabase
          .from("bookings")
          .select("*, venues(*), agencies(*), booking_deposits(*), booking_deposits_public(*)")
          .order("starts_at", { ascending: true });
        if (updatedData) setBookings(updatedData);

        setTimeout(() => setIsFormOpen(false), 800);
      }
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("no_overlap") || err.code === "23P01") {
        setFeedback({
          type: "error",
          text: "Không thể lưu: Đã bị trùng lịch với đoàn khác tại sảnh này!",
        });
      } else {
        setFeedback({ type: "error", text: `Lỗi kết nối DB: ${err.message || err}` });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Deposit
  const handleSaveDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || !editingBooking) return;
    if (depositAmount <= 0) {
      setFeedback({ type: "error", text: "Số tiền cọc phải lớn hơn 0!" });
      return;
    }

    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("booking_deposits")
        .insert({
          booking_id: editingBooking.id,
          amount: depositAmount,
          payment_method: depositMethod,
          received_by: staff.id,
          note: depositNote.trim() || null,
        });

      if (error) throw error;

      setFeedback({ type: "success", text: "Ghi nhận đặt cọc thành công ✓" });
      
      // Refresh local state
      const { data: updatedData } = await supabase
        .from("bookings")
        .select("*, venues(*), agencies(*), booking_deposits(*), booking_deposits_public(*)")
        .order("starts_at", { ascending: true });
      if (updatedData) {
        setBookings(updatedData);
        const fresh = updatedData.find((b) => b.id === editingBooking.id);
        if (fresh) setEditingBooking(fresh);
      }

      setDepositAmount(0);
      setDepositNote("");
    } catch (err: any) {
      console.error(err);
      setFeedback({ type: "error", text: `Lỗi ghi nhận cọc: ${err.message || err}` });
    }
  };

  // Organize weekly booking items
  const bookingsByVenueAndDay = useMemo(() => {
    const map: Record<string, Record<string, Booking[]>> = {};

    venues.forEach((v) => {
      map[v.id] = {};
      weekDays.forEach((day) => {
        const dStr = day.toDateString();
        map[v.id][dStr] = [];
      });
    });

    bookings.forEach((b) => {
      const bDate = new Date(b.starts_at);
      weekDays.forEach((day) => {
        // Booking matches day if starts_at falls on this day
        if (
          bDate.getDate() === day.getDate() &&
          bDate.getMonth() === day.getMonth() &&
          bDate.getFullYear() === day.getFullYear()
        ) {
          if (map[b.venue_id]?.[day.toDateString()]) {
            map[b.venue_id][day.toDateString()].push(b);
          }
        }
      });
    });

    return map;
  }, [bookings, venues, weekDays]);

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
        <h1 className="text-base font-bold text-white">Lịch Đặt Đoàn & Sự Kiện</h1>
        <button
          onClick={() => openForm(null)}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
        >
          Đặt chỗ mới
        </button>
      </header>

      {/* Week Controller */}
      <div className="mx-auto w-full max-w-7xl px-4 mt-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 backdrop-blur-xl">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => changeWeek(-1)}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
              title="Tuần trước"
            >
              <svg className="h-5 w-5 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-sm font-semibold text-zinc-200 min-w-[240px] text-center font-mono">
              📅 Tuần: {weekDays[0].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} – {weekDays[6].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </div>
            <button
              onClick={() => changeWeek(1)}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
              title="Tuần sau"
            >
              <svg className="h-5 w-5 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="text-xs text-zinc-400">
            Sắp xếp sảnh × giờ, dễ dàng kiểm soát phòng tránh trùng lắp đặt đoàn.
          </div>
        </div>
      </div>

      {/* Week Grid */}
      <div className="mx-auto w-full max-w-7xl px-4 mt-6">
        <div className="rounded-2xl border border-zinc-850 bg-zinc-900/20 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[900px]">
              <thead>
                <tr className="bg-zinc-900/60 border-b border-zinc-800">
                  <th className="p-4 text-xs font-bold text-zinc-400 uppercase tracking-wider w-[150px] border-r border-zinc-800">Sảnh / Khu vực</th>
                  {weekDays.map((day, idx) => (
                    <th key={idx} className="p-3 text-center w-[150px] border-r border-zinc-800 last:border-r-0">
                      <span className="block text-xs font-bold text-white">{getVietnameseDayName(day)}</span>
                      <span className="block text-[10px] text-zinc-500 font-mono mt-0.5">{day.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {venues.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-zinc-500 text-xs italic">Chưa có sảnh nào hoạt động.</td>
                  </tr>
                ) : (
                  venues.map((venue) => (
                    <tr key={venue.id} className="hover:bg-zinc-900/10 transition">
                      <td className="p-4 border-r border-zinc-800 font-bold text-zinc-200 text-xs flex flex-col justify-center">
                        <span>{venue.name}</span>
                        <span className="text-[10px] text-zinc-500 font-normal mt-0.5">Sức chứa: {venue.capacity} pax</span>
                      </td>
                      {weekDays.map((day, dIdx) => {
                        const dayBookings = bookingsByVenueAndDay[venue.id]?.[day.toDateString()] || [];
                        return (
                          <td key={dIdx} className="p-2 border-r border-zinc-800 last:border-r-0 align-top h-32 min-h-[128px]">
                            <div className="space-y-1.5 h-full overflow-y-auto">
                              {dayBookings.length === 0 ? (
                                <span className="block text-[9px] text-zinc-650 text-center py-8 italic select-none">Trống</span>
                              ) : (
                                dayBookings.map((b) => {
                                  const startStr = new Date(b.starts_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
                                  const endStr = new Date(b.ends_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
                                  const name = b.group_name || b.agency_name_raw || b.agencies?.name || "Khách lẻ";

                                  return (
                                    <div
                                      key={b.id}
                                      onClick={() => openForm(b)}
                                      className={`rounded-lg p-1.5 text-[10px] border cursor-pointer hover:scale-[1.02] transition shadow-sm ${statusColors[b.status]}`}
                                    >
                                      <div className="font-bold truncate" title={name}>{name}</div>
                                      <div className="flex justify-between font-mono text-[8px] opacity-80 mt-0.5">
                                        <span>👥 {b.pax} pax</span>
                                        <span>{startStr}-{endStr}</span>
                                      </div>
                                      {b.status === "CONFIRMED" && (
                                        <div className="text-[8px] font-bold mt-1 text-right">
                                          {((b.booking_deposits && b.booking_deposits.length > 0) || (b.booking_deposits_public && b.booking_deposits_public.length > 0)) ? (
                                            <span className="text-emerald-450">
                                              {b.booking_deposits && b.booking_deposits[0]
                                                ? `💰 ${Number(b.booking_deposits[0].amount).toLocaleString("vi-VN")}đ`
                                                : "💰 Đã cọc"}
                                            </span>
                                          ) : (
                                            <span className="text-amber-500">⚠️ Chưa cọc</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Booking Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden flex flex-col my-8">
            <header className="border-b border-zinc-800 bg-zinc-900/80 px-6 py-4 flex items-center justify-between sticky top-0 backdrop-blur z-10">
              <h3 className="text-sm font-bold text-white">
                {editingBooking ? "✏️ Sửa Thông Tin Đặt Đoàn" : "➕ Đặt Sảnh / Sự Kiện Mới"}
              </h3>
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
                <label htmlFor="selectVenue" className="block text-xs font-semibold text-zinc-400 mb-1">Sảnh / Khu vực*</label>
                <select
                  id="selectVenue"
                  value={venueId}
                  onChange={(e) => setVenueId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  required
                >
                  <option value="" disabled>-- Chọn sảnh --</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} (sức chứa: {v.capacity})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="selectAgency" className="block text-xs font-semibold text-zinc-400 mb-1">Đại lý (Agency) chuẩn</label>
                  <select
                    id="selectAgency"
                    value={agencyId}
                    onChange={(e) => {
                      setAgencyId(e.target.value);
                      if (e.target.value) setAgencyNameRaw(""); // Clear raw input if selecting standard
                    }}
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  >
                    <option value="">-- Chọn đại lý chuẩn (nếu có) --</option>
                    {agencies.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rawAgency" className="block text-xs font-semibold text-zinc-400 mb-1">Tên khách / đại lý vãng lai</label>
                  <input
                    id="rawAgency"
                    type="text"
                    value={agencyNameRaw}
                    onChange={(e) => {
                      setAgencyNameRaw(e.target.value);
                      if (e.target.value) setAgencyId(""); // Clear selected agency standard
                    }}
                    placeholder="Ví dụ: Đoàn lữ hành Tùng Dương"
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="grpName" className="block text-xs font-semibold text-zinc-400 mb-1">Tên đoàn / tên gợi nhớ</label>
                  <input
                    id="grpName"
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Ví dụ: Dinner GALA"
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label htmlFor="grpPax" className="block text-xs font-semibold text-zinc-400 mb-1">Số lượng khách (pax)*</label>
                  <input
                    id="grpPax"
                    type="number"
                    value={pax}
                    min={1}
                    onChange={(e) => setPax(parseInt(e.target.value) || 1)}
                    className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              {capacityWarning && (
                <div className="p-3 text-xs bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 font-medium">
                  ⚠️ {capacityWarning}
                </div>
              )}

              <div className="border-t border-zinc-850 pt-3">
                <span className="block text-[10px] uppercase font-bold text-zinc-400 mb-2 tracking-wider">Thời gian sự kiện</span>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="startD" className="block text-[10px] text-zinc-500 mb-1">Bắt đầu ngày*</label>
                    <input
                      id="startD"
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setEndDate(e.target.value); // Sync end date with start date by default
                      }}
                      className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-white outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="startT" className="block text-[10px] text-zinc-500 mb-1">Thời gian bắt đầu*</label>
                    <input
                      id="startT"
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-white outline-none"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div>
                    <label htmlFor="endD" className="block text-[10px] text-zinc-500 mb-1">Kết thúc ngày*</label>
                    <input
                      id="endD"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-white outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="endT" className="block text-[10px] text-zinc-500 mb-1">Thời gian kết thúc*</label>
                    <input
                      id="endT"
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-white outline-none"
                      required
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="bookStatus" className="block text-xs font-semibold text-zinc-400 mb-1">Trạng thái đặt đoàn*</label>
                <select
                  id="bookStatus"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500"
                  required
                >
                  <option value="TENTATIVE">Tạm đặt (TENTATIVE)</option>
                  <option value="CONFIRMED">Xác nhận (CONFIRMED)</option>
                  <option value="CANCELLED">Hủy bỏ (CANCELLED)</option>
                  <option value="COMPLETED">Hoàn tất (COMPLETED)</option>
                </select>
                {editingBooking && (staff?.role !== "owner" && staff?.role !== "manager") && (
                  <p className="text-[10px] text-rose-400 mt-1">Chỉ quản lý/owner được sửa trạng thái của đặt đoàn cũ.</p>
                )}
              </div>

              <div>
                <label htmlFor="bookNote" className="block text-xs font-semibold text-zinc-400 mb-1">Ghi chú sự kiện</label>
                <textarea
                  id="bookNote"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú thêm về thực đơn, yêu cầu kỹ thuật sân khấu..."
                  className="w-full rounded-xl border border-zinc-850 bg-zinc-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                />
              </div>

              {/* Deposit Section for CONFIRMED bookings */}
              {editingBooking && status === "CONFIRMED" && (
                <div className="border-t border-zinc-800 pt-4 mt-4 space-y-3">
                  <span className="block text-xs font-bold text-amber-400 uppercase tracking-wider">
                    💵 Thông tin đặt cọc sảnh
                  </span>

                  {((editingBooking.booking_deposits && editingBooking.booking_deposits.length > 0) || 
                    (editingBooking.booking_deposits_public && editingBooking.booking_deposits_public.length > 0)) ? (
                    // Deposit exists
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2 text-xs">
                      <div className="flex justify-between border-b border-zinc-900 pb-1.5 font-semibold">
                        <span className="text-zinc-400">Trạng thái:</span>
                        <span className="text-emerald-450">Đã đặt cọc ✓</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Số tiền:</span>
                        <span className="text-zinc-200 font-bold">
                          {editingBooking.booking_deposits && editingBooking.booking_deposits[0]
                            ? `${Number(editingBooking.booking_deposits[0].amount).toLocaleString("vi-VN")}đ`
                            : "🔒 Ẩn (Chỉ Owner/Kế toán mới xem được số tiền)"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Phương thức:</span>
                        <span className="text-zinc-250">
                          {editingBooking.booking_deposits?.[0]?.payment_method || editingBooking.booking_deposits_public?.[0]?.payment_method}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Ngày nhận:</span>
                        <span className="text-zinc-350">
                          {new Date(editingBooking.booking_deposits?.[0]?.received_at || editingBooking.booking_deposits_public?.[0]?.received_at).toLocaleDateString("vi-VN")}
                        </span>
                      </div>
                      {(editingBooking.booking_deposits?.[0]?.note || editingBooking.booking_deposits_public?.[0]?.note) && (
                        <div className="pt-1.5 border-t border-zinc-900 text-zinc-500 italic">
                          Ghi chú: {editingBooking.booking_deposits?.[0]?.note || editingBooking.booking_deposits_public?.[0]?.note}
                        </div>
                      )}
                    </div>
                  ) : (
                    // Deposit form
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="depAmt" className="block text-[10px] text-zinc-500 mb-1">Số tiền cọc (VNĐ)*</label>
                          <input
                            id="depAmt"
                            type="number"
                            min={0}
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(Number(e.target.value))}
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white outline-none"
                          />
                        </div>
                        <div>
                          <label htmlFor="depMethod" className="block text-[10px] text-zinc-500 mb-1">Phương thức thanh toán*</label>
                          <select
                            id="depMethod"
                            value={depositMethod}
                            onChange={(e) => setDepositMethod(e.target.value as any)}
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white outline-none"
                          >
                            <option value="TRANSFER">Chuyển khoản</option>
                            <option value="CASH">Tiền mặt</option>
                            <option value="CARD">Quẹt thẻ</option>
                            <option value="OTHER">Khác</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="depNote" className="block text-[10px] text-zinc-500 mb-1">Ghi chú cọc</label>
                        <input
                          id="depNote"
                          type="text"
                          value={depositNote}
                          placeholder="Mã tham chiếu ngân hàng, số phiếu thu..."
                          onChange={(e) => setDepositNote(e.target.value)}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white outline-none"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleSaveDeposit}
                        className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-200 py-2 border border-zinc-700 transition"
                      >
                        Lưu Phiếu Đặt Cọc
                      </button>
                    </div>
                  )}
                </div>
              )}

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
                  disabled={isSubmitting || (!!editingBooking && staff?.role !== "owner" && staff?.role !== "manager")}
                  className="px-6 py-2.5 rounded-xl bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold text-xs transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Đang xử lý..." : editingBooking ? "Cập Nhật" : "Tạo đặt chỗ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default function BookingsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="animate-pulse text-zinc-400">Đang tải lịch đặt sảnh...</div>
      </main>
    }>
      <BookingsContent />
    </Suspense>
  );
}
