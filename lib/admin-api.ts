"use client";

import type {
  Contract,
  ContractStatus,
  Dispute,
  Job,
  Service,
  SupportTicket,
  User,
  VerificationRecord,
  Milestone,
  Proposal,
  ProposalStatus,
  Review,
} from "@/lib/types";
import {
  assertTransition,
  contractMachine,
  disputeMachine,
  jobMachine,
} from "@/lib/api/state-machines";
import {
  DATA_CHANGED_EVENT,
  pushNotification,
  removeReviewFromProfile,
  incrementCompletedContracts,
} from "@/lib/mock-api";
import { platformFee } from "@/lib/fees";
import { formatAmount } from "@/lib/format";
import { PLATFORM_SETTINGS_KEY } from "@/lib/platform-settings";
import type {
  AdminAccount,
  AdminRole,
  AdminPermission,
  AdminSession,
  AuditEvent,
  WithdrawalRequest,
  TransactionRecord,
  TrustReport,
  UserAppeal,
  CategoryManagementItem,
  PlatformSettingItem,
  InternalNote,
  RefundRecord,
  TicketMessage,
  AdminQueueQuery,
  AdminPage,
} from "@/lib/admin-types";
import {
  seedContracts,
  seedJobs,
  seedServices,
  seedUsers,
  seedMilestones,
  seedProposals,
  seedReviews,
} from "@/lib/mock-api/seed";
import {
  seedVerifications,
  seedDisputes,
  seedSupportTickets,
  seedWithdrawals,
  seedTransactions,
  seedTrustReports,
  seedUserAppeals,
  seedCategories,
  seedPlatformSettings,
  seedInternalNotes,
  seedAuditLog,
} from "@/lib/admin-mock-data";

interface UserModerationInfo {
  status: string;
  reason?: string;
  suspendedAt?: string;
  suspendedUntil?: string;
  deactivatedAt?: string;
  deletedAt?: string;
  resolvedAt?: string;
}

const ADMIN_SESSION = "sb2_admin_session";
const ADMINS = "sb2_admin_accounts";
const AUDIT = "sb2_admin_audit";
const CREDENTIALS = "sb2_admin_credentials";

const allPermissions: AdminPermission[] = [
  "dashboard",
  "users",
  "services",
  "jobs",
  "orders",
  "kyc",
  "disputes",
  "payments",
  "reports",
  "appeals",
  "reviews",
  "support",
  "categories",
  "settings",
  "audit",
  "admins",
];

const seedAdmins: AdminAccount[] = [
  {
    id: "adm-ceo",
    fullName: "Saidkarim — CEO",
    email: "ceo@bobololadono.uz",
    role: "super_admin",
    title: "Chief Executive Officer",
    active: true,
    permissions: allPermissions,
    createdAt: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "adm-ops",
    fullName: "Dilnoza Rahimova",
    email: "admin@bobololadono.uz",
    role: "admin",
    title: "Operations Administrator",
    active: true,
    permissions: [
      "dashboard",
      "users",
      "services",
      "jobs",
      "orders",
      "kyc",
      "disputes",
      "payments",
      "reports",
      "appeals",
      "reviews",
      "support",
      "categories",
      "audit",
    ],
    createdAt: "2026-05-12T09:00:00.000Z",
  },
  {
    id: "adm-super",
    fullName: "Boshqaruvchi Superadmin",
    email: "superadmin@bobololadono.uz",
    role: "super_admin",
    title: "Chief Platform Super Administrator",
    active: true,
    permissions: allPermissions,
    createdAt: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "adm-mod",
    fullName: "Moderator Nazoratchi",
    email: "moderator@bobololadono.uz",
    role: "admin",
    title: "Bosh Kontent va Foydalanuvchilar Moderatori",
    active: true,
    permissions: [
      "dashboard",
      "users",
      "services",
      "jobs",
      "kyc",
      "reports",
      "appeals",
      "reviews",
      "support",
      "categories",
      "audit",
    ],
    createdAt: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "adm-fin",
    fullName: "Moliyaviy Nazoratchi",
    email: "finance@bobololadono.uz",
    role: "admin",
    title: "Moliya va To'lovlar Nazoratchisi",
    active: true,
    permissions: [
      "dashboard",
      "orders",
      "disputes",
      "payments",
      "reports",
      "audit",
    ],
    createdAt: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "adm-super-bobododa",
    fullName: "Boshqaruvchi Superadmin",
    email: "superadmin@bobododa.uz",
    role: "super_admin",
    title: "Chief Platform Super Administrator",
    active: true,
    permissions: allPermissions,
    createdAt: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "adm-mod-bobododa",
    fullName: "Moderator Nazoratchi",
    email: "moderator@bobododa.uz",
    role: "admin",
    title: "Bosh Kontent va Foydalanuvchilar Moderatori",
    active: true,
    permissions: [
      "dashboard",
      "users",
      "services",
      "jobs",
      "kyc",
      "reports",
      "appeals",
      "reviews",
      "support",
      "categories",
      "audit",
    ],
    createdAt: "2026-01-01T09:00:00.000Z",
  },
  {
    id: "adm-fin-bobododa",
    fullName: "Moliyaviy Nazoratchi",
    email: "moliya@bobododa.uz",
    role: "admin",
    title: "Moliya va To'lovlar Nazoratchisi",
    active: true,
    permissions: [
      "dashboard",
      "orders",
      "disputes",
      "payments",
      "reports",
      "audit",
    ],
    createdAt: "2026-01-01T09:00:00.000Z",
  },
];

const memoryStore = new Map<string, string>();

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    const mem = memoryStore.get(key);
    return mem ? (JSON.parse(mem) as T) : fallback;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* Admin yozuvi ilova yozuvi bilan BIR XIL bo'lishi shart — ikkalasi bitta
   localStorage bazasiga yozadi. Ilgari bu yerda na kvota himoyasi, na
   `DATA_CHANGED_EVENT` bor edi: kvota to'lsa admin paneli qulab tushardi,
   admin amali esa ochiq turgan foydalanuvchi ekranini yangilamasdi. */
function write<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    memoryStore.set(key, JSON.stringify(value));
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(
      new CustomEvent(DATA_CHANGED_EVENT, { detail: { key } })
    );
  } catch (err) {
    if (isQuotaError(err)) throw new Error("STORAGE_FULL");
    throw err;
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

/** Taxmin qilib bo'lmaydigan id — `Date.now()` bir millisekundda ikki marta
    chaqirilsa dublikat berardi (ketma-ket yozuvlarda real xavf). */
function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Escrow'da turgan (mablag'langan, lekin hali chiqarilmagan) bosqichlar */
const ESCROWED_STATUSES: Milestone["status"][] = [
  "mablaglangan",
  "topshirildi",
  "ozgartirish_soraldi",
];

/** Seed'ni faqat BIR MARTA yozadi — kalit mavjud bo'lsa (hatto bo'sh massiv
    bo'lsa ham) ustiga yozilmaydi. Aks holda admin tozalagan ro'yxat qayta
    to'lib qolardi. */
function seeded<T>(key: string, seed: T): T {
  if (typeof window === "undefined") return seed;
  const raw = localStorage.getItem(key);
  if (raw !== null) return read<T>(key, seed);
  write(key, seed);
  return seed;
}

function accounts(): AdminAccount[] {
  const value = read<AdminAccount[]>(ADMINS, []);
  if (value.length) return value;
  write(ADMINS, seedAdmins);
  return seedAdmins;
}

function credentials(): Record<string, string> {
  return {};
}

export function getAdminSession(): AdminSession | null {
  const session = read<AdminSession | null>(ADMIN_SESSION, null);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    if (typeof window !== "undefined") localStorage.removeItem(ADMIN_SESSION);
    return null;
  }
  const account = accounts().find((item) => item.id === session.adminId);
  return account?.active ? session : null;
}

export function getCurrentAdmin(): AdminAccount | null {
  if (typeof window !== "undefined") {
    try {
      const rawStaff = localStorage.getItem("bd_staff_account");
      if (rawStaff) {
        const staff = JSON.parse(rawStaff);
        if (staff && staff.id) {
          return {
            id: staff.id,
            fullName: staff.fullName || "Admin",
            email: staff.email || "",
            role: staff.role === "super_admin" ? "super_admin" : "admin",
            title: staff.title || "Admin",
            active: true,
            permissions: (staff.permissions || []).map((p: string) =>
              p === "STAFF" ? "admins" : typeof p === "string" ? p.toLowerCase() : p
            ),
            createdAt: staff.createdAt || new Date().toISOString(),
          };
        }
      }
    } catch {}
  }
  const session = getAdminSession();
  return session
    ? accounts().find((item) => item.id === session.adminId) ?? null
    : null;
}

export async function adminLogin(
  email: string,
  password: string,
  expectedRole?: AdminAccount["role"]
) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  let normalized = email.trim().toLowerCase();
  let account = accounts().find(
    (item) => item.email.toLowerCase() === normalized && item.active
  );
  if (!account) {
    const candidates: string[] = [];
    if (normalized.endsWith("@bobododa.uz")) {
      candidates.push(normalized.replace("@bobododa.uz", "@bobololadono.uz"));
    } else if (normalized.endsWith("@bobololadono.uz")) {
      candidates.push(normalized.replace("@bobololadono.uz", "@bobododa.uz"));
    }
    if (normalized.startsWith("moliya@")) {
      candidates.push(normalized.replace("moliya@", "finance@"));
      candidates.push("finance@bobololadono.uz");
    } else if (normalized.startsWith("finance@")) {
      candidates.push(normalized.replace("finance@", "moliya@"));
      candidates.push("moliya@bobododa.uz");
    }
    for (const c of candidates) {
      account = accounts().find(
        (item) => item.email.toLowerCase() === c.toLowerCase() && item.active
      );
      if (account) {
        normalized = account.email.toLowerCase();
        break;
      }
    }
  }

  const creds = credentials();
  const valid =
    creds[normalized] === password ||
    creds[email.trim().toLowerCase()] === password ||
    creds[email.trim()] === password ||
    (account ? creds[account.email.toLowerCase()] === password : false);

  const roleOk =
    !expectedRole ||
    account?.role === expectedRole ||
    (expectedRole === "admin" &&
      (account?.role === "finance" ||
        account?.role === "super_admin" ||
        account?.role === "operations" ||
        account?.role === "admin"));
  if (!account || !valid || !roleOk) {
    throw new Error("INVALID_CREDENTIALS");
  }
  const session: AdminSession = {
    adminId: account.id,
    role: account.role,
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  };
  write(ADMIN_SESSION, session);
  const next = accounts().map((item) =>
    item.id === account.id
      ? { ...item, lastLoginAt: new Date().toISOString() }
      : item
  );
  write(ADMINS, next);
  addAudit("Tizimga kirdi", account.email, "Admin sessiyasi ochildi");
  return session;
}

