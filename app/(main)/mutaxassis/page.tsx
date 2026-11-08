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
  OfferStatusBadge,
  ServiceStatusBadge,
} from "@/components/shared/StatusBadge";
import { JobCard } from "@/components/shared/JobCard";
import {
  contractsService,
  jobsService,
  milestonesService,
  offersService,
  proposalsService,
  savedService,
  sellerApplicationService,
  servicesService,
  usersService,
} from "@/lib/api";
import type { Contract, Job, Milestone, Offer, Proposal, SellerProfile, Service, VerificationStatus } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { sellerNet } from "@/lib/fees";
import { useT } from "@/lib/i18n";

function matchesProfile(job: Job, profile: SellerProfile | null): boolean {
  if (!profile) return true;
  if (job.status !== "ochiq") return false;
  if (profile.categories && profile.categories.includes(job.category)) return true;
  const skills = (profile.skills || []).map((s) => s.toLowerCase());
  return (job.skillsRequired || []).some((s) => skills.includes(s.toLowerCase()));
}

export default function MutaxassisDashboardPage() {
  const { t, lang } = useT();

  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [applicationStatus, setApplicationStatus] = useState<VerificationStatus | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      contractsService.list(),
      milestonesService.listMine(),
      servicesService.listMine(),
      jobsService.list(),
      proposalsService.listMine(),
      offersService.listIncoming(),
      usersService.getSellerProfile().catch(() => null),
      savedService.listJobIds(),
      usersService.getCurrent(),
    ])
      .then(([contractList, milestoneList, serviceList, jobList, proposalList, offerList, prof, ids, user]) => {
        setContracts(contractList);
        setMilestones(milestoneList);
        setServices(serviceList);
        setJobs(jobList);
        setProposals(proposalList);
        setOffers(offerList);
        setProfile(prof);
        setSavedIds(ids);
        if (user) setName(user.fullName);
      })
      .catch(setLoadError);

    sellerApplicationService
      .getCurrent()
      .then((app) => setApplicationStatus(app?.status ?? null))
      .catch(() => setApplicationStatus(null));
  }, []);

  useEffect(load, [load]);

  async function handleToggleSave(jobId: string) {
    setSavedIds(await savedService.toggleJob(jobId));
  }

  const loading = !contracts || !milestones || jobs === null || proposals === null;

  const activeContracts = contracts?.filter((c) => c.status === "faol" && !!c.fundedAt) || [];
  const openJobs = (jobs ?? []).filter((j) => j.status === "ochiq");
  const matchingJobs = openJobs.filter((j) => matchesProfile(j, profile));
  const totalEarnings = (milestones ?? [])
    .filter((m) => m.status === "qabul_qilindi")
    .reduce((sum, m) => sum + sellerNet(m.amount, m.platformFeeRateBps), 0);

  const awaitingResponseProposals = (proposals ?? []).filter(
    (p) => p.status === "yuborilgan" || p.status === "korib_chiqilmoqda" || p.status === "suhbat"
  );
  const activeServices = services.filter((s) => s.status === "active");

  const jobsToFilter = matchingJobs.length > 0 ? matchingJobs : openJobs;
  const filteredJobs = jobsToFilter.sort((a, b) => b.postedAt.localeCompare(a.postedAt));

  const displayedJobs = filteredJobs.slice(0, 4);
  const recentContracts = [...(contracts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Top Greeting and Quick CTAs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-card border border-line bg-surface p-6 shadow-card">
        <div>
          <h1 className="font-heading text-3xl font-extrabold text-ink">{t("dash.title")}</h1>
          {name && (
            <p className="mt-1 text-sm text-muted">
              {t("dash.greeting")}, <span className="font-semibold text-ink">{name.split(" ")[0]}</span>
            </p>
          )}
        </div>

      </div>

      {applicationStatus && applicationStatus !== "tasdiqlangan" && (
        <Card
          className={
            applicationStatus === "rad_etilgan"
              ? "border-danger/30 bg-danger/5"
              : "border-warning/30 bg-warning/5"
          }
        >
          <p className="font-heading text-sm font-bold text-ink">
            {applicationStatus === "rad_etilgan" ? t("dash.applicationRejected") : t("dash.applicationPending")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {applicationStatus === "rad_etilgan" ? t("dash.applicationRejectedDesc") : t("dash.applicationPendingDesc")}
          </p>
          {applicationStatus === "rad_etilgan" && (
            <Link href="/mutaxassis/settings/royxat" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">
              {t("onboard.reapplyBtn")}
            </Link>
          )}
        </Card>
      )}

      {/* 5 ta Aniq Statistika kartochkasi */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-3 h-8 w-24" />
            </Card>
          ))
        ) : (
          <>
            <Link href="/mutaxassis/billing" className="block">
              <Card hoverable className="border-l-4 border-l-primary h-full">
                <p className="text-2xs font-bold uppercase text-primary-deep tracking-wider">{t("dash.netIncome")}</p>
                <p className="mt-2 font-heading text-xl font-black text-ink">{formatMoney(totalEarnings, lang)}</p>
              </Card>
            </Link>

            <Link href="/mutaxassis/contracts" className="block">
              <Card hoverable className="border-l-4 border-l-success h-full">
                <p className="text-2xs font-bold uppercase text-muted tracking-wider">{t("dash.activeContracts")}</p>
                <p className="mt-2 font-heading text-xl font-black text-ink">{activeContracts.length}</p>
              </Card>
            </Link>

            <Link href="/mutaxassis/applications" className="block">
              <Card hoverable className="border-l-4 border-l-accent h-full">
                <p className="text-2xs font-bold uppercase text-muted tracking-wider">{t("dash.proposalsSent")}</p>
                <p className="mt-2 font-heading text-xl font-black text-ink">{proposals?.length || 0}</p>
              </Card>
            </Link>

            <Link href="/mutaxassis/applications" className="block">
              <Card hoverable className="border-l-4 border-l-warning h-full">
                <p className="text-2xs font-bold uppercase text-muted tracking-wider">{t("dash.awaitingResponse")}</p>
                <p className={`mt-2 font-heading text-xl font-black ${awaitingResponseProposals.length > 0 ? "text-warning" : "text-ink"}`}>
                  {awaitingResponseProposals.length}
                </p>
              </Card>
            </Link>

            <Link href="/mutaxassis/services" className="block">
              <Card hoverable className="border-l-4 border-l-primary-deep h-full">
                <p className="text-2xs font-bold uppercase text-muted tracking-wider">{t("dash.activeServices")}</p>
                <p className="mt-2 font-heading text-xl font-black text-ink">{activeServices.length}</p>
              </Card>
            </Link>
          </>
        )}
      </div>

      {/* ASOSIY QISM 1: MENGA MOS ISHLAR (Job Discovery) */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="font-heading text-xl font-bold text-ink">
                {matchingJobs.length > 0 ? t("dash.matchingJobs") : t("dash.availableJobs")}
              </h2>
              {!loading && (
                <Badge tone="primary">
                  {filteredJobs.length} ta mos ish
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">
              {matchingJobs.length > 0
                ? "Sizning ko'nikmalaringiz va kategoriyalaringizga to'g'ri keladigan ishlar"
                : t("dash.availableJobsDesc")}
            </p>
          </div>
          <Link
            href="/bozor?tab=jobs"
            className="text-sm font-semibold text-primary hover:text-primary-deep hover:underline shrink-0"
          >
            {t("dash.browseJobBoard")} ({openJobs.length}) →
          </Link>
        </div>



        {/* Ishlar ro'yxati */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : displayedJobs.length === 0 ? (
          <Card className="text-center py-10 flex flex-col items-center justify-center">
            <p className="font-heading text-sm font-bold text-ink">{t("dash.noJobsFound")}</p>
            <p className="mt-1 text-xs text-muted max-w-md">{t("dash.noMatchingJobs")}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href="/bozor?tab=jobs">
                <Button size="sm">{t("dash.browseJobBoard")}</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayedJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  saved={savedIds.includes(job.id)}
                  onToggleSave={handleToggleSave}
                />
              ))}
            </div>

            {filteredJobs.length > displayedJobs.length && (
              <div className="text-center pt-2">
                <Link href="/bozor?tab=jobs">
                  <Button variant="secondary" size="sm">
                    {t("dash.browseJobBoard")} ({filteredJobs.length} ta loyiha) →
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}
      </section>

      {/* UCH USTUNLI QISM: Kelgan takliflar, Faol shartnomalar, Xizmatlarim */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Kelgan takliflar (Direct offers) */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-lg font-bold text-ink">{t("dash.incomingOffers")}</h2>
              <span className="text-xs text-muted">({offers.length})</span>
            </div>
            {offers.length > 0 && (
              <Link href="/mutaxassis/applications" className="text-xs font-semibold text-primary hover:underline">
                {t("dash.viewAll")} →
              </Link>
            )}
          </div>

          {loading ? (
            <SkeletonCard />
          ) : offers.length === 0 ? (
            <Card className="text-center py-8">
              <p className="font-heading text-sm font-bold text-ink">Hozircha sizga to'g'ridan-to'g'ri ish taklifi kelmagan.</p>
              <div className="mt-4 pt-4 border-t border-line/60">
                <p className="text-xs text-muted mb-2">Profilni to'ldirish tavsiya etiladi</p>
                <Link href="/mutaxassis/settings/profil" className="inline-block text-xs font-semibold text-primary hover:underline">
                  Profilni to'ldirish →
                </Link>
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {offers.slice(0, 4).map((offer) => (
                <Link key={offer.id} href={`/mutaxassis/applications/kelgan/${offer.id}`} className="block">
                  <Card hoverable padding="md" className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Avatar name={offer.buyerName} size="sm" />
                      <div className="min-w-0">
                        <p className="font-bold text-ink text-sm truncate">{offer.title}</p>
                        <p className="text-2xs text-muted mt-0.5">
                          {offer.buyerName} • <span className="font-medium text-ink">{formatMoney(offer.budget, lang)}</span>
                        </p>
                      </div>
                    </div>
                    <OfferStatusBadge status={offer.status} />
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
        {/* Faol shartnomalar */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-ink">{t("dash.recentContracts")}</h2>
            <Link href="/mutaxassis/contracts" className="text-xs font-semibold text-primary hover:underline">
              {t("dash.viewAll")} ({contracts?.length || 0}) →
            </Link>
          </div>

          {loading ? (
            <SkeletonCard />
          ) : recentContracts.length === 0 ? (
            <Card className="text-center py-8">
              <p className="font-heading text-sm font-bold text-ink">{t("dash.emptyContractsCta")}</p>
              <p className="mt-1 text-xs text-muted">{t("dash.noContractsDesc")}</p>
              <Link href="/bozor?tab=jobs" className="mt-3 inline-block">
                <Button size="sm">{t("dash.browseJobBoard")}</Button>
              </Link>
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {recentContracts.map((c) => (
                <Link key={c.id} href={`/mutaxassis/contracts/${c.id}`} className="block">
                  <Card hoverable padding="md" className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-ink text-sm truncate">{c.title}</p>
                      <p className="text-2xs text-muted mt-0.5">
                        {c.buyerName} • {formatDate(c.createdAt, lang)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="font-bold text-ink text-xs">{formatMoney(c.totalAmount, lang)}</span>
                      <ContractStatusBadge status={c.fundedAt ? c.status : "imzolangan"} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Xizmatlarim */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-ink">{t("dash.myServices")}</h2>
            <Link href="/mutaxassis/services" className="text-xs font-semibold text-primary hover:underline">
              {t("dash.viewAll")} ({services.length}) →
            </Link>
          </div>

          {loading ? (
            <SkeletonCard />
          ) : services.length === 0 ? (
            <Card className="text-center py-8">
              <p className="font-heading text-sm font-bold text-ink">{t("dash.emptyServicesCta")}</p>
              <p className="mt-1 text-xs text-muted">Xizmat yarating va bozorga taklif qiling.</p>
              <Link href="/mutaxassis/services/yangi" className="mt-3 inline-block">
                <Button size="sm">{t("dash.newService")}</Button>
              </Link>
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {services.slice(0, 4).map((s) => (
                <Link key={s.id} href={`/mutaxassis/services/${s.id}`} className="block">
                  <Card hoverable padding="md" className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-ink text-sm truncate">{s.title}</p>
                      <div className="flex items-center gap-2 text-2xs text-muted mt-0.5">
                        <Badge tone="primary">{t(`cat.${s.category}`)}</Badge>
                        <span className="font-semibold text-ink">{formatMoney(s.price, lang)}</span>
                        <span>• {s.deliveryDays} kun</span>
                      </div>
                    </div>
                    <ServiceStatusBadge status={s.status} />
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
