"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { authService } from "@/lib/api";

interface GoogleAuthButtonProps {
  onError?: (msg: string) => void;
  className?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (res: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          prompt: () => void;
          renderButton: (
            element: HTMLElement,
            options: { theme?: string; size?: string; width?: number; text?: string; shape?: string }
          ) => void;
        };
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (res: { access_token: string }) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

export function GoogleAuthButton({ onError, className = "" }: GoogleAuthButtonProps) {
  const { t } = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [googleEmail, setGoogleEmail] = useState("");
  const [googleName, setGoogleName] = useState("");

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  const navigateAfterLogin = useCallback((session: { role?: string | null; profileDone?: boolean }) => {
    const dest = !session.role
      ? "/rol-tanlash"
      : session.role === "xaridor"
        ? "/xaridor"
        : session.profileDone
          ? "/mutaxassis"
          : "/mutaxassis/settings/royxat";
    router.push(dest);
  }, [router]);

  const handleCredential = useCallback(async (idToken: string) => {
    setLoading(true);
    try {
      // Decode payload to extract profile preview if needed
      let email: string | undefined;
      let fullName: string | undefined;
      try {
        const parts = idToken.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          email = payload.email;
          fullName = payload.name;
        }
      } catch {
        /* Ignore decode error */
      }

      const session = await authService.loginWithGoogle({
        idToken,
        email,
        fullName,
      });

      navigateAfterLogin(session);
    } catch {
      onError?.(t("auth.googleLoginFailed") || "Google orqali kirishda xatolik yuz berdi");
      setLoading(false);
    }
  }, [navigateAfterLogin, onError, t]);

  useEffect(() => {
    if (!clientId || typeof window === "undefined") return;

    // Google GSI script yuklash
    if (!document.getElementById("google-gsi-client")) {
      const script = document.createElement("script");
      script.id = "google-gsi-client";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        initGsi();
      };
      document.body.appendChild(script);
    } else {
      initGsi();
    }

    function initGsi() {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (res) => {
            await handleCredential(res.credential);
          },
        });
      }
    }
  }, [clientId, handleCredential]);

  async function handleButtonClick() {
    if (clientId && window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
      return;
    }

    // Google Client ID hali kiritilmagan bo'lsa yoki test muhitida:
    setShowPromptModal(true);
  }

  async function handleManualGoogleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!googleEmail.trim()) return;

    setLoading(true);
    try {
      const session = await authService.loginWithGoogle({
        email: googleEmail.trim().toLowerCase(),
        fullName: googleName.trim() || undefined,
        googleId: `google_mock_${Date.now()}`,
      });
      setShowPromptModal(false);
      navigateAfterLogin(session);
    } catch {
      onError?.(t("auth.googleLoginFailed") || "Google orqali kirishda xatolik yuz berdi");
      setLoading(false);
    }
  }

  return (
    <>
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

      {/* Google Sign-In Dialog (Google OAuth / Tezkor kirish) */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-line bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-line">
              <div className="flex items-center gap-2.5">
                <svg width="22" height="22" viewBox="0 0 24 24">
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
                <h3 className="font-heading font-bold text-ink text-base">Google hisobi bilan kirish</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPromptModal(false)}
                className="text-muted hover:text-ink text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleManualGoogleSubmit} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  Google Email manzilingiz
                </label>
                <input
                  type="email"
                  required
                  placeholder="nomingiz@gmail.com"
                  value={googleEmail}
                  onChange={(e) => setGoogleEmail(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  Ism va familiyangiz
                </label>
                <input
                  type="text"
                  placeholder="Alisher Usmonov"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary"
                />
              </div>

              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPromptModal(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-muted hover:text-ink"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={loading || !googleEmail.trim()}
                  className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-deep transition-colors disabled:opacity-50"
                >
                  {loading ? "Kirilmoqda..." : "Davom etish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
