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
import type {
  Contract,
  Milestone,
  PayoutDestination,
  SellerBalanceBreakdown,
} from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { PLATFORM_FEE_PERCENT, sellerNet } from "@/lib/fees";
import { useT } from "@/lib/i18n";

export default function DaromadPage() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [breakdown, setBreakdown] = useState<SellerBalanceBreakdown | null>(null);
  const [destinations, setDestinations] = useState<PayoutDestination[]>([]);
  const [receiptMilestone, setReceiptMilestone] = useState<Milestone | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  // Payout so'rovi modali
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [selectedDestId, setSelectedDestId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawIdempKey, setWithdrawIdempKey] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");

  // Yangi rekvizit qo'shish / almashtirish modali (CVV/PIN/OTP SO'RALMAYDI)
  const [destModalOpen, setDestModalOpen] = useState(false);
  const [editingDestId, setEditingDestId] = useState<string | null>(null);
  const [destType, setDestType] = useState<"BANK_CARD" | "BANK_ACCOUNT">("BANK_CARD");
  const [destProvider, setDestProvider] = useState("Uzcard");
  const [destRawValue, setDestRawValue] = useState("");
  const [destHolder, setDestHolder] = useState("");
  const [destBankName, setDestBankName] = useState("");
  const [destMfo, setDestMfo] = useState("");
  const [destBusy, setDestBusy] = useState(false);
  const [destError, setDestError] = useState("");

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      milestonesService.listMine(),
      contractsService.list(),
      paymentsService.getBalanceBreakdown(),
      paymentsService.listPayoutDestinations(),
    ])
      .then(([milestoneList, contractList, nextBreakdown, nextDests]) => {
        setMilestones(milestoneList);
        setContracts(contractList);
        setBreakdown(nextBreakdown);
        setDestinations(nextDests);
        const verifiedOnly = nextDests.filter(
          (d) => d.isVerified && d.verificationStatus === "VERIFIED",
        );
        const def = verifiedOnly.find((d) => d.isDefault) ?? verifiedOnly[0];
        setSelectedDestId(def?.id ?? "");
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  const summary = breakdown?.summary ?? {
    currency: "UZS",
    available: 0,
    pending: 0,
    reserved: 0,
    disputedHeld: 0,
    paid: 0,
    grossEarned: 0,
    commissionWithheld: 0,
    netEarned: 0,
  };

  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const paidMilestones = (milestones ?? [])
    .filter((m) => m.status === "qabul_qilindi")
    .sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));

  const verifiedDestinations = destinations.filter(
    (d) => d.isVerified && d.verificationStatus === "VERIFIED",
  );

  async function handleAddDestination() {
    const cleanDigits = destRawValue.replace(/\D/g, "");
    if (destType === "BANK_CARD" && cleanDigits.length !== 16) {
      setDestError("16 xonali karta raqamini to'liq kiriting (Uzcard yoki Humo).");
      return;
    }
    if (destType === "BANK_ACCOUNT" && (cleanDigits.length < 10 || cleanDigits.length > 26)) {
      setDestError("Bank hisob raqami 10–26 ta raqamdan iborat bo'lishi kerak.");
      return;
    }
    if (destHolder.trim().length < 3) {
      setDestError("Rekvizit egasining to'liq ism-familiyasini kiriting.");
      return;
    }

    setDestBusy(true);
    setDestError("");
    try {
      const payload = {
        type: destType,
        providerLabel: destType === "BANK_CARD" ? destProvider : "Bank hisob raqami",
        rawAccountOrCard: cleanDigits,
        holderName: destHolder.trim(),
        bankName: destType === "BANK_ACCOUNT" ? destBankName.trim() || undefined : undefined,
        mfo: destType === "BANK_ACCOUNT" ? destMfo.trim() || undefined : undefined,
        isDefault: true,
      };
      if (editingDestId) {
        await paymentsService.replacePayoutDestination(editingDestId, payload);
        toast("Rekvizit yangilandi va qayta tekshiruvga yuborildi");
      } else {
        await paymentsService.addPayoutDestination(payload);
        toast("Rekvizit xavfsiz maskalanib saqlandi va moliya tekshiruviga yuborildi");
      }
      setDestModalOpen(false);
      setEditingDestId(null);
      setDestRawValue("");
      setDestHolder("");
      setDestBankName("");
      setDestMfo("");
      load();
    } catch (err) {
      setDestError(err instanceof Error ? err.message : "Saqlashda xatolik yuz berdi");
    } finally {
      setDestBusy(false);
    }
  }

  async function handleWithdrawSubmit() {
    if (!selectedDestId) {
      setWithdrawError("Avval tasdiqlangan karta yoki bank hisob raqamini tanlang.");
      return;
    }
    const amt = Number(withdrawAmount);
    if (!amt || !Number.isInteger(amt) || amt <= 0) {
      setWithdrawError("Summa butun musbat son bo'lishi kerak.");
      return;
    }
    if (amt > summary.available) {
      setWithdrawError(`Mablag' yetarli emas. Maksimal: ${formatMoney(summary.available, lang)}`);
      return;
    }

    setWithdrawBusy(true);
    setWithdrawError("");
    try {
      await paymentsService.requestPayout({
        amount: amt,
        destinationId: selectedDestId,
        idempotencyKey: withdrawIdempKey || crypto.randomUUID(),
      });
      toast("Pul yechish so'rovingiz yaratildi. Summa balansda band qilindi va bank o'tkazmasiga yuborildi.");
      setWithdrawOpen(false);
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
        <Button size="sm" variant="secondary" onClick={() => { setEditingDestId(null); setDestRawValue(""); setDestHolder(""); setDestBankName(""); setDestMfo(""); setDestError(""); setDestModalOpen(true); }}>
          + Rekvizit qo&apos;shish
        </Button>
      </div>
      <h1 className="font-heading text-2xl font-extrabold text-ink">{t("earn.title")}</h1>

      {loadError ? (
        <ErrorState error={loadError} onRetry={load} />
      ) : (
        <>
          {/* 4 alohida moliyaviy holat kartasi (server ledgeridan) */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {!breakdown ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-6 w-32" />
                </Card>
              ))
            ) : (
              <>
                <Card>
                  <p className="text-2xs font-medium uppercase tracking-wide text-faint">Yechish mumkin (Sof qoldiq)</p>
                  <p className="mt-2 font-heading text-xl font-bold text-ink">{formatMoney(summary.available, lang)}</p>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={summary.available <= 0}
                    onClick={() => {
                      setWithdrawError("");
                      setWithdrawAmount(summary.available > 0 ? String(summary.available) : "");
                      setWithdrawIdempKey(crypto.randomUUID());
                      setWithdrawOpen(true);
                    }}
                    className="mt-3"
                  >
                    Mablag&apos;ni yechish
                  </Button>
                </Card>

                <Card>
                  <p className="text-2xs font-medium uppercase tracking-wide text-faint">So&apos;ralgan / band qilingan</p>
                  <p className="mt-2 font-heading text-xl font-bold text-warning-deep">{formatMoney(summary.reserved, lang)}</p>
                  <p className="mt-1 text-2xs text-faint">Admin bank o&apos;tkazmasini bajarguncha band turadi</p>
                </Card>

                <Card>
                  <p className="text-2xs font-medium uppercase tracking-wide text-faint">Kutilayotgan (Escrow)</p>
                  <p className="mt-2 font-heading text-xl font-bold text-ink">{formatMoney(summary.pending, lang)}</p>
                  {summary.disputedHeld > 0 && (
                    <p className="mt-1 text-2xs text-danger">
                      Nizo sababli muzlatilgan: {formatMoney(summary.disputedHeld, lang)}
                    </p>
                  )}
                </Card>

                <Card>
                  <p className="text-2xs font-medium uppercase tracking-wide text-faint">Bank orqali to&apos;langan</p>
                  <p className="mt-2 font-heading text-xl font-bold text-success">{formatMoney(summary.paid, lang)}</p>
                  {summary.grossEarned > 0 && (
                    <p className="mt-1 text-2xs text-faint">
                      Brutto {formatMoney(summary.grossEarned, lang)} − komissiya {formatMoney(summary.commissionWithheld, lang)} = {formatMoney(summary.netEarned, lang)}
                    </p>
                  )}
                </Card>
              </>
            )}
          </div>

          {/* Saqlangan to'lov rekvizitlari */}
          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold text-ink">Saqlangan to&apos;lov rekvizitlarim</h2>
            {destinations.length === 0 ? (
              <Card className="p-4 text-xs text-muted flex flex-wrap items-center justify-between gap-3">
                <span>Hali pul yechish uchun karta yoki bank hisob raqami qo&apos;shilmagan.</span>
                <Button size="sm" variant="secondary" onClick={() => setDestModalOpen(true)}>
                  Rekvizit qo&apos;shish
                </Button>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {destinations.map((d) => {
                  const statusTone: BadgeTone =
                    d.verificationStatus === "VERIFIED"
                      ? "success"
                      : d.verificationStatus === "REJECTED"
                        ? "danger"
                        : "warning";
                  const statusText =
                    d.verificationStatus === "VERIFIED"
                      ? "Tasdiqlangan"
                      : d.verificationStatus === "REJECTED"
                        ? "Rad etilgan"
                        : "Tekshiruvda";
                  return (
                    <Card key={d.id} className="p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-ink">{d.providerLabel}</span>
                          <span className="font-mono text-xs text-ink">{d.maskedValue}</span>
                          <Badge tone={statusTone}>{statusText}</Badge>
                          {d.isDefault && <Badge tone="info">Asosiy</Badge>}
                        </div>
                        <p className="mt-1 text-2xs text-muted">{d.holderName}</p>
                        {d.verificationStatus === "VERIFIED" && d.bankRecipientId && (
                          <p className="mt-0.5 text-2xs text-success">Bank oluvchi ID: {d.bankRecipientId}</p>
                        )}
                        {d.verificationStatus === "PENDING_REVIEW" && (
                          <p className="mt-0.5 text-2xs text-warning-deep">
                            Moliya operatori bank kabinetida oluvchini tasdiqlagach pul yechish ochiladi.
                          </p>
                        )}
                        {d.verificationStatus === "REJECTED" && d.rejectionReason && (
                          <p className="mt-0.5 text-2xs text-danger">Sabab: {d.rejectionReason}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingDestId(d.id);
                            setDestType(d.type);
                            setDestProvider(d.type === "BANK_CARD" ? d.providerLabel : "Uzcard");
                            setDestRawValue("");
                            setDestHolder(d.holderName);
                            setDestBankName(d.bankName ?? "");
                            setDestMfo(d.mfo ?? "");
                            setDestError("");
                            setDestModalOpen(true);
                          }}
                        >
                          Almashtirish
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          onClick={async () => {
                            await paymentsService.removePayoutDestination(d.id);
                            toast("Rekvizit o'chirildi");
                            load();
                          }}
                        >
                          O&apos;chirish
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* Shartnoma kesimidagi daromad va komissiya hisoboti */}
          {breakdown && breakdown.contracts.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-heading text-lg font-bold text-ink">Shartnomalar bo&apos;yicha hisob-kitob</h2>
              <Table
                rows={breakdown.contracts}
                rowKey={(c) => c.contractId}
                columns={[
                  {
                    key: "title",
                    header: "Shartnoma",
                    render: (c) => (
                      <Link href={`/mutaxassis/contracts/${c.contractId}`} className="font-medium text-primary hover:underline">
                        {c.title}
                      </Link>
                    ),
                  },
                  {
                    key: "stage",
                    header: "Bosqich",
                    render: (c) => (
                      <Badge tone={c.stage === "settled" ? "success" : c.stage === "disputed" ? "danger" : "info"}>
                        {c.stage === "settled" ? "Qabul qilingan" : c.stage === "disputed" ? "Nizo" : "Escrowda"}
                      </Badge>
                    ),
                  },
                  { key: "gross", header: "Brutto", render: (c) => formatMoney(c.grossAmount, lang) },
                  {
                    key: "fee",
                    header: "Komissiya",
                    render: (c) => `${formatMoney(c.commissionAmount, lang)} (${c.platformFeeRateBps / 100}%)`,
                  },
                  {
                    key: "net",
                    header: "Sof summa",
                    render: (c) => <span className="font-semibold text-success">{formatMoney(c.netAmount, lang)}</span>,
                  },
                ]}
                renderMobileCard={(c) => (
                  <div className="flex flex-col gap-1 text-xs">
                    <Link href={`/mutaxassis/contracts/${c.contractId}`} className="font-semibold text-primary">
                      {c.title}
                    </Link>
                    <p>Brutto: {formatMoney(c.grossAmount, lang)} − {c.platformFeeRateBps / 100}% = <strong>{formatMoney(c.netAmount, lang)}</strong></p>
                  </div>
                )}
              />
            </section>
          )}

          {/* Pul yechish arizalari va bank o'tkazmalari tarixi */}
          {breakdown && breakdown.payouts.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-heading text-lg font-bold text-ink">Pul yechish arizalari tarixi</h2>
              <Table
                rows={breakdown.payouts}
                rowKey={(p) => p.payoutId}
                columns={[
                  { key: "date", header: "Sana", render: (p) => formatDate(p.createdAt, lang) },
                  { key: "dest", header: "Rekvizit", render: (p) => p.destinationReference },
                  { key: "amount", header: "Summa", render: (p) => <span className="font-semibold">{formatMoney(p.amount, lang)}</span> },
                  {
                    key: "status",
                    header: "Holat",
                    render: (p) => {
                      const tone: BadgeTone =
                        p.status === "SUCCEEDED"
                          ? "success"
                          : p.status === "FAILED"
                            ? "danger"
                            : p.status === "PROCESSING"
                              ? "info"
                              : "warning";
                      const label =
                        p.status === "SUCCEEDED"
                          ? "Bank orqali to'landi"
                          : p.status === "FAILED"
                            ? "Rad etilgan"
                            : p.status === "PROCESSING"
                              ? "Ishlovda"
                              : "Kutilmoqda";
                      return (
                        <div className="flex flex-col gap-0.5">
                          <Badge tone={tone}>{label}</Badge>
                          {p.failureReason && <span className="text-2xs text-danger">{p.failureReason}</span>}
                        </div>
                      );
                    },
                  },
                  {
                    key: "ref",
                    header: "Bank hujjati",
                    render: (p) => <span className="font-mono text-2xs">{p.bankOperationRef || p.payoutId.slice(0, 10)}</span>,
                  },
                ]}
                renderMobileCard={(p) => (
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between">
                      <strong>{formatMoney(p.amount, lang)}</strong>
                      <span>{p.status}</span>
                    </div>
                    <p className="text-muted">{p.destinationReference}</p>
                    {p.bankOperationRef && <p className="font-mono text-2xs">Ref: {p.bankOperationRef}</p>}
                    {p.failureReason && <p className="text-danger">{p.failureReason}</p>}
                  </div>
                )}
              />
            </section>
          )}

          {/* Qabul qilingan bosqichlar */}
          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold text-ink">{t("earn.recent")}</h2>
            {!milestones ? (
              <SkeletonCard />
            ) : paidMilestones.length === 0 ? (
              <EmptyState
                title={t("earn.empty")}
                description="Hozircha qabul qilingan bosqichlar yo'q."
                action={
                  <Link href="/bozor?tab=jobs">
                    <Button size="sm">Ish qidirish</Button>
                  </Link>
                }
              />
            ) : (
              <Table
                rows={paidMilestones}
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
                    key: "amount",
                    header: t("earn.colAmount"),
                    render: (m) => (
                      <span className="flex flex-col">
                        <span className="font-medium text-success">{formatMoney(sellerNet(m.amount, m.platformFeeRateBps), lang)}</span>
                        <span className="text-2xs text-faint">
                          {formatMoney(m.amount, lang)} − {m.platformFeeRateBps !== undefined ? m.platformFeeRateBps / 100 : PLATFORM_FEE_PERCENT}%
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "receipt",
                    header: "",
                    render: (m) => (
                      <Button size="sm" variant="ghost" onClick={() => setReceiptMilestone(m)}>
                        {t("receipt.download")}
                      </Button>
                    ),
                  },
                ]}
                renderMobileCard={(m) => (
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-success">{formatMoney(sellerNet(m.amount, m.platformFeeRateBps), lang)}</span>
                    <span>{contractById.get(m.contractId)?.title ?? "—"}</span>
                  </div>
                )}
              />
            )}
          </section>
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

      {/* Rekvizit qo'shish modali (xavfsiz: CVV/PIN/OTP yig'ilmaydi) */}
      <Modal
        open={destModalOpen}
        onClose={() => !destBusy && setDestModalOpen(false)}
        title={editingDestId ? "To'lov rekvizitini almashtirish" : "To'lov qabul qilish rekviziti"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDestModalOpen(false)} disabled={destBusy}>
              Bekor qilish
            </Button>
            <Button loading={destBusy} onClick={handleAddDestination}>
              Saqlash
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex gap-2">
            <Button size="sm" variant={destType === "BANK_CARD" ? "primary" : "secondary"} onClick={() => setDestType("BANK_CARD")}>
              Bank kartasi
            </Button>
            <Button size="sm" variant={destType === "BANK_ACCOUNT" ? "primary" : "secondary"} onClick={() => setDestType("BANK_ACCOUNT")}>
              Bank hisob raqami
            </Button>
          </div>
          {destType === "BANK_CARD" && (
            <div className="flex gap-2">
              {["Uzcard", "Humo"].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDestProvider(label)}
                  className={`rounded-btn border px-3 py-1.5 text-xs font-medium ${destProvider === label ? "border-primary bg-primary/10 text-primary" : "border-line text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <Input
            label={destType === "BANK_CARD" ? "16 xonali karta raqami (CVV/PIN kiritmang)" : "20 xonali bank hisob raqami"}
            placeholder={destType === "BANK_CARD" ? "8600 0000 0000 0000" : "20208000..."}
            value={destRawValue}
            onChange={(e) => setDestRawValue(e.target.value)}
          />
          <Input
            label="Egasining F.I.SH"
            placeholder="ALISHER VALIYEV"
            value={destHolder}
            onChange={(e) => setDestHolder(e.target.value)}
          />
          {destType === "BANK_ACCOUNT" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input label="Bank nomi" value={destBankName} onChange={(e) => setDestBankName(e.target.value)} />
              <Input label="MFO" value={destMfo} onChange={(e) => setDestMfo(e.target.value)} />
            </div>
          )}
          <p className="text-2xs text-faint">
            Xavfsizlik uchun karta raqamingiz darhol maskalanib saqlanadi. Biz hech qachon CVV, PIN yoki SMS kod so&apos;ramaymiz.
          </p>
          {destError && <p className="text-xs text-danger">{destError}</p>}
        </div>
      </Modal>

      {/* Pul yechish so'rovi modali */}
      <Modal
        open={withdrawOpen}
        onClose={() => !withdrawBusy && setWithdrawOpen(false)}
        title="Pul yechish so'rovi"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)} disabled={withdrawBusy}>
              Bekor qilish
            </Button>
            <Button loading={withdrawBusy} disabled={withdrawBusy || summary.available <= 0 || verifiedDestinations.length === 0} onClick={handleWithdrawSubmit}>
              So&apos;rov yuborish
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-card border border-line bg-surface p-3 text-xs text-muted">
            <p className="font-medium text-ink">
              Yechish mumkin: <span className="font-semibold text-success">{formatMoney(summary.available, lang)}</span>
            </p>
            <p className="mt-1 text-2xs text-faint">
              To&apos;lov admin tomonidan qo&apos;lda bank o&apos;tkazmasi orqali bajariladi. So&apos;rov yuborilganda summa balansda band qilinadi.
            </p>
          </div>

          {verifiedDestinations.length === 0 ? (
            <div className="rounded-input border border-warning/40 bg-warning/10 p-3 text-xs">
              {destinations.length === 0
                ? "Avval kamida bitta karta yoki bank hisob raqamini qo'shing."
                : "Saqlangan rekvizitingiz hali moliya operatori tomonidan bank kabinetida tasdiqlanmagan («Tekshiruvda»). Faqat «Tasdiqlangan» rekvizitga pul yechish mumkin."}
              {destinations.length === 0 && (
                <Button size="sm" className="mt-2" onClick={() => { setWithdrawOpen(false); setDestModalOpen(true); }}>
                  + Rekvizit qo&apos;shish
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink">Tasdiqlangan qabul qiluvchi rekvizit</label>
              <select
                value={selectedDestId}
                onChange={(e) => setSelectedDestId(e.target.value)}
                className="rounded-input border border-line bg-card px-3 py-2 text-xs text-ink"
              >
                {verifiedDestinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.providerLabel} {d.maskedValue} ({d.holderName}){d.bankRecipientId ? ` · ID: ${d.bankRecipientId}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink">Summa (so&apos;m)</label>
              {summary.available > 0 && (
                <button
                  type="button"
                  onClick={() => setWithdrawAmount(String(summary.available))}
                  className="text-2xs font-semibold text-primary hover:underline"
                >
                  Hammasini ({formatMoney(summary.available, lang)})
                </button>
              )}
            </div>
            <Input
              type="number"
              min={1}
              max={summary.available}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={withdrawBusy}
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