export function adminLogout() {
  if (typeof window !== "undefined") localStorage.removeItem(ADMIN_SESSION);
}

export function hasPermission(permission: AdminPermission) {
  return getCurrentAdmin()?.permissions.includes(permission) ?? false;
}

export function getAdminAccounts() {
  return accounts();
}

export function setAdminActive(id: string, active: boolean) {
  const current = requireSuperAdmin();
  if (id === current.id) throw new Error("SELF_LOCK");
  const next = accounts().map((item) =>
    item.id === id ? { ...item, active } : item
  );
  write(ADMINS, next);
  addAudit(
    active ? "Admin faollashtirildi" : "Admin bloklandi",
    id,
    `Admin statusi ${active ? "faol" : "nofaol"} qilindi`
  );
  return next;
}

export function addAdmin(
  input: Pick<AdminAccount, "fullName" | "email" | "title"> & {
    password: string;
    permissions?: AdminPermission[];
  }
) {
  requireSuperAdmin();
  const email = input.email.trim().toLowerCase();
  if (accounts().some((item) => item.email === email))
    throw new Error("DUPLICATE");
  if (
    input.password.length < 8 ||
    !/[A-Z]/.test(input.password) ||
    !/[a-z]/.test(input.password) ||
    !/\d/.test(input.password)
  )
    throw new Error("WEAK_PASSWORD");

  const allowed = (
    input.permissions ?? [
      "dashboard",
      "users",
      "services",
      "jobs",
      "orders",
      "kyc",
      "disputes",
      "payments",
      "support",
    ]
  ).filter((permission) => permission !== "admins");

  const account: AdminAccount = {
    id: `adm-${uid()}`,
    fullName: input.fullName.trim().slice(0, 100),
    email,
    title: input.title.trim().slice(0, 100),
    role: "admin",
    active: true,
    permissions: Array.from(new Set(["dashboard" as const, ...allowed])),
    createdAt: new Date().toISOString(),
  };
  write(ADMINS, [...accounts(), account]);
  write(CREDENTIALS, { ...credentials(), [email]: input.password });
  addAudit("Yangi admin yaratildi", account.email, `Lavozim: ${account.title}`);
  return account;
}

export function updateAdminAccount(
  id: string,
  input: {
    fullName?: string;
    title?: string;
    permissions?: AdminPermission[];
    role?: AdminRole;
    active?: boolean;
  }
) {
  const current = requireSuperAdmin();
  const list = accounts();
  const target = list.find((item) => item.id === id);
  if (!target) throw new Error("NOT_FOUND");
  if (target.id === current.id && input.active === false) {
    throw new Error("SELF_LOCK");
  }

  const allowed = input.permissions
    ? Array.from(
        new Set([
          "dashboard" as const,
          ...input.permissions.filter(
            (p) => p !== "admins" || (input.role || target.role) === "super_admin"
          ),
        ])
      )
    : target.permissions;

  const next = list.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      fullName: input.fullName !== undefined ? input.fullName.trim().slice(0, 100) : item.fullName,
      title: input.title !== undefined ? input.title.trim().slice(0, 100) : item.title,
      role: input.role !== undefined ? input.role : item.role,
      permissions: allowed,
      active: input.active !== undefined ? input.active : item.active,
    };
  });

  write(ADMINS, next);
  addAudit(
    "Admin hisobi tahrirlandi",
    target.email,
    `${target.fullName} (${target.email}) ma'lumotlari va huquqlari yangilandi`
  );
  return next;
}


function requireSuperAdmin() {
  const current = getCurrentAdmin();
  if (!current || current.role !== "super_admin") throw new Error("FORBIDDEN");
  return current;
}

/** Sessiya bor va hisob faol — huquq talab qilmaydigan amallar uchun */
function requireAdmin(): AdminAccount {
  const current = getCurrentAdmin();
  if (!current || !current.active) throw new Error("FORBIDDEN");
  return current;
}

/** Aniq huquqni talab qiladi. Ilgari ba'zi funksiyalar faqat "sessiya bormi"
    ni tekshirar edi — ya'ni `dashboard` huquqli admin ham shikoyat, apellyatsiya
    va kategoriyalarni o'zgartira olardi. */
function requirePermission(permission: AdminPermission): AdminAccount {
  const current = requireAdmin();
  if (!current.permissions.includes(permission)) throw new Error("FORBIDDEN");
  return current;
}

export function addAudit(
  action: string,
  target: string,
  details?: string,
  previousState?: string,
  newState?: string
) {
  const actor = getCurrentAdmin();
  const event: AuditEvent = {
    id: `audit-${uid()}`,
    adminId: actor?.id ?? "system",
    adminName: actor?.fullName ?? "Tizim",
    action,
    target,
    details,
    previousState,
    newState,
    createdAt: new Date().toISOString(),
  };
  write(AUDIT, [event, ...read<AuditEvent[]>(AUDIT, seedAuditLog)].slice(0, 500));
}

export function getAuditEvents(): AuditEvent[] {
  return read<AuditEvent[]>(AUDIT, seedAuditLog);
}

function appData<T>(key: string, fallback: T): T {
  return read<T>(key, fallback);
}

/* ==========================================================================
   MAIN DATA RETRIEVAL (Interconnected)
   ========================================================================== */
/** `getAdminData()` qaytaradigan to'plam.
    Sahifalar `ReturnType<typeof getAdminData>` o'rniga shu nomdan
    foydalanadi — chegara funksiyasi async bo'lgani uchun u yerdagi
    `ReturnType` endi `Promise<...>` beradi. */
export type AdminData = ReturnType<typeof getAdminData>;

export function getAdminData() {
  /* Seed FAQAT bir marta yoziladi. Ilgari `if (!list.length) write(seed)`
     edi — admin oxirgi yozuvni ko'rib chiqib bo'shatsa, ro'yxat keyingi
     yuklashda seed bilan QAYTA to'lardi (ko'rib chiqilgan shikoyatlar,
     yopilgan ticketlar tirilardi). Endi bo'sh ro'yxat ham haqiqiy holat. */
  const withdrawals = seeded<WithdrawalRequest[]>("sb2_withdrawal_requests", seedWithdrawals);
  const transactions = seeded<TransactionRecord[]>("sb2_transactions", seedTransactions);
  const tickets = seeded<SupportTicket[]>("sb2_support_tickets", seedSupportTickets);
  const verifications = seeded<VerificationRecord[]>("sb2_verifications", seedVerifications);
  const disputes = seeded<Dispute[]>("sb2_disputes", seedDisputes);
  const reports = seeded<TrustReport[]>("sb2_trust_reports", seedTrustReports);
  const appeals = seeded<UserAppeal[]>("sb2_user_appeals", seedUserAppeals);
  const storedCategories = seeded<CategoryManagementItem[]>("sb2_admin_categories", seedCategories);
  const settings = seeded<PlatformSettingItem[]>(PLATFORM_SETTINGS_KEY, seedPlatformSettings);
  const notes = seeded<InternalNote[]>("sb2_internal_notes", seedInternalNotes);

  const moderationDetails = read<Record<string, UserModerationInfo>>(
    "sb2_user_moderation_details",
    {}
  );

  const allUsers = appData<User[]>("sb2_users", seedUsers);
  const safeUsers = allUsers.map((u) => ({ ...u }));

  const services = appData<Service[]>("sb2_services", seedServices);
  /* `serviceCount` HISOBLANADI — seed'dagi qattiq raqam ("18 ta xizmat")
     haqiqatga hech qachon mos kelmasdi va admin qaror uchun ishonolmasdi. */
  const categories = storedCategories.map((c) => ({
    ...c,
    serviceCount: services.filter((s) => s.category === c.slug).length,
  }));

  return {
    users: safeUsers as User[],
    services,
    jobs: appData<Job[]>("sb2_jobs", seedJobs),
    contracts: appData<Contract[]>("sb2_contracts", seedContracts),
    milestones: appData<Milestone[]>("sb2_milestones", seedMilestones),
    reviews: appData<Review[]>("sb2_reviews", seedReviews),
    verifications,
    disputes,
    tickets,
    reports,
    appeals,
    categories,
    settings,
    notes,
    blockedUserIds: appData<string[]>("sb2_blocked_users", ["u-block1"]),
    withdrawals,
    transactions,
    moderationDetails,
  };
}

/* ==========================================================================
   USER MODERATION & ENFORCEMENT
   ========================================================================== */
export function suspendUser(
  userId: string,
  reason: string,
  durationDays: number | null
) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("users")) throw new Error("FORBIDDEN");

  const blocked = read<string[]>("sb2_blocked_users", []);
  if (!blocked.includes(userId)) {
    write("sb2_blocked_users", [...blocked, userId]);
  }

  const details = read<Record<string, UserModerationInfo>>(
    "sb2_user_moderation_details",
    {}
  );
  const suspendedUntil = durationDays
    ? new Date(
        Date.now() + durationDays * 24 * 60 * 60 * 1000
      ).toISOString()
    : undefined;
  details[userId] = {
    status: "suspended",
    reason,
    suspendedAt: new Date().toISOString(),
    suspendedUntil,
  };
  write("sb2_user_moderation_details", details);

  addAudit(
    "Foydalanuvchi to'xtatildi (Suspended)",
    userId,
    `Sabab: ${reason}. Muddat: ${durationDays ? `${durationDays} kun` : "Doimiy"}`
  );
}

export function unsuspendUser(userId: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("users")) throw new Error("FORBIDDEN");

  const blocked = read<string[]>("sb2_blocked_users", []);
  write(
    "sb2_blocked_users",
    blocked.filter((id) => id !== userId)
  );

  const details = read<Record<string, UserModerationInfo>>(
    "sb2_user_moderation_details",
    {}
  );
  details[userId] = {
    status: "active",
    resolvedAt: new Date().toISOString(),
  };
  write("sb2_user_moderation_details", details);

  addAudit("Foydalanuvchi tiklandi", userId, "Cheklov bekor qilindi");
}

