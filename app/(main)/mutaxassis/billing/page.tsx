"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { Table } from "@/components/ui/Table";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ReceiptModal } from "@/components/shared/ReceiptModal";
import { contractsService, milestonesService, paymentsService } from "@/lib/api";
import type { Contract, Milestone, WithdrawalRequest } from "@/lib/types";
import { formatDate, formatMonth, formatMoney } from "@/lib/format";
import { sellerNet } from "@/lib/fees";
import { useT } from "@/lib/i18n";

const PENDING_STATUSES = ["mablaglangan", "topshirildi", "ozgartirish_soraldi"];

export default function DaromadPage() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [available, setAvailable] = useState(0);
  const [receiptMilestone, setReceiptMilestone] = useState<Milestone | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  // Manual Payout (Mablag'ni yechish) holatlari
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [myWithdrawals, setMyWithdrawals] = useState<WithdrawalRequest[]>([]);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      milestonesService.listMine(),
      contractsService.list(),
      paymentsService.getBalance(),
      paymentsService.listMyWithdrawalRequests(),
    ])
      .then(([milestoneList, contractList, availableBalance, withdrawals]) => {
        setMilestones(milestoneList);
        setContracts(contractList);
        setMyWithdrawals(withdrawals);

        // The ledger already reserves pending payouts and debits completed ones.
        // Zero is an authoritative balance, not a reason to restore old earnings.
        setAvailable(availableBalance);
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  const contractById = new Map(contracts.map((c) => [c.id, c]));

  const paid = (milestones ?? []).filter((m) => m.status === "qabul_qilindi");
  /* Brutto — shartnomada kelishilgan summa; sof — xizmat haqi ushlangandan
     keyingisi. Ikkalasi ham ko'rsatiladi: mutaxassis nima uchun qancha
     ushlanganini ko'rmasa, escrow'ga ishonch yo'qoladi. */
  const grossPaid = paid.reduce((sum, m) => sum + m.amount, 0);
  const totalPaid = paid.reduce((sum, m) => sum + sellerNet(m.amount, m.platformFeeRateBps), 0);
  const feeWithheld = grossPaid - totalPaid;
  const totalPending = (milestones ?? [])
    .filter((m) => {
      const status = contractById.get(m.contractId)?.status;
      return PENDING_STATUSES.includes(m.status) && (status === "faol" || status === "nizo");
    })
    .reduce((sum, m) => sum + sellerNet(m.amount, m.platformFeeRateBps), 0);

  const payments = [...paid].sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));

  /* Oxirgi 6 oy bo'yicha daromad — approvedAt'ga qarab guruhlangan
     (bo'sh oylar ham ko'rsatiladi, tendensiya ko'rinishi uchun) */
  const monthlyTotals = new Map<string, number>();
  for (const m of paid) {
    if (!m.approvedAt) continue;
    const key = m.approvedAt.slice(0, 7);
    monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + sellerNet(m.amount, m.platformFeeRateBps));
  }
  const now = new Date();
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { key, amount: monthlyTotals.get(key) ?? 0 };
  });
  const monthlyMax = Math.max(1, ...monthly.map((m) => m.amount));

  const handleCardNumberChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 16);
    const formatted = cleaned.match(/.{1,4}/g)?.join(" ") || cleaned;
    setCardNumber(formatted);
  };

  async function handleWithdrawSubmit() {
    const rawNumber = cardNumber.replace(/\D/g, "");
    if (rawNumber.length !== 16) {
      setWithdrawError("16 xonali karta raqamini to'liq kiriting (Uzcard yoki Humo).");
      return;
    }
    if (!cardHolder.trim() || cardHolder.trim().length < 3) {
      setWithdrawError("Karta egasining to'liq ism va familiyasini kiriting.");
      return;
    }
    const amt = Number(withdrawAmount);
    if (!amt || isNaN(amt) || amt <= 0) {
      setWithdrawError("Mablag' summasini to'g'ri kiriting.");
      return;
    }
    if (amt > available) {
      setWithdrawError(`Mablag' yetarli emas. Siz yechishingiz mumkin bo'lgan maksimal summa: ${formatMoney(available, lang)}`);
      return;
    }

    setWithdrawBusy(true);
    setWithdrawError("");
    try {
      const cardType = rawNumber.startsWith("8600") ? "Uzcard" : rawNumber.startsWith("9860") ? "Humo" : "Karta";
      const maskedCard = `${cardType} (${rawNumber.slice(0, 4)} •••• •••• ${rawNumber.slice(12)}) — ${cardHolder.trim().toUpperCase()}`;
      await paymentsService.withdrawEarnings(maskedCard, amt);
      toast("Pul yechish arizangiz muvaffaqiyatli qabul qilindi! 24 soat ichida ko'rib chiqiladi.");
      setWithdrawOpen(false);
      setCardNumber("");
      setCardHolder("");
      setWithdrawAmount("");
      load();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "So'rov yuborishda xatolik yuz berdi");
    } finally {
      setWithdrawBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <BackButton href="/mutaxassis" label={t("nav.dashboard")} />
      </div>
      <h1 className="font-heading text-2xl font-extrabold text-ink">{t("earn.title")}</h1>

      {loadError ? (
        <ErrorState error={loadError} onRetry={load} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {!milestones ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-6 w-32" />
                </Card>
              ))
            ) : (
              <>
                <Card>
                  <p className="text-2xs font-medium uppercase tracking-wide text-faint">{t("earn.paid")}</p>
                  <p className="mt-2 font-heading text-xl font-bold text-success">{formatMoney(totalPaid, lang)}</p>
                  {feeWithheld > 0 && (
                    <p className="mt-1 text-2xs text-faint">
                      {formatMoney(grossPaid, lang)} − {t("earn.feeLabel")} ({formatMoney(feeWithheld, lang)})
                    </p>
                  )}
                </Card>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-2xs font-medium uppercase tracking-wide text-faint">{t("earn.withdrawable")}</p>
                      <p className="mt-2 font-heading text-xl font-bold text-ink">{formatMoney(available, lang)}</p>
                      <p className="mt-1 text-2xs text-faint">{t("earn.balanceHint")}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={available <= 0}
                      onClick={() => {
                        setWithdrawError("");
                        setWithdrawAmount(available > 0 ? String(available) : "");
                        setWithdrawOpen(true);
                      }}
                      className="shrink-0"
                    >
                      Mablag&apos;ni yechish
                    </Button>
                  </div>
                </Card>
                <Card>
                  <p className="text-2xs font-medium uppercase tracking-wide text-faint">{t("earn.pending")}</p>
                  <p className="mt-2 font-heading text-xl font-bold text-ink">{formatMoney(totalPending, lang)}</p>
                  <p className="mt-1 text-2xs text-faint">{t("earn.pendingHint")}</p>
                </Card>
              </>
            )}
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold text-ink">{t("earn.recent")}</h2>
            {!milestones ? (
              <SkeletonCard />
            ) : payments.length === 0 ? (
              <EmptyState
                title={t("earn.empty")}
                description="Hozircha daromad tarixi mavjud emas. Buyurtmalarni bajaring va mablag'laringizni xavfsiz qabul qiling."
                action={
                  <Link href="/bozor?tab=jobs">
                    <Button size="sm">Ish qidirish</Button>
                  </Link>
                }
              />
            ) : (
              <Table
                rows={payments}
                rowKey={(m) => m.id}
                columns={[
                  {
                    key: "date",
                    header: t("earn.colDate"),
                    render: (m) => <span className="text-muted">{m.approvedAt ? formatDate(m.approvedAt, lang) : "—"}</span>,
                  },
                  {
                    key: "contract",
                    header: t("earn.colContract"),
                    render: (m) => <span className="block max-w-64 truncate">{contractById.get(m.contractId)?.title ?? "—"}</span>,
                  },
                  {
                    key: "milestone",
                    header: t("earn.colMilestone"),
                    render: (m) => <span className="block max-w-56 truncate text-muted">{m.title}</span>,
                  },
                  {
                    key: "amount",
                    header: t("earn.colAmount"),
                    render: (m) => (
                      <span className="flex flex-col">
                        <span className="font-medium text-success">{formatMoney(sellerNet(m.amount, m.platformFeeRateBps), lang)}</span>
                        <span className="text-2xs text-faint">
                          {formatMoney(m.amount, lang)} − {(m.platformFeeRateBps ?? 500) / 100}%
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "receipt",
                    header: "",
                    render: (m) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReceiptMilestone(m)}
                        className="gap-1 text-2xs text-muted hover:text-ink px-2 py-1"
                        title={t("receipt.download")}
                      >
                        {t("receipt.download")}
                      </Button>
                    ),
                  },
                ]}
                renderMobileCard={(m) => (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-success">{formatMoney(sellerNet(m.amount, m.platformFeeRateBps), lang)}</span>
                      <span className="text-2xs text-faint">{m.approvedAt ? formatDate(m.approvedAt, lang) : "—"}</span>
                    </div>
                    <p className="truncate text-xs text-ink">{contractById.get(m.contractId)?.title ?? "—"}</p>
                    <div className="flex items-center justify-between pt-1">
                      <p className="truncate text-2xs text-muted">{m.title}</p>
                      <Button size="sm" variant="ghost" onClick={() => setReceiptMilestone(m)} className="text-2xs text-primary hover:underline p-0 h-auto">
                        {t("receipt.download")}
                      </Button>
                    </div>
                  </div>
                )}
              />
            )}
          </section>

          {myWithdrawals.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-heading text-lg font-bold text-ink">Pul yechish arizalari tarixi</h2>
              <Table
                rows={myWithdrawals}
                rowKey={(w) => w.id}
                columns={[
                  {
                    key: "date",
                    header: "Sana",
                    render: (w) => <span className="text-muted">{formatDate(w.createdAt, lang)}</span>,
                  },
                  {
                    key: "card",
                    header: "Karta / Tafsilot",
                    render: (w) => <span className="font-medium text-ink">{w.cardDetails || "Plastik karta"}</span>,
                  },
                  {
                    key: "amount",
                    header: "Summa",
                    render: (w) => <span className="font-semibold text-ink">{formatMoney(w.amount, lang)}</span>,
                  },
                  {
                    key: "status",
                    header: "Holat",
                    render: (w) => {
                      const tone: BadgeTone =
                        w.status === "tasdiqlangan"
                          ? "success"
                          : w.status === "rad_etilgan"
                            ? "danger"
                            : "warning";
                      const label =
                        w.status === "tasdiqlangan"
                          ? "O'tkazildi"
                          : w.status === "rad_etilgan"
                            ? "Rad etilgan"
                            : "Kutilmoqda";
                      return (
                        <div className="flex flex-col gap-0.5">
                          <Badge tone={tone}>{label}</Badge>
                          {w.rejectionReason && (
                            <span className="text-2xs text-danger">{w.rejectionReason}</span>
                          )}
                        </div>
                      );
                    },
                  },
                  {
                    key: "reference",
                    header: "Kvitansiya ID",
                    render: (w) => <span className="font-mono text-2xs text-faint">{w.payoutReference || w.id.slice(0, 12)}</span>,
                  },
                ]}
                renderMobileCard={(w) => {
                  const tone: BadgeTone =
                    w.status === "tasdiqlangan"
                      ? "success"
                      : w.status === "rad_etilgan"
                        ? "danger"
                        : "warning";
                  const label =
                    w.status === "tasdiqlangan"
                      ? "O'tkazildi"
                      : w.status === "rad_etilgan"
                        ? "Rad etilgan"
                        : "Kutilmoqda";
                  return (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-ink">{formatMoney(w.amount, lang)}</span>
                        <Badge tone={tone}>{label}</Badge>
                      </div>
                      <p className="text-xs text-muted">{w.cardDetails || "Plastik karta"}</p>
                      {w.rejectionReason && (
                        <p className="text-2xs text-danger">{w.rejectionReason}</p>
                      )}
                      <div className="flex items-center justify-between pt-1 text-2xs text-faint">
                        <span>{formatDate(w.createdAt, lang)}</span>
                        <span className="font-mono">{w.payoutReference || w.id.slice(0, 12)}</span>
                      </div>
                    </div>
                  );
                }}
              />
            </section>
          )}

          {milestones && paid.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-heading text-lg font-bold text-ink">{t("earn.monthlyBreakdown")}</h2>
              <Card>
                <div className="flex items-end justify-between gap-2 sm:gap-4">
                  {monthly.map((m) => (
                    <div key={m.key} className="flex flex-1 flex-col items-center gap-2">
                      <span className="text-2xs font-medium text-ink">{m.amount > 0 ? formatMoney(m.amount, lang) : "—"}</span>
                      <div className="flex h-24 w-full items-end rounded-input bg-bg">
                        <div
                          className="w-full rounded-input bg-primary transition-[height] duration-300"
                          style={{ height: `${Math.max(4, (m.amount / monthlyMax) * 100)}%` }}
                        />
                      </div>
                      <span className="text-2xs text-faint">{formatMonth(m.key, lang)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}
        </>
      )}

      <ReceiptModal
        open={!!receiptMilestone}
        onClose={() => setReceiptMilestone(null)}
        milestone={receiptMilestone}
        contractTitle={receiptMilestone ? contractById.get(receiptMilestone.contractId)?.title : undefined}
        contractId={receiptMilestone?.contractId}
        buyerName={receiptMilestone ? contractById.get(receiptMilestone.contractId)?.buyerName : undefined}
        sellerName={receiptMilestone ? contractById.get(receiptMilestone.contractId)?.sellerName : undefined}
      />

      <Modal
        open={withdrawOpen}
        onClose={() => !withdrawBusy && setWithdrawOpen(false)}
        title="Mablag'ni kartaga yechish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)} disabled={withdrawBusy}>
              Bekor qilish
            </Button>
            <Button
              variant="primary"
              loading={withdrawBusy}
              disabled={withdrawBusy || available <= 0}
              onClick={handleWithdrawSubmit}
            >
              Yechish so&apos;rovini yuborish
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-card border border-line bg-surface p-3 text-xs text-muted">
            <p className="font-medium text-ink">
              Mavjud balans: <span className="text-success font-semibold">{formatMoney(available, lang)}</span>
            </p>
            <p className="mt-1 text-2xs text-faint">
              Pul yechish arizasi ma&apos;muriyat tomonidan 24 soat ichida ko&apos;rib chiqiladi va Uzcard yoki Humo kartangizga to&apos;g&apos;ridan-to&apos;g&apos;ri o&apos;tkazib beriladi.
            </p>
          </div>

          <Input
            label="Karta raqami (Uzcard / Humo)"
            placeholder="8600 0000 0000 0000"
            value={cardNumber}
            onChange={(e) => handleCardNumberChange(e.target.value)}
            disabled={withdrawBusy}
          />

          <Input
            label="Karta egasining F.I.SH"
            placeholder="ALISHER VALIYEV"
            value={cardHolder}
            onChange={(e) => setCardHolder(e.target.value)}
            disabled={withdrawBusy}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink">Yechish summasi (so&apos;m)</label>
              {available > 0 && (
                <button
                  type="button"
                  onClick={() => setWithdrawAmount(String(available))}
                  className="text-2xs font-semibold text-primary hover:underline"
                >
                  Maksimal ({formatMoney(available, lang)})
                </button>
              )}
            </div>
            <Input
              type="number"
              placeholder="0"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={withdrawBusy}
              min={1000}
              max={available}
            />
          </div>

          {withdrawError && (
            <p className="rounded-input border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
              {withdrawError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
