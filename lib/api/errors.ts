export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DELETED"
  | "EXPIRED"
  | "CONFLICT"
  | "VALIDATION"
  | "INVALID_TRANSITION"
  | "PAYMENTS_PAUSED"
  | "FEATURE_DISABLED"
  | "BELOW_MINIMUM"
  | "RATE_LIMITED"
  | "NETWORK"
  | "STORAGE_FULL"
  | "UNKNOWN";

export interface ApiErrorShape {
  code: ApiErrorCode;
  message: string;
  status: number;
  fieldErrors?: Record<string, string>;
  retryable: boolean;
  cause?: unknown;
}

/* Ma'lumot qatlami tashlaydigan HAR BIR kod shu jadvalda bo'lishi SHART.
   Jadvalda yo'q kod `UNKNOWN` + `status: 500` + `retryable: true` ga tushadi,
   ya'ni ekranda "Qayta urinish" tugmasi chiqadi — noto'g'ri parol yoki band
   telefon raqami uchun bu tugma hech qachon yordam bermaydi. Bu jadval
   backend uchun ham shartnoma: server shu kodlarni shu status bilan
   qaytarishi kerak. Yangi `throw new Error("...")` qo'shsangiz, kodni shu
   yerga ham yozing (`npm run lint` buni ushlay olmaydi). */