export function blockUser(userId: string, reason: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("users")) throw new Error("FORBIDDEN");

  const blocked = read<string[]>("sb2_blocked_users", []);
  if (!blocked.includes(userId)) {
    write("sb2_blocked_users", [...blocked, userId]);
  }

  const details = read<Record<string, UserModerationInfo>>(
    "sb2_user_moderation_details",
    {}
  );
  details[userId] = {
    status: "blocked",
    reason,
    suspendedAt: new Date().toISOString(),
  };
  write("sb2_user_moderation_details", details);

  addAudit("Foydalanuvchi to'liq bloklandi", userId, `Sabab: ${reason}`);
}

export function deactivateUser(userId: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("users")) throw new Error("FORBIDDEN");

  const details = read<Record<string, UserModerationInfo>>(
    "sb2_user_moderation_details",
    {}
  );
  details[userId] = {
    status: "deactivated",
    deactivatedAt: new Date().toISOString(),
  };
  write("sb2_user_moderation_details", details);

  const blocked = read<string[]>("sb2_blocked_users", []);
  if (!blocked.includes(userId)) {
    write("sb2_blocked_users", [...blocked, userId]);
  }

  addAudit("Foydalanuvchi hisobi deaktivatsiya qilindi", userId);
}

export function softDeleteUser(userId: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("users")) throw new Error("FORBIDDEN");

  const details = read<Record<string, UserModerationInfo>>(
    "sb2_user_moderation_details",
    {}
  );
  details[userId] = {
    status: "deleted",
    deletedAt: new Date().toISOString(),
  };
  write("sb2_user_moderation_details", details);

  const blocked = read<string[]>("sb2_blocked_users", []);
  if (!blocked.includes(userId)) {
    write("sb2_blocked_users", [...blocked, userId]);
  }

  addAudit("Foydalanuvchi hisobi o'chirildi (soft delete)", userId);
}

/* ==========================================================================
   KYC MODERATION
   ========================================================================== */
export function adminModerateKYC(
  userId: string,
  outcome: "approve" | "reject",
  reason?: string
) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("kyc")) throw new Error("FORBIDDEN");
  if (outcome === "reject" && (!reason || reason.trim().length < 5)) {
    throw new Error("REASON_REQUIRED");
  }

  const records = read<VerificationRecord[]>(
    "sb2_verifications",
    seedVerifications
  );
  const updated = records.map((item) =>
    item.userId === userId
      ? {
          ...item,
          status:
            outcome === "approve"
              ? ("tasdiqlangan" as const)
              : ("rad_etilgan" as const),
          /* Ilgari bu yerda tipda MAVJUD BO'LMAGAN `verifiedAt` yozilardi va
             uni hech kim o'qimasdi. Endi qaror vaqti ikkala natija uchun ham
             yoziladi va KYC ro'yxatida ko'rsatiladi. */
          reviewedAt: new Date().toISOString(),
          rejectionReason: outcome === "reject" ? reason?.trim() : undefined,
        }
      : item
  );
  write("sb2_verifications", updated);

  /* Foydalanuvchi qarordan XABARDOR bo'lishi shart. Ilgari KYC tasdiqlansa
     ham, rad etilsa ham hech qanday bildirishnoma ketmasdi — foydalanuvchi
     natijani faqat tasodifan Ishonch markazini ochganda ko'rardi, holbuki
     rad etilgan hujjatni qayta yuborish undan talab qilinadi. */
  const target = appData<User[]>("sb2_users", seedUsers).find(
    (u) => u.id === userId
  );
  if (target) {
    const href =
      target.role === "mutaxassis"
        ? "/mutaxassis/settings/verifikatsiya"
        : "/xaridor/verifikatsiya";
    if (outcome === "approve") {
      pushNotification(userId, "tizim", "ntf.kycApproved", href);
    } else {
      pushNotification(userId, "tizim", "ntf.kycRejected", href, {
        reason: reason?.trim() ?? "",
      });
    }
  }

  addAudit(
    outcome === "approve" ? "KYC Tasdiqlandi" : "KYC Rad etildi",
    userId,
    outcome === "reject" ? `Rad sababi: ${reason}` : "Hujjatlar qabul qilindi"
  );
}

/* ==========================================================================
   DISPUTE RESOLUTION
   ========================================================================== */
export function forceCloseContract(
  contractId: string,
  outcome: "refund" | "payout" | "split",
  notes: string,
  splitAmount?: number
) {
  const actor = getCurrentAdmin();
  if (
    !actor?.permissions.includes("disputes") &&
    !actor?.permissions.includes("payments")
  ) {
    throw new Error("FORBIDDEN");
  }

  const contracts = read<Contract[]>("sb2_contracts", seedContracts);
  const contractIdx = contracts.findIndex((c) => c.id === contractId);
  if (contractIdx === -1) throw new Error("NOT_FOUND");
  const contract = contracts[contractIdx];

  // A contract can only be force-closed out of an actual, still-open dispute —
  // otherwise this silently no-ops (nothing to resolve) or resolves a
  // contract that was never in arbitration.
  const disputes = read<Dispute[]>("sb2_disputes", seedDisputes);
  const disputeIdx = disputes.findIndex(
    (d) => d.contractId === contractId && d.status !== "hal_qilindi"
  );
  if (disputeIdx === -1) throw new Error("DISPUTE_NOT_FOUND");
  const dispute = disputes[disputeIdx];
  assertTransition(disputeMachine, dispute.status, "hal_qilindi", "admin");

  const nextContractStatus: ContractStatus =
    outcome === "refund" ? "bekor_qilingan" : "yakunlangan";
  assertTransition(contractMachine, contract.status, nextContractStatus, "admin");

  contracts[contractIdx] = { ...contract, status: nextContractStatus };
  write("sb2_contracts", contracts);
  /* Arbitraj mutaxassis foydasiga hal bo'lsa (payout/split), shartnoma
     yakunlangan hisoblanadi va bajarilgan ishlar soniga qo'shiladi —
     oddiy yakunlanish bilan bir xil qoida. */
  if (nextContractStatus === "yakunlangan") {
    incrementCompletedContracts(contract.sellerId);
  }

  disputes[disputeIdx] = {
    ...dispute,
    status: "hal_qilindi",
    resolvedAt: new Date().toISOString(),
    resolution: `Arbitraj qarori (${outcome.toUpperCase()}): ${notes}`,
  };
  write("sb2_disputes", disputes);

  /* ---- Escrow ledgeri ----------------------------------------------------
     Arbitraj FAQAT escrow'da turgan pulni taqsimlay oladi. Allaqachon qabul
     qilingan bosqichlar mutaxassisga CHIQARILGAN — ularni "qaytarish"
     mavjud bo'lmagan pulni yaratardi (`totalAmount` ni qaytarish aynan shu
     xato edi). Hech qachon mablag'lanmagan (`kutilmoqda`) bosqichlarda ham
     pul yo'q — ular hech kimga tegmaydi. */
  const milestones = read<Milestone[]>("sb2_milestones", seedMilestones);
  const own = milestones.filter((m) => m.contractId === contractId);
  const escrowPool = own
    .filter((m) => ESCROWED_STATUSES.includes(m.status))
    .reduce((sum, m) => sum + m.amount, 0);

  /* Xaridorga qaytadigan ulush — escrow'dan oshib keta olmaydi */
  const buyerShare =
    outcome === "refund"
      ? escrowPool
      : outcome === "split"
        ? Math.max(0, Math.min(Math.round(splitAmount ?? 0), escrowPool))
        : 0;
  if (outcome === "split" && buyerShare === 0) throw new Error("INVALID_AMOUNT");

  let remainingShare = buyerShare;
  const updatedMilestones = milestones.map((m) => {
    if (m.contractId !== contractId) return m;
    if (!ESCROWED_STATUSES.includes(m.status)) return m; // chiqarilgan/mablag'lanmagan — tegilmaydi
    if (outcome === "refund") {
      /* Pul escrow'dan chiqdi — bosqich yana "mablag'lanmagan" holatga
         qaytadi (`cancelContract` bilan bir xil konvensiya). */
      return { ...m, status: "kutilmoqda" as const };
    }
    /* payout / split — qolgan qism mutaxassisga chiqariladi */
    let amount = m.amount;
    if (remainingShare > 0) {
      const deduction = Math.min(amount, remainingShare);
      amount -= deduction;
      remainingShare -= deduction;
    }
    return {
      ...m,
      amount,
      status: "qabul_qilindi" as const,
      approvedAt: new Date().toISOString(),
    };
  });
  write("sb2_milestones", updatedMilestones);

  /* Split'da shartnoma qiymati ham kamayadi — aks holda `totalAmount`
     bosqichlar yig'indisiga teng bo'lmay qolardi va ikkala kabinet
     sarlavhada bir summani, bosqichlar ro'yxatida boshqasini ko'rsatardi. */
  if (outcome === "split" && buyerShare > 0) {
    contracts[contractIdx] = {
      ...contracts[contractIdx],
      totalAmount: Math.max(0, contract.totalAmount - buyerShare),
    };
    write("sb2_contracts", contracts);
  }

  if (outcome === "refund" || outcome === "split") {
    const refunds = read<RefundRecord[]>("sb2_refunds", []);
    const newRefund: RefundRecord = {
      id: `ref-${uid()}`,
      contractId: contract.id,
      contractTitle: contract.title,
      buyerId: contract.buyerId,
      buyerName: contract.buyerName,
      specialistId: contract.sellerId,
      specialistName: contract.sellerName,
      totalAmount: contract.totalAmount,
      refundAmount: buyerShare,
      reason: notes,
      status: "completed",
      processedBy: actor.fullName,
      createdAt: new Date().toISOString(),
    };
    write("sb2_refunds", [newRefund, ...refunds]);

    if (buyerShare > 0) {
      const balances = read<Record<string, number>>("sb2_balances", {});
      balances[contract.buyerId] = (balances[contract.buyerId] ?? 0) + buyerShare;
      write("sb2_balances", balances);
    }
  }

  /* Ikkala tomon ham xabardor qilinadi. Arbitraj — shartnomani yopadigan va
     escrow'dagi pulni taqsimlaydigan amal; ilgari u JIMGINA bajarilardi va
     tomonlar shartnomani o'zi ochmaguncha pul qayerga ketganini bilmasdi. */
  pushNotification(
    contract.buyerId,
    "tizim",
    "ntf.disputeResolved",
    `/xaridor/shartnomalar/${contractId}`,
    { title: contract.title, amount: formatAmount(buyerShare) }
  );
  pushNotification(
    contract.sellerId,
    "tizim",
    "ntf.disputeResolved",
    `/mutaxassis/contracts/${contractId}`,
    {
      title: contract.title,
      amount: formatAmount(escrowPool - buyerShare),
    }
  );

  addAudit(
    `Nizo hal qilindi (${outcome})`,
    contractId,
    `Qaror: ${notes}. Escrow: ${escrowPool} UZS · xaridorga ${buyerShare} UZS · mutaxassisga ${escrowPool - buyerShare} UZS`
  );
}

