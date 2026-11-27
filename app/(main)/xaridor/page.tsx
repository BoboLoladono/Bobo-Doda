"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import {
  ContractStatusBadge,
  JobStatusBadge,
  ProposalStatusBadge,
} from "@/components/shared/StatusBadge";
import { contractsService, milestonesService, usersService, jobsService, proposalsService, catalogService } from "@/lib/api";
import type { Contract, Milestone, Job, Proposal, Specialist } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

export interface ExtendedProposal extends Proposal {
  jobTitle?: string;
  specialistName?: string;
}

export default function XaridorDashboardPage() {
  const { t, lang } = useT();

  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [proposals, setProposals] = useState<ExtendedProposal[] | null>(null);
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      contractsService.list(),
      milestonesService.listMine(),
      usersService.getCurrent(),
      jobsService.listMine(),
      catalogService.listSpecialists().catch(() => []),
    ])
      .then(async ([contractList, milestoneList, user, jobList, allSpecs]) => {
        setContracts(contractList);
        setMilestones(milestoneList);
        if (user) setName(user.fullName);
        setJobs(jobList);

        const specMap = new Map((allSpecs as Specialist[]).map((s) => [s.user.id, s.user.fullName]));

        // Fetch proposals for all buyer jobs
        const propArrays = await Promise.all(
          jobList.map(async (j) => {
            const list = await proposalsService.listForJob(j.id);
            return list.map((p) => ({
              ...p,
              jobTitle: j.title,
              specialistName: p.sellerName?.trim() || specMap.get(p.sellerId) || "Mutaxassis",
            }));
          })
        );
        const flattened = propArrays.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setProposals(flattened);
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;

  const loading = !contracts || !milestones || !jobs || proposals === null;

  const activeContracts = contracts?.filter((c) => c.status === "faol" && !!c.fundedAt) || [];
  const openJobs = jobs?.filter((j) => j.status === "ochiq") || [];
  const contractById = new Map(contracts?.map((c) => [c.id, c]));

  const toReview = (milestones ?? []).filter(
    (m) => m.status === "topshirildi" && contractById.get(m.contractId)?.status === "faol",
  );
  const recentProposals = (proposals ?? []).slice(0, 5);

  const totalSpent = (milestones ?? []).filter((m) => m.status === "qabul_qilindi").reduce((sum, m) => sum + m.amount, 0);

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Top Greeting and Main CTAs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-card border border-line bg-surface p-6 shadow-card">
        <div>
          <h1 className="font-heading text-3xl font-extrabold text-ink tracking-tight">{t("dash.title")}</h1>
          {name && (
            <p className="mt-1 text-sm text-muted font-medium">
              {t("dash.greeting")}, <span className="font-semibold text-ink">{name.split(" ")[0]}</span>
            </p>
          )}
        </div>

      </div>

      {/* 4 ta Asosiy Statistika kartochkasi */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-8 w-16" />
            </Card>
          ))
        ) : (
          <>
            <Card className="flex flex-col justify-center border-l-4 border-l-primary">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("bdash.totalSpent")}</p>
              <p className="mt-2 font-heading text-2xl font-black text-ink">{formatMoney(totalSpent, lang)}</p>
            </Card>

            <Link href="/xaridor/contracts" className="block">
              <Card hoverable className="flex flex-col justify-center border-l-4 border-l-success h-full">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("bdash.activeProjects")}</p>
                  <span className="text-xs text-success font-medium">→</span>
                </div>
                <p className="mt-2 font-heading text-2xl font-black text-ink">{activeContracts.length}</p>
              </Card>
            </Link>

            <Link href="/xaridor/my-jobs" className="block">
              <Card hoverable className="flex flex-col justify-center border-l-4 border-l-primary-deep h-full">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("dash.receivedProposals")}</p>
                  <span className="text-xs text-primary-deep font-medium">→</span>
                </div>
                <p className="mt-2 font-heading text-2xl font-black text-primary-deep">{proposals?.length || 0}</p>
              </Card>
            </Link>

            <Card className="flex flex-col justify-center border-l-4 border-l-warning">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">{t("bdash.toReview")}</p>
              <p className={`mt-2 font-heading text-2xl font-black ${toReview.length > 0 ? "text-warning" : "text-ink"}`}>
                {toReview.length}
              </p>
            </Card>
          </>
        )}
      </div>

      {/* ASOSIY 2 USTUNLI BLOK */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-w-0">
        <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
          {/* Faol ishlar (Active jobs posted by buyer) */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-xl font-bold text-ink">{t("dash.activeJobs")}</h2>
                <span className="text-xs text-muted">({openJobs.length})</span>
              </div>
              <div className="flex items-center gap-3">
              </div>
            </div>

            {loading ? (
              <SkeletonCard />
            ) : openJobs.length === 0 ? (
              <Card className="text-center py-10 flex flex-col items-center justify-center">
                <p className="font-heading text-base font-bold text-ink">{t("dash.emptyJobsCta")}</p>
                <p className="mt-1 text-xs text-muted max-w-md">
                  Ish e'lonini joylashtiring va saralangan mutaxassislardan takliflar qabul qiling.
                </p>
                <Link href="/xaridor/my-jobs/yangi" className="mt-4">
                  <Button size="sm">{t("bdash.postJob")}</Button>
                </Link>
              </Card>
            ) : (
              <div className="flex flex-col gap-3">
                {openJobs.slice(0, 4).map((job) => (
                  <Card key={job.id} padding="md" hoverable className="flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Link href={`/xaridor/my-jobs/${job.id}`}>
                          <h3 className="font-bold text-ink text-sm hover:text-primary transition-colors line-clamp-1">
                            {job.title}
                          </h3>
                        </Link>
                        <div className="flex flex-wrap items-center gap-2.5 text-2xs text-muted mt-1">
                          <Badge tone="primary">{t(`cat.${job.category}`)}</Badge>
                          <JobStatusBadge status={job.status} />
                          <span>{formatMoney(job.budgetMin, lang)} - {formatMoney(job.budgetMax, lang)}</span>
                          <span>•</span>
                          <span>{formatDate(job.postedAt, lang)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary-deep">
                          {job.proposalsCount || 0} {t("jobs.proposalsCountLabel")}
                        </span>
                        <Link href={`/xaridor/my-jobs/${job.id}`}>
                          <Button size="sm" variant="secondary" className="text-xs">
                            Arizalar →
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Kelgan arizalar (Incoming proposals across all jobs) */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-xl font-bold text-ink">{t("dash.recentProposals")}</h2>
                <span className="text-xs text-muted">({proposals?.length || 0})</span>
              </div>

            </div>

            {loading ? (
              <SkeletonCard />
            ) : recentProposals.length === 0 ? (
              <Card className="text-center py-8">
                <p className="font-heading text-sm font-bold text-ink">{t("dash.emptyProposalsCta")}</p>
                <p className="mt-1 text-xs text-muted">
                  E'lonlaringizga mutaxassislar ariza yuborganda bu yerda ko'rinadi.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Link href="/xaridor/my-jobs/yangi">
                    <Button size="sm">{t("bdash.postJob")}</Button>
                  </Link>
                  <Link href="/xaridor/mutaxassislar">
                    <Button variant="secondary" size="sm">{t("bdash.findSpecialist")}</Button>
                  </Link>
                </div>
              </Card>
            ) : (
              <div className="flex flex-col gap-3">
                {recentProposals.map((prop) => (
                  <Card key={prop.id} padding="md" hoverable className="flex flex-col gap-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Avatar name={prop.specialistName || "?"} size="sm" />
                        <div className="min-w-0">
                          <p className="font-bold text-ink text-sm truncate">{prop.specialistName}</p>
                          <p className="text-2xs text-muted truncate">
                            Loyiha: <span className="font-semibold text-ink">{prop.jobTitle}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <ProposalStatusBadge status={prop.status} />
                        <Link href={`/xaridor/my-jobs/${prop.jobId}`}>
                          <Button size="sm" variant="secondary" className="text-xs">
                            Ko'rib chiqish →
                          </Button>
                        </Link>
                      </div>
                    </div>

                    <p className="text-xs text-muted line-clamp-2 bg-surface/50 p-2 rounded-btn border border-line/60">
                      "{prop.coverLetter}"
                    </p>

                    <div className="flex items-center justify-between text-2xs text-muted pt-1 border-t border-line/60">
                      <span>Taklif narxi: <strong className="text-ink font-semibold">{formatMoney(prop.bidAmount, lang)}</strong></span>
                      {prop.estimatedDeliveryDays && <span>{t("common.delivery") || "Yetkazish"}: {prop.estimatedDeliveryDays} {t("common.days")}</span>}
                      <span>{formatDate(prop.createdAt, lang)}</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>


        </div>

        {/* O'NG USTUN: So'nggi shartnomalar va Foydali takliflar */}
        <div className="flex flex-col gap-6 min-w-0">
          {/* Faol shartnomalar */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-xl font-bold text-ink">{t("dash.activeContracts")}</h2>

            </div>

            {loading ? (
              <SkeletonCard />
            ) : activeContracts.length === 0 ? (
              <Card className="text-center py-8">
                <p className="font-heading text-sm font-bold text-ink">{t("dash.emptyContractsCta")}</p>
                <p className="text-xs text-muted mt-1">Tayyor xizmat buyurtma qiling yoki ish e'loni bering.</p>
                <Link href="/xaridor/mutaxassislar" className="mt-3 inline-block">
                  <Button size="sm" variant="secondary">{t("bdash.findSpecialist") || "Mutaxassislarni ko'rish"}</Button>
                </Link>
              </Card>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activeContracts.slice(0, 5).map((contract) => (
                  <Link key={contract.id} href={`/xaridor/contracts/${contract.id}`} className="block">
                    <Card hoverable padding="md" className="flex flex-col gap-2">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="font-bold text-ink text-sm line-clamp-1">{contract.title}</h3>
                        <ContractStatusBadge status={contract.fundedAt ? contract.status : "imzolangan"} />
                      </div>
                      <div className="flex items-center justify-between text-2xs text-muted pt-1 border-t border-line/60">
                        <span>Mutaxassis: <strong className="text-ink font-semibold">{contract.sellerName}</strong></span>
                        <span className="font-bold text-ink">{formatMoney(contract.totalAmount, lang)}</span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Mutaxassis topish banneri */}
          <Card className="bg-primary/5 border-primary/20 p-5">
            <h3 className="font-bold text-primary text-sm mb-1.5">{t("bdash.helpTeaserTitle")}</h3>
            <p className="text-xs text-muted mb-4 leading-relaxed">{t("bdash.helpTeaserBody")}</p>
            <div className="flex flex-col gap-2">
              <Link href="/xaridor/mutaxassislar">
                <Button size="sm" className="w-full">
                  {t("bdash.findSpecialist")}
                </Button>
              </Link>
              <Link href="/yordam-markazi">
                <Button variant="ghost" size="sm" className="w-full text-xs">
                  {t("bdash.helpTeaserBtn")}
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
