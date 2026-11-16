"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { authService } from "@/lib/api";

interface GoogleAuthButtonProps {
  onError?: (msg: string) => void;
  className?: string;
}

const DEFAULT_CLIENT_ID = "704156190740-1sqmtp49e3v5fa6kujjl6cdtv1af6rl3.apps.googleusercontent.com";
const AUTH_CHANNEL_NAME = "bobo_google_oauth_channel";
const AUTH_STORAGE_KEY = "bobo_google_oauth_event";

export function GoogleAuthButton({ onError, className = "" }: GoogleAuthButtonProps) {
  const { t } = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;

  const navigateAfterLogin = useCallback(
    (session: { role?: string | null; profileDone?: boolean }) => {
      const dest = !session.role
        ? "/rol-tanlash"
        : session.role === "xaridor"
          ? "/xaridor"
          : session.profileDone
            ? "/mutaxassis"
            : "/mutaxassis/settings/royxat";
      router.push(dest);
    },
    [router]
  );

  const processGoogleLogin = useCallback(
    async (params: { accessToken?: string; idToken?: string }) => {
      setLoading(true);
      try {
        let email: string | undefined;
        let fullName: string | undefined;
        let googleId: string | undefined;
        let avatarUrl: string | undefined;

        // 1. Agar accessToken bo'lsa, Google UserInfo API orqali profil ma'lumotlarini olish
        if (params.accessToken) {
          try {
            const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${params.accessToken}` },
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
            /* Tarmoq xatoligi bo'lsa backend o'zi tekshiradi */
          }
        }

        // 2. Agar idToken bo'lsa, JWT payloadini o'qish
        if (params.idToken && !email) {
          try {
            const parts = params.idToken.split(".");
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
              email = payload.email;
              fullName = payload.name;
              googleId = payload.sub;
              avatarUrl = payload.picture;
            }
          } catch {
            /* Ignore decode error */
          }
        }

        const session = await authService.loginWithGoogle({
          accessToken: params.accessToken,
          idToken: params.idToken,
          email,
          fullName,
          googleId,
          avatarUrl,
        });

        navigateAfterLogin(session);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : t("auth.googleLoginFailed") || "Google orqali kirishda xatolik yuz berdi";
        onError?.(msg);
        setLoading(false);
      }
    },
    [navigateAfterLogin, onError, t]
  );

  // 1-KANAL: PostMessage tinglovchisi (/google-callback oynasidan)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "BOBO_GOOGLE_AUTH_CALLBACK") {
        const { accessToken, idToken, error } = event.data;
        if (error) {
          onError?.(error);
          setLoading(false);
          return;
        }
        if (accessToken || idToken) {
          void processGoogleLogin({ accessToken, idToken });
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onError, processGoogleLogin]);

  // 2-KANAL: BroadcastChannel tinglovchisi (opener bloklangan holatlar uchun)
  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "BOBO_GOOGLE_AUTH_CALLBACK") {
        const { accessToken, idToken, error } = event.data;
        if (error) {
          onError?.(error);
          setLoading(false);
          return;
        }
        if (accessToken || idToken) {
          void processGoogleLogin({ accessToken, idToken });
        }
      }
    };
    return () => channel.close();
  }, [onError, processGoogleLogin]);

  // 3-KANAL: LocalStorage tinglovchisi (barcha brauzerlar va tablararo ishonchli zaxira)
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== AUTH_STORAGE_KEY || !event.newValue) return;
      try {
        const data = JSON.parse(event.newValue);
        if (data.error) {
          onError?.(data.error);
          setLoading(false);
          return;
        }
        if (data.accessToken || data.idToken) {
          void processGoogleLogin({ accessToken: data.accessToken, idToken: data.idToken });
        }
      } catch {
        /* Ignore */
      } finally {
        try {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        } catch {
          /* Ignore */
        }
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [onError, processGoogleLogin]);

  // Google tugmasi bosilganda - Upwork kabi to'liq OAuth 2.0 pop-up oynasini ochish
  function handleButtonClick() {
    setLoading(true);

    const callbackUrl = `${window.location.origin}/google-callback`;
    const width = 500;
    const height = 650;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);

    // To'g'ridan-to'g'ri Google OAuth 2.0 endpoint ochiladi.
    // Bu usulda JavaScript Origin talab qilinmaydi, faqat Google Cloud Console'da ro'yxatdan o'tgan
    // "Authorised redirect URIs" (https://bobololadono.uz/google-callback) tekshiriladi.
    const popupUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      callbackUrl
    )}&response_type=token%20id_token&scope=${encodeURIComponent(
      "openid email profile"
    )}&prompt=select_account&nonce=${nonce}`;

    const popup = window.open(
      popupUrl,
      "google_oauth_popup",
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no,location=yes,resizable=yes`
    );

    if (!popup) {
      setLoading(false);
      onError?.("Brauzeringiz pop-up oynalarni blokladi. Iltimos, ruxsat bering.");
      return;
    }

    // Popup yopilishini kuzatish
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        // Agar callbackdan hali javob kelmagan bo'lsa, loadingni bekor qilamiz
        setTimeout(() => setLoading(false), 800);
      }
    }, 1000);
  }

  return (
    <button
      type="button"
      onClick={handleButtonClick}
      disabled={loading}
      className={`w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-2xl border border-line bg-card hover:bg-card-hover font-semibold text-ink text-sm sm:text-base transition-all shadow-sm active:scale-[0.99] cursor-pointer disabled:opacity-60 ${className}`}
    >
      {loading ? (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" className="shrink-0">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.33 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.92 0 12s.45 3.85 1.24 5.42l4.04-3.15z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
          />
        </svg>
      )}
      <span>{t("auth.continueWithGoogle")}</span>
    </button>
  );
}
