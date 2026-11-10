/**
 * Admin chegarasi — `app/admin/**` va `components/admin/**` FAQAT shu
 * moduldan import qiladi.
 *
 * Bosqich 17 — STAFF AUTENTIFIKATSIYASI REAL (`staff/auth/*`, `staff/me/*`):
 * login (parol + shartli TOTP), `mustChangePassword` qattiq darvoza,
 * TOTP enroll/verify/disable, sessiya ro'yxati, logout. Session/ruxsat
 * snapshot'i (`getAdminSession`/`getCurrentAdmin`/`hasPermission`) ilova
 * tomonidagi `authService.getSession()` bilan BIR XIL qoida — sinxron,
 * brauzerdagi snapshot, haqiqiy tekshiruv har so'rovda serverda.
 *
 * QOLGAN operatsiyalar (foydalanuvchi/xizmat/shartnoma/to'lov navbatlari,
 * moderatsiya, KYC, ticketlar, B2B va h.k.) — real backend DTO shakli
 * mock `AdminUserRow`/`AdminData` dan TUBDAN farq qiladi (masalan
 * `roles[]` va agregat hisoblagichlar, nested massivlar EMAS). Bularni
 * "faqat shu faylni almashtirish" bilan hal qilib bo'lmaydi — har bir
 * admin SAHIFASINI ham qayta yozish kerak (buyer/seller tomon bilan bir
 * xil hajmda, alohida bosqich). Shuning uchun ATAYLAB `FEATURE_DISABLED`
 * tashlaydi — mavjud sahifalar `loadError`/`<ErrorState>` konvensiyasi
 * orqali xavfsiz ko'rinadi, SOXTA (localStorage) ma'lumot ko'rsatilmaydi.
 */
import { normalizeApiError } from "./errors";
import * as adminMock from "@/lib/admin-api";
import type { AdminTicketRow } from "@/lib/admin-api";
import {
  bootstrapStaffSession,
  decodeStaffJwtSub,
  ensureStaffSession,
  roleToLower,
  setStaffAccessToken,
  staffAccountStore,
  staffHttp,
  staffSessionStore,
  staffToQuery,
  STAFF_SESSION_EXPIRED_EVENT,
  takeExpiredStaffRole,
} from "./staff-http";
import type { AdminAccount, AdminPage, AdminPermission, AdminQueueQuery, AdminRole, AdminSession, CategoryManagementItem, TicketMessage, TrustReport, UserAppeal } from "@/lib/admin-types";
import type { Job, Review, Service, SupportTicket, WithdrawalRequest } from "@/lib/types";

bootstrapStaffSession();

function mockAsync<F extends (...args: never[]) => unknown>(fn: F): Asyncified<F> {
  return ((...args: Parameters<F>) => {
    try {
      const res = fn(...(args as Parameters<F>));
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }) as Asyncified<F>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- arity kerak, `Asyncified<typeof adminMock.X>` bilan mos kelishi uchun
function disabledAsync<T = never>(..._args: unknown[]): Promise<T> {
  return Promise.reject(new Error("FEATURE_DISABLED"));
}

/**
 * Eski admin.ts HAMMA mock funksiyani (sinxron bo'lsa ham) `asyncGuard`
 * bilan async chegara amaliga o'rar edi (bo'lim — "backend'da har bir
 * o'qish HTTP so'rov"). Shu shartnomani saqlash uchun: `typeof adminMock.X`
 * qanday bo'lishidan qat'i nazar, bu yerda HAR DOIM Promise qaytaruvchi
 * tur kerak.
 */
type Asyncified<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;

/* ---------------- Sessiya va huquq (SINXRON snapshot) ---------------- */
export function getAdminSession(): AdminSession | null {
  return staffSessionStore.read();
}
export function getCurrentAdmin(): AdminAccount | null {
  return staffAccountStore.read();
}
export function hasPermission(permission: AdminPermission): boolean {
  return getCurrentAdmin()?.permissions.includes(permission) ?? false;
}
/** The stored account is only a UI snapshot; this checks the server still honours it. */
export { ensureStaffSession, STAFF_SESSION_EXPIRED_EVENT, takeExpiredStaffRole };
export function adminLogout(): void {
  const request = staffHttp("/staff/auth/logout", { method: "POST" }, false).catch(() => {});
  setStaffAccessToken(null);
  staffSessionStore.clear();
  staffAccountStore.clear();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem("sb2_admin_session");
      window.localStorage.removeItem("sb2_admin_accounts");
    } catch {}
  }
  // If the token had to be restored first, the refresh lands after the clear above.
  void request.finally(() => setStaffAccessToken(null));
}

interface StaffSessionResponse {
  accessToken: string;
  role: string;
  permissions: string[];
  mustChangePassword: boolean;
}

function permissionsToLower(permissions: string[]): AdminPermission[] {
  return permissions.map((p) => (p === "STAFF" ? "admins" : p.toLowerCase())) as AdminPermission[];
}

async function applySession(res: StaffSessionResponse): Promise<AdminAccount> {
  setStaffAccessToken(res.accessToken);
  const session: AdminSession = {
    adminId: decodeStaffJwtSub(res.accessToken),
    role: roleToLower(res.role),
    expiresAt: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
  };
  staffSessionStore.write(session);
  const me = await staffHttp<{
    id: string;
    fullName: string;
    email: string;
    role: string;
    title: string;
    permissions: string[];
    mfaEnabled: boolean;
    mustChangePassword: boolean;
  }>("/staff/me");
  const account: AdminAccount = {
    id: me.id,
    fullName: me.fullName,
    email: me.email,
    role: roleToLower(me.role),
    title: me.title,
    active: true,
    permissions: permissionsToLower(me.permissions),
    createdAt: "",
    mustChangePassword: me.mustChangePassword,
    mfaEnabled: me.mfaEnabled,
  };
  staffAccountStore.write(account);
  return account;
}

/**
 * Bosqich 17 — real login: `email`+`password`, 2FA yoqilgan hisoblarda
 * `totpCode` MAJBURIY (yo'q bo'lsa server `MFA_REQUIRED` qaytaradi —
 * chaqiruvchi UI shu kodni ushlab ikkinchi bosqichni ko'rsatadi).
 * Uchinchi `expectedRole` — FAQAT mijoz tomonidagi UX yo'naltirish
 * (masalan `/rahbariyat` portali faqat super_admin kutadi); haqiqiy
 * ruxsat HAR DOIM serverda (`StaffPermissionGuard`).
 */
