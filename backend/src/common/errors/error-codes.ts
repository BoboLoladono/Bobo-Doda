/**
 * Xato taksonomiyasi — frontend `lib/api/errors.ts` bilan BITTA SHARTNOMA.
 *
 * Server javob tanasi: `{ code, message?, fieldErrors?, requestId? }`.
 * Frontend `toApiError()` avval `code` ni (aniqroq), keyin HTTP statusni
 * o'qiydi. Bu yerdagi HAR kod OpenAPI'ga chiqadi va frontend `errors.ts`
 * o'sha yerdan generatsiya qilinadi (qo'lda ikki joyda saqlanmaydi — ADR).
 *
 * `retryable` — UI "Qayta urinish" tugmasini ko'rsatadimi. 5xx odatda
 * o'tkinchi (retryable), 4xx — yo'q.
 */

export interface ErrorCodeMeta {
  httpStatus: number;
  retryable: boolean;
}

/**
 * Barcha domen kodlari. Frontend `LEGACY_CODES` + 7 ta GAP kod
 * (`CIRCUMVENTION_DETECTED`, `INVALID_CARD`, ...) + infra (`NOT_READY`).
 */
export const ERROR_CODES = {
  // ── Autentifikatsiya / sessiya (401) ──────────────────────────────────
  NO_SESSION: { httpStatus: 401, retryable: false },
  INVALID_CREDENTIALS: { httpStatus: 401, retryable: false },
  INVALID_CURRENT_PASSWORD: { httpStatus: 401, retryable: false },
  UNAUTHENTICATED: { httpStatus: 401, retryable: false },
  TOKEN_EXPIRED: { httpStatus: 401, retryable: false },
  TOKEN_REUSED: { httpStatus: 401, retryable: false },
  MFA_REQUIRED: { httpStatus: 401, retryable: false },
  // ADR-03: "Callback imzosi yaroqsiz → 401, hech narsa yozilmaydi (fail closed)".
  PAYMENT_WEBHOOK_INVALID: { httpStatus: 401, retryable: false }, // Bosqich 5 — Refund webhook HAM shu (bir xil route/provider)
  PAYOUT_WEBHOOK_INVALID: { httpStatus: 401, retryable: false }, // Bosqich 7 — alohida route/provider

  // ── Ruxsat (403) ──────────────────────────────────────────────────────
  FORBIDDEN: { httpStatus: 403, retryable: false },
  NOT_ALLOWED: { httpStatus: 403, retryable: false },
  ACCOUNT_BLOCKED: { httpStatus: 403, retryable: false },
  ACCOUNT_SUSPENDED: { httpStatus: 403, retryable: false }, // Bosqich 3
  // Bosqich 12, bo'lim 34 — `mustChangePassword=true` staff faqat minimal
  // whitelist (`@AllowWhenPasswordChangeRequired()`) endpointlarni chaqira oladi.
  PASSWORD_CHANGE_REQUIRED: { httpStatus: 403, retryable: false },
  SELLER_NOT_APPROVED: { httpStatus: 403, retryable: false }, // Bosqich 3 — Bosqich 4'da ham qayta ishlatiladi (accept/submit)
  CONTRACT_SELF_PURCHASE_NOT_ALLOWED: { httpStatus: 403, retryable: false }, // Bosqich 4
  PAYMENT_NOT_ALLOWED: { httpStatus: 403, retryable: false }, // Bosqich 5
  CONTRACT_NOT_FUNDED: { httpStatus: 403, retryable: false }, // Bosqich 6 — bo'lim 18: seller ish topshirishdan oldin funded contract talab qilinadi
  REFUND_NOT_ALLOWED: { httpStatus: 403, retryable: false }, // Bosqich 7 — faqat pre-settlement (ACTIVE + SUCCEEDED payment)
  DISPUTE_NOT_ALLOWED: { httpStatus: 403, retryable: false }, // Bosqich 8 — Contract holati (ACTIVE/COMPLETED emas) nizo ochishga yaroqsiz
  TEST_SIMULATION_NOT_ALLOWED: { httpStatus: 403, retryable: false }, // To'lov simulyatsiyasi faqat TEST muhitida ruxsat etiladi

  // ── Topilmadi (404) ──────────────────────────────────────────────────
  NOT_FOUND: { httpStatus: 404, retryable: false },
  USER_NOT_FOUND: { httpStatus: 404, retryable: false },
  CARD_NOT_FOUND: { httpStatus: 404, retryable: false },
  DISPUTE_NOT_FOUND: { httpStatus: 404, retryable: false },
  SERVICE_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 3
  CATEGORY_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 3
  SELLER_APPLICATION_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 3
  CONTRACT_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 4
  MILESTONE_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 4
  // Mavjud (ACTIVE bo'lmagan) yoki umuman topilmagan — bir xil javob
  // (marketplace'dagi SERVICE_NOT_FOUND bilan bir xil "leak qilmaslik" qoidasi).
  SERVICE_NOT_AVAILABLE: { httpStatus: 404, retryable: false }, // Bosqich 4
  PAYMENT_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 5
  REFUND_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 7
  PAYOUT_NOT_FOUND: { httpStatus: 404, retryable: false }, // Bosqich 7
  TICKET_NOT_FOUND: { httpStatus: 404, retryable: false },
  REPORT_NOT_FOUND: { httpStatus: 404, retryable: false },
  APPEAL_NOT_FOUND: { httpStatus: 404, retryable: false },
  REVIEW_NOT_FOUND: { httpStatus: 404, retryable: false },

  // ── O'chirilgan (410) ────────────────────────────────────────────────
  DELETED: { httpStatus: 410, retryable: false },

  // ── Holat / konflikt (409) ──────────────────────────────────────────
  BAD_STATE: { httpStatus: 409, retryable: false },
  INVALID_TRANSITION: { httpStatus: 409, retryable: false },
  // Bosqich 11, bo'lim 19 — yagona FAOL SUPER_ADMIN'ni cheklash/o'chirish
  // orqali platformani boshqaruvchisiz qoldirish TAQIQLANADI.
  LAST_ADMIN_PROTECTED: { httpStatus: 409, retryable: false },
  DUPLICATE: { httpStatus: 409, retryable: false },
  DUPLICATE_OFFER: { httpStatus: 409, retryable: false },
  DUPLICATE_PROPOSAL: { httpStatus: 409, retryable: false },
  ALREADY_EXISTS: { httpStatus: 409, retryable: false },
  ALREADY_REVIEWED: { httpStatus: 409, retryable: false },
  ALREADY_PROCESSED: { httpStatus: 409, retryable: false },
  ALREADY_FUNDED: { httpStatus: 409, retryable: false }, // GAP kod
  ALREADY_CANCELLED: { httpStatus: 409, retryable: false }, // GAP kod
  NOT_PENDING: { httpStatus: 409, retryable: false }, // GAP kod
  REVISION_LIMIT_REACHED: { httpStatus: 409, retryable: false },
  PHONE_EXISTS: { httpStatus: 409, retryable: false },
  CARD_EXISTS: { httpStatus: 409, retryable: false },
  CARD_LIMIT: { httpStatus: 409, retryable: false },
  ACTIVE_CONTRACTS: { httpStatus: 409, retryable: false },
  HAS_SUBMITTED_WORK: { httpStatus: 409, retryable: false },
  SELF_LOCK: { httpStatus: 409, retryable: false },
  READ_ONLY: { httpStatus: 409, retryable: false },
  CIRCUMVENTION_DETECTED: { httpStatus: 409, retryable: false }, // GAP kod
  IDEMPOTENCY_CONFLICT: { httpStatus: 409, retryable: false },
  SELLER_APPLICATION_ALREADY_PENDING: { httpStatus: 409, retryable: false }, // Bosqich 3
  CATEGORY_SLUG_EXISTS: { httpStatus: 409, retryable: false }, // Bosqich 3
  PAYMENT_ALREADY_SUCCEEDED: { httpStatus: 409, retryable: false }, // Bosqich 5
  PAYMENT_ALREADY_IN_PROGRESS: { httpStatus: 409, retryable: false }, // Yangi konkurentlik talabi: parallel to'lovni bloklash
  PAYMENT_INVALID_STATE: { httpStatus: 409, retryable: false }, // Bosqich 5
  PAYMENT_WEBHOOK_CONFLICT: { httpStatus: 409, retryable: false }, // Bosqich 5 — qarama-qarshi/kech kelgan hodisa
  REFUND_ALREADY_SUCCEEDED: { httpStatus: 409, retryable: false }, // Bosqich 7
  REFUND_ALREADY_REQUESTED: { httpStatus: 409, retryable: false }, // Bosqich 7 — hali PENDING/PROCESSING boshqa refund bor
  REFUND_WEBHOOK_CONFLICT: { httpStatus: 409, retryable: false }, // Bosqich 7
  PAYOUT_WEBHOOK_CONFLICT: { httpStatus: 409, retryable: false }, // Bosqich 7
  // Bo'lim 18/62 simmetriyasi — Refund tomoni Contract'ni `FOR UPDATE`
  // qulflab ACTIVE'ni qayta tekshiradi (`LedgerService.refundPayment()`);
  // bu — settlement tomonidagi ANIQ TESKARI himoya: refund PENDING/
  // PROCESSING/SUCCEEDED bo'lsa, oxirgi milestone approve settlement'ni
  // BLOKLAYDI (aks holda provider allaqachon pulni qaytargan, lekin ledger
  // buni hech qachon posting qila olmaydigan holatga tushib qolardi).
  CONTRACT_REFUND_IN_PROGRESS: { httpStatus: 409, retryable: false }, // Bosqich 7
  // Bo'lim 7 — bitta Contract uchun bir vaqtda faqat BITTA OPEN/UNDER_REVIEW
  // Dispute (DB partial unique index — asosiy himoya; bu tezkor app-darajasidagi xato).
  DISPUTE_ALREADY_OPEN: { httpStatus: 409, retryable: false }, // Bosqich 8
  DISPUTE_ALREADY_RESOLVED: { httpStatus: 409, retryable: false },
  // Bo'lim 8/39 — ochiq nizo bo'lgan Contract uchun settlement HAM, yalang'och
  // Refund HAM bloklanadi (`CONTRACT_REFUND_IN_PROGRESS` bilan bir xil simmetriya).
  DISPUTE_IN_PROGRESS: { httpStatus: 409, retryable: false }, // Bosqich 8
  CONTRACT_NOT_COMPLETED: { httpStatus: 409, retryable: false },

  // ── Validatsiya (422) ──────────────────────────────────────────────
  VALIDATION: { httpStatus: 422, retryable: false },
  INVALID_INPUT: { httpStatus: 422, retryable: false },
  INVALID_AMOUNT: { httpStatus: 422, retryable: false },
  INVALID_NAME: { httpStatus: 422, retryable: false },
  INVALID_HOLDER: { httpStatus: 422, retryable: false },
  INVALID_DATE: { httpStatus: 422, retryable: false },
  INVALID_CODE: { httpStatus: 422, retryable: false },
  // Bosqich 22 — `INVALID_CODE`dan ATAYLAB ajratilgan: OTP qatori topildi,
  // lekin muddati o'tgan/urinishlar tugagan — foydalanuvchiga "noto'g'ri
  // kod kiritdingiz" emas, "yangi kod so'rang" ko'rsatilishi kerak.
  // `INVALID_CODE` o'zi "kod topilmadi (hech qachon so'ralmagan/allaqachon
  // ishlatilgan) yoki xato kiritildi" uchun qoladi — enumeration-safe
  // (staff TOTP HAM shu kodni ishlatadi, BU YERDA o'zgartirilmagan).
  OTP_EXPIRED: { httpStatus: 422, retryable: false },
  OTP_ATTEMPTS_EXCEEDED: { httpStatus: 422, retryable: false },
  INVALID_CARD: { httpStatus: 422, retryable: false }, // GAP kod
  INVALID_EXPIRY: { httpStatus: 422, retryable: false }, // GAP kod
  INVALID_BANK_ACCOUNT: { httpStatus: 422, retryable: false }, // GAP kod
  WEAK_PASSWORD: { httpStatus: 422, retryable: false },
  EMPTY_MESSAGE: { httpStatus: 422, retryable: false },
  COMMENT_REQUIRED: { httpStatus: 422, retryable: false },
  REASON_REQUIRED: { httpStatus: 422, retryable: false },
  REPLY_REQUIRED: { httpStatus: 422, retryable: false },
  TOO_MANY_MILESTONES: { httpStatus: 422, retryable: false }, // Bosqich 1'dan oldindan mavjud — Bosqich 4'da BIRINCHI marta ishlatiladi
  MILESTONE_AMOUNT_MISMATCH: { httpStatus: 422, retryable: false }, // Bosqich 4
  DEADLINE_INVALID: { httpStatus: 422, retryable: false }, // Bosqich 4
  PAYMENT_AMOUNT_MISMATCH: { httpStatus: 422, retryable: false }, // Bosqich 5 — YAGONA (mustaqil) 500 xato emas
  PAYMENT_CURRENCY_MISMATCH: { httpStatus: 422, retryable: false }, // Bosqich 5
  // Provider DETERMINISTIK rad etdi (masalan yaroqsiz so'rov) — xavfsiz
  // qayta ishlatiladigan (deterministic) xato, ambiguous (`_UNAVAILABLE`, 503) EMAS.
  PAYMENT_PROVIDER_ERROR: { httpStatus: 422, retryable: false }, // Bosqich 5 — Refund provider xatosi HAM shu (bir xil PaymentProvider)
  PAYOUT_PROVIDER_ERROR: { httpStatus: 422, retryable: false }, // Bosqich 7 — alohida PayoutProvider
  IDEMPOTENCY_KEY_REQUIRED: { httpStatus: 422, retryable: false }, // Bosqich 5 — mavjud VALIDATION oilasi bilan bir xil status
  INSUFFICIENT_BALANCE: { httpStatus: 422, retryable: false },
  NO_BALANCE: { httpStatus: 422, retryable: false },
  BELOW_MINIMUM: { httpStatus: 422, retryable: false },
  BELOW_MIN_PAYOUT: { httpStatus: 422, retryable: false },
  FILE_TOO_LARGE: { httpStatus: 422, retryable: false },
  FILE_TOO_SMALL: { httpStatus: 422, retryable: false },
  FILE_TYPE_NOT_ALLOWED: { httpStatus: 422, retryable: false },
  INVALID_FILE_TYPE: { httpStatus: 422, retryable: false },
  MIME_TYPE_MISMATCH: { httpStatus: 422, retryable: false },
  FILE_READ_FAILED: { httpStatus: 422, retryable: false },
  INVALID_LEGAL_NAME: { httpStatus: 422, retryable: false },
  INVALID_BIRTH_DATE: { httpStatus: 422, retryable: false },
  UNDERAGE: { httpStatus: 422, retryable: false },
  DOCUMENTS_REQUIRED: { httpStatus: 422, retryable: false },
  INFECTED_DOCUMENT: { httpStatus: 422, retryable: false },
  ALREADY_APPROVED: { httpStatus: 409, retryable: false },
  ALREADY_UNDER_REVIEW: { httpStatus: 409, retryable: false },
  JOB_CLOSED: { httpStatus: 409, retryable: false },
  INVALID_PROPOSAL_STATUS: { httpStatus: 409, retryable: false },
  SELF_PURCHASE: { httpStatus: 403, retryable: false },
  KYC_NOT_FOUND: { httpStatus: 404, retryable: false },
  INVALID_TOKEN: { httpStatus: 401, retryable: false },

  // ── Rate limit (429) ──────────────────────────────────────────────
  RATE_LIMITED: { httpStatus: 429, retryable: true },

  // ── Kill-switch / imkoniyat o'chirilgan (503) ───────────────────
  PAYMENTS_PAUSED: { httpStatus: 503, retryable: true },
  // Ambiguous provider javobi (timeout/network) — "provider yaratgan bo'lishi
  // MUMKIN, biz bilmaymiz" (bo'lim 11). Retryable=true, LEKIN chaqiruvchi
  // (idempotency snapshot) shu javobni takrorlaydi — HECH QACHON ko'r-ko'rona
  // yangi provider chaqiruvi qilinmaydi (bo'lim 12/59).
  PAYMENT_PROVIDER_UNAVAILABLE: { httpStatus: 503, retryable: true }, // Bosqich 5 — Refund ambiguous xato HAM shu
  PAYOUT_PROVIDER_UNAVAILABLE: { httpStatus: 503, retryable: true }, // Bosqich 7
  FEATURE_DISABLED: { httpStatus: 503, retryable: false },
  OFFERS_DISABLED: { httpStatus: 503, retryable: false },
  REGISTRATION_PAUSED: { httpStatus: 503, retryable: false },
  CATEGORY_DISABLED: { httpStatus: 503, retryable: false },
  NOT_READY: { httpStatus: 503, retryable: true }, // /health/ready

  // ── Saqlash joyi (507) ──────────────────────────────────────────
  STORAGE_FULL: { httpStatus: 507, retryable: false },

  // ── Server / ichki invariant (500) ─────────────────────────────
  UNKNOWN: { httpStatus: 500, retryable: true },
  INVARIANT_VIOLATION: { httpStatus: 500, retryable: false },
  // Bosqich 9, bo'lim 32/35 — provider auth/config xatosi (masalan
  // noto'g'ri merchant credentials): ambiguous timeout'dan FARQLI —
  // qayta-qayta query qilish YORDAM BERMAYDI (config to'g'irlanmaguncha).
  // `ReconciliationService` shu kodni ko'rsa JORIY BATCH'ni ATAYLAB
  // to'xtatadi (bo'lim 35 — "1000 operationni qayta-qayta query qilma").
  PROVIDER_CONFIG_ERROR: { httpStatus: 500, retryable: false }, // Bosqich 9
} as const satisfies Record<string, ErrorCodeMeta>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function errorCodeMeta(code: string): ErrorCodeMeta {
  return (ERROR_CODES as Record<string, ErrorCodeMeta>)[code] ?? ERROR_CODES.UNKNOWN;
}
