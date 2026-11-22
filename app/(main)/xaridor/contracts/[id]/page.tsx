"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountdownBadge } from "@/components/ui/CountdownBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { MilestoneProgress } from "@/components/shared/MilestoneProgress";
import { DisputeControl } from "@/components/shared/DisputeControl";
import { DisputeSummary } from "@/components/shared/DisputeSummary";
import { ReceiptModal } from "@/components/shared/ReceiptModal";
import { ContractWorkroomChat } from "@/components/shared/ContractWorkroomChat";
import {
  ContractStatusBadge,
  MilestoneStatusBadge,
} from "@/components/shared/StatusBadge";
import { contractsService, disputesService, milestonesService, paymentsService } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { Contract, Dispute, Milestone } from "@/lib/types";
import { formatDate, formatFileSize, formatMoney, triggerFileDownload } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { trackPaymentComplete } from "@/lib/analytics";

/** Bounded polling — real to'lov holati webhook orqali keladi, query
    parametridan HECH QACHON o'qilmaydi (bo'lim 24). 5s x 24 = ~2 daqiqa. */
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 24;

export default function XaridorWorkroomPage() {
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const [contract, setContract] = useState<Contract | null | undefined>(undefined);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const loadVersionRef = useRef(0);

  const [acceptTarget, setAcceptTarget] = useState<Milestone | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<Milestone | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [revisionError, setRevisionError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receiptMilestone, setReceiptMilestone] = useState<Milestone | null>(null);

  const [paying, setPaying] = useState(false);
  const [paymentState, setPaymentState] = useState<"idle" | "processing" | "failed" | "cancelled" | "expired" | "disabled">("idle");

  const reload = useCallback(async () => {
    const version = ++loadVersionRef.current;
    setContract(undefined);
    setLoadError(null);
    try {
      const found = await contractsService.get(params.id);
      if (version !== loadVersionRef.current) return;
      if (!found) {
        setContract(null);
        return;
      }
      const nextMilestones = await milestonesService.list(found.id);
      if (version !== loadVersionRef.current) return;
      setContract(found);
      setMilestones(nextMilestones);
      disputesService.getForContract(found.id).then(setDispute).catch(() => setDispute(null));
    } catch (error) {
      if (version === loadVersionRef.current) setLoadError(error);
    }
  }, [params.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const [watchingPayment, setWatchingPayment] = useState(false);

  /* Kontrakt faol+mablag'lanmagan bo'lganda BIR MARTA tekshiramiz —
     boshqa sessiya/tab'da allaqachon boshlangan to'lov bormi. Hali
     UMUMAN to'lov yaratilmagan bo'lsa (yangi shartnoma) xaridor
     "To'lash" tugmasini DARHOL ko'rishi kerak — kuzatishni "processing"
     bilan optimistik boshlash uni 2 daqiqaga yashirib qo'yardi. */
  useEffect(() => {
    if (!contract || (contract.status !== "faol" && contract.status !== "imzolangan") || contract.fundedAt) return;
    let cancelled = false;
    paymentsService
      .getContractPayment(contract.id)
      .then((payment) => {
        if (cancelled) return;
        if (payment?.status === "PENDING" || payment?.status === "PROCESSING") {
          setWatchingPayment(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.id, contract?.status, contract?.fundedAt]);

  /* Haqiqiy polling — faqat `watchingPayment` true bo'lganda ishlaydi:
     yo yuqoridagi mavjud-to'lov tekshiruvi, yo `handlePay()` uni
     yoqadi. Sahifaga qaytilganda (Payme checkout'dan keyin ham)
     chegaralangan so'rov — muvaffaqiyat hech qachon query-parametrdan
     ishonib o'qilmaydi, faqat real backend holatidan. */
  useEffect(() => {
    if (!watchingPayment || !contract) return;
    setPaymentState("processing");
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const payment = await paymentsService.getContractPayment(contract.id);
        if (cancelled) return;
        if (payment?.status === "SUCCEEDED") {
          clearInterval(timer);
          trackPaymentComplete({
            contractId: contract.id,
            amount: payment.amount,
            provider: payment.provider,
          });
          setWatchingPayment(false);
          setPaymentState("idle");
          reload();
          return;
        }
        if (payment?.status === "FAILED") {
          clearInterval(timer);
          setWatchingPayment(false);
          setPaymentState("failed");
          return;
        }
        if (payment?.status === "CANCELLED") {
          clearInterval(timer);
          setWatchingPayment(false);
          setPaymentState("cancelled");
          return;
        }
        if (payment?.status === "EXPIRED") {
          clearInterval(timer);
          setWatchingPayment(false);
          setPaymentState("expired");
          return;
        }
      } catch {
        /* fon so'rovi — jimgina keyingi urinishga qoldiriladi */
      }
      if (attempts >= POLL_MAX_ATTEMPTS) {
        clearInterval(timer);
        setWatchingPayment(false);
        setPaymentState("idle");
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchingPayment, contract?.id]);

  async function handlePay() {
    if (!contract) return;
    setPaying(true);
    try {
      /* Barqaror kalit — bir xil shartnoma uchun tugma necha marta
         bosilsa ham BIR XIL (tarmoq qayta urinishi ikkita to'lov
         yaratmasin, bo'lim 33). */
      const idempotencyKey = `contract-payment-${contract.id}`;
      const payment = await paymentsService.createContractPayment(contract.id, idempotencyKey);
      if (payment.checkoutUrl) {
        window.location.href = payment.checkoutUrl;
        return;
      }
      setWatchingPayment(true);
      toast(t("cfund.done"));
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "FEATURE_DISABLED" ||
          error.code === "PAYMENTS_PAUSED" ||
          error.status === 503 ||
          error.message === "FEATURE_DISABLED")
      ) {
        setPaymentState("disabled");
        toast(t("cfund.paymentsDisabled"), "error");
      } else {
        toast(t("common.error"), "error");
      }
    } finally {
      setPaying(false);
    }
  }

  async function handleAccept() {
    if (!acceptTarget || !contract) return;
    setBusy(true);
    try {
      await milestonesService.accept(contract.id, acceptTarget.id);
      toast(t("bms.accepted"));
      setAcceptTarget(null);
      reload();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevision() {
    if (!revisionTarget || !contract) return;
    if (revisionComment.trim().length < 5) {
      setRevisionError(t("bms.errComment"));
      return;
    }
    setBusy(true);
    try {
      await milestonesService.requestRevision(contract.id, revisionTarget.id, revisionComment);
      toast(t("bms.revisionSent"));
      setRevisionTarget(null);
      setRevisionComment("");
      reload();
    } catch (error) {
      if (error instanceof ApiError && error.message === "REVISION_LIMIT_REACHED") {
        toast(t("bms.revisionLimitReached"), "error");
        setRevisionTarget(null);
        reload();
      } else {
        toast(t("common.error"), "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!contract) return;
    setBusy(true);
    try {
      await contractsService.cancel(contract.id);
      toast(t("contract.cancelled"));
      setCancelOpen(false);
      reload();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorState error={loadError} onRetry={reload} />;
  if (contract === undefined) return <SkeletonCard />;
  if (contract === null) return <EmptyState title={t("contract.notFound")} />;

  const funded = !!contract.fundedAt;
  const actionable = contract.status === "faol" && funded;
  const canCancel =
    contract.rawStatus === "PENDING_SELLER" ||
    (!contract.sellerAcceptedAt && contract.status === "imzolangan" && !contract.rawStatus);
  const disputeOpen = !!dispute && dispute.status !== "hal_qilindi";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: t("nav.contracts"), href: "/xaridor/contracts" },
          { label: contract.title },
        ]}
      />
      <Card padding="lg" stitch>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Avatar name={contract.sellerName} />
            <div>
              <p className="text-xs text-muted">{contract.sellerName}</p>
              <h1 className="mt-0.5 font-heading text-xl font-bold text-ink">{contract.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ContractStatusBadge status={funded ? contract.status : "imzolangan"} />
                <span suppressHydrationWarning className="text-2xs text-faint">{formatDate(contract.createdAt, lang)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:items-end gap-1 text-left sm:text-right">
            <p className="text-2xs font-medium uppercase tracking-wide text-faint">{t("contract.total")}</p>
            <p className="font-heading text-lg font-bold text-ink">{formatMoney(contract.totalAmount, lang)}</p>
          </div>
        </div>

        {/* Sotuvchi hali qabul qilmagan bo'lsa (PENDING_SELLER) */}
        {!funded && contract.rawStatus === "PENDING_SELLER" && (
          <Card padding="lg" className="mt-4 border-info/30 bg-info/5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info text-base">⏳</span>
              <div>
                <h3 className="font-heading text-sm font-bold text-ink">Mutaxassis tasdig'i kutilmoqda</h3>
                <p className="mt-1 text-xs text-muted leading-relaxed">
                  Mutaxassis buyurtmani ko'rib chiqib, o'z roziligini bergach, shartnomani xavfsiz to'lov (Escrow) orqali to'lash imkoniyati ochiladi.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* To'lov kerak (sotuvchi qabul qilgan, lekin hali mablag'lanmagan) */}
        {!funded && contract.rawStatus !== "PENDING_SELLER" && contract.status !== "bekor_qilingan" && contract.status !== "yakunlangan" && contract.status !== "nizo" && paymentState === "idle" && (
          <Card padding="lg" className="mt-4 border-warning/30 bg-warning/5">
            <h3 className="font-heading text-sm font-bold text-ink">{t("cfund.awaitingTitle")}</h3>
            <p className="mt-1 text-xs text-muted">{t("cfund.awaitingDesc")}</p>
            <Button className="mt-4" onClick={handlePay} loading={paying}>
              {t("cfund.pay")} · {formatMoney(contract.totalAmount, lang)}
            </Button>
          </Card>
        )}

        {!funded && paymentState === "disabled" && (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning-deep">
            <p className="font-semibold text-ink text-sm mb-1">{t("cfund.paymentsDisabled")}</p>
            <p className="text-muted leading-relaxed">
              To'lov tizimi (Payme) sozlanmoqda yoki texnik xizmat ko'rsatilmoqda. Shartnoma faol saqlanadi, to'lov imkoniyati yoqilishi bilanoq uni amalga oshirishingiz mumkin.
            </p>
          </div>
        )}

        {!funded && paymentState === "processing" && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-xs text-info-deep">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-info" />
            {t("payment.processing")}
          </div>
        )}
        {paymentState === "failed" && (
          <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">
            {t("payment.failed")}
            <Button size="sm" className="mt-3" onClick={handlePay} loading={paying}>
              {t("cfund.pay")}
            </Button>
          </div>
        )}
        {(paymentState === "cancelled" || paymentState === "expired") && (
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-4 text-xs text-warning-deep">
            {paymentState === "cancelled" ? t("payment.cancelled") : t("payment.expired")}
            <Button size="sm" className="mt-3" onClick={handlePay} loading={paying}>
              {t("cfund.pay")}
            </Button>
          </div>
        )}

        {/* Shartnoma yakunlangan holati */}
        {contract.status === "yakunlangan" && (
          <div className="mt-4 rounded-2xl border border-line bg-card p-4 sm:p-5 shadow-xs border-l-4 border-l-emerald-500">
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-lg shadow-2xs">🎉</span>
              <div className="flex-1">
                <h3 className="font-heading text-sm font-black text-ink tracking-tight">Shartnoma muvaffaqiyatli yakunlandi</h3>
                <p className="mt-2 text-xs sm:text-sm text-ink/90 leading-relaxed">
                  Barcha ishlar qabul qilindi va to&apos;lovlar mutaxassisga to&apos;liq o&apos;tkazib berildi.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Escrow kafolati — faqat faol shartnomada */}
        {funded && contract.status !== "yakunlangan" && contract.status !== "bekor_qilingan" && (
          <div className="mt-4 rounded-2xl border border-line bg-card p-4 sm:p-5 shadow-xs border-l-4 border-l-emerald-500">
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-lg shadow-2xs">🛡️</span>
              <div className="flex-1">
                <h3 className="font-heading text-sm font-black text-ink tracking-tight">{t("contract.escrowFundedTitle")}</h3>
                <p className="mt-2 text-xs sm:text-sm text-ink/90 leading-relaxed">{t("contract.escrowFundedBuyerDesc")}</p>
              </div>
            </div>
          </div>
        )}

        {milestones.length > 1 && (
          <div className="mt-6 border-t border-line pt-4">
            <MilestoneProgress milestones={milestones} />
          </div>
        )}
      </Card>

      {disputeOpen && dispute && <DisputeSummary contractId={contract.id} onWithdrawn={reload} />}
      {contract.status === "bekor_qilingan" && (
        <p className="rounded-card border border-line bg-card p-4 text-xs text-muted">
          {contract.cancelReason || t("contract.cancelledNote")}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold text-ink">{t("contract.milestones")}</h2>
        <div className="flex flex-col gap-3">
          {milestones.map((milestone, i) => (
            <div
              key={milestone.id}
              className={`flex flex-col gap-3 rounded-card border p-4 ${
                milestone.status === "topshirildi"
                  ? "border-warning/30 bg-warning/5"
                  : milestone.status === "qabul_qilindi"
                    ? "border-success/25 bg-success/5"
                    : "border-line bg-card"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${
                      milestone.status === "qabul_qilindi" ? "bg-success/10 text-success-deep" : "bg-primary/10 text-primary-deep"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-ink">{milestone.title}</h4>
                    {milestone.description && <p className="mt-0.5 text-xs text-muted">{milestone.description}</p>}
                  </div>
                </div>
                <MilestoneStatusBadge status={milestone.status} />
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-9 text-xs text-muted">
                <span className="font-medium text-ink">{formatMoney(milestone.amount, lang)}</span>
                {milestone.status === "qabul_qilindi" && milestone.approvedAt && (
                  <span suppressHydrationWarning className="text-success">{t("ms.paid")} · {formatDate(milestone.approvedAt, lang)}</span>
                )}
              </div>

              {(milestone.deliverableLink ||
                milestone.deliverableNote ||
                (milestone.deliverableFiles && milestone.deliverableFiles.length > 0)) && (
                <div className="ml-9 flex flex-col gap-2 rounded-input border border-primary/20 bg-surface/80 p-3 text-xs">
                  {milestone.deliverableLink && (
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-muted">{t("sm.link")}:</span>
                      <a
                        href={milestone.deliverableLink.startsWith("http") ? milestone.deliverableLink : `https://${milestone.deliverableLink}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-primary hover:underline break-all"
                      >
                        {milestone.deliverableLink}
                      </a>
                    </div>
                  )}
                  {milestone.deliverableNote && (
                    <p className="text-muted whitespace-pre-line bg-card/60 rounded-btn p-2 border border-line/40">{milestone.deliverableNote}</p>
                  )}
                  {milestone.deliverableFiles && milestone.deliverableFiles.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-2xs font-medium text-muted">{t("sm.deliverableFiles")}:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {milestone.deliverableFiles.map((file, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-2 rounded-btn border border-line bg-card p-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-ink text-2xs">{file.name}</p>
                              <p className="text-[10px] text-faint">{formatFileSize(file.size)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => triggerFileDownload(file)}
                              className="shrink-0 rounded-btn bg-surface hover:bg-card-hover px-2 py-1 text-[11px] font-medium text-primary border border-line cursor-pointer"
                            >
                              {t("workroom.download")}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {milestone.status === "qabul_qilindi" && (
                <div className="pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setReceiptMilestone(milestone)} className="text-xs text-ink">
                    {t("receipt.download")}
                  </Button>
                </div>
              )}

              {milestone.status === "topshirildi" && (
                <div className="flex flex-col gap-3 pl-9">
                  <div className="flex flex-wrap items-center gap-3">
                    {milestone.reviewDeadline && <CountdownBadge deadline={milestone.reviewDeadline} />}
                    <span className="text-2xs text-faint">{t("bms.autoAcceptNote")}</span>
                  </div>
                  {actionable && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setAcceptTarget(milestone)}>
                        {t("bms.accept")}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setRevisionTarget(milestone);
                          setRevisionComment("");
                          setRevisionError("");
                        }}
                      >
                        {t("bms.requestRevision")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {milestone.status === "ozgartirish_soraldi" && (
                <p className="pl-9 text-2xs text-faint">{t("bms.revisionWaiting")}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Ishchi xona muloqoti va fayllar (Chat & Deliverables) */}
      <section className="flex flex-col gap-3">
        <ContractWorkroomChat
          contract={contract}
          milestones={milestones}
          counterpartName={contract.sellerName}
          role="xaridor"
        />
      </section>

      {(canCancel || contract.status === "faol") && (
        <div className="flex justify-end gap-2">
          {contract.status === "faol" && <DisputeControl contractId={contract.id} onOpened={reload} />}
          {canCancel && (
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)} className="text-danger hover:text-danger">
              {t("contract.cancel")}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={cancelOpen}
        title={t("contract.cancelTitle")}
        description={t("contract.cancelDesc")}
        confirmLabel={t("contract.cancel")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={busy}
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />

      <Modal
        open={!!acceptTarget}
        onClose={() => setAcceptTarget(null)}
        title={t("bms.acceptTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAcceptTarget(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button loading={busy} onClick={handleAccept}>
              {t("bms.accept")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {acceptTarget && (
            <div className="flex items-center justify-between rounded-input border border-line bg-surface p-3">
              <span className="text-xs text-muted">{acceptTarget.title}</span>
              <span className="font-heading text-base font-bold text-success">{formatMoney(acceptTarget.amount, lang)}</span>
            </div>
          )}
          <p>{t("bms.acceptDesc")}</p>
        </div>
      </Modal>

      <Modal
        open={!!revisionTarget}
        onClose={() => setRevisionTarget(null)}
        title={t("bms.requestRevision")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevisionTarget(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button loading={busy} onClick={handleRevision}>
              {t("bms.requestRevision")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {revisionTarget && (
            <div className="flex items-center justify-between rounded-input border border-line bg-surface p-3 text-xs">
              <span className="font-medium text-ink">{revisionTarget.title}</span>
              <span className="font-bold text-primary">{formatMoney(revisionTarget.amount, lang)}</span>
            </div>
          )}
          <Textarea
            label={t("bms.revisionReason")}
            value={revisionComment}
            onChange={(e) => {
              setRevisionComment(e.target.value);
              setRevisionError("");
            }}
            placeholder={t("bms.revisionReasonPh")}
            rows={4}
            error={revisionError}
          />
        </div>
      </Modal>

      <ReceiptModal
        open={!!receiptMilestone}
        onClose={() => setReceiptMilestone(null)}
        milestone={receiptMilestone}
        contractTitle={contract?.title}
        contractId={contract?.id}
        buyerName={contract?.buyerName}
        sellerName={contract?.sellerName}
      />
    </div>
  );
}
