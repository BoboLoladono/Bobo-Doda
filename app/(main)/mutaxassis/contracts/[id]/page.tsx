"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { MilestoneItem } from "@/components/shared/MilestoneItem";
import { MilestoneProgress } from "@/components/shared/MilestoneProgress";
import { DisputeControl } from "@/components/shared/DisputeControl";
import { DisputeSummary } from "@/components/shared/DisputeSummary";
import { ReceiptModal } from "@/components/shared/ReceiptModal";
import { ContractWorkroomChat } from "@/components/shared/ContractWorkroomChat";
import { Badge } from "@/components/ui/Badge";
import { contractsService, disputesService, filesService, milestonesService } from "@/lib/api";
import { PLATFORM_FEE_PERCENT } from "@/lib/fees";
import type { Contract, DeliverableFile, Dispute, Milestone } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";

export default function ShartnomaWorkroomPage() {
  const { t, lang } = useT();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const [contract, setContract] = useState<Contract | null | undefined>(undefined);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const loadVersionRef = useRef(0);

  /* Topshirish modali — real backend faqat havola + izoh qabul qiladi (`SubmitMilestoneDto`) */
  const [submitTarget, setSubmitTarget] = useState<Milestone | null>(null);
  const [workLink, setWorkLink] = useState("");
  const [workNote, setWorkNote] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<DeliverableFile[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receiptMilestone, setReceiptMilestone] = useState<Milestone | null>(null);

  const [decisionBusy, setDecisionBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

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
      /* Nizo — alohida so'rov, yo'qligi xato EMAS (fon yangilanishida yutiladi) */
      disputesService.getForContract(found.id).then(setDispute).catch(() => setDispute(null));
    } catch (error) {
      if (version === loadVersionRef.current) setLoadError(error);
    }
  }, [params.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  function openSubmitModal(milestone: Milestone) {
    setSubmitTarget(milestone);
    setWorkLink(milestone.deliverableLink || "");
    setWorkNote(milestone.deliverableNote || "");
    setUploadedFiles([]);
    setLinkError("");
  }

  async function handleDeliverableFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const uploaded = await filesService.upload(file);
      setUploadedFiles((prev) => [...prev, uploaded]);
      toast(`Fayl yuklandi: ${uploaded.name}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Fayl yuklashda xatolik", "error");
    } finally {
      setUploadingFile(false);
    }
  }

  async function handleSubmitWork(e: FormEvent) {
    e.preventDefault();
    if (!submitTarget || !contract) return;
    const trimmedLink = workLink.trim();
    const trimmedNote = workNote.trim();
    if (!trimmedLink && !trimmedNote && uploadedFiles.length === 0) {
      setLinkError(t("sm.errLink"));
      return;
    }
    if (trimmedLink && !/^https?:\/\//i.test(trimmedLink)) {
      setLinkError("Havola to'g'ri formatda bo'lishi kerak (https://...)");
      return;
    }
    setSubmitting(true);
    try {
      await milestonesService.submit(contract.id, submitTarget.id, {
        link: trimmedLink || undefined,
        note: trimmedNote || undefined,
        files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
      });
      setMilestones(await milestonesService.list(contract.id));
      toast(t("sm.done"));
      setSubmitTarget(null);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAccept() {
    if (!contract) return;
    setDecisionBusy(true);
    try {
      await contractsService.accept(contract.id);
      toast(t("contract.acceptedToast"));
      reload();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setDecisionBusy(false);
    }
  }

  async function handleReject() {
    if (!contract) return;
    setDecisionBusy(true);
    try {
      await contractsService.reject(contract.id);
      toast(t("contract.rejectedToast"));
      setRejectOpen(false);
      reload();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setDecisionBusy(false);
    }
  }

  if (loadError) return <ErrorState error={loadError} onRetry={reload} />;
  if (contract === undefined) return <SkeletonCard />;
  if (contract === null) return <EmptyState title={t("contract.notFound")} />;

  const pendingDecision =
    contract.rawStatus === "PENDING_SELLER" ||
    (!contract.sellerAcceptedAt && contract.status === "imzolangan" && !contract.rawStatus);
  const funded = !!contract.fundedAt;
  const disputeOpen = !!dispute && dispute.status !== "hal_qilindi";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: t("nav.contracts"), href: "/mutaxassis/contracts" },
          { label: contract.title },
        ]}
      />

      <Card padding="lg" stitch>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Avatar name={contract.buyerName} />
            <div>
              <p className="text-xs text-muted">{contract.buyerName}</p>
              <h1 className="mt-0.5 font-heading text-xl font-bold text-ink">{contract.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(() => {
                  const statusTone =
                    contract.rawStatus === "PENDING_SELLER"
                      ? "warning"
                      : contract.rawStatus === "REJECTED"
                        ? "danger"
                        : contract.rawStatus === "CANCELLED"
                          ? "neutral"
                          : contract.rawStatus === "COMPLETED"
                            ? "success"
                            : disputeOpen
                              ? "danger"
                              : funded
                                ? "success"
                                : "info";
                  const statusLabel =
                    contract.rawStatus === "PENDING_SELLER"
                      ? "Tasdig'ingiz kutilmoqda"
                      : contract.rawStatus === "REJECTED"
                        ? "Rad etilgan"
                        : contract.rawStatus === "CANCELLED"
                          ? "Bekor qilingan"
                          : contract.rawStatus === "COMPLETED"
                            ? "Yakunlangan"
                            : disputeOpen
                              ? "Nizo jarayonida"
                              : funded
                                ? "Mablag'langan · Ish jarayonida"
                                : "Tasdiqlangan · Xaridor to'lovi kutilmoqda";
                  return <Badge tone={statusTone}>{statusLabel}</Badge>;
                })()}
                <span suppressHydrationWarning className="text-2xs text-faint">{formatDate(contract.createdAt, lang)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:items-end gap-1 text-left sm:text-right">
            <p className="text-2xs font-medium uppercase tracking-wide text-faint">{t("contract.total")}</p>
            <p className="font-heading text-lg font-bold text-ink">{formatMoney(contract.totalAmount, lang)}</p>
          </div>
        </div>

        {/* Ikki tomon ko'radigan bir xil shartnoma shartlari (Snapshot) */}
        <div className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-4 text-xs sm:grid-cols-2">
          <div>
            <p className="text-2xs font-semibold uppercase text-faint">Topshiriladigan natija</p>
            <p className="mt-1 whitespace-pre-line text-ink">{contract.deliverableSummary || contract.title}</p>
          </div>
          <div>
            <p className="text-2xs font-semibold uppercase text-faint">Qabul qilish mezoni</p>
            <p className="mt-1 whitespace-pre-line text-ink">
              {contract.acceptanceCriteria || "Barcha bosqich natijalarining shartlarga mos bajarilishi"}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 sm:col-span-2 border-t border-line pt-2 text-2xs text-muted">
            <span>Tuzatishlar soni: <strong className="text-ink">{contract.revisionsIncluded ?? 2} marta</strong></span>
            <span>
              Komissiya: <strong className="text-ink">{((milestones[0]?.platformFeeRateBps ?? PLATFORM_FEE_PERCENT * 100) / 100)}%</strong>
            </span>
            <span>Xaridor tasdig&apos;i: <strong className="text-ink">{contract.buyerConfirmedAt ? formatDate(contract.buyerConfirmedAt, lang) : "Tasdiqlangan"}</strong></span>
            <span>Mutaxassis tasdig&apos;i: <strong className="text-ink">{contract.sellerConfirmedAt ? formatDate(contract.sellerConfirmedAt, lang) : "Kutilmoqda"}</strong></span>
          </div>
        </div>

        {/* Yangi shartnoma — sotuvchi javobi kutilmoqda */}
        {pendingDecision && (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-heading text-sm font-bold text-ink">{t("contract.decisionTitle")}</h3>
                <p className="mt-0.5 text-xs text-muted">{t("contract.decisionDesc")}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => setRejectOpen(true)} disabled={decisionBusy}>
                  {t("contract.rejectAction")}
                </Button>
                <Button onClick={handleAccept} loading={decisionBusy}>
                  {t("contract.acceptAction")}
                </Button>
              </div>
            </div>
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
                  Barcha ishlar qabul qilindi. To&apos;lov balansingizga to&apos;liq o&apos;tkazib berildi.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Escrow kafolati — real to'lov tasdiqlangan va shartnoma faol */}
        {funded && contract.status !== "yakunlangan" && contract.status !== "bekor_qilingan" && (
          <div className="mt-4 rounded-2xl border border-line bg-card p-4 sm:p-5 shadow-xs border-l-4 border-l-emerald-500">
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-lg shadow-2xs">🛡️</span>
              <div className="flex-1">
                <h3 className="font-heading text-sm font-black text-ink tracking-tight">{t("contract.escrowFundedTitle")}</h3>
                <p className="mt-2 text-xs sm:text-sm text-ink/90 leading-relaxed">{t("contract.escrowFundedSellerDesc")}</p>
              </div>
            </div>
          </div>
        )}

        {/* Hali to'lanmagan (to'lov kutilmoqda) */}
        {!funded && contract.status !== "bekor_qilingan" && contract.status !== "yakunlangan" && !pendingDecision && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900">
            {t("cfund.awaitingSeller")}
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
            <MilestoneItem
              key={milestone.id}
              milestone={milestone}
              index={i}
              contractStatus={contract.status}
              revisionsIncluded={contract.revisionsIncluded ?? 2}
              onSubmit={openSubmitModal}
              onViewReceipt={(m) => setReceiptMilestone(m)}
            />
          ))}
        </div>
      </section>

      {/* Ishchi xona muloqoti va fayllar (Chat & Deliverables) */}
      <section className="flex flex-col gap-3">
        <ContractWorkroomChat
          contract={contract}
          milestones={milestones}
          counterpartName={contract.buyerName}
          role="mutaxassis"
        />
      </section>

      {contract.status === "faol" && !disputeOpen && (
        <div className="flex justify-end gap-2">
          <DisputeControl contractId={contract.id} onOpened={reload} />
        </div>
      )}

      {/* Ishni topshirish modali */}
      <Modal
        open={!!submitTarget}
        onClose={() => setSubmitTarget(null)}
        title={t("ms.submitAction")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSubmitTarget(null)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button loading={submitting} onClick={handleSubmitWork}>
              {t("sm.done")}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitWork} className="flex flex-col gap-4">
          <Input
            label={t("sm.link")}
            value={workLink}
            onChange={(e) => {
              setWorkLink(e.target.value);
              setLinkError("");
            }}
            placeholder="https://drive.google.com/..."
            error={linkError}
          />
          <Textarea
            label={t("sm.note")}
            value={workNote}
            onChange={(e) => setWorkNote(e.target.value)}
            rows={4}
          />
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-ink">
              Natija fayli biriktirish (PNG, JPG, PDF, ZIP, TXT — max 5MB)
            </label>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.zip,.txt"
              onChange={handleDeliverableFileChange}
              disabled={uploadingFile || submitting}
              className="text-xs"
            />
            {uploadedFiles.length > 0 && (
              <ul className="space-y-1 text-2xs text-success">
                {uploadedFiles.map((f) => (
                  <li key={f.id}>Yuklandi: {f.name}</li>
                ))}
              </ul>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={rejectOpen}
        title={t("contract.rejectAction")}
        description={t("contract.rejectDesc")}
        confirmLabel={t("contract.rejectAction")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={decisionBusy}
        onConfirm={handleReject}
        onCancel={() => setRejectOpen(false)}
      />

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
