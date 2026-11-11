"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { Milestone } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { platformFee, sellerNet } from "@/lib/fees";
import { useT } from "@/lib/i18n";

interface ReceiptModalProps {
  open: boolean;
  onClose: () => void;
  milestone: Milestone | null;
  contractTitle?: string;
  contractId?: string;
  buyerName?: string;
  sellerName?: string;
}

export function ReceiptModal({
  open,
  onClose,
  milestone,
  contractTitle,
  contractId,
  buyerName,
  sellerName,
}: ReceiptModalProps) {
  const { t, lang } = useT();

  if (!milestone) return null;

  const feeAmount = platformFee(milestone.amount, milestone.platformFeeRateBps);
  const netAmount = sellerNet(milestone.amount, milestone.platformFeeRateBps);

  const receiptNo = `RCP-${(milestone.id || "100").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
  const paidDate = milestone.approvedAt ? formatDate(milestone.approvedAt, lang) : formatDate(new Date().toISOString(), lang);

  function handlePrint() {
    window.print();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("receipt.title")}
      footer={
        <div className="flex w-full items-center justify-between gap-2 print:hidden">
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button onClick={handlePrint} className="gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            {t("receipt.print")}
          </Button>
        </div>
      }
    >
      <div id="printable-receipt" className="flex flex-col gap-6 rounded-card border border-line bg-card p-6 shadow-sm">
        {/* Yuqori qism: Logo va Kvitansiya raqami */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-primary font-heading font-black text-on-primary text-lg">
              BD
            </div>
            <div>
              <span className="font-heading text-base font-extrabold tracking-tight text-ink">
                BOBOLOLADONO
              </span>
              <p className="text-2xs text-muted">Kafolatlangan Freelance Platformasi</p>
            </div>
          </div>
          <div className="text-right">
            <Badge tone="success">{t("receipt.statusPaid")}</Badge>
            <p className="mt-1 font-mono text-xs font-semibold text-ink">{receiptNo}</p>
            <p className="text-2xs text-faint">{paidDate}</p>
          </div>
        </div>

        {/* Tomonlar ma'lumoti */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-input border border-line/60 bg-surface/60 p-3.5 text-xs">
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
              {t("b2b.recipient")} (Ijrochi):
            </span>
            <p className="font-medium text-ink mt-0.5">{sellerName || "Mutaxassis"}</p>
          </div>
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
              To&apos;lovchi (Xaridor):
            </span>
            <p className="font-medium text-ink mt-0.5">{buyerName || "Buyurtmachi"}</p>
          </div>
          <div className="sm:col-span-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
              Loyiha / Shartnoma:
            </span>
            <p className="font-medium text-ink mt-0.5">
              {contractTitle || milestone.title} {contractId ? `(#${contractId})` : ""}
            </p>
          </div>
        </div>

        {/* To'lov tafsilotlari jadvali */}
        <div className="rounded-input border border-line overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface border-b border-line text-2xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="p-3">Bosqich (Milestone) tavsifi</th>
                <th className="p-3 text-right">Summa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="p-3">
                  <p className="font-semibold text-ink">{milestone.title}</p>
                  {milestone.description && (
                    <p className="text-2xs text-muted mt-0.5">{milestone.description}</p>
                  )}
                </td>
                <td className="p-3 text-right font-heading text-sm font-bold text-ink">
                  {formatMoney(milestone.amount, lang)}
                </td>
              </tr>
              <tr>
                <td className="p-3">
                  <p className="font-medium text-muted">Platforma xizmat haqi ({(milestone.platformFeeRateBps ?? 500) / 100}%)</p>
                  <p className="text-2xs text-faint">Xavfsiz Escrow kafolati va tranzaksiya infratuzilmasi</p>
                </td>
                <td className="p-3 text-right font-heading text-xs font-semibold text-muted">
                  -{formatMoney(feeAmount, lang)}
                </td>
              </tr>
            </tbody>
            <tfoot className="bg-surface/50 border-t border-line">
              <tr>
                <td className="p-3 font-semibold text-ink text-right">Mutaxassisga o&apos;tadigan sof summa:</td>
                <td className="p-3 text-right font-heading text-base font-extrabold text-success">
                  {formatMoney(netAmount, lang)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Pastki qism: Muhr va Xavfsizlik kafolati */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="max-w-xs text-2xs text-faint">
            <p>
              Ushbu to&apos;lov Bobololadono Escrow kafolat tizimi orqali tasdiqlangan va
              elektron kvitansiya hisoblanadi. Barcha hisob-kitoblar platforma qoidalariga
              muvofiq shakllantirilgan. Platforma: &quot;Bobololadono&quot; MCHJ.
            </p>
          </div>

          {/* Bobololadono Rasmiy Muhri (Official Escrow Stamp) */}
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-success/60 text-success p-2 text-center select-none rotate-[-6deg]">
            <div className="flex flex-col items-center justify-center leading-none">
              <span className="text-[9px] font-black uppercase tracking-wider">BOBOLOLADONO</span>
              <span className="my-0.5 text-xs font-black uppercase text-success-deep">
                TO&apos;LANGAN
              </span>
              <span className="text-[8px] font-semibold uppercase tracking-widest text-success/80">
                ESCROW VERIFIED
              </span>
              <span className="mt-0.5 text-[7px] font-mono text-muted">KAFOLAT №{receiptNo.slice(-5)}</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
