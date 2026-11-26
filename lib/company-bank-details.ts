/**
 * Bobololadono tashkilot bank rekvizitlari helperlari.
 *
 * QAT'IY QOIDA: Haqiqiy tasdiqlangan bank rekvizitlari FAQAT muhit
 * o‘zgaruvchilari (`NEXT_PUBLIC_COMPANY_*` / backend `GET /payments/bank-details`)
 * orqali beriladi. Hech qachon namuna / uydirma hisob raqami ko‘rsatilmaydi.
 */

export interface CompanyBankDetails {
  companyName: string;
  bankName: string;
  accountNumber: string;
  mfo: string;
  inn: string;
  bankAddress?: string | null;
  supportPhone?: string | null;
}

export function getEnvCompanyBankDetails(): CompanyBankDetails | null {
  const companyName = process.env.NEXT_PUBLIC_COMPANY_NAME?.trim();
  const bankName = process.env.NEXT_PUBLIC_COMPANY_BANK_NAME?.trim();
  const accountNumber = process.env.NEXT_PUBLIC_COMPANY_BANK_ACCOUNT?.trim();
  const mfo = process.env.NEXT_PUBLIC_COMPANY_BANK_MFO?.trim();
  const inn = process.env.NEXT_PUBLIC_COMPANY_BANK_INN?.trim();
  if (!companyName || !bankName || !accountNumber || !mfo || !inn) {
    return null;
  }
  return {
    companyName,
    bankName,
    accountNumber,
    mfo,
    inn,
    bankAddress: process.env.NEXT_PUBLIC_COMPANY_BANK_ADDRESS?.trim() || null,
    supportPhone: process.env.NEXT_PUBLIC_COMPANY_SUPPORT_PHONE?.trim() || null,
  };
}

/** Shartnoma uchun unikal to‘lov moslashtirish kodi */
export function generatePaymentReference(contractId: string): string {
  const cleanId = contractId.replace(/^cnt-/, "").slice(0, 8).toUpperCase();
  return `BD-${cleanId}`;
}

/** To'lov maqsadi matnini shakllantirish */
export function getPaymentPurpose(reference: string): string {
  return `Bobololadono: ${reference} shartnomasi bo'yicha to'lov`;
}
