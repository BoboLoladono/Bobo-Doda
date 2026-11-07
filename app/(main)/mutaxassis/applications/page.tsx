"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  OfferStatusBadge,
  ProposalStatusBadge,
} from "@/components/shared/StatusBadge";
import { jobsService, offersService, proposalsService } from "@/lib/api";
import type { Job, Offer, Proposal, ProposalStatus } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

const STATUSES: ProposalStatus[] = [
  "yuborilgan",
  "korib_chiqilmoqda",
  "suhbat",
  "yollandi",
  "rad_etildi",
  "qaytarib_olingan",
];

type Filter = "all" | ProposalStatus;

export default function TakliflarimPage() {
  const { t, lang } = useT();
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [withdrawTarget, setWithdrawTarget] = useState<Proposal | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      proposalsService.listMine(),
      jobsService.list(),
      offersService.listIncoming(),
    ])
      .then(async ([proposalList, jobList, offerList]) => {
        setProposals(proposalList);
        const map = new Map(jobList.map((j) => [j.id, j]));
        for (const p of proposalList) {
          if (!map.has(p.jobId)) {
            try {
              const found = await jobsService.get(p.jobId);
              if (found) map.set(p.jobId, found);
            } catch {}
          }
        }
        setJobs(Array.from(map.values()));
        setOffers(offerList);
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  async function handleConfirmWithdraw() {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      await proposalsService.withdraw(withdrawTarget.id);
      toast(t("prop.withdrawn") || "Ariza bekor qilindi");
      setWithdrawTarget(null);
      load();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setWithdrawing(false);
    }
  }

  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const filtered =
    proposals?.filter((p) => filter === "all" || p.status === filter) ?? [];

  function openProposal(proposal: Proposal) {
    router.push(`/mutaxassis/applications/${proposal.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-extrabold text-ink">
        {t("props.title")}
      </h1>

      {loadError ? (
        <ErrorState error={loadError} onRetry={load} />
      ) : (
        <>
      {/* Buyurtmachilardan kelgan to'g'ridan-to'g'ri takliflar */}
      {offers.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold text-ink">
              {t("soffers.title")}{" "}
              <span className="text-muted">({offers.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-muted">{t("soffers.hint")}</p>
          </div>
          <div className="flex flex-col gap-3">
            {offers.map((offer) => (
              <Link
                key={offer.id}
                href={`/mutaxassis/applications/kelgan/${offer.id}`}
                className="block"
              >
                <Card hoverable className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={offer.buyerName} size="sm" />
                      <span className="text-sm font-medium text-ink">
                        {offer.buyerName}
                      </span>
                    </span>
                    <OfferStatusBadge status={offer.status} />
                  </div>
                  <p className="text-sm font-medium text-ink">{offer.title}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="font-medium text-ink">
                      {formatMoney(offer.budget, lang)}
                    </span>
                    <span className="text-faint">
                      {formatDate(offer.createdAt, lang)}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Tabs
        value={filter}
        onChange={(value) => setFilter(value as Filter)}
        items={[
          { value: "all", label: t("props.filterAll"), count: proposals?.length },
          ...STATUSES.map((status) => ({
            value: status,
            label: t(`pstatus.${status}`),
            count: proposals?.filter((p) => p.status === status).length,
          })),
        ]}
      />

      {!proposals ? (
        <SkeletonCard />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={proposals.length === 0 ? t("props.empty") : t("props.emptyFiltered")}
          action={
            proposals.length === 0 ? (
              <Link href="/bozor?tab=jobs">
                <Button>{t("props.emptyCta")}</Button>
              </Link>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                Barcha arizalarni ko'rish
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((proposal) => {
            const job = jobById.get(proposal.jobId);
            const hired = proposal.status === "yollandi";
            const canWithdraw = ["yuborilgan", "korib_chiqilmoqda", "suhbat"].includes(proposal.status);
            return (
              <Card key={proposal.id} hoverable className="flex flex-col gap-3">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openProposal(proposal)}
                  onKeyDown={(e) => e.key === "Enter" && openProposal(proposal)}
                  className="flex flex-col gap-3 cursor-pointer text-left focus:outline-none"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-heading text-sm font-bold text-ink hover:text-primary transition-colors">
                      {job?.title ?? (proposal as unknown as { jobTitle?: string }).jobTitle ?? "Ish e'loni"}
                    </h3>
                    <ProposalStatusBadge status={proposal.status} />
                  </div>
                  <p className="line-clamp-2 text-xs text-muted">
                    {proposal.coverLetter}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-muted">
                      {t("props.bid")}:{" "}
                      <span className="font-medium text-ink">
                        {formatMoney(proposal.bidAmount, lang)}
                      </span>
                    </span>
                    <span className="text-faint">
                      {formatDate(proposal.createdAt, lang)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {canWithdraw && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="text-2xs text-danger hover:border-danger hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWithdrawTarget(proposal);
                        }}
                      >
                        {t("prop.withdraw") || "Bekor qilish"}
                      </Button>
                    )}
                    {hired && (
                      <Link href={`/mutaxassis/contracts`}>
                        <Button variant="ghost" size="sm" className="text-xs text-primary">
                          {t("props.openContract")} →
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
        </>
      )}

      <ConfirmDialog
        open={!!withdrawTarget}
        title={t("prop.withdrawTitle") || "Arizani qaytarib olasizmi?"}
        description={t("prop.withdrawDesc") || "Ariza bekor qilinadi va e'longa qaytadan ariza yuborishingiz mumkin bo'ladi."}
        confirmLabel={t("prop.withdraw") || "Bekor qilish"}
        cancelLabel={t("common.cancel") || "Ortga"}
        variant="danger"
        loading={withdrawing}
        onConfirm={handleConfirmWithdraw}
        onCancel={() => setWithdrawTarget(null)}
      />
    </div>
  );
}
