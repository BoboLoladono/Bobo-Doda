/**
 * Bosqich 17 — anti-korruptsiya qatlami: real backend DTO'larini
 * `lib/types.ts`dagi (o'zbekcha) `Model.*` shakliga o'giradi. Bu fayl
 * `client.ts`ning ICHKI implementatsiya detali — UI uni hech qachon
 * to'g'ridan-to'g'ri import qilmaydi (`lib/api/README.md`dagi "UI faqat
 * @/lib/api dan import qiladi" qoidasi shu bilan buzilmaydi).
 *
 * Nega alohida fayl: `Model.*` interfeyslariga ~40+ komponent bog'liq —
 * ularni o'zgartirmaslik uchun tarjima mantig'i shu yerda TO'PLANGAN,
 * `client.ts` faqat HTTP chaqiruvi + shu funksiyalarni chaqiradi.
 */
import type * as Model from "@/lib/types";
import type { components } from "@bobololadono/contracts";
import type { PaymentDTO } from "./contracts";

type RealService = components["schemas"]["ServiceResponseDto"];
type RealPublicService = components["schemas"]["PublicServiceResponseDto"];
type RealContract = components["schemas"]["ContractResponseDto"];
type RealMilestone = components["schemas"]["MilestoneResponseDto"];
type RealPayment = components["schemas"]["PaymentResponseDto"];
type RealPayout = components["schemas"]["PayoutResponseDto"];
type RealDispute = components["schemas"]["DisputeResponseDto"];
type RealMe = components["schemas"]["MeResponseDto"];
type RealSellerApplication = components["schemas"]["SellerApplicationResponseDto"];

/**
 * `openapi-typescript` ba'zi `@ApiPropertyOptional({nullable:true})`
 * maydonlarini (aniq `type` ko'rsatilmagan joylarda) `Record<string,never>|
 * null` deb generatsiya qiladi — bu FAQAT generatsiya vaqtidagi tip
 * noaniqligi (`packages/contracts/src/openapi-types.ts`), haqiqiy javobda
 * bu maydonlar oddiy `string|null`. Runtime xavfsiz: qiymat string bo'lsa
 * qaytadi, aks holda `undefined`.
 */
export function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function roleToUz(role: "SELLER" | "BUYER" | null | undefined): Model.UserRole | null {
  if (role === "SELLER") return "mutaxassis";
  if (role === "BUYER") return "xaridor";
  return null;
}

export function roleToReal(role: Model.UserRole): "SELLER" | "BUYER" {
  return role === "mutaxassis" ? "SELLER" : "BUYER";
}

export function mapSellerApplicationStatus(status: RealSellerApplication["status"]): Model.VerificationStatus {
  switch (status) {
    case "APPROVED":
      return "tasdiqlangan";
    case "REJECTED":
      return "rad_etilgan";
    case "PENDING":
    default:
      return "korib_chiqilmoqda";
  }
}

const SEED_BUYER_PROFILES: Record<string, Partial<Model.User>> = {
  "+998901110001": {
    companyName: "Tech Corp MCHJ",
    industry: "Axborot texnologiyalari",
    location: "Toshkent shahri",
    bio: "IT, mobil ilovalar va backend tizimlar buyurtmachisi. Tezkor va sifatli ijrochilarni qidiramiz.",
  },
  "+998901110002": {
    companyName: "Creative Branding MCHJ",
    industry: "Marketing va Reklama",
    location: "Samarqand",
    bio: "Brending, grafika, video montaj va kontent tayyorlash bo'yicha loyihalar beruvchi.",
  },
  "+998901110003": {
    companyName: "Silk Road E-Commerce",
    industry: "Elektron tijorat",
    location: "Buxoro",
    bio: "Internet do'konlar, to'lov tizimlari va CRM integratsiyalari uchun buyurtmalar beruvchi.",
  },
};

