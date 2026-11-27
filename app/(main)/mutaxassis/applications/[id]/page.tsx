"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ProposalStatusBadge } from "@/components/shared/StatusBadge";
import { ProposalChat } from "@/components/shared/ProposalChat";
import { contractsService, jobsService, proposalsService } from "@/lib/api";
import type { Contract, Job, Proposal } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

const WITHDRAWABLE = ["yuborilgan", "korib_chiqilmoqda", "suhbat"];

export default function TaklifTafsilotiPage() {
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const [proposal, setProposal] = useState<Proposal | null | undefined>(undefined);
  const [job, setJob] = useState<Job | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    proposalsService
      .get(params.id)
      .then((found) => {
        setProposal(found);
        if (found) {
          return Promise.all([
            jobsService.get(found.jobId),
            contractsService.list(),
          ]).then(([jobData, allContracts]) => {
            setJob(jobData);
            setContract(allContracts.find((c) => c.jobId === found.jobId) ?? null);
          });
        }
      })
      .catch(setLoadError);
  }, [params.id]);

  useEffect(load, [load]);

  async function handleWithdraw() {
    if (!proposal) return;
    setWithdrawing(true);
    try {
      const updated = await proposalsService.withdraw(proposal.id);
      setProposal(updated);
      toast(t("prop.withdrawn"));
      setWithdrawOpen(false);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setWithdrawing(false);
    }
  }

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;
  if (proposal === undefined) return <SkeletonCard />;
  if (proposal === null)
    return (
      <EmptyState
        title={t("common.notFound")}
        description="Ariza topilmadi yoki qaytarib olingan bo'lishi mumkin."
        action={
          <Link href="/mutaxassis/applications">
            <Button size="sm">Barcha arizalar</Button>
          </Link>
        }
      />
    );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Breadcrumb
        items={[
          { label: t("nav.proposals"), href: "/mutaxassis/applications" },
          { label: t("prop.detailTitle") },
        ]}
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ProposalStatusBadge status={proposal.status} />
          <span className="text-2xs text-faint">
            {formatDate(proposal.createdAt, lang)}
          </span>
        </div>
        <h1 className="font-heading text-2xl font-extrabold text-ink">
          {t("prop.detailTitle")}
        </h1>
        {job && (
          <Link
            href={`/bozor/ish-elonlari/${job.id}`}
            className="text-sm font-medium text-primary transition-colors duration-150 hover:text-ink"
          >
            {job.title} →
          </Link>
        )}
      </div>

      <Card padding="lg" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-2xs font-medium uppercase tracking-wide text-faint">
              {t("props.bid")}
            </p>
            <p className="mt-1 font-heading text-lg font-bold text-ink">
              {formatMoney(proposal.bidAmount, lang)}
            </p>
          </div>
          {proposal.estimatedDeliveryDays !== undefined && (
            <div>
              <p className="text-2xs font-medium uppercase tracking-wide text-faint">
                {t("prop.deliveryDays")}
              </p>
              <p className="mt-1 font-heading text-lg font-bold text-ink">
                {proposal.estimatedDeliveryDays} {t("common.days")}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-line pt-4">
          <p className="text-2xs font-medium uppercase tracking-wide text-faint">
            {t("prop.cover")}
          </p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
            {proposal.coverLetter}
          </p>
        </div>

        {proposal.screeningAnswers.length > 0 && (
          <div className="border-t border-line pt-4">
            <p className="text-2xs font-medium uppercase tracking-wide text-faint">
              {t("prop.answers")}
            </p>
            <div className="mt-2 flex flex-col gap-3">
              {proposal.screeningAnswers.map((qa, i) => (
                <div key={i}>
                  <p className="text-xs font-medium text-ink">
                    {i + 1}. {qa.question}
                  </p>
                  <p className="mt-1 text-xs text-muted">{qa.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {proposal.attachedImages.length > 0 && (
          <div className="border-t border-line pt-4">
            <p className="text-2xs font-medium uppercase tracking-wide text-faint">
              {t("prop.attachedTitle")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
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
          </div>
        )}
      </Card>

      {/* Xaridor bilan suhbat — "Suhbatga taklif" endi haqiqiy kanalga olib
          keladi. Yopilgan taklifda tarix faqat o'qish uchun qoladi. */}
      <ProposalChat
        proposalId={proposal.id}
        counterpartName={job?.buyerName ?? ""}
        open={WITHDRAWABLE.includes(proposal.status)}
      />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {WITHDRAWABLE.includes(proposal.status) ? (
          <Button variant="danger" onClick={() => setWithdrawOpen(true)}>
            {t("prop.withdraw")}
          </Button>
        ) : (
          <span />
        )}
        {proposal.status === "yollandi" && contract && (
          <Link href={`/mutaxassis/contracts/${contract.id}`}>
            <Button>{t("props.openContract")}</Button>
          </Link>
        )}
      </div>

      <ConfirmDialog
        open={withdrawOpen}
        title={t("prop.withdrawTitle")}
        description={t("prop.withdrawDesc")}
        confirmLabel={t("prop.withdraw")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={withdrawing}
        onConfirm={handleWithdraw}
        onCancel={() => setWithdrawOpen(false)}
      />
    </div>
  );
}
