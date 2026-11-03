"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authService } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { CountryPhoneInput } from "@/components/shared/CountryPhoneInput";
import { stashDevOtp } from "@/lib/api/dev-otp-bridge";

/** Bosqich 21 — parolni tiklash: telefon → SMS OTP → yangi parol. Javob
    har doim generic `{sent:true}` (enumeration-safe — hisob mavjud/mavjud
    emasligidan qat'iy nazar bir xil), lekin backend haqiqiy SMS'ni FAQAT
    hisob mavjud bo'lsa yuboradi (SMS xarajatini tejash). */
export default function ParolniUnutdimPage() {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();

  const [phone, setPhone] = useState("+998");
  const [phoneValid, setPhoneValid] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const titles: Record<string, string> = {
      uz: "Parolni tiklash — Bobololadono",
      ru: "Восстановление пароля — Bobololadono",
      en: "Reset Password — Bobololadono",
    };
    document.title = titles[t("common.lang") || "uz"] || titles.uz;
  }, [t]);

  useEffect(() => {
    let active = true;

    async function checkAuth() {
      try {
        const session = await authService.refresh();
        if (!active) return;
        if (session) {
          let dest = "/rol-tanlash";
          if (session.role === "xaridor") dest = "/xaridor";
          else if (session.role === "mutaxassis") dest = session.profileDone ? "/mutaxassis" : "/mutaxassis/settings/royxat";
          if (pathname !== dest) router.replace(dest);
          return;
        }
      } catch {
        // Tarmoq xatosi
      }

      if (!active) return;
      setChecking(false);
    }

    void checkAuth();

    return () => {
      active = false;
    };
  }, [router, pathname]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!phoneValid) {
      setError(t("auth.errPhone"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await authService.requestPasswordResetOtp(phone.trim());
      stashDevOtp(res.devOtp);
      window.sessionStorage.setItem("bd_reset_otp_phone", phone.trim());
      router.push("/parolni-unutdim/tasdiqlash");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(code === "RATE_LIMITED" ? t("auth.errRateLimited") : t("common.error"));
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="rounded-3xl sm:rounded-[32px] border border-line/80 bg-card p-7 sm:p-12 lg:p-14 shadow-2xl shadow-black/5 flex flex-col items-center justify-center min-h-[380px]">
        <div className="mb-6 inline-flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Bobololadono" className="h-9 w-auto object-contain" />
          <span className="font-heading font-black text-lg tracking-tight text-ink">Bobololadono</span>
        </div>
        <div className="my-auto flex flex-col items-center justify-center gap-3 py-8" role="status" aria-live="polite">
          <svg className="h-8 w-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <p className="text-sm font-medium text-muted">{t("common.loading") || "Yuklanmoqda..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl sm:rounded-[32px] border border-line/80 bg-card p-7 sm:p-12 lg:p-14 shadow-2xl shadow-black/5">
      <div className="mb-5">
        <BackButton href="/kirish" label={t("auth.backToLogin")} />
      </div>
      <h1 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-black text-ink tracking-tight">
        {t("auth.resetTitle")}
      </h1>
      <p className="mt-2.5 text-sm sm:text-base text-muted leading-relaxed">{t("auth.resetSubtitle")}</p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
        <CountryPhoneInput
          id="reset-otp-phone"
          value={phone}
          label={t("auth.regPhone")}
          error={error}
          onChange={(fullNum, isValid) => {
            setPhone(fullNum);
            setPhoneValid(isValid);
            if (error) setError("");
          }}
        />
        <Button
          type="submit"
          size="lg"
          loading={loading}
          disabled={loading || !phoneValid}
          className="w-full !h-14 sm:!h-16 !text-base font-bold !rounded-2xl"
        >
          {t("auth.sendCode")}
        </Button>
      </form>

      <div className="mt-8 flex items-center justify-center gap-2.5 text-xs sm:text-sm text-muted">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <span>{t("auth.secureBadge")}</span>
      </div>
    </div>
  );
}