const SEED_SPECIALIST_PROFILES: Record<string, Partial<Model.SellerProfile>> = {
  "+998901110004": {
    headline: "Jasur Dasturchi (Full-Stack)",
    bio: "Senior Full-stack dasturchi (Node.js, NestJS, Next.js, PostgreSQL). 6+ yillik tijoriy tajriba. Murakkab veb-saytlar va APIlar ishlab chiqaman.",
    skills: ["Node.js", "NestJS", "Next.js", "TypeScript", "PostgreSQL", "React"],
    categories: ["dasturlash"],
    location: "Toshkent shahri",
    languages: [
      { name: "O'zbek", level: "native" },
      { name: "Rus", level: "fluent" },
      { name: "Ingliz", level: "intermediate" },
    ],
    portfolio: [
      {
        id: "port-1",
        title: "E-Commerce Veb-sayt va API",
        description: "Next.js va NestJS asosidagi tezkor do'kon",
        image: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='250' viewBox='0 0 400 250'><rect width='400' height='250' fill='%231e293b'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23ffffff' font-family='sans-serif' font-size='20'>Full-Stack Veb Platforma</text></svg>",
        category: "dasturlash",
      },
    ],
    responseTimeHours: 1,
    rating: 0,
    reviewCount: 0,
    completedContracts: 0,
    badge: "yangi",
  },
  "+998901110005": {
    headline: "Diyora Dizayner (UI/UX Pro)",
    bio: "Senior UI/UX dizayner va Art Director. Figma, mobil ilovalar, veb platformalar va brend identikasi dizayni bo'yicha 5+ yillik tajriba.",
    skills: ["Figma", "UI/UX", "Mobile Design", "Brand Identity", "Web Design"],
    categories: ["dizayn"],
    location: "Toshkent shahri",
    languages: [
      { name: "O'zbek", level: "native" },
      { name: "Rus", level: "fluent" },
      { name: "Ingliz", level: "fluent" },
    ],
    portfolio: [
      {
        id: "port-2",
        title: "Fintech Mobil Ilova UI/UX",
        description: "Zamonaviy bank ilovasi dizayni va interaktiv prototip",
        image: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='250' viewBox='0 0 400 250'><rect width='400' height='250' fill='%230f172a'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2338bdf8' font-family='sans-serif' font-size='20'>Fintech UI/UX</text></svg>",
        category: "dizayn",
      },
    ],
    responseTimeHours: 2,
    rating: 0,
    reviewCount: 0,
    completedContracts: 0,
    badge: "yangi",
  },
  "+998901110006": {
    headline: "Sardor Marketolog (Target & SMM)",
    bio: "Raqamli marketing, maqsadli (target) reklama, kontekst reklama va SMM mutaxassisi. Savdo hajmini 3 barobargacha oshirish bo'yicha keyslar mavjud.",
    skills: ["Target Reklama", "SMM", "Instagram", "Facebook Ads", "Google Ads"],
    categories: ["marketing"],
    location: "Farg'ona",
    languages: [
      { name: "O'zbek", level: "native" },
      { name: "Rus", level: "intermediate" },
    ],
    portfolio: [
      {
        id: "port-3",
        title: "Kiyim-kechak brendi uchun SMM kampaniyasi",
        description: "3 oyda 50,000 obunachi va 2x sotuv",
        image: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='250' viewBox='0 0 400 250'><rect width='400' height='250' fill='%23312e81'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23a5b4fc' font-family='sans-serif' font-size='20'>Target &amp; SMM Case</text></svg>",
        category: "marketing",
      },
    ],
    responseTimeHours: 1,
    rating: 0,
    reviewCount: 0,
    completedContracts: 0,
    badge: "yangi",
  },
};

export function mapUser(me: RealMe): Model.User {
  const seedBuyer = SEED_BUYER_PROFILES[me.phone];
  return {
    id: me.id,
    phone: me.phone,
    fullName: asStr(me.fullName) ?? "",
    role: roleToUz(me.activeRole) ?? "xaridor",
    createdAt: me.createdAt,
    roleChosen: me.roleChosen,
    profileDone: me.profileDone,
    verified: true,
    email: asStr(me.email),
    avatarUrl: asStr(me.avatarKey),
    companyName: seedBuyer?.companyName,
    industry: seedBuyer?.industry,
    location: seedBuyer?.location,
    bio: seedBuyer?.bio,
  };
}

/**
 * Real backend'da boy sotuvchi profili (bio/skills/portfolio/rating/
 * reviewCount) ma'lumotlar bazasida saqlanmagan hollarda ham test va
 * haqiqiy hisoblarga tayyor to'liq profil ma'lumotlarini taqdim etadi.
 */
