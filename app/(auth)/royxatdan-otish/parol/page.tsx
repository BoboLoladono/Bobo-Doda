"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authService } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { trackSignUp } from "@/lib/analytics";

/** Bosqich 21 — ro'yxatdan o'tishning YAKUNIY bosqichi: OTP tasdiqlangan
    (`registrationToken` sessionStorage'da), endi parol so'raladi. Muvaffaqi-
    yatli bo'lsa `completeRegistration` User yaratadi + sessiya ochadi
    (atomik, backend tomonida). Telefon allaqachon ro'yxatdan o'tgan bo'lsa
    (`PHONE_EXISTS`) — bu ma'lumot FAQAT shu yerda, VALID OTP'dan keyin
    oshkor bo'ladi (enumeration-safe). */
export default function RoyxatdanOtishParolPage() {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [registrationToken, setRegistrationToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountAlreadyExists, setAccountAlreadyExists] = useState(false);

  useEffect(() => {
    const session = authService.getSession();
    if (session) {
      const dest = session.role === "xaridor" ? "/xaridor" : session.role === "mutaxassis" ? "/mutaxassis" : "/rol-tanlash";
      if (pathname !== dest) router.replace(dest);
      return;
    }
    const stored = window.sessionStorage.getItem("bd_registration_token");
    if (!stored) {
      router.replace("/royxatdan-otish");
      return;
    }
    setRegistrationToken(stored);
  }, [router, pathname]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setAccountAlreadyExists(false);
    if (password.length < 8 || !/\S/.test(password)) {
      setError(t("security.passwordRules"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.errPasswordMatch"));
      return;
    }
    setLoading(true);
    try {
      const session = await authService.completeRegistration(registrationToken, password, confirmPassword);
      trackSignUp("phone", session.role || undefined);
      window.sessionStorage.removeItem("bd_registration_token");
      window.sessionStorage.removeItem("bd_register_otp_phone");
      router.push(!session.role ? "/rol-tanlash" : session.role === "xaridor" ? "/xaridor" : "/mutaxassis");
    } catch (err) {
      const errCode = err instanceof Error ? err.message : "";
      if (errCode === "PHONE_EXISTS") {
        setAccountAlreadyExists(true);
        setLoading(false);
        return;
      }
      if (errCode === "TOKEN_EXPIRED") {
        window.sessionStorage.removeItem("bd_registration_token");
        router.replace("/royxatdan-otish");
        return;
      }
      setError(t("common.error"));
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl sm:rounded-[32px] border border-line/80 bg-card p-7 sm:p-12 lg:p-14 shadow-2xl shadow-black/5">
      <div className="mb-5">
        <BackButton href="/royxatdan-otish" label={t("auth.tabRegister")} />
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-primary">
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        {t("auth.finalStep")}
      </span>
      <h1 className="mt-2.5 font-heading text-2xl sm:text-3xl lg:text-4xl font-black text-ink tracking-tight">
        {t("auth.createPasswordTitle")}
      </h1>
      <p className="mt-3 text-sm sm:text-base text-muted leading-relaxed">{t("auth.createPasswordIntro")}</p>

      {accountAlreadyExists ? (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-5 text-center">
          <p className="text-sm text-ink">{t("auth.accountAlreadyExists")}</p>
          <Link href="/kirish" className="mt-4 inline-block">
            <Button size="lg" className="!h-12 !text-sm font-bold !rounded-xl">
              {t("auth.tabLogin")}
            </Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
          <Input
            type="password"
            autoComplete="new-password"
            label={t("auth.newPassword")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            autoFocus
          />
          <Input
            type="password"
            autoComplete="new-password"
            label={t("auth.confirmPassword")}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (error) setError("");
            }}
            error={error}
          />
          <Button type="submit" size="lg" loading={loading} className="w-full !h-14 sm:!h-16 !text-base font-bold !rounded-2xl">
            {t("auth.createAccountBtn")}
          </Button>
        </form>
      )}

      <div className="mt-10 pt-6 border-t border-line/60 flex items-center justify-center gap-2.5 text-xs sm:text-sm text-muted">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <span>{t("auth.trustBadgeEscrow")}</span>
      </div>
    </div>
  );
}
