"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { RatingStars } from "@/components/ui/RatingStars";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { JobStatusBadge } from "@/components/shared/StatusBadge";
import { jobsService, proposalsService, savedService } from "@/lib/api";
import type { Job } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

export default function IshEloniPage() {
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [alreadySent, setAlreadySent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [buyerJobsCount, setBuyerJobsCount] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      jobsService.get(params.id),
      proposalsService.listMine(),
      savedService.listJobIds(),
    ])
      .then(([found, proposals, ids]) => {
        setJob(found);
        setAlreadySent(
          proposals.some(
            (p) => p.jobId === params.id && p.status !== "qaytarib_olingan"
          )
        );
        setSaved(ids.includes(params.id));
        if (found) {
          return jobsService.list().then((all) =>
            setBuyerJobsCount(all.filter((j) => j.buyerId === found.buyerId).length)
          );
        }
      })
      .catch(setLoadError);
  }, [params.id]);

  useEffect(load, [load]);

  async function handleToggleSave() {
    const ids = await savedService.toggleJob(params.id);
    setSaved(ids.includes(params.id));
  }

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;
  if (job === undefined) return <SkeletonCard />;
  if (job === null)
    return (
      <EmptyState
        title={t("job.notFound")}
        description="Ushbu ish e'loni mavjud emas yoki muddati tugagan bo'lishi mumkin."
        action={
          <Link href="/bozor?tab=jobs">
            <Button size="sm">Barcha ishlarni ko'rish</Button>
          </Link>
        }
      />
    );

  const canApply = job.status === "ochiq" && !alreadySent;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: t("nav.jobs"), href: "/bozor?tab=jobs" },
          { label: job.title },
        ]}
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{t(`cat.${job.category}`)}</Badge>
          <JobStatusBadge status={job.status} />
          <span className="text-2xs text-faint">
            {t("jobs.postedAt")}: {formatDate(job.postedAt, lang)}
          </span>
          <button
            type="button"
            onClick={handleToggleSave}
            aria-label={saved ? t("jobs.unsave") : t("jobs.save")}
            aria-pressed={saved}
            className={`ml-auto flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-2xs font-medium transition-colors duration-150 ${
              saved ? "text-primary" : "text-muted hover:text-ink"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill={saved ? "currentColor" : "none"} aria-hidden="true">
              <path d="M5.5 3h9a.5.5 0 0 1 .5.5V17l-5-3.5L5 17V3.5a.5.5 0 0 1 .5-.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            {saved ? t("jobs.tabSaved") : t("jobs.save")}
          </button>
        </div>
        <h1 className="font-heading text-2xl font-extrabold text-ink">
          {job.title}
        </h1>
      </div>

      <div className="rounded-xl border border-success/20 bg-success/5 p-4 text-xs text-muted">
        <div className="flex items-start gap-2.5">
          <span className="text-base">🛡️</span>
          <div>
            <p className="font-semibold text-ink">
              {lang === "ru" ? "100% Escrow kafolati va xavfsiz bitim" : lang === "en" ? "100% Escrow Guarantee & Safe Deal" : "100% Escrow kafolati va xavfsiz bitim"}
            </p>
            <p className="mt-0.5 leading-relaxed text-muted">
              {lang === "ru"
                ? "Заказчик замораживает средства на Escrow счете до полного выполнения работы. Ваши выплаты и авторские права защищены."
                : lang === "en"
                ? "The employer funds the Escrow deposit before work begins. Your payment and deliverables are fully secured."
                : "Buyurtmachi mablag'ni Escrow hisobida muzlatib qo'yadi. Ish to'liq topshirilgunga qadar to'lovingiz kafolatlangan va xavfsiz saqlanadi."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card padding="lg">
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
              {job.description}
            </p>

            {job.attachedImages && job.attachedImages.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {job.attachedImages.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt={t("a11y.image").replace("{n}", String(i + 1))}
                    className="h-20 w-20 rounded-input border border-line object-cover"
                  />
                ))}
              </div>
            )}

            <div className="mt-6 border-t border-line pt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-faint">
                {t("job.skills")}
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {job.skillsRequired.map((skill) => (
                  <Badge key={skill} tone="primary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>

            {job.screeningQuestions.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-faint">
                  {t("job.screening")}
                </h3>
                <ol className="mt-2 flex list-inside list-decimal flex-col gap-1.5 text-sm text-muted">
                  {job.screeningQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
        </div>

        {/* Yon panel */}
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wide text-faint">
                {t("job.budget")}
              </p>
              <p className="mt-1 font-heading text-lg font-bold text-ink">
                {formatMoney(job.budgetMin, lang)} –{" "}
                {formatMoney(job.budgetMax, lang)}
              </p>
            </div>
            {job.deadline && (
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-faint">
                  {t("job.deadline")}
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {formatDate(new Date(job.deadline).toISOString(), lang)}
                </p>
              </div>
            )}
            <p className="text-xs text-muted">
              {job.proposalsCount} {t("jobs.proposalsCount")}
            </p>

            {canApply ? (
              <Link href={`/bozor/ish-elonlari/${job.id}/taklif`}>
                <Button className="w-full">{t("job.sendProposal")}</Button>
              </Link>
            ) : (
              <p
                className={`rounded-input border p-3 text-xs ${
                  alreadySent
                    ? "border-success/30 bg-success/5 text-muted"
                    : "border-line bg-surface text-faint"
                }`}
              >
                {alreadySent ? t("job.alreadySent") : t("job.closedNote")}
              </p>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h3 className="text-2xs font-medium uppercase tracking-wide text-faint">
              {t("job.aboutBuyer")}
            </h3>
            <div className="flex items-center gap-3">
              <Avatar name={job.buyerName} />
              <div>
                <p className="text-sm font-medium text-ink">{job.buyerName}</p>
                {job.buyerRating > 0 ? (
                  <RatingStars value={job.buyerRating} showValue />
                ) : (
                  <Badge>{t("jobs.newBuyer")}</Badge>
                )}
              </div>
            </div>
            <p className="text-2xs text-faint">
              {buyerJobsCount} {t("jobs.buyerJobs")}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