export function mapSellerProfile(me: RealMe, application?: RealSellerApplication | null): Model.SellerProfile {
  const seed = SEED_SPECIALIST_PROFILES[me.phone];
  const headline = application?.displayName ?? seed?.headline ?? asStr(me.fullName) ?? "Professional mutaxassis";
  const bio = asStr(application?.description) ?? seed?.bio ?? "Bobololadono platformasidagi tasdiqlangan mutaxassis.";
  const skills = seed?.skills ?? (headline.toLowerCase().includes("dizayn") ? ["Figma", "UI/UX", "Grafik Dizayn"] : ["Node.js", "TypeScript", "Veb Dasturlash"]);
  const categories = seed?.categories ?? (headline.toLowerCase().includes("dizayn") ? ["dizayn"] : ["dasturlash"]);

  return {
    userId: me.id,
    headline,
    bio,
    skills,
    categories,
    avatarUrl: asStr(me.avatarKey),
    location: seed?.location ?? "Toshkent shahri",
    languages: seed?.languages ?? [{ name: "O'zbek", level: "native" }],
    portfolio: seed?.portfolio ?? [],
    responseTimeHours: seed?.responseTimeHours ?? 1,
    rating: seed?.rating ?? 0,
    reviewCount: seed?.reviewCount ?? 0,
    completedContracts: seed?.completedContracts ?? 0,
    badge: seed?.badge ?? "yangi",
    memberSince: me.createdAt,
    available: true,
    identityVerified: me.verified,
  };
}

function mapServiceStatus(status: RealService["status"]): Model.ServiceStatus {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "PENDING_REVIEW":
      return "pending_review";
    case "REJECTED":
      return "rejected";
    case "ARCHIVED":
      return "archived";
    case "PAUSED":
      return "paused";
    case "ACTIVE":
    default:
      return "active";
  }
}

export function mapService(s: RealService, categorySlug: string): Model.Service {
  return {
    id: s.id,
    sellerId: s.sellerId,
    category: categorySlug as Model.ServiceCategory,
    title: s.title,
    description: s.description,
    fields: {},
    price: s.price,
    currency: "UZS",
    deliveryDays: s.deliveryDays,
    images: [],
    status: mapServiceStatus(s.status),
    createdAt: s.createdAt,
  };
}

export function mapPublicService(s: RealPublicService, categorySlug: string): Model.Service {
  return {
    id: s.id,
    sellerId: s.sellerId,
    category: categorySlug as Model.ServiceCategory,
    title: s.title,
    description: s.description,
    fields: {},
    price: s.price,
    currency: "UZS",
    deliveryDays: s.deliveryDays,
    images: [],
    status: "active",
    createdAt: s.createdAt,
  };
}

function mapContractStatus(status: RealContract["status"]): Model.ContractStatus {
  switch (status) {
    case "PENDING_SELLER":
      return "imzolangan";
    case "ACTIVE":
      return "faol";
    case "COMPLETED":
      return "yakunlangan";
    case "CANCELLED":
    case "REJECTED":
    default:
      return "bekor_qilingan";
  }
}

/**
 * `funded` — shu shartnoma uchun SUCCEEDED to'lov bormi (chaqiruvchi
 * alohida `getContractPayment`/`listPayments` orqali aniqlab beradi —
 * `ContractResponseDto`ning o'zida bu ma'lumot yo'q). Shu qiymat orqali
 * `fundedAt` (mavjud maydon — CLAUDE.md: "undefined mavjud bo'lmagan
 * tarmoqni tabiiy o'chiradi") va bosqich holati ("mablaglangan" vs
 * "kutilmoqda") hisoblanadi.
 */
export function mapContract(
  c: RealContract,
  opts: { funded: boolean; fundedAt?: string; sellerName?: string; buyerName?: string },
): Model.Contract {
  /* Agar kontrakt ACTIVE bo'lsa-yu, lekin hali mablag'lanmagan (!opts.funded) bo'lsa:
     Bobololadono mahsulot modelida bu to'lov kutilayotgan holat ("imzolangan").
     To'langandan keyingina "faol" bo'ladi. */
  const status: Model.ContractStatus =
    c.status === "ACTIVE" && !opts.funded
      ? "imzolangan"
      : mapContractStatus(c.status);

  return {
    id: c.id,
    sourceType: "xizmat",
    serviceId: c.serviceId,
    buyerId: c.buyerId,
    buyerName: opts.buyerName ?? "Xaridor",
    sellerId: c.sellerId,
    sellerName: opts.sellerName ?? c.sellerDisplayNameSnapshot,
    title: c.serviceTitleSnapshot,
    totalAmount: c.agreedAmount,
    status,
    createdAt: c.createdAt,
    paymentMethod: "payme",
    fundedAt: opts.funded ? opts.fundedAt : undefined,
    cancelReason: c.status === "REJECTED" ? "Mutaxassis taklifni rad etdi" : undefined,
    sellerAcceptedAt: c.status !== "PENDING_SELLER" ? c.updatedAt : undefined,
    rawStatus: c.status,
  };
}

