"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { TrustBadge } from "@/components/ui/TrustBadge";
import { useToast } from "@/components/ui/Toast";
import { authService, catalogService, contractsService, servicesService } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { Service, Specialist } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

interface MilestoneRow {
  title: string;
  amount: string;
}

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function XizmatTafsilotiPage() {
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [service, setService] = useState<Service | null | undefined>(undefined);
  const [specialist, setSpecialist] = useState<Specialist | null>(null);
  const [otherServices, setOtherServices] = useState<Service[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isBuyer, setIsBuyer] = useState(false);

  useEffect(() => {
    setIsBuyer(authService.getSession()?.role === "xaridor");
  }, []);

  const [buyOpen, setBuyOpen] = useState(false);
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [rows, setRows] = useState<MilestoneRow[]>([]);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeyRef = useRef<string>("");

  const load = useCallback(() => {
    setLoadError(null);
    servicesService
      .get(params.id)
      .then(async (found) => {
        if (found && (found.status === "active" || found.status === "pending_review" || found.status === "draft")) {
          setService(found);
          const [allServices, spec] = await Promise.all([
            servicesService.listPublic().catch(() => []),
            catalogService.getSpecialist(found.sellerId).catch(() => null),
          ]);
          setOtherServices(allServices.filter((s) => s.sellerId === found.sellerId && s.id !== found.id));
          setSpecialist(spec);
        } else {
          setService(null);
          setSpecialist(null);
        }
      })
      .catch(setLoadError);
  }, [params.id]);

  useEffect(load, [load]);

  if (service === undefined) {
    return loadError ? <ErrorState error={loadError} onRetry={load} /> : <SkeletonCard />;
  }
  if (service === null)
    return (
      <EmptyState
        title={t("svc.notFound")}
        description="Ushbu xizmat mavjud emas yoki muallif tomonidan to'xtatilgan bo'lishi mumkin."
        action={
          <Link href={isBuyer ? "/xaridor/mutaxassislar?tab=services" : "/bozor?tab=services"}>
            <Button size="sm">Barcha xizmatlarni ko'rish</Button>
          </Link>
        }
      />
    );

  function openBuyModal() {
    idempotencyKeyRef.current = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
    setRows([{ title: t("hire.defaultMilestone"), amount: String(service!.price) }]);
    setDeadline(defaultDeadline());
    setFormError("");
    setBuyOpen(true);
  }

  function addRow() {
    setRows((prev) => [...prev, { title: "", amount: "0" }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, patch: Partial<MilestoneRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const rowsSum = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const sumMatches = service && rowsSum === service.price;

  async function handleBuy() {
    if (!service) return;
    if (rows.some((r) => !r.title.trim())) {
      setFormError(t("hire.errTitle"));
      return;
    }
    if (rows.some((r) => Number(r.amount) < 1000)) {
      setFormError(t("purchase.errMilestoneMin"));
      return;
    }
    if (!sumMatches) {
      setFormError(t("purchase.errSumMismatch"));
      return;
    }
    const deadlineDate = new Date(`${deadline}T00:00:00`);
    if (Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
      setFormError(t("hire.errDue"));
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const contract = await contractsService.create(
        {
          serviceId: service.id,
          deadline: deadlineDate.toISOString(),
          milestones: rows.map((r) => ({ title: r.title.trim(), amount: Number(r.amount) })),
        },
        idempotencyKeyRef.current,
      );
      toast(t("purchase.created"));
      router.push(`/xaridor/contracts/${contract.id}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      toast(code === "SELLER_NOT_APPROVED" ? t("purchase.errSellerNotApproved") : t("common.error"), "error");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      <Breadcrumb
        items={
          isBuyer
            ? [
                { label: t("nav.specialists") || "Mutaxassislar", href: "/xaridor/mutaxassislar" },
                { label: t("nav.bozorServices") || "Xizmatlar", href: "/xaridor/mutaxassislar?tab=services" },
                { label: service.title },
              ]
            : [
                { label: t("nav.market"), href: "/bozor" },
                { label: t(`cat.${service.category}`), href: "/bozor" },
                { label: service.title },
              ]
        }
      />

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Badge tone="primary" className="self-start">
              {t(`cat.${service.category}`)}
            </Badge>
            <h1 className="font-heading text-2xl font-extrabold text-ink sm:text-3xl">{service.title}</h1>
          </div>

          <Card padding="lg" className="flex flex-col gap-5">
            <div>
              <h2 className="font-heading text-base font-bold text-ink">{t("svc.about")}</h2>
              <p className="mt-2.5 whitespace-pre-line text-sm leading-relaxed text-muted">{service.description}</p>
            </div>
          </Card>

          <Card padding="lg" className="flex flex-col gap-4 border-primary/20 bg-primary/5">
            <h2 className="font-heading text-base font-bold text-ink">{t("svc.includedTitle")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-success font-bold">✓</span>
                <div>
                  <p className="font-medium text-ink">{t("svc.deliveryGuarantee")}</p>
                  <p className="text-2xs text-muted">
                    {service.deliveryDays} {t("common.days")}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {otherServices.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-heading text-lg font-bold text-ink">{t("svc.otherServices")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {otherServices.map((other) => (
                  <Link key={other.id} href={`/bozor/xizmat/${other.id}`} className="group block">
                    <Card hoverable className="flex h-full flex-col justify-between gap-3 p-4">
                      <div className="flex flex-col gap-1.5">
                        <Badge tone="primary" className="self-start">
                          {t(`cat.${other.category}`)}
                        </Badge>
                        <h3 className="font-heading text-xs font-bold text-ink group-hover:text-primary transition-colors">{other.title}</h3>
                        <p className="line-clamp-2 text-2xs text-muted">{other.description}</p>
                      </div>
                      <div className="flex items-center justify-between border-t border-line pt-2.5 text-xs">
                        <span className="font-heading font-bold text-primary">{formatMoney(other.price, lang)}</span>
                        <span className="text-2xs text-muted">
                          {other.deliveryDays} {t("common.days")}
                        </span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-24">
          <Card padding="lg" className="flex flex-col gap-4 border-2 border-primary/20 shadow-card">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-muted">{t("svc.price")}</p>
              <p className="mt-1 font-heading text-2xl font-black text-primary">{formatMoney(service.price, lang)}</p>
            </div>

            <div className="flex flex-col gap-2 rounded-input border border-line bg-surface p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">{t("svc.delivery")}</span>
                <span className="font-bold text-ink">
                  {service.deliveryDays} {t("common.days")}
                </span>
              </div>
            </div>

            <Button size="lg" className="w-full justify-center shadow-btn" onClick={openBuyModal}>
              {t("svc.orderCta")} →
            </Button>
          </Card>

          {/* Mutaxassis (Sotuvchi) kartasi */}
          {specialist && (
            <Card padding="md" className="flex flex-col gap-3">
              <p className="text-2xs font-bold uppercase tracking-wider text-muted">Mutaxassis</p>
              <Link
                href={`/bozor/mutaxassis/${specialist.user.id}`}
                className="group flex items-center gap-3"
              >
                <Avatar
                  name={specialist.user.fullName}
                  src={specialist.user.avatarUrl || specialist.profile.avatarUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm text-ink group-hover:text-primary transition-colors truncate">
                      {specialist.user.fullName}
                    </p>
                    <TrustBadge badge={specialist.profile.badge} />
                  </div>
                  <p className="text-xs text-muted truncate">{specialist.profile.headline}</p>
                  <div className="mt-1 flex items-center gap-2 text-2xs text-muted">
                    <span className="font-bold text-amber-500">★ {specialist.profile.rating > 0 ? specialist.profile.rating.toFixed(1) : "—"}</span>
                    <span>•</span>
                    <span>{specialist.profile.completedContracts} ta ish</span>
                  </div>
                </div>
              </Link>
            </Card>
          )}

          <Card padding="md" className="border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <div className="rounded-btn bg-primary/10 p-2 text-primary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div>
                <h4 className="font-heading text-xs font-bold text-ink">{t("svc.escrowBadgeTitle")}</h4>
                <p className="mt-1 text-2xs text-muted leading-relaxed">{t("svc.escrowBadgeDesc")}</p>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      {/* Xarid — to'g'ridan-to'g'ri shartnoma yaratish */}
      <Modal
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        title={t("purchase.title")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBuyOpen(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button loading={submitting} onClick={handleBuy}>
              {t("purchase.submit")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted">{t("purchase.desc")}</p>

          <Input
            type="date"
            label={t("purchase.deadline")}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-ink">{t("purchase.milestones")}</span>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={row.title}
                  onChange={(e) => updateRow(i, { title: e.target.value })}
                  placeholder={t("hire.errTitle")}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={1000}
                  step={1000}
                  value={row.amount}
                  onChange={(e) => updateRow(i, { amount: e.target.value })}
                  className="w-32 font-mono"
                />
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(i)} className="shrink-0 text-danger px-1" aria-label={t("common.cancel")}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRow} className="self-start text-xs font-semibold text-primary hover:underline">
              + {t("purchase.addMilestone")}
            </button>
          </div>

          <div className={`flex items-center justify-between rounded-input border p-3 text-xs ${sumMatches ? "border-line bg-surface" : "border-danger/40 bg-danger/5"}`}>
            <span className="text-muted">{t("purchase.total")}</span>
            <span className={`font-heading font-bold ${sumMatches ? "text-ink" : "text-danger"}`}>
              {formatMoney(rowsSum, lang)} / {formatMoney(service.price, lang)}
            </span>
          </div>

          {formError && <p className="text-xs text-danger">{formError}</p>}
        </div>
      </Modal>
    </div>
  );
}
