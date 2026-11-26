"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader, MetricCard, Pagination } from "@/components/admin/AdminUI";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Table, type TableColumn } from "@/components/ui/Table";
import {
  staffListPayments,
  staffListBankProofs,
  staffVerifyBankProof,
  staffRejectBankProof,
  staffListRefunds,
  staffCreateRefund,
  staffConfirmManualBankRefund,
  staffListPayouts,
  staffStartPayoutProcessing,
  staffMarkPayoutPaid,
  staffRejectPayout,
  staffCorrectPayout,
  staffListSpecialistsPayoutSummary,
  staffListLedgerTransactions,
  type StaffPayment,
  type StaffBankProof,
  type StaffRefund,
  type StaffPayout,
  type StaffSpecialistPayoutSummary,
  type StaffLedgerTransaction,
} from "@/lib/api/admin";
import { adminErrorText } from "@/lib/admin-error-text";
import { formatDate, formatMoney } from "@/lib/format";

type Tab = "bank-proofs" | "payouts" | "specialists" | "payments" | "refunds" | "ledger";
type PageResult<T> = { items: T[]; page: number; perPage: number; total: number; totalPages: number };

const TONE: Record<string, BadgeTone> = {
  SUCCEEDED: "success",
  APPROVED: "success",
  PENDING: "warning",
  PENDING_REVIEW: "warning",
  PROCESSING: "info",
  OVERPAID_REVIEW: "warning",
  UNDERPAID: "danger",
  FAILED: "danger",
  REJECTED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

export default function PaymentsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("bank-proofs");
  const [bankProofPage, setBankProofPage] = useState<PageResult<StaffBankProof> | null>(null);
  const [payoutPage, setPayoutPage] = useState<PageResult<StaffPayout> | null>(null);
  const [specialistsSummary, setSpecialistsSummary] = useState<StaffSpecialistPayoutSummary[] | null>(null);
  const [paymentPage, setPaymentPage] = useState<PageResult<StaffPayment> | null>(null);
  const [refundPage, setRefundPage] = useState<PageResult<StaffRefund & { bankOperationRef?: string | null; provider?: string }> | null>(null);
  const [ledgerPage, setLedgerPage] = useState<PageResult<StaffLedgerTransaction> | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [busy, setBusy] = useState(false);

  // Verify incoming bank proof modal
  const [verifyProofTarget, setVerifyProofTarget] = useState<StaffBankProof | null>(null);
  const [verifyAmount, setVerifyAmount] = useState("");
  const [verifyBankRef, setVerifyBankRef] = useState("");
  const [verifyAllowSurplus, setVerifyAllowSurplus] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyError, setVerifyError] = useState("");

  // Reject incoming bank proof modal
  const [rejectProofTarget, setRejectProofTarget] = useState<StaffBankProof | null>(null);
  const [rejectProofReason, setRejectProofReason] = useState("");

  // Mark Payout Paid modal
  const [markPaidTarget, setMarkPaidTarget] = useState<StaffPayout | null>(null);
  const [paidAmount, setPaidAmount] = useState("");
  const [paidBankRef, setPaidBankRef] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [paidNote, setPaidNote] = useState("");
  const [paidError, setPaidError] = useState("");

  // Reject Payout modal
  const [rejectPayoutTarget, setRejectPayoutTarget] = useState<StaffPayout | null>(null);
  const [rejectPayoutReason, setRejectPayoutReason] = useState("");
  const [rejectPayoutError, setRejectPayoutError] = useState("");

  // Audit Correction Payout modal
  const [correctTarget, setCorrectTarget] = useState<StaffPayout | null>(null);
  const [correctRef, setCorrectRef] = useState("");
  const [correctReason, setCorrectReason] = useState("");
  const [correctError, setCorrectError] = useState("");

  // Refund modals
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundContractId, setRefundContractId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState("");
  const [confirmRefundTarget, setConfirmRefundTarget] = useState<(StaffRefund & { bankOperationRef?: string | null; provider?: string }) | null>(null);
  const [refundBankRef, setRefundBankRef] = useState("");

  const load = useCallback(() => {
    setLoadError(null);
    const query = { page: currentPage, perPage: rowsPerPage };
    const req =
      tab === "bank-proofs"
        ? staffListBankProofs(query).then(setBankProofPage)
        : tab === "payouts"
          ? staffListPayouts(query).then(setPayoutPage)
          : tab === "specialists"
            ? staffListSpecialistsPayoutSummary().then(setSpecialistsSummary)
            : tab === "payments"
              ? staffListPayments(query).then(setPaymentPage)
              : tab === "refunds"
                ? staffListRefunds(query).then(setRefundPage)
                : staffListLedgerTransactions(query).then(setLedgerPage);
    req.catch(setLoadError);
  }, [tab, currentPage, rowsPerPage]);

  useEffect(load, [load]);
  useEffect(() => { setCurrentPage(1); }, [tab, rowsPerPage]);

  async function handleStartProcessing(payout: StaffPayout) {
    setBusy(true);
    try {
      await staffStartPayoutProcessing(payout.id);
      toast("Ariza ishlovga olindi (PROCESSING). Endi bank o'tkazmasini bajaring.");
      load();
    } catch (err) {
      toast(adminErrorText(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPaid() {
    if (!markPaidTarget) return;
    if (!paidBankRef.trim() || paidBankRef.trim().length < 3) {
      setPaidError("Bank operatsiya raqamini kiriting.");
      return;
    }
    const amt = Number(paidAmount);
    if (!amt || amt <= 0) {
      setPaidError("O'tkazilgan summani kiriting.");
      return;
    }
    setBusy(true);
    setPaidError("");
    try {
      await staffMarkPayoutPaid(markPaidTarget.id, {
        bankOperationRef: paidBankRef.trim(),
        transferredAmount: amt,
        bankTransferredAt: paidDate ? new Date(paidDate).toISOString() : undefined,
        note: paidNote.trim() || undefined,
      });
      toast("Bank o'tkazmasi qayd etildi (SUCCEEDED).");
      setMarkPaidTarget(null);
      load();
    } catch (err) {
      setPaidError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectPayout() {
    if (!rejectPayoutTarget) return;
    if (rejectPayoutReason.trim().length < 5) {
      setRejectPayoutError("Rad etish sababini kamida 5 ta belgi bilan yozing.");
      return;
    }
    setBusy(true);
    setRejectPayoutError("");
    try {
      await staffRejectPayout(rejectPayoutTarget.id, rejectPayoutReason.trim());
      toast("So'rov rad etildi va summa mutaxassis balansiga qaytarildi.");
      setRejectPayoutTarget(null);
      load();
    } catch (err) {
      setRejectPayoutError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCorrectPayout() {
    if (!correctTarget) return;
    if (correctReason.trim().length < 10) {
      setCorrectError("Tuzatish sababini kamida 10 ta belgi bilan yozing.");
      return;
    }
    setBusy(true);
    setCorrectError("");
    try {
      await staffCorrectPayout(correctTarget.id, {
        bankOperationRef: correctRef.trim() || undefined,
        reason: correctReason.trim(),
      });
      toast("Audit tuzatish yozuvi saqlandi.");
      setCorrectTarget(null);
      load();
    } catch (err) {
      setCorrectError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyBankProof() {
    if (!verifyProofTarget) return;
    const amt = Number(verifyAmount);
    if (!amt || amt <= 0 || verifyBankRef.trim().length < 3) {
      setVerifyError("Haqiqiy tushgan summa va unikal bank operatsiya raqamini kiriting.");
      return;
    }
    setBusy(true);
    setVerifyError("");
    try {
      const updated = await staffVerifyBankProof(verifyProofTarget.id, {
        receivedAmount: amt,
        bankOperationRef: verifyBankRef.trim(),
        allowOverpaymentSurplus: verifyAllowSurplus,
        note: verifyNote.trim() || undefined,
      });
      if (updated.status === "APPROVED") {
        toast("Kirim tasdiqlandi va shartnoma Escrowga mablag'landi!");
      } else {
        toast(`Chek holati yangilandi: ${updated.status}`);
      }
      setVerifyProofTarget(null);
      load();
    } catch (err) {
      setVerifyError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const bankProofColumns: TableColumn<StaffBankProof>[] = [
    { key: "code", header: "Kod", render: (b) => <span className="font-mono text-2xs font-bold">{b.paymentPurposeCode}</span> },
    { key: "contract", header: "Buyurtma / Xaridor", render: (b) => <div><p className="text-xs font-medium">{b.contractTitle || b.contractId.slice(0, 8)}</p><p className="text-2xs text-muted">{b.buyerName || b.buyerId.slice(0, 8)}</p></div> },
    { key: "amounts", header: "Summa", render: (b) => <div className="text-xs"><p>Shartnoma: <strong>{formatMoney(b.contractAgreedAmount ?? b.declaredAmount)}</strong></p>{b.receivedAmount !== null && b.receivedAmount !== undefined && <p>Tushdi: {formatMoney(b.receivedAmount)}</p>}{b.mismatchAmount !== 0 && <p className="text-danger">Farq: {formatMoney(b.mismatchAmount)}</p>}</div> },
    { key: "proof", header: "Chek", render: (b) => <div className="text-2xs">{b.receiptFileUrl && <a href={b.receiptFileUrl} target="_blank" rel="noreferrer" className="text-primary underline block">Chek fayli</a>}{b.receiptNote && <span className="text-muted">{b.receiptNote}</span>}</div> },
    { key: "status", header: "Holat", render: (b) => <Badge tone={TONE[b.status] ?? "neutral"}>{b.status}</Badge> },
    {
      key: "actions",
      header: "Amal",
      render: (b) => ["PENDING_REVIEW", "UNDERPAID", "OVERPAID_REVIEW"].includes(b.status) ? (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => { setVerifyProofTarget(b); setVerifyAmount(String(b.contractAgreedAmount ?? b.declaredAmount)); setVerifyBankRef(b.bankOperationRef ?? ""); setVerifyAllowSurplus(false); setVerifyNote(""); setVerifyError(""); }}>
            Tekshirish
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => { setRejectProofTarget(b); setRejectProofReason(""); }}>
            Rad etish
          </Button>
        </div>
      ) : <span className="font-mono text-2xs text-muted">{b.bankOperationRef || "Yakunlangan"}</span>,
    },
  ];

  const payoutColumns: TableColumn<StaffPayout>[] = [
    { key: "seller", header: "Mutaxassis", render: (p) => <div className="text-xs"><p className="font-medium">{p.sellerName || p.sellerId.slice(0, 8)}</p><p className="text-2xs text-muted">{p.sellerPhone || ""}</p></div> },
    { key: "dest", header: "Rekvizit", render: (p) => <span className="text-xs">{p.destinationReference}</span> },
    { key: "amount", header: "Summa", render: (p) => <span className="font-mono font-semibold">{formatMoney(p.amount)}</span> },
    {
      key: "status",
      header: "Holat",
      render: (p) => (
        <div className="flex flex-col gap-0.5">
          <Badge tone={TONE[p.status] ?? "neutral"}>{p.status}</Badge>
          {p.bankOperationRef && <span className="font-mono text-2xs text-muted">Ref: {p.bankOperationRef}</span>}
          {p.failureReason && <span className="text-2xs text-danger">{p.failureReason}</span>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Amallar",
      render: (p) => (
        <div className="flex flex-wrap gap-1.5">
          {p.status === "PENDING" && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleStartProcessing(p)}>
                Ishlovga olish
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => { setRejectPayoutTarget(p); setRejectPayoutReason(""); setRejectPayoutError(""); }}>
                Rad etish
              </Button>
            </>
          )}
          {p.status === "PROCESSING" && (
            <>
              <Button size="sm" disabled={busy} onClick={() => { setMarkPaidTarget(p); setPaidAmount(String(p.amount)); setPaidBankRef(""); setPaidDate(new Date().toISOString().slice(0, 10)); setPaidNote(""); setPaidError(""); }}>
                Bank orqali o&apos;tkazildi
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => { setRejectPayoutTarget(p); setRejectPayoutReason(""); setRejectPayoutError(""); }}>
                Rad etish
              </Button>
            </>
          )}
          {p.status === "SUCCEEDED" && (
            <Button size="sm" variant="ghost" onClick={() => { setCorrectTarget(p); setCorrectRef(p.bankOperationRef ?? ""); setCorrectReason(""); setCorrectError(""); }}>
              Audit tuzatish
            </Button>
          )}
        </div>
      ),
    },
  ];

  const paymentColumns: TableColumn<StaffPayment>[] = [
    { key: "id", header: "To'lov ID", render: (p) => <span className="font-mono text-2xs">{p.id.slice(0, 10)}</span> },
    { key: "contractId", header: "Shartnoma", render: (p) => <span className="font-mono text-2xs">{p.contractId.slice(0, 10)}</span> },
    { key: "provider", header: "Provayder", render: (p) => p.provider },
    { key: "amount", header: "Summa", render: (p) => formatMoney(p.amount) },
    { key: "status", header: "Holat", render: (p) => <Badge tone={TONE[p.status] ?? "neutral"}>{p.status}</Badge> },
    { key: "createdAt", header: "Sana", render: (p) => formatDate(p.createdAt) },
  ];

  const refundColumns: TableColumn<StaffRefund & { bankOperationRef?: string | null; provider?: string }>[] = [
    { key: "id", header: "ID", render: (r) => <span className="font-mono text-2xs">{r.id.slice(0, 10)}</span> },
    { key: "contractId", header: "Shartnoma", render: (r) => <span className="font-mono text-2xs">{r.contractId.slice(0, 10)}</span> },
    { key: "amount", header: "Summa", render: (r) => formatMoney(r.amount) },
    { key: "reason", header: "Sabab", render: (r) => r.reason },
    { key: "status", header: "Holat", render: (r) => <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge> },
    {
      key: "actions",
      header: "Amal",
      render: (r) =>
        r.provider === "MANUAL_BANK" && (r.status === "PENDING" || r.status === "PROCESSING") ? (
          <Button size="sm" onClick={() => { setConfirmRefundTarget(r); setRefundBankRef(""); }}>
            Bank qaytarishini qayd etish
          </Button>
        ) : (
          <span className="font-mono text-2xs">{r.bankOperationRef || formatDate(r.createdAt)}</span>
        ),
    },
  ];

  const ledgerColumns: TableColumn<StaffLedgerTransaction>[] = [
    { key: "id", header: "Tranzaksiya", render: (t) => <span className="font-mono text-2xs">{t.id.slice(0, 10)}</span> },
    { key: "type", header: "Turi", render: (t) => <Badge tone="neutral">{t.type}</Badge> },
    {
      key: "entries",
      header: "Yozuvlar",
      render: (t) => (
        <div className="flex flex-col gap-0.5">
          {t.entries.map((e) => (
            <span key={e.id} className="font-mono text-2xs">
              {e.accountType}: {e.amount > 0 ? "+" : ""}{formatMoney(e.amount)}
            </span>
          ))}
        </div>
      ),
    },
    { key: "createdAt", header: "Sana", render: (t) => formatDate(t.createdAt) },
  ];

  const header = (
    <AdminPageHeader
      title="Moliya, Kirim Cheklari & Qo'lda Bank Payout"
      description="Xaridorlardan kelgan bank o'tkazma cheklarini tasdiqlash, mutaxassislar pul yechish so'rovlarini bajarish va to'liq buxgalteriya hisobi."
    />
  );

  if (loadError) {
    return (
      <>
        {header}
        <ErrorState error={loadError} onRetry={load} />
      </>
    );
  }

  return (
    <>
      {header}

      <Card padding="md" className="mt-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex border-b border-line overflow-x-auto max-w-full pb-0.5">
            {(
              [
                { id: "bank-proofs", label: "Bank kirim cheklari" },
                { id: "payouts", label: "Pul yechish (Payout)" },
                { id: "specialists", label: "Mutaxassislar hisoboti" },
                { id: "payments", label: "To'lovlar" },
                { id: "refunds", label: "Qaytarishlar" },
                { id: "ledger", label: "Ledger" },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-4 py-2 font-heading text-xs font-bold whitespace-nowrap shrink-0 ${
                  tab === t.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "refunds" && (
            <Button size="sm" onClick={() => setRefundOpen(true)}>
              + Qaytarish yaratish
            </Button>
          )}
        </div>
      </Card>

      <div className="mt-4">
        {tab === "bank-proofs" &&
          (!bankProofPage ? (
            <LoadingState message="Cheklar yuklanmoqda..." />
          ) : (
            <>
              <MetricCard label="Jami cheklar" value={bankProofPage.total} detail="Qo'lda bank o'tkazma cheklari" />
              <div className="mt-4">
                <Table columns={bankProofColumns} rows={bankProofPage.items} rowKey={(b) => b.id} />
                <Pagination currentPage={bankProofPage.page} totalPages={bankProofPage.totalPages} onPageChange={setCurrentPage} totalRows={bankProofPage.total} rowsPerPage={bankProofPage.perPage} onRowsPerPageChange={setRowsPerPage} />
              </div>
            </>
          ))}

        {tab === "payouts" &&
          (!payoutPage ? (
            <LoadingState message="Pul yechish so'rovlari yuklanmoqda..." />
          ) : (
            <>
              <Table columns={payoutColumns} rows={payoutPage.items} rowKey={(p) => p.id} />
              <Pagination currentPage={payoutPage.page} totalPages={payoutPage.totalPages} onPageChange={setCurrentPage} totalRows={payoutPage.total} rowsPerPage={payoutPage.perPage} onRowsPerPageChange={setRowsPerPage} />
            </>
          ))}

        {tab === "specialists" &&
          (!specialistsSummary ? (
            <LoadingState message="Mutaxassislar hisoboti yuklanmoqda..." />
          ) : (
            <div className="flex flex-col gap-3">
              {specialistsSummary.map((s) => (
                <Card key={s.sellerId} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <div>
                      <p className="font-semibold text-sm text-ink">{s.sellerName}</p>
                      <p className="text-2xs text-muted">{s.sellerPhone}</p>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs">
                      <span>Brutto: <strong>{formatMoney(s.grossTotal)}</strong></span>
                      <span>Komissiya: <strong>{formatMoney(s.commissionTotal)}</strong></span>
                      <span>Sof: <strong>{formatMoney(s.netTotal)}</strong></span>
                      <span>Band: <strong>{formatMoney(s.reservedBalance)}</strong></span>
                      <span className="text-success">To&apos;langan: <strong>{formatMoney(s.paidTotal)}</strong></span>
                      <span className="text-primary">Qolgan: <strong>{formatMoney(s.availableBalance)}</strong></span>
                    </div>
                  </div>
                  {s.contracts.length > 0 && (
                    <div className="mt-2 space-y-1 text-2xs text-muted">
                      {s.contracts.map((c) => (
                        <div key={c.contractId} className="flex justify-between">
                          <span>{c.title}</span>
                          <span>{formatMoney(c.grossAmount)} − {c.commissionRateBps / 100}% ({formatMoney(c.commissionAmount)}) = <strong>{formatMoney(c.netAmount)}</strong></span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          ))}

        {tab === "payments" && (!paymentPage ? <LoadingState /> : <><Table columns={paymentColumns} rows={paymentPage.items} rowKey={(p) => p.id} /><Pagination currentPage={paymentPage.page} totalPages={paymentPage.totalPages} onPageChange={setCurrentPage} totalRows={paymentPage.total} rowsPerPage={paymentPage.perPage} onRowsPerPageChange={setRowsPerPage} /></>)}
        {tab === "refunds" && (!refundPage ? <LoadingState /> : <><Table columns={refundColumns} rows={refundPage.items} rowKey={(r) => r.id} /><Pagination currentPage={refundPage.page} totalPages={refundPage.totalPages} onPageChange={setCurrentPage} totalRows={refundPage.total} rowsPerPage={refundPage.perPage} onRowsPerPageChange={setRowsPerPage} /></>)}
        {tab === "ledger" && (!ledgerPage ? <LoadingState /> : <><Table columns={ledgerColumns} rows={ledgerPage.items} rowKey={(t) => t.id} /><Pagination currentPage={ledgerPage.page} totalPages={ledgerPage.totalPages} onPageChange={setCurrentPage} totalRows={ledgerPage.total} rowsPerPage={ledgerPage.perPage} onRowsPerPageChange={setRowsPerPage} /></>)}
      </div>

      {/* Bank kirim chekini tekshirish modali */}
      <Modal
        open={!!verifyProofTarget}
        onClose={() => !busy && setVerifyProofTarget(null)}
        title="Bank kirimini tasdiqlash"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVerifyProofTarget(null)} disabled={busy}>Bekor qilish</Button>
            <Button loading={busy} onClick={handleVerifyBankProof}>Tasdiqlash</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-xs">
          {verifyProofTarget && (
            <p className="text-muted">
              Shartnoma summasi: <strong>{formatMoney(verifyProofTarget.contractAgreedAmount ?? verifyProofTarget.declaredAmount)}</strong> · Kod: <strong>{verifyProofTarget.paymentPurposeCode}</strong>
            </p>
          )}
          <Input label="Bank hisobiga haqiqatda tushgan summa (so'm)" type="number" value={verifyAmount} onChange={(e) => setVerifyAmount(e.target.value)} />
          <Input label="Unikal bank operatsiya raqami" value={verifyBankRef} onChange={(e) => setVerifyBankRef(e.target.value)} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={verifyAllowSurplus} onChange={(e) => setVerifyAllowSurplus(e.target.checked)} />
            <span>Ortiqcha summa bo&apos;lsa, ortig&apos;ini qaytarish sharti bilan mablag&apos;lash</span>
          </label>
          <Textarea label="Izoh" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} rows={2} />
          {verifyError && <p className="text-danger">{verifyError}</p>}
        </div>
      </Modal>

      {/* Bank chekini rad etish */}
      <Modal
        open={!!rejectProofTarget}
        onClose={() => !busy && setRejectProofTarget(null)}
        title="Kirim chekini rad etish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectProofTarget(null)} disabled={busy}>Bekor qilish</Button>
            <Button variant="danger" loading={busy} onClick={async () => {
              if (!rejectProofTarget || rejectProofReason.trim().length < 5) return;
              setBusy(true);
              try {
                await staffRejectBankProof(rejectProofTarget.id, rejectProofReason.trim());
                toast("Chek rad etildi");
                setRejectProofTarget(null);
                load();
              } catch (err) { toast(adminErrorText(err), "error"); }
              finally { setBusy(false); }
            }}>Rad etish</Button>
          </>
        }
      >
        <Textarea label="Sabab (kamida 5 belgi)" value={rejectProofReason} onChange={(e) => setRejectProofReason(e.target.value)} rows={3} />
      </Modal>

      {/* Bank orqali payout o'tkazilganini qayd etish */}
      <Modal
        open={!!markPaidTarget}
        onClose={() => !busy && setMarkPaidTarget(null)}
        title="Bank orqali o'tkazilganini qayd etish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMarkPaidTarget(null)} disabled={busy}>Bekor qilish</Button>
            <Button loading={busy} onClick={handleMarkPaid}>Qayd etish (SUCCEEDED)</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-xs">
          {markPaidTarget && (
            <p className="text-muted">
              Rekvizit: <strong>{markPaidTarget.destinationReference}</strong> · Summa: <strong>{formatMoney(markPaidTarget.amount)}</strong>
            </p>
          )}
          <Input label="Bank operatsiya / to'lov hujjati raqami *" value={paidBankRef} onChange={(e) => setPaidBankRef(e.target.value)} />
          <Input label="O'tkazilgan summa (so'm) *" type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
          <Input label="O'tkazma sanasi" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          <Textarea label="Izoh" value={paidNote} onChange={(e) => setPaidNote(e.target.value)} rows={2} />
          {paidError && <p className="text-danger">{paidError}</p>}
        </div>
      </Modal>

      {/* Payout rad etish */}
      <Modal
        open={!!rejectPayoutTarget}
        onClose={() => !busy && setRejectPayoutTarget(null)}
        title="Pul yechish so'rovini rad etish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectPayoutTarget(null)} disabled={busy}>Bekor qilish</Button>
            <Button variant="danger" loading={busy} onClick={handleRejectPayout}>Rad etish va balansni bo&apos;shatish</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Textarea label="Rad etish sababi (kamida 5 belgi) *" value={rejectPayoutReason} onChange={(e) => setRejectPayoutReason(e.target.value)} rows={3} />
          {rejectPayoutError && <p className="text-xs text-danger">{rejectPayoutError}</p>}
        </div>
      </Modal>

      {/* Audit tuzatish */}
      <Modal
        open={!!correctTarget}
        onClose={() => !busy && setCorrectTarget(null)}
        title="Audit tuzatish yozuvi kiritish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCorrectTarget(null)} disabled={busy}>Bekor qilish</Button>
            <Button loading={busy} onClick={handleCorrectPayout}>Tuzatishni saqlash</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input label="Yangi bank operatsiya raqami" value={correctRef} onChange={(e) => setCorrectRef(e.target.value)} />
          <Textarea label="Tuzatish sababi (kamida 10 belgi) *" value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} rows={3} />
          {correctError && <p className="text-xs text-danger">{correctError}</p>}
        </div>
      </Modal>

      {/* Refund yaratish */}
      <Modal
        open={refundOpen}
        onClose={() => !busy && setRefundOpen(false)}
        title="Yangi qaytarish yaratish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefundOpen(false)} disabled={busy}>Bekor qilish</Button>
            <Button variant="danger" loading={busy} onClick={async () => {
              if (!refundContractId.trim() || refundReason.trim().length < 10) {
                setRefundError("Shartnoma ID va kamida 10 belgili sabab kiriting.");
                return;
              }
              setBusy(true);
              try {
                await staffCreateRefund(refundContractId.trim(), refundReason.trim());
                toast("Qaytarish so'rovi yaratildi");
                setRefundOpen(false);
                load();
              } catch (err) { setRefundError(adminErrorText(err)); }
              finally { setBusy(false); }
            }}>Yaratish</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input label="Shartnoma ID" value={refundContractId} onChange={(e) => setRefundContractId(e.target.value)} />
          <Textarea label="Sabab (10+ belgi)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={3} />
          {refundError && <p className="text-xs text-danger">{refundError}</p>}
        </div>
      </Modal>

      {/* Qo'lda bank qaytarishini tasdiqlash */}
      <Modal
        open={!!confirmRefundTarget}
        onClose={() => !busy && setConfirmRefundTarget(null)}
        title="Xaridorga bank orqali qaytarilganini qayd etish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRefundTarget(null)} disabled={busy}>Bekor qilish</Button>
            <Button loading={busy} onClick={async () => {
              if (!confirmRefundTarget || refundBankRef.trim().length < 3) return;
              setBusy(true);
              try {
                await staffConfirmManualBankRefund(confirmRefundTarget.id, { bankOperationRef: refundBankRef.trim() });
                toast("Qaytarish tasdiqlandi (SUCCEEDED) va shartnoma bekor qilindi.");
                setConfirmRefundTarget(null);
                load();
              } catch (err) { toast(adminErrorText(err), "error"); }
              finally { setBusy(false); }
            }}>Tasdiqlash</Button>
          </>
        }
      >
        <Input label="Bank qaytarish hujjat raqami *" value={refundBankRef} onChange={(e) => setRefundBankRef(e.target.value)} />
      </Modal>
    </>
  );
}
