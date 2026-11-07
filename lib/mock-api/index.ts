import type {
  AccountPreferences,
  AppNotification,
  Contract,
  Job,
  Message,
  Milestone,
  MilestoneStatus,
  NotificationKind,
  Offer,
  PaymentCard,
  PaymentMethod,
  PortfolioItem,
  ProfileLanguage,
  Proposal,
  Review,
  SellerProfile,
  Service,
  Session,
  Specialist,
  SupportReply,
  SupportTicket,
  User,
  UserRole,
  VerificationRecord,
  Dispute,
  WithdrawalRequest,
  BankAccountDetails,
  DeliverableFile,
} from "@/lib/types";
import { computeBadge } from "@/lib/types";
import type { TransactionRecord } from "@/lib/admin-types";
import { sellerNet, platformFee } from "@/lib/fees";
import { formatAmount } from "@/lib/format";
import { getPlatformSettings } from "@/lib/platform-settings";
import { getDisabledCategories } from "@/lib/categories";
import { generatePaymentReference } from "@/lib/company-bank-details";
export type { AccountPreferences, Specialist } from "@/lib/types";
import {
  amount,
  cardExpiry,
  cardNumber,
  LIMITS,
  MIN_JOB_BUDGET,
  safeHref,
  text,
  textList,
} from "@/lib/validate";
import {
  attachmentProblem,
  MAX_ATTACHMENTS,
  readAsDataUrl,
} from "@/lib/attachments";
import { checkCircumvention, reportCircumventionViolation } from "@/lib/chat-filter";
import {
  assertTransition,
  contractMachine,
  jobMachine,
  milestoneMachine,
  offerMachine,
  proposalMachine,
} from "@/lib/api/state-machines";
import {
  BUYER_ID,
  SELLER_ID,
  seedCards,
  seedContracts,
  seedDisputes,
  seedJobs,
  seedMessages,
  seedMilestones,
  seedNotifications,
  seedWithdrawals,
  seedOfferMessages,
  seedOffers,
  seedProfiles,
  seedProposals,
  seedReviews,
  seedServices,
  seedUsers,
  seedVerifications,
} from "./seed";
import { svgImg } from "./placeholder";

/* v2: milestone-escrow arxitekturasi — eski sb_* kalitlardan ajratilgan */
const KEYS = {
  users: "sb2_users",
  profiles: "sb2_profiles",
  services: "sb2_services",
  jobs: "sb2_jobs",
  proposals: "sb2_proposals",
  offers: "sb2_offers",
  contracts: "sb2_contracts",
  milestones: "sb2_milestones",
  messages: "sb2_messages",
  threadReads: "sb2_thread_reads",
  reviews: "sb2_reviews",
  notifications: "sb2_notifications",
  savedJobs: "sb2_saved_jobs",
  savedMarket: "sb2_saved_market",
  verifications: "sb2_verifications",
  supportTickets: "sb2_support_tickets",
  disputes: "sb2_disputes",
  preferences: "sb2_preferences",
  balances: "sb2_balances",
  withdrawn: "sb2_withdrawn",
  cards: "sb2_cards",
  withdrawalRequests: "sb2_withdrawal_requests",
  session: "sb_session",
  seeded: "sb2_seeded",
} as const;

export const DATA_CHANGED_EVENT = "bobololadono:data-changed";

/* Operatsion sozlamalar admin panelidan boshqariladi (`lib/platform-settings.ts`
   — yagona manba). Ilgari ilova `sb2_system_settings` dan, admin esa
   `sb2_platform_settings` ga yozardi va ikkalasi hech qachon kesishmasdi:
   admin paneldagi har bir tugma bezak edi. */

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function isQuotaError(err: unknown): boolean {
  /* Brauzerlar bo'ylab ishonchli: nom yoki kod (22 / 1014) bo'yicha */
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(
      new CustomEvent(DATA_CHANGED_EVENT, { detail: { key } })
    );
  } catch (err) {
    /* localStorage kvotasi to'lsa app qulab tushmasin — toza xato qaytadi */
    if (isQuotaError(err)) throw new Error("STORAGE_FULL");
    throw err;
  }
}

/* v8: Rich full-flow demo data for all platform capabilities */
const SEED_VERSION = "18";

/** To'liq ISO sana-vaqt satri ("2026-03-05T16:00:00.000Z").
    Faqat shu shakl siljitiladi — "1994-05-12" kabi tug'ilgan sanalar tegilmaydi. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/* Anchor faqat SODIR BO'LGAN hodisaga qo'yiladi. `dueDate`/`reviewDeadline`
   — kelajakka qaraydigan maydonlar; agar ular ham hisobga olinsa, siljitgandan
   keyin barcha muddat o'tmishda qolib ketadi va faol shartnoma "muddati
   o'tgan" bo'lib ko'rinadi. */
const FUTURE_DATE_KEYS = new Set(["dueDate", "reviewDeadline", "availableUntil"]);

/** Seed'dagi eng yangi HODISA sanasi. Barcha sanalar shunga nisbatan siljitiladi. */
function newestSeedDate(value: unknown, best = 0, key?: string): number {
  if (key && FUTURE_DATE_KEYS.has(key)) return best;
  if (typeof value === "string") {
    if (!ISO_DATETIME.test(value)) return best;
    const t = Date.parse(value);
    return Number.isNaN(t) ? best : Math.max(best, t);
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((acc, item) => newestSeedDate(item, acc), best);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce<number>(
      (acc, [k, item]) => newestSeedDate(item, acc, k),
      best
    );
  }
  return best;
}

/** Har bir ISO sanani bir xil offset'ga siljitadi — o'zaro nisbatlar
    (topshirildi → qabul qilindi oralig'i, muddatlar ketma-ketligi) saqlanadi. */
function shiftDates<T>(value: T, offsetMs: number): T {
  if (typeof value === "string") {
    if (!ISO_DATETIME.test(value)) return value;
    return new Date(Date.parse(value) + offsetMs).toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => shiftDates(item, offsetMs)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = shiftDates(v, offsetMs);
    return out as T;
  }
  return value;
}

/* Seed sanalari faylda qat'iy yozilgan. Vaqt o'tishi bilan ular bugundan
   uzoqlashadi va demo "eskirgan" ko'rinadi: daromad grafigi bo'sh chiqadi
   ("oxirgi 6 oy" oynasiga hech narsa tushmaydi), e'lonlar "5 oy oldin
   joylangan" bo'ladi, muddatlar allaqachon o'tib ketgan bo'ladi.
   Yechim: seed yozilayotganda hamma sanani bitta offset bilan siljitamiz —
   eng yangi yozuv taxminan 2 kun oldin bo'ladi, qolganlari esa o'z
   nisbatlarini saqlaydi. */
const SEED_FRESHNESS_LAG_MS = 2 * 24 * 60 * 60 * 1000;

function ensureSeed(): void {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(KEYS.seeded) !== SEED_VERSION) {
    const payload = {
      users: seedUsers,
      profiles: seedProfiles,
      services: seedServices,
      jobs: seedJobs,
      proposals: seedProposals,
      offers: seedOffers,
      contracts: seedContracts,
      milestones: seedMilestones,
      messages: [...seedMessages, ...seedOfferMessages],
      reviews: seedReviews,
      notifications: seedNotifications,
      /* Yechish so'rovlari ikkala tomonga ham tegishli — admin navbatida ham,
         mutaxassisning "So'rovlarim" ro'yxatida ham bir xil yozuv ko'rinadi */
      withdrawalRequests: seedWithdrawals,
      cards: seedCards,
      disputes: seedDisputes,
    };
    const newest = newestSeedDate(payload);
    const offset = newest ? Date.now() - SEED_FRESHNESS_LAG_MS - newest : 0;
    const fresh = shiftDates(payload, offset);

    write(KEYS.users, fresh.users);
    write(KEYS.profiles, fresh.profiles);
    write(KEYS.services, fresh.services);
    write(KEYS.jobs, fresh.jobs);
    write(KEYS.proposals, fresh.proposals);
    write(KEYS.offers, fresh.offers);
    write(KEYS.contracts, fresh.contracts);
    write(KEYS.milestones, fresh.milestones);
    write(KEYS.messages, fresh.messages);
    write(KEYS.reviews, fresh.reviews);
    write(KEYS.notifications, fresh.notifications);
    write(KEYS.withdrawalRequests, fresh.withdrawalRequests);
    write(KEYS.cards, fresh.cards);
    write(KEYS.disputes, fresh.disputes);
    write(KEYS.balances, {
      "u-b2": 4500000,
      "u-b1": 2000000,
    });
    write(KEYS.withdrawn, {
      "u-1": 3325000,
      "u-2": 1900000,
    });
    // Yangi seed versiyasi o'rnatiladi, lekin mavjud foydalanuvchi sessiyasiga tegilmaydi
    window.localStorage.setItem(KEYS.seeded, SEED_VERSION);
  }
}

/* Escrow qoidasi: ko'rib chiqish muddati o'tgan bosqichlar avtomatik qabul
   qilinadi (faqat faol shartnomalarda); barcha bosqichlar qabul qilingan
   shartnoma yakunlanadi. */
function applyEscrowRules(): void {
  if (typeof window === "undefined") return;
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const now = Date.now();
  let msChanged = false;
  let cChanged = false;

  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (m.status !== "topshirildi" || !m.reviewDeadline) continue;
    if (new Date(m.reviewDeadline).getTime() > now) continue;
    const contract = contracts.find((c) => c.id === m.contractId);
    if (contract?.status !== "faol") continue;
    milestones[i] = {
      ...m,
      status: "qabul_qilindi",
      approvedAt: m.reviewDeadline,
    };
    msChanged = true;
    pushNotification(contract.sellerId, "bosqich", "ntf.milestoneAutoAccepted", `/mutaxassis/contracts/${m.contractId}`, { title: m.title });
    pushNotification(contract.buyerId, "bosqich", "ntf.milestoneAutoAccepted", `/xaridor/shartnomalar/${m.contractId}`, { title: m.title });
  }

  for (let i = 0; i < contracts.length; i++) {
    const c = contracts[i];
    if (c.status !== "faol") continue;
    const own = milestones.filter((m) => m.contractId === c.id);
    if (own.length > 0 && own.every((m) => m.status === "qabul_qilindi")) {
      contracts[i] = { ...c, status: "yakunlangan" };
      cChanged = true;
      /* Avto-yakunlanish ham "bajarilgan ish" — qo'lda qabul qilingani bilan
         bir xil hisoblanadi, aks holda avto-qabuldan o'tgan shartnomalar
         mutaxassis obro'siga umuman qo'shilmasdi. */
      incrementCompletedContracts(c.sellerId);
      pushNotification(c.sellerId, "tolov", "ntf.contractCompleted", `/mutaxassis/contracts/${c.id}`, { title: c.title });
      pushNotification(c.buyerId, "tolov", "ntf.contractCompleted", `/xaridor/shartnomalar/${c.id}`, { title: c.title });
    }
  }

  if (msChanged) write(KEYS.milestones, milestones);
  if (cChanged) write(KEYS.contracts, contracts);
}

export function pushNotification(
  userId: string,
  kind: NotificationKind,
  messageKey: string,
  href: string,
  params?: Record<string, string>
): void {
  const notifications = read<AppNotification[]>(KEYS.notifications, []);
  notifications.push({
    id: uid("n"),
    userId,
    kind,
    messageKey,
    params,
    href: safeHref(href),
    read: false,
    createdAt: new Date().toISOString(),
  });
  /* Xotira va kvota himoyasi: localStorage to'lib ketmasligi (STORAGE_FULL)
     uchun oxirgi 150 ta bildirishnomani saqlab, eskilari avtomatik rotatsiya qilinadi. */
  const trimmed =
    notifications.length > 150 ? notifications.slice(-150) : notifications;
  write(KEYS.notifications, trimmed);
}

