"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

function LoginContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      setMessage({ type: "error", text: errorParam });
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    if (!email) {
      setMessage({ type: "error", text: "Vui lòng nhập địa chỉ email của bạn." });
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
        },
      });

      if (error) {
        setMessage({
          type: "error",
          text: error.message === "Signups not allowed for this project" 
            ? "Tài khoản email này chưa đăng ký hoặc không được phép tham gia hệ thống." 
            : `Lỗi: ${error.message}`,
        });
      } else {
        setMessage({
          type: "success",
          text: "Một liên kết đăng nhập đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư (và cả thư rác).",
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Không rõ nguyên nhân";
      setMessage({
        type: "error",
        text: `Đã xảy ra lỗi kết nối: ${errorMessage}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-radial-gradient from-zinc-900 to-black px-4 py-12 text-zinc-100 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="flex flex-col items-center justify-center text-center">
          <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 shadow-lg shadow-orange-500/20">
            <span className="text-2xl font-bold text-white tracking-wider">MV</span>
            <div className="absolute -inset-0.5 -z-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 opacity-30 blur-sm"></div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Maison Vie OS
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Hệ thống quản lý vận hành nội bộ biệt thự neoclassical
          </p>
        </div>

        {/* Card */}
        <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/60 p-8 shadow-2xl backdrop-blur-xl">
          {/* Decorative ambient light */}
          <div className="absolute -left-16 -top-16 h-32 w-32 rounded-full bg-amber-500/10 blur-3xl"></div>
          
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Địa chỉ Email
              </label>
              <div className="mt-2">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@maisonvie.vn"
                  className="block w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none transition duration-200 focus:border-amber-500 focus:bg-zinc-900 focus:ring-1 focus:ring-amber-500"
                  disabled={isLoading}
                />
              </div>
            </div>

            {message && (
              <div
                className={`rounded-xl p-4 text-sm border ${
                  message.type === "success"
                    ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                    : "bg-rose-950/40 border-rose-980/50 text-rose-300"
                } transition-all duration-300`}
              >
                {message.text}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative flex w-full justify-center rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 text-sm font-semibold text-zinc-950 transition duration-200 hover:from-amber-400 hover:to-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-55 disabled:cursor-not-allowed shadow-md shadow-amber-500/10"
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <svg className="h-4 w-4 animate-spin text-zinc-950" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Đang gửi mã đăng nhập...</span>
                  </div>
                ) : (
                  <span>Nhận Magic Link đăng nhập</span>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-zinc-600">
          Chỉ dành cho nhân viên được cấp phép của Maison Vie.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
        <div className="w-full max-w-md text-center">
          <div className="animate-pulse text-zinc-400">Đang tải...</div>
        </div>
      </main>
    }>
      <LoginContent />
    </Suspense>
  );
}
