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
import { Modal } from "@/components/ui/Modal";
import { RatingStars } from "@/components/ui/RatingStars";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { TrustBadge } from "@/components/ui/TrustBadge";
import { IdentityVerifiedBadge } from "@/components/ui/IdentityVerifiedBadge";
import { OfferModal } from "@/components/shared/OfferModal";
import { authService, catalogService, servicesService } from "@/lib/api";
import type { PortfolioItem, Review, Service, Specialist } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

export default function MutaxassisProfiliPage() {
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const [specialist, setSpecialist] = useState<Specialist | null | undefined>(
    undefined
  );
  const [services, setServices] = useState<Service[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [offerOpen, setOfferOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [viewingPortfolio, setViewingPortfolio] = useState<PortfolioItem | null>(null);
  const [selectedRatingFilter, setSelectedRatingFilter] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isBuyer, setIsBuyer] = useState(false);
  const [isSpecialist, setIsSpecialist] = useState(false);
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  useEffect(() => {
    const session = authService.getSession();
    setIsBuyer(session?.role === "xaridor");
    setIsSpecialist(session?.role === "mutaxassis");
    setIsOwnProfile(session?.userId === params.id);
  }, [params.id]);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      catalogService.getSpecialist(params.id),
      servicesService.listPublic(),
      catalogService.listSellerReviews(params.id),
    ])
      .then(([spec, allServices, reviewList]) => {
        setSpecialist(spec);
        setServices(allServices.filter((s) => s.sellerId === params.id || (s.sellerId === "me" && spec?.user?.id === params.id)));
        setReviews(reviewList);
      })
      .catch(setLoadError);
  }, [params.id]);

  useEffect(load, [load]);

  if (specialist === undefined) {
    return loadError ? (
      <ErrorState error={loadError} onRetry={load} />
    ) : (
      <SkeletonCard />
    );
  }
  if (specialist === null)
    return (
      <EmptyState
        title={t("spec.notFound")}
        description="Ushbu mutaxassis profili mavjud emas yoki o'chirilgan bo'lishi mumkin."
        action={
          <Link href={isBuyer ? "/xaridor/mutaxassislar" : "/bozor?tab=specialists"}>
            <Button size="sm">Barcha mutaxassislarni ko'rish</Button>
          </Link>
        }
      />
    );

  const { user, profile } = specialist;

  /* Filtered reviews */
  const filteredReviews = selectedRatingFilter === null
    ? reviews
    : reviews.filter((r) => Math.round(r.rating) === selectedRatingFilter);

  const ratingCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => Math.round(r.rating) === star).length,
  }));

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Top Breadcrumb Navigation with Back Button */}
      <Breadcrumb
        items={
          isBuyer
            ? [
                { label: t("nav.specialists") || "Mutaxassislar", href: "/xaridor/mutaxassislar" },
                { label: user.fullName },
              ]
            : [
                { label: t("nav.market"), href: "/bozor" },
                { label: t("market.tabSpecialists"), href: "/bozor?tab=specialists" },
                { label: user.fullName },
              ]
        }
      />

      {/* Main Grid: Left Details + Right Sticky Conversion Sidebar */}
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px]">
        {/* Left Column */}
        <div className="flex flex-col gap-6">
          {/* Header Card */}
          <Card padding="lg">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <Avatar name={user.fullName} src={user.avatarUrl || profile.avatarUrl} size="lg" />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-heading text-2xl font-extrabold text-ink">
                    {user.fullName}
                  </h1>
                  <TrustBadge badge={profile.badge} />
                  {profile.identityVerified && <IdentityVerifiedBadge />}
                  <Badge tone={profile.available ? "success" : "neutral"}>
                    {t(profile.available ? "avail.on" : "avail.off")}
                  </Badge>
                </div>
                {profile.headline && (
                  <p className="mt-1 text-sm font-semibold text-primary-deep">
                    {profile.headline}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                  <div className="flex items-center gap-1.5 font-bold text-ink">
                    {profile.reviewCount > 0 ? (
                      <>
                        <RatingStars value={profile.rating} showValue />
                        <span className="font-normal text-muted">({profile.reviewCount})</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted font-medium">Yangi mutaxassis (sharhlar yo&apos;q)</span>
                    )}
                  </div>
                  <span className="flex items-center gap-1">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {profile.completedContracts} {t("profile.completedContracts")}
                  </span>
                  {profile.location && (
                    <span className="flex items-center gap-1">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M8 1.8c2.5 0 4.5 2 4.5 4.5 0 3-4.5 7.4-4.5 7.4S3.5 9.3 3.5 6.3C3.5 3.8 5.5 1.8 8 1.8Z" stroke="currentColor" strokeWidth="1.3" />
                        <circle cx="8" cy="6.3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                      {profile.location}
                    </span>
                  )}
                  <span>
                    {t("profile.memberSince")} {formatDate(profile.memberSince, lang)}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* About Specialist */}
          <Card padding="lg" className="flex flex-col gap-5">
            <div>
              <h2 className="font-heading text-base font-bold text-ink">
                {t("profile.about")}
              </h2>
              <p className="mt-2.5 whitespace-pre-line break-words [overflow-wrap:anywhere] text-sm text-muted leading-relaxed">
                {profile.bio}
              </p>
            </div>

            {profile.skills.length > 0 && (
              <div className="border-t border-line pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-faint">
                  {t("profile.skills")}
                </h3>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {profile.skills.map((skill) => (
                    <Badge key={skill} tone="primary">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {profile.languages.length > 0 && (
              <div className="border-t border-line pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-faint">
                  {t("profile.languages")}
                </h3>
                <div className="mt-2.5 flex flex-wrap gap-3">
                  {profile.languages.map((lng) => (
                    <div
                      key={lng.name}
                      className="inline-flex items-center gap-2 rounded-input border border-line bg-surface px-3 py-1.5 text-xs"
                    >
                      <span className="font-medium text-ink">{lng.name}</span>
                      <span className="text-muted">· {t(`lang.${lng.level}`)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Portfolio Showcase */}
          {profile.portfolio.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold text-ink">
                  {t("profile.portfolio")}
                </h2>
                <span className="text-xs text-muted">
                  {profile.portfolio.length} {t("profile.portfolioCount")}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {profile.portfolio.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setViewingPortfolio(item)}
                    className="group flex flex-col overflow-hidden rounded-card border border-line bg-card text-left shadow-xs transition-all hover:border-primary hover:shadow-card"
                  >
                    <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-line bg-surface">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image}
                        alt={item.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="rounded-btn bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink shadow-card backdrop-blur-xs">
                          {t("profile.viewWork")} →
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-4">
                      {item.category && (
                        <Badge tone="primary" className="self-start">
                          {t(`cat.${item.category}`)}
                        </Badge>
                      )}
                      <h3 className="font-heading text-sm font-bold text-ink group-hover:text-primary transition-colors">
                        {item.title}
                      </h3>
                      {item.description && (
                        <p className="line-clamp-2 text-xs text-muted">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Active Services Showcase */}
          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-lg font-bold text-ink">
              {t("profile.services")}
            </h2>
            {services.length === 0 ? (
              <EmptyState
                title={t("profile.noServices")}
                description="Ushbu mutaxassis hali alohida xizmatlar joylashtirmagan. Siz unga to'g'ridan-to'g'ri loyiha taklifini yuborishingiz mumkin."
                action={
                  <Button size="sm" onClick={() => setOfferOpen(true)}>
                    Taklif yuborish
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {services.map((service) => (
                  <Link
                    key={service.id}
                    href={`/bozor/xizmat/${service.id}`}
                    className="group block"
                  >
                    <Card hoverable className="flex h-full flex-col justify-between gap-3 p-4">
                      <div className="flex flex-col gap-2">
                        <Badge tone="primary" className="self-start">
                          {t(`cat.${service.category}`)}
                        </Badge>
                        <h3 className="font-heading text-sm font-bold text-ink group-hover:text-primary transition-colors">
                          {service.title}
                        </h3>
                        <p className="line-clamp-2 text-xs text-muted">
                          {service.description}
                        </p>
                      </div>
                      <div className="flex items-center justify-between border-t border-line pt-3 text-xs">
                        <span className="font-heading text-sm font-bold text-primary">
                          {formatMoney(service.price, lang)}
                        </span>
                        <span className="text-muted flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          {service.deliveryDays} {t("common.days")}
                        </span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Reviews with Star Breakdown Filter */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-bold text-ink">
                {t("profile.reviews")} ({reviews.length})
              </h2>
              {/* Star Rating Distribution Filters */}
              {reviews.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setSelectedRatingFilter(null)}
                    className={`rounded-btn px-2.5 py-1 text-2xs font-semibold transition-colors ${
                      selectedRatingFilter === null
                        ? "bg-primary text-on-primary"
                        : "border border-line bg-card text-muted hover:text-ink"
                    }`}
                  >
                    {t("profile.filterReviewsAll")}
                  </button>
                  {ratingCounts
                    .filter((rc) => rc.count > 0)
                    .map((rc) => (
                      <button
                        key={rc.star}
                        type="button"
                        onClick={() =>
                          setSelectedRatingFilter(
                            selectedRatingFilter === rc.star ? null : rc.star
                          )
                        }
                        className={`rounded-btn px-2.5 py-1 text-2xs font-semibold transition-colors ${
                          selectedRatingFilter === rc.star
                            ? "bg-primary text-on-primary"
                            : "border border-line bg-card text-muted hover:text-ink"
                        }`}
                      >
                        ★ {rc.star} ({rc.count})
                      </button>
                    ))}
                </div>
              )}
            </div>

            {reviews.length === 0 ? (
              <EmptyState
                title={t("profile.noReviews")}
                description="Ushbu mutaxassis hali yakunlangan buyurtmalar bo'yicha sharh olmagan."
              />
            ) : filteredReviews.length === 0 ? (
              <div className="rounded-card border border-line bg-card p-6 text-center text-xs text-muted">
                Tanlangan yulduzlar bo&apos;yicha sharhlar mavjud emas.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredReviews.map((review) => (
                  <Card key={review.id} className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={review.buyerName || "?"} size="sm" />
                        <div>
                          <p className="text-xs font-semibold text-ink">
                            {review.buyerName || "Mijoz"}
                          </p>
                          <RatingStars value={review.rating} />
                        </div>
                      </div>
                      <span className="text-2xs text-faint">
                        {formatDate(review.createdAt, lang)}
                      </span>
                    </div>
                    <p className="text-xs text-muted leading-relaxed">
                      {review.comment}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Sticky Conversion Sidebar */}
        <aside className="flex flex-col gap-5 lg:sticky lg:top-24">
          {/* Main Action Card */}
          <Card padding="lg" className="flex flex-col gap-4 border-2 border-primary/20 bg-card shadow-card">
            <div>
              <span className="text-2xs font-bold uppercase tracking-wider text-primary-deep">
                {isOwnProfile ? "Sizning profilingiz" : "To'g'ridan-to'g'ri hamkorlik"}
              </span>
              <h3 className="mt-1 font-heading text-lg font-extrabold text-ink">
                {isOwnProfile ? "Profil boshqaruvi" : "Loyiha taklif qiling"}
              </h3>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                {isOwnProfile
                  ? "Xizmatlaringiz va portfoliongizni sozlamalar orqali tahrirlashingiz mumkin."
                  : "Maxsus talablaringiz va byudjetingizni kiritib mutaxassisga to'g'ridan-to'g'ri taklif yuboring."}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {isOwnProfile ? (
                <Link href="/mutaxassis/settings" className="w-full">
                  <Button size="md" className="w-full justify-center shadow-btn">
                    ⚙️ Profilni tahrirlash
                  </Button>
                </Link>
              ) : (
                <>
                  {!isSpecialist && (
                    <Button
                      size="lg"
                      onClick={() => setOfferOpen(true)}
                      className="w-full justify-center shadow-btn"
                    >
                      {t("offer.send")} →
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setMessageOpen(true)}
                    className="w-full justify-center text-xs"
                  >
                    💬 {t("market.sendMessageBtn")}
                  </Button>
                </>
              )}
            </div>

            {/* Quick Metrics */}
            <div className="flex flex-col divide-y divide-line rounded-input border border-line bg-surface text-xs">
              <div className="flex items-center justify-between p-3">
                <span className="text-muted">{t("settings.responseSpeed")}</span>
                <span className="font-bold text-ink">{profile.responseTimeHours} {t("common.hours")}</span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-muted">Bajarilgan shartnomalar</span>
                <span className="font-bold text-ink">{profile.completedContracts} ta</span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-muted">O&apos;rtacha reyting</span>
                <span className="font-bold text-primary">
                  {profile.reviewCount > 0 ? `★ ${profile.rating.toFixed(1)}` : "—"}
                </span>
              </div>
              {profile.completionRate !== undefined && (
                <div className="flex items-center justify-between p-3">
                  <span className="text-muted">{t("profile.statCompletionRate")}</span>
                  <span className="font-bold text-ink">{profile.completionRate}%</span>
                </div>
              )}
            </div>
          </Card>

          {/* 100% Escrow Guarantee Trust Card */}
          <Card padding="md" className="border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <div className="rounded-btn bg-primary/10 p-2 text-primary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div>
                <h4 className="font-heading text-xs font-bold text-ink">
                  {t("profile.trustTitle")}
                </h4>
                <ul className="mt-2 flex flex-col gap-1.5 text-2xs text-muted">
                  <li className="flex items-start gap-1.5">
                    <span className="text-success font-bold">✓</span>
                    <span>{t("profile.trustPoint1")}</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-success font-bold">✓</span>
                    <span>{t("profile.trustPoint2")}</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-success font-bold">✓</span>
                    <span>{t("profile.trustPoint3")}</span>
                  </li>
                </ul>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      {/* Interactive Portfolio Item Lightbox Modal */}
      {viewingPortfolio && (
        <Modal
          open={true}
          onClose={() => setViewingPortfolio(null)}
          title={viewingPortfolio.title}
          footer={
            <div className="flex w-full items-center justify-between">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setViewingPortfolio(null)}
              >
                {t("common.close")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setViewingPortfolio(null);
                  setOfferOpen(true);
                }}
              >
                {t("offer.send")}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewingPortfolio.image}
              alt={viewingPortfolio.title}
              className="max-h-96 w-full rounded-card border border-line object-cover"
            />
            {viewingPortfolio.category && (
              <Badge tone="primary" className="self-start">
                {t(`cat.${viewingPortfolio.category}`)}
              </Badge>
            )}
            {viewingPortfolio.description && (
              <p className="text-sm text-muted leading-relaxed">
                {viewingPortfolio.description}
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Taklif yuborish modali */}
      <OfferModal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        sellerId={user.id}
        mode="offer"
      />

      {/* Xabar yuborish modali */}
      <OfferModal
        open={messageOpen}
        onClose={() => setMessageOpen(false)}
        sellerId={user.id}
        mode="message"
      />
    </div>
  );
}