const LEGACY_CODES: Record<string, Pick<ApiErrorShape, "code" | "status" | "retryable">> = {
  /* --- Autentifikatsiya / sessiya (401) --- */
  NO_SESSION: { code: "UNAUTHENTICATED", status: 401, retryable: false },
  INVALID_CREDENTIALS: { code: "UNAUTHENTICATED", status: 401, retryable: false },
  INVALID_CURRENT_PASSWORD: { code: "UNAUTHENTICATED", status: 401, retryable: false },
  /* Bosqich 17 — backend `ERROR_CODES` (`backend/src/common/errors/error-codes.ts`)
     bilan bitta shartnoma: quyidagi kodlar mock qatlamida hech qachon
     tashlanmagan, faqat real backend javobida keladi. */
  UNAUTHENTICATED: { code: "UNAUTHENTICATED", status: 401, retryable: false },
  TOKEN_EXPIRED: { code: "UNAUTHENTICATED", status: 401, retryable: false },
  TOKEN_REUSED: { code: "UNAUTHENTICATED", status: 401, retryable: false },
  MFA_REQUIRED: { code: "UNAUTHENTICATED", status: 401, retryable: false },

  /* --- Ruxsat (403) --- */
  FORBIDDEN: { code: "FORBIDDEN", status: 403, retryable: false },
  NOT_ALLOWED: { code: "FORBIDDEN", status: 403, retryable: false },
  /* Admin bloklagan hisob — parolni qayta kiritish yordam bermaydi */
  ACCOUNT_BLOCKED: { code: "FORBIDDEN", status: 403, retryable: false },
  ACCOUNT_SUSPENDED: { code: "FORBIDDEN", status: 403, retryable: false },
  /* Staff `mustChangePassword=true` — faqat oq ro'yxatdagi endpoint'lar ochiq */
  PASSWORD_CHANGE_REQUIRED: { code: "FORBIDDEN", status: 403, retryable: false },
  SELLER_NOT_APPROVED: { code: "FORBIDDEN", status: 403, retryable: false },
  CONTRACT_SELF_PURCHASE_NOT_ALLOWED: { code: "FORBIDDEN", status: 403, retryable: false },
  PAYMENT_NOT_ALLOWED: { code: "FORBIDDEN", status: 403, retryable: false },
  CONTRACT_NOT_FUNDED: { code: "FORBIDDEN", status: 403, retryable: false },
  REFUND_NOT_ALLOWED: { code: "FORBIDDEN", status: 403, retryable: false },
  DISPUTE_NOT_ALLOWED: { code: "FORBIDDEN", status: 403, retryable: false },
  TEST_SIMULATION_NOT_ALLOWED: { code: "FORBIDDEN", status: 403, retryable: false },

  /* --- Topilmadi (404) --- */
  NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  USER_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  CARD_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  DISPUTE_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  SERVICE_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  CATEGORY_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  SELLER_APPLICATION_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  CONTRACT_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  MILESTONE_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  SERVICE_NOT_AVAILABLE: { code: "NOT_FOUND", status: 404, retryable: false },
  PAYMENT_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  REFUND_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  PAYOUT_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  PAYOUT_DESTINATION_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },
  BANK_PROOF_NOT_FOUND: { code: "NOT_FOUND", status: 404, retryable: false },

  /* --- Holat/konflikt (409) --- */
  BAD_STATE: { code: "INVALID_TRANSITION", status: 409, retryable: false },
  DUPLICATE: { code: "CONFLICT", status: 409, retryable: false },
  DUPLICATE_OFFER: { code: "CONFLICT", status: 409, retryable: false },
  DUPLICATE_PROPOSAL: { code: "CONFLICT", status: 409, retryable: false },
  ALREADY_EXISTS: { code: "CONFLICT", status: 409, retryable: false },
  ALREADY_REVIEWED: { code: "CONFLICT", status: 409, retryable: false },
  ALREADY_PROCESSED: { code: "CONFLICT", status: 409, retryable: false },
  REVISION_LIMIT_REACHED: { code: "CONFLICT", status: 409, retryable: false },
  PHONE_EXISTS: { code: "CONFLICT", status: 409, retryable: false },
  CARD_EXISTS: { code: "CONFLICT", status: 409, retryable: false },
  CARD_LIMIT: { code: "CONFLICT", status: 409, retryable: false },
  /* Faol shartnoma bor — hisobni o'chirib/bekor qilib bo'lmaydi */
  ACTIVE_CONTRACTS: { code: "CONFLICT", status: 409, retryable: false },
  HAS_SUBMITTED_WORK: { code: "CONFLICT", status: 409, retryable: false },
  SELF_LOCK: { code: "CONFLICT", status: 409, retryable: false },
  READ_ONLY: { code: "CONFLICT", status: 409, retryable: false },
  LAST_ADMIN_PROTECTED: { code: "CONFLICT", status: 409, retryable: false },
  ALREADY_FUNDED: { code: "CONFLICT", status: 409, retryable: false },
  ALREADY_CANCELLED: { code: "CONFLICT", status: 409, retryable: false },
  PAYOUT_DESTINATION_NOT_VERIFIED: { code: "CONFLICT", status: 409, retryable: false },
  PAYOUT_DESTINATION_REQUIRED: { code: "VALIDATION", status: 422, retryable: false },
  NOT_PENDING: { code: "CONFLICT", status: 409, retryable: false },
  CIRCUMVENTION_DETECTED: { code: "CONFLICT", status: 409, retryable: false },
  IDEMPOTENCY_CONFLICT: { code: "CONFLICT", status: 409, retryable: false },
  SELLER_APPLICATION_ALREADY_PENDING: { code: "CONFLICT", status: 409, retryable: false },
  CATEGORY_SLUG_EXISTS: { code: "CONFLICT", status: 409, retryable: false },
  PAYMENT_ALREADY_SUCCEEDED: { code: "CONFLICT", status: 409, retryable: false },
  PAYMENT_ALREADY_IN_PROGRESS: { code: "CONFLICT", status: 409, retryable: false },
  PAYMENT_INVALID_STATE: { code: "CONFLICT", status: 409, retryable: false },
  PAYMENT_WEBHOOK_CONFLICT: { code: "CONFLICT", status: 409, retryable: false },
  REFUND_ALREADY_SUCCEEDED: { code: "CONFLICT", status: 409, retryable: false },
  REFUND_ALREADY_REQUESTED: { code: "CONFLICT", status: 409, retryable: false },
  REFUND_WEBHOOK_CONFLICT: { code: "CONFLICT", status: 409, retryable: false },
  PAYOUT_WEBHOOK_CONFLICT: { code: "CONFLICT", status: 409, retryable: false },
  CONTRACT_REFUND_IN_PROGRESS: { code: "CONFLICT", status: 409, retryable: false },
  DISPUTE_ALREADY_OPEN: { code: "CONFLICT", status: 409, retryable: false },
  DISPUTE_IN_PROGRESS: { code: "CONFLICT", status: 409, retryable: false },
  CONTRACT_IN_PROGRESS_FOR_JOB: { code: "CONFLICT", status: 409, retryable: false },
  DUPLICATE_BANK_REF: { code: "CONFLICT", status: 409, retryable: false },
  PAYOUT_ALREADY_CLAIMED: { code: "CONFLICT", status: 409, retryable: false },

  /* --- Validatsiya (422) --- */
  VALIDATION: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_INPUT: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_AMOUNT: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_NAME: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_HOLDER: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_DATE: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_CODE: { code: "VALIDATION", status: 422, retryable: false },
  /* Bosqich 22 — INVALID_CODE'dan ajratilgan aniq OTP holatlari: sahifalar
     `err.message` (xom backend kodi) bo'yicha alohida matn ko'rsatadi
     (`auth.codeExpired`/`auth.codeAttemptsExceeded`) — bu yerda faqat
     umumiy VALIDATION guruhiga ro'yxatga olinadi. */
  OTP_EXPIRED: { code: "VALIDATION", status: 422, retryable: false },
  OTP_ATTEMPTS_EXCEEDED: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_CARD: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_EXPIRY: { code: "VALIDATION", status: 422, retryable: false },
  INVALID_BANK_ACCOUNT: { code: "VALIDATION", status: 422, retryable: false },
  WEAK_PASSWORD: { code: "VALIDATION", status: 422, retryable: false },
  EMPTY_MESSAGE: { code: "VALIDATION", status: 422, retryable: false },
  EMPTY_DELIVERABLE: { code: "VALIDATION", status: 422, retryable: false },
  PAYOUT_AMOUNT_MISMATCH: { code: "VALIDATION", status: 422, retryable: false },
  OVERPAYMENT_DETECTED: { code: "VALIDATION", status: 422, retryable: false },
  COMMENT_REQUIRED: { code: "VALIDATION", status: 422, retryable: false },
  REASON_REQUIRED: { code: "VALIDATION", status: 422, retryable: false },
  REPLY_REQUIRED: { code: "VALIDATION", status: 422, retryable: false },
  TOO_MANY_MILESTONES: { code: "VALIDATION", status: 422, retryable: false },
  MILESTONE_AMOUNT_MISMATCH: { code: "VALIDATION", status: 422, retryable: false },
  DEADLINE_INVALID: { code: "VALIDATION", status: 422, retryable: false },
  PAYMENT_AMOUNT_MISMATCH: { code: "VALIDATION", status: 422, retryable: false },
  PAYMENT_CURRENCY_MISMATCH: { code: "VALIDATION", status: 422, retryable: false },
  PAYMENT_PROVIDER_ERROR: { code: "VALIDATION", status: 422, retryable: false },
  PAYOUT_PROVIDER_ERROR: { code: "VALIDATION", status: 422, retryable: false },
  IDEMPOTENCY_KEY_REQUIRED: { code: "VALIDATION", status: 422, retryable: false },
  INSUFFICIENT_BALANCE: { code: "VALIDATION", status: 422, retryable: false },
  NO_BALANCE: { code: "VALIDATION", status: 422, retryable: false },
  BELOW_MINIMUM: { code: "BELOW_MINIMUM", status: 422, retryable: false },
  /* Yechish summasi admin belgilagan eng kichik chegaradan past */
  BELOW_MIN_PAYOUT: { code: "BELOW_MINIMUM", status: 422, retryable: false },

  /* Biriktirma fayl chegaralari — foydalanuvchi faylni almashtirishi kerak,
     qayta urinish yordam bermaydi. */
  FILE_TOO_LARGE: { code: "VALIDATION", status: 422, retryable: false },
  FILE_TYPE_NOT_ALLOWED: { code: "VALIDATION", status: 422, retryable: false },
  FILE_READ_FAILED: { code: "VALIDATION", status: 422, retryable: false },

  /* --- Kill-switch / imkoniyat o'chirilgan (503) --- */
  PAYMENTS_PAUSED: { code: "PAYMENTS_PAUSED", status: 503, retryable: true },
  /* Admin kill-switch bilan o'chirilgan imkoniyat (masalan to'g'ridan-to'g'ri
     takliflar) — qayta urinish yordam bermaydi, sozlama o'zgarishi kerak. */
  OFFERS_DISABLED: { code: "FEATURE_DISABLED", status: 503, retryable: false },
  REGISTRATION_PAUSED: { code: "FEATURE_DISABLED", status: 503, retryable: false },
  CATEGORY_DISABLED: { code: "FEATURE_DISABLED", status: 503, retryable: false },
  /* Bosqich 17 — real backendda hali qamrab olinmagan bo'lim (Job/Offer/
     Messages/Reviews/KYC/kartalar/...): frontend `client.ts` shu kodni
     ATAYLAB tashlaydi (backend hech qachon qaytarmaydi). */
  FEATURE_DISABLED: { code: "FEATURE_DISABLED", status: 503, retryable: false },
  /* Provider (Payme/PlayMobile) ambiguous javob berdi (timeout/network) —
     qayta urinish MUMKIN, lekin ko'r-ko'rona emas (backend idempotency
     snapshot bilan himoyalangan). */
  PAYMENT_PROVIDER_UNAVAILABLE: { code: "PAYMENTS_PAUSED", status: 503, retryable: true },
  PAYOUT_PROVIDER_UNAVAILABLE: { code: "PAYMENTS_PAUSED", status: 503, retryable: true },

  /* --- Saqlash joyi (507) --- */
  STORAGE_FULL: { code: "STORAGE_FULL", status: 507, retryable: false },

  /* --- Server / ichki invariant (500) --- */
  INVARIANT_VIOLATION: { code: "UNKNOWN", status: 500, retryable: false },
  PROVIDER_CONFIG_ERROR: { code: "UNKNOWN", status: 500, retryable: false },
};

