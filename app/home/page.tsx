import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Query staff table by auth_user_id
  const { data: staff } = await supabase
    .from("staff")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Server Action for logout
  async function handleLogout() {
    "use server";
    const supabase = createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  if (!staff) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <div className="w-full max-w-md space-y-6 rounded-3xl border border-rose-950/40 bg-zinc-900/40 p-8 shadow-2xl backdrop-blur-xl text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-950/50 text-rose-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-rose-300">Từ chối truy cập</h2>
          <p className="text-sm text-zinc-400">
            Tài khoản chưa được cấp quyền, liên hệ quản lý.
          </p>
          <div className="pt-2 text-xs text-zinc-500 font-mono">
            Email của bạn: {user.email}
          </div>
          <form action={handleLogout} className="pt-4">
            <button
              type="submit"
              className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 py-3 text-sm font-semibold transition"
            >
              Đăng xuất
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-950 bg-zinc-900/20 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="rounded-lg bg-gradient-to-tr from-amber-500 to-orange-600 px-2 py-1 text-xs font-bold text-white">MVOS</span>
            <span className="font-semibold text-zinc-200">Maison Vie OS</span>
          </div>
          <form action={handleLogout}>
            <button
              type="submit"
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-white transition"
            >
              Đăng xuất
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-12">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/20 p-8 shadow-2xl backdrop-blur-xl">
          <div className="space-y-4">
            <div className="inline-flex items-center space-x-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
              <span className="relative flex h-2 w-2 mr-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              Vai trò: {staff.role === "owner" ? "Chủ sở hữu (Owner)" : staff.role === "manager" ? "Quản lý (Manager)" : "Nhân viên (Staff)"}
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Xin chào {staff.full_name}.
            </h1>
            
            <p className="text-lg text-zinc-300">
              MVOS foundation OK.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              <Link
                href="/checklist"
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-4 text-center text-sm font-bold text-white hover:bg-zinc-800/80 transition"
              >
                📋 Checklist Ca
              </Link>
              <Link
                href="/shift-report"
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-4 text-center text-sm font-bold text-white hover:bg-zinc-800/80 transition"
              >
                📝 Báo Cáo Cuối Ca
              </Link>
              <Link
                href="/visits"
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-4 text-center text-sm font-bold text-white hover:bg-zinc-800/80 transition"
              >
                👥 Log Đoàn Hằng Ngày
              </Link>
              <Link
                href="/log"
                className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-4 text-center text-sm font-bold text-zinc-950 hover:from-amber-400 hover:to-amber-500 transition shadow-md shadow-amber-500/10"
              >
                ⚠️ Ghi Nhận Sự Cố
              </Link>
              {(staff.role === "owner" || staff.role === "manager") && (
                <Link
                  href="/agencies"
                  className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-4 text-center text-sm font-bold text-white hover:bg-zinc-800/80 transition"
                >
                  🏢 Quản Lý Agency
                </Link>
              )}
              {staff.role === "owner" && (
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-6 py-4 text-center text-sm font-bold text-amber-300 hover:bg-amber-500/20 transition"
                >
                  📊 Báo Cáo Tổng Hợp
                </Link>
              )}
            </div>

            <div className="border-t border-zinc-800 pt-6 mt-6 space-y-2 text-sm text-zinc-500">
              <div>Thông tin tài khoản:</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>Họ và tên: <span className="text-zinc-300 font-medium">{staff.full_name}</span></li>
                <li>Email: <span className="text-zinc-300 font-medium">{user.email}</span></li>
                <li>ID Nhân viên: <span className="text-zinc-400 font-mono text-xs">{staff.id}</span></li>
                <li>Trạng thái hoạt động: <span className="text-emerald-400">Đang kích hoạt</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
