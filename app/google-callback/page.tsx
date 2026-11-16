"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authService } from "@/lib/api";

const AUTH_CHANNEL_NAME = "bobo_google_oauth_channel";
const AUTH_STORAGE_KEY = "bobo_google_oauth_event";

export default function GoogleCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function handleAuth() {
      try {
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.substring(1)
          : window.location.hash;
        const search = window.location.search.startsWith("?")
          ? window.location.search.substring(1)
          : window.location.search;

        const hashParams = new URLSearchParams(hash);
        const searchParams = new URLSearchParams(search);

        const accessToken = hashParams.get("access_token") || searchParams.get("access_token");
        const idToken = hashParams.get("id_token") || searchParams.get("id_token");
        const code = hashParams.get("code") || searchParams.get("code");
        const error = hashParams.get("error") || searchParams.get("error");
        const errorDescription =
          hashParams.get("error_description") || searchParams.get("error_description");

        if (error) {
          const errText = errorDescription || error;
          setStatus("error");
          setErrorMessage(errText);

          // 1. PostMessage
          try {
            window.opener?.postMessage(
              { type: "BOBO_GOOGLE_AUTH_CALLBACK", error: errText },
              "*"
            );
          } catch {
            /* Ignore */
          }

          // 2. BroadcastChannel
          try {
            if ("BroadcastChannel" in window) {
              const ch = new BroadcastChannel(AUTH_CHANNEL_NAME);
              ch.postMessage({ type: "BOBO_GOOGLE_AUTH_CALLBACK", error: errText });
              ch.close();
            }
          } catch {
            /* Ignore */
          }

          // 3. LocalStorage
          try {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ error: errText }));
          } catch {
            /* Ignore */
          }

          setTimeout(() => window.close(), 2500);
          return;
        }

        if (accessToken || idToken) {
          setStatus("success");

          // 1. PostMessage
          try {
            window.opener?.postMessage(
              {
                type: "BOBO_GOOGLE_AUTH_CALLBACK",
                accessToken: accessToken || undefined,
                idToken: idToken || undefined,
                code: code || undefined,
              },
              "*"
            );
          } catch {
            /* Ignore */
          }

          // 2. BroadcastChannel
          try {
            if ("BroadcastChannel" in window) {
              const ch = new BroadcastChannel(AUTH_CHANNEL_NAME);
              ch.postMessage({
                type: "BOBO_GOOGLE_AUTH_CALLBACK",
                accessToken: accessToken || undefined,
                idToken: idToken || undefined,
                code: code || undefined,
              });
              ch.close();
            }
          } catch {
            /* Ignore */
          }

          // 3. LocalStorage
          try {
            localStorage.setItem(
              AUTH_STORAGE_KEY,
              JSON.stringify({
                accessToken: accessToken || undefined,
                idToken: idToken || undefined,
                timestamp: Date.now(),
              })
            );
          } catch {
            /* Ignore */
          }

          // Agar bu oyna popup bo'lsa (opener mavjud bo'lsa) — avtomatik yopamiz
          if (window.opener && window.opener !== window) {
            setTimeout(() => window.close(), 400);
            return;
          }

          // Fallback: Agar opener bo'lmasa (masalan, to'liq sahifada ochilgan bo'lsa)
          let email: string | undefined;
          let fullName: string | undefined;
          let googleId: string | undefined;
          let avatarUrl: string | undefined;

          if (accessToken) {
            try {
              const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (userRes.ok) {
                const profile = (await userRes.json()) as {
                  sub?: string;
                  email?: string;
                  name?: string;
                  picture?: string;
                };
                email = profile.email;
                fullName = profile.name;
                googleId = profile.sub;
                avatarUrl = profile.picture;
              }
            } catch {
              /* Ignore */
            }
          }

          if (idToken && !email) {
            try {
              const parts = idToken.split(".");
              if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
                email = payload.email;
                fullName = payload.name;
                googleId = payload.sub;
                avatarUrl = payload.picture;
              }
            } catch {
              /* Ignore */
            }
          }

          const session = await authService.loginWithGoogle({
            accessToken: accessToken || undefined,
            idToken: idToken || undefined,
            email,
            fullName,
            googleId,
            avatarUrl,
          });

          const dest = !session.role
            ? "/rol-tanlash"
            : session.role === "xaridor"
              ? "/xaridor"
              : session.profileDone
                ? "/mutaxassis"
                : "/mutaxassis/settings/royxat";
          router.push(dest);
        } else {
          setStatus("error");
          setErrorMessage("Google hisob ma'lumotlari topilmadi");
        }
      } catch (err: unknown) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Avtorizatsiyada xatolik");
      }
    }

    void handleAuth();
  }, [router]);

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