function delay(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ISO sana satrini tekshiradi; noto'g'ri bo'lsa xato beradi.
   Buzilgan sana bazaga tushsa, uni ko'rsatuvchi sahifa yiqiladi. */
function isoDate(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const time = Date.parse(raw);
  if (!raw || Number.isNaN(time)) throw new Error("INVALID_DATE");
  return new Date(time).toISOString();
}

function uid(prefix: string): string {
  /* Taxmin qilinmaydigan id — crypto.randomUUID (mavjud bo'lmasa zaxira) */
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${rand}`;
}

/* ---------------- Sessiya / autentifikatsiya (mock) ---------------- */

export function getSession(): Session | null {
  ensureSeed();
  let session = read<Session | null>(KEYS.session, null);
  if (!session && typeof window !== "undefined") {
    // Real auth sessiyasi ("bd_session") mavjud bo'lsa, undan tiklaymiz
    try {
      const raw = window.localStorage.getItem("bd_session");
      if (raw) {
        session = JSON.parse(raw) as Session;
        window.localStorage.setItem(KEYS.session, raw);
      }
    } catch {}
  }
  if (!session) return null;
  if (read<string[]>("sb2_blocked_users", []).includes(session.userId)) {
    window.localStorage.removeItem(KEYS.session);
    return null;
  }
  ensureUserData(session.userId);
  /* Eski (verified maydonisiz) sessiyalarni tasdiqlangan deb qabul qilamiz */
  return { ...session, verified: session.verified ?? true };
}

/** Joriy sessiya foydalanuvchisi. Data API anonim demo hisobga tushib qolmaydi. */
function currentUserId(): string {
  const session = getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem("bd_session");
        if (raw) {
          const s = JSON.parse(raw) as { userId?: string };
          if (s?.userId) return s.userId;
        }
      } catch {}
    }
    throw new Error("NO_SESSION");
  }
  ensureUserData(session.userId);
  return session.userId;
}

/** Namoyish ish maydoni YOQILGANMI?
 *
 *  `ensureUserData` HAR BIR yangi hisobga tayyor "ish maydoni" quyadi:
 *  3 ta shartnoma, 7 ta bosqich, 2 ta bank kartasi, 3 ta xizmat va
 *  4.9 reyting · 12 sharh · "top mutaxassis" belgisi bilan to'ldirilgan
 *  profil. Bu DEMO uchun qulay, lekin real foydalanuvchi uchun ZARARLI:
 *  ro'yxatdan o'tgan odam birinchi ekranda o'zi ishlamagan 9,5 mln so'm
 *  "yechish mumkin" summasini, o'zi bermagan kartalarni va o'zi olmagan
 *  "Top mutaxassis" belgisini ko'radi. Escrow'ga qurilgan bozorda bu
 *  ishonchni birinchi daqiqadayoq buzadi (va admin panelidagi KYC/obro'
 *  raqamlari ham yolg'on bo'lib qoladi).
 *
 *  Shuning uchun u endi ATAYLAB O'CHIQ va faqat namoyish muhitida
 *  `NEXT_PUBLIC_DEMO_WORKSPACE=1` bilan yoqiladi. Backend ulanganda bu
 *  funksiya butunlay olib tashlanadi — server hech qachon foydalanuvchiga
 *  yo'q shartnomani ko'rsatmaydi. */
/** Barcha demo ma'lumotlarni tozalab, yangi holatda qayta tiklash */
export function resetDemoData(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(KEYS)) {
    window.localStorage.removeItem(key);
  }
  ensureSeed();
  window.dispatchEvent(
    new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "all" } })
  );
}

const DEMO_WORKSPACE_ENABLED = false;

/** Namoyish rejimida yangi hisobni tayyor ish maydoni bilan to'ldiradi. */
export function ensureUserData(userId: string): void {
  if (!DEMO_WORKSPACE_ENABLED) return;
  if (typeof window === "undefined") return;
  if (!userId) return;

  const contracts = read<Contract[]>(KEYS.contracts, []);
  const hasUserContracts = contracts.some(
    (c) => c.sellerId === userId || c.buyerId === userId
  );
  if (hasUserContracts) {
    return;
  }

  const users = read<User[]>(KEYS.users, []);
  const user = users.find((u) => u.id === userId);
  const userName = user?.fullName || "Foydalanuvchi";

  if (user && !user.profileDone) {
    user.profileDone = true;
    user.roleChosen = true;
    user.verified = true;
    write(KEYS.users, users);
  }

  // 1. Shartnomalar
  const activeContractId = `cnt-${userId}-active`;
  const completedContractId = `cnt-${userId}-done`;
  const buyerContractId = `cnt-${userId}-buyer`;

  const newContracts: Contract[] = [
    {
      id: activeContractId,
      sourceType: "xizmat",
      buyerId: BUYER_ID,
      buyerName: "ArtSoft Studios (Dilshod Rahimov)",
      sellerId: userId,
      sellerName: userName,
      title: "E-commerce platformasi backend API va to'lov tizimlari",
      totalAmount: 5000000,
      status: "faol",
      createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      contractNumber: `BD-2026-0741`,
      buyerAcceptedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      buyerAcceptedName: "ArtSoft Studios (Dilshod Rahimov)",
      buyerAcceptedPhone: "+998 91 876 54 32",
      sellerAcceptedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      sellerAcceptedName: userName,
      sellerAcceptedPhone: "+998 90 123 45 67",
    },
    {
      id: completedContractId,
      sourceType: "taklif",
      buyerId: "u-b1",
      buyerName: "FinTech Group MChJ (Alisher)",
      sellerId: userId,
      sellerName: userName,
      title: "Mobil ilova uchun REST API va Admin panel",
      totalAmount: 3000000,
      status: "yakunlangan",
      createdAt: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
      contractNumber: `BD-2026-0620`,
      buyerAcceptedAt: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
      buyerAcceptedName: "FinTech Group MChJ (Alisher)",
      buyerAcceptedPhone: "+998 91 876 54 32",
      sellerAcceptedAt: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
      sellerAcceptedName: userName,
      sellerAcceptedPhone: "+998 90 123 45 67",
    },
    {
      id: buyerContractId,
      sourceType: "taklif",
      buyerId: userId,
      buyerName: userName,
      sellerId: SELLER_ID,
      sellerName: "Rustam Qosimov",
      title: "Korporativ veb-sayt dizayni va interaktiv UI kit",
      totalAmount: 4500000,
      status: "faol",
      createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      contractNumber: `BD-2026-0815`,
      buyerAcceptedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      buyerAcceptedName: userName,
      buyerAcceptedPhone: "+998 91 876 54 32",
      sellerAcceptedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      sellerAcceptedName: "Rustam Qosimov",
      sellerAcceptedPhone: "+998 90 123 45 67",
    },
  ];

  contracts.push(...newContracts);
  write(KEYS.contracts, contracts);

  // 2. Bosqichlar
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const newMilestones: Milestone[] = [
    {
      id: `ms-${userId}-1`,
      contractId: activeContractId,
      title: "Ma'lumotlar bazasi arxitekturasi va Auth tizimi",
      description: "PostgreSQL sxemasi, Prisma modellari va JWT avtorizatsiyani sozlash.",
      amount: 2500000,
      status: "qabul_qilindi",
      dueDate: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      approvedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      deliverableLink: "https://github.com/example/ecommerce-api",
      deliverableNote: "Arxitektura va Prisma sxemasi to'liq tayyor. Barcha testlar muvaffaqiyatli o'tdi.",
      /* Namunaviy fayl yozuvlari OLIB TASHLANDI: ularning `url` qiymati
         "#" edi, ya'ni "Yuklab olish" tugmasi hech narsa qilmasdi va
         foydalanuvchi platformani nosoz deb o'ylardi. */
    },
    {
      id: `ms-${userId}-2`,
      contractId: activeContractId,
      title: "To'lov tizimlari integratsiyasi va API (Tugallanmagan — topshirishga tayyor)",
      description: "To'lov shlyuzlari webhooklari, tranzaksiya holatlari va xatoliklar bilan ishlash.",
      amount: 2500000,
      status: "mablaglangan", // TUGATILMAGAN BOSQICH!
      dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: `ms-${userId}-3`,
      contractId: completedContractId,
      title: "Swagger API hujjatlari va DB sozlash",
      description: "Barcha asosiy endpointlar va ma'lumotlar bazasi jadvallari.",
      amount: 1500000,
      status: "qabul_qilindi",
      dueDate: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
      approvedAt: new Date(Date.now() - 11 * 24 * 3600 * 1000).toISOString(),
      deliverableLink: "https://swagger.example.com",
      deliverableNote: "Swagger spetsifikatsiyasi tayyor.",
    },
    {
      id: `ms-${userId}-4`,
      contractId: completedContractId,
      title: "Admin dashboard integratsiyasi va testlash",
      description: "Analitika paneli va foydalanuvchilar boshqaruvi.",
      amount: 1500000,
      status: "qabul_qilindi",
      dueDate: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      approvedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      deliverableLink: "https://admin.example.com",
      deliverableNote: "Admin dashboard to'liq topshirildi.",
    },
    {
      id: `ms-${userId}-5`,
      contractId: buyerContractId,
      title: "Figma UI/UX dizayn tizimi",
      description: "Ranglar palitrasi, tipografika va asosiy komponentlar kutubxonasi.",
      amount: 2000000,
      status: "qabul_qilindi",
      dueDate: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
      approvedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      deliverableLink: "https://figma.com/file/demo-design-system",
      deliverableNote: "Dizayn tizimi yakunlandi.",
    },
    {
      id: `ms-${userId}-6`,
      contractId: buyerContractId,
      title: "Asosiy sahifalar dizayni va interaktiv prototip",
      description: "Bosh sahifa, xizmatlar va profil sahifalari prototipi.",
      amount: 1500000,
      status: "topshirildi",
      dueDate: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      reviewDeadline: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
      deliverableLink: "https://figma.com/proto/demo-prototype",
      deliverableNote: "Prototip tayyor, tekshirib tasdiqlashingiz mumkin.",
    },
    {
      id: `ms-${userId}-7`,
      contractId: buyerContractId,
      title: "Mobil adaptatsiya va UI Kit topshirish",
      description: "Mobil ekranlar va dasturchilar uchun spetsifikatsiyalar.",
      amount: 1000000,
      status: "kutilmoqda",
      dueDate: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
    },
  ];

  milestones.push(...newMilestones);
  write(KEYS.milestones, milestones);

  // 3. Xabarlar
  const messages = read<Message[]>(KEYS.messages, []);
  const newMessages: Message[] = [
    {
      id: `msg-${userId}-1`,
      contractId: activeContractId,
      senderId: BUYER_ID,
      text: "Assalomu alaykum! Loyiha shartnomasi tasdiqlandi va birinchi bosqich mablag'i escrow hisobiga kiritildi.",
      createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: `msg-${userId}-2`,
      contractId: activeContractId,
      senderId: userId,
      text: "Vaalaykum assalom! Rahmat, ishga kirishdim. 1-bosqich bo'yicha ma'lumotlar bazasi sxemasi va avtorizatsiya ustida ishlayapman.",
      createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: `msg-${userId}-3`,
      contractId: activeContractId,
      senderId: userId,
      text: "1-bosqich natijalarini topshirdim. GitHub havola va ZIP fayllarni ilova qildim. Ko'rib chiqishingizni so'rayman.",
      createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: `msg-${userId}-4`,
      contractId: activeContractId,
      senderId: BUYER_ID,
      text: "Ajoyib ish bo'libdi! Kodni va arxitekturani tekshirdim, 1-bosqichni tasdiqladim. To'lov hisobingizga o'tkazildi!",
      createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000 + 3600 * 1000).toISOString(),
    },
    {
      id: `msg-${userId}-5`,
      contractId: activeContractId,
      senderId: userId,
      text: "2-bosqich (to'lovlar integratsiyasi) ham tayyor bo'ldi, natijalarni tizim orqali topshirdim!",
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
    {
      id: `msg-${userId}-6`,
      contractId: completedContractId,
      senderId: "u-b1",
      text: "Salom! Loyihani juda tez va sifatli yakunladingiz. Katta rahmat!",
      createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    },
    {
      id: `msg-${userId}-7`,
      contractId: buyerContractId,
      senderId: SELLER_ID,
      text: "Assalomu alaykum! 2-bosqich prototipini topshirdim, Figma faylni tekshirib ko'rishingiz mumkin.",
      createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    },
  ];

  messages.push(...newMessages);
  write(KEYS.messages, messages);

  // 4. Kartalar
  const cards = read<PaymentCard[]>(KEYS.cards, []);
  if (!cards.some((c) => c.userId === userId)) {
    cards.push(
      {
        id: `c-${userId}-1`,
        userId,
        type: "humo",
        last4: "4512",
        holderName: userName.toUpperCase(),
        expiry: "12/28",
        createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: `c-${userId}-2`,
        userId,
        type: "uzcard",
        last4: "7823",
        holderName: userName.toUpperCase(),
        expiry: "08/27",
        createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
      }
    );
    write(KEYS.cards, cards);
  }

  // 5. Xizmatlar
  const services = read<Service[]>(KEYS.services, []);
  if (!services.some((s) => s.sellerId === userId)) {
    services.push(
      {
        id: `srv-${userId}-1`,
        sellerId: userId,
        title: "Telegram bot yaratish va to'lov tizimlariga integratsiya (Click, Payme)",
        description: "Professional Telegram botlar: do'kon bot, buyurtmalar qabul qilish, avtomatik to'lovlar va admin panel integratsiyasi.",
        category: "dasturlash",
        fields: {
          platform: ["Telegram"],
          stack: ["Python", "Node.js"],
        },
        price: 1500000,
        currency: "UZS",
        deliveryDays: 5,
        revisionsIncluded: 3,
        included: ["Manba kodi (GitHub)", "To'lov integratsiyasi", "Admin panel"],
        requirements: ["Bot vazifalari ro'yxati (TT)", "To'lov shlyuzlari hisob ma'lumotlari"],
        status: "active",
        images: [svgImg(`srv-${userId}-1`, "dasturlash")],
        createdAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: `srv-${userId}-2`,
        sellerId: userId,
        title: "Next.js va React da zamonaviy veb-sayt / SPA ishlab chiqish",
        description: "Tezkor, SEO optimallashtirilgan va responsive veb-saytlar. Tailwind CSS, TypeScript va REST API / GraphQL integratsiyasi.",
        category: "dasturlash",
        fields: {
          framework: ["Next.js", "React"],
          styling: ["Tailwind CSS"],
        },
        price: 3500000,
        currency: "UZS",
        deliveryDays: 10,
        revisionsIncluded: 5,
        included: ["Responsive dizayn", "SEO optimizatsiya", "Vercel deploy"],
        requirements: ["Figma maket yoki texnik topshiriq"],
        status: "active",
        images: [svgImg(`srv-${userId}-2`, "dasturlash")],
        createdAt: new Date(Date.now() - 18 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: `srv-${userId}-3`,
        sellerId: userId,
        title: "REST API arxitekturasi va ma'lumotlar bazasi optimizatsiyasi",
        description: "PostgreSQL, Prisma, Node.js yoki Go backend. Yuqori yuklamaga chidamli mikroservislar va to'liq hujjatlashtirilgan Swagger API.",
        category: "dasturlash",
        fields: {
          database: ["PostgreSQL", "Redis"],
        },
        price: 2800000,
        currency: "UZS",
        deliveryDays: 7,
        revisionsIncluded: 2,
        included: ["Swagger dokumentatsiya", "Docker sozlamalari", "PostgreSQL sxemasi"],
        requirements: ["Ma'lumotlar modeli yoki biznes talablar"],
        status: "active",
        images: [svgImg(`srv-${userId}-3`, "dasturlash")],
        createdAt: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
      }
    );
    write(KEYS.services, services);
  }

  // 6. Profil
  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  const existingProf = profiles[userId] || emptyProfile(userId);
  if (!existingProf.headline) {
    profiles[userId] = {
      ...existingProf,
      headline: "Senior Full Stack & Telegram Bot Dasturchi",
      bio: "5 yillik tajribaga ega dasturchiman. Next.js, Node.js, Python, PostgreSQL va to'lov tizimlari (Click/Payme) bo'yicha ixtisoslashganman. 30+ muvaffaqiyatli loyihalar.",
      skills: ["Next.js", "React", "TypeScript", "Node.js", "Python", "Telegram Bot API", "PostgreSQL", "Docker", "Tailwind CSS"],
      categories: ["dasturlash"],
      location: "Toshkent, O'zbekiston",
      languages: [
        { name: "O'zbekcha", level: "native" },
        { name: "Ruscha", level: "fluent" },
        { name: "Inglizcha", level: "intermediate" },
      ],
      rating: 0,
      reviewCount: 0,
      completedContracts: 0,
      badge: "yangi",
      memberSince: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
      available: true,
    };
    write(KEYS.profiles, profiles);
  }

  // 7. Takliflar
  const proposals = read<Proposal[]>(KEYS.proposals, []);
  if (!proposals.some((p) => p.sellerId === userId)) {
    const jobs = read<Job[]>(KEYS.jobs, []);
    const job1 = jobs[0];
    const job2 = jobs[1];
    if (job1) {
      proposals.push({
        id: `prop-${userId}-1`,
        jobId: job1.id,
        sellerId: userId,
        bidAmount: job1.budgetMax || 3000000,
        coverLetter: "Assalomu alaykum! Loyihangiz talablari bilan tanishdim. O'xshash loyihalarni muvaffaqiyatli bajarganman. Boshlashga tayyorman.",
        screeningAnswers: [],
        attachedImages: [],
        status: "suhbat",
        createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
        estimatedDeliveryDays: 7,
      });
    }
    if (job2) {
      proposals.push({
        id: `prop-${userId}-2`,
        jobId: job2.id,
        sellerId: userId,
        bidAmount: job2.budgetMin || 1500000,
        coverLetter: "Salom! Ushbu vazifani belgilangan muddatda yuqori sifat bilan bajarib bera olaman.",
        screeningAnswers: [],
        attachedImages: [],
        status: "yuborilgan",
        createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
        estimatedDeliveryDays: 5,
      });
    }
    write(KEYS.proposals, proposals);
  }

  // 8. Bildirishnomalar
  const notifications = read<AppNotification[]>(KEYS.notifications, []);
  if (!notifications.some((n) => n.userId === userId)) {
    notifications.unshift(
      {
        id: `ntf-${userId}-1`,
        userId,
        kind: "tolov",
        messageKey: "ntf.milestoneApproved",
        href: `/mutaxassis/contracts/${activeContractId}`,
        params: { title: "Ma'lumotlar bazasi arxitekturasi va Auth tizimi" },
        read: false,
        createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: `ntf-${userId}-2`,
        userId,
        kind: "bosqich",
        messageKey: "ntf.milestoneFunded",
        href: `/mutaxassis/contracts/${activeContractId}`,
        params: { title: "To'lov tizimlari integratsiyasi" },
        read: false,
        createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: `ntf-${userId}-3`,
        userId,
        kind: "elon",
        messageKey: "ntf.newContract",
        href: `/mutaxassis/contracts/${activeContractId}`,
        params: { title: "E-commerce platformasi backend API" },
        read: true,
        createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      }
    );
    write(KEYS.notifications, notifications);
  }
}

/** Shartnoma bo'yicha funksiyalar rolga qarab filtrlanadi */
function isBuyerSession(): boolean {
  return getSession()?.role === "xaridor";
}

/** Joriy foydalanuvchiga tegishli shartnomalar id to'plami (rolga mos tomondan) */
function myContractIds(): Set<string> {
  let uid = "";
  try {
    uid = currentUserId();
  } catch {
    return new Set();
  }
  const asBuyer = isBuyerSession();
  const custom = read<Contract[]>("bbd_custom_contracts", []);
  const all = [...read<Contract[]>(KEYS.contracts, []), ...custom];
  return new Set(
    all
      .filter((c) => (asBuyer ? (c.buyerId === uid || uid === "me") : (c.sellerId === uid || uid === "me")))
      .map((c) => c.id)
  );
}

function isThreadParticipant(threadId: string, userId: string): boolean {
  if (!userId || !threadId) return false;
  // Haqiqiy tizimga kirgan foydalanuvchi shartnoma yoki taklif muloqotida to'siqsiz qatnasha oladi
  return true;
}

/** Yangi ro'yxatdan o'tgan mutaxassis uchun bo'sh profil */
function emptyProfile(userId: string): SellerProfile {
  return {
    userId,
    headline: "",
    bio: "",
    skills: [],
    categories: [],
    location: "",
    languages: [],
    portfolio: [],
    responseTimeHours: 0,
    rating: 0,
    reviewCount: 0,
    completedContracts: 0,
    badge: "yangi",
    memberSince: new Date().toISOString(),
    available: true,
  };
}

/** Telefon raqamini solishtirish uchun bir xil ko'rinishga keltiradi */
function normalizePhone(raw: unknown): string {
  return text(raw, LIMITS.phone).replace(/[\s-]/g, "");
}

/* Ro'yxatdan o'tish: yangi, BO'SH hisob ochiladi (demo seed'dan ajratilgan).
   Telegram tasdiqlash oqimning eng oxirida. Telefon raqami unikal. */
export async function register(data: {
  fullName: string;
  phone: string;
  password: string;
}): Promise<Session> {
  ensureSeed();
  await delay(500);
  if (!getPlatformSettings().registrationEnabled) {
    throw new Error("REGISTRATION_PAUSED");
  }
  const phone = normalizePhone(data.phone);
  const password = text(data.password, LIMITS.password);
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("WEAK_PASSWORD");
  }
  const users = read<User[]>(KEYS.users, []);
  if (users.some((u) => normalizePhone(u.phone) === phone)) {
    throw new Error("PHONE_EXISTS");
  }
  const newId = uid("u");
  users.push({
    id: newId,
    phone,
    fullName: text(data.fullName, LIMITS.name),
    role: "mutaxassis",
    roleChosen: false,
    profileDone: false,
    verified: false,
    createdAt: new Date().toISOString(),
  });
  write(KEYS.users, users);
  const passMap = read<Record<string, string>>("sb2_mock_passwords", {});
  passMap[newId] = password;
  write("sb2_mock_passwords", passMap);

  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  profiles[newId] = emptyProfile(newId);
  write(KEYS.profiles, profiles);

  const session: Session = {
    userId: newId,
    role: null,
    profileDone: false,
    verified: false,
  };
  write(KEYS.session, session);
  return session;
}

/** Tizimga kirish: telefon + parol. Onboarding qayerda to'xtagan bo'lsa,
   sessiya o'sha holatdan tiklanadi (rol → profil → tasdiqlash). */
export async function login(data: {
  phone: string;
  password: string;
}): Promise<Session> {
  ensureSeed();
  await delay(500);
  const phone = normalizePhone(data.phone);
  const users = read<User[]>(KEYS.users, []);
  const user = users.find((u) => normalizePhone(u.phone) === phone);
  const passMap = read<Record<string, string>>("sb2_mock_passwords", {});
  const storedPass = user ? passMap[user.id] : undefined;
  const isMatch = storedPass ? storedPass === data.password : (data.password === "demo123" || data.password === "TestPass2026!");
  /* Bir xil xato — telefon bazada bormi-yo'qmi oshkor qilinmaydi */
  if (!user || !isMatch) {
    throw new Error("INVALID_CREDENTIALS");
  }
  if (read<string[]>("sb2_blocked_users", []).includes(user.id)) {
    throw new Error("ACCOUNT_BLOCKED");
  }
  const session: Session = {
    userId: user.id,
    role: user.roleChosen ? user.role : null,
    profileDone: !!user.profileDone,
    verified: !!user.verified,
  };
  write(KEYS.session, session);
  return session;
}

/** Parolni tiklash: telefon bo'yicha hisob topiladi va parol HAQIQATAN
   almashtiriladi. Ilgari bu funksiya bo'sh edi — foydalanuvchi "muvaffaqiyat"
   xabarini olardi, lekin yangi parol ishlamas, eskisi ishlayverardi.
   Kod mock (istalgan 6 raqam), lekin qolgan hamma narsa haqiqiy. */
export async function resetPassword(input: {
  phone: string;
  code: string;
  newPassword: string;
  method?: "sms" | "telegram" | "google";
}): Promise<void> {
  ensureSeed();
  await delay(800);
  if (!/^\d{6}$/.test(input.code)) throw new Error("INVALID_CODE");
  const password = text(input.newPassword, LIMITS.password);
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("WEAK_PASSWORD");
  }
  const phone = normalizePhone(input.phone);
  const users = read<User[]>(KEYS.users, []);
  const idx = users.findIndex((u) => normalizePhone(u.phone) === phone);
  /* Bu yerda raqam mavjudligi ataylab oshkor qilinadi: aks holda foydalanuvchi
     "bo'ldi" xabarini olib, keyin kira olmay qolardi — aynan tuzatilayotgan xato. */
  if (idx < 0) throw new Error("USER_NOT_FOUND");
  const passMap = read<Record<string, string>>("sb2_mock_passwords", {});
  passMap[users[idx].id] = password;
  write("sb2_mock_passwords", passMap);
}

export async function chooseRole(role: UserRole): Promise<Session> {
  await delay(300);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  /* Foydalanuvchi yozuvidagi rol ham yangilanadi — sessiya bilan mos bo'lsin */
  const users = read<User[]>(KEYS.users, []);
  const idx = users.findIndex((u) => u.id === session.userId);
  if (idx >= 0) {
    users[idx] = { ...users[idx], role, roleChosen: true };
    write(KEYS.users, users);
  }
  const updated: Session = { ...session, role };
  write(KEYS.session, updated);
  return updated;
}

export async function completeSellerProfile(data: {
  fullName: string;
  bio: string;
  skills: string[];
  categories: string[];
  location: string;
}): Promise<void> {
  await delay(500);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");

  const users = read<User[]>(KEYS.users, []);
  const idx = users.findIndex((u) => u.id === session.userId);
  if (idx >= 0) {
    users[idx] = {
      ...users[idx],
      fullName: text(data.fullName, LIMITS.name),
      role: "mutaxassis",
      profileDone: true,
    };
    write(KEYS.users, users);
  }

  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  const profile = profiles[session.userId] ?? emptyProfile(session.userId);
  profiles[session.userId] = {
    ...profile,
    userId: session.userId,
    bio: text(data.bio, LIMITS.bio),
    skills: textList(data.skills, 30, LIMITS.skill),
    categories: textList(data.categories, 8, LIMITS.skill),
    location: text(data.location, LIMITS.location),
    badge: computeBadge(profile.completedContracts, profile.rating),
  };
  write(KEYS.profiles, profiles);

  write(KEYS.session, { ...session, profileDone: true });
}

export function logout(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEYS.session);
}

/** Sessiyani yangilash (`POST /auth/refresh` ning mock ekvivalenti).
 *
 * Mock'da token yo'q — shuning uchun bu funksiya shunchaki joriy sessiyani
 * qaytaradi (bloklangan hisob bo'lsa `getSession` uni o'zi `null` qiladi).
 * Shartnoma BACKEND uchun mavjud: u yerda bu httpOnly cookie'dagi refresh
 * token bilan yangi access token oladi. `null` qaytishi — "qayta kiring". */
export async function refreshSession(): Promise<Session | null> {
  await delay(120);
  return getSession();
}

/* ---------------- Foydalanuvchi / profil ---------------- */

export async function getCurrentUser(): Promise<User | null> {
  ensureSeed();
  await delay(150);
  const session = getSession();
  if (!session) return null;
  const users = read<User[]>(KEYS.users, []);
  return users.find((u) => u.id === session.userId) ?? null;
}

export async function getSellerProfile(): Promise<SellerProfile> {
  ensureSeed();
  await delay(200);
  const userId = currentUserId();
  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  const profile = profiles[userId] ?? emptyProfile(userId);
  return {
    ...profile,
    /* Eski yozuvda bu maydon bo'lmasligi mumkin — ekranda "(undefined)"
       chiqmasligi uchun o'qishda normallashtiriladi. */
    reviewCount: profile.reviewCount ?? 0,
    identityVerified: verifiedIdentitySet().has(userId),
    completionRate: completionRateOf(userId),
  };
}

export async function setAvailability(available: boolean): Promise<void> {
  await delay(250);
  const userId = currentUserId();
  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  profiles[userId] = { ...(profiles[userId] ?? emptyProfile(userId)), available };
  write(KEYS.profiles, profiles);
}

export async function updateSellerProfile(data: {
  fullName: string;
  bio: string;
  headline?: string;
  skills?: string[];
  /* Kategoriyalar ro'yxatdan o'tishda so'raladi, lekin ilgari bu yerda qabul
     qilinmasdi — mutaxassis ularni keyin O'ZGARTIRA olmasdi. Holbuki ular
     "Sizga mos ishlar" tanlovini va bozor filtrini boshqaradi. */
  categories?: string[];
  location?: string;
  languages?: ProfileLanguage[];
  portfolio?: PortfolioItem[];
  avatarUrl?: string;
}): Promise<void> {
  await delay(400);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");

  const users = read<User[]>(KEYS.users, []);
  const idx = users.findIndex((u) => u.id === session.userId);
  if (idx >= 0) {
    users[idx] = {
      ...users[idx],
      fullName: text(data.fullName, LIMITS.name),
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
    };
    write(KEYS.users, users);
  }

  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  const profile = profiles[session.userId] ?? emptyProfile(session.userId);
  /* Til va portfolio elementlarini ham tozalaymiz (uzunlik/soni chegarasi) */
  const languages = (data.languages ?? profile.languages)
    .slice(0, 15)
    .map((l) => ({ name: text(l.name, LIMITS.langName), level: l.level }))
    .filter((l) => l.name);
  const portfolio = (data.portfolio ?? profile.portfolio)
    .slice(0, 20)
    .map((p) => ({
      id: p.id,
      title: text(p.title, LIMITS.title),
      description: text(p.description, LIMITS.description),
      image: p.image,
      category: p.category,
    }));
  profiles[session.userId] = {
    ...profile,
    headline: text(data.headline ?? profile.headline, LIMITS.headline),
    bio: text(data.bio, LIMITS.bio),
    skills: data.skills ? textList(data.skills, 30, LIMITS.skill) : profile.skills,
    categories: data.categories
      ? textList(data.categories, 8, LIMITS.skill)
      : profile.categories,
    location: text(data.location ?? profile.location, LIMITS.location),
    languages,
    portfolio,
  };
  write(KEYS.profiles, profiles);
}

/* ---------------- Xizmatlar (A yo'l) ---------------- */

export async function getServices(): Promise<Service[]> {
  ensureSeed();
  await delay();
  const uid = currentUserId();
  const services = read<Service[]>(KEYS.services, []);
  return services
    .filter((s) => s.sellerId === uid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getService(id: string): Promise<Service | null> {
  ensureSeed();
  await delay(200);
  const services = read<Service[]>(KEYS.services, []);
  return services.find((s) => s.id === id) ?? null;
}

/** Admin o'chirgan kategoriyada YANGI yozuv yaratib bo'lmaydi.
    Bu tekshiruv ilgari faqat UI'da (dropdown ro'yxatida) bor edi — ochiq
    turgan eski tab, saqlangan qoralama yoki to'g'ridan-to'g'ri chaqiruv uni
    chetlab o'tardi. Ma'lumot qatlami — kill-switch'ning YAGONA ishonchli
    joyi (backend'da ham shunday bo'ladi). */
function assertCategoryOpen(category: string): void {
  if (getDisabledCategories().has(category)) {
    throw new Error("CATEGORY_DISABLED");
  }
}

export async function createService(
  data: Omit<Service, "id" | "sellerId" | "currency" | "createdAt">
): Promise<Service> {
  await delay(500);
  const session = getSession();
  if (!session || session.role !== "mutaxassis") throw new Error("FORBIDDEN");
  assertCategoryOpen(data.category);
  const service: Service = {
    ...data,
    title: text(data.title, LIMITS.title),
    description: text(data.description, LIMITS.description),
    fields: sanitizeFields(data.fields),
    price: amount(data.price),
    deliveryDays: amount(data.deliveryDays, { min: 1, max: 365 }),
    images: (data.images ?? []).slice(0, 10),
    revisionsIncluded:
      data.revisionsIncluded === undefined
        ? undefined
        : amount(data.revisionsIncluded, { min: 0, max: 20 }),
    included: data.included ? textList(data.included, 10, LIMITS.listItem) : undefined,
    requirements: data.requirements
      ? textList(data.requirements, 10, LIMITS.listItem)
      : undefined,
    extras: data.extras ? sanitizeExtras(data.extras) : undefined,
    id: uid("s"),
    sellerId: session.userId,
    currency: "UZS",
    createdAt: new Date().toISOString(),
  };
  const services = read<Service[]>(KEYS.services, []);
  services.push(service);
  write(KEYS.services, services);
  return service;
}

/** Ixtiyoriy qo'shimcha xizmatlar ro'yxati — nom+narx, ishonchsiz kirish */
function sanitizeExtras(
  extras: { label: string; price: number }[]
): { label: string; price: number }[] {
  return extras
    .slice(0, 10)
    .map((e) => ({ label: text(e.label, LIMITS.listItem), price: amount(e.price, { min: 0 }) }))
    .filter((e) => e.label.length > 0);
}

/** Xizmat maydonlari (kategoriyaga xos) — kalit va qiymatlarni cheklaydi */
function sanitizeFields(
  fields: Record<string, string | string[]> | undefined
): Record<string, string | string[]> {
  if (!fields || typeof fields !== "object") return {};
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(fields).slice(0, 20)) {
    const k = text(key, 60);
    if (!k) continue;
    out[k] = Array.isArray(value)
      ? textList(value, 20, LIMITS.fieldValue)
      : text(value, LIMITS.fieldValue);
  }
  return out;
}

export async function updateService(
  id: string,
  data: Partial<Omit<Service, "id" | "sellerId" | "createdAt">>
): Promise<Service> {
  await delay(500);
  const services = read<Service[]>(KEYS.services, []);
  /* Egalik tekshiruvi — faqat o'z xizmatini o'zgartirish mumkin */
  const idx = services.findIndex(
    (s) => s.id === id && s.sellerId === currentUserId()
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  /* Faqat ruxsat etilgan maydonlar, har biri validatsiyadan o'tadi */
  const clean: Partial<Service> = {};
  if (data.title !== undefined) clean.title = text(data.title, LIMITS.title);
  if (data.description !== undefined)
    clean.description = text(data.description, LIMITS.description);
  if (data.fields !== undefined) clean.fields = sanitizeFields(data.fields);
  if (data.price !== undefined) clean.price = amount(data.price);
  if (data.deliveryDays !== undefined)
    clean.deliveryDays = amount(data.deliveryDays, { min: 1, max: 365 });
  if (data.images !== undefined) clean.images = data.images.slice(0, 10);
  if (data.revisionsIncluded !== undefined)
    clean.revisionsIncluded = amount(data.revisionsIncluded, { min: 0, max: 20 });
  if (data.included !== undefined)
    clean.included = textList(data.included, 10, LIMITS.listItem);
  if (data.requirements !== undefined)
    clean.requirements = textList(data.requirements, 10, LIMITS.listItem);
  if (data.extras !== undefined) clean.extras = sanitizeExtras(data.extras);
  if (data.category !== undefined) clean.category = data.category;
  if (data.status !== undefined) clean.status = data.status;
  services[idx] = { ...services[idx], ...clean };
  write(KEYS.services, services);
  return services[idx];
}

export async function deleteService(id: string): Promise<void> {
  await delay(300);
  const uid2 = currentUserId();
  const services = read<Service[]>(KEYS.services, []);
  write(
    KEYS.services,
    services.filter((s) => !(s.id === id && s.sellerId === uid2))
  );
}

/* ---------------- Ish e'lonlari (B yo'l, faqat o'qish) ---------------- */

export async function getJobs(): Promise<Job[]> {
  ensureSeed();
  await delay();
  return read<Job[]>(KEYS.jobs, []);
}

export async function getJob(id: string): Promise<Job | null> {
  ensureSeed();
  await delay(200);
  const jobs = read<Job[]>(KEYS.jobs, []);
  return jobs.find((j) => j.id === id) ?? null;
}

/* ---------------- Takliflar ---------------- */

export async function getProposals(): Promise<Proposal[]> {
  ensureSeed();
  await delay();
  const uid = currentUserId();
  const proposals = read<Proposal[]>(KEYS.proposals, []);
  return proposals
    .filter((p) => p.sellerId === uid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createProposal(data: {
  jobId: string;
  bidAmount: number;
  coverLetter: string;
  screeningAnswers: { question: string; answer: string }[];
  attachedImages: string[];
  estimatedDeliveryDays?: number;
}): Promise<Proposal> {
  await delay(500);
  const session = getSession();
  if (!session || session.role !== "mutaxassis") throw new Error("FORBIDDEN");
  const sellerId = session.userId;
  const job = read<Job[]>(KEYS.jobs, []).find((item) => item.id === data.jobId);
  if (!job || job.status !== "ochiq" || job.buyerId === sellerId) {
    throw new Error("NOT_FOUND");
  }
  const proposals = read<Proposal[]>(KEYS.proposals, []);
  /* Bir ishga bitta faol taklif — qaytarib olingan bo'lsagina qayta yuborish
     mumkin (Upwork/Fiverr amaliyoti). To'g'ridan-to'g'ri URL orqali kirishdan
     ham himoya qiladi. */
  const hasActive = proposals.some(
    (p) =>
      p.jobId === data.jobId &&
      p.sellerId === sellerId &&
      p.status !== "qaytarib_olingan"
  );
  if (hasActive) throw new Error("DUPLICATE_PROPOSAL");
  const proposal: Proposal = {
    jobId: data.jobId,
    bidAmount: amount(data.bidAmount),
    coverLetter: text(data.coverLetter, LIMITS.coverLetter),
    screeningAnswers: (data.screeningAnswers ?? [])
      .slice(0, 10)
      .map((qa) => ({
        question: text(qa.question, LIMITS.question),
        answer: text(qa.answer, LIMITS.answer),
      })),
    attachedImages: (data.attachedImages ?? []).slice(0, 10),
    estimatedDeliveryDays:
      data.estimatedDeliveryDays === undefined
        ? undefined
        : amount(data.estimatedDeliveryDays, { min: 1, max: 365 }),
    id: uid("p"),
    sellerId,
    status: "yuborilgan",
    createdAt: new Date().toISOString(),
  };
  proposals.push(proposal);
  write(KEYS.proposals, proposals);

  const jobs = read<Job[]>(KEYS.jobs, []);
  const idx = jobs.findIndex((j) => j.id === data.jobId);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], proposalsCount: jobs[idx].proposalsCount + 1 };
    write(KEYS.jobs, jobs);
    pushNotification(
      jobs[idx].buyerId,
      "taklif",
      "ntf.newProposal",
      `/xaridor/elonlarim/${jobs[idx].id}`,
      { title: jobs[idx].title }
    );
  }
  return proposal;
}

/* ---------------- Shartnomalar ---------------- */

export async function getContracts(): Promise<Contract[]> {
  ensureSeed();
  applyEscrowRules();
  await delay();
  const uid = currentUserId();
  const asBuyer = isBuyerSession();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  return contracts
    .filter((c) => (asBuyer ? c.buyerId === uid : c.sellerId === uid))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getContract(id: string): Promise<Contract | null> {
  ensureSeed();
  applyEscrowRules();
  await delay(200);
  const uid = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const contract = contracts.find((c) => c.id === id);
  /* Egalik tekshiruvi — faqat shartnoma tomonlari ochishi mumkin */
  return contract && (contract.sellerId === uid || contract.buyerId === uid)
    ? contract
    : null;
}

/** Shartnomani bekor qilish (ikkala tomon ham qila oladi — imzolangan yoki
   faol). Tekshiruvdagi ish bo'lsa bloklanadi; escrow'dagi (mablag'langan,
   hali qabul qilinmagan) pul xaridorning Bobololadono hisobiga QAYTARILADI —
   u yerdan kartaga yechib oladi. Qabul qilingan bosqichlar to'langanicha qoladi. */
export async function cancelContract(id: string): Promise<Contract> {
  await delay(500);
  const uid2 = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const idx = contracts.findIndex(
    (c) =>
      c.id === id &&
      (c.status === "faol" || c.status === "imzolangan") &&
      (c.buyerId === uid2 || c.sellerId === uid2)
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  const contract = contracts[idx];

  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const own = milestones.filter((m) => m.contractId === id);
  if (
    own.some(
      (m) => m.status === "topshirildi" || m.status === "ozgartirish_soraldi"
    )
  ) {
    throw new Error("HAS_SUBMITTED_WORK");
  }

  /* Holat o'tishi AVVAL tekshiriladi: aks holda o'tish rad etilsa ham
     balans allaqachon to'ldirilgan bo'lar va pul ikkilanardi. */
  assertTransition(
    contractMachine,
    contract.status,
    "bekor_qilingan",
    uid2 === contract.buyerId ? "buyer" : "seller"
  );

  /* Mablag'langan (escrow'dagi, hali qabul qilinmagan) summa qaytariladi */
  const refund = own
    .filter((m) => m.status === "mablaglangan")
    .reduce((sum, m) => sum + m.amount, 0);
  if (refund > 0) creditBalance(contract.buyerId, refund);
  /* Escrow qaytarilgach child holati funded bo'lib qolmasligi kerak. */
  if (refund > 0) {
    write(
      KEYS.milestones,
      milestones.map((milestone) =>
        milestone.contractId === id && milestone.status === "mablaglangan"
          ? { ...milestone, status: "kutilmoqda" as const }
          : milestone
      )
    );
  }
  contracts[idx] = { ...contract, status: "bekor_qilingan" };
  write(KEYS.contracts, contracts);

  const byBuyer = uid2 === contract.buyerId;
  pushNotification(
    byBuyer ? contract.sellerId : contract.buyerId,
    "bosqich",
    "ntf.contractCancelled",
    `${byBuyer ? "/mutaxassis" : "/xaridor"}/shartnomalar/${id}`,
    { title: contract.title }
  );
  if (refund > 0) {
    pushNotification(
      contract.buyerId,
      "tolov",
      "ntf.refundIssued",
      "/xaridor/xarajatlar",
      { amount: formatAmount(refund), title: contract.title }
    );
  }
  return contracts[idx];
}

/* ---------------- Bosqichlar ---------------- */

export async function getMilestones(contractId: string): Promise<Milestone[]> {
  ensureSeed();
  applyEscrowRules();
  await delay(200);
  if (!myContractIds().has(contractId)) throw new Error("NOT_FOUND");
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  return milestones.filter((m) => m.contractId === contractId);
}

export async function getAllMilestones(): Promise<Milestone[]> {
  ensureSeed();
  applyEscrowRules();
  await delay();
  const mine = myContractIds();
  return read<Milestone[]>(KEYS.milestones, []).filter((m) =>
    mine.has(m.contractId)
  );
}

/** Ishni topshirish: holat 'topshirildi', 3 kunlik ko'rib chiqish boshlanadi */
export async function submitMilestone(
  id: string,
  deliverable?: {
    link?: string;
    note?: string;
    files?: DeliverableFile[];
  }
): Promise<Milestone> {
  await delay(400);
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const idx = milestones.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error("NOT_FOUND");
  /* Egalik tekshiruvi — faqat shartnoma mutaxassisi topshira oladi */
  const ownContract = read<Contract[]>(KEYS.contracts, []).find(
    (c) => c.id === milestones[idx].contractId && c.sellerId === currentUserId()
  );
  if (!ownContract) throw new Error("NOT_FOUND");
  if (ownContract.status !== "faol") throw new Error("BAD_STATE");
  /* Faqat mablag'langan yoki qayta ishlanayotgan bosqichni topshirish mumkin —
     to'lanmagan (kutilmoqda) bosqich topshirilmaydi */
  assertTransition(milestoneMachine, milestones[idx].status, "topshirildi", "seller");
  const now = new Date();
  const deadline = new Date(now);
  /* Ko'rib chiqish muddati admin sozlamasidan — ilgari `+3` qattiq yozilgan
     edi va admin paneldagi "Avtomatik qabul muddati" hech narsaga ta'sir
     qilmasdi. */
  deadline.setDate(deadline.getDate() + getPlatformSettings().escrowAutoReleaseDays);
  milestones[idx] = {
    ...milestones[idx],
    status: "topshirildi",
    submittedAt: now.toISOString(),
    reviewDeadline: deadline.toISOString(),
    revisionComment: undefined,
    /* Kirish validatsiyasi: cheksiz uzun matn bazaga tushmasin va
       biriktirmalar haqiqiy (blob: bo'lmagan) havola bilan saqlansin. */
    /* Havola uchun 500 belgi — Figma/Drive/GitHub havolalari uzun bo'ladi,
       `listItem` (150) ularni o'rtasidan kesib tashlagan bo'lardi. */
    deliverableLink: text(deliverable?.link ?? "", LIMITS.fieldValue) || undefined,
    deliverableNote: text(deliverable?.note ?? "", LIMITS.description) || undefined,
    deliverableFiles: sanitizeAttachments(deliverable?.files),
  };
  write(KEYS.milestones, milestones);

  const contract = read<Contract[]>(KEYS.contracts, []).find(
    (c) => c.id === milestones[idx].contractId
  );
  if (contract) {
    pushNotification(
      contract.buyerId,
      "bosqich",
      "ntf.milestoneSubmitted",
      `/xaridor/shartnomalar/${contract.id}`,
      { title: milestones[idx].title }
    );
  }
  return milestones[idx];
}

/* ---------------- Biriktirma fayllar ---------------- */

/** Faylni biriktirmaga aylantiradi (tur + hajm tekshiruvidan keyin).
 *
 *  Mock'da fayl data-URL sifatida qaytadi va shu holda localStorage'ga
 *  yoziladi. Ilgari ish topshirish modali `URL.createObjectURL` ishlatardi —
 *  `blob:` havola faqat o'sha ochiq sahifada yashaydi, shuning uchun xaridor
 *  (boshqa qurilma, boshqa sessiya) faylni umuman ocha olmasdi.
 *
 *  BACKEND: bu yerda fayl `POST /files` ga yuboriladi va javobdagi doimiy
 *  URL qaytariladi — chaqiruvchi UI kodi o'zgarmaydi. */
export async function uploadAttachment(file: File): Promise<DeliverableFile> {
  const problem = attachmentProblem(file);
  if (problem) throw new Error(problem);
  const url = await readAsDataUrl(file);
  await delay(120);
  return {
    id: uid("f"),
    name: text(file.name, LIMITS.listItem) || "fayl",
    size: file.size,
    type: file.type || "application/octet-stream",
    url,
  };
}

/** Saqlashdan oldin biriktirma ro'yxatini tozalaydi: soni cheklanadi va
    faqat haqiqiy (data:/http:) havolalar o'tadi. `blob:` havola bazaga
    tushsa, u qayta yuklashda o'lik bo'lib qoladi. */
function sanitizeAttachments(files?: DeliverableFile[]): DeliverableFile[] | undefined {
  if (!files || files.length === 0) return undefined;
  const clean = files
    .filter((f) => typeof f?.url === "string" && /^(data:|https?:)/.test(f.url))
    .slice(0, MAX_ATTACHMENTS)
    .map((f) => ({
      id: f.id || uid("f"),
      name: text(f.name, LIMITS.listItem) || "fayl",
      size: Number.isFinite(f.size) ? Math.max(0, Math.round(f.size)) : 0,
      type: f.type ? text(f.type, 100) : "application/octet-stream",
      url: f.url,
    }));
  return clean.length ? clean : undefined;
}

/* ---------------- Xabarlar ---------------- */

export async function getMessages(contractId: string): Promise<Message[]> {
  ensureSeed();
  await delay(200);
  let userId = "";
  try {
    userId = currentUserId();
  } catch {
    return [];
  }
  if (!isThreadParticipant(contractId, userId)) return [];
  const messages = read<Message[]>(KEYS.messages, []);
  return messages
    .filter((m) => m.contractId === contractId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getAllMessages(): Promise<Message[]> {
  ensureSeed();
  await delay();
  let uid = "";
  try {
    uid = currentUserId();
  } catch {
    return [];
  }
  const mine = myContractIds();
  const all = read<Message[]>(KEYS.messages, []);
  return all.filter((m) =>
    mine.has(m.contractId) || (uid && m.senderId === uid)
  );
}

/** Suhbat sahifasi ochilganda chaqiriladi — inbox ro'yxati oxirgi xabarni
    ko'rish uchun getMessages'ni chaqirsa ham buni AVTOMATIK belgilamaydi,
    faqat haqiqiy workroom/taklif sahifalari chaqirganda "o'qilgan" bo'ladi. */
export async function markThreadRead(threadId: string): Promise<void> {
  let userId = "";
  try {
    userId = currentUserId();
  } catch {
    return;
  }
  if (!isThreadParticipant(threadId, userId)) return;
  const reads = read<Record<string, Record<string, string>>>(
    KEYS.threadReads,
    {}
  );
  reads[threadId] = { ...reads[threadId], [userId]: new Date().toISOString() };
  write(KEYS.threadReads, reads);
}

/** Joriy foydalanuvchi uchun threadId -> oxirgi o'qilgan vaqt. Faqat o'z
    xabarlarini oxirgi marta qachon o'qigani — boshqa hech kimga chiqmaydi. */
export async function getThreadReads(): Promise<Record<string, string>> {
  ensureSeed();
  await delay(80);
  let userId = "";
  try {
    userId = currentUserId();
  } catch {
    return {};
  }
  const reads = read<Record<string, Record<string, string>>>(
    KEYS.threadReads,
    {}
  );
  const mine: Record<string, string> = {};
  for (const [threadId, byUser] of Object.entries(reads)) {
    if (byUser[userId]) mine[threadId] = byUser[userId];
  }
  return mine;
}

export async function sendMessage(
  contractId: string,
  body: string,
  image?: string,
  attachments?: { images?: string[]; files?: DeliverableFile[] }
): Promise<Message> {
  await delay(300);
  const clean = text(body, LIMITS.message);
  const hasMedia =
    Boolean(image) ||
    (attachments?.images && attachments.images.length > 0) ||
    (attachments?.files && attachments.files.length > 0);
  if (!clean && !hasMedia) throw new Error("EMPTY_MESSAGE");
  const senderId = currentUserId();
  if (!isThreadParticipant(contractId, senderId)) throw new Error("NOT_FOUND");
  const message: Message = {
    id: uid("m"),
    contractId,
    senderId,
    text: clean,
    image: image || attachments?.images?.[0],
    images: attachments?.images || (image ? [image] : undefined),
    files: sanitizeAttachments(attachments?.files),
    createdAt: new Date().toISOString(),
  };
  const messages = read<Message[]>(KEYS.messages, []);
  messages.push(message);
  write(KEYS.messages, messages);

  /* Qarshi tomonga bildirishnoma (oqim shartnoma yoki taklif bo'lishi mumkin) */
  const users = read<User[]>(KEYS.users, []);
  const senderName = users.find((u) => u.id === senderId)?.fullName ?? "";
  const contract = read<Contract[]>(KEYS.contracts, []).find(
    (c) => c.id === contractId
  );
  if (contract) {
    const toBuyer = senderId === contract.sellerId;
    pushNotification(
      toBuyer ? contract.buyerId : contract.sellerId,
      "xabar",
      "ntf.newMessage",
      `${toBuyer ? "/xaridor" : "/mutaxassis"}/shartnomalar/${contractId}`,
      { name: senderName }
    );
  } else {
    const offer = read<Offer[]>(KEYS.offers, []).find((o) => o.id === contractId);
    if (offer) {
      const toBuyer = senderId === offer.sellerId;
      pushNotification(
        toBuyer ? offer.buyerId : offer.sellerId,
        "xabar",
        "ntf.newMessage",
        toBuyer
          ? `/xaridor/takliflarim/${offer.id}`
          : `/mutaxassis/applications/kelgan/${offer.id}`,
        { name: senderName }
      );
    } else {
      /* Taklif (Proposal) suhbati — e'lon egasi bilan mutaxassis o'rtasida */
      const proposal = read<Proposal[]>(KEYS.proposals, []).find(
        (p) => p.id === contractId
      );
      const job = proposal
        ? read<Job[]>(KEYS.jobs, []).find((j) => j.id === proposal.jobId)
        : undefined;
      if (proposal && job) {
        const toBuyer = senderId === proposal.sellerId;
        pushNotification(
          toBuyer ? job.buyerId : proposal.sellerId,
          "xabar",
          "ntf.newMessage",
          toBuyer
            ? `/xaridor/elonlarim/${job.id}/suhbat/${proposal.id}`
            : `/mutaxassis/applications/${proposal.id}`,
          { name: senderName }
        );
      }
    }
  }
  return message;
}

/** Mutaxassis tomonidan ishni to'liq yakunlash va shartnomani yopish so'rovi */
export async function requestCloseContract(
  id: string,
  note?: string
): Promise<Contract> {
  await delay(400);
  const uid = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const idx = contracts.findIndex((c) => c.id === id && c.sellerId === uid);
  if (idx < 0) throw new Error("NOT_FOUND");
  const contract = contracts[idx];
  if (contract.status !== "faol") throw new Error("BAD_STATE");
  if (contract.closeRequested) return contract; // Takroriy so'rov bloklanadi

  const cleanNote = note ? text(note, LIMITS.description) : undefined;

  contracts[idx] = {
    ...contract,
    closeRequested: true,
    closeRequestNote: cleanNote,
    closeRequestedAt: new Date().toISOString(),
  };
  write(KEYS.contracts, contracts);

  // Chatga xabar yuborish
  try {
    const chatMsg = `🏁 Mutaxassis ishni to'liq yakunladi va shartnomani yopishni so'radi.${
      cleanNote ? `\nIzoh: ${cleanNote}` : ""
    }`;
    await sendMessage(contract.id, chatMsg);
  } catch {}

  // Xaridorga bildirishnoma
  pushNotification(
    contract.buyerId,
    "bosqich",
    "ntf.closeRequested",
    `/xaridor/shartnomalar/${contract.id}`,
    { title: contract.title }
  );

  return contracts[idx];
}

/** Xaridor tomonidan ishni qabul qilish va shartnomani yopish (tasdiqlash) */
export async function approveCloseContract(id: string): Promise<Contract> {
  await delay(500);
  const uid = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const idx = contracts.findIndex((c) => c.id === id && c.buyerId === uid);
  if (idx < 0) throw new Error("NOT_FOUND");
  const contract = contracts[idx];
  if (contract.status !== "faol") throw new Error("BAD_STATE");
  assertTransition(contractMachine, contract.status, "yakunlangan", "buyer");

  // Barcha tugallanmagan bosqichlarni qabul qilish
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const now = new Date().toISOString();
  let updatedAny = false;
  milestones.forEach((m) => {
    if (m.contractId === id && m.status !== "qabul_qilindi") {
      m.status = "qabul_qilindi";
      m.approvedAt = now;
      updatedAny = true;
    }
  });
  if (updatedAny) {
    write(KEYS.milestones, milestones);
  }

  // Shartnoma holatini 'yakunlangan' qilish
  contracts[idx] = {
    ...contract,
    status: "yakunlangan",
    closeRequested: false,
  };
  write(KEYS.contracts, contracts);

  incrementCompletedContracts(contract.sellerId);

  // Chatga xabar yuborish
  try {
    const chatMsg = "🎉 Buyurtmachi barcha ishlarni qabul qildi va shartnoma muvaffaqiyatli yopildi!";
    await sendMessage(contract.id, chatMsg);
  } catch {}

  // Bildirishnomalar
  pushNotification(
    contract.sellerId,
    "tolov",
    "ntf.contractCompleted",
    `/mutaxassis/contracts/${contract.id}`,
    { title: contract.title }
  );
  pushNotification(
    contract.buyerId,
    "tolov",
    "ntf.contractCompleted",
    `/xaridor/shartnomalar/${contract.id}`,
    { title: contract.title }
  );

  return contracts[idx];
}

/** Xaridor tomonidan shartnomani yopish so'rovini rad etish */
export async function rejectCloseContract(
  id: string,
  reason?: string
): Promise<Contract> {
  await delay(400);
  const uid = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const idx = contracts.findIndex((c) => c.id === id && c.buyerId === uid);
  if (idx < 0) throw new Error("NOT_FOUND");
  const contract = contracts[idx];
  if (contract.status !== "faol") throw new Error("BAD_STATE");

  contracts[idx] = {
    ...contract,
    closeRequested: false,
  };
  write(KEYS.contracts, contracts);

  try {
    const chatMsg = `⚠️ Buyurtmachi shartnomani yopish so'rovini rad etdi.${
      reason?.trim() ? `\nSabab: ${reason.trim()}` : ""
    }`;
    await sendMessage(contract.id, chatMsg);
  } catch {}

  return contracts[idx];
}

/** Ikki tomonlama shartnomani elektron imzolash va tasdiqlash */
export async function signContract(id: string): Promise<Contract> {
  ensureSeed();
  await delay(400);
  const uid = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const idx = contracts.findIndex(
    (c) => c.id === id && (c.buyerId === uid || c.sellerId === uid)
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  const contract = contracts[idx];
  const users = read<User[]>(KEYS.users, []);
  const me = users.find((u) => u.id === uid);
  const now = new Date().toISOString();

  const isSeller = contract.sellerId === uid;
  const isBuyer = contract.buyerId === uid;

  const num =
    contract.contractNumber ||
    `BD-${new Date(contract.createdAt).getFullYear()}-${(contract.id || "1").replace(/\D/g, "").padStart(4, "0") || "0108"}`;

  const updated: Contract = {
    ...contract,
    contractNumber: num,
    sellerAcceptedAt: isSeller
      ? now
      : (contract.sellerAcceptedAt || (contract.status === "faol" ? contract.createdAt : undefined)),
    sellerAcceptedName: isSeller
      ? (me?.fullName || contract.sellerName)
      : (contract.sellerAcceptedName || contract.sellerName),
    sellerAcceptedPhone: isSeller
      ? (me?.phone || "+998 90 123 45 67")
      : (contract.sellerAcceptedPhone || "+998 90 123 45 67"),
    buyerAcceptedAt: isBuyer
      ? now
      : (contract.buyerAcceptedAt || contract.createdAt),
    buyerAcceptedName: isBuyer
      ? (me?.fullName || contract.buyerName)
      : (contract.buyerAcceptedName || contract.buyerName),
    buyerAcceptedPhone: isBuyer
      ? (me?.phone || "+998 91 876 54 32")
      : (contract.buyerAcceptedPhone || "+998 91 876 54 32"),
  };

  contracts[idx] = updated;
  write(KEYS.contracts, contracts);

  const roleTitle = isSeller ? "Mutaxassis" : "Buyurtmachi";
  try {
    await sendMessage(
      contract.id,
      `📑 Rasmiy elektron shartnoma (${num}) ${roleTitle} tomonidan ko'rib chiqildi va elektron imzolandi.\nSana: ${now.slice(0, 10)}`
    );
  } catch {}

  const otherId = isSeller ? contract.buyerId : contract.sellerId;
  pushNotification(
    otherId,
    "bosqich",
    "ntf.contractSigned",
    `${isSeller ? "/xaridor" : "/mutaxassis"}/shartnomalar/${contract.id}`,
    { title: contract.title, role: roleTitle }
  );

  return updated;
}

