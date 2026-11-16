"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { authService, sellerApplicationService, usersService } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { LIMITS } from "@/lib/validate";
import type { VerificationStatus } from "@/lib/types";

interface Errors {
  fullName?: string;
  legalName?: string;
  displayName?: string;
  description?: string;
}

type CurrentApplication = {
  status: VerificationStatus;
  legalName?: string;
  displayName?: string;
  description?: string;
  rejectionReason?: string;
  submittedAt?: string;
} | null;

/**
 * Bosqich 23 — sahifa ENDI to'liq holat-mashinasi: yuklanishda joriy
 * ariza (`sellerApplicationService.getCurrent()`) SO'RALADI va aynan
 * BITTA holat ko'rsatiladi — forma faqat NO_APPLICATION/REJECTED (qayta
 * ariza) holatlarida ko'rinadi. Ilgari forma HAR DOIM ko'rsatilardi,
 * joriy holatdan qat'i nazar — PENDING/APPROVED foydalanuvchi qayta
 * yuborsa backend 409 (`SELLER_APPLICATION_ALREADY_PENDING`/`BAD_STATE`)
 * qaytarardi va faqat birinchisi ushlanardi, ikkinchisi xom xato sifatida
 * ko'rinardi.
 */
export default function RoyxatPage() {
  const { t, lang } = useT();
  const router = useRouter();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [application, setApplication] = useState<CurrentApplication>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([usersService.getCurrent(), sellerApplicationService.getCurrent()])
      .then(([user, app]) => {
        if (user?.fullName) {
          setFullName(user.fullName);
          setDisplayName((prev) => prev || user.fullName);
        }
        if (app?.status === "rad_etilgan") {
          // Qayta ariza — avvalgi qiymatlarni qulaylik uchun oldindan to'ldiramiz.
          if (app.legalName) setLegalName(app.legalName);
          if (app.displayName) setDisplayName(app.displayName);
          if (app.description) setDescription(app.description);
        }
        setApplication(app);
        setLoaded(true);
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  function validate(): boolean {
    const next: Errors = {};
    if (!fullName.trim()) next.fullName = t("onboard.errName");
    const legal = legalName.trim();
    if (!legal) next.legalName = t("onboard.errName");
    else if (legal.length < 2) next.legalName = t("onboard.errNameShort");
    else if (legal.length > LIMITS.name) next.legalName = t("onboard.errNameLong");
    const display = displayName.trim();
    if (!display) next.displayName = t("onboard.errName");
    else if (display.length < 2) next.displayName = t("onboard.errNameShort");
    else if (display.length > LIMITS.name) next.displayName = t("onboard.errNameLong");
    if (description.trim().length > 0 && description.trim().length < 20) next.description = t("onboard.errBio");
    if (description.trim().length > LIMITS.bio) next.description = t("onboard.errBioLong");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      await usersService.updateName(fullName.trim());
      // `PATCH /me/profile` `profileDone=true`ni serverga yozadi, lekin
      // javobni qaytarmaydi (`updateName` — `void`) — lokal sessiya
      // snapshot'i shu sababli o'zgarmasdi qolib, `/mutaxassis`ga
      // o'tishda layout guard eski `profileDone=false`ni ko'rib yana
      // shu sahifaga qaytarib yuborishi mumkin edi. Aniq sinxronlash.
      await authService.refresh();
      await sellerApplicationService.submit({
        legalName: legalName.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined,
      });
      toast(t("onboard.applicationSubmitted"));
      // Qo'lda holat qurish EMAS — bitta haqiqat manbaidan qayta o'qiymiz.
      const fresh = await sellerApplicationService.getCurrent();
      setApplication(fresh);
    } catch (err) {
      toast(mapApplicationError(err, t), "error");
      // Ko'p-tab/poyga holati: joriy holat serverda kutilganimizdan farq
      // qilgan bo'lishi mumkin (masalan boshqa tabda allaqachon yuborilgan) —
      // sahifa o'zini haqiqiy holatga moslab qayta chizadi.
      sellerApplicationService.getCurrent().then(setApplication).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;
  if (!loaded) {
    return (
      <Card padding="lg">
        <SkeletonCard />
      </Card>
    );
  }

  // ── PENDING — forma UMUMAN ko'rsatilmaydi, submit tugmasi yo'q ──────────
  if (application?.status === "korib_chiqilmoqda") {
    return (
      <Card padding="lg">
        <StatusIcon tone="warning" />
        <h1 className="mt-4 font-heading text-xl font-bold text-ink">{t("dash.applicationPending")}</h1>
        <p className="mt-2 text-sm text-muted">{t("dash.applicationPendingDesc")}</p>
        {application.submittedAt && (
          <p className="mt-4 text-xs text-faint">
            {t("onboard.submittedOn")} {formatDate(application.submittedAt, lang)}
          </p>
        )}
      </Card>
    );
  }

  // ── APPROVED — yangi ariza yuborish IMKONSIZ, dashboard'ga CTA ─────────
  if (application?.status === "tasdiqlangan") {
    return (
      <Card padding="lg">
        <StatusIcon tone="success" />
        <h1 className="mt-4 font-heading text-xl font-bold text-ink">{t("onboard.applicationApproved")}</h1>
        <p className="mt-2 text-sm text-muted">{t("onboard.applicationApprovedDesc")}</p>
        <Button size="lg" className="mt-6 w-full" onClick={() => router.push("/mutaxassis")}>
          {t("onboard.goToDashboard")}
        </Button>
      </Card>
    );
  }

  // ── NO_APPLICATION yoki REJECTED — forma ko'rsatiladi (REJECTED = qayta ariza) ──
  const isReapply = application?.status === "rad_etilgan";

  return (
    <Card padding="lg">
      {isReapply && (
        <div className="mb-6 rounded-card border border-danger/30 bg-danger/5 p-4">
          <p className="font-heading text-sm font-bold text-ink">{t("dash.applicationRejected")}</p>
          {application?.rejectionReason ? (
            <p className="mt-1 text-xs text-muted">
              <span className="font-semibold text-ink">{t("onboard.rejectionReasonLabel")}</span>{" "}
              {application.rejectionReason}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">{t("dash.applicationRejectedDesc")}</p>
          )}
        </div>
      )}

      <h1 className="font-heading text-xl font-bold text-ink">{t("onboard.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("onboard.applicationSubtitle")}</p>

      {/* Google bilan muvaffaqiyatli kirilganini tasdiqlovchi status kartochkasi */}
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-line bg-card/60 p-3.5 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 font-bold">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted font-medium">{t("onboard.accountBadge") || "Tizimga kirilgan hisob"}:</p>
            <p className="truncate text-sm font-bold text-ink">{fullName || displayName || "Foydalanuvchi"}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600">
          Google ✓
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Input
          label={t("onboard.fullName")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={t("onboard.fullNamePh")}
          error={errors.fullName}
        />
        <Input
          label={t("onboard.legalName")}
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder={t("onboard.fullNamePh")}
          maxLength={LIMITS.name}
          error={errors.legalName}
        />
        <Input
          label={t("onboard.displayName")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("onboard.displayNamePh")}
          maxLength={LIMITS.name}
          error={errors.displayName}
        />
        <Textarea
          label={t("onboard.bio")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("onboard.bioPh")}
          error={errors.description}
          maxLength={LIMITS.bio}
          hint={`${description.length}/${LIMITS.bio}`}
        />

        <Button type="submit" size="lg" loading={submitting} className="mt-2 w-full">
          {isReapply ? t("onboard.reapplyBtn") : t("onboard.submitApplication")}
        </Button>
      </form>

      {/* Rolni almashtirish yoki xaridor rejimiga o'tish imkoniyati */}
      <div className="mt-6 pt-4 border-t border-line text-center">
        <p className="text-xs text-muted mb-2">
          Xizmat buyurtma qilmoqchi yoki mutaxassis yollamoqchimisiz?
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await authService.chooseRole("xaridor");
                router.push("/xaridor");
              } catch {
                router.push("/rol-tanlash");
              }
            }}
            className="text-xs font-semibold text-primary hover:underline py-1 px-2"
          >
            {t("onboard.switchToBuyer") || "Xaridor (Buyurtmachi) sifatida davom etish"} →
          </button>
          <span className="hidden sm:inline text-muted">•</span>
          <button
            type="button"
            onClick={() => router.push("/rol-tanlash")}
            className="text-xs font-semibold text-muted hover:text-ink py-1 px-2"
          >
            {t("onboard.changeRole") || "Rolni o'zgartirish"}
          </button>
        </div>
      </div>
    </Card>
  );
}

function StatusIcon({ tone }: { tone: "warning" | "success" }) {
  const cls = tone === "success" ? "bg-success/10 text-success-deep" : "bg-warning/10 text-warning-deep";
  return (
    <div className={`flex h-12 w-12 items-center justify-center rounded-full ${cls}`} aria-hidden="true">
      {tone === "success" ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      )}
    </div>
  );
}

/** Bosqich 23 — backend `DomainError.code` (xom, `ApiError.message`) bo'yicha
    aniq matn. Bu FAQAT poyga holati uchun (multi-tab/stale form) — oddiy
    navigatsiyada sahifa joriy holatni oldindan yuklab forma ko'rsatmaydi,
    shuning uchun bu xatolar odatiy oqimda umuman chaqirilmaydi. */
function mapApplicationError(err: unknown, t: (key: string) => string): string {
  const code = err instanceof ApiError ? err.message : "";
  switch (code) {
    case "SELLER_APPLICATION_ALREADY_PENDING":
      return t("onboard.alreadyPending");
    case "BAD_STATE":
      return t("onboard.stateChanged");
    case "ACCOUNT_BLOCKED":
    case "ACCOUNT_SUSPENDED":
      return t("auth.errAccountBlocked");
    default:
      return t("common.error");
  }
}