/* ==========================================================================
   SUPPORT HELP DESK
   ========================================================================== */
export function replyToTicket(
  ticketId: string,
  replyText: string,
  newStatus?: SupportTicket["status"]
) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("support")) throw new Error("FORBIDDEN");
  if (replyText.trim().length < 2) throw new Error("REPLY_REQUIRED");

  const tickets = read<SupportTicket[]>(
    "sb2_support_tickets",
    seedSupportTickets
  );
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) throw new Error("NOT_FOUND");

  tickets[idx] = {
    ...tickets[idx],
    status: newStatus ?? "javob_berildi",
  };
  write("sb2_support_tickets", tickets);

  const chatKey = `sb2_ticket_chat_${ticketId}`;
  const conversation = read<TicketMessage[]>(chatKey, []);
  conversation.push({
    sender: actor.fullName,
    text: replyText.trim(),
    at: new Date().toISOString(),
    isAdmin: true,
  });
  write(chatKey, conversation);

  const ticketOwner = appData<User[]>("sb2_users", seedUsers).find(
    (u) => u.id === tickets[idx].userId
  );
  if (ticketOwner) {
    pushNotification(
      ticketOwner.id,
      "xabar",
      "ntf.supportReplied",
      ticketOwner.role === "mutaxassis" ? "/mutaxassis/disputes" : "/yordam-markazi",
      { subject: tickets[idx].subject }
    );
  }

  addAudit("Yordam chiptasiga javob berildi", ticketId, replyText.slice(0, 100));
}

export function closeTicket(ticketId: string, note?: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("support")) throw new Error("FORBIDDEN");

  const tickets = read<SupportTicket[]>(
    "sb2_support_tickets",
    seedSupportTickets
  );
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) throw new Error("NOT_FOUND");

  tickets[idx] = {
    ...tickets[idx],
    status: "yopilgan",
  };
  write("sb2_support_tickets", tickets);

  if (note) {
    addInternalNote(ticketId, "ticket", `Chipta yopildi: ${note}`);
  }

  addAudit("Yordam chiptasi yopildi", ticketId, note ?? "Hal qilindi");
}

/* ==========================================================================
   FINANCIAL & WITHDRAWAL OPERATIONS
   ========================================================================== */
export function approveWithdrawal(requestId: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("payments")) throw new Error("FORBIDDEN");

  const withdrawals = read<WithdrawalRequest[]>(
    "sb2_withdrawal_requests",
    seedWithdrawals
  );
  const reqIndex = withdrawals.findIndex((w) => w.id === requestId);
  if (reqIndex === -1) throw new Error("NOT_FOUND");

  const req = withdrawals[reqIndex];
  if (req.status === "tasdiqlangan" || req.status === "rad_etilgan") {
    /* Ikki marta tasdiqlash pulni ikki marta yechib yuborardi */
    throw new Error("ALREADY_PROCESSED");
  }

  /* PUL HARAKATI — ilgari bu blok umuman yo'q edi: so'rov "tasdiqlangan"
     bo'lar, lekin foydalanuvchining balansi/yechilgan summasi o'zgarmasdi,
     ya'ni bir summani cheksiz marta yechib olish mumkin edi. */
  if (req.source === "earnings") {
    const withdrawn = read<Record<string, number>>("sb2_withdrawn", {});
    withdrawn[req.userId] = (withdrawn[req.userId] ?? 0) + req.amount;
    write("sb2_withdrawn", withdrawn);
  } else {
    const balances = read<Record<string, number>>("sb2_balances", {});
    const next = (balances[req.userId] ?? 0) - req.amount;
    if (next < 0) throw new Error("INSUFFICIENT_BALANCE");
    balances[req.userId] = next;
    write("sb2_balances", balances);
  }

  withdrawals[reqIndex] = {
    ...req,
    status: "tasdiqlangan",
    payoutStatus: "paid",
    processedAt: new Date().toISOString(),
    processedBy: actor.fullName,
  };
  write("sb2_withdrawal_requests", withdrawals);

  pushNotification(
    req.userId,
    "tolov",
    "ntf.withdrawalApproved",
    req.userRole === "mutaxassis" ? "/mutaxassis/billing" : "/xaridor/xarajatlar",
    { amount: formatAmount(req.amount) }
  );

  const transactions = read<TransactionRecord[]>(
    "sb2_transactions",
    seedTransactions
  );
  const tx: TransactionRecord = {
    id: `tx-${uid()}`,
    type: "yechish",
    userId: req.userId,
    userName: req.userName,
    amount: req.amount,
    currency: "UZS",
    referenceId: req.id,
    description:
      req.payoutMethod === "bank_account" && req.bankAccount
        ? `Bank hisob-raqamiga (${req.bankAccount.accountNumber}) to'lov topshirig'i (B2B wire) orqali o'tkazildi`
        : `${req.cardDetails || "Plastik karta"}ga B2C Card Payout orqali mablag' yechib olindi`,
    status: "muvaffaqiyatli",
    createdAt: new Date().toISOString(),
  };
  write("sb2_transactions", [tx, ...transactions]);

  addAudit("Pul yechish tasdiqlandi", req.id, `${req.amount} UZS o'tkazildi`);
}

export function rejectWithdrawal(requestId: string, reason: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("payments")) throw new Error("FORBIDDEN");

  const withdrawals = read<WithdrawalRequest[]>(
    "sb2_withdrawal_requests",
    seedWithdrawals
  );
  const reqIndex = withdrawals.findIndex((w) => w.id === requestId);
  if (reqIndex === -1) throw new Error("NOT_FOUND");

  const req = withdrawals[reqIndex];
  if (req.status === "tasdiqlangan" || req.status === "rad_etilgan") {
    throw new Error("ALREADY_PROCESSED");
  }
  if (!reason || reason.trim().length < 5) throw new Error("REASON_REQUIRED");

  withdrawals[reqIndex] = {
    ...req,
    status: "rad_etilgan",
    payoutStatus: "payout_failed",
    processedAt: new Date().toISOString(),
    processedBy: actor.fullName,
    rejectionReason: reason.trim(),
  };
  write("sb2_withdrawal_requests", withdrawals);
  /* Rad etilganda summa avtomatik "bandlik"dan chiqadi — kutilayotgan
     so'rovlar faqat `kutilmoqda`/`korib_chiqilmoqda` bo'yicha hisoblanadi. */

  pushNotification(
    req.userId,
    "tolov",
    "ntf.withdrawalRejected",
    req.userRole === "mutaxassis" ? "/mutaxassis/billing" : "/xaridor/xarajatlar",
    { reason: reason.trim() }
  );

  addAudit("Pul yechish rad etildi", req.id, `Sabab: ${reason}`);
}

export function reviewWithdrawal(requestId: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("payments")) throw new Error("FORBIDDEN");

  const withdrawals = read<WithdrawalRequest[]>(
    "sb2_withdrawal_requests",
    seedWithdrawals
  );
  const reqIndex = withdrawals.findIndex((w) => w.id === requestId);
  if (reqIndex === -1) throw new Error("NOT_FOUND");

  if (withdrawals[reqIndex].status !== "kutilmoqda") {
    throw new Error("ALREADY_PROCESSED");
  }
  withdrawals[reqIndex] = {
    ...withdrawals[reqIndex],
    status: "korib_chiqilmoqda",
    payoutStatus: "payout_processing",
  };
  write("sb2_withdrawal_requests", withdrawals);

  addAudit("Pul yechish ko'rib chiqishga olindi", requestId, "Status: korib_chiqilmoqda");
}

export function approveB2bPayment(contractId: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("payments")) throw new Error("FORBIDDEN");

  const contracts = read<Contract[]>("sb2_contracts", seedContracts);
  const idx = contracts.findIndex((c) => c.id === contractId);
  if (idx === -1) throw new Error("NOT_FOUND");
  const contract = contracts[idx];
  if (!contract.b2bPending && contract.paymentStatus !== "pending_verification") {
    throw new Error("NOT_PENDING");
  }

  const milestones = read<Milestone[]>("sb2_milestones", seedMilestones);
  const updatedMilestones = milestones.map((m) =>
    m.contractId === contractId && m.status === "kutilmoqda"
      ? { ...m, status: "mablaglangan" as const }
      : m
  );
  write("sb2_milestones", updatedMilestones);

  contracts[idx] = {
    ...contract,
    status: "faol",
    b2bPending: false,
    paymentStatus: "payment_confirmed",
    paymentVerifiedAt: new Date().toISOString(),
    paymentVerifiedBy: actor.fullName,
    fundedAt: new Date().toISOString(),
    escrowReference: `ESC-BANK-${contract.id.toUpperCase()}`,
    paymentMethod: "b2b",
  };
  write("sb2_contracts", contracts);

  const transactions = read<TransactionRecord[]>("sb2_transactions", seedTransactions);
  const tx: TransactionRecord = {
    id: `tx-b2b-${uid()}`,
    type: "escrow_mablaglash",
    userId: contract.buyerId,
    userName: contract.buyerName,
    amount: contract.totalAmount,
    currency: "UZS",
    referenceId: contract.id,
    description: `Shartnoma #${contract.id} (${contract.paymentReference || "BD-PAY"}) uchun bank to'lovi tasdiqlandi (Kapitalbank)`,
    status: "muvaffaqiyatli",
    createdAt: new Date().toISOString(),
  };
  write("sb2_transactions", [tx, ...transactions]);

  pushNotification(
    contract.sellerId,
    "bosqich",
    "ntf.contractFunded",
    `/mutaxassis/contracts/${contractId}`,
    { title: contract.title }
  );
  pushNotification(
    contract.buyerId,
    "tizim",
    "ntf.contractFunded",
    `/xaridor/shartnomalar/${contractId}`,
    { title: contract.title }
  );

  addAudit(
    "Bank to'lovi tasdiqlandi",
    contractId,
    `Shartnoma #${contract.id} (${contract.paymentReference || "BD-PAY"}) bo'yicha ${formatAmount(contract.totalAmount)} UZS bank to'lovi tasdiqlandi va Escrow'ga qabul qilindi. Operator: ${actor.fullName}`
  );

  return contracts[idx];
}