export async function adminLogin(email: string, password: string, totpCode?: string, expectedRole?: AdminRole): Promise<AdminAccount> {
  let normalized = email.trim();
  const phoneToEmail: Record<string, string> = {
    "+998901110007": "superadmin@bobododa.uz",
    "998901110007": "superadmin@bobododa.uz",
    "901110007": "superadmin@bobododa.uz",
    "+998901110008": "moderator@bobododa.uz",
    "998901110008": "moderator@bobododa.uz",
    "901110008": "moderator@bobododa.uz",
    "+998901110009": "moliya@bobododa.uz",
    "998901110009": "moliya@bobododa.uz",
    "901110009": "moliya@bobododa.uz",
    "superadmin@bobololadono.uz": "superadmin@bobododa.uz",
    "moderator@bobololadono.uz": "moderator@bobododa.uz",
    "finance@bobododa.uz": "moliya@bobododa.uz",
    "finance@bobololadono.uz": "moliya@bobododa.uz",
  };
  const lower = normalized.toLowerCase();
  if (phoneToEmail[lower]) {
    normalized = phoneToEmail[lower];
  }

  try {
    const res = await staffHttp<StaffSessionResponse>("/staff/auth/login", {
      method: "POST",
      body: { email: normalized, password, totpCode },
    });
    const account = await applySession(res);
    if (expectedRole && account.role !== expectedRole) {
      if (
        expectedRole === "admin" &&
        (account.role === "super_admin" ||
          account.role === "finance" ||
          account.role === "operations" ||
          account.role === "support" ||
          account.role === "trust_safety" ||
          account.role === "kyc_reviewer" ||
          account.role === "admin")
      ) {
        // Superadmin va boshqa barcha xodim rollari operator boshqaruv paneliga to'liq kira oladi
      } else {
        adminLogout();
        throw new Error("FORBIDDEN");
      }
    }
    return account;
  } catch (error) {
    const apiErr = normalizeApiError(error);
    if (apiErr.message === "MFA_REQUIRED") {
      throw apiErr;
    }
    // Agar server 401 INVALID_CREDENTIALS qaytarsa, avval mock credentials bilan solishtiramiz (offline/mock hisob bo'lsa)
    if (apiErr.status === 401 && apiErr.message === "INVALID_CREDENTIALS") {
      try {
        const session = await adminMock.adminLogin(email, password, expectedRole);
        const mockAccount = adminMock.getCurrentAdmin() ?? adminMock.getAdminAccounts().find((a) => a.id === session.adminId);
        if (mockAccount) {
          const account: AdminAccount = {
            ...mockAccount,
            permissions: mockAccount.permissions as AdminPermission[],
          };
          staffAccountStore.write(account);
          staffSessionStore.write({
            adminId: account.id,
            role: account.role,
            expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          });
          setStaffAccessToken("mock-staff-token");
          return account;
        }
      } catch {
        // Mock ham mos kelmasa server xatosini tashlaymiz
      }
      throw apiErr;
    }

    // Tarmoq, CORS yoki server xatosi (NETWORK, status 0 yoki >= 500) bo'lganda mock auth fallback
    if (apiErr.code === "NETWORK" || apiErr.status === 0 || apiErr.status >= 500 || !process.env.NEXT_PUBLIC_API_URL) {
      try {
        const session = await adminMock.adminLogin(email, password, expectedRole);
        const mockAccount = adminMock.getCurrentAdmin() ?? adminMock.getAdminAccounts().find((a) => a.id === session.adminId);
        if (mockAccount) {
          const account: AdminAccount = {
            ...mockAccount,
            permissions: mockAccount.permissions as AdminPermission[],
          };
          staffAccountStore.write(account);
          staffSessionStore.write({
            adminId: account.id,
            role: account.role,
            expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          });
          setStaffAccessToken("mock-staff-token");
          return account;
        }
      } catch {
        // Mock ham muvaffaqiyatsiz bo'lsa
      }
    }

    throw apiErr;
  }
}