export class ApiError extends Error implements ApiErrorShape {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(input: Omit<ApiErrorShape, "message"> & { message?: string }) {
    super(input.message ?? input.code);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    this.fieldErrors = input.fieldErrors;
    this.retryable = input.retryable;
    this.cause = input.cause;
  }
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : "UNKNOWN";
  const mapped = LEGACY_CODES[message];
  if (mapped) return new ApiError({ ...mapped, message, cause: error });
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return new ApiError({
      code: "NETWORK",
      message: "OFFLINE",
      status: 0,
      retryable: true,
      cause: error,
    });
  }
  /* Noma'lum xato = server tomoni (5xx) deb qaraladi: bu odatda o'tkinchi,
     shuning uchun UI qayta urinish tugmasini ko'rsatadi. Qaytarib bo'lmaydigan
     holatlar (401/403/404/409/422) yuqoridagi LEGACY_CODES da aniq berilgan. */
  return new ApiError({
    code: "UNKNOWN",
    message,
    status: 500,
    retryable: true,
    cause: error,
  });
}

export async function withNormalizedErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ==========================================================================
   SERVER JAVOBI → ApiError   (backend ulanganda ishlatiladi)
   ========================================================================== */

/** Server qaytaradigan xato tanasi. Backend shu shaklda javob berishi kerak. */
export interface ApiErrorBody {
  /** `LEGACY_CODES` dagi kod, masalan "BELOW_MIN_PAYOUT". Ixtiyoriy —
      bo'lmasa HTTP status bo'yicha aniqlanadi. */
  code?: string;
  /** Foydalanuvchiga ko'rsatish uchun EMAS — log/debug uchun */
  message?: string;
  /** Maydon-darajali validatsiya: `{ phone: "Raqam band" }` →
      to'g'ridan-to'g'ri `<Input error={...}>` ga beriladi */
  fieldErrors?: Record<string, string>;
}