export function rejectB2bPayment(contractId: string, reason: string) {
  const actor = getCurrentAdmin();
  if (!actor?.permissions.includes("payments")) throw new Error("FORBIDDEN");

  const contracts = read<Contract[]>("sb2_contracts", seedContracts);
  const idx = contracts.findIndex((c) => c.id === contractId);
  if (idx === -1) throw new Error("NOT_FOUND");
  const contract = contracts[idx];

  contracts[idx] = {
    ...contract,
    b2bPending: false,
    paymentStatus: "payment_rejected",
    paymentRejectReason: reason.trim() || "To'lov tushumi tasdiqlanmadi",
  };
  write("sb2_contracts", contracts);

  pushNotification(
    contract.buyerId,
    "tizim",
    "ntf.b2bRejected",
    `/xaridor/shartnomalar/${contractId}`,
    { title: contract.title, reason: reason.trim() || "To'lov tushumi tasdiqlanmadi" }
  );

  addAudit(
    "Bank to'lovi rad etildi",
    contractId,
    `Shartnoma #${contract.id} bank to'lovi rad etildi. Sabab: ${reason}. Operator: ${actor.fullName}`
  );

  return contracts[idx];
}

export function reverseTransaction(txId: string, reason: string) {
  const actor = requireSuperAdmin();
  if (!reason.trim()) throw new Error("REASON_REQUIRED");

  const transactions = read<TransactionRecord[]>("sb2_transactions", seedTransactions);
  const targetIdx = transactions.findIndex((t) => t.id === txId);
  if (targetIdx === -1) throw new Error("NOT_FOUND");

  const target = transactions[targetIdx];
  if (target.status === "bekor_qilingan") throw new Error("ALREADY_CANCELLED");

  transactions[targetIdx] = {
    ...target,
    status: "bekor_qilingan",
  };

  const reversalTx: TransactionRecord = {
    id: `tx-rev-${uid()}`,
    type: "refund",
    userId: target.userId,
    userName: target.userName,
    amount: target.amount,
    currency: "UZS",
    referenceId: target.id,
    description: `Tranzaksiya #${target.id} Super Admin (${actor.fullName}) tomonidan bekor qilindi. Sabab: ${reason.trim()}`,
    status: "muvaffaqiyatli",
    createdAt: new Date().toISOString(),
  };

  write("sb2_transactions", [reversalTx, ...transactions]);

  addAudit(
    "Tranzaksiya majburiy bekor qilindi",
    target.id,
    `Foydalanuvchi: ${target.userName} (${target.userId}), Summa: ${formatAmount(target.amount)} UZS. Sabab: ${reason.trim()}`
  );

  return { original: transactions[targetIdx], reversal: reversalTx };
}


export function adminModerate(
  kind: "users" | "kyc" | "disputes" | "support",
  id: string,
  options: { outcome?: "approve" | "reject"; note?: string } = {}
) {
  if (kind === "kyc") {
    adminModerateKYC(id, options.outcome ?? "approve", options.note);
  } else if (kind === "users") {
    if (options.outcome === "reject") {
      blockUser(id, options.note ?? "Admin qarori bilan");
    } else {
      unsuspendUser(id);
    }
  } else if (kind === "disputes") {
    forceCloseContract(id, "refund", options.note ?? "Admin arbitraji");
  } else if (kind === "support") {
    closeTicket(id, options.note);
  }
}

/* ==========================================================================
   TRUST & SAFETY REPORTS
   ========================================================================== */
export function updateTrustReport(
  reportId: string,
  action: "investigating" | "resolved" | "dismissed",
  note: string,
  userAction?: "none" | "warned" | "restricted" | "suspended" | "removed"
) {
  const actor = requirePermission("reports");

  const reports = read<TrustReport[]>("sb2_trust_reports", seedTrustReports);
  const updated = reports.map((r) =>
    r.id === reportId
      ? {
          ...r,
          status: action,
          assignedAdminId: actor.id,
          assignedAdminName: actor.fullName,
          resolutionNote: note,
          actionTaken: userAction ?? r.actionTaken,
          resolvedAt:
            action === "resolved" || action === "dismissed"
              ? new Date().toISOString()
              : r.resolvedAt,
        }
      : r
  );
  write("sb2_trust_reports", updated);

  addAudit(
    `Shikoyat ko'rib chiqildi (${action})`,
    reportId,
    `Qaror: ${note}`
  );
}

/* ==========================================================================
   USER APPEALS
   ========================================================================== */
export function handleUserAppeal(
  appealId: string,
  decision: "accepted" | "rejected",
  note: string
) {
  const actor = requirePermission("appeals");

  const appeals = read<UserAppeal[]>("sb2_user_appeals", seedUserAppeals);
  const appeal = appeals.find((a) => a.id === appealId);
  if (!appeal) throw new Error("NOT_FOUND");

  write(
    "sb2_user_appeals",
    appeals.map((a) =>
      a.id === appealId
        ? {
            ...a,
            status: decision,
            reviewerId: actor.id,
            reviewerName: actor.fullName,
            decisionNote: note,
            resolvedAt: new Date().toISOString(),
          }
        : a
    )
  );

  if (decision === "accepted") {
    unsuspendUser(appeal.userId);
  }

  addAudit(
    `Apellyatsiya ${decision === "accepted" ? "qabul qilindi" : "rad etildi"}`,
    appeal.userId,
    `Izoh: ${note}`
  );
}

/* ==========================================================================
   INTERNAL OPERATOR NOTES
   ========================================================================== */
export function getInternalNotes(targetId: string): InternalNote[] {
  const allNotes = read<InternalNote[]>("sb2_internal_notes", seedInternalNotes);
  return allNotes.filter((n) => n.targetId === targetId);
}

export function addInternalNote(
  targetId: string,
  targetType: InternalNote["targetType"],
  text: string
) {
  /* Ichki izoh operatsion qaror uchun dalil bo'ladi — muallifi soxta
     bo'lishi mumkin emas. Ilgari sessiyasiz ham yozilar va izoh haqiqiy
     admin (adm-ops) nomiga yozib qo'yilardi. */
  const actor = requireAdmin();
  const body = text.trim();
  if (!body) throw new Error("VALIDATION");
  const newNote: InternalNote = {
    id: `note-${uid()}`,
    targetId,
    targetType,
    adminId: actor.id,
    adminName: actor.fullName,
    text: body,
    createdAt: new Date().toISOString(),
  };
  const allNotes = read<InternalNote[]>("sb2_internal_notes", seedInternalNotes);
  write("sb2_internal_notes", [newNote, ...allNotes]);
  return newNote;
}

/* ==========================================================================
   CATEGORIES MANAGEMENT
   ========================================================================== */
/* ==========================================================================
   REVIEW MODERATION
   ========================================================================== */
/** Noo'rin sharhni o'chiradi. Ilgari sahifa `localStorage` ga to'g'ridan-
    to'g'ri yozardi — ruxsat tekshirilmasdi, audit izi qolmasdi va ochiq
    turgan foydalanuvchi ekrani yangilanmasdi. Mutaxassis reytingi sharhlardan
    hisoblanadi, shuning uchun o'chirish bilan u o'zi qayta hisoblanadi. */
export function deleteReview(reviewId: string): Review[] {
  const actor = requirePermission("reviews");
  const reviews = read<Review[]>("sb2_reviews", seedReviews);
  const target = reviews.find((r) => r.id === reviewId);
  if (!target) throw new Error("NOT_FOUND");
  const next = reviews.filter((r) => r.id !== reviewId);
  write("sb2_reviews", next);
  /* Sharh o'chsa mutaxassis reytingi ham qayta hisoblanishi SHART — aks holda
     moderator soxta 1 yulduzli sharhni o'chirgach, u tushirgan reyting
     mutaxassis profilida abadiy qolib ketardi. */
  removeReviewFromProfile(target.sellerId, target.rating);
  addAudit(
    "Sharh o'chirildi",
    reviewId,
    `Shartnoma: ${target.contractId} · Reyting: ${target.rating} · Moderator: ${actor.fullName}`
  );
  return next;
}

/* ==========================================================================
   BOZOR MODERATSIYASI (e'lon va xizmat)

   Bu uchta amal ilgari SAHIFA ichida, `localStorage` ga to'g'ridan-to'g'ri
   yozish bilan bajarilardi (`app/admin/loyihalar`, `app/admin/xizmatlar`).
   Natijada: ruxsat tekshirilmasdi, audit izi qolmasdi (xizmatlarda umuman),
   kvota xatosi ushlanmasdi, `DATA_CHANGED_EVENT` chiqmasdi va — eng muhimi —
   backend ulanganda bu amallar JIMGINA ishlamay qolardi, chunki ular API
   qatlamidan umuman o'tmasdi.
   ========================================================================== */

/** Admin qoidabuzar e'lonni majburiy yopadi. Faol takliflar qoladi —
    ularni avto-rad etish `closeJob` (foydalanuvchi oqimi) ishi. */
export function closeJobAsAdmin(jobId: string, reason: string) {
  const actor = requirePermission("jobs");
  if (!reason || reason.trim().length < 5) throw new Error("REASON_REQUIRED");

  const jobs = appData<Job[]>("sb2_jobs", seedJobs);
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) throw new Error("NOT_FOUND");
  /* Holat mashinasi "admin" aktyorini allaqachon biladi — o'z qo'lda
     tekshiruvimizni yozish o'rniga umumiy manbadan foydalanamiz
     (`forceCloseContract` ham shunday qiladi). */
  assertTransition(jobMachine, jobs[idx].status, "yopilgan", "admin");

  const job = jobs[idx];
  jobs[idx] = { ...job, status: "yopilgan" };
  write("sb2_jobs", jobs);

  /* Faol takliflar rad etiladi va mutaxassislar xabardor qilinadi — xuddi
     xaridor e'lonni o'zi yopgandagi kabi. Modal oynasi buni ALLAQACHON
     va'da qilardi ("taklif yuborgan mutaxassislar xabardor qilinadi"),
     lekin sahifadagi eski kod faqat e'lon holatini o'zgartirardi va
     mutaxassislar javob kutib qolaverardi. */
  const ACTIVE_PROPOSALS: ProposalStatus[] = [
    "yuborilgan",
    "korib_chiqilmoqda",
    "suhbat",
  ];
  const proposals = appData<Proposal[]>("sb2_proposals", seedProposals);
  let proposalsChanged = false;
  for (let i = 0; i < proposals.length; i++) {
    if (proposals[i].jobId === jobId && ACTIVE_PROPOSALS.includes(proposals[i].status)) {
      proposals[i] = { ...proposals[i], status: "rad_etildi" };
      proposalsChanged = true;
      pushNotification(
        proposals[i].sellerId,
        "taklif",
        "ntf.proposalRejected",
        `/mutaxassis/applications/${proposals[i].id}`,
        { title: job.title }
      );
    }
  }
  if (proposalsChanged) write("sb2_proposals", proposals);

  pushNotification(
    job.buyerId,
    "tizim",
    "ntf.jobClosedByAdmin",
    `/xaridor/elonlarim/${job.id}`,
    { title: job.title, reason: reason.trim() }
  );

  addAudit(
    "Admin loyihani majburiy yopdi",
    jobId,
    `Sabab: ${reason.trim()} · ${actor.fullName}`
  );
  return jobs[idx];
}

