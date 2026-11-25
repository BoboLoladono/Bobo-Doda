"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { RatingStars } from "@/components/ui/RatingStars";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { TrustBadge } from "@/components/ui/TrustBadge";

import { JobStatusBadge, ProposalStatusBadge } from "@/components/shared/StatusBadge";
import { OfferModal } from "@/components/shared/OfferModal";
import { catalogService, jobsService, proposalsService } from "@/lib/api";
import type { Job, JobStatus, Proposal, Specialist } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

type MainTab = "my_jobs" | "proposals";
type JobFilter = "all" | JobStatus;
type ProposalFilter = "all" | "yuborilgan" | "suhbat" | "yollandi" | "rad_etildi";

function matchesProposalFilter(status: Proposal["status"], filter: ProposalFilter): boolean {
  if (filter === "all") return true;
  if (filter === "yuborilgan") return status === "yuborilgan" || status === "korib_chiqilmoqda";
  return status === filter;
}

interface ProposalWithJob {
  proposal: Proposal;
  job: Job;
}

export default function ElonlarimPage() {
  const { t, lang } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as MainTab | null;
  const [mainTab, setMainTab] = useState<MainTab>(
    tabParam && ["my_jobs", "proposals"].includes(tabParam)
      ? tabParam as MainTab
      : "my_jobs"
  );

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobProposalsMap, setJobProposalsMap] = useState<Map<string, Proposal[]>>(new Map());
  const [specialists, setSpecialists] = useState<Map<string, Specialist>>(new Map());
  
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [proposalFilter, setProposalFilter] = useState<ProposalFilter>("all");
  const [offerSpecialist, setOfferSpecialist] = useState<Specialist | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const handleTabChange = useCallback(
    (newTab: MainTab) => {
      setMainTab(newTab);
      const params = new URLSearchParams(window.location.search);
      if (newTab === "my_jobs") {
        params.delete("tab");
      } else {
        params.set("tab", newTab);
      }
      const query = params.toString();
      router.replace(query ? `/xaridor/my-jobs?${query}` : "/xaridor/my-jobs", {
        scroll: false,
      });
    },
    [router]
  );

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      jobsService.listMine(),
      catalogService.listSpecialists(),
    ])
      .then(async ([myJobs, allSpecs]) => {
        setJobs(myJobs);
        setSpecialists(new Map(allSpecs.map((s) => [s.user.id, s])));

        // Barcha e'lonlar uchun arizalarni yuklash
        const results = await Promise.all(
          myJobs.map((j) => proposalsService.listForJob(j.id))
        );
        const map = new Map<string, Proposal[]>();
        myJobs.forEach((job, i) => {
          map.set(
            job.id,
            results[i].filter((p: Proposal) => p.status !== "qaytarib_olingan")
          );
        });
        setJobProposalsMap(map);
      })
      .catch(setLoadError);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Barcha arizalar (agregatsiya)
  const allProposalsWithJobs = useMemo<ProposalWithJob[]>(() => {
    if (!jobs) return [];
    const list: ProposalWithJob[] = [];
    jobs.forEach((job) => {
      const props = jobProposalsMap.get(job.id) ?? [];
      props.forEach((proposal) => {
        list.push({ proposal, job });
      });
    });
    // Sanasi bo'yicha eng yangilari tepada
    return list.sort(
      (a, b) =>
        new Date(b.proposal.createdAt).getTime() -
        new Date(a.proposal.createdAt).getTime()
    );
  }, [jobs, jobProposalsMap]);

  // Filtrlangan ishlar
  const filteredJobs = useMemo(() => {
    return jobs?.filter((j) => jobFilter === "all" || j.status === jobFilter) ?? [];
  }, [jobs, jobFilter]);

  // Filtrlangan arizalar
  const filteredProposals = useMemo(() => {
    return allProposalsWithJobs.filter((item) =>
      matchesProposalFilter(item.proposal.status, proposalFilter)
    );
  }, [allProposalsWithJobs, proposalFilter]);

  

  return (
    <div className="flex flex-col gap-6">
      {/* Sarlavha paneli */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-ink">
            {t("bjobs.title")}
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            E&apos;lonlaringizni boshqaring, kelgan takliflarni ko&apos;rib chiqing va tanlangan mutaxassislar bilan bog&apos;laning.
          </p>
        </div>
        <Link href="/xaridor/my-jobs/yangi">
          <Button>{t("bjobs.post")}</Button>
        </Link>
      </div>

      {/* 2 ta asosiy tab: Mening ishlarim | Arizalar */}
      <Tabs
        value={mainTab}
        onChange={(val) => handleTabChange(val as MainTab)}
        items={[
          {
            value: "my_jobs",
            label: t("bjobs.tabMyJobs"),
            count: jobs?.length,
          },
          {
            value: "proposals",
            label: t("bjobs.tabProposals"),
            count: allProposalsWithJobs.length,
          },
        ]}
      />

      {loadError ? (
        <ErrorState error={loadError} onRetry={load} />
      ) : !jobs ? (
        <SkeletonCard />
      ) : (
        <>
          {/* TAB 1: MENING ISHLARIM */}
          {mainTab === "my_jobs" && (
            <div className="flex flex-col gap-4">
              <Tabs
                value={jobFilter}
                onChange={(value) => setJobFilter(value as JobFilter)}
                items={[
                  { value: "all", label: t("jobs.tabAll"), count: jobs.length },
                  {
                    value: "ochiq",
                    label: t("jobs.open"),
                    count: jobs.filter((j) => j.status === "ochiq").length,
                  },
                  {
                    value: "yopilgan",
                    label: t("jobs.closed"),
                    count: jobs.filter((j) => j.status === "yopilgan").length,
                  },
                ]}
              />

              {filteredJobs.length === 0 ? (
                <EmptyState
                  title={jobs.length === 0 ? t("bjobs.empty") : t("bjobs.emptyFiltered")}
                  action={
                    jobs.length === 0 ? (
                      <Link href="/xaridor/my-jobs/yangi">
                        <Button>{t("bjobs.emptyCta")}</Button>
                      </Link>
                    ) : undefined
                  }
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {filteredJobs.map((job) => {
                    const count = Math.max(jobProposalsMap.get(job.id)?.length || 0, job.proposalsCount || 0);
                    return (
                      <Card key={job.id} hoverable className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="primary">{t(`cat.${job.category}`)}</Badge>
                          <JobStatusBadge status={job.status} />
                          <span className="ml-auto text-2xs text-faint">
                            {formatDate(job.postedAt, lang)}
                          </span>
                        </div>
                        <Link href={`/xaridor/my-jobs/${job.id}`} className="group block">
                          <h3 className="font-heading text-base font-bold text-ink transition-colors group-hover:text-primary">
                            {job.title}
                          </h3>
                        </Link>
                        <p className="line-clamp-2 text-xs text-muted leading-relaxed">
                          {job.description}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs">
                          <span className="font-medium text-ink">
                            {formatMoney(job.budgetMin, lang)} – {formatMoney(job.budgetMax, lang)}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5 text-muted">
                              <span
                                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-bold ${
                                  count > 0
                                    ? "bg-primary/10 text-primary-deep"
                                    : "bg-card-hover text-faint"
                                }`}
                              >
                                {count}
                              </span>
                              {t("jobs.proposalsCount")}
                            </span>
                            <Link href={`/xaridor/my-jobs/${job.id}`}>
                              <Button variant="secondary" size="sm" className="text-xs">
                                {t("market.detailsBtn")} →
                              </Button>
                            </Link>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ARIZALAR (Barcha e'lonlarga kelgan takliflar) */}
          {mainTab === "proposals" && (
            <div className="flex flex-col gap-4">
              <Tabs
                value={proposalFilter}
                onChange={(val) => setProposalFilter(val as ProposalFilter)}
                items={[
                  {
                    value: "all",
                    label: t("jobs.tabAll"),
                    count: allProposalsWithJobs.length,
                  },
                  {
                    value: "yuborilgan",
                    label: "Yangi",
                    count: allProposalsWithJobs.filter(
                      (p) => p.proposal.status === "yuborilgan" || p.proposal.status === "korib_chiqilmoqda"
                    ).length,
                  },
                  {
                    value: "suhbat",
                    label: "Suhbatda",
                    count: allProposalsWithJobs.filter((p) => p.proposal.status === "suhbat").length,
                  },
                  {
                    value: "yollandi",
                    label: "Yollangan",
                    count: allProposalsWithJobs.filter((p) => p.proposal.status === "yollandi").length,
                  },
                  {
                    value: "rad_etildi",
                    label: "Rad etilgan",
                    count: allProposalsWithJobs.filter((p) => p.proposal.status === "rad_etildi").length,
                  },
                ]}
              />

              {filteredProposals.length === 0 ? (
                <EmptyState
                  title={
                    allProposalsWithJobs.length === 0
                      ? t("bjobs.emptyProposals")
                      : "Bu holatda arizalar topilmadi"
                  }
                  description={
                    allProposalsWithJobs.length === 0
                      ? "E'lonlaringizga mutaxassislar ariza topshirishi bilan bu yerda ko'rinadi yoki mutaxassislar bo'limidan to'g'ridan-to'g'ri mutaxassis topishingiz mumkin."
                      : "Tanlangan filtr bo'yicha takliflar mavjud emas."
                  }
                  action={
                    allProposalsWithJobs.length === 0 ? (
                      <Link href="/xaridor/mutaxassislar">
                        <Button size="sm">Mutaxassislarni ko'rish</Button>
                      </Link>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setProposalFilter("all")}>
                        Barcha arizalar
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {filteredProposals.map(({ proposal, job }) => {
                    const spec = specialists.get(proposal.sellerId);
                    const specialistName = proposal.sellerName?.trim() || spec?.user.fullName || "Mutaxassis";
                    return (
                      <Card key={proposal.id} padding="lg" className="flex flex-col gap-4 shadow-2xs">
                        {/* E'lon havolasi va Kategoriya */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
                              {t("bjobs.forJob")}:
                            </span>
                            <Link
                              href={`/xaridor/my-jobs/${job.id}`}
                              className="font-bold text-ink hover:text-primary transition-colors truncate"
                            >
                              {job.title}
                            </Link>
                          </div>
                          <Badge tone="primary">{t(`cat.${job.category}`)}</Badge>
                        </div>

                        {/* Mutaxassis ma'lumotlari */}
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <Link
                            href={`/bozor/mutaxassis/${proposal.sellerId}`}
                            className="group flex items-center gap-3"
                          >
                            <Avatar name={specialistName} />
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-bold text-ink transition-colors duration-150 group-hover:text-primary">
                                  {specialistName}
                                </span>
                                {spec && <TrustBadge badge={spec.profile.badge} />}
                              </div>
                              {spec && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
                                  {spec.profile.reviewCount > 0 ? (
                                    <RatingStars value={spec.profile.rating} size="sm" showValue />
                                  ) : (
                                    <span className="text-muted font-normal">Yangi mutaxassis</span>
                                  )}
                                  <span>
                                    {spec.profile.completedContracts} {t("profile.completedContracts")}
                                  </span>
                                </div>
                              )}
                            </div>
                          </Link>
                          <div className="flex flex-col items-end gap-1">
                            <ProposalStatusBadge status={proposal.status} />
                            <span className="text-2xs text-faint">
                              {formatDate(proposal.createdAt, lang)}
                            </span>
                          </div>
                        </div>

                        {/* Narx va yetkazish muddati */}
                        <div className="flex items-center justify-between gap-3 rounded-input border border-line bg-surface p-3 text-xs">
                          <div>
                            <span className="text-2xs text-muted">{t("props.bid")}</span>
                            <p className="font-heading text-base font-bold text-ink">
                              {formatMoney(proposal.bidAmount, lang)}
                            </p>
                          </div>
                          {proposal.estimatedDeliveryDays !== undefined && (
                            <div className="text-right">
                              <span className="text-2xs text-muted">{t("prop.deliveryDays")}</span>
                              <p className="font-heading text-sm font-bold text-ink">
                                {proposal.estimatedDeliveryDays} {t("common.days")}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Xat / Ariza matni */}
                        <p className="line-clamp-3 text-xs text-muted leading-relaxed whitespace-pre-line">
                          {proposal.coverLetter}
                        </p>

                        {/* Amallar */}
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                          <Link href={`/xaridor/my-jobs/${job.id}`}>
                            <Button variant="ghost" size="sm" className="text-xs">
                              {t("bjobs.viewJob")}
                            </Button>
                          </Link>
                          <Link href={`/xaridor/my-jobs/${job.id}/suhbat/${proposal.id}`}>
                            <Button variant="secondary" size="sm" className="text-xs">
                              💬 {t("pchat.open")}
                            </Button>
                          </Link>
                          {job.status === "ochiq" && proposal.status !== "yollandi" && proposal.status !== "rad_etildi" && (
                            <Link href={`/xaridor/my-jobs/${job.id}/yollash/${proposal.id}`}>
                              <Button size="sm" className="text-xs">
                                💼 {t("bprop.hire")}
                              </Button>
                            </Link>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}


        </>
      )}

      {/* Mutaxassisga to'g'ridan-to'g'ri ish taklif qilish modali */}
      {offerSpecialist && (
        <OfferModal
          open={!!offerSpecialist}
          onClose={() => setOfferSpecialist(null)}
          sellerId={offerSpecialist.user.id}
        />
      )}
    </div>
  );
}