/** HTTP status → taksonomiya. Server kod yubormasa shu ishlaydi. */
const STATUS_CODES: Record<number, Pick<ApiErrorShape, "code" | "retryable">> = {
  400: { code: "VALIDATION", retryable: false },
  401: { code: "UNAUTHENTICATED", retryable: false },
  403: { code: "FORBIDDEN", retryable: false },
  404: { code: "NOT_FOUND", retryable: false },
  409: { code: "CONFLICT", retryable: false },
  410: { code: "DELETED", retryable: false },
  422: { code: "VALIDATION", retryable: false },
  429: { code: "RATE_LIMITED", retryable: true },
  503: { code: "PAYMENTS_PAUSED", retryable: true },
  507: { code: "STORAGE_FULL", retryable: false },
};

/**
 * `fetch` javobini `ApiError` ga aylantiradi — HTTP klientning YAGONA
 * xato nuqtasi.
 *
 * Tartib MUHIM: avval server bergan KOD (aniqroq — masalan 422 ichida
 * `BELOW_MIN_PAYOUT` va `WEAK_PASSWORD` bir xil status, lekin UI ularni
 * boshqacha ko'rsatadi), keyin HTTP status, oxirida umumiy 5xx.
 *
 * Ishlatilishi (`client.ts` da):
 * ```ts
 * const res = await fetch(url, init);
 * if (!res.ok) throw await toApiError(res);
 * ```
 */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    /* Tana JSON emas (nginx 502 HTML sahifasi va h.k.) — status bo'yicha
       davom etamiz. Bu holatni yutish SHART, aks holda xatoni qayta
       ishlashning o'zi xato tashlaydi. */
  }

  /* 1. Server aniq kod bergan bo'lsa — u ustun */
  if (body.code && LEGACY_CODES[body.code]) {
    const mapped = LEGACY_CODES[body.code];
    return new ApiError({
      ...mapped,
      /* Status server aytganicha — jadvaldagi qiymat faqat zaxira */
      status: response.status || mapped.status,
      message: body.code,
      fieldErrors: body.fieldErrors,
    });
  }

  /* 2. Status bo'yicha */
  const byStatus = STATUS_CODES[response.status];
  if (byStatus) {
    return new ApiError({
      ...byStatus,
      status: response.status,
      message: body.code ?? body.message ?? String(response.status),
      fieldErrors: body.fieldErrors,
    });
  }

  /* 3. Qolgani — server nosozligi, qayta urinish mantiqiy */
  return new ApiError({
    code: "UNKNOWN",
    status: response.status || 500,
    retryable: response.status >= 500 || response.status === 0,
    message: body.code ?? body.message ?? "UNKNOWN",
    fieldErrors: body.fieldErrors,
  });
}

/** Tarmoq uzilishi (`fetch` ning o'zi reject qilgani) — server javobi yo'q. */
export function toNetworkError(cause: unknown): ApiError {
  return new ApiError({
    code: "NETWORK",
    message: "OFFLINE",
    status: 0,
    retryable: true,
    cause,
  });
}