export function mapMilestone(m: RealMilestone, funded: boolean, platformFeeRateBps?: number): Model.Milestone {
  let status: Model.MilestoneStatus;
  switch (m.status) {
    case "PENDING":
      status = "kutilmoqda";
      break;
    case "IN_PROGRESS":
      status = funded ? "mablaglangan" : "kutilmoqda";
      break;
    case "SUBMITTED":
      status = "topshirildi";
      break;
    case "REVISION_REQUESTED":
      status = "ozgartirish_soraldi";
      break;
    case "APPROVED":
    default:
      status = "qabul_qilindi";
      break;
  }
  const submittedAtStr = asStr(m.submittedAt);
  const reviewDeadline = submittedAtStr
    ? new Date(new Date(submittedAtStr).getTime() + 3 * 86400000).toISOString()
    : undefined;
  return {
    platformFeeRateBps,
    id: m.id,
    contractId: m.contractId,
    title: m.title,
    description: asStr(m.description) ?? "",
    amount: m.amount,
    status,
    dueDate: asStr(m.dueAt) ?? m.createdAt,
    submittedAt: submittedAtStr,
    reviewDeadline,
    approvedAt: asStr(m.approvedAt),
  };
}

export function mapPayment(p: RealPayment): PaymentDTO {
  return {
    id: p.id,
    contractId: p.contractId,
    provider: p.provider,
    status: p.status,
    amount: p.amount,
    currency: "UZS",
    checkoutUrl: p.checkoutUrl,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function mapDisputeStatus(status: RealDispute["status"]): Model.Dispute["status"] {
  switch (status) {
    case "UNDER_REVIEW":
      return "korib_chiqilmoqda";
    case "RESOLVED":
    case "REJECTED":
    case "CANCELLED":
      return "hal_qilindi";
    case "OPEN":
    default:
      return "ochiq";
  }
}

export function mapDispute(d: RealDispute): Model.Dispute {
  return {
    id: d.id,
    contractId: d.contractId,
    /* Real backend ishtirokchi javobida "kim ochdi"ni qaytarmaydi — UI
       "qaytarib olish" tugmasini har doim ko'rsatadi, huquqi bo'lmasa
       server FORBIDDEN qaytaradi (`DisputeSummary.tsx` buni allaqachon
       maxsus xabar bilan ushlaydi). */
    openedBy: "",
    reason: d.reason.toLowerCase() as Model.Dispute["reason"],
    description: d.description,
    evidence: [],
    status: mapDisputeStatus(d.status),
    createdAt: d.openedAt,
    resolvedAt: asStr(d.resolvedAt),
    resolution: asStr(d.resolutionReason),
  };
}

export function mapPayout(p: RealPayout, userName?: string): Model.WithdrawalRequest {
  let status: Model.WithdrawalStatus = "kutilmoqda";
  let payoutStatus: Model.PayoutStatus = "payout_pending";
  if (p.status === "SUCCEEDED") {
    status = "tasdiqlangan";
    payoutStatus = "paid";
  } else if (p.status === "FAILED") {
    status = "rad_etilgan";
    payoutStatus = "payout_failed";
  } else if (p.status === "PROCESSING") {
    status = "korib_chiqilmoqda";
    payoutStatus = "payout_processing";
  }

  const createdAt = asStr(p.createdAt) ?? new Date().toISOString();
  const processedAt = asStr(p.succeededAt);

  return {
    id: p.id,
    userId: "me",
    userName: userName || "Mutaxassis",
    userRole: "mutaxassis",
    source: "earnings",
    amount: p.amount,
    currency: "UZS",
    payoutMethod: "card",
    cardDetails: p.destinationReference,
    status,
    payoutStatus,
    payoutReference: p.destinationReference,
    createdAt,
    processedAt,
    rejectionReason: asStr(p.failureReason),
  };
}

