"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { RatingStars } from "@/components/ui/RatingStars";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { TrustBadge } from "@/components/ui/TrustBadge";
import { IdentityVerifiedBadge } from "@/components/ui/IdentityVerifiedBadge";
import { OfferModal } from "@/components/shared/OfferModal";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { searchMatches } from "@/lib/search";
import { catalogService, savedService, servicesService } from "@/lib/api";
import type { PortfolioItem, Service, Specialist } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { CATEGORIES } from "@/lib/category-fields";
import { isTestService } from "@/lib/validate";

type TabKey = "specialists" | "services";
type SpecialistSort = "rating" | "contracts" | "reviews";
type ServiceSort = "new" | "cheap" | "expensive";

export default function XaridorMutaxassislarPage() {
  const { t, lang } = useT();

  const [tab, setTab] = useState<TabKey>("specialists");
  const [specialists, setSpecialists] = useState<Specialist[] | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [savedSpecialistIds, setSavedSpecialistIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);

  // Common filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  // Specialists filters
  const [specSort, setSpecSort] = useState<SpecialistSort>("rating");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [hasPortfolioOnly, setHasPortfolioOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState("all");

  // Services filters
  const [serviceSort, setServiceSort] = useState<ServiceSort>("new");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState("all");

  // Modals
  const [offerSpecialist, setOfferSpecialist] = useState<Specialist | null>(null);
  const [messageSpecialist, setMessageSpecialist] = useState<Specialist | null>(null);
  const [viewingPortfolio, setViewingPortfolio] = useState<{
    item: PortfolioItem;
    specialistName: string;
    specialistId: string;
  } | null>(null);

  const [page, setPage] = useState(1);
  const PER_PAGE = 12;

  const debouncedSearch = useDebouncedValue(search, 250);

  // Sync URL params
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const urlTab = sp.get("tab");
    const q = sp.get("q");
    const cat = sp.get("cat");
    if (urlTab === "services" || urlTab === "specialists") {
      setTab(urlTab);
    }
    if (q) setSearch(q);
    if (cat) setCategory(cat);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams();
    if (tab !== "specialists") sp.set("tab", tab);
    if (search.trim()) sp.set("q", search.trim());
    if (category !== "all") sp.set("cat", category);
    const qs = sp.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [tab, search, category]);

  useEffect(() => {
    setPage(1);
  }, [
    tab,
    category,
    debouncedSearch,
    specSort,
    ratingFilter,
    hasPortfolioOnly,
    availableOnly,
    locationFilter,
    serviceSort,
    minPrice,
    maxPrice,
    deliveryFilter,
  ]);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      catalogService.listSpecialists(),
      servicesService.listPublic(),
      savedService.listSpecialistIds(),
    ])
      .then(([nextSpecs, nextServices, savedSpecIds]) => {
        setSpecialists(nextSpecs);
        setServices(nextServices);
        setSavedSpecialistIds(savedSpecIds);
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  async function handleToggleSaveSpecialist(specId: string) {
    const updated = await savedService.toggleSpecialist(specId);
    setSavedSpecialistIds(updated);
  }

  function clearAllFilters() {
    setSearch("");
    setCategory("all");
    setSpecSort("rating");
    setRatingFilter("all");
    setHasPortfolioOnly(false);
    setAvailableOnly(false);
    setLocationFilter("all");
    setServiceSort("new");
    setMinPrice("");
    setMaxPrice("");
    setDeliveryFilter("all");
  }

  const query = debouncedSearch.trim();

  // Map services by sellerId for instant lookup
  const servicesBySeller = useMemo(() => {
    const map = new Map<string, Service[]>();
    (services ?? []).filter((s) => !isTestService(s)).forEach((s) => {
      const list = map.get(s.sellerId) || [];
      list.push(s);
      map.set(s.sellerId, list);
    });
    return map;
  }, [services]);

  // Filtered Specialists
  const filteredSpecialists = useMemo(() => {
    return (specialists ?? [])
      .filter((s) => category === "all" || s.profile.categories.includes(category))
      .filter((s) => {
        if (ratingFilter === "4.5") return s.profile.rating >= 4.5;
        if (ratingFilter === "4.0") return s.profile.rating >= 4.0;
        return true;
      })
      .filter((s) => !hasPortfolioOnly || (s.profile.portfolio && s.profile.portfolio.length > 0))
      .filter((s) => !availableOnly || s.profile.available)
      .filter((s) => locationFilter === "all" || s.profile.location.toLowerCase().includes(locationFilter.toLowerCase()))
      .filter((s) => {
        if (!query) return true;
        if (searchMatches(s.user.fullName, query)) return true;
        if (searchMatches(s.profile.headline, query)) return true;
        if (searchMatches(s.profile.bio, query)) return true;
        if (s.profile.skills.some((sk) => searchMatches(sk, query))) return true;
        // Search portfolio works
        if ((s.profile.portfolio || []).some((item) => searchMatches(item.title, query) || searchMatches(item.description, query))) {
          return true;
        }
        // Search ready services
        const specServices = servicesBySeller.get(s.user.id) || [];
        if (specServices.some((svc) => searchMatches(svc.title, query) || searchMatches(svc.description, query))) {
          return true;
        }
        return false;
      })
      .sort((a, b) => {
        if (specSort === "contracts") return b.profile.completedContracts - a.profile.completedContracts;
        if (specSort === "reviews") return b.profile.reviewCount - a.profile.reviewCount;
        return b.profile.rating - a.profile.rating;
      });
  }, [specialists, category, ratingFilter, hasPortfolioOnly, availableOnly, locationFilter, query, specSort, servicesBySeller]);

  // Filtered Services
  const minP = minPrice ? Number(minPrice) : null;
  const maxP = maxPrice ? Number(maxPrice) : null;
  const delDays = deliveryFilter === "all" ? null : Number(deliveryFilter);
  const filteredServices = useMemo(() => {
    return (services ?? [])
      .filter((s) => !isTestService(s))
      .filter((s) => category === "all" || s.category === category)
      .filter((s) => minP === null || s.price >= minP)
      .filter((s) => maxP === null || s.price <= maxP)
      .filter((s) => delDays === null || s.deliveryDays <= delDays)
      .filter((s) => !query || searchMatches(s.title, query) || searchMatches(s.description, query))
      .sort((a, b) => {
        if (serviceSort === "cheap") return a.price - b.price;
        if (serviceSort === "expensive") return b.price - a.price;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [services, category, minP, maxP, delDays, query, serviceSort]);

  const loading = !specialists || !services;

  // Pagination calculations
  const currentItemsCount = tab === "specialists" ? filteredSpecialists.length : filteredServices.length;
  const totalPages = Math.max(1, Math.ceil(currentItemsCount / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PER_PAGE;

  const pagedSpecialists = filteredSpecialists.slice(pageStart, pageStart + PER_PAGE);
  const pagedServices = filteredServices.slice(pageStart, pageStart + PER_PAGE);

  const categoryOptions = [
    { value: "all", label: "Barcha sohalar" },
    ...CATEGORIES.map((cat) => ({ value: cat, label: t(`cat.${cat}`) || cat })),
  ];

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-ink xl:text-3xl">
            Mutaxassislar katalogi
          </h1>
          <p className="mt-1 text-sm text-muted xl:text-base">
            Loyihangiz uchun eng munosib frilanserlar, ularning portfolio ishlari va tayyor xizmatlari
          </p>
        </div>
        <Link href="/xaridor/my-jobs/yangi" className="shrink-0">
          <Button size="md" className="gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            E&apos;lon joylash
          </Button>
        </Link>
      </div>

      {/* Tabs: Faqat Mutaxassislar va Xizmatlar (begona ish e'lonlari butunlay yashirilgan) */}
      <div className="border-b border-line pb-1">
        <Tabs
          value={tab}
          onChange={(v) => {
            setTab(v as TabKey);
            setSearch("");
          }}
          items={[
            {
              value: "specialists",
              label: "Mutaxassislar",
              count: specialists?.length,
            },
            {
              value: "services",
              label: "Xizmatlar",
              count: services?.length,
            },
          ]}
        />
      </div>

      {/* Dynamic Filters Section */}
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5 shadow-card">
        {/* Search & Category Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={
                tab === "specialists"
                  ? "Ism, soha, ko'nikma yoki portfolio ishi bo'yicha qidirish..."
                  : "Xizmat nomi yoki tavsifi bo'yicha qidirish..."
              }
              aria-label="Qidiruv"
              clearLabel={t("search.clear") || "Tozalash"}
            />
          </div>
          <div>
            <Select
              aria-label="Soha bo'yicha tanlash"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={categoryOptions}
            />
          </div>
        </div>

        {/* Tab 1: Mutaxassislar filtrlari */}
        {tab === "specialists" && (
          <div className="flex flex-col gap-3 pt-2 border-t border-line/60">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                aria-label="Reyting bo'yicha saralash"
                value={specSort}
                onChange={(e) => setSpecSort(e.target.value as SpecialistSort)}
                options={[
                  { value: "rating", label: "★ Eng yuqori reyting" },
                  { value: "contracts", label: "💼 Ko'p ish bajarganlar" },
                  { value: "reviews", label: "💬 Ko'p sharh olganlar" },
                ]}
              />

              <Select
                aria-label="Minimal reyting filtri"
                value={ratingFilter}
                onChange={(e) => setRatingFilter(e.target.value)}
                options={[
                  { value: "all", label: "Barcha reytinglar" },
                  { value: "4.5", label: "4.5 va undan yuqori ★" },
                  { value: "4.0", label: "4.0 va undan yuqori ★" },
                ]}
              />

              <Select
                aria-label="Joylashuv filtri"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                options={[
                  { value: "all", label: "Barcha hududlar" },
                  { value: "Toshkent", label: "Toshkent" },
                  { value: "Samarqand", label: "Samarqand" },
                  { value: "Farg'ona", label: "Farg'ona" },
                  { value: "Andijon", label: "Andijon" },
                  { value: "Buxoro", label: "Buxoro" },
                ]}
              />
            </div>

            {/* Checkbox / Toggle Quick Filters */}
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-ink font-medium">
                <input
                  type="checkbox"
                  checked={hasPortfolioOnly}
                  onChange={(e) => setHasPortfolioOnly(e.target.checked)}
                  className="rounded border-line text-primary focus:ring-primary h-4 w-4"
                />
                <span>Faqat portfoliosi borlar</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-ink font-medium">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                  className="rounded border-line text-primary focus:ring-primary h-4 w-4"
                />
                <span>Faqat yangi ishlarga tayyor bo&apos;lganlar</span>
              </label>

              {(search || category !== "all" || ratingFilter !== "all" || hasPortfolioOnly || availableOnly || locationFilter !== "all") && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="ml-auto text-xs text-primary hover:underline font-semibold"
                >
                  Filtrlarni tozalash
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Xizmatlar filtrlari */}
        {tab === "services" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t border-line/60">
            <Input
              type="number"
              aria-label="Minimal narx"
              placeholder="Min narx (so'm)"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
            <Input
              type="number"
              aria-label="Maksimal narx"
              placeholder="Max narx (so'm)"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
            <Select
              aria-label="Yetkazib berish muddati"
              value={deliveryFilter}
              onChange={(e) => setDeliveryFilter(e.target.value)}
              options={[
                { value: "all", label: "Har qanday muddat" },
                { value: "3", label: "3 kungacha" },
                { value: "7", label: "7 kungacha" },
                { value: "14", label: "14 kungacha" },
              ]}
            />
            <Select
              aria-label="Saralash"
              value={serviceSort}
              onChange={(e) => setServiceSort(e.target.value as ServiceSort)}
              options={[
                { value: "new", label: "Eng yangi" },
                { value: "cheap", label: "Arzonroq narxda" },
                { value: "expensive", label: "Qimmatroq narxda" },
              ]}
            />
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loadError ? (
        <ErrorState error={loadError} onRetry={load} />
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* TAB 1: MUTAXASSISLAR RO'YXATI */}
          {tab === "specialists" && (
            filteredSpecialists.length === 0 ? (
              <Card className="text-center py-12 flex flex-col items-center justify-center">
                <p className="font-heading text-base font-bold text-ink">Mutaxassislar topilmadi</p>
                <p className="mt-1 max-w-md text-xs text-muted">
                  Kiritilgan mezonlar bo&apos;yicha birorta ham mutaxassis mos kelmadi. Filtrlarni o&apos;zgartirib ko&apos;ring yoki yangi ish e&apos;lonini joylashtiring.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Button variant="secondary" size="sm" onClick={clearAllFilters}>
                    Filtrlarni tozalash
                  </Button>
                  <Link href="/xaridor/my-jobs/yangi">
                    <Button size="sm">Ish e&apos;loni joylash</Button>
                  </Link>
                </div>
              </Card>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {pagedSpecialists.map((spec) => {
                  const specServices = servicesBySeller.get(spec.user.id) || [];
                  const isSaved = savedSpecialistIds.includes(spec.user.id);
                  const portfolioItems = spec.profile.portfolio || [];

                  return (
                    <Card
                      key={spec.user.id}
                      padding="lg"
                      hoverable
                      className="flex flex-col justify-between gap-4 border border-line transition-all duration-200 hover:shadow-card hover:border-primary/40"
                    >
                      <div className="flex flex-col gap-3">
                        {/* Header: Avatar, Name, Badges, Bookmark */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-3 min-w-0">
                            <Avatar
                              name={spec.user.fullName}
                              src={spec.user.avatarUrl || spec.profile.avatarUrl}
                              size="md"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Link
                                  href={`/bozor/mutaxassis/${spec.user.id}`}
                                  className="font-heading text-sm font-bold text-ink hover:text-primary transition-colors truncate"
                                >
                                  {spec.user.fullName}
                                </Link>
                                <TrustBadge badge={spec.profile.badge} />
                                {spec.profile.identityVerified && <IdentityVerifiedBadge />}
                              </div>
                              <p className="text-xs text-primary font-medium truncate mt-0.5">
                                {spec.profile.headline}
                              </p>
                              <div className="flex items-center gap-2 text-2xs text-muted mt-1">
                                {spec.profile.reviewCount > 0 ? (
                                  <>
                                    <RatingStars value={spec.profile.rating} size="sm" />
                                    <span className="font-semibold text-ink">
                                      {spec.profile.rating.toFixed(1)}
                                    </span>
                                    <span>({spec.profile.reviewCount} ta sharh)</span>
                                  </>
                                ) : (
                                  <span className="text-muted font-normal">Yangi mutaxassis</span>
                                )}
                                <span>•</span>
                                <span className="font-medium text-ink">
                                  {spec.profile.completedContracts} ta ish
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Bookmark button */}
                          <button
                            type="button"
                            onClick={() => handleToggleSaveSpecialist(spec.user.id)}
                            aria-label={isSaved ? "Saqlanganlardan o'chirish" : "Saqlab qo'yish"}
                            className={`rounded-btn p-1.5 transition-colors shrink-0 ${
                              isSaved ? "text-primary bg-primary/10" : "text-muted hover:text-ink hover:bg-card-hover"
                            }`}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill={isSaved ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                            </svg>
                          </button>
                        </div>

                        {/* Bio */}
                        {spec.profile.bio && (
                          <p className="text-xs text-muted line-clamp-2 leading-relaxed">
                            {spec.profile.bio}
                          </p>
                        )}

                        {/* Skills Chips */}
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {spec.profile.skills.slice(0, 4).map((skill) => (
                            <span
                              key={skill}
                              className="px-2 py-0.5 rounded-full text-2xs bg-surface border border-line text-muted font-medium"
                            >
                              {skill}
                            </span>
                          ))}
                          {spec.profile.skills.length > 4 && (
                            <span className="text-2xs text-faint self-center">
                              +{spec.profile.skills.length - 4}
                            </span>
                          )}
                        </div>

                        {/* Portfolio Showcase Block */}
                        {portfolioItems.length > 0 && (
                          <div className="mt-1 rounded-card border border-line/70 bg-bg/50 p-2.5">
                            <div className="flex items-center justify-between text-2xs text-muted mb-2">
                              <span className="font-semibold text-ink flex items-center gap-1">
                                <span>🎨</span> Portfolio namunalari ({portfolioItems.length})
                              </span>
                              <span className="text-primary hover:underline cursor-pointer">
                                Ko&apos;rish →
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {portfolioItems.slice(0, 2).map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() =>
                                    setViewingPortfolio({
                                      item,
                                      specialistName: spec.user.fullName,
                                      specialistId: spec.user.id,
                                    })
                                  }
                                  className="group flex flex-col text-left rounded-btn overflow-hidden border border-line bg-surface hover:border-primary transition-all"
                                >
                                  <div className="aspect-[16/10] w-full bg-surface-raised relative overflow-hidden">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={item.image}
                                      alt={item.title}
                                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                                    />
                                  </div>
                                  <div className="p-1.5">
                                    <p className="text-2xs font-semibold text-ink truncate group-hover:text-primary transition-colors">
                                      {item.title}
                                    </p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Ready Services Section: Har bir mutaxassis kartochkasida uning taklif qilayotgan tayyor xizmatlari */}
                        <div className="mt-1">
                          {specServices.length > 0 ? (
                            <div className="rounded-card border border-primary/20 bg-primary/5 p-3 flex flex-col gap-2">
                              <div className="flex items-center justify-between text-2xs">
                                <span className="font-bold text-primary-deep flex items-center gap-1">
                                  <span>⚡</span> Taklif qilayotgan xizmatlari ({specServices.length}):
                                </span>
                              </div>
                              <div className="flex flex-col gap-1.5">
                                {specServices.slice(0, 2).map((svc) => (
                                  <Link
                                    key={svc.id}
                                    href={`/bozor/xizmat/${svc.id}`}
                                    className="group flex items-center justify-between gap-2 p-1.5 rounded-btn bg-surface border border-line/60 hover:border-primary transition-colors text-xs"
                                  >
                                    <span className="font-medium text-ink group-hover:text-primary transition-colors truncate">
                                      {svc.title}
                                    </span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-2xs text-muted">
                                        {svc.deliveryDays} kun
                                      </span>
                                      <span className="font-bold text-primary text-2xs whitespace-nowrap">
                                        {formatMoney(svc.price, lang)}
                                      </span>
                                    </div>
                                  </Link>
                                ))}
                                {specServices.length > 2 && (
                                  <Link
                                    href={`/bozor/mutaxassis/${spec.user.id}`}
                                    className="text-2xs text-primary font-semibold hover:underline text-right mt-0.5"
                                  >
                                    va yana {specServices.length - 2} ta xizmat →
                                  </Link>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-card bg-surface/60 border border-line/50 p-2 text-2xs text-muted flex items-center justify-between">
                              <span>Maxsus buyurtmalar qabul qiladi</span>
                              <span className="text-ink font-semibold">Kelishilgan narx</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer: Location, Availability, and Actions */}
                      <div className="border-t border-line pt-3 mt-1 flex flex-col gap-2.5">
                        <div className="flex items-center justify-between text-2xs text-muted">
                          <span>
                            {spec.profile.location || "O'zbekiston"} • {formatDate(spec.profile.memberSince, lang)} dan beri
                          </span>
                          <span
                            className={
                              spec.profile.available
                                ? "text-success font-semibold"
                                : "text-muted"
                            }
                          >
                            {spec.profile.available ? "● Yangi ishlarga tayyor" : "○ Hozir band"}
                          </span>
                        </div>

                        {/* Action buttons */}
                        <div className="grid grid-cols-3 gap-2">
                          <Link href={`/bozor/mutaxassis/${spec.user.id}`} className="w-full">
                            <Button variant="secondary" size="sm" className="w-full text-xs font-medium">
                              Profil
                            </Button>
                          </Link>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-full text-xs font-medium"
                            onClick={() => setMessageSpecialist(spec)}
                          >
                            💬 Xabar
                          </Button>
                          <Button
                            size="sm"
                            className="w-full text-xs font-semibold"
                            onClick={() => setOfferSpecialist(spec)}
                          >
                            Taklif
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {/* TAB 2: XIZMATLAR RO'YXATI */}
          {tab === "services" && (
            filteredServices.length === 0 ? (
              <Card className="text-center py-12 flex flex-col items-center justify-center">
                <p className="font-heading text-base font-bold text-ink">Xizmatlar topilmadi</p>
                <p className="mt-1 max-w-md text-xs text-muted">
                  Kiritilgan filtrlar bo&apos;yicha birorta ham tayyor xizmat topilmadi.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Button variant="secondary" size="sm" onClick={clearAllFilters}>
                    Filtrlarni tozalash
                  </Button>
                  <Link href="/xaridor/my-jobs/yangi">
                    <Button size="sm">Ish e&apos;loni joylash</Button>
                  </Link>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {pagedServices.map((service) => {
                  const spec = specialists?.find((s) => s.user.id === service.sellerId);

                  return (
                    <Card
                      key={service.id}
                      padding="none"
                      hoverable
                      className="group relative flex h-full flex-col overflow-hidden border border-line hover:border-primary/50 transition-all shadow-xs hover:shadow-card"
                    >
                      <Link
                        href={`/bozor/xizmat/${service.id}`}
                        className="absolute inset-0 z-10 rounded-card"
                        aria-label={service.title}
                      />
                      <div className="relative z-0 flex flex-1 flex-col gap-2.5 p-5 pointer-events-none">
                        <div className="flex items-center justify-between gap-2">
                          <Badge tone="primary">{t(`cat.${service.category}`) || service.category}</Badge>
                          <span className="text-2xs text-muted">
                            {service.deliveryDays} {t("common.days") || "kun"}
                          </span>
                        </div>

                        <h3 className="font-heading text-sm font-bold text-ink group-hover:text-primary transition-colors line-clamp-2">
                          {service.title}
                        </h3>

                        <p className="line-clamp-2 text-xs text-muted leading-relaxed">
                          {service.description}
                        </p>

                        {/* Specialist Info */}
                        {spec && (
                          <div className="flex items-center gap-2 pt-2 border-t border-line/60 mt-1 pointer-events-auto relative z-20">
                            <Link href={`/bozor/mutaxassis/${spec.user.id}`} className="flex items-center gap-2 group/spec">
                              <Avatar
                                name={spec.user.fullName}
                                src={spec.user.avatarUrl || spec.profile.avatarUrl}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-ink group-hover/spec:text-primary transition-colors truncate">
                                  {spec.user.fullName}
                                </p>
                                <div className="flex items-center gap-1 text-2xs text-muted">
                                  <span>★ {spec.profile.rating.toFixed(1)}</span>
                                  <span>•</span>
                                  <span>{spec.profile.completedContracts} ta ish</span>
                                </div>
                              </div>
                            </Link>
                          </div>
                        )}

                        <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs">
                          <div>
                            <span className="text-2xs text-muted block">Boshlang&apos;ich narx:</span>
                            <span className="font-heading text-sm font-bold text-primary">
                              {formatMoney(service.price, lang)}
                            </span>
                          </div>
                          <span className="inline-flex items-center justify-center rounded-btn bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink border border-line group-hover:bg-primary group-hover:text-white transition-colors">
                            Ko&apos;rish →
                          </span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {/* Unified Pagination */}
          {!loading && currentItemsCount > PER_PAGE && (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onChange={setPage}
              labels={{
                prev: t("pager.prev") || "Oldingi",
                next: t("pager.next") || "Keyingi",
                page: t("pager.page") || "Sahifa",
                nav: t("a11y.pagination") || "Sahifalar",
              }}
            />
          )}
        </>
      )}

      {/* Lightbox Modal for Portfolio Details */}
      {viewingPortfolio && (
        <Modal
          open={true}
          onClose={() => setViewingPortfolio(null)}
          title={viewingPortfolio.item.title}
          footer={
            <div className="flex w-full items-center justify-between">
              <Button variant="secondary" size="sm" onClick={() => setViewingPortfolio(null)}>
                {t("common.close") || "Yopish"}
              </Button>
              <Link href={`/bozor/mutaxassis/${viewingPortfolio.specialistId}`}>
                <Button size="sm">
                  {viewingPortfolio.specialistName} profilini ko&apos;rish
                </Button>
              </Link>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewingPortfolio.item.image}
              alt={viewingPortfolio.item.title}
              className="max-h-96 w-full rounded-card border border-line object-cover"
            />
            {viewingPortfolio.item.category && (
              <Badge tone="primary" className="self-start">
                {t(`cat.${viewingPortfolio.item.category}`) || viewingPortfolio.item.category}
              </Badge>
            )}
            {viewingPortfolio.item.description && (
              <p className="text-sm text-muted leading-relaxed">
                {viewingPortfolio.item.description}
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Direct Offer Modal from Specialist Card */}
      {offerSpecialist && (
        <OfferModal
          open={!!offerSpecialist}
          onClose={() => setOfferSpecialist(null)}
          sellerId={offerSpecialist.user.id}
          mode="offer"
        />
      )}

      {/* Direct Message Modal from Specialist Card */}
      {messageSpecialist && (
        <OfferModal
          open={!!messageSpecialist}
          onClose={() => setMessageSpecialist(null)}
          sellerId={messageSpecialist.user.id}
          mode="message"
        />
      )}
    </div>
  );
}
