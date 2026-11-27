"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  getEnvCompanyBankDetails,
  generatePaymentReference,
  getPaymentPurpose,
  type CompanyBankDetails,
} from "@/lib/company-bank-details";
import type { Contract, Milestone } from "@/lib/types";

interface B2BInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  contract: Contract;
  milestones?: Milestone[];
  bankDetails?: CompanyBankDetails | null;
}

export function B2BInvoiceModal({
  open,
  onClose,
  contract,
  milestones = [],
  bankDetails,
}: B2BInvoiceModalProps) {
  const { lang } = useT();

  if (!contract) return null;

  const resolvedBank = bankDetails ?? getEnvCompanyBankDetails();
  const isRu = lang === "ru";
  const invoiceNo = `BD-INV-2026-${(contract.id || "1").replace(/\D/g, "").slice(0, 6).padStart(4, "0")}`;
  const invoiceDate = formatDate(contract.createdAt || new Date().toISOString(), lang);
  const paymentRef = contract.paymentPurposeCode || contract.paymentReference || generatePaymentReference(contract.id);
  const paymentPurpose = getPaymentPurpose(paymentRef);

  function handlePrint() {
    window.print();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isRu ? "Счет на оплату (Invoice)" : "To'lov uchun hisob (Hisob-faktura)"}
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3 print:hidden">
          <Button variant="ghost" onClick={onClose}>
            {isRu ? "Закрыть" : "Yopish"}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handlePrint} className="gap-2 font-semibold">
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
              {isRu ? "Распечатать / Скачать PDF" : "Chop etish / PDF yuklab olish"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6 text-ink p-1 sm:p-2 bg-white text-xs sm:text-sm font-sans">
        {/* Invoice Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-white font-black text-xl shadow-md">
              B
            </div>
            <div>
              <h2 className="font-heading text-lg sm:text-xl font-black tracking-tight text-ink">
                BOBOLOLADONO MChJ
              </h2>
              <p className="text-2xs text-muted">
                Kafolatlangan IT va frilans xizmatlari platformasi
              </p>
            </div>
          </div>
          <div className="text-right">
            <Badge tone="success" className="font-mono text-2xs uppercase">
              B2B Official Invoice
            </Badge>
            <p className="mt-1 font-mono text-sm sm:text-base font-black text-ink">
              № {invoiceNo}
            </p>
            <p className="text-2xs text-muted">
              {isRu ? "Дата:" : "Sana:"} {invoiceDate}
            </p>
          </div>
        </div>

        {/* Bank details grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-2xl border border-line bg-surface/50 p-4">
          {/* Supplier */}
          <div className="flex flex-col gap-1.5 border-b md:border-b-0 md:border-r border-line pb-4 md:pb-0 md:pr-4">
            <span className="text-3xs uppercase font-extrabold text-muted tracking-wider">
              {isRu ? "Поставщик (Исполнитель):" : "Yetkazib beruvchi (Ijrochi):"}
            </span>
            {resolvedBank ? (
              <>
                <strong className="text-xs sm:text-sm font-black text-ink">
                  {resolvedBank.companyName}
                </strong>
                <div className="text-2xs sm:text-xs text-muted space-y-0.5">
                  <div>
                    <span className="font-semibold text-ink">Hisob raqam:</span>{" "}
                    <span className="font-mono font-bold text-ink">{resolvedBank.accountNumber}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-ink">Bank:</span> {resolvedBank.bankName}
                  </div>
                  <div className="flex gap-4">
                    <span>
                      <span className="font-semibold text-ink">MFO:</span>{" "}
                      <strong className="font-mono">{resolvedBank.mfo}</strong>
                    </span>
                    <span>
                      <span className="font-semibold text-ink">INN:</span>{" "}
                      <strong className="font-mono">{resolvedBank.inn}</strong>
                    </span>
                  </div>
                  {resolvedBank.bankAddress && (
                    <div>
                      <span className="font-semibold text-ink">Manzil:</span> {resolvedBank.bankAddress}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-warning-deep">
                Tashkilotning rasmiy bank rekvizitlari hali kiritilmagan. Hisob-faktura rekvizitlar tasdiqlangach chiqariladi.
              </p>
            )}
          </div>

          {/* Buyer */}
          <div className="flex flex-col gap-1.5 md:pl-2">
            <span className="text-3xs uppercase font-extrabold text-muted tracking-wider">
              {isRu ? "Плательщик (Заказчик):" : "To'lovchi (Buyurtmachi):"}
            </span>
            <strong className="text-xs sm:text-sm font-black text-ink">
              {contract.buyerName || "Buyurtmachi tashkilot"}
            </strong>
            <div className="text-2xs sm:text-xs text-muted space-y-0.5">
              <div>
                <span className="font-semibold text-ink">Shartnoma raqami:</span>{" "}
                <span className="font-mono font-bold text-ink">
                  {contract.contractNumber || contract.id}
                </span>
              </div>
              <div>
                <span className="font-semibold text-ink">Loyiha nomi:</span> {contract.title}
              </div>
              <div>
                <span className="font-semibold text-ink">Ijrochi:</span> {contract.sellerName}
              </div>
            </div>
          </div>
        </div>

        {/* Services table */}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface text-2xs uppercase text-muted font-bold border-b border-line">
              <tr>
                <th className="p-3 w-10 text-center">№</th>
                <th className="p-3">{isRu ? "Наименование услуг" : "Xizmat nomi va tavsifi"}</th>
                <th className="p-3 text-center w-20">{isRu ? "Кол-во" : "Miqdori"}</th>
                <th className="p-3 text-right w-28">{isRu ? "Цена" : "Narxi"}</th>
                <th className="p-3 text-right w-32">{isRu ? "Сумма" : "Jami"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {milestones.length > 0 ? (
                milestones.map((m, idx) => (
                  <tr key={m.id}>
                    <td className="p-3 text-center font-bold text-muted">{idx + 1}</td>
                    <td className="p-3">
                      <div className="font-semibold text-ink">{m.title}</div>
                      <div className="text-3xs text-muted">Loyiha bosqichi (Escrow kafolati)</div>
                    </td>
                    <td className="p-3 text-center">1 dona</td>
                    <td className="p-3 text-right font-mono">{formatMoney(m.amount, lang)}</td>
                    <td className="p-3 text-right font-mono font-bold">{formatMoney(m.amount, lang)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="p-3 text-center font-bold text-muted">1</td>
                  <td className="p-3">
                    <div className="font-semibold text-ink">{contract.title}</div>
                    <div className="text-3xs text-muted">
                      Bobololadono xavfsiz Escrow kafolat hisobi orqali mutaxassis xizmatlari
                    </div>
                  </td>
                  <td className="p-3 text-center">1 xizmat</td>
                  <td className="p-3 text-right font-mono">{formatMoney(contract.totalAmount, lang)}</td>
                  <td className="p-3 text-right font-mono font-bold">
                    {formatMoney(contract.totalAmount, lang)}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-line bg-surface/50 font-bold">
              <tr>
                <td colSpan={4} className="p-3 text-right uppercase text-2xs text-muted">
                  QQS (0% / QQSsiz):
                </td>
                <td className="p-3 text-right font-mono text-muted">0 so&apos;m</td>
              </tr>
              <tr className="border-t border-line text-sm">
                <td colSpan={4} className="p-3 text-right uppercase font-black text-ink">
                  {isRu ? "ИТОГО К ОПЛАТЕ:" : "JAMI TO'LANISHI KERAK:"}
                </td>
                <td className="p-3 text-right font-mono font-black text-primary text-base">
                  {formatMoney(contract.totalAmount, lang)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Payment Purpose box */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-xs">
          <div className="font-bold text-ink">
            {isRu ? "Назначение платежа для платежного поручения:" : "To'lov topshirig'i uchun to'lov maqsadi:"}
          </div>
          <div className="mt-1 font-mono text-2xs sm:text-xs font-semibold text-primary select-all">
            {paymentPurpose}. Shartnoma {contract.contractNumber || contract.id}. QQSsiz.
          </div>
        </div>

        {/* Stamp & signature */}
        <div className="mt-2 pt-4 border-t border-line flex items-center justify-between gap-4 text-2xs text-muted">
          <div className="space-y-1">
            <div>
              <strong>Ijrochi vakili:</strong> Direktor __________________ (Niyazov S.)
            </div>
            <div>
              <strong>Bosh buxgalter:</strong> __________________ (Buxgalteriya xizmati)
            </div>
          </div>
          <div className="border-2 border-dashed border-primary/40 rounded-xl p-3 text-center text-3xs text-primary font-bold">
            <div>M.O&apos;. (MUHR O&apos;RNI)</div>
            <div className="font-mono text-2xs">BOBOLOLADONO MCHJ</div>
            <div>TOSHKENT SH. 2026</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
