"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authService } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CountryPhoneInput } from "@/components/shared/CountryPhoneInput";

/** Bosqich 21 — telefon + PAROL, SMS ISHTIROK ETMAYDI (asosiy invariant:
    oddiy login uchun SMS soni = 0). Noto'g'ri telefon va noto'g'ri parol
    bir xil generic `INVALID_CREDENTIALS`ga tushadi (enumeration-safe) —
    qaysi biri xato ekanini frontend ham bilmaydi/ko'rsatmaydi. */
export default function KirishPage() {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();

  const [phone, setPhone] = useState("+998");
  const [phoneValid, setPhoneValid] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [inactivityNotice, setInactivityNotice] = useState(false);

  useEffect(() => {
    const titles: Record<string, string> = {
      uz: "Kirish — Bobololadono",
      ru: "Вход — Bobololadono",
      en: "Log in — Bobololadono",
    };
    document.title = titles[t("common.lang") || "uz"] || titles.uz;
  }, [t]);

  /* Sessiya tekshiruvi: allaqachon kirgan foydalanuvchi o'z kabinetiga qaytariladi */
  useEffect(() => {
    let active = true;

    async function checkAuth() {
      // 1. Agar foydalanuvchi harakatsizlik sababli chiqarilgan bo'lsa,
      // darhol ogohlantirishni ko'rsatamiz va avtomatik refresh bilan qayta kiritib yubormaymiz.
      if (typeof window !== "undefined") {
        const search = window.location.search;
        const params = new URLSearchParams(search);
        const isInactive =
          params.get("reason") === "inactivity" ||
          window.sessionStorage.getItem("bd_inactivity_logout") === "1";
        if (isInactive) {
          setInactivityNotice(true);
          try {
            window.sessionStorage.removeItem("bd_inactivity_logout");
          } catch {}
          setChecking(false);
          return;
        }
      }

      // 2. Oddiy holatda avtorizatsiyani tekshirish (allaqachon kirgan bo'lsa darhol kabinetga)
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
        // Tarmoq xatosi bo'lsa ham pastga tushadi
      }

      if (!active) return;

      // 3. Faqat anonim foydalanuvchilar uchun qo'shimcha parametrlar tekshiruvi
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        // Landing'dan "?tab=register" bilan kelgan anonim foydalanuvchini ro'yxatdan o'tishga yo'naltirish
        if (params.get("tab") === "register") {
          const role = params.get("role");
          const cat = params.get("cat");
          const targetParams = new URLSearchParams();
          if (role) targetParams.set("role", role);
          if (cat) targetParams.set("cat", cat);
          const q = targetParams.toString();
          router.replace(q ? `/royxatdan-otish?${q}` : "/royxatdan-otish");
          return;
        }

        // "Hisob allaqachon mavjud" CTA'dan kelgan bo'lsa telefon oldindan to'ldiriladi.
        const prefill = window.sessionStorage.getItem("bd_prefill_phone");
        if (prefill) {
          setPhone(prefill);
          setPhoneValid(true);
          window.sessionStorage.removeItem("bd_prefill_phone");
        }
      }

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
      const session = await authService.login(phone.trim(), password);
      const dest = !session.role
        ? "/rol-tanlash"
        : session.role === "xaridor"
          ? "/xaridor"
          : session.profileDone
            ? "/mutaxassis"
            : "/mutaxassis/settings/royxat";
      router.push(dest);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(
        code === "RATE_LIMITED"
          ? t("auth.errRateLimited")
          : code === "ACCOUNT_BLOCKED" || code === "ACCOUNT_SUSPENDED"
            ? t("auth.errAccountBlocked")
            : t("auth.errCredentials"),
      );
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
          <svg
            className="h-8 w-8 animate-spin text-primary"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
      <Link href="/" className="mb-6 inline-flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Bobololadono" className="h-9 w-auto object-contain" />
        <span className="font-heading font-black text-lg tracking-tight text-ink">Bobololadono</span>
      </Link>
      <h1 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-black text-ink tracking-tight">
        {t("auth.loginTitle")}
      </h1>
      <p className="mt-2.5 text-sm sm:text-base text-muted leading-relaxed">{t("auth.loginSubtitle")}</p>

      {inactivityNotice && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-ink"
        >
          <svg
            className="h-5 w-5 shrink-0 text-amber-600 mt-0.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <p className="font-semibold text-amber-900">
              {t("auth.inactivityLogoutTitle")}
            </p>
            <p className="mt-0.5 text-xs sm:text-sm text-amber-800">
              {t("auth.inactivityLogout")}
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
        <CountryPhoneInput
          id="login-phone"
          value={phone}
          label={t("auth.regPhone")}
          onChange={(fullNum, isValid) => {
            setPhone(fullNum);
            setPhoneValid(isValid);
            if (error) setError("");
          }}
        />
        <Input
          type="password"
          autoComplete="current-password"
          label={t("auth.password")}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError("");
          }}
          error={error}
        />
        <Button
          type="submit"
          size="lg"
          loading={loading}
          disabled={loading || !password}
          className="w-full !h-14 sm:!h-16 !text-base font-bold !rounded-2xl"
        >
          {t("auth.loginBtn")}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link href="/parolni-unutdim" className="font-semibold text-primary-deep hover:underline">
          {t("auth.forgotPassword")}
        </Link>
      </p>

      <p className="mt-6 text-center text-sm text-muted">
        {t("auth.noAccount")}{" "}
        <Link href="/royxatdan-otish" className="font-semibold text-primary-deep hover:underline">
          {t("auth.tabRegister")}
        </Link>
      </p>

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
