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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RatingStars } from "@/components/ui/RatingStars";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { TrustBadge } from "@/components/ui/TrustBadge";
import { useToast } from "@/components/ui/Toast";
import { JobStatusBadge, ProposalStatusBadge } from "@/components/shared/StatusBadge";
import { catalogService, contractsService, jobsService, proposalsService } from "@/lib/api";
import type { Contract, Job, Proposal, Specialist } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

export default function ElonTafsilotiPage() {
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [specialists, setSpecialists] = useState<Map<string, Specialist>>(
    new Map()
  );
  const [contract, setContract] = useState<Contract | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Proposal | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      jobsService.get(params.id).then(async (found) => {
        if (found) return found;
        const myJobs = await jobsService.listMine().catch(() => []);
        return myJobs.find((j) => j.id === params.id) ?? null;
      }),
      catalogService.listSpecialists(),
      /* Bu e'lon bo'yicha ochilgan shartnoma (yollangandan keyin) */
      contractsService.list(),
      proposalsService.listForJob(params.id),
    ])
      .then(async ([foundJob, specialistList, allContracts, list]) => {
        setJob(foundJob);
        const specMap = new Map(specialistList.map((s) => [s.user.id, s]));
        for (const s of specialistList) {
          if (s.user.phone) specMap.set(s.user.phone, s);
        }
        for (const p of list) {
          if (!p.sellerName && !specMap.has(p.sellerId)) {
            try {
              const fetched = await catalogService.getSpecialist(p.sellerId);
              if (fetched) specMap.set(p.sellerId, fetched);
            } catch {}
          }
        }
        setSpecialists(specMap);
        setContract(
          allContracts.find((c) => c.jobId === params.id && c.status !== "bekor_qilingan") ?? null
        );
        setProposals(list);
      })
      .catch(setLoadError);
  }, [params.id]);

  useEffect(load, [load]);

  async function handleInterview(proposal: Proposal) {
    setBusy(true);
    try {
      await proposalsService.setStatus(proposal.id, "suhbat");
      setProposals(await proposalsService.listForJob(params.id));
      toast(t("bprop.interviewSet"));
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setBusy(true);
    try {
      await proposalsService.setStatus(rejectTarget.id, "rad_etildi");
      setProposals(await proposalsService.listForJob(params.id));
      toast(t("bprop.rejected"));
      setRejectTarget(null);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseJob() {
    if (!job) return;
    setBusy(true);
    try {
      const updated = await jobsService.close(job.id);
      setJob(updated);
      toast(t("bjobs.closed"));
      setCloseOpen(false);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (job === undefined) {
    return loadError ? (
      <ErrorState error={loadError} onRetry={load} />
    ) : (
      <SkeletonCard />
    );
  }
  if (job === null)
    return (
      <EmptyState
        title={t("job.notFound")}
        description="E'lon topilmadi yoki o'chirilgan bo'lishi mumkin."
        action={
          <Link href="/xaridor/my-jobs">
            <Button size="sm">Barcha e'lonlarim</Button>
          </Link>
        }
      />
    );

  const visible = proposals.filter((p) => p.status !== "qaytarib_olingan");
  const ACTIONABLE = ["yuborilgan", "korib_chiqilmoqda", "suhbat"];

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: t("nav.myJobs"), href: "/xaridor/my-jobs" },
          { label: job.title },
        ]}
      />
      {/* E'lon sarlavhasi */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{t(`cat.${job.category}`)}</Badge>
          <JobStatusBadge status={job.status} />
          <span className="text-2xs text-faint">
            {t("jobs.postedAt")}: {formatDate(job.postedAt, lang)}
          </span>
          {job.status === "ochiq" && (
            <button
              type="button"
              onClick={() => setCloseOpen(true)}
              className="ml-auto rounded-btn border border-line px-2.5 py-1.5 text-2xs font-medium text-muted transition-colors duration-150 hover:text-danger"
            >
              {t("bjobs.close")}
            </button>
          )}
        </div>
        <h1 className="font-heading text-2xl font-extrabold text-ink">
          {job.title}
        </h1>
        <p className="text-sm text-muted">
          {t("job.budget")}:{" "}
          <span className="font-medium text-ink">
            {formatMoney(job.budgetMin, lang)} – {formatMoney(job.budgetMax, lang)}
          </span>
        </p>
        {/* `formatDate` noto'g'ri sanada bo'sh satr qaytaradi — `new Date(...)
            .toISOString()` esa RangeError tashlab, butun sahifani yiqitardi. */}
        {job.deadline && formatDate(job.deadline, lang) && (
          <p className="text-sm text-muted">
            {t("job.deadline")}:{" "}
            <span className="font-medium text-ink">
              {formatDate(job.deadline, lang)}
            </span>
          </p>
        )}
      </div>

      <Card padding="lg">
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
          {job.description}
        </p>
        {job.attachedImages && job.attachedImages.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
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
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {job.skillsRequired.map((skill) => (
            <Badge key={skill} tone="primary">
              {skill}
            </Badge>
          ))}
        </div>
      </Card>

      {/* Kelgan takliflar */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">
          {t("bjob.proposalsTitle")}{" "}
          <span className="text-muted">({visible.length})</span>
        </h2>

        {visible.length === 0 ? (
          <EmptyState
            title={t("bjob.noProposals")}
            description="Bu e'longa hali arizalar kelib tushmadi. Mutaxassislarni o'zingiz qidirib, to'g'ridan-to'g'ri taklif yuborishingiz mumkin."
            action={
              <Link href="/xaridor/mutaxassislar">
                <Button size="sm">Mutaxassislarni ko'rish</Button>
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {visible.map((proposal) => {
              const spec = specialists.get(proposal.sellerId);
              const specialistName =
                proposal.sellerName?.trim() ||
                (spec?.user?.fullName && spec.user.fullName !== "—"
                  ? spec.user.fullName
                  : "Mutaxassis");
              const actionable =
                job.status === "ochiq" && ACTIONABLE.includes(proposal.status);
              const daysLeft = job.deadline
                ? Math.ceil((new Date(job.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              const isLate =
                daysLeft !== null &&
                daysLeft > 0 &&
                proposal.estimatedDeliveryDays !== undefined &&
                proposal.estimatedDeliveryDays > daysLeft;

              return (
                <Card key={proposal.id} padding="lg" className="flex flex-col gap-4">
                  {/* Mutaxassis sarlavhasi */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Link
                      href={`/bozor/mutaxassis/${proposal.sellerId}`}
                      className="group flex items-center gap-3"
                    >
                      <Avatar name={specialistName} />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink transition-colors duration-150 group-hover:text-primary">
                            {specialistName}
                          </span>
                          {spec && <TrustBadge badge={spec.profile.badge} />}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
                          {spec && spec.profile.reviewCount > 0 ? (
                            <RatingStars value={spec.profile.rating} showValue />
                          ) : (
                            <span className="text-muted font-normal">Yangi mutaxassis</span>
                          )}
                          <span>
                            {spec ? spec.profile.completedContracts : 0}{" "}
                            {t("profile.completedContracts")}
                          </span>
                        </div>
                      </div>
                    </Link>
                    <div className="flex flex-col items-end gap-1">
                      <ProposalStatusBadge status={proposal.status} />
                      <span className="text-2xs text-faint">
                        {formatDate(proposal.createdAt, lang)}
                      </span>
                    </div>
                  </div>

                  {/* Narx va muddat */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-input border border-line bg-surface p-3">
                    <div>
                      <span className="text-xs text-muted">{t("props.bid")}</span>
                      <div className="flex items-center gap-2">
                        <p className="font-heading text-base font-bold text-ink">
                          {formatMoney(proposal.bidAmount, lang)}
                        </p>
                        {proposal.bidAmount > job.budgetMax && (
                          <Badge tone="warning" className="text-2xs">
                            Byudjetdan yuqori
                          </Badge>
                        )}
                      </div>
                    </div>
                    {proposal.estimatedDeliveryDays !== undefined && (
                      <div className="text-right">
                        <span className="text-xs text-muted">{t("prop.deliveryDays")}</span>
                        <div className="flex items-center justify-end gap-2">
                          {isLate && (
                            <Badge tone="danger" className="text-2xs">
                              Muddatdan kech
                            </Badge>
                          )}
                          <p className="font-heading text-base font-bold text-ink">
                            {proposal.estimatedDeliveryDays} {t("common.days")}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Qoplama xat */}
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
                    {proposal.coverLetter}
                  </p>

                  {/* Skrining javoblari */}
                  {proposal.screeningAnswers.length > 0 && (
                    <div className="border-t border-line pt-3">
                      <p className="text-2xs font-medium uppercase tracking-wide text-faint">
                        {t("prop.answers")}
                      </p>
                      <div className="mt-2 flex flex-col gap-2">
                        {proposal.screeningAnswers.map((qa, i) => (
                          <div key={i}>
                            <p className="text-xs font-medium text-ink">
                              {i + 1}. {qa.question}
                            </p>
                            <p className="mt-0.5 text-xs text-muted">{qa.answer}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Portfolio rasmlari */}
                  {proposal.attachedImages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {proposal.attachedImages.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={src}
                          alt={t("a11y.portfolioImage").replace("{n}", String(i + 1))}
                          className="h-16 w-24 rounded-input border border-line object-cover"
                        />
                      ))}
                    </div>
                  )}

                  {/* Yollangan taklif → shartnoma */}
                  {proposal.status === "yollandi" && contract && (
                    <div className="flex justify-end border-t border-line pt-4">
                      <Link href={`/xaridor/contracts/${contract.id}`}>
                        <Button size="sm">{t("props.openContract")}</Button>
                      </Link>
                    </div>
                  )}

                  {/* Amallar */}
                  {actionable && (
                    <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setRejectTarget(proposal)}
                        className="text-danger hover:text-danger"
                      >
                        {t("bprop.reject")}
                      </Button>
                      <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
                        {proposal.status !== "suhbat" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleInterview(proposal)}
                          >
                            {t("bprop.interview")}
                          </Button>
                        )}
                        {/* Suhbat: faqat bosqichlar va shartnoma orqali kelishuv */}
                        <Link
                          href={`/xaridor/my-jobs/${job.id}/yollash/${proposal.id}`}
                        >
                          <Button size="sm" disabled={busy} className="w-full">
                            {t("bprop.hire")}
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Rad etish modali */}
      <ConfirmDialog
        open={!!rejectTarget}
        title={t("bprop.rejectTitle")}
        description={t("bprop.rejectDesc")}
        confirmLabel={t("bprop.reject")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={busy}
        onConfirm={handleReject}
        onCancel={() => setRejectTarget(null)}
      />

      {/* E'lonni yopish */}
      <ConfirmDialog
        open={closeOpen}
        title={t("bjobs.closeTitle")}
        description={t("bjobs.closeDesc")}
        confirmLabel={t("bjobs.close")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={busy}
        onConfirm={handleCloseJob}
        onCancel={() => setCloseOpen(false)}
      />
    </div>
  );
}