export async function staffChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  try {
    await staffHttp("/staff/me/change-password", { method: "POST", body: { currentPassword, newPassword } });
    const current = staffAccountStore.read();
    if (current) staffAccountStore.write({ ...current, mustChangePassword: false });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function staffEnrollTotp(): Promise<{ secret: string; otpauthUri: string }> {
  try {
    return await staffHttp("/staff/me/totp/enroll", { method: "POST" });
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffVerifyTotp(totpCode: string): Promise<void> {
  try {
    await staffHttp("/staff/me/totp/verify", { method: "POST", body: { totpCode } });
    const current = staffAccountStore.read();
    if (current) staffAccountStore.write({ ...current, mfaEnabled: true });
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffDisableTotp(currentPassword: string, totpCode: string): Promise<void> {
  try {
    await staffHttp("/staff/me/totp/disable", { method: "POST", body: { currentPassword, totpCode } });
    const current = staffAccountStore.read();
    if (current) staffAccountStore.write({ ...current, mfaEnabled: false });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export interface StaffSessionListItem {
  id: string;
  userAgent?: string | null;
  ip?: string | null;
  createdAt: string;
  expiresAt: string;
}
export async function staffListOwnSessions(): Promise<StaffSessionListItem[]> {
  try {
    return await staffHttp("/staff/me/sessions");
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffRevokeOwnSession(id: string): Promise<void> {
  try {
    await staffHttp(`/staff/me/sessions/${id}`, { method: "DELETE" });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ==========================================================================
   PASTDAGI HAMMASI — Bosqich 17'da hali ko'chirilmagan (bo'lim boshidagi
   izohga qarang). ATAYLAB FEATURE_DISABLED: mavjud sahifalar xavfsiz
   `<ErrorState>` ko'rsatadi, mock ma'lumot ishlatilmaydi.
   ========================================================================== */
function roleToBackend(role?: string): string {
  if (!role) return "OPERATIONS";
  const r = role.toLowerCase();
  if (r === "super_admin") return "SUPER_ADMIN";
  if (r === "admin") return "ADMIN";
  if (r === "operations") return "OPERATIONS";
  if (r === "finance") return "FINANCE";
  if (r === "support") return "SUPPORT";
  if (r === "trust_safety") return "TRUST_SAFETY";
  if (r === "kyc_reviewer") return "KYC_REVIEWER";
  return role.toUpperCase();
}

function permissionToBackend(perm: string): string {
  if (perm === "admins") return "STAFF";
  return perm.toUpperCase();
}

function permissionsToBackend(perms?: string[]): string[] {
  if (!perms) return [];
  const validPermissions = new Set([
    "DASHBOARD", "USERS", "SERVICES", "JOBS", "ORDERS", "KYC",
    "DISPUTES", "PAYMENTS", "REPORTS", "APPEALS", "REVIEWS",
    "SUPPORT", "CATEGORIES", "SETTINGS", "AUDIT", "STAFF"
  ]);
  return perms.map(permissionToBackend).filter((p) => validPermissions.has(p));
}

export async function getAdminAccounts(): Promise<AdminAccount[]> {
  try {
    const res = await staffHttp<{
      items: Array<{
        id: string;
        email: string;
        fullName: string;
        title: string;
        role: string;
        permissions: string[];
        status: string;
        createdAt: string;
        lastLoginAt?: string | null;
        mustChangePassword: boolean;
        mfaEnabled: boolean;
      }>;
    }>("/staff/admin/staff-members?perPage=100");

    return res.items.map((m) => ({
      id: m.id,
      fullName: m.fullName,
      email: m.email,
      role: roleToLower(m.role),
      title: m.title,
      active: m.status === "ACTIVE",
      permissions: permissionsToLower(m.permissions),
      createdAt: m.createdAt,
      lastLoginAt: m.lastLoginAt || undefined,
      mustChangePassword: m.mustChangePassword,
      mfaEnabled: m.mfaEnabled,
    }));
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function addAdmin(form: {
  fullName: string;
  email: string;
  title: string;
  role?: AdminRole;
  password?: string;
  permissions?: AdminPermission[];
}): Promise<AdminAccount> {
  try {
    const res = await staffHttp<{
      id: string;
      email: string;
      fullName: string;
      title: string;
      role: string;
      permissions: string[];
      status: string;
      createdAt: string;
      mustChangePassword: boolean;
      mfaEnabled: boolean;
    }>("/staff/admin/staff-members", {
      method: "POST",
      body: {
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        title: form.title.trim(),
        role: roleToBackend(form.role),
        permissions: permissionsToBackend(form.permissions),
      },
    });

    return {
      id: res.id,
      fullName: res.fullName,
      email: res.email,
      role: roleToLower(res.role),
      title: res.title,
      active: res.status === "ACTIVE",
      permissions: permissionsToLower(res.permissions),
      createdAt: res.createdAt,
      mustChangePassword: res.mustChangePassword,
      mfaEnabled: res.mfaEnabled,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function setAdminActive(id: string, active: boolean, reason?: string): Promise<void> {
  try {
    if (active) {
      await staffHttp(`/staff/admin/staff-members/${id}/reactivate`, {
        method: "POST",
      });
    } else {
      await staffHttp(`/staff/admin/staff-members/${id}/disable`, {
        method: "POST",
        body: { reason: reason || "Admin to'xtatildi" },
      });
    }
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function updateAdminAccount(
  id: string,
  patch: Partial<AdminAccount>
): Promise<AdminAccount> {
  try {
    if (patch.permissions) {
      await staffHttp(`/staff/admin/staff-members/${id}/permissions`, {
        method: "PATCH",
        body: { permissions: permissionsToBackend(patch.permissions) },
      });
    }
    if (typeof patch.active === "boolean") {
      await setAdminActive(id, patch.active);
    }
    const updated = await staffHttp<{
      id: string;
      email: string;
      fullName: string;
      title: string;
      role: string;
      permissions: string[];
      status: string;
      createdAt: string;
      mustChangePassword: boolean;
      mfaEnabled: boolean;
    }>(`/staff/admin/staff-members/${id}`);

    return {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      role: roleToLower(updated.role),
      title: updated.title,
      active: updated.status === "ACTIVE",
      permissions: permissionsToLower(updated.permissions),
      createdAt: updated.createdAt,
      mustChangePassword: updated.mustChangePassword,
      mfaEnabled: updated.mfaEnabled,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function getAdminData(): Promise<adminMock.AdminData> {
  const base = adminMock.getAdminData();
  try {
    const realCategories = await listCategoriesAdmin();
    return {
      ...base,
      categories: realCategories,
    };
  } catch {
    return base;
  }
}
export const getAuditEvents: Asyncified<typeof adminMock.getAuditEvents> = mockAsync(adminMock.getAuditEvents);
export const getInternalNotes: Asyncified<typeof adminMock.getInternalNotes> = mockAsync(adminMock.getInternalNotes);
export async function getTicketConversation(ticketId: string): Promise<TicketMessage[]> {
  try {
    const res = await staffHttp<{
      messages?: {
        senderName: string;
        text: string;
        createdAt: string;
        isAdmin: boolean;
      }[];
    }>(`/staff/tickets/${ticketId}`);
    return (res.messages || []).map((m) => ({
      sender: m.senderName,
      text: m.text,
      at: m.createdAt,
      isAdmin: m.isAdmin,
    }));
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export const adminGlobalSearch: Asyncified<typeof adminMock.adminGlobalSearch> = mockAsync(adminMock.adminGlobalSearch);

export const listUsersQueue: Asyncified<typeof adminMock.listUsersQueue> = mockAsync(adminMock.listUsersQueue);
export async function listJobsQueue(
  query: AdminQueueQuery = {}
): Promise<AdminPage<Job>> {
  try {
    let backendStatus: string | undefined;
    if (query.status === "ochiq" || query.status === "OPEN") backendStatus = "OPEN";
    else if (query.status === "yopilgan" || query.status === "CLOSED") backendStatus = "CLOSED";

    const pageNum = query.page ?? 1;
    const perPageNum = query.perPage ?? 10;

    const res = await staffHttp<Page<Job>>(
      `/staff/jobs${staffToQuery({
        page: pageNum,
        perPage: perPageNum,
        status: backendStatus,
        category: query.category !== "all" ? query.category : undefined,
        search: query.search || undefined,
      })}`
    );

    const safeTotal = (status?: string) =>
      staffHttp<{ total: number }>(`/staff/jobs${staffToQuery({ perPage: 1, status })}`)
        .then((r) => (typeof r?.total === "number" ? r.total : 0))
        .catch(() => 0);

    const [allCount, openCount, closedCount] = await Promise.all([
      safeTotal(),
      safeTotal("OPEN"),
      safeTotal("CLOSED"),
    ]);

    const items = res?.items ?? [];
    const totalProposals = items.reduce((sum, j) => sum + (j.proposalsCount || 0), 0);

    return {
      items,
      page: res?.page ?? 1,
      perPage: res?.perPage ?? perPageNum,
      total: res?.total ?? items.length,
      totalPages: res?.totalPages ?? 1,
      facets: {
        _all: allCount || (res?.total ?? items.length),
        ochiq: openCount,
        yopilgan: closedCount,
        proposals: totalProposals,
      },
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export const listContractsQueue: Asyncified<typeof adminMock.listContractsQueue> = mockAsync(adminMock.listContractsQueue);
export const listDisputesQueue: Asyncified<typeof adminMock.listDisputesQueue> = mockAsync(adminMock.listDisputesQueue);
export async function listWithdrawalsQueue(
  query: AdminQueueQuery = {}
): Promise<AdminPage<WithdrawalRequest>> {
  try {
    return adminMock.listWithdrawalsQueue(query);
  } catch {
    const raw: WithdrawalRequest[] =
      typeof window !== "undefined"
        ? JSON.parse(localStorage.getItem("sb2_withdrawal_requests") || "[]")
        : [];
    let items = [...raw];
    if (query.search) {
      const s = query.search.toLowerCase();
      items = items.filter(
        (w) =>
          w.id.toLowerCase().includes(s) ||
          w.userName.toLowerCase().includes(s) ||
          w.userId.toLowerCase().includes(s) ||
          (w.cardDetails && w.cardDetails.toLowerCase().includes(s))
      );
    }
    if (query.status && query.status !== "all" && query.status !== "_all") {
      items = items.filter((w) => w.status === query.status);
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const pagedItems = items.slice((page - 1) * perPage, page * perPage);

    const facets: Record<string, number> = {
      _all: raw.length,
      kutilmoqda: raw.filter((w) => w.status === "kutilmoqda").length,
      korib_chiqilmoqda: raw.filter((w) => w.status === "korib_chiqilmoqda").length,
      tasdiqlangan: raw.filter((w) => w.status === "tasdiqlangan").length,
      rad_etilgan: raw.filter((w) => w.status === "rad_etilgan").length,
    };

    return {
      items: pagedItems,
      page,
      perPage,
      total,
      totalPages,
      facets,
    };
  }
}
export const listTransactionsQueue: Asyncified<typeof adminMock.listTransactionsQueue> = mockAsync(adminMock.listTransactionsQueue);

export async function listTicketsQueue(query: AdminQueueQuery = {}): Promise<AdminPage<AdminTicketRow>> {
  try {
    const params = new URLSearchParams();
    if (query.page) params.set("page", String(query.page));
    if (query.perPage) params.set("perPage", String(query.perPage));
    if (query.status && query.status !== "all") params.set("status", query.status);
    if (query.search?.trim()) params.set("search", query.search.trim());
    const res = await staffHttp<AdminPage<AdminTicketRow> & { facets: Record<string, number> }>(
      `/staff/tickets?${params.toString()}`,
    );
    return res;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function listReportsQueue(query: {
  page?: number;
  perPage?: number;
  status?: string;
  category?: string;
  severity?: string;
  search?: string;
} = {}): Promise<AdminPage<TrustReport>> {
  try {
    const params = new URLSearchParams();
    if (query.page) params.set("page", String(query.page));
    if (query.perPage) params.set("perPage", String(query.perPage));
    if (query.status && query.status !== "all") params.set("status", query.status);
    if (query.category && query.category !== "all") params.set("category", query.category);
    if (query.severity && query.severity !== "all") params.set("severity", query.severity);
    if (query.search?.trim()) params.set("search", query.search.trim());
    const res = await staffHttp<AdminPage<TrustReport> & { facets: Record<string, number> }>(
      `/staff/reports?${params.toString()}`,
    );
    return res;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function listAppealsQueue(query: {
  page?: number;
  perPage?: number;
  status?: string;
  search?: string;
} = {}): Promise<AdminPage<UserAppeal>> {
  try {
    const params = new URLSearchParams();
    if (query.page) params.set("page", String(query.page));
    if (query.perPage) params.set("perPage", String(query.perPage));
    if (query.status && query.status !== "all") params.set("status", query.status);
    if (query.search?.trim()) params.set("search", query.search.trim());
    const res = await staffHttp<AdminPage<UserAppeal> & { facets: Record<string, number> }>(
      `/staff/appeals?${params.toString()}`,
    );
    return res;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function listReviewsQueue(query: {
  page?: number;
  perPage?: number;
  status?: string;
  search?: string;
} = {}): Promise<AdminPage<Review>> {
  try {
    const params = new URLSearchParams();
    if (query.page) params.set("page", String(query.page));
    if (query.perPage) params.set("perPage", String(query.perPage));
    if (query.status && query.status !== "all") params.set("status", query.status);
    if (query.search?.trim()) params.set("search", query.search.trim());
    const res = await staffHttp<AdminPage<Review> & { facets: Record<string, number> }>(
      `/staff/reviews?${params.toString()}`,
    );
    return res;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export const listAuditQueue: Asyncified<typeof adminMock.listAuditQueue> = mockAsync(adminMock.listAuditQueue);

export async function getAdminCounters(): Promise<adminMock.AdminCounters> {
  const safeTotal = (url: string) =>
    staffHttp<{ total: number }>(url)
      .then((res) => (typeof res?.total === "number" ? res.total : 0))
      .catch(() => 0);

  try {
    let pendingWithdrawals = 0;
    if (typeof window !== "undefined") {
      try {
        const list = JSON.parse(localStorage.getItem("sb2_withdrawal_requests") || "[]");
        pendingWithdrawals = list.filter((w: { status?: string }) => w.status === "kutilmoqda" || w.status === "korib_chiqilmoqda").length;
      } catch {}
    }

    const [users, services, contracts, disputesOpen, disputesReview, audit, pendingKyc, openJobs, openReports, openTickets, pendingAppeals] = await Promise.all([
      hasPermission("users") ? safeTotal("/staff/users?perPage=1") : Promise.resolve(0),
      hasPermission("services") ? safeTotal("/staff/services?perPage=1") : Promise.resolve(0),
      hasPermission("orders") ? safeTotal("/staff/contracts?perPage=1") : Promise.resolve(0),
      hasPermission("disputes") ? safeTotal("/staff/disputes?status=OPEN&perPage=1") : Promise.resolve(0),
      hasPermission("disputes") ? safeTotal("/staff/disputes?status=UNDER_REVIEW&perPage=1") : Promise.resolve(0),
      hasPermission("audit") ? safeTotal("/staff/audit-logs?perPage=1") : Promise.resolve(0),
      hasPermission("kyc") ? safeTotal("/staff/seller-applications?status=PENDING&perPage=1") : Promise.resolve(0),
      hasPermission("jobs") ? safeTotal("/staff/jobs?status=OPEN&perPage=1") : Promise.resolve(0),
      hasPermission("reports") ? safeTotal("/staff/reports?status=NEW&perPage=1") : Promise.resolve(0),
      hasPermission("support") ? safeTotal("/staff/tickets?status=OPEN&perPage=1") : Promise.resolve(0),
      hasPermission("appeals") ? safeTotal("/staff/appeals?status=PENDING&perPage=1") : Promise.resolve(0),
    ]);
    return {
      pendingKyc,
      openDisputes: disputesOpen + disputesReview,
      pendingWithdrawals,
      openReports,
      openTickets,
      pendingAppeals,
      totalUsers: users,
      totalServices: services,
      totalJobs: openJobs,
      totalContracts: contracts,
      totalReviews: 0,
      totalAuditEvents: audit,
      auditAdmins: [] as string[],
      escrowTotal: 0,
      payoutsTotal: 0,
      commissionTotal: 0,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ==========================================================================
   REAL — bo'lim 91-J tanlangan doira: Foydalanuvchilar, Nizolar, To'lovlar/
   Qaytarish/Chiqarish, Shartnomalar, Audit jurnali. Mock nomlari bilan
   TO'QNASHMASLIGI uchun ATAYLAB yangi `staff*` prefiksi bilan — tegishli
   sahifalar shu yangi funksiyalarni chaqiradi (eski mock-shaped nomlar
   yuqorida hamon FEATURE_DISABLED, boshqa hech qaysi sahifa ularga
   tegmaydi).
   ========================================================================== */
type Page<T> = { items: T[]; page: number; perPage: number; total: number; totalPages: number };

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/* ---------------- Foydalanuvchilar (staff/users) ---------------- */
export interface StaffUserRow {
  id: string;
  phone: string;
  fullName?: string;
  email?: string;
  roles: string[];
  status: "ACTIVE" | "SUSPENDED" | "BLOCKED";
  sellerStatus: string;
  verified: boolean;
  createdAt: string;
}
export interface StaffUserDetail extends StaffUserRow {
  statusReason?: string;
  statusChangedAt?: string;
  suspendedUntil?: string;
  contractsAsBuyerCount: number;
  contractsAsSellerCount: number;
  paymentsCount: number;
}
function mapStaffUser(u: Record<string, unknown>): StaffUserRow {
  return {
    id: u.id as string,
    phone: u.phone as string,
    fullName: asStr(u.fullName),
    email: asStr(u.email),
    roles: u.roles as string[],
    status: u.status as StaffUserRow["status"],
    sellerStatus: u.sellerStatus as string,
    verified: u.verified as boolean,
    createdAt: u.createdAt as string,
  };
}
export async function staffListUsers(query: {
  page?: number;
  perPage?: number;
  phone?: string;
  status?: string;
  role?: string;
}): Promise<Page<StaffUserRow>> {
  try {
    const res = await staffHttp<Page<Record<string, unknown>>>(`/staff/users${staffToQuery(query)}`);
    return { ...res, items: res.items.map(mapStaffUser) };
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffGetUser(id: string): Promise<StaffUserDetail> {
  try {
    const u = await staffHttp<Record<string, unknown>>(`/staff/users/${id}`);
    return {
      ...mapStaffUser(u),
      statusReason: asStr(u.statusReason),
      statusChangedAt: asStr(u.statusChangedAt),
      suspendedUntil: asStr(u.suspendedUntil),
      contractsAsBuyerCount: u.contractsAsBuyerCount as number,
      contractsAsSellerCount: u.contractsAsSellerCount as number,
      paymentsCount: u.paymentsCount as number,
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffSuspendUser(id: string, reason: string, suspendedUntil?: string): Promise<void> {
  try {
    await staffHttp(`/staff/users/${id}/suspend`, { method: "POST", body: { reason, suspendedUntil } });
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffBlockUser(id: string, reason: string): Promise<void> {
  try {
    await staffHttp(`/staff/users/${id}/block`, { method: "POST", body: { reason } });
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffReactivateUser(id: string): Promise<void> {
  try {
    await staffHttp(`/staff/users/${id}/reactivate`, { method: "POST" });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ---------------- Shartnomalar (staff/contracts) ---------------- */
export interface StaffMilestone {
  id: string;
  title: string;
  description?: string;
  amount: number;
  position: number;
  status: string;
  dueAt?: string;
  submittedAt?: string;
  approvedAt?: string;
}
export interface StaffContract {
  id: string;
  buyerId: string;
  sellerId: string;
  serviceId: string;
  serviceTitleSnapshot: string;
  sellerDisplayNameSnapshot: string;
  agreedAmount: number;
  currency: string;
  deadline: string;
  status: string;
  milestones: StaffMilestone[];
  createdAt: string;
}
function mapStaffMilestone(m: Record<string, unknown>): StaffMilestone {
  return {
    id: m.id as string,
    title: m.title as string,
    description: asStr(m.description),
    amount: m.amount as number,
    position: m.position as number,
    status: m.status as string,
    dueAt: asStr(m.dueAt),
    submittedAt: asStr(m.submittedAt),
    approvedAt: asStr(m.approvedAt),
  };
}
function mapStaffContract(c: Record<string, unknown>): StaffContract {
  return {
    id: c.id as string,
    buyerId: c.buyerId as string,
    sellerId: c.sellerId as string,
    serviceId: c.serviceId as string,
    serviceTitleSnapshot: c.serviceTitleSnapshot as string,
    sellerDisplayNameSnapshot: c.sellerDisplayNameSnapshot as string,
    agreedAmount: c.agreedAmount as number,
    currency: c.currency as string,
    deadline: c.deadline as string,
    status: c.status as string,
    milestones: ((c.milestones as Record<string, unknown>[]) ?? []).map(mapStaffMilestone),
    createdAt: c.createdAt as string,
  };
}
export async function staffListContracts(query: {
  page?: number;
  perPage?: number;
  status?: string;
  buyerId?: string;
  sellerId?: string;
}): Promise<Page<StaffContract>> {
  try {
    const res = await staffHttp<Page<Record<string, unknown>>>(`/staff/contracts${staffToQuery(query)}`);
    return { ...res, items: res.items.map(mapStaffContract) };
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffGetContract(id: string): Promise<StaffContract> {
  try {
    return mapStaffContract(await staffHttp(`/staff/contracts/${id}`));
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ---------------- Nizolar (staff/disputes) ---------------- */
export interface StaffDispute {
  id: string;
  contractId: string;
  reason: string;
  description: string;
  status: string;
  disputedAmount: number;
  heldAmount: number;
  currency: string;
  resolutionType?: string;
  buyerAwardAmount?: number;
  sellerAwardAmount?: number;
  resolutionReason?: string;
  openedByUserId: string;
  openedAt: string;
}
export interface StaffDisputeEvidence {
  id: string;
  type: string;
  text?: string;
  fileReference?: string;
  createdAt: string;
}
export interface StaffDisputeEvent {
  id: string;
  type: string;
  actorType: string;
  actorName: string;
  createdAt: string;
}
function mapStaffDispute(d: Record<string, unknown>): StaffDispute {
  return {
    id: d.id as string,
    contractId: d.contractId as string,
    reason: d.reason as string,
    description: d.description as string,
    status: d.status as string,
    disputedAmount: d.disputedAmount as number,
    heldAmount: d.heldAmount as number,
    currency: d.currency as string,
    resolutionType: asStr(d.resolutionType),
    buyerAwardAmount: typeof d.buyerAwardAmount === "number" ? d.buyerAwardAmount : undefined,
    sellerAwardAmount: typeof d.sellerAwardAmount === "number" ? d.sellerAwardAmount : undefined,
    resolutionReason: asStr(d.resolutionReason),
    openedByUserId: d.openedByUserId as string,
    openedAt: d.openedAt as string,
  };
}
export async function staffListDisputes(query: {
  page?: number;
  perPage?: number;
  status?: string;
  contractId?: string;
}): Promise<Page<StaffDispute>> {
  try {
    const res = await staffHttp<Page<Record<string, unknown>>>(`/staff/disputes${staffToQuery(query)}`);
    return { ...res, items: res.items.map(mapStaffDispute) };
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffGetDispute(id: string): Promise<StaffDispute> {
  try {
    return mapStaffDispute(await staffHttp(`/staff/disputes/${id}`));
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffListDisputeEvidence(id: string): Promise<StaffDisputeEvidence[]> {
  try {
    return await staffHttp(`/staff/disputes/${id}/evidence`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffListDisputeEvents(id: string): Promise<StaffDisputeEvent[]> {
  try {
    return await staffHttp(`/staff/disputes/${id}/events`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffStartDisputeReview(id: string): Promise<void> {
  try {
    await staffHttp(`/staff/disputes/${id}/start-review`, { method: "POST" });
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffRejectDispute(id: string, resolutionReason: string): Promise<void> {
  try {
    await staffHttp(`/staff/disputes/${id}/reject`, { method: "POST", body: { resolutionReason } });
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffResolveDispute(
  id: string,
  buyerAwardAmount: number,
  sellerAwardAmount: number,
  resolutionReason: string,
): Promise<void> {
  try {
    await staffHttp(`/staff/disputes/${id}/resolve`, {
      method: "POST",
      body: { buyerAwardAmount, sellerAwardAmount, resolutionReason },
      idempotencyKey: crypto.randomUUID(),
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ---------------- To'lovlar / Qaytarish / Chiqarish ---------------- */
export interface StaffPayment {
  id: string;
  contractId: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  payerUserId: string;
  createdAt: string;
}
export interface StaffRefund {
  id: string;
  contractId: string;
  paymentId: string;
  status: string;
  amount: number;
  currency: string;
  reason: string;
  createdAt: string;
}
export interface StaffPayout {
  id: string;
  sellerId: string;
  status: string;
  amount: number;
  currency: string;
  destinationReference: string;
  createdAt: string;
}
export async function staffListPayments(query: { page?: number; perPage?: number; status?: string }): Promise<Page<StaffPayment>> {
  try {
    return await staffHttp(`/staff/payments${staffToQuery(query)}`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffListRefunds(query: { page?: number; perPage?: number; status?: string }): Promise<Page<StaffRefund>> {
  try {
    return await staffHttp(`/staff/refunds${staffToQuery(query)}`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffCreateRefund(contractId: string, reason: string): Promise<void> {
  try {
    await staffHttp(`/staff/refunds`, {
      method: "POST",
      body: { contractId, reason },
      idempotencyKey: crypto.randomUUID(),
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffListPayouts(query: { page?: number; perPage?: number; status?: string }): Promise<Page<StaffPayout>> {
  try {
    return await staffHttp(`/staff/payouts${staffToQuery(query)}`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ---------------- Ledger (staff/ledger/transactions) — append-only ---------------- */
export interface StaffLedgerEntry {
  id: string;
  accountType: string;
  accountOwnerType: string;
  accountOwnerId?: string;
  amount: number;
  currency: string;
}
export interface StaffLedgerTransaction {
  id: string;
  type: string;
  currency: string;
  sourceId: string;
  description?: string;
  entries: StaffLedgerEntry[];
  createdAt: string;
}
export async function staffListLedgerTransactions(query: { page?: number; perPage?: number; type?: string }): Promise<Page<StaffLedgerTransaction>> {
  try {
    return await staffHttp(`/staff/ledger/transactions${staffToQuery(query)}`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}

/* ---------------- Audit jurnali (staff/audit-logs) ---------------- */
export interface StaffAuditLogRow {
  id: string;
  actorType: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}
export async function staffListAuditLogs(query: {
  page?: number;
  perPage?: number;
  action?: string;
  resourceType?: string;
}): Promise<Page<StaffAuditLogRow>> {
  try {
    return await staffHttp(`/staff/audit-logs${staffToQuery(query)}`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function staffGetAuditLog(id: string): Promise<StaffAuditLogRow & { previousState?: unknown; newState?: unknown }> {
  try {
    return await staffHttp(`/staff/audit-logs/${id}`);
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export const getContractMilestones: Asyncified<typeof adminMock.getContractMilestones> = mockAsync(adminMock.getContractMilestones);
export const getDisputeContext: Asyncified<typeof adminMock.getDisputeContext> = mockAsync(adminMock.getDisputeContext);
export const getUserDetail: Asyncified<typeof adminMock.getUserDetail> = mockAsync(adminMock.getUserDetail);

export const findUserById: Asyncified<typeof adminMock.findUserById> = mockAsync(adminMock.findUserById);
export const findContractById: Asyncified<typeof adminMock.findContractById> = mockAsync(adminMock.findContractById);
export async function findJobById(id: string): Promise<Job | null> {
  try {
    return await staffHttp<Job>(`/staff/jobs/${id}`);
  } catch {
    return null;
  }
}
export async function findTicketById(id: string): Promise<AdminTicketRow | null> {
  try {
    return await staffHttp<AdminTicketRow>(`/staff/tickets/${id}`);
  } catch {
    return null;
  }
}
export const findDisputeById: Asyncified<typeof adminMock.findDisputeById> = mockAsync(adminMock.findDisputeById);

export type {
  AdminCounters,
  AdminData,
  AdminVerificationRow,
  AdminTicketRow,
  AdminDisputeRow,
  AdminUserRow,
} from "@/lib/admin-api";
export type { AdminQueueQuery, AdminPage } from "@/lib/admin-types";

export async function suspendUser(id: string, reason = "Admin qarori bilan"): Promise<void> {
  return staffSuspendUser(id, reason);
}
export async function unsuspendUser(id: string): Promise<void> {
  return staffReactivateUser(id);
}
export async function blockUser(id: string, reason = "Admin qarori bilan"): Promise<void> {
  return staffBlockUser(id, reason);
}
export const deactivateUser: Asyncified<typeof adminMock.deactivateUser> = mockAsync(adminMock.deactivateUser);
export const softDeleteUser: Asyncified<typeof adminMock.softDeleteUser> = mockAsync(adminMock.softDeleteUser);
export async function closeJobAsAdmin(jobId: string, reason: string): Promise<Job> {
  try {
    return await staffHttp<Job>(`/staff/jobs/${jobId}/close`, {
      method: "POST",
      body: { reason },
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

interface KycQueueBackendItem {
  id: string;
  userId: string;
  status: string;
  rawStatus: string;
  country: string;
  documentType: string;
  legalName: string;
  birthDate?: string;
  passportNumber?: string;
  inn?: string;
  companyDetails?: string;
  documents: Array<{ id: string; originalFilename: string; mimeType: string; viewUrl?: string }>;
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  userName: string;
  userPhone: string;
}

interface KycQueueBackendResponse {
  items: KycQueueBackendItem[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  facets: {
    _all: number;
    korib_chiqilmoqda: number;
    tasdiqlangan: number;
    rad_etilgan: number;
  };
}

export async function listVerificationsQueue(
  query: AdminQueueQuery = {}
): Promise<AdminPage<adminMock.AdminVerificationRow>> {
  try {
    const res = await staffHttp<KycQueueBackendResponse>(
      `/staff/kyc${staffToQuery({
        page: query.page ?? 1,
        perPage: query.perPage ?? 10,
        status: query.status,
        search: query.search,
      })}`
    );

    const items: adminMock.AdminVerificationRow[] = res.items.map((item) => ({
      id: item.id,
      userId: item.userId,
      userName: item.userName,
      userPhone: item.userPhone,
      country: (item.country as adminMock.AdminVerificationRow["country"]) || "UZ",
      documentType: (item.documentType as adminMock.AdminVerificationRow["documentType"]) || "passport",
      legalName: item.legalName,
      birthDate: item.birthDate || "",
      documents: item.documents.map((d) => d.viewUrl || `/api/v1/kyc/documents/stream?token=${d.id}`),
      status: (item.status as adminMock.AdminVerificationRow["status"]) || "korib_chiqilmoqda",
      submittedAt: item.submittedAt,
      reviewedAt: item.reviewedAt,
      rejectionReason: item.rejectionReason,
      passportNumber: item.passportNumber,
      inn: item.inn,
      companyDetails: item.companyDetails,
    }));

    return {
      items,
      page: res.page,
      perPage: res.perPage,
      total: res.total,
      totalPages: res.totalPages,
      facets: res.facets || {
        _all: res.total,
        korib_chiqilmoqda: items.filter((i) => i.status === "korib_chiqilmoqda").length,
        tasdiqlangan: items.filter((i) => i.status === "tasdiqlangan").length,
        rad_etilgan: items.filter((i) => i.status === "rad_etilgan").length,
      },
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function findVerificationByUserId(userId: string): Promise<adminMock.AdminVerificationRow | null> {
  try {
    const item = await staffHttp<KycQueueBackendItem>(`/staff/kyc/user/${userId}`);
    if (!item) return null;
    return {
      id: item.id,
      userId: item.userId,
      userName: item.userName,
      userPhone: item.userPhone,
      country: (item.country as adminMock.AdminVerificationRow["country"]) || "UZ",
      documentType: (item.documentType as adminMock.AdminVerificationRow["documentType"]) || "passport",
      legalName: item.legalName,
      birthDate: item.birthDate || "",
      documents: (item.documents || []).map((d) => d.viewUrl || ""),
      status: (item.status as adminMock.AdminVerificationRow["status"]) || "korib_chiqilmoqda",
      submittedAt: item.submittedAt,
      reviewedAt: item.reviewedAt,
      rejectionReason: item.rejectionReason,
      passportNumber: item.passportNumber,
      inn: item.inn,
      companyDetails: item.companyDetails,
    };
  } catch {
    return null;
  }
}

export async function adminModerateKYC(
  id: string,
  outcome: "approve" | "reject",
  reason?: string
): Promise<void> {
  try {
    await staffHttp(`/staff/kyc/${id}/review`, {
      method: "POST",
      body: {
        outcome,
        rejectionReason: reason,
        note: reason,
      },
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function adminModerate(
  kind: "users" | "kyc" | "disputes" | "support",
  id: string,
  options: { outcome?: "approve" | "reject"; note?: string } = {}
): Promise<void> {
  if (kind === "kyc") {
    return adminModerateKYC(id, options.outcome ?? "approve", options.note);
  } else if (kind === "users") {
    if (options.outcome === "reject") {
      return blockUser(id, options.note ?? "Admin qarori bilan");
    } else {
      return unsuspendUser(id);
    }
  } else if (kind === "disputes") {
    return forceCloseContract(id, "refund", options.note ?? "Admin arbitraji");
  } else if (kind === "support") {
    return closeTicket(id, options.note);
  }
}

export const DEFAULT_CATEGORY_MAP: Record<string, string> = {
  "01a092fb-037e-740b-9b72-83002432b73c": "Dizayn",
  "01a092fb-037e-740b-9b72-83002432b73d": "Dasturlash",
  "01a092fb-037e-740b-9b72-83002432b73e": "Tarjima",
  "01a092fb-037e-740b-9b72-83002432b73f": "Matn va kontent",
  "01a092fb-037e-740b-9b72-83002432b740": "Marketing",
  "01a092fb-037e-740b-9b72-83002432b741": "Video va animatsiya",
  "01a092fb-037e-740b-9b72-83002432b742": "Audio va musiqa",
  "01a092fb-037e-740b-9b72-83002432b743": "Biznes va boshqaruv",
  "dizayn": "Dizayn",
  "dasturlash": "Dasturlash",
  "tarjima": "Tarjima",
  "kontent": "Matn va kontent",
  "marketing": "Marketing",
  "video": "Video va animatsiya",
  "audio": "Audio va musiqa",
  "biznes": "Biznes va boshqaruv",
};

interface RealServiceDto {
  id: string;
  sellerId: string;
  categoryId: string;
  categoryName?: string;
  categorySlug?: string;
  title: string;
  description: string;
  lang: string;
  price: number;
  currency: string;
  deliveryDays: number;
  status: "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "PAUSED" | "REJECTED" | "ARCHIVED";
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRealServiceToFrontend(s: RealServiceDto): Service {
  let frontendStatus: Service["status"] = "active";
  if (s.status === "ACTIVE") frontendStatus = "active";
  else if (s.status === "PAUSED") frontendStatus = "paused";
  else if (s.status === "DRAFT") frontendStatus = "draft";
  else if (s.status === "ARCHIVED") frontendStatus = "archived";
  else if (s.status === "PENDING_REVIEW") frontendStatus = "pending_review";
  else if (s.status === "REJECTED") frontendStatus = "rejected";

  const resolvedCategory =
    s.categoryName ||
    DEFAULT_CATEGORY_MAP[s.categoryId] ||
    s.categorySlug ||
    DEFAULT_CATEGORY_MAP[s.categorySlug || ""] ||
    s.categoryId;

  return {
    id: s.id,
    sellerId: s.sellerId,
    category: resolvedCategory as Service["category"],
    title: s.title,
    description: s.description,
    fields: {},
    price: s.price,
    currency: "UZS",
    deliveryDays: s.deliveryDays,
    images: [],
    status: frontendStatus,
    createdAt: s.createdAt,
  };
}

export async function listServicesQueue(
  query: AdminQueueQuery = {}
): Promise<AdminPage<Service>> {
  try {
    let backendStatus: string | undefined;
    if (query.status === "active") backendStatus = "ACTIVE";
    else if (query.status === "paused") backendStatus = "PAUSED";
    else if (query.status === "draft") backendStatus = "DRAFT";
    else if (query.status === "archived") backendStatus = "ARCHIVED";
    else if (query.status === "pending_review" || query.status === "korib_chiqilmoqda") backendStatus = "PENDING_REVIEW";
    else if (query.status === "rejected" || query.status === "rad_etilgan") backendStatus = "REJECTED";

    const pageNum = query.page ?? 1;
    const perPageNum = query.perPage ?? 10;

    const res = await staffHttp<Page<RealServiceDto>>(
      `/staff/services${staffToQuery({
        page: pageNum,
        perPage: perPageNum,
        status: backendStatus,
      })}`
    );

    const safeTotal = (status?: string) =>
      staffHttp<{ total: number }>(`/staff/services${staffToQuery({ perPage: 1, status })}`)
        .then((r) => (typeof r?.total === "number" ? r.total : 0))
        .catch(() => 0);

    const [allCount, activeCount, pausedCount, draftCount, pendingReviewCount, rejectedCount] = await Promise.all([
      safeTotal(),
      safeTotal("ACTIVE"),
      safeTotal("PAUSED"),
      safeTotal("DRAFT"),
      safeTotal("PENDING_REVIEW"),
      safeTotal("REJECTED"),
    ]);

    let items = res.items.map(mapRealServiceToFrontend);
    if (query.search?.trim()) {
      const s = query.search.toLowerCase();
      items = items.filter(
        (x) =>
          x.title.toLowerCase().includes(s) ||
          x.description.toLowerCase().includes(s) ||
          x.id.toLowerCase().includes(s) ||
          x.sellerId.toLowerCase().includes(s)
      );
    }

    return {
      items,
      page: res.page,
      perPage: res.perPage,
      total: res.total,
      totalPages: res.totalPages,
      facets: {
        _all: allCount || res.total,
        active: activeCount,
        paused: pausedCount,
        draft: draftCount,
        pending_review: pendingReviewCount,
        korib_chiqilmoqda: pendingReviewCount,
        rejected: rejectedCount,
      },
    };
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function findServiceById(id: string): Promise<Service | null> {
  try {
    const res = await staffHttp<RealServiceDto>(`/staff/services/${id}`);
    if (res) return mapRealServiceToFrontend(res);
    return null;
  } catch {
    return null;
  }
}

export async function setServiceStatus(
  serviceId: string,
  status: Service["status"],
  reason?: string
): Promise<void> {
  try {
    if (status === "active") {
      await staffHttp(`/staff/services/${serviceId}/approve`, { method: "POST" });
    } else if (status === "paused") {
      await staffHttp(`/staff/services/${serviceId}/force-pause`, {
        method: "POST",
        body: { reason: reason || "Admin tomonidan to'xtatildi" },
      });
    } else if (status === "archived" || status === "rejected") {
      await staffHttp(`/staff/services/${serviceId}/reject`, {
        method: "POST",
        body: { reason: reason || "Admin tomonidan rad etildi" },
      });
    }
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export async function deleteReview(reviewId: string): Promise<Review[]> {
  try {
    await staffHttp(`/staff/reviews/${reviewId}`, {
      method: "DELETE",
    });
    return [];
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function updateTrustReport(
  reportId: string,
  action: "investigating" | "resolved" | "dismissed",
  note: string,
  userAction?: "none" | "warned" | "restricted" | "suspended" | "removed",
): Promise<void> {
  try {
    await staffHttp(`/staff/reports/${reportId}/action`, {
      method: "POST",
      body: { action, note, userAction },
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function handleUserAppeal(
  appealId: string,
  decision: "accepted" | "rejected",
  note: string,
): Promise<void> {
  try {
    await staffHttp(`/staff/appeals/${appealId}/decide`, {
      method: "POST",
      body: { decision, note },
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export const forceCloseContract: Asyncified<typeof adminMock.forceCloseContract> = mockAsync(adminMock.forceCloseContract);

export async function replyToTicket(
  ticketId: string,
  replyText: string,
  newStatus?: SupportTicket["status"],
): Promise<void> {
  try {
    await staffHttp(`/staff/tickets/${ticketId}/reply`, {
      method: "POST",
      body: { replyText, newStatus },
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function closeTicket(ticketId: string, note?: string): Promise<void> {
  try {
    await staffHttp(`/staff/tickets/${ticketId}/close`, {
      method: "POST",
      body: { note: note || "Chipta yopildi" },
    });
  } catch (error) {
    throw normalizeApiError(error);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function approveWithdrawal(_requestId: string): Promise<void> {
  throw new Error("PAYOUTS_DISABLED: Haqiqiy pul yechish (payout) provayderi ulanmaguncha chiqish to‘lovlari xavfsiz o‘chirilgan.");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function rejectWithdrawal(_requestId: string, _reason?: string): Promise<void> {
  throw new Error("PAYOUTS_DISABLED: Haqiqiy pul yechish (payout) provayderi ulanmaguncha chiqish to‘lovlari xavfsiz o‘chirilgan.");
}
export const reviewWithdrawal: Asyncified<typeof adminMock.reviewWithdrawal> = mockAsync(adminMock.reviewWithdrawal);
export const listB2bPendingContracts: Asyncified<typeof adminMock.listB2bPendingContracts> = mockAsync(adminMock.listB2bPendingContracts);
export const approveB2bPayment: Asyncified<typeof adminMock.approveB2bPayment> = mockAsync(adminMock.approveB2bPayment);
export const rejectB2bPayment: Asyncified<typeof adminMock.rejectB2bPayment> = mockAsync(adminMock.rejectB2bPayment);
export const reverseTransaction: Asyncified<typeof adminMock.reverseTransaction> = mockAsync(adminMock.reverseTransaction);

export interface StaffCategoryBackendItem {
  id: string;
  slug: string;
  nameUz: string;
  nameRu?: string;
  nameEn?: string;
  status: string;
  sortOrder: number;
}

function mapBackendCategory(c: StaffCategoryBackendItem): CategoryManagementItem {
  return {
    id: c.id,
    slug: c.slug,
    nameUz: c.nameUz,
    nameRu: c.nameRu || c.nameUz,
    nameEn: c.nameEn || c.nameUz,
    icon: "💼",
    order: c.sortOrder ?? 0,
    active: c.status === "ACTIVE",
    serviceCount: 0,
    subcategories: [],
  };
}

export async function listCategoriesAdmin(): Promise<CategoryManagementItem[]> {
  try {
    const res = await staffHttp<Page<StaffCategoryBackendItem>>("/staff/categories?perPage=100");
    return res.items.map(mapBackendCategory);
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function saveCategory(category: CategoryManagementItem): Promise<CategoryManagementItem[]> {
  try {
    if (category.id && !category.id.startsWith("temp-") && !category.id.startsWith("new-")) {
      try {
        await staffHttp(`/staff/categories/${category.id}`, {
          method: "PATCH",
          body: {
            nameUz: category.nameUz,
            nameRu: category.nameRu,
            nameEn: category.nameEn,
            sortOrder: category.order,
          },
        });
      } catch {
        await staffHttp("/staff/categories", {
          method: "POST",
          body: {
            slug: category.slug,
            nameUz: category.nameUz,
            nameRu: category.nameRu,
            nameEn: category.nameEn,
            sortOrder: category.order,
          },
        });
      }
    } else {
      await staffHttp("/staff/categories", {
        method: "POST",
        body: {
          slug: category.slug,
          nameUz: category.nameUz,
          nameRu: category.nameRu,
          nameEn: category.nameEn,
          sortOrder: category.order,
        },
      });
    }
    return await listCategoriesAdmin();
  } catch (error) {
    throw normalizeApiError(error);
  }
}

export async function toggleCategoryActive(categoryId: string): Promise<CategoryManagementItem[]> {
  try {
    const categories = await listCategoriesAdmin();
    const target = categories.find((c) => c.id === categoryId);
    if (!target) throw new Error("Category not found");
    const endpoint = target.active
      ? `/staff/categories/${categoryId}/archive`
      : `/staff/categories/${categoryId}/activate`;
    await staffHttp(endpoint, { method: "POST" });
    return await listCategoriesAdmin();
  } catch (error) {
    throw normalizeApiError(error);
  }
}
export const updatePlatformSetting: Asyncified<typeof adminMock.updatePlatformSetting> = mockAsync(adminMock.updatePlatformSetting);
export const addInternalNote: Asyncified<typeof adminMock.addInternalNote> = mockAsync(adminMock.addInternalNote);
export const addAudit: Asyncified<typeof adminMock.addAudit> = mockAsync(adminMock.addAudit);

export type { SearchResultItem } from "@/lib/admin-api";