/** Xizmat moderatsiyasi: bozordan olib qo'yish yoki qaytarish. */
export function setServiceStatus(
  serviceId: string,
  status: Service["status"],
  reason?: string
) {
  const actor = requirePermission("services");

  const services = appData<Service[]>("sb2_services", seedServices);
  const idx = services.findIndex((s) => s.id === serviceId);
  if (idx === -1) throw new Error("NOT_FOUND");
  if (services[idx].status === status) throw new Error("ALREADY_PROCESSED");

  const service = services[idx];
  services[idx] = { ...service, status };
  write("sb2_services", services);

  pushNotification(
    service.sellerId,
    "tizim",
    status === "active" ? "ntf.serviceRestored" : "ntf.servicePaused",
    `/mutaxassis/services/${service.id}`,
    { title: service.title, reason: reason?.trim() ?? "" }
  );

  addAudit(
    status === "active" ? "Xizmat tiklandi" : "Xizmat bozordan olindi",
    serviceId,
    `${service.title} → ${status}${reason ? ` · Sabab: ${reason.trim()}` : ""} · ${actor.fullName}`
  );
  return services[idx];
}

/** Yordam chiptasining yozishmasi (admin javoblari bilan).
    Sahifa bu ro'yxatni ilgari `localStorage` dan o'zi o'qirdi. */
export function getTicketConversation(ticketId: string): TicketMessage[] {
  return read<TicketMessage[]>(`sb2_ticket_chat_${ticketId}`, []);
}

export function saveCategory(category: CategoryManagementItem) {
  const actor = requirePermission("categories");

  const categories = read<CategoryManagementItem[]>(
    "sb2_admin_categories",
    seedCategories
  );
  const idx = categories.findIndex((c) => c.id === category.id);
  let next: CategoryManagementItem[];
  if (idx >= 0) {
    next = categories.map((c) => (c.id === category.id ? category : c));
  } else {
    next = [...categories, category];
  }
  write("sb2_admin_categories", next);
  addAudit(
    idx >= 0 ? "Kategoriya yangilandi" : "Kategoriya qo'shildi",
    category.nameUz,
    `Slug: ${category.slug} · ${actor.fullName}`
  );
  return next;
}

export function toggleCategoryActive(categoryId: string) {
  const actor = requirePermission("categories");
  const categories = read<CategoryManagementItem[]>(
    "sb2_admin_categories",
    seedCategories
  );
  const updated = categories.map((c) =>
    c.id === categoryId ? { ...c, active: !c.active } : c
  );
  const target = updated.find((c) => c.id === categoryId);
  write("sb2_admin_categories", updated);
  addAudit(
    target?.active ? "Kategoriya yoqildi" : "Kategoriya o'chirildi",
    categoryId,
    `${target?.nameUz ?? categoryId} — ${actor.fullName}`
  );
  return updated;
}

/* ==========================================================================
   PLATFORM SETTINGS
   ========================================================================== */
export function updatePlatformSetting(key: string, value: string | number | boolean) {
  requireSuperAdmin();
  const settings = read<PlatformSettingItem[]>(
    PLATFORM_SETTINGS_KEY,
    seedPlatformSettings
  );
  const target = settings.find((s) => s.key === key);
  if (!target) throw new Error("NOT_FOUND");
  /* Faqat ko'rsatiladigan (build vaqtidagi) parametrlar o'zgartirilmaydi —
     aks holda UI bir raqamni, hisob-kitob boshqasini ishlatardi. */
  if (target.readOnly) throw new Error("READ_ONLY");

  let next = value;
  if (target.type === "number" || target.type === "percent") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error("VALIDATION");
    next = Math.round(n);
  } else if (target.type === "boolean") {
    next = Boolean(value);
  }

  const previous = target.value;
  const updated = settings.map((s) => (s.key === key ? { ...s, value: next } : s));
  write(PLATFORM_SETTINGS_KEY, updated);
  addAudit(
    "Platforma parametri o'zgartirildi",
    key,
    `${target.label}: ${previous} → ${next}`,
    String(previous)
  );
  return updated;
}

/* ==========================================================================
   ADMIN NAVBATLARI — FILTR + SAHIFALASH (server tomoni mantiqi)

   Nega bu qatlamda: hozir admin sahifalari `getAdminData()` bilan HAR BIR
   kolleksiyaning HAMMA qatorini oladi va brauzerda filtrlab, `slice` bilan
   sahifalaydi. `localStorage` uchun bu yetarli, lekin real bazada
   imkonsiz — 100 000 shartnomani brauzerga yuborib bo'lmaydi.

   Shuning uchun filtrlash va sahifalash mantiqi SAHIFADAN shu yerga
   ko'chirildi: backend ulanganda bu funksiyalar HTTP chaqiruviga
   almashadi, imzosi va qaytaradigan shakli (`AdminPage<T>`) o'zgarmaydi,
   ya'ni sahifa kodi qayta yozilmaydi.

   Har bir funksiya `requirePermission` dan o'tadi — navbatni O'QISH ham
   huquq talab qiladi.
   ========================================================================== */

const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 100;

/** "all" / bo'sh qiymat — filtr yo'q degani. */
function statusMatches(filter: string | undefined, value: string) {
  return !filter || filter === "all" || filter === value;
}

/** Erkin matn qidiruvi: berilgan maydonlardan birortasi mos kelsa — TRUE. */
function matches(query: string | undefined, ...fields: (string | undefined)[]) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

interface QueueOptions<T> {
  /** Erkin qidiruv mos keladimi */
  search: (row: T) => boolean;
  /** Holat qiymati — faset va `status` filtri uchun */
  status?: (row: T) => string;
  /** Qo'shimcha filtr (kategoriya va h.k.) — fasetga TA'SIR QILADI */
  extra?: (row: T) => boolean;
  /** Saralash uchun sana (yangidan eskiga) */
  date?: (row: T) => string | undefined;
  /** Qo'shimcha ko'rsatkichlar (status'dan boshqa o'lchov bo'yicha) —
      masalan shikoyatlarda xavf darajasi, e'lonlarda takliflar yig'indisi. */
  extraFacets?: (rows: T[]) => Record<string, number>;
}

/**
 * Navbatni quradi: filtrlash → faset → saralash → sahifalash.
 *
 * Tartib muhim: fasetlar `status` filtri QO'LLANMASDAN oldin hisoblanadi,
 * shuning uchun KPI kartochkalari tab almashganda o'zgarmaydi.
 */
function buildQueue<T>(
  all: T[],
  query: AdminQueueQuery,
  opts: QueueOptions<T>
): AdminPage<T> {
  /* 1. Qidiruv + qo'shimcha filtr (status EMAS) */
  const searched = all.filter(
    (row) => opts.search(row) && (opts.extra ? opts.extra(row) : true)
  );

  /* 2. Fasetlar — shu to'plamdan */
  const facets: Record<string, number> = { _all: searched.length };
  if (opts.status) {
    for (const row of searched) {
      const key = opts.status(row);
      facets[key] = (facets[key] ?? 0) + 1;
    }
  }
  Object.assign(facets, opts.extraFacets?.(searched) ?? {});

  /* 3. Status filtri */
  const rows = opts.status
    ? searched.filter((row) => statusMatches(query.status, opts.status!(row)))
    : searched;

  /* 4. Saralash — yangidan eskiga */
  const sorted = opts.date
    ? [...rows].sort((a, b) =>
        (opts.date!(b) ?? "").localeCompare(opts.date!(a) ?? "")
      )
    : rows;

  /* 5. Sahifalash */
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.round(query.perPage ?? DEFAULT_PER_PAGE))
  );
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  /* Sahifa raqami chegaradan chiqsa oxirgi sahifaga qisiladi — filtr
     o'zgarganda foydalanuvchi bo'sh ekranda qolib ketmasligi uchun. */
  const page = Math.min(totalPages, Math.max(1, Math.round(query.page ?? 1)));
  const start = (page - 1) * perPage;

  return {
    items: sorted.slice(start, start + perPage),
    page,
    perPage,
    total,
    totalPages,
    facets,
  };
}

/** Foydalanuvchi qatori — moderatsiya holati va KYC holati SERVER tomonida
    biriktirilgan. Mijoz buni o'zi hisoblay olmaydi: unda faqat bitta
    sahifa qatorlari bo'ladi, moderatsiya/KYC jadvallari esa yo'q. */
export interface AdminUserRow extends User {
  /** "active" | "suspended" | "blocked" | "deactivated" | "deleted" */
  moderationStatus: string;
  kycStatus: string;
}

export function listUsersQueue(query: AdminQueueQuery = {}): AdminPage<AdminUserRow> {
  requirePermission("users");
  const data = getAdminData();
  const blocked = new Set(data.blockedUserIds);
  const kycByUser = new Map(data.verifications.map((v) => [v.userId, v.status]));

  const rows: AdminUserRow[] = data.users.map((u) => ({
    ...u,
    moderationStatus:
      data.moderationDetails[u.id]?.status ??
      (blocked.has(u.id) ? "blocked" : "active"),
    kycStatus: kycByUser.get(u.id) ?? "boshlanmagan",
  }));

  return buildQueue(rows, query, {
    search: (u) => matches(query.search, u.fullName, u.phone, u.id),
    status: (u) => u.moderationStatus,
    /* `category` bu navbatda ROL filtri, `severity` — KYC holati */
    extra: (u) =>
      statusMatches(query.category, u.role) &&
      statusMatches(query.severity, u.kycStatus),
    date: (u) => u.createdAt,
    extraFacets: (rows2) => ({
      "role:xaridor": rows2.filter((u) => u.role === "xaridor").length,
      "role:mutaxassis": rows2.filter((u) => u.role === "mutaxassis").length,
    }),
  });
}

