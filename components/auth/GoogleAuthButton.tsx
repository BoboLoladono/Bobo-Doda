"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { authService } from "@/lib/api";

interface GoogleAuthButtonProps {
  onError?: (msg: string) => void;
  className?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (res: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          prompt: () => void;
        };
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (res: GoogleTokenResponse) => void;
            error_callback?: (err: { type: string; message?: string }) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

const DEFAULT_CLIENT_ID = "704156190740-1sqmtp49e3v5fa6kujjl6cdtv1af6rl3.apps.googleusercontent.com";

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

        // 1. Agar accessToken bo'lsa, Google UserInfo API orqali ma'lumotlarni olish
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

  // Google GSI (Google Identity Services) kutubxonasini yuklash
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!document.getElementById("google-gsi-client")) {
      const script = document.createElement("script");
      script.id = "google-gsi-client";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, []);

  // Popup callbackdan postMessage qabul qilish (/google-callback oynasi orqali)
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

  // Google tugmasi bosilganda - Upwork kabi to'liq pop-up oynani ochish
  function handleButtonClick() {
    setLoading(true);

    // 1-USUL: Google Identity Services (GSI) initTokenClient orqali popup
    if (window.google?.accounts?.oauth2) {
      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "openid email profile",
          callback: (tokenResponse) => {
            if (tokenResponse.error) {
              onError?.(
                tokenResponse.error_description || "Google hisobini tanlashda xatolik yuz berdi"
              );
              setLoading(false);
              return;
            }
            if (tokenResponse.access_token) {
              void processGoogleLogin({ accessToken: tokenResponse.access_token });
            }
          },
          error_callback: (err) => {
            setLoading(false);
            if (err.type === "popup_closed") {
              return; // Foydalanuvchi o'zi oynani yopdi
            }
            onError?.("Google popup xatoligi: " + (err.message || err.type));
          },
        });

        // select_account - Upwork kabi to'g'ridan-to'g'ri hisob tanlash sahifasini ochadi
        tokenClient.requestAccessToken({ prompt: "select_account" });
        return;
      } catch {
        // Fallback orqali davom etamiz
      }
    }

    // 2-USUL: Standart OAuth 2.0 Popup oynasi (to'g'ridan-to'g'ri accounts.google.com ochiladi)
    const callbackUrl = `${window.location.origin}/google-callback`;
    const width = 500;
    const height = 650;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popupUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      callbackUrl
    )}&response_type=token%20id_token&scope=openid%20email%20profile&prompt=select_account&nonce=${Math.random().toString(36).slice(2)}`;

    const popup = window.open(
      popupUrl,
      "google_oauth_popup",
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
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
        setLoading(false);
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
