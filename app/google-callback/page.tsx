"use client";

import { useEffect, useState } from "react";

export default function GoogleCallbackPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    try {
      // 1. Fragment (#access_token=...&id_token=...) yoki query param (?code=...) o'qish
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.substring(1)
        : window.location.hash;
      const search = window.location.search.startsWith("?")
        ? window.location.search.substring(1)
        : window.location.search;

      const params = new URLSearchParams(hash || search);
      const accessToken = params.get("access_token");
      const idToken = params.get("id_token");
      const code = params.get("code");
      const error = params.get("error");
      const errorDescription = params.get("error_description");

      if (error) {
        setStatus("error");
        setErrorMessage(errorDescription || error);
        if (window.opener) {
          window.opener.postMessage(
            {
              type: "BOBO_GOOGLE_AUTH_CALLBACK",
              error: errorDescription || error,
            },
            "*"
          );
          setTimeout(() => window.close(), 2000);
        }
        return;
      }

      if (accessToken || idToken || code) {
        setStatus("success");
        if (window.opener) {
          window.opener.postMessage(
            {
              type: "BOBO_GOOGLE_AUTH_CALLBACK",
              accessToken: accessToken || undefined,
              idToken: idToken || undefined,
              code: code || undefined,
            },
            "*"
          );
          setTimeout(() => window.close(), 300);
        }
      } else {
        setStatus("error");
        setErrorMessage("Token topilmadi");
      }
    } catch (err: unknown) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Avtorizatsiyada xatolik");
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4 font-sans text-ink">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-line bg-card p-6 text-center shadow-lg">
        {status === "loading" && (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-semibold">Google orqali kirilmoqda...</p>
            <p className="text-xs text-muted">Iltimos, kuting, oynacha avtomatik yopiladi</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm font-bold text-emerald-600">Muvaffaqiyatli!</p>
            <p className="text-xs text-muted">Bobololadono tizimiga yo&apos;naltirilmoqda...</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <p className="text-sm font-bold text-rose-600">Xatolik yuz berdi</p>
            <p className="text-xs text-muted">{errorMessage || "Kirish bekor qilindi"}</p>
          </>
        )}
      </div>
    </div>
  );
}