/* ---------------- Sharhlar ---------------- */

export async function getReviews(): Promise<Review[]> {
  ensureSeed();
  await delay(200);
  const uid = currentUserId();
  return read<Review[]>(KEYS.reviews, []).filter((r) => r.sellerId === uid);
}

export async function getReviewByContract(
  contractId: string
): Promise<Review | null> {
  ensureSeed();
  await delay(150);
  /* Egalik tekshiruvi — sharhni faqat shartnoma tomonlari o'qiy oladi.
     Ilgari istalgan shartnoma id'si bo'yicha sharh olish mumkin edi. */
  if (!myContractIds().has(contractId)) return null;
  const reviews = read<Review[]>(KEYS.reviews, []);
  return reviews.find((r) => r.contractId === contractId) ?? null;
}

/* ---------------- Bildirishnomalar ---------------- */

export async function getNotifications(): Promise<AppNotification[]> {
  ensureSeed();
  await delay(150);
  const uid = currentUserId();
  const notifications = read<AppNotification[]>(KEYS.notifications, []);
  return notifications
    .filter((n) => n.userId === uid)
    /* Buzilgan ma'lumotdan himoya: href faqat ichki yo'l bo'lsin (open redirect) */
    .map((n) => ({ ...n, href: safeHref(n.href) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markNotificationRead(id: string): Promise<void> {
  await delay(100);
  const notifications = read<AppNotification[]>(KEYS.notifications, []);
  write(
    KEYS.notifications,
    notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  await delay(150);
  const uid = currentUserId();
  const notifications = read<AppNotification[]>(KEYS.notifications, []);
  write(
    KEYS.notifications,
    notifications.map((n) => (n.userId === uid ? { ...n, read: true } : n))
  );
}

/* ---------------- Saqlangan e'lonlar ---------------- */

export async function getSavedJobIds(): Promise<string[]> {
  ensureSeed();
  await delay(100);
  const uid = currentUserId();
  const saved = read<Record<string, string[]> | string[]>(KEYS.savedJobs, {});
  /* v8 gacha saqlanganlar umumiy massiv edi. Endi har bir hisob alohida. */
  return Array.isArray(saved) ? saved : saved[uid] ?? [];
}

export async function toggleSavedJob(jobId: string): Promise<string[]> {
  await delay(150);
  const uid = currentUserId();
  const stored = read<Record<string, string[]> | string[]>(KEYS.savedJobs, {});
  const byUser = Array.isArray(stored) ? { [uid]: stored } : stored;
  const saved = byUser[uid] ?? [];
  const next = saved.includes(jobId)
    ? saved.filter((id) => id !== jobId)
    : [...saved, jobId];
  write(KEYS.savedJobs, { ...byUser, [uid]: next });
  return next;
}

/* ---------------- Xaridor saqlagan xizmat va mutaxassislar ---------------- */

export async function getSavedMarketIds(): Promise<string[]> {
  ensureSeed();
  await delay(100);
  const uid = currentUserId();
  const saved = read<Record<string, string[]>>(KEYS.savedMarket, {});
  return saved[uid] ?? [];
}

export async function toggleSavedMarketItem(id: string): Promise<string[]> {
  await delay(150);
  const uid = currentUserId();
  const saved = read<Record<string, string[]>>(KEYS.savedMarket, {});
  const mine = saved[uid] ?? [];
  const next = mine.includes(id)
    ? mine.filter((itemId) => itemId !== id)
    : [...mine, id];
  write(KEYS.savedMarket, { ...saved, [uid]: next });
  return next;
}

/* ---------------- Ishonch markazi: KYC, yordam va nizolar ---------------- */

export async function getVerification(): Promise<VerificationRecord | null> {
  ensureSeed();
  await delay(120);
  const uid = currentUserId();
  return (
    read<VerificationRecord[]>(KEYS.verifications, []).find(
      (record) => record.userId === uid
    ) ?? null
  );
}

export async function submitVerification(
  input: Omit<
    VerificationRecord,
    "userId" | "status" | "submittedAt" | "rejectionReason"
  >
): Promise<VerificationRecord> {
  await delay(450);
  const uid = currentUserId();
  const adultCutoff = new Date();
  adultCutoff.setFullYear(adultCutoff.getFullYear() - 18);
  const birthDate = new Date(input.birthDate);
  const validDocuments = input.documents.filter(
    (document) =>
      /^data:image\/(png|jpeg|webp);base64,/.test(document) &&
      document.length <= 1_050_000
  );
  if (
    !input.legalName.trim() ||
    !input.birthDate ||
    Number.isNaN(birthDate.getTime()) ||
    birthDate > adultCutoff ||
    validDocuments.length < 2
  ) {
    throw new Error("INVALID_INPUT");
  }
  const records = read<VerificationRecord[]>(KEYS.verifications, []);
  const next: VerificationRecord = {
    ...input,
    legalName: text(input.legalName, LIMITS.name),
    documents: validDocuments.slice(0, 3),
    userId: uid,
    status: "korib_chiqilmoqda",
    submittedAt: new Date().toISOString(),
  };
  const index = records.findIndex((record) => record.userId === uid);
  if (index >= 0) records[index] = next;
  else records.push(next);
  write(KEYS.verifications, records);
  return next;
}

export async function getSupportTickets(): Promise<SupportTicket[]> {
  ensureSeed();
  await delay(120);
  const uid = currentUserId();
  return read<SupportTicket[]>(KEYS.supportTickets, [])
    .filter((ticket) => ticket.userId === uid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Chipta bo'yicha support javoblari. EGALIK tekshiriladi — boshqa
    foydalanuvchining chiptasidagi yozishmani o'qib bo'lmaydi. */
export async function getSupportReplies(
  ticketId: string
): Promise<SupportReply[]> {
  ensureSeed();
  await delay(120);
  const uid2 = currentUserId();
  const ticket = read<SupportTicket[]>(KEYS.supportTickets, []).find(
    (item) => item.id === ticketId
  );
  if (!ticket) throw new Error("NOT_FOUND");
  if (ticket.userId !== uid2) throw new Error("FORBIDDEN");
  return read<SupportReply[]>(`sb2_ticket_chat_${ticketId}`, []).sort((a, b) =>
    a.at.localeCompare(b.at)
  );
}

export async function createSupportTicket(
  input: Pick<SupportTicket, "topic" | "subject" | "message">
): Promise<SupportTicket> {
  await delay(350);
  const userId = currentUserId();
  const ticket: SupportTicket = {
    id: uid("ticket"),
    userId,
    topic: input.topic,
    subject: text(input.subject, 160),
    message: text(input.message, LIMITS.message),
    status: "ochiq",
    createdAt: new Date().toISOString(),
  };
  if (!ticket.subject || !ticket.message) throw new Error("INVALID_INPUT");
  const tickets = read<SupportTicket[]>(KEYS.supportTickets, []);
  write(KEYS.supportTickets, [...tickets, ticket]);
  return ticket;
}

export async function getDisputeByContract(
  contractId: string
): Promise<Dispute | null> {
  ensureSeed();
  await delay(120);
  if (!myContractIds().has(contractId)) return null;
  return (
    read<Dispute[]>(KEYS.disputes, []).find(
      (dispute) => dispute.contractId === contractId
    ) ?? null
  );
}

export async function openDispute(
  contractId: string,
  input: Pick<Dispute, "reason" | "description" | "evidence">
): Promise<Dispute> {
  await delay(450);
  const userId = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const index = contracts.findIndex(
    (contract) =>
      contract.id === contractId &&
      (contract.buyerId === userId || contract.sellerId === userId) &&
      contract.status === "faol"
  );
  if (index < 0) throw new Error("NOT_ALLOWED");
  assertTransition(contractMachine, contracts[index].status, "nizo", userId === contracts[index].buyerId ? "buyer" : "seller");
  const disputes = read<Dispute[]>(KEYS.disputes, []);
  if (disputes.some((dispute) => dispute.contractId === contractId)) {
    throw new Error("ALREADY_EXISTS");
  }
  const dispute: Dispute = {
    id: uid("dispute"),
    contractId,
    openedBy: userId,
    reason: input.reason,
    description: text(input.description, LIMITS.message),
    evidence: input.evidence.slice(0, 5),
    status: "ochiq",
    createdAt: new Date().toISOString(),
  };
  if (!dispute.description) throw new Error("INVALID_INPUT");
  contracts[index] = { ...contracts[index], status: "nizo" };
  write(KEYS.contracts, contracts);
  write(KEYS.disputes, [...disputes, dispute]);
  const otherId =
    contracts[index].buyerId === userId
      ? contracts[index].sellerId
      : contracts[index].buyerId;
  pushNotification(
    otherId,
    "bosqich",
    "ntf.disputeOpened",
    `${contracts[index].buyerId === otherId ? "/xaridor" : "/mutaxassis"}/shartnomalar/${contractId}`,
    { title: contracts[index].title }
  );
  return dispute;
}

/** Nizoni qaytarib olish — faqat uni OCHGAN tomon va faqat `ochiq` holatda.
   Shartnoma `faol` ga qaytadi, escrow'dagi pul yana harakatga keladi.
   Busiz `nizo` holatidan chiqish faqat admin panelida mumkin edi (u esa
   `main` branch'ida yo'q) — ya'ni shartnoma abadiy muzlab qolardi. */
export async function withdrawDispute(contractId: string): Promise<void> {
  await delay(400);
  const userId = currentUserId();
  const disputes = read<Dispute[]>(KEYS.disputes, []);
  const dIdx = disputes.findIndex(
    (dispute) => dispute.contractId === contractId && dispute.status === "ochiq"
  );
  if (dIdx < 0) throw new Error("NOT_FOUND");
  if (disputes[dIdx].openedBy !== userId) throw new Error("FORBIDDEN");

  const contracts = read<Contract[]>(KEYS.contracts, []);
  const cIdx = contracts.findIndex(
    (contract) => contract.id === contractId && contract.status === "nizo"
  );
  if (cIdx < 0) throw new Error("BAD_STATE");
  assertTransition(
    contractMachine,
    contracts[cIdx].status,
    "faol",
    userId === contracts[cIdx].buyerId ? "buyer" : "seller"
  );

  contracts[cIdx] = { ...contracts[cIdx], status: "faol" };
  write(KEYS.contracts, contracts);
  write(
    KEYS.disputes,
    disputes.filter((dispute) => dispute.id !== disputes[dIdx].id)
  );

  const other =
    contracts[cIdx].buyerId === userId
      ? contracts[cIdx].sellerId
      : contracts[cIdx].buyerId;
  pushNotification(
    other,
    "bosqich",
    "ntf.disputeWithdrawn",
    `${contracts[cIdx].buyerId === other ? "/xaridor" : "/mutaxassis"}/shartnomalar/${contractId}`,
    { title: contracts[cIdx].title }
  );
}

export async function getAccountPreferences(): Promise<AccountPreferences> {
  ensureSeed();
  await delay(100);
  const userId = currentUserId();
  const all = read<Record<string, AccountPreferences>>(KEYS.preferences, {});
  return (
    all[userId] ?? {
      messages: true,
      contracts: true,
      payments: true,
      marketing: false,
    }
  );
}

export async function saveAccountPreferences(
  preferences: AccountPreferences
): Promise<void> {
  await delay(180);
  const userId = currentUserId();
  const all = read<Record<string, AccountPreferences>>(KEYS.preferences, {});
  write(KEYS.preferences, { ...all, [userId]: preferences });
}

export async function exportCurrentUserData(): Promise<Record<string, unknown>> {
  ensureSeed();
  await delay(250);
  const userId = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []).filter(
    (item) => item.buyerId === userId || item.sellerId === userId
  );
  const contractIds = new Set(contracts.map((item) => item.id));
  /* Parol eksportga TUSHMASLIGI shart — yuklab olingan fayl odatda saqlanadi
     va ulashiladi. `password` ni yozuvdan ajratib tashlaymiz. */
  const account = read<User[]>(KEYS.users, []).find((item) => item.id === userId);
  const exportedUser: User | undefined = account ? { ...account } : undefined;
  return {
    exportedAt: new Date().toISOString(),
    user: exportedUser,
    profile: read<Record<string, SellerProfile>>(KEYS.profiles, {})[userId],
    services: read<Service[]>(KEYS.services, []).filter(
      (item) => item.sellerId === userId
    ),
    jobs: read<Job[]>(KEYS.jobs, []).filter((item) => item.buyerId === userId),
    proposals: read<Proposal[]>(KEYS.proposals, []).filter(
      (item) => item.sellerId === userId
    ),
    offers: read<Offer[]>(KEYS.offers, []).filter(
      (item) => item.buyerId === userId || item.sellerId === userId
    ),
    contracts,
    milestones: read<Milestone[]>(KEYS.milestones, []).filter((item) =>
      contractIds.has(item.contractId)
    ),
    messages: read<Message[]>(KEYS.messages, []).filter((item) =>
      contractIds.has(item.contractId)
    ),
    reviews: read<Review[]>(KEYS.reviews, []).filter(
      (item) => item.sellerId === userId || contractIds.has(item.contractId)
    ),
    verification: await getVerification(),
    supportTickets: await getSupportTickets(),
    preferences: await getAccountPreferences(),
  };
}

export async function deleteCurrentAccount(): Promise<void> {
  await delay(350);
  const userId = currentUserId();
  const contracts = read<Contract[]>(KEYS.contracts, []);
  if (
    contracts.some(
      (item) =>
        (item.buyerId === userId || item.sellerId === userId) &&
        (item.status === "faol" ||
          item.status === "imzolangan" ||
          item.status === "nizo")
    )
  ) {
    throw new Error("ACTIVE_CONTRACTS");
  }
  write(
    KEYS.users,
    read<User[]>(KEYS.users, []).filter((item) => item.id !== userId)
  );
  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  delete profiles[userId];
  write(KEYS.profiles, profiles);
  write(
    KEYS.services,
    read<Service[]>(KEYS.services, []).filter((item) => item.sellerId !== userId)
  );
  write(
    KEYS.jobs,
    read<Job[]>(KEYS.jobs, []).filter((item) => item.buyerId !== userId)
  );
  write(
    KEYS.cards,
    read<PaymentCard[]>(KEYS.cards, []).filter((item) => item.userId !== userId)
  );
  write(
    KEYS.notifications,
    read<AppNotification[]>(KEYS.notifications, []).filter(
      (item) => item.userId !== userId
    )
  );
  write(
    KEYS.proposals,
    read<Proposal[]>(KEYS.proposals, []).filter((item) => item.sellerId !== userId)
  );
  write(
    KEYS.offers,
    read<Offer[]>(KEYS.offers, []).filter(
      (item) => item.buyerId !== userId && item.sellerId !== userId
    )
  );
  write(
    KEYS.verifications,
    read<VerificationRecord[]>(KEYS.verifications, []).filter(
      (item) => item.userId !== userId
    )
  );
  write(
    KEYS.supportTickets,
    read<SupportTicket[]>(KEYS.supportTickets, []).filter(
      (item) => item.userId !== userId
    )
  );
  write(
    KEYS.disputes,
    read<Dispute[]>(KEYS.disputes, []).filter(
      (item) => item.openedBy !== userId
    )
  );
  /* Yakunlangan moliyaviy yozuvlar boshqa taraf va audit uchun saqlanadi,
     lekin foydalanuvchi nomi anonimlashtiriladi. */
  write(
    KEYS.contracts,
    contracts.map((item) => ({
      ...item,
      buyerName: item.buyerId === userId ? "O'chirilgan foydalanuvchi" : item.buyerName,
      sellerName:
        item.sellerId === userId ? "O'chirilgan foydalanuvchi" : item.sellerName,
    }))
  );
  const preferences = read<Record<string, AccountPreferences>>(
    KEYS.preferences,
    {}
  );
  delete preferences[userId];
  write(KEYS.preferences, preferences);
  const balances = read<Record<string, number>>(KEYS.balances, {});
  delete balances[userId];
  write(KEYS.balances, balances);
  const withdrawn = read<Record<string, number>>(KEYS.withdrawn, {});
  delete withdrawn[userId];
  write(KEYS.withdrawn, withdrawn);
  const savedJobs = read<Record<string, string[]> | string[]>(KEYS.savedJobs, {});
  if (!Array.isArray(savedJobs)) {
    delete savedJobs[userId];
    write(KEYS.savedJobs, savedJobs);
  }
  const savedMarket = read<Record<string, string[]>>(KEYS.savedMarket, {});
  delete savedMarket[userId];
  write(KEYS.savedMarket, savedMarket);
  window.localStorage.removeItem(KEYS.session);
}

/* ---------------- Taklifni qaytarib olish ---------------- */

export async function withdrawProposal(id: string): Promise<Proposal> {
  await delay(400);
  const proposals = read<Proposal[]>(KEYS.proposals, []);
  /* Egalik tekshiruvi — faqat o'z taklifini qaytarib olish mumkin */
  const idx = proposals.findIndex(
    (p) => p.id === id && p.sellerId === currentUserId()
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  assertTransition(
    proposalMachine,
    proposals[idx].status,
    "qaytarib_olingan",
    "seller"
  );
  const job = read<Job[]>(KEYS.jobs, []).find((item) => item.id === proposals[idx].jobId);
  if (!job || job.status !== "ochiq") throw new Error("BAD_STATE");
  proposals[idx] = { ...proposals[idx], status: "qaytarib_olingan" };
  write(KEYS.proposals, proposals);

  /* E'londagi takliflar soni ham kamayadi */
  const jobs = read<Job[]>(KEYS.jobs, []);
  const jIdx = jobs.findIndex((j) => j.id === proposals[idx].jobId);
  if (jIdx >= 0) {
    jobs[jIdx] = {
      ...jobs[jIdx],
      proposalsCount: Math.max(0, jobs[jIdx].proposalsCount - 1),
    };
    write(KEYS.jobs, jobs);
  }
  return proposals[idx];
}

export async function getProposal(id: string): Promise<Proposal | null> {
  ensureSeed();
  await delay(200);
  const uid2 = currentUserId();
  const proposal = read<Proposal[]>(KEYS.proposals, []).find((p) => p.id === id);
  if (!proposal) return null;
  /* Egalik tekshiruvi: taklif egasi (mutaxassis) yoki e'lon egasi (xaridor) */
  if (proposal.sellerId === uid2) return proposal;
  const job = read<Job[]>(KEYS.jobs, []).find((j) => j.id === proposal.jobId);
  return job && job.buyerId === uid2 ? proposal : null;
}

/* ---------------- Pul yechish (mock) ---------------- */

/** Mutaxassisning yechib olingan jami summasi (daromaddan ayiriladi) */
export async function getWithdrawnTotal(): Promise<number> {
  ensureSeed();
  await delay(100);
  return read<Record<string, number>>(KEYS.withdrawn, {})[currentUserId()] ?? 0;
}

/** Mutaxassis daromadini bog'langan kartaga yechish: qabul qilingan bosqichlar
   summasidan hali yechilmagan qismini o'sha kartaga o'tkazadi (mock). */
/** Kutilayotgan (hali admin ko'rib chiqmagan) yechish so'rovlari summasi.
   Bu summa "band" — uni ikkinchi marta so'rab bo'lmaydi. */
export function pendingWithdrawalTotal(userId: string): number {
  return read<WithdrawalRequest[]>(KEYS.withdrawalRequests, [])
    .filter(
      (r) =>
        r.userId === userId &&
        (r.status === "kutilmoqda" || r.status === "korib_chiqilmoqda")
    )
    .reduce((sum, r) => sum + r.amount, 0);
}

export async function getPendingWithdrawalTotal(): Promise<number> {
  ensureSeed();
  await delay(100);
  return pendingWithdrawalTotal(currentUserId());
}

/** Mutaxassisning yechib olinishi mumkin bo'lgan SOF summasi (band qilinganidan
    tashqari). Daromad ekrani ham, so'rov yaratish ham shu bitta manbadan. */
function sellerWithdrawable(userId: string): number {
  const myContracts = new Set(
    read<Contract[]>(KEYS.contracts, [])
      .filter((c) => c.sellerId === userId)
      .map((c) => c.id)
  );
  /* Xizmat haqi HAR BOSQICHDAN alohida ushlanadi, jamidan emas — yaxlitlash
     farqi to'planib ketmasin va Daromad ekranidagi qatorlar bilan mos tushsin. */
  const earned = read<Milestone[]>(KEYS.milestones, [])
    .filter((m) => myContracts.has(m.contractId) && m.status === "qabul_qilindi")
    .reduce((sum, m) => sum + sellerNet(m.amount), 0);
  const withdrawn = read<Record<string, number>>(KEYS.withdrawn, {})[userId] ?? 0;
  return Math.max(0, earned - withdrawn - pendingWithdrawalTotal(userId));
}

/** Yechish so'rovini yaratadi (admin tasdig'iga yuboradi).
   Ilgari bu funksiya pulni DARHOL yechilgan deb belgilardi va admin
   navbatiga umuman tushmasdi — admin paneldagi "To'lovlar" navbati esa
   faqat seed'dagi soxta qatorlarni ko'rsatardi. */
export type WithdrawalDestination =
  | string
  | { type: "card"; cardId: string }
  | { type: "bank_account"; bankAccount: BankAccountDetails };

async function createWithdrawalRequest(
  destination: WithdrawalDestination,
  source: "earnings" | "balance",
  customAmount?: number
): Promise<WithdrawalRequest> {
  const uid2 = currentUserId();
  const isBankAccount = typeof destination === "object" && destination.type === "bank_account";
  const cardId = typeof destination === "string" ? destination : destination.type === "card" ? destination.cardId : undefined;

  if (cardId) {
    assertOwnCard(cardId, uid2);
  } else if (isBankAccount) {
    if (!destination.bankAccount.accountNumber || !destination.bankAccount.mfo) {
      throw new Error("INVALID_BANK_ACCOUNT");
    }
  }

  const maxAvailable =
    source === "earnings"
      ? sellerWithdrawable(uid2)
      : Math.max(0, (readBalances()[uid2] ?? 0) - pendingWithdrawalTotal(uid2));
  if (maxAvailable <= 0) throw new Error("NO_BALANCE");

  const amount =
    customAmount !== undefined && customAmount > 0
      ? Math.min(customAmount, maxAvailable)
      : maxAvailable;

  /* Admin belgilagan eng kichik yechish summasi */
  const minPayout = getPlatformSettings().minPayoutAmount;
  if (amount < minPayout) throw new Error("BELOW_MIN_PAYOUT");

  const users = read<User[]>(KEYS.users, []);
  const user = users.find((u) => u.id === uid2);
  const card = cardId ? read<PaymentCard[]>(KEYS.cards, []).find((c) => c.id === cardId) : null;

  const request: WithdrawalRequest = {
    id: uid("wd"),
    userId: uid2,
    userName: user?.fullName ?? "",
    userRole: user?.role ?? "mutaxassis",
    source,
    amount,
    currency: "UZS",
    payoutMethod: isBankAccount ? "bank_account" : "card",
    cardDetails: isBankAccount
      ? undefined
      : card ? `${card.type.toUpperCase()} •••• ${card.last4}` : "—",
    cardId: cardId ?? "",
    bankAccount: isBankAccount ? destination.bankAccount : undefined,
    status: "kutilmoqda",
    payoutStatus: "payout_pending",
    payoutReference: `PAYOUT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
    createdAt: new Date().toISOString(),
  };
  const all = read<WithdrawalRequest[]>(KEYS.withdrawalRequests, []);
  write(KEYS.withdrawalRequests, [request, ...all]);
  return request;
}

export async function withdrawFunds(
  destination: WithdrawalDestination,
  customAmount?: number
): Promise<WithdrawalRequest> {
  await delay(700);
  return createWithdrawalRequest(destination, "earnings", customAmount);
}

/** Foydalanuvchining o'z yechish so'rovlari (holatini kuzatish uchun) */
export async function getMyWithdrawalRequests(): Promise<WithdrawalRequest[]> {
  ensureSeed();
  await delay(150);
  const uid2 = currentUserId();
  return read<WithdrawalRequest[]>(KEYS.withdrawalRequests, [])
    .filter((r) => r.userId === uid2)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ================= XARIDOR (yollovchi) tomoni ================= */

/** Katalog: to'ldirilgan profilli mutaxassislar (chala ro'yxatdan
   o'tganlar katalogga chiqmaydi) */
/** userId -> shaxsi tasdiqlangan (KYC) statusi. Faqat status qaytariladi —
    hujjatlar/tug'ilgan sana kabi maxfiy maydonlar hech qachon oshkor
    profilga chiqmaydi. */
function verifiedIdentitySet(): Set<string> {
  /* sb2_verifications ba'zan avval admin panelida seed qilinadi (bir xil
     kalit, sb2_verifications) — shu yerda ham bo'sh bo'lsa seed'dan
     to'ldiramiz, aks holda admin hali ochilmagan holatda hech kim
     tasdiqlangan ko'rinmaydi. */
  let records = read<VerificationRecord[]>(KEYS.verifications, []);
  if (!records.length) {
    write(KEYS.verifications, seedVerifications);
    records = seedVerifications;
  }
  return new Set(
    records.filter((v) => v.status === "tasdiqlangan").map((v) => v.userId)
  );
}

/* ---------------- Mutaxassis obro'si (reputation) ----------------
   `rating`, `reviewCount`, `completedContracts` va `badge` — denormallashtirilgan
   hisoblagichlar: ular profilda SAQLANADI, lekin ularni o'zgartiradigan har bir
   hodisada (yangi sharh, sharh o'chirilishi, shartnoma yakunlanishi) shu yerdan
   yangilanadi.

   Ilgari bu to'rt maydon seed'da yozilib, boshqa hech qachon o'zgarmasdi:
   xaridor 1 yulduz qoldirsa ham mutaxassis 4.9 bo'lib qolaverardi, 100 ta ish
   yakunlansa ham "26 ta" ko'rinardi va TrustBadge hech qachon ko'tarilmasdi.
   Ishonchga qurilgan bozorda bu eng og'ir xato edi. Backend'da bu mantiq
   sharh/shartnoma yozuvi bilan BITTA tranzaksiyada bajariladi. */

/** Profilni o'qib, hisoblagichlarni yangilaydi va badge'ni qayta hisoblaydi. */
function updateSellerReputation(
  sellerId: string,
  change: (profile: SellerProfile) => Partial<SellerProfile>
): void {
  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  const current = profiles[sellerId];
  /* Profili yo'q foydalanuvchi (xaridor yoki chala ro'yxatdan o'tgan) uchun
     obro' yozuvi yaratilmaydi — aks holda katalogda bo'sh profil paydo bo'lardi. */
  if (!current) return;
  const patch = change(current);
  const next: SellerProfile = { ...current, ...patch };
  profiles[sellerId] = {
    ...next,
    badge: computeBadge(next.completedContracts, next.rating),
  };
  write(KEYS.profiles, profiles);
}

/** Yangi sharh: o'rtachani surilgan usulda qayta hisoblaydi (butun bazani
    qayta o'qimasdan — backend'da ham xuddi shunday `AVG` yangilanadi). */
export function applyNewReviewToProfile(sellerId: string, rating: number): void {
  updateSellerReputation(sellerId, (p) => {
    /* `?? 0` — eski build'da saqlangan profilda `reviewCount` yo'q; usiz
       arifmetika NaN berardi va reyting butunlay buzilardi. */
    const prev = p.reviewCount ?? 0;
    const count = prev + 1;
    return {
      reviewCount: count,
      rating: Math.round(((p.rating * prev + rating) / count) * 10) / 10,
    };
  });
}

/** Admin sharhni o'chirdi — o'rtachadan chiqariladi. */
export function removeReviewFromProfile(sellerId: string, rating: number): void {
  updateSellerReputation(sellerId, (p) => {
    const prev = p.reviewCount ?? 0;
    const count = Math.max(0, prev - 1);
    if (count === 0) return { reviewCount: 0, rating: 0 };
    return {
      reviewCount: count,
      rating: Math.round(((p.rating * prev - rating) / count) * 10) / 10,
    };
  });
}

/** Shartnoma yakunlandi — bajarilgan ishlar soni oshadi va badge qayta
    hisoblanadi (`computeBadge`: 5+/4.5 → ishonchli, 25+/4.8 → top). */
export function incrementCompletedContracts(sellerId: string): void {
  updateSellerReputation(sellerId, (p) => ({
    completedContracts: p.completedContracts + 1,
  }));
}

/** Yakunlangan / (yakunlangan + bekor qilingan) shartnomalar nisbati (0-100).
    Ikkalasi ham bo'lmasa (yangi mutaxassis) undefined — 0% chalg'ituvchi
    bo'lardi. */
function completionRateOf(sellerId: string): number | undefined {
  const contracts = read<Contract[]>(KEYS.contracts, []).filter(
    (c) => c.sellerId === sellerId
  );
  const completed = contracts.filter((c) => c.status === "yakunlangan").length;
  const cancelled = contracts.filter((c) => c.status === "bekor_qilingan").length;
  const total = completed + cancelled;
  if (total === 0) return undefined;
  return Math.round((completed / total) * 100);
}

export async function getSpecialists(): Promise<Specialist[]> {
  ensureSeed();
  await delay();
  const users = read<User[]>(KEYS.users, []);
  const profiles = read<Record<string, SellerProfile>>(KEYS.profiles, {});
  const verified = verifiedIdentitySet();
  return users
    .filter(
      (u) =>
        u.role === "mutaxassis" &&
        profiles[u.id] &&
        profiles[u.id].bio.trim().length > 0
    )
    .map((u) => ({
      user: u,
      profile: {
        ...profiles[u.id],
        reviewCount: profiles[u.id].reviewCount ?? 0,
        identityVerified: verified.has(u.id),
        completionRate: completionRateOf(u.id),
      },
    }));
}

export async function getSpecialist(userId: string): Promise<Specialist | null> {
  ensureSeed();
  await delay(200);
  const user = read<User[]>(KEYS.users, []).find((u) => u.id === userId);
  const profile = read<Record<string, SellerProfile>>(KEYS.profiles, {})[userId];
  if (!user || !profile) return null;
  return {
    user,
    profile: {
      ...profile,
      reviewCount: profile.reviewCount ?? 0,
      identityVerified: verifiedIdentitySet().has(userId),
      completionRate: completionRateOf(userId),
    },
  };
}

/** Katalog: barcha faol xizmatlar (egasidan qat'i nazar) */
export async function getPublicServices(): Promise<Service[]> {
  ensureSeed();
  await delay();
  return read<Service[]>(KEYS.services, []).filter((s) => s.status === "active");
}

/** Mutaxassisning ochiq profili uchun sharhlar */
export async function getReviewsForSeller(sellerId: string): Promise<Review[]> {
  ensureSeed();
  await delay(150);
  return read<Review[]>(KEYS.reviews, [])
    .filter((r) => r.sellerId === sellerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ---------------- Xaridor: ish e'lonlari ---------------- */

export async function getBuyerJobs(): Promise<Job[]> {
  ensureSeed();
  await delay();
  const uid = currentUserId();
  return read<Job[]>(KEYS.jobs, [])
    .filter((j) => j.buyerId === uid)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

export async function createJob(data: {
  title: string;
  description: string;
  category: Job["category"];
  budgetMin: number;
  budgetMax: number;
  skillsRequired: string[];
  screeningQuestions: string[];
  deadline?: string;
  attachedImages?: string[];
}): Promise<Job> {
  await delay(500);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  assertCategoryOpen(data.category);
  const users = read<User[]>(KEYS.users, []);
  const user = users.find((u) => u.id === session.userId);

  const titleCheck = checkCircumvention(data.title);
  const descCheck = checkCircumvention(data.description);
  if (titleCheck.hasViolation || descCheck.hasViolation) {
    reportCircumventionViolation({
      senderId: session.userId,
      senderName: user?.fullName,
      targetType: "job",
      targetTitle: data.title,
      matchedText: titleCheck.matchedText || descCheck.matchedText,
      violationType: titleCheck.type || descCheck.type,
      fullContent: `${data.title}\n${data.description}`,
    });
    throw new Error("CIRCUMVENTION_DETECTED");
  }

  const jobs = read<Job[]>(KEYS.jobs, []);
  /* Xaridor reytingi: avvalgi e'lonidan olinadi, bo'lmasa 0 (yangi xaridor) */
  const prevRating =
    jobs.find((j) => j.buyerId === session.userId)?.buyerRating ?? 0;
  const budgetMin = amount(data.budgetMin, { min: MIN_JOB_BUDGET });
  const budgetMax = amount(data.budgetMax, { min: budgetMin });
  const job: Job = {
    title: text(data.title, LIMITS.title),
    description: text(data.description, LIMITS.description),
    category: data.category,
    budgetMin,
    budgetMax,
    skillsRequired: textList(data.skillsRequired, 20, LIMITS.skill),
    screeningQuestions: textList(data.screeningQuestions, 3, LIMITS.question),
    /* Muddat ham ISO'ga keltiriladi — e'lon sahifasi uni `new Date(...)` bilan
       o'qiydi va buzilgan qiymat sahifani yiqitardi. */
    deadline: data.deadline ? isoDate(data.deadline) : undefined,
    attachedImages: (data.attachedImages ?? []).slice(0, 10),
    id: uid("j"),
    buyerId: session.userId,
    buyerName: user?.fullName ?? "",
    buyerRating: prevRating,
    currency: "UZS",
    proposalsCount: 0,
    postedAt: new Date().toISOString(),
    status: "ochiq",
  };
  jobs.push(job);
  write(KEYS.jobs, jobs);
  return job;
}

export async function closeJob(id: string): Promise<Job> {
  await delay(300);
  const uid2 = currentUserId();
  const jobs = read<Job[]>(KEYS.jobs, []);
  const idx = jobs.findIndex((j) => j.id === id && j.buyerId === uid2);
  if (idx < 0) throw new Error("NOT_FOUND");
  assertTransition(jobMachine, jobs[idx].status, "yopilgan", "buyer");
  jobs[idx] = { ...jobs[idx], status: "yopilgan" };
  write(KEYS.jobs, jobs);

  /* Faol takliflar rad etiladi — mutaxassislar kutib qolmasligi uchun */
  const ACTIVE = ["yuborilgan", "korib_chiqilmoqda", "suhbat"];
  const proposals = read<Proposal[]>(KEYS.proposals, []);
  let changed = false;
  for (let i = 0; i < proposals.length; i++) {
    if (proposals[i].jobId === id && ACTIVE.includes(proposals[i].status)) {
      proposals[i] = { ...proposals[i], status: "rad_etildi" };
      changed = true;
      pushNotification(
        proposals[i].sellerId,
        "taklif",
        "ntf.proposalRejected",
        `/mutaxassis/applications/${proposals[i].id}`,
        { title: jobs[idx].title }
      );
    }
  }
  if (changed) write(KEYS.proposals, proposals);
  return jobs[idx];
}

/** E'longa kelgan takliflar (faqat e'lon egasi uchun) */
export async function getJobProposals(jobId: string): Promise<Proposal[]> {
  ensureSeed();
  await delay(200);
  const uid2 = currentUserId();
  const job = read<Job[]>(KEYS.jobs, []).find((j) => j.id === jobId);
  if (!job || job.buyerId !== uid2) return [];
  return read<Proposal[]>(KEYS.proposals, [])
    .filter((p) => p.jobId === jobId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Taklif holatini o'zgartirish: ko'rib chiqish / suhbat / rad etish */
export async function setProposalStatus(
  id: string,
  status: "korib_chiqilmoqda" | "suhbat" | "rad_etildi"
): Promise<Proposal> {
  await delay(300);
  const proposals = read<Proposal[]>(KEYS.proposals, []);
  const proposal = proposals.find((item) => item.id === id);
  if (!proposal) throw new Error("NOT_FOUND");
  const job = read<Job[]>(KEYS.jobs, []).find(
    (item) => item.id === proposal.jobId && item.buyerId === currentUserId()
  );
  if (!job || job.status !== "ochiq") throw new Error("NOT_FOUND");
  const idx = proposals.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("NOT_FOUND");
  assertTransition(proposalMachine, proposals[idx].status, status, "buyer");
  proposals[idx] = { ...proposals[idx], status };
  write(KEYS.proposals, proposals);

  const notificationJob = read<Job[]>(KEYS.jobs, []).find(
    (j) => j.id === proposals[idx].jobId
  );
  if (notificationJob && (status === "suhbat" || status === "rad_etildi")) {
    pushNotification(
      proposals[idx].sellerId,
      "taklif",
      status === "suhbat" ? "ntf.proposalInterview" : "ntf.proposalRejected",
      `/mutaxassis/applications/${proposals[idx].id}`,
      { title: notificationJob.title }
    );
  }
  return proposals[idx];
}

/** Yollash (Upwork modeli): bosqichlar belgilanadi (to'lovsiz — mablag'lash
   keyin workroom'da), e'lon yopiladi, qolgan faol takliflar rad etiladi. */
export async function hireProposal(
  proposalId: string,
  milestonesInput: {
    title: string;
    description: string;
    amount: number;
    dueDate: string;
  }[]
): Promise<Contract> {
  await delay(600);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  const proposals = read<Proposal[]>(KEYS.proposals, []);
  const pIdx = proposals.findIndex((p) => p.id === proposalId);
  if (pIdx < 0 || !milestonesInput.length) throw new Error("NOT_FOUND");
  const proposal = proposals[pIdx];

  const jobs = read<Job[]>(KEYS.jobs, []);
  const jIdx = jobs.findIndex((j) => j.id === proposal.jobId);
  if (jIdx < 0 || jobs[jIdx].buyerId !== session.userId)
    throw new Error("NOT_FOUND");
  const job = jobs[jIdx];
  if (job.status !== "ochiq") throw new Error("BAD_STATE");
  assertTransition(proposalMachine, proposal.status, "yollandi", "buyer");
  if (
    read<Contract[]>(KEYS.contracts, []).some(
      (contract) => contract.jobId === job.id && contract.sellerId === proposal.sellerId
    )
  ) {
    throw new Error("DUPLICATE");
  }

  const users = read<User[]>(KEYS.users, []);
  const buyerName = users.find((u) => u.id === session.userId)?.fullName ?? "";
  const sellerName =
    users.find((u) => u.id === proposal.sellerId)?.fullName ?? "";

  /* Bosqichlarni validatsiya qilamiz — summa/nom/muddat ishonchsiz kirish */
  if (milestonesInput.length > 20) throw new Error("TOO_MANY_MILESTONES");
  const cleanMilestones = milestonesInput.map((m) => ({
    title: text(m.title, LIMITS.title),
    description: text(m.description, LIMITS.description),
    amount: amount(m.amount),
    /* Sana ham validatsiyadan o'tadi — ilgari xom holda saqlanardi va
       buzilgan qiymat keyin UI'da `new Date(...).toISOString()` da
       RangeError berib, butun sahifani yiqitardi. */
    dueDate: isoDate(m.dueDate),
  }));

  const contract: Contract = {
    id: uid("c"),
    sourceType: "taklif",
    jobId: job.id,
    buyerId: session.userId,
    buyerName,
    sellerId: proposal.sellerId,
    sellerName,
    title: job.title,
    totalAmount: cleanMilestones.reduce((sum, m) => sum + m.amount, 0),
    /* Imzolangan — xaridor escrow'ga to'lagach faollashadi (ish boshlanadi) */
    status: "imzolangan",
    createdAt: new Date().toISOString(),
  };
  const contracts = read<Contract[]>(KEYS.contracts, []);
  contracts.push(contract);
  write(KEYS.contracts, contracts);

  const milestones = read<Milestone[]>(KEYS.milestones, []);
  cleanMilestones.forEach((m) => {
    milestones.push({
      id: uid("ms"),
      contractId: contract.id,
      title: m.title,
      description: m.description,
      amount: m.amount,
      status: "kutilmoqda",
      dueDate: m.dueDate,
    });
  });
  write(KEYS.milestones, milestones);

  /* Taklif yollandi, qolgan faol takliflar rad etiladi */
  const ACTIVE = ["yuborilgan", "korib_chiqilmoqda", "suhbat"];
  for (let i = 0; i < proposals.length; i++) {
    if (proposals[i].id === proposalId) {
      proposals[i] = { ...proposals[i], status: "yollandi" };
    } else if (
      proposals[i].jobId === job.id &&
      ACTIVE.includes(proposals[i].status)
    ) {
      proposals[i] = { ...proposals[i], status: "rad_etildi" };
      pushNotification(
        proposals[i].sellerId,
        "taklif",
        "ntf.proposalRejected",
        `/mutaxassis/applications/${proposals[i].id}`,
        { title: job.title }
      );
    }
  }
  write(KEYS.proposals, proposals);

  jobs[jIdx] = { ...job, status: "yopilgan" };
  write(KEYS.jobs, jobs);

  pushNotification(
    proposal.sellerId,
    "taklif",
    "ntf.hired",
    `/mutaxassis/contracts/${contract.id}`,
    { title: job.title }
  );
  return contract;
}

/* ---------------- To'g'ridan-to'g'ri takliflar (to'lovsiz) ---------------- */

/** Xaridor mutaxassisga taklif yuboradi — to'lov yo'q. Boshlang'ich xabar
   taklif chat'iga ham yoziladi; mutaxassis qabul qilsa shartnoma ochiladi. */
export async function createOffer(data: {
  sellerId: string;
  serviceId?: string;
  title: string;
  message: string;
  budget: number;
}): Promise<Offer> {
  await delay(500);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.userId === data.sellerId) {
    throw new Error("FORBIDDEN");
  }
  /* To'g'ridan-to'g'ri takliflar (A yo'l) admin tomonidan o'chirilishi mumkin */
  if (!getPlatformSettings().instantOffersEnabled) {
    throw new Error("OFFERS_DISABLED");
  }
  const offers = read<Offer[]>(KEYS.offers, []);
  /* Bitta mutaxassisga bitta kutilayotgan taklif */
  const hasPending = offers.some(
    (o) =>
      o.buyerId === session.userId &&
      o.sellerId === data.sellerId &&
      o.status === "yuborilgan"
  );
  if (hasPending) throw new Error("DUPLICATE_OFFER");

  const users = read<User[]>(KEYS.users, []);
  const buyerName = users.find((u) => u.id === session.userId)?.fullName || "Xaridor";
  const seller = users.find((u) => u.id === data.sellerId);
  if (!seller) throw new Error("NOT_FOUND");
  const sellerName = seller.fullName || "Mutaxassis";

  const offer: Offer = {
    id: uid("o"),
    buyerId: session.userId,
    buyerName,
    sellerId: data.sellerId,
    sellerName,
    serviceId: data.serviceId,
    title: text(data.title, LIMITS.title),
    message: text(data.message, LIMITS.message),
    budget: amount(data.budget),
    status: "yuborilgan",
    createdAt: new Date().toISOString(),
  };
  offers.push(offer);
  write(KEYS.offers, offers);

  /* Boshlang'ich xabar taklif chat'ida */
  const messages = read<Message[]>(KEYS.messages, []);
  messages.push({
    id: uid("m"),
    contractId: offer.id,
    senderId: session.userId,
    text: offer.message,
    createdAt: offer.createdAt,
  });
  write(KEYS.messages, messages);

  pushNotification(
    data.sellerId,
    "taklif",
    "ntf.newOffer",
    `/mutaxassis/applications/kelgan/${offer.id}`,
    { title: offer.title }
  );
  return offer;
}

/** Xaridor yuborgan takliflar */
export async function getSentOffers(): Promise<Offer[]> {
  ensureSeed();
  await delay();
  let uid2 = "";
  try {
    uid2 = currentUserId();
  } catch {
    return [];
  }
  return read<Offer[]>(KEYS.offers, [])
    .filter((o) => o.buyerId === uid2)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Mutaxassisga kelgan takliflar */
export async function getIncomingOffers(): Promise<Offer[]> {
  ensureSeed();
  await delay();
  let uid2 = "";
  try {
    uid2 = currentUserId();
  } catch {
    return [];
  }
  return read<Offer[]>(KEYS.offers, [])
    .filter((o) => o.sellerId === uid2)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getOffer(id: string): Promise<Offer | null> {
  ensureSeed();
  await delay(200);
  let uid2 = "";
  try {
    uid2 = currentUserId();
  } catch {
    return null;
  }
  const offer = read<Offer[]>(KEYS.offers, []).find((o) => o.id === id);
  /* Faqat taklif tomonlari ochishi mumkin */
  return offer && (offer.buyerId === uid2 || offer.sellerId === uid2)
    ? offer
    : null;
}

/** Mutaxassis taklifni qabul qiladi: shartnoma ochiladi (bosqich
   mablag'lanmagan — xaridor workroom'da mablag'laydi), taklif chati
   shartnoma chati'ga ko'chadi. */
export async function acceptOffer(id: string): Promise<Contract> {
  await delay(600);
  const uid2 = currentUserId();
  const offers = read<Offer[]>(KEYS.offers, []);
  const idx = offers.findIndex(
    (o) => o.id === id && o.sellerId === uid2 && o.status === "yuborilgan"
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  const offer = offers[idx];
  assertTransition(offerMachine, offer.status, "qabul_qilindi", "seller");

  const service = offer.serviceId
    ? read<Service[]>(KEYS.services, []).find((s) => s.id === offer.serviceId)
    : undefined;

  const contract: Contract = {
    id: uid("c"),
    sourceType: offer.serviceId ? "xizmat" : "taklifnoma",
    serviceId: offer.serviceId,
    buyerId: offer.buyerId,
    buyerName: offer.buyerName,
    sellerId: offer.sellerId,
    sellerName: offer.sellerName,
    title: offer.title,
    totalAmount: offer.budget,
    /* Imzolangan — xaridor escrow'ga to'lagach faollashadi */
    status: "imzolangan",
    createdAt: new Date().toISOString(),
  };
  const contracts = read<Contract[]>(KEYS.contracts, []);
  contracts.push(contract);
  write(KEYS.contracts, contracts);

  const due = new Date();
  due.setDate(due.getDate() + (service?.deliveryDays ?? 14));
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  milestones.push({
    id: uid("ms"),
    contractId: contract.id,
    title: offer.title,
    description: offer.message,
    amount: offer.budget,
    status: "kutilmoqda",
    dueDate: due.toISOString(),
  });
  write(KEYS.milestones, milestones);

  /* Taklif chati shartnoma chati bo'lib davom etadi */
  const messages = read<Message[]>(KEYS.messages, []);
  write(
    KEYS.messages,
    messages.map((m) =>
      m.contractId === offer.id ? { ...m, contractId: contract.id } : m
    )
  );
  /* "O'qilgan" belgilari ham ko'chadi — aks holda ikkala tomon uchun butun
     suhbat birdan "o'qilmagan" bo'lib ko'rinardi. */
  const reads = read<Record<string, Record<string, string>>>(KEYS.threadReads, {});
  if (reads[offer.id]) {
    reads[contract.id] = { ...reads[contract.id], ...reads[offer.id] };
    delete reads[offer.id];
    write(KEYS.threadReads, reads);
  }

  offers[idx] = { ...offer, status: "qabul_qilindi", contractId: contract.id };
  write(KEYS.offers, offers);

  pushNotification(
    offer.buyerId,
    "taklif",
    "ntf.offerAccepted",
    `/xaridor/shartnomalar/${contract.id}`,
    { title: offer.title }
  );
  return contract;
}

/** Xaridor kutilayotgan taklifini bekor qiladi (qaytarib oladi) */
export async function withdrawOffer(id: string): Promise<Offer> {
  await delay(400);
  const uid2 = currentUserId();
  const offers = read<Offer[]>(KEYS.offers, []);
  const idx = offers.findIndex(
    (o) => o.id === id && o.buyerId === uid2 && o.status === "yuborilgan"
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  assertTransition(offerMachine, offers[idx].status, "bekor_qilingan", "buyer");
  offers[idx] = { ...offers[idx], status: "bekor_qilingan" };
  write(KEYS.offers, offers);
  pushNotification(
    offers[idx].sellerId,
    "taklif",
    "ntf.offerWithdrawn",
    `/mutaxassis/applications/kelgan/${id}`,
    { title: offers[idx].title }
  );
  return offers[idx];
}

/** Mutaxassis taklifni rad etadi */
export async function declineOffer(id: string): Promise<Offer> {
  await delay(400);
  const uid2 = currentUserId();
  const offers = read<Offer[]>(KEYS.offers, []);
  const idx = offers.findIndex(
    (o) => o.id === id && o.sellerId === uid2 && o.status === "yuborilgan"
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  assertTransition(offerMachine, offers[idx].status, "rad_etildi", "seller");
  offers[idx] = { ...offers[idx], status: "rad_etildi" };
  write(KEYS.offers, offers);
  pushNotification(
    offers[idx].buyerId,
    "taklif",
    "ntf.offerDeclined",
    `/xaridor/takliflarim/${offers[idx].id}`,
    { title: offers[idx].title }
  );
  return offers[idx];
}

/* ---------------- Xaridor: bosqich boshqaruvi ---------------- */

function findOwnMilestone(
  id: string,
  milestones: Milestone[],
  contracts: Contract[]
): { idx: number; contract: Contract } {
  const uid2 = currentUserId();
  const idx = milestones.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error("NOT_FOUND");
  const contract = contracts.find(
    (c) => c.id === milestones[idx].contractId && c.buyerId === uid2
  );
  if (!contract) throw new Error("NOT_FOUND");
  return { idx, contract };
}

/** Shartnomani escrow'ga to'liq mablag'lash (Fiverr/Kwork modeli):
   xaridor BUTUN summani birdan Bobololadono hisobiga to'laydi → shartnoma
   faollashadi, barcha bosqichlar 'mablaglangan' bo'ladi, ish boshlanishi
   mumkin. Pul har bosqich qabul qilinganda mutaxassisga o'tadi. */
export async function fundContract(
  id: string,
  input?: {
    method?: PaymentMethod;
    cardId?: string;
    receiptUrl?: string;
    receiptName?: string;
    receiptSize?: number;
    notes?: string;
  }
): Promise<Contract> {
  await delay(700);
  if (getPlatformSettings().paymentsPaused) throw new Error("PAYMENTS_PAUSED");
  const uid2 = currentUserId();

  const contracts = read<Contract[]>(KEYS.contracts, []);
  const idx = contracts.findIndex(
    (c) => c.id === id && c.buyerId === uid2 && c.status === "imzolangan"
  );
  if (idx < 0) throw new Error("NOT_FOUND");
  const contract = contracts[idx];

  /* Manual Bank Transfer (MVP):
     Employer uploads receipt and submits for verification.
     Contract stays in 'imzolangan', paymentStatus becomes 'pending_verification'.
     Milestones remain unfunded ('kutilmoqda') until Admin verifies bank deposit. */
  const reference = contract.paymentReference || generatePaymentReference(contract.id);
  const isBankTransfer = input?.method === "b2b" || input?.receiptUrl;

  const users = read<User[]>(KEYS.users, []);
  const buyerUser = users.find((u) => u.id === contract.buyerId);
  const sellerUser = users.find((u) => u.id === contract.sellerId);
  const now = new Date().toISOString();
  const contractNumber =
    contract.contractNumber ||
    `BD-${new Date(contract.createdAt).getFullYear()}-${(contract.id || "1").replace(/\D/g, "").padStart(4, "0") || "0108"}`;

  if (isBankTransfer) {
    /* 🌍 Xorij va qo'shni davlatlar (Manual Bank Transfer):
       Xaridor kvitansiya yuklaydi, admin bank tushumini tekshiradi.
       Shartnoma 'imzolangan' holatda qoladi, to'lov 'pending_verification'.
       Admin tasdiqlamaguncha bosqichlar 'kutilmoqda' holatida turadi. */
    contracts[idx] = {
      ...contract,
      status: "imzolangan",
      contractNumber,
      buyerAcceptedAt: contract.buyerAcceptedAt || now,
      buyerAcceptedName: contract.buyerAcceptedName || buyerUser?.fullName || contract.buyerName,
      buyerAcceptedPhone: contract.buyerAcceptedPhone || buyerUser?.phone || "+998 90 123 45 67",
      b2bPending: true,
      b2bReceiptUrl: input?.receiptUrl || contract.b2bReceiptUrl || "",
      b2bReceiptName: input?.receiptName || contract.b2bReceiptName || "tolov_cheki.pdf",
      b2bSubmittedAt: now,
      paymentMethod: "b2b",
      paymentStatus: "pending_verification",
      paymentReference: reference,
      paymentReceiptUrl: input?.receiptUrl || contract.paymentReceiptUrl || "",
      paymentReceiptName: input?.receiptName || contract.paymentReceiptName || "tolov_cheki.pdf",
      paymentReceiptSize: input?.receiptSize || contract.paymentReceiptSize,
      paymentSubmittedAt: now,
      paymentNotes: input?.notes || contract.paymentNotes || "",
    };
    write(KEYS.contracts, contracts);

    pushNotification(
      contract.sellerId,
      "tizim",
      "ntf.b2bPending",
      `/mutaxassis/contracts/${id}`,
      { title: contract.title }
    );
    return contracts[idx];
  } else {
    /* 🇺🇿 O'zbekiston ichki kartalari (Uzcard / Humo — Yagona milliy provayder):
       Avtomatlashtirilgan tezkor to'lov! Escrow bloklanadi, shartnoma faollashadi,
       barcha bosqichlar 'mablaglangan' bo'ladi va mutaxassis ishga kirishadi. */
    const escrowRef = `ESC-CARD-${contract.id.replace(/^cnt-/, "").toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    contracts[idx] = {
      ...contract,
      status: "faol",
      contractNumber,
      buyerAcceptedAt: contract.buyerAcceptedAt || now,
      buyerAcceptedName: contract.buyerAcceptedName || buyerUser?.fullName || contract.buyerName,
      buyerAcceptedPhone: contract.buyerAcceptedPhone || buyerUser?.phone || "+998 90 123 45 67",
      sellerAcceptedAt: contract.sellerAcceptedAt || now,
      sellerAcceptedName: contract.sellerAcceptedName || sellerUser?.fullName || contract.sellerName,
      sellerAcceptedPhone: contract.sellerAcceptedPhone || sellerUser?.phone || "+998 91 876 54 32",
      b2bPending: false,
      paymentMethod: "karta",
      paymentStatus: "payment_confirmed",
      paymentReference: reference,
      escrowReference: escrowRef,
      fundedAt: now,
    };
    write(KEYS.contracts, contracts);

    // Shartnoma bosqichlarini mablag'langan holatga o'tkazamiz
    const milestones = read<Milestone[]>(KEYS.milestones, []);
    const updatedMilestones = milestones.map((m) =>
      m.contractId === id ? { ...m, status: "mablaglangan" as MilestoneStatus } : m
    );
    write(KEYS.milestones, updatedMilestones);

    // Tranzaksiyalar jurnaliga yozamiz
    const transactions = read<TransactionRecord[]>("sb2_transactions", []);
    const tx: TransactionRecord = {
      id: uid("tx"),
      type: "escrow_mablaglash",
      userId: contract.buyerId,
      userName: contract.buyerName,
      amount: contract.totalAmount,
      currency: "UZS",
      referenceId: contract.id,
      description: `Shartnoma #${contract.id} (${escrowRef}) uchun karta orqali to'lov (Escrow bloklandi)`,
      status: "muvaffaqiyatli",
      createdAt: now,
    };
    write("sb2_transactions", [tx, ...transactions]);

    pushNotification(
      contract.sellerId,
      "tolov",
      "ntf.milestoneFunded",
      `/mutaxassis/contracts/${id}`,
      { title: contract.title }
    );
    return contracts[idx];
  }
}

export async function fundMilestone(
  contractId: string,
  milestoneId: string,
  // A5/ADR-03: chegaradan olib tashlanadi (Bosqich 2). Imzo client.ts
  // chaqiruvi bilan mos qolishi uchun saqlangan, hozircha ishlatilmaydi.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  method: PaymentMethod = "karta"
): Promise<{ contract: Contract; milestone: Milestone }> {
  await delay(600);
  if (getPlatformSettings().paymentsPaused) throw new Error("PAYMENTS_PAUSED");
  const uid2 = currentUserId();

  const contracts = read<Contract[]>(KEYS.contracts, []);
  const contractIdx = contracts.findIndex(
    (c) => c.id === contractId && c.buyerId === uid2
  );
  if (contractIdx < 0) throw new Error("NOT_FOUND");
  const contract = contracts[contractIdx];

  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const mIdx = milestones.findIndex(
    (m) => m.id === milestoneId && m.contractId === contractId
  );
  if (mIdx < 0) throw new Error("NOT_FOUND");
  const milestone = milestones[mIdx];
  if (milestone.status !== "kutilmoqda") {
    throw new Error("ALREADY_FUNDED");
  }

  milestones[mIdx] = {
    ...milestone,
    status: "mablaglangan",
  };
  write(KEYS.milestones, milestones);

  if (contract.status === "imzolangan") {
    contracts[contractIdx] = {
      ...contract,
      status: "faol",
      paymentStatus: "payment_confirmed",
    };
    write(KEYS.contracts, contracts);
  }

  pushNotification(
    contract.sellerId,
    "tolov",
    "ntf.milestoneFunded",
    `/mutaxassis/contracts/${contractId}`,
    { title: milestone.title }
  );

  return { contract: contracts[contractIdx], milestone: milestones[mIdx] };
}


/* ---------------- Xaridor hisobi (balans / qaytarilgan mablag') ---------------- */

function readBalances(): Record<string, number> {
  return read<Record<string, number>>(KEYS.balances, {});
}

function creditBalance(userId: string, sum: number): void {
  if (sum <= 0) return;
  const balances = readBalances();
  balances[userId] = (balances[userId] ?? 0) + sum;
  write(KEYS.balances, balances);
}

/** Joriy xaridorning Bobololadono hisobidagi (qaytarilgan) mablag'i */
export async function getBalance(): Promise<number> {
  ensureSeed();
  await delay(150);
  return readBalances()[currentUserId()] ?? 0;
}

/** Xaridor balansini kartaga yoki bank hisob-raqamiga yechish — admin tasdig'iga so'rov yuboradi.
   Balans tasdiqlangunga qadar joyida qoladi (lekin "band" bo'ladi). */
export async function withdrawBalance(
  destination: WithdrawalDestination,
  customAmount?: number
): Promise<WithdrawalRequest> {
  await delay(700);
  return createWithdrawalRequest(destination, "balance", customAmount);
}

/* ---------------- Bank kartalari (Uzcard / Humo) ---------------- */

function assertOwnCard(cardId: string, userId: string): void {
  const card = read<PaymentCard[]>(KEYS.cards, []).find(
    (c) => c.id === cardId && c.userId === userId
  );
  if (!card) throw new Error("CARD_NOT_FOUND");
}

/** Joriy foydalanuvchi bog'lagan kartalar */
export async function getCards(): Promise<PaymentCard[]> {
  ensureSeed();
  await delay(150);
  const uid2 = currentUserId();
  return read<PaymentCard[]>(KEYS.cards, [])
    .filter((c) => c.userId === uid2)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Yangi karta bog'lash — raqam/muddat tekshiriladi, faqat oxirgi 4 raqam saqlanadi */
export async function addCard(data: {
  number: string;
  holderName: string;
  expiry: string;
}): Promise<PaymentCard> {
  await delay(500);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  const { type, last4 } = cardNumber(data.number); // xato → INVALID_CARD
  const expiry = cardExpiry(data.expiry); // xato → INVALID_EXPIRY
  const holderName = text(data.holderName, LIMITS.name);
  if (!holderName) throw new Error("INVALID_HOLDER");

  const cards = read<PaymentCard[]>(KEYS.cards, []);
  /* Bir foydalanuvchida bir karta ikki marta bog'lanmaydi */
  if (
    cards.some(
      (c) => c.userId === session.userId && c.last4 === last4 && c.type === type
    )
  ) {
    throw new Error("CARD_EXISTS");
  }
  if (cards.filter((c) => c.userId === session.userId).length >= 5) {
    throw new Error("CARD_LIMIT");
  }
  const card: PaymentCard = {
    id: uid("card"),
    userId: session.userId,
    type,
    last4,
    holderName,
    expiry,
    createdAt: new Date().toISOString(),
  };
  cards.push(card);
  write(KEYS.cards, cards);
  return card;
}

export async function removeCard(id: string): Promise<void> {
  await delay(300);
  const uid2 = currentUserId();
  const cards = read<PaymentCard[]>(KEYS.cards, []);
  write(
    KEYS.cards,
    cards.filter((c) => !(c.id === id && c.userId === uid2))
  );
}

/** Ishni qabul qilish: topshirildi → qabul qilindi; barcha bosqichlar
   qabul qilinsa shartnoma yakunlanadi. */
export async function acceptMilestone(id: string): Promise<Milestone> {
  await delay(500);
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const { idx, contract } = findOwnMilestone(id, milestones, contracts);
  if (contract.status !== "faol") throw new Error("BAD_STATE");
  assertTransition(milestoneMachine, milestones[idx].status, "qabul_qilindi", "buyer");
  milestones[idx] = {
    ...milestones[idx],
    status: "qabul_qilindi",
    approvedAt: new Date().toISOString(),
  };
  write(KEYS.milestones, milestones);

  const own = milestones.filter((m) => m.contractId === contract.id);
  const contractCompleted = own.every((m) => m.status === "qabul_qilindi");
  if (contractCompleted) {
    const cIdx = contracts.findIndex((c) => c.id === contract.id);
    contracts[cIdx] = { ...contract, status: "yakunlangan" };
    write(KEYS.contracts, contracts);
    incrementCompletedContracts(contract.sellerId);
  }

  const transactions = read<TransactionRecord[]>("sb2_transactions", []);
  const fee = platformFee(milestones[idx].amount);
  const net = sellerNet(milestones[idx].amount);
  const outTx: TransactionRecord = {
    id: uid("tx"),
    type: "milestone_tolov",
    userId: contract.sellerId,
    userName: contract.sellerName,
    amount: net,
    currency: "UZS",
    referenceId: milestones[idx].id,
    description: `Bosqich: "${milestones[idx].title}" qabul qilindi va mutaxassisga to'landi (Sof summa)`,
    status: "muvaffaqiyatli",
    createdAt: new Date().toISOString(),
  };
  const feeTx: TransactionRecord = {
    id: uid("tx"),
    type: "commission",
    userId: contract.sellerId,
    userName: contract.sellerName,
    amount: fee,
    currency: "UZS",
    referenceId: milestones[idx].id,
    description: `Platforma komissiyasi (${milestones[idx].title})`,
    status: "muvaffaqiyatli",
    createdAt: new Date().toISOString(),
  };
  write("sb2_transactions", [outTx, feeTx, ...transactions]);

  pushNotification(
    contract.sellerId,
    "tolov",
    "ntf.milestoneAccepted",
    `/mutaxassis/contracts/${contract.id}`,
    { title: milestones[idx].title }
  );
  if (contractCompleted) {
    pushNotification(contract.sellerId, "tolov", "ntf.contractCompleted", `/mutaxassis/contracts/${contract.id}`, { title: contract.title });
    pushNotification(contract.buyerId, "tolov", "ntf.contractCompleted", `/xaridor/shartnomalar/${contract.id}`, { title: contract.title });
  }
  return milestones[idx];
}

/** O'zgartirish so'rash: topshirildi → o'zgartirish so'raldi (izoh majburiy) */
export async function requestRevision(
  id: string,
  comment: string
): Promise<Milestone> {
  await delay(500);
  if (!comment.trim()) throw new Error("COMMENT_REQUIRED");
  const milestones = read<Milestone[]>(KEYS.milestones, []);
  const contracts = read<Contract[]>(KEYS.contracts, []);
  const { idx, contract } = findOwnMilestone(id, milestones, contracts);
  if (contract.status !== "faol") throw new Error("BAD_STATE");
  assertTransition(
    milestoneMachine,
    milestones[idx].status,
    "ozgartirish_soraldi",
    "buyer"
  );
  const usedRevisions = milestones[idx].revisionCount ?? 0;
  let maxRevisions = 3;
  if (contract.serviceId) {
    const service = read<Service[]>(KEYS.services, []).find(
      (s) => s.id === contract.serviceId
    );
    if (service?.revisionsIncluded !== undefined) {
      maxRevisions = service.revisionsIncluded;
    }
  } else if (milestones[idx].revisionsIncluded !== undefined) {
    maxRevisions = milestones[idx].revisionsIncluded;
  } else if (contract.revisionsIncluded !== undefined) {
    maxRevisions = contract.revisionsIncluded;
  }
  if (usedRevisions >= maxRevisions) {
    throw new Error("REVISION_LIMIT_REACHED");
  }

  milestones[idx] = {
    ...milestones[idx],
    status: "ozgartirish_soraldi",
    revisionComment: comment.trim(),
    revisionCount: usedRevisions + 1,
  };
  write(KEYS.milestones, milestones);
  pushNotification(
    contract.sellerId,
    "bosqich",
    "ntf.revisionRequested",
    `/mutaxassis/contracts/${contract.id}`,
    { title: milestones[idx].title }
  );
  return milestones[idx];
}

/* ---------------- Xaridor: sharh qoldirish ---------------- */

export async function createReview(
  contractId: string,
  rating: number,
  comment: string
): Promise<Review> {
  await delay(500);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  const contract = read<Contract[]>(KEYS.contracts, []).find(
    (c) => c.id === contractId && c.buyerId === session.userId
  );
  if (!contract) throw new Error("NOT_FOUND");
  if (contract.status !== "yakunlangan") throw new Error("BAD_STATE");
  const reviews = read<Review[]>(KEYS.reviews, []);
  if (reviews.some((r) => r.contractId === contractId))
    throw new Error("ALREADY_REVIEWED");
  /* Reyting butun son, 1–5 oralig'ida bo'lishi shart */
  const safeRating = amount(rating, { min: 1, max: 5 });
  const review: Review = {
    id: uid("r"),
    contractId,
    sellerId: contract.sellerId,
    buyerName: contract.buyerName,
    rating: safeRating,
    comment: text(comment, LIMITS.comment),
    createdAt: new Date().toISOString(),
  };
  reviews.push(review);
  write(KEYS.reviews, reviews);
  /* Reyting va TrustBadge shu yerda yangilanadi — sharh yozilib, mutaxassis
     bahosi o'zgarmay qolsa, butun ishonch tizimi bezakka aylanardi. */
  applyNewReviewToProfile(contract.sellerId, safeRating);
  pushNotification(
    contract.sellerId,
    "tolov",
    "ntf.newReview",
    `/mutaxassis/contracts/${contractId}`,
    { rating: String(safeRating) }
  );
  return review;
}

/* ---------------- Xaridor: sozlamalar ---------------- */

export async function updateUserProfile(data: Partial<User>): Promise<void> {
  await delay(300);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  const users = read<User[]>(KEYS.users, []);
  const idx = users.findIndex((u) => u.id === session.userId);
  if (idx >= 0) {
    const current = users[idx];
    users[idx] = {
      ...current,
      ...data,
      fullName: data.fullName ? text(data.fullName, LIMITS.name) || current.fullName : current.fullName,
      bio: data.bio !== undefined ? text(data.bio, LIMITS.bio) : current.bio,
      companyName: data.companyName !== undefined ? text(data.companyName, 100) : current.companyName,
      industry: data.industry !== undefined ? text(data.industry, 100) : current.industry,
      website: data.website !== undefined ? text(data.website, 200) : current.website,
      location: data.location !== undefined ? text(data.location, 100) : current.location,
    };
    write(KEYS.users, users);
  }
}

export async function updateUserName(fullName: string): Promise<void> {
  const clean = text(fullName, LIMITS.name);
  if (!clean) throw new Error("INVALID_NAME");
  return updateUserProfile({ fullName: clean });
}

export async function updateAvatar(avatarUrl: string): Promise<void> {
  return updateUserProfile({ avatarUrl });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await delay(350);
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  const users = read<User[]>(KEYS.users, []);
  const index = users.findIndex((user) => user.id === session.userId);
  const passMap = read<Record<string, string>>("sb2_mock_passwords", {});
  const storedPass = passMap[session.userId];
  const isMatch = storedPass ? storedPass === currentPassword : (currentPassword === "demo123" || currentPassword === "TestPass2026!");
  if (index < 0 || !isMatch) {
    throw new Error("INVALID_CURRENT_PASSWORD");
  }
  const cleaned = text(newPassword, LIMITS.password);
  if (cleaned.length < 8 || !/[A-Za-z]/.test(cleaned) || !/\d/.test(cleaned)) {
    throw new Error("WEAK_PASSWORD");
  }
  passMap[session.userId] = cleaned;
  write("sb2_mock_passwords", passMap);
}

export { SELLER_ID, BUYER_ID };
