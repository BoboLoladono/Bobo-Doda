"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { BackButton } from "@/components/ui/BackButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Modal } from "@/components/ui/Modal";
import { RatingStars } from "@/components/ui/RatingStars";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { TrustBadge } from "@/components/ui/TrustBadge";
import { IdentityVerifiedBadge } from "@/components/ui/IdentityVerifiedBadge";
import { contractsService, reviewsService, servicesService, usersService } from "@/lib/api";
import type { Contract, PortfolioItem, Review, SellerProfile, Service, User } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

export default function ProfilPage() {
  const { t, lang } = useT();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [viewingPortfolio, setViewingPortfolio] = useState<PortfolioItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  /* Yuklash xatosi ALOHIDA holat. Ilgari bu yerda `.catch()` yo'q edi:
     bitta so'rov yiqilsa `setLoading(false)` hech qachon chaqirilmasdi va
     sahifa abadiy skeletonda qolib ketardi (ustiga ushlanmagan promise
     rejection ham chiqardi). Backend'da bu — sessiya tugashi yoki tarmoq
     uzilishining eng ehtimolli natijasi. */
  const load = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    Promise.all([
      usersService.getCurrent(),
      usersService.getSellerProfile(),
      servicesService.listMine(),
      reviewsService.listMine(),
      contractsService.list(),
    ])
      .then(([u, p, s, r, c]) => {
        setUser(u);
        setProfile(p);
        setServices(s.filter((svc) => svc.status === "active"));
        setReviews(r);
        setContracts(c);
      })
      .catch(setLoadError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const buyerByContract = new Map(contracts.map((c) => [c.id, c.buyerName]));

  if (loadError) {
    return <ErrorState error={loadError} onRetry={load} />;
  }

  if (loading || !profile) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  /* Platformada bo'lgan muddat */
  const memberMonths = Math.max(
    1,
    Math.round(
      (Date.now() - new Date(profile.memberSince).getTime()) /
        (1000 * 60 * 60 * 24 * 30)
    )
  );
  const memberDuration =
    memberMonths >= 12
      ? `${Math.floor(memberMonths / 12)} ${t("common.years")}`
      : `${memberMonths} ${t("common.months")}`;

  /* Sharhlar bo'yicha yulduzlar taqsimoti */
  const reviewCount = reviews.length;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => Math.round(r.rating) === star).length,
  }));

  const stats = [
    { label: t("profile.statRating"), value: profile.reviewCount > 0 ? profile.rating.toFixed(1) : "—" },
    { label: t("profile.statCompleted"), value: String(profile.completedContracts) },
    {
      label: t("profile.statResponse"),
      value: `${profile.responseTimeHours} ${t("common.hours")}`,
    },
    { label: t("profile.statMember"), value: memberDuration },
    ...(profile.completionRate !== undefined
      ? [{ label: t("profile.statCompletionRate"), value: `${profile.completionRate}%` }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <BackButton href="/mutaxassis" label={t("nav.dashboard")} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-ink">
            {t("profile.title")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("profile.publicNote")}</p>
        </div>
        <Link
          href="/mutaxassis/settings"
          className="inline-flex h-9 items-center gap-2 rounded-btn border border-line bg-card px-3.5 text-xs font-medium text-ink transition-colors duration-150 hover:bg-card-hover"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M11.5 2.5l2 2L6 12l-2.7.7L4 10l7.5-7.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          {t("profile.edit")}
        </Link>
      </div>

      {/* Profil sarlavhasi */}
      <Card padding="lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar name={user?.fullName ?? "?"} src={user?.avatarUrl} size="lg" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-heading text-xl font-bold text-ink">
                {user?.fullName}
              </h2>
              <TrustBadge badge={profile.badge} />
              {profile.identityVerified && <IdentityVerifiedBadge />}
              <Badge tone={profile.available ? "success" : "neutral"}>
                {t(profile.available ? "avail.on" : "avail.off")}
              </Badge>
            </div>
            {profile.headline && (
              <p className="mt-1 text-sm font-medium text-ink">{profile.headline}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-faint">
                  <path d="M8 1.8c2.5 0 4.5 2 4.5 4.5 0 3-4.5 7.4-4.5 7.4S3.5 9.3 3.5 6.3C3.5 3.8 5.5 1.8 8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <circle cx="8" cy="6.3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                {profile.location}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Asosiy ko'rsatkichlar */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-2xs font-medium uppercase tracking-wide text-faint">
              {stat.label}
            </p>
            <p className="mt-2 font-heading text-xl font-bold text-ink">
              {stat.value}
            </p>
          </Card>
        ))}
      </div>

      {/* Men haqimda + ko'nikmalar */}
      <Card padding="lg" className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-bold text-ink">
            {t("profile.about")}
          </h2>
          <p className="mt-2 whitespace-pre-line break-words [overflow-wrap:anywhere] text-sm text-muted">
            {profile.bio}
          </p>
        </div>
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-faint">
            {t("profile.skills")}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {profile.skills.map((skill) => (
              <Badge key={skill} tone="primary">
                {skill}
              </Badge>
            ))}
          </div>
        </div>
      </Card>

      {/* Tillar */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">
          {t("profile.languages")}
        </h2>
        {profile.languages.length === 0 ? (
          <EmptyState
            title={t("profile.noLanguages")}
            description="Mijozlar bilan muloqot qila olishingizni ko'rsatish uchun tillarni qo'shing."
            action={
              <Link href="/mutaxassis/settings?tab=languages">
                <Button size="sm" variant="secondary">
                  Til qo'shish
                </Button>
              </Link>
            }
          />
        ) : (
          <Card padding="none">
            {profile.languages.map((lng, i) => (
              <div
                key={lng.name}
                className={`flex items-center justify-between gap-3 p-4 ${
                  i > 0 ? "border-t border-line" : ""
                }`}
              >
                <span className="text-sm font-medium text-ink">{lng.name}</span>
                <span className="text-xs text-muted">{t(`lang.${lng.level}`)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Xizmatlar */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">
          {t("profile.services")}
        </h2>
        {services.length === 0 ? (
          <EmptyState
            title={t("profile.noServices")}
            description="Mijozlar buyurtma berishi uchun o'z xizmatlaringizni qo'shing."
            action={
              <Link href="/mutaxassis/services/yangi">
                <Button size="sm">Yangi xizmat yaratish</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {services.map((service) => (
              <Card key={service.id} hoverable className="flex flex-col gap-2">
                <Badge tone="primary" className="self-start">
                  {t(`cat.${service.category}`)}
                </Badge>
                <h3 className="font-heading text-sm font-bold text-ink">
                  {service.title}
                </h3>
                <p className="line-clamp-2 text-xs text-muted">
                  {service.description}
                </p>
                <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs">
                  <span className="font-medium text-ink">
                    {formatMoney(service.price, lang)}
                  </span>
                  <span className="text-faint">
                    {service.deliveryDays} {t("common.days")}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Portfolio — bajarilgan ishlar */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">
          {t("profile.portfolio")}
        </h2>
        {profile.portfolio.length === 0 ? (
          <EmptyState
            title={t("profile.noPortfolio")}
            description="Bajarilgan ishlar namunalari mijozlar ishonchini sezilarli darajada oshiradi."
            action={
              <Link href="/mutaxassis/settings?tab=portfolio">
                <Button size="sm">Portfolio qo'shish</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profile.portfolio.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewingPortfolio(item)}
                className="group flex flex-col overflow-hidden rounded-card border border-line bg-card text-left shadow-xs transition-all hover:border-primary hover:shadow-card"
              >
                <div className="relative aspect-[3/2] w-full overflow-hidden border-b border-line bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded-btn bg-white/90 px-3 py-1 text-xs font-semibold text-ink shadow-card">
                      {t("profile.viewWork")} →
                    </span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  {item.category && (
                    <Badge tone="primary" className="self-start">
                      {t(`cat.${item.category}`)}
                    </Badge>
                  )}
                  <h3 className="font-heading text-sm font-bold text-ink group-hover:text-primary transition-colors">
                    {item.title}
                  </h3>
                  <p className="line-clamp-2 text-xs text-muted">{item.description}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Sharhlar */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">
          {t("profile.reviews")}
        </h2>
        {reviews.length === 0 ? (
          <EmptyState
            title={t("profile.noReviews")}
            description="Buyurtmalarni muvaffaqiyatli topshirganingizdan so'ng mijozlar sharhlari shu yerda ko'rinadi."
          />
        ) : (
          <>
            {/* Reyting xulosasi + taqsimot */}
            <Card padding="lg">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex flex-col items-center justify-center gap-1 sm:w-40 sm:shrink-0">
                  <span className="font-heading text-4xl font-extrabold text-ink">
                    {profile.rating.toFixed(1)}
                  </span>
                  <RatingStars value={profile.rating} />
                  <span className="text-2xs text-faint">
                    {reviewCount} {t("profile.reviews").toLowerCase()} · {t("profile.reviewsAvg")}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  {distribution.map((row) => (
                    <div key={row.star} className="flex items-center gap-2 text-2xs">
                      <span className="w-3 text-faint">{row.star}</span>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="#15803D" aria-hidden="true">
                        <path d="M8 1.5l2 4.1 4.5.6-3.3 3.2.8 4.5L8 11.8l-4 2.1.8-4.5L1.5 6.2 6 5.6 8 1.5Z" />
                      </svg>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card-hover">
                        <div
                          className="h-full rounded-full bg-warning transition-all duration-150"
                          style={{
                            width: `${reviewCount ? (row.count / reviewCount) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="w-4 text-right text-faint">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Sharhlar ro'yxati */}
            <div className="flex flex-col gap-4">
              {reviews.map((review) => {
                const buyerName =
                  review.buyerName ?? buyerByContract.get(review.contractId);
                return (
                  <Card key={review.id} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        {buyerName && <Avatar name={buyerName} size="sm" />}
                        <div>
                          {buyerName && (
                            <p className="text-xs font-medium text-ink">{buyerName}</p>
                          )}
                          <RatingStars value={review.rating} />
                        </div>
                      </div>
                      <span className="text-2xs text-faint">
                        {formatDate(review.createdAt, lang)}
                      </span>
                    </div>
                    <p className="text-sm text-muted">{review.comment}</p>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Portfolio Item Lightbox Modal */}
      {viewingPortfolio && (
        <Modal
          open={true}
          onClose={() => setViewingPortfolio(null)}
          title={viewingPortfolio.title}
          footer={
            <Button
              variant="secondary"
              onClick={() => setViewingPortfolio(null)}
            >
              {t("common.close")}
            </Button>
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
    </div>
  );
}
