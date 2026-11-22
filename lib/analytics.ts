/**
 * Google Tag Manager & Google Analytics (GA4) hodisalar boshqaruvi.
 * Yagona dataLayer orqali barcha biznes hodisalarini kuzatish.
 */

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

/** dataLayer'ga xavfsiz event push qilish */
export function pushDataLayerEvent(event: string, params: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event,
    timestamp: new Date().toISOString(),
    ...params,
  });
}

/** 1. Ro'yxatdan o'tish (Sign Up) */
export function trackSignUp(method: "phone" | "google", userRole?: string) {
  pushDataLayerEvent("sign_up", {
    method,
    user_role: userRole || "unassigned",
  });
}

/** 2. E'lon berish (Buyurtmachi yangi ish joylashtirganda) */
export function trackJobCreated(params: {
  category: string;
  budgetMin: number;
  budgetMax: number;
  title: string;
}) {
  pushDataLayerEvent("post_job", {
    job_category: params.category,
    budget_min: params.budgetMin,
    budget_max: params.budgetMax,
    job_title: params.title,
  });
}

/** 3. Ish qidirish / ko'rish (Mutaxassislar qiziqishi) */
export function trackJobSearch(params: {
  query?: string;
  category?: string;
  resultsCount?: number;
}) {
  pushDataLayerEvent("search_jobs", {
    search_term: params.query || "",
    category: params.category || "all",
    results_count: params.resultsCount ?? 0,
  });
}

/** 4. Taklif yuborish (Frilanser ishga ariza topshirganda) */
export function trackProposalSubmit(params: {
  jobId: string;
  amount: number;
}) {
  pushDataLayerEvent("submit_proposal", {
    job_id: params.jobId,
    bid_amount: params.amount,
  });
}

/** 5. To'lovni yakunlash (Escrow bitimi to'langanda) */
export function trackPaymentComplete(params: {
  contractId: string;
  amount: number;
  provider: string;
}) {
  pushDataLayerEvent("complete_payment", {
    contract_id: params.contractId,
    value: params.amount,
    currency: "UZS",
    payment_provider: params.provider,
  });
}