/** Foydalanuvchi kartochkasi uchun barcha bog'liq yozuvlar bitta chaqiruvda
    (`GET /admin/users/:id`). Ro'yxat endi bitta sahifa bo'lgani uchun
    bularni mijoz o'zi yig'a olmaydi. */
export function getUserDetail(userId: string) {
  requirePermission("users");
  const data = getAdminData();
  return {
    user: data.users.find((u) => u.id === userId) ?? null,
    contracts: data.contracts.filter(
      (c) => c.buyerId === userId || c.sellerId === userId
    ),
    services: data.services.filter((s) => s.sellerId === userId),
    jobs: data.jobs.filter((j) => j.buyerId === userId),
    verifications: data.verifications.filter((v) => v.userId === userId),
    moderation: data.moderationDetails[userId],
  };
}

export function listServicesQueue(query: AdminQueueQuery = {}): AdminPage<Service> {
  requirePermission("services");
  return buildQueue(getAdminData().services, query, {
    search: (s) => matches(query.search, s.title, s.description, s.id, s.sellerId),
    status: (s) => s.status,
    extra: (s) => statusMatches(query.category, s.category),
    date: (s) => s.createdAt,
  });
}

export function listJobsQueue(query: AdminQueueQuery = {}): AdminPage<Job> {
  requirePermission("jobs");
  return buildQueue(getAdminData().jobs, query, {
    search: (j) => matches(query.search, j.title, j.description, j.buyerName, j.id),
    status: (j) => j.status,
    extra: (j) => statusMatches(query.category, j.category),
    date: (j) => j.postedAt,
    extraFacets: (rows) => ({
      proposals: rows.reduce((sum, j) => sum + j.proposalsCount, 0),
    }),
  });
}

export function listContractsQueue(query: AdminQueueQuery = {}): AdminPage<Contract> {
  requirePermission("orders");
  return buildQueue(getAdminData().contracts, query, {
    search: (c) => matches(query.search, c.title, c.buyerName, c.sellerName, c.id),
    status: (c) => c.status,
    date: (c) => c.createdAt,
    extraFacets: (rows) => ({
      amountSum: rows.reduce((sum, c) => sum + c.totalAmount, 0),
    }),
  });
}

export function listB2bPendingContracts(query: AdminQueueQuery = {}): AdminPage<Contract> {
  requirePermission("payments");
  const bankContracts = getAdminData().contracts.filter(
    (c) =>
      c.b2bPending ||
      c.paymentMethod === "b2b" ||
      c.paymentStatus === "pending_verification" ||
      c.paymentStatus === "receipt_uploaded" ||
      c.paymentStatus === "payment_confirmed" ||
      c.paymentStatus === "payment_rejected" ||
      Boolean(c.b2bReceiptUrl) ||
      Boolean(c.paymentReceiptUrl)
  );

  bankContracts.sort((a, b) => {
    const aPending = a.b2bPending || a.paymentStatus === "pending_verification" ? 1 : 0;
    const bPending = b.b2bPending || b.paymentStatus === "pending_verification" ? 1 : 0;
    if (aPending !== bPending) return bPending - aPending;
    const aDate = a.paymentSubmittedAt || a.b2bSubmittedAt || a.createdAt;
    const bDate = b.paymentSubmittedAt || b.b2bSubmittedAt || b.createdAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  return buildQueue(bankContracts, query, {
    search: (c) => matches(query.search, c.title, c.buyerName, c.sellerName, c.id, c.paymentReference),
    status: (c) =>
      c.paymentStatus ||
      (c.b2bPending ? "pending_verification" : c.status === "faol" ? "payment_confirmed" : "awaiting_payment"),
    date: (c) => c.paymentSubmittedAt || c.b2bSubmittedAt || c.createdAt,
    extraFacets: (rows) => ({
      amountSum: rows.reduce((sum, c) => sum + c.totalAmount, 0),
    }),
  });
}

/** KYC qatori — foydalanuvchi nomi SERVER tomonida biriktirilgan.
    Mijozda birlashtirish mumkin emas: unda faqat bitta sahifa qatorlari
    bo'ladi, foydalanuvchilar ro'yxati esa yo'q. */
export interface AdminVerificationRow extends VerificationRecord {
  userName: string;
  userPhone: string;
}

export function listVerificationsQueue(
  query: AdminQueueQuery = {}
): AdminPage<AdminVerificationRow> {
  requirePermission("kyc");
  const data = getAdminData();
  const byId = new Map(data.users.map((u) => [u.id, u]));
  const rows: AdminVerificationRow[] = data.verifications.map((v) => ({
    ...v,
    userName: byId.get(v.userId)?.fullName ?? v.legalName,
    userPhone: byId.get(v.userId)?.phone ?? "",
  }));
  return buildQueue(rows, query, {
    search: (v) =>
      matches(query.search, v.legalName, v.userId, v.country, v.userName, v.userPhone),
    status: (v) => v.status,
    date: (v) => v.submittedAt,
  });
}

/** Nizo qatori — shartnoma sarlavhasi va taraflar SERVER tomonida
    biriktirilgan (jadval ularni har qatorda ko'rsatadi). */
export interface AdminDisputeRow extends Dispute {
  contractTitle: string;
  buyerName: string;
  sellerName: string;
}

export function listDisputesQueue(
  query: AdminQueueQuery = {}
): AdminPage<AdminDisputeRow> {
  requirePermission("disputes");
  const data = getAdminData();
  const byId = new Map(data.contracts.map((c) => [c.id, c]));
  const rows: AdminDisputeRow[] = data.disputes.map((d) => {
    const c = byId.get(d.contractId);
    return {
      ...d,
      contractTitle: c?.title ?? d.contractId,
      buyerName: c?.buyerName ?? "",
      sellerName: c?.sellerName ?? "",
    };
  });
  return buildQueue(rows, query, {
    search: (d) =>
      matches(
        query.search,
        d.contractId,
        d.description,
        d.id,
        d.contractTitle,
        d.buyerName,
        d.sellerName
      ),
    status: (d) => d.status,
    date: (d) => d.createdAt,
  });
}

export function listWithdrawalsQueue(
  query: AdminQueueQuery = {}
): AdminPage<WithdrawalRequest> {
  requirePermission("payments");
  return buildQueue(getAdminData().withdrawals, query, {
    search: (w) => matches(query.search, w.userName, w.userId, w.id, w.cardDetails),
    status: (w) => w.status,
    date: (w) => w.createdAt,
  });
}

export function listTransactionsQueue(
  query: AdminQueueQuery = {}
): AdminPage<TransactionRecord> {
  requirePermission("payments");
  return buildQueue(getAdminData().transactions, query, {
    search: (t) => matches(query.search, t.userName, t.userId, t.id, t.description),
    status: (t) => t.status,
    date: (t) => t.createdAt,
  });
}

/** Chipta qatori — muallif nomi SERVER tomonida biriktirilgan. */
export interface AdminTicketRow extends SupportTicket {
  userName: string;
}

export function listTicketsQueue(query: AdminQueueQuery = {}): AdminPage<AdminTicketRow> {
  requirePermission("support");
  const data = getAdminData();
  const byId = new Map(data.users.map((u) => [u.id, u]));
  const rows: AdminTicketRow[] = data.tickets.map((t) => ({
    ...t,
    userName: byId.get(t.userId)?.fullName ?? t.userId,
  }));
  return buildQueue(rows, query, {
    search: (t) => matches(query.search, t.subject, t.message, t.userId, t.id, t.userName),
    status: (t) => t.status,
    extra: (t) => statusMatches(query.category, t.topic),
    date: (t) => t.createdAt,
  });
}

export function listReportsQueue(query: AdminQueueQuery = {}): AdminPage<TrustReport> {
  requirePermission("reports");
  return buildQueue(getAdminData().reports, query, {
    search: (r) =>
      matches(query.search, r.id, r.description, r.targetTitle, r.reporterName),
    status: (r) => r.status,
    /* Shikoyatlarda "kategoriya" — sabab turi (`reasonType`) */
    extra: (r) =>
      statusMatches(query.category, r.reasonType) &&
      statusMatches(query.severity, r.severity),
    date: (r) => r.createdAt,
    extraFacets: (rows) => ({
      "severity:high": rows.filter(
        (r) => r.severity === "high" || r.severity === "critical"
      ).length,
    }),
  });
}

export function listAppealsQueue(query: AdminQueueQuery = {}): AdminPage<UserAppeal> {
  requirePermission("appeals");
  return buildQueue(getAdminData().appeals, query, {
    search: (a) => matches(query.search, a.id, a.userName, a.userId, a.appealText),
    status: (a) => a.status,
    date: (a) => a.createdAt,
  });
}

export function listReviewsQueue(query: AdminQueueQuery = {}): AdminPage<Review> {
  requirePermission("reviews");
  return buildQueue(getAdminData().reviews, query, {
    search: (r) => matches(query.search, r.comment, r.buyerName, r.contractId, r.id),
    /* Sharhlarda "holat" — yulduzlar soni ("5", "4", …) */
    status: (r) => String(r.rating),
    date: (r) => r.createdAt,
    extraFacets: (rows) => ({
      ratingSum: rows.reduce((sum, r) => sum + r.rating, 0),
    }),
  });
}

export function listAuditQueue(query: AdminQueueQuery = {}): AdminPage<AuditEvent> {
  requirePermission("audit");
  return buildQueue(getAuditEvents(), query, {
    search: (e) => matches(query.search, e.action, e.target, e.adminName, e.details),
    /* Auditda "holat" — operator nomi */
    status: (e) => e.adminName,
    date: (e) => e.createdAt,
  });
}

/* --------------------------------------------------------------------------
   AGREGATLAR (dashboard KPI kartochkalari va sidebar hisoblagichlari)

   Sahifalash joriy etilgandan keyin ekran endi HAMMA qatorni ko'rmaydi —
   demak "Jami 1 248 ta shartnoma" kabi raqamni o'zi sanay olmaydi. Shuning
   uchun agregatlar ALOHIDA chaqiruv bo'ladi:  GET /api/v1/admin/stats
   Backend'da bu `COUNT(*) ... GROUP BY status` — arzon so'rov; ro'yxatni
   yuklab olib brauzerda sanash esa imkonsiz.
   -------------------------------------------------------------------------- */

export interface AdminCounters {
  /** Amal talab qiladigan navbatlar (sidebar badge'lari) */
  pendingKyc: number;
  openDisputes: number;
  pendingWithdrawals: number;
  openReports: number;
  openTickets: number;
  pendingAppeals: number;
  /** Umumiy hajm ko'rsatkichlari */
  totalUsers: number;
  totalServices: number;
  totalJobs: number;
  totalContracts: number;
  totalReviews: number;
  totalAuditEvents: number;
  /** Audit filtri uchun facet — ro'yxatni yuklamasdan operator nomlari */
  auditAdmins: string[];
  /** Moliyaviy jami ko'rsatkichlar (To'lovlar sahifasi KPI'lari).
      Backend'da bular ledger bo'yicha `SUM(...)` — ro'yxatni yuklab
      brauzerda qo'shib bo'lmaydi. */
  escrowTotal: number;
  payoutsTotal: number;
  commissionTotal: number;
}

export function getAdminCounters(): AdminCounters {
  requireAdmin();
  const data = getAdminData();
  const audit = getAuditEvents();
  return {
    pendingKyc: data.verifications.filter((v) => v.status === "korib_chiqilmoqda").length,
    openDisputes: data.disputes.filter(
      (d) => d.status === "ochiq" || d.status === "korib_chiqilmoqda"
    ).length,
    pendingWithdrawals: data.withdrawals.filter((w) => w.status === "kutilmoqda").length,
    openReports: data.reports.filter(
      (r) => r.status === "new" || r.status === "investigating"
    ).length,
    openTickets: data.tickets.filter((t) => t.status === "ochiq").length,
    pendingAppeals: data.appeals.filter((a) => a.status === "pending").length,
    totalUsers: data.users.length,
    totalServices: data.services.length,
    totalJobs: data.jobs.length,
    totalContracts: data.contracts.length,
    totalReviews: data.reviews.length,
    totalAuditEvents: audit.length,
    auditAdmins: Array.from(new Set(audit.map((e) => e.adminName))),
    ...financialTotals(data),
  };
}

/** Escrow / to'lovlar / komissiya jamilari.
    Escrow FAQAT haqiqatan ochiq shartnomalarda hisoblanadi: bekor qilingan
    yoki yakunlangan shartnomaning bosqichi mablag'langan holatda qolib
    ketsa, u pul allaqachon chiqib ketgan bo'ladi. */
function financialTotals(data: AdminData) {
  const openContractIds = new Set(
    data.contracts
      .filter((c) => c.status === "faol" || c.status === "nizo")
      .map((c) => c.id)
  );
  const escrowTotal = data.milestones
    .filter(
      (m) =>
        openContractIds.has(m.contractId) &&
        ["mablaglangan", "topshirildi", "ozgartirish_soraldi"].includes(m.status)
    )
    .reduce((sum, m) => sum + m.amount, 0);

  const completedTotal = data.milestones
    .filter((m) => m.status === "qabul_qilindi")
    .reduce((sum, m) => sum + m.amount, 0);

  const payoutsTotal = data.withdrawals
    .filter((w) => w.status === "tasdiqlangan")
    .reduce((sum, w) => sum + w.amount, 0);

  return {
    escrowTotal,
    payoutsTotal,
    /* Komissiya `lib/fees.ts` dagi yagona manbadan */
    commissionTotal: platformFee(completedTotal),
  };
}

/* --------------------------------------------------------------------------
   DETAL O'QUVCHILAR

   Sahifalash joriy etilgach ekranda faqat bitta sahifa qatorlari bo'ladi —
   tanlangan yozuvning bog'liq ma'lumotlarini (bosqichlar, shartnoma) endi
   ro'yxatdan izlab bo'lmaydi. Backend'da bular alohida endpoint:
     GET /api/v1/admin/contracts/:id/milestones
   -------------------------------------------------------------------------- */

/** Bitta shartnomaning bosqichlari (arbitraj va escrow ko'rinishi uchun). */
export function getContractMilestones(contractId: string): Milestone[] {
  requireAdmin();
  return getAdminData().milestones.filter((m) => m.contractId === contractId);
}

/* Bitta yozuvni ID bo'yicha topish — global qidiruv deep-link'i uchun.

   NEGA KERAK: sahifalash joriy etilgach ekranda faqat bitta sahifa (10 ta)
   qator bo'ladi. Global qidiruvdan kelgan havola 5-sahifadagi yozuvga
   ishora qilsa, uni yuklangan qatorlar orasidan topib bo'lmaydi — sahifa
   ochiladi-yu, hech narsa tanlanmaydi. Backend'da bular oddiy
   `GET /admin/<resurs>/:id`. */

export function findUserById(id: string): AdminUserRow | null {
  const page = listUsersQueue({ perPage: MAX_PER_PAGE, search: id });
  return page.items.find((u) => u.id === id) ?? null;
}

export function findServiceById(id: string): Service | null {
  requirePermission("services");
  return getAdminData().services.find((s) => s.id === id) ?? null;
}

export function findContractById(id: string): Contract | null {
  requirePermission("orders");
  return getAdminData().contracts.find((c) => c.id === id) ?? null;
}

export function findJobById(id: string): Job | null {
  requirePermission("jobs");
  return getAdminData().jobs.find((j) => j.id === id) ?? null;
}

export function findVerificationByUserId(
  userId: string
): AdminVerificationRow | null {
  const page = listVerificationsQueue({ perPage: MAX_PER_PAGE, search: userId });
  return page.items.find((v) => v.userId === userId) ?? null;
}

export function findTicketById(id: string): AdminTicketRow | null {
  const page = listTicketsQueue({ perPage: MAX_PER_PAGE, search: id });
  return page.items.find((t) => t.id === id) ?? null;
}

export function findDisputeById(id: string): AdminDisputeRow | null {
  const page = listDisputesQueue({ perPage: MAX_PER_PAGE, search: id });
  return page.items.find((d) => d.id === id) ?? null;
}

/** Nizo uchun shartnoma + bosqichlar bitta chaqiruvda. */
export function getDisputeContext(contractId: string): {
  contract: Contract | null;
  milestones: Milestone[];
} {
  requirePermission("disputes");
  const data = getAdminData();
  return {
    contract: data.contracts.find((c) => c.id === contractId) ?? null,
    milestones: data.milestones.filter((m) => m.contractId === contractId),
  };
}

/* ==========================================================================
   GLOBAL SEARCH (Across All Marketplace Domains)
   ========================================================================== */
export interface SearchResultItem {
  id: string;
  type:
    | "user"
    | "order"
    | "service"
    | "job"
    | "ticket"
    | "dispute"
    | "kyc"
    | "report";
  title: string;
  subtitle: string;
  url: string;
  badgeTone?: "primary" | "success" | "warning" | "danger" | "neutral";
}

export function adminGlobalSearch(query: string): SearchResultItem[] {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim().toLowerCase();
  const data = getAdminData();
  const results: SearchResultItem[] = [];

  // 1. Users
  data.users.forEach((u) => {
    if (
      u.fullName.toLowerCase().includes(q) ||
      u.phone.toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q)
    ) {
      results.push({
        id: u.id,
        type: "user",
        title: u.fullName,
        subtitle: `${u.role === "mutaxassis" ? "Mutaxassis" : "Xaridor"} · ${u.phone}`,
        url: `/admin/foydalanuvchilar?userId=${u.id}`,
        badgeTone: u.role === "mutaxassis" ? "primary" : "neutral",
      });
    }
  });

  // 2. Contracts / Orders
  data.contracts.forEach((c) => {
    if (
      c.title.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.buyerName.toLowerCase().includes(q) ||
      c.sellerName.toLowerCase().includes(q)
    ) {
      results.push({
        id: c.id,
        type: "order",
        title: `Shartnoma #${c.id}: ${c.title}`,
        subtitle: `${c.buyerName} → ${c.sellerName} · ${c.status}`,
        url: `/admin/shartnomalar?orderId=${c.id}`,
        badgeTone: "success",
      });
    }
  });

  // 3. KYC Applications
  data.verifications.forEach((k) => {
    if (
      k.legalName.toLowerCase().includes(q) ||
      k.userId.toLowerCase().includes(q)
    ) {
      results.push({
        id: k.userId,
        type: "kyc",
        title: `KYC: ${k.legalName}`,
        subtitle: `${k.documentType.toUpperCase()} (${k.country}) · ${k.status}`,
        url: `/admin/verifikatsiya?userId=${k.userId}`,
        badgeTone: "warning",
      });
    }
  });

  // 4. Disputes
  data.disputes.forEach((d) => {
    if (
      d.id.toLowerCase().includes(q) ||
      d.contractId.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q)
    ) {
      results.push({
        id: d.id,
        type: "dispute",
        title: `Nizo #${d.id}`,
        subtitle: `Shartnoma #${d.contractId}: ${d.description.slice(0, 50)}...`,
        url: `/admin/nizolar?disputeId=${d.id}`,
        badgeTone: "danger",
      });
    }
  });

  // 5. Support Tickets
  data.tickets.forEach((t) => {
    if (
      t.subject.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.message.toLowerCase().includes(q)
    ) {
      results.push({
        id: t.id,
        type: "ticket",
        title: `Chipta #${t.id}: ${t.subject}`,
        subtitle: `Mavzu: ${t.topic} · Status: ${t.status}`,
        url: `/admin/yordam?ticketId=${t.id}`,
        badgeTone: "primary",
      });
    }
  });

  // 6. Services & Jobs
  data.services.forEach((s) => {
    if (
      s.title.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    ) {
      results.push({
        id: s.id,
        type: "service",
        title: `Xizmat: ${s.title}`,
        subtitle: `${s.category} · ${s.price} UZS`,
        url: `/admin/xizmatlar?serviceId=${s.id}`,
        badgeTone: "neutral",
      });
    }
  });

  data.jobs.forEach((j) => {
    if (
      j.title.toLowerCase().includes(q) ||
      j.description.toLowerCase().includes(q) ||
      j.buyerName.toLowerCase().includes(q)
    ) {
      results.push({
        id: j.id,
        type: "job",
        title: `Loyiha: ${j.title}`,
        subtitle: `${j.buyerName} · ${j.budgetMin}–${j.budgetMax} UZS`,
        url: `/admin/loyihalar?jobId=${j.id}`,
        badgeTone: "neutral",
      });
    }
  });

  return results.slice(0, 15);
}



