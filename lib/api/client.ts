import type { components } from "@bobololadono/contracts";
import type {
  AuthService,
  CatalogService,
  ContractsService,
  DisputesService,
  FilesService,
  JobsService,
  MessagesService,
  MilestonesService,
  NotificationsService,
  OffersService,
  PaymentsService,
  ProposalsService,
  ReviewsService,
  SavedService,
  SellerApplicationService,
  ServicesService,
  SupportRequestService,
  SupportService,
  UsersService,
  VerificationService,
} from "./contracts";
import { ApiError, withNormalizedErrors } from "./errors";
import { http, toQuery, sessionStore, setAccessToken, decodeJwtSub, refreshSession } from "./http";
import {
  asStr,
  mapContract,
  mapDispute,
  mapMilestone,
  mapPayment,
  mapPayout,
  mapPublicService,
  mapSellerApplicationStatus,
  mapSellerProfile,
  mapService,
  mapUser,
  roleToReal,
  roleToUz,
} from "./mappers";
import type * as Model from "@/lib/types";
import { MIN_JOB_BUDGET, isTestService } from "@/lib/validate";
import {
  getMessages,
  getAllMessages,
  sendMessage,
  getThreadReads,
  markThreadRead,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createOffer,
  getOffer,
  getSentOffers,
  getIncomingOffers,
  withdrawOffer,
  declineOffer,
} from "@/lib/mock-api";

type RealService = components["schemas"]["ServiceResponseDto"];
type RealPublicService = components["schemas"]["PublicServiceResponseDto"];
type RealContract = components["schemas"]["ContractResponseDto"];
type RealMilestone = components["schemas"]["MilestoneResponseDto"];
type RealPayment = components["schemas"]["PaymentResponseDto"];
type RealPayout = components["schemas"]["PayoutResponseDto"];
type RealDispute = components["schemas"]["DisputeResponseDto"];
type RealMe = components["schemas"]["MeResponseDto"];
type RealSellerApplication = components["schemas"]["SellerApplicationResponseDto"];
type RealCategory = components["schemas"]["CategoryResponseDto"];
type RealAuthSession = components["schemas"]["AuthSessionDto"];
type Page<T> = { items: T[]; page: number; perPage: number; total: number; totalPages: number };

const call = <T>(operation: () => Promise<T>) => withNormalizedErrors(operation);

/** Fetch every page; reject failures instead of reporting partial financial totals. */
async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await http<Page<T>>(`${path}${toQuery({ page, perPage: 100 })}`);
    items.push(...result.items);
    totalPages = result.totalPages;
    page += 1;
  } while (page <= totalPages);
  return items;
}

/** Bosqich 17 — real backendda hali qamrab olinmagan operatsiya: `client.ts`
    ATAYLAB shu kodni tashlaydi, `errors.ts#LEGACY_CODES` uni `FEATURE_DISABLED`
    ga o'giradi va mavjud `<ErrorState>` konvensiyasi ekranni ko'rsatadi. */
function disabled<T = never>(): Promise<T> {
  return Promise.reject(new Error("FEATURE_DISABLED"));
}

function currentRole(): Model.UserRole | null {
  return sessionStore.read()?.role ?? null;
}

/* ------------------------------------------------------------------------
   Kategoriyalar — ochiq, kam o'zgaradigan katalog; modul darajasida
   keshlanadi (ko'p joyda categoryId <-> slug tarjimasi kerak).
   ------------------------------------------------------------------------ */
const FALLBACK_CATEGORY_IDS: Record<string, string> = {
  dizayn: "01a092fb-037e-740b-9b72-83002432b73c",
  dasturlash: "01a092fb-037e-740b-9b72-83002432b73d",
  tarjima: "01a092fb-037e-740b-9b72-83002432b73e",
  kontent: "01a092fb-037e-740b-9b72-83002432b73f",
  marketing: "01a092fb-037e-740b-9b72-83002432b740",
  video: "01a092fb-037e-740b-9b72-83002432b741",
  audio: "01a092fb-037e-740b-9b72-83002432b742",
  biznes: "01a092fb-037e-740b-9b72-83002432b743",
};

let categoriesCache: RealCategory[] | null = null;
async function getCategories(force = false): Promise<RealCategory[]> {
  if (!force && categoriesCache && categoriesCache.length > 0) return categoriesCache;
  try {
    const list = await http<RealCategory[]>("/categories");
    if (Array.isArray(list) && list.length > 0) {
      categoriesCache = list;
      return list;
    }
  } catch {
    // network or api error, use cached or empty
  }
  return categoriesCache ?? [];
}
function slugById(categories: RealCategory[], id: string): string {
  const found = categories.find((c) => c.id === id)?.slug;
  if (found) return found;
  const fallback = Object.entries(FALLBACK_CATEGORY_IDS).find(([, v]) => v === id)?.[0];
  return fallback ?? "biznes";
}
function idBySlug(categories: RealCategory[], slug: string): string | undefined {
  const normalized = slug.trim().toLowerCase();
  const found = categories.find((c) => c.slug.trim().toLowerCase() === normalized)?.id;
  return found ?? FALLBACK_CATEGORY_IDS[normalized];
}

/* ------------------------------------------------------------------------
   Shartnoma "mablag'langanmi" — real `ContractResponseDto`ning o'zida yo'q.
   Xaridor uchun `/me/payments?contractId=` orqali ANIQ, sotuvchi uchun
   ochiq endpoint yo'q — bosqich holatidan TAXMIN qilinadi. MUHIM: bosqich
   `ACTIVE` bo'lishi bilanoq (hali TO'LANMAGAN bo'lsa ham) `IN_PROGRESS`ga
   o'tadi (to'lovga bog'liq emas) — shuning uchun bu taxmin aslida "faol"
   bilan deyarli bir xil, aniq "to'langan" emas. Haqiqiy himoya baribir
   serverda: `submitMilestone` `CONTRACT_NOT_FUNDED`ni mustaqil tekshiradi —
   shu sabab bu yerdagi noaniqlik xavfsiz (eng yomoni: sotuvchi "topshirish"
   tugmasini erta ko'radi-yu, server uni rad etadi).
   ------------------------------------------------------------------------ */
async function hydrateContract(c: RealContract): Promise<Model.Contract> {
  return mapContract(c, { funded: c.isFunded === true, fundedAt: c.fundedAt ? asStr(c.fundedAt) : undefined });
}

/* ==========================================================================
   AUTH — Bosqich 21: parol bilan login. SMS FAQAT register/reset'da.
   Sessiya snapshot `lib/api/http.ts`da.
   ========================================================================== */
function writeSession(res: RealAuthSession): Model.Session {
  setAccessToken(res.accessToken);
  const session: Model.Session = {
    userId: decodeJwtSub(res.accessToken),
    role: roleToUz(res.activeRole),
    profileDone: res.profileDone,
    verified: true,
  };
  sessionStore.write(session);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "session", session } })
    );
  }
  return session;
}

export const authService: AuthService = {
  getSession: sessionStore.read,
  requestRegisterOtp: (phone) =>
    call(async () =>
      http<{ sent: true; devOtp?: string }>("/auth/register/request-otp", { method: "POST", body: { phone } }),
    ),
  verifyRegisterOtp: (phone, code) =>
    call(async () =>
      http<{ registrationToken: string }>("/auth/register/verify-otp", { method: "POST", body: { phone, code } }),
    ),
  completeRegistration: (registrationToken, password, confirmPassword) =>
    call(async () => {
      const res = await http<RealAuthSession>("/auth/register/complete", {
        method: "POST",
        body: { registrationToken, password, confirmPassword },
      });
      return writeSession(res);
    }),
  login: (phone, password) =>
    call(async () => {
      const res = await http<RealAuthSession>("/auth/login", { method: "POST", body: { phone, password } });
      return writeSession(res);
    }),
  requestPasswordResetOtp: (phone) =>
    call(async () =>
      http<{ sent: true; devOtp?: string }>("/auth/password-reset/request-otp", {
        method: "POST",
        body: { phone },
      }),
    ),
  verifyPasswordResetOtp: (phone, code) =>
    call(async () =>
      http<{ resetToken: string }>("/auth/password-reset/verify-otp", { method: "POST", body: { phone, code } }),
    ),
  completePasswordReset: (resetToken, password, confirmPassword) =>
    call(async () =>
      http<{ ok: true }>("/auth/password-reset/complete", {
        method: "POST",
        body: { resetToken, password, confirmPassword },
      }),
    ),
  chooseRole: (role) =>
    call(async () => {
      // Only a server-issued token may change the authenticated UI snapshot.
      const endpoint = sessionStore.read()?.role ? "/me/roles/switch" : "/me/roles/choose";
      const res = await http<RealAuthSession>(endpoint, {
        method: "POST", body: { role: roleToReal(role) },
      });
      return writeSession(res);
    }),
  refresh: () => call(refreshSession),
  logout: async () => {
    try {
      await http("/auth/logout", { method: "POST" }, false);
    } catch {}
    setAccessToken(null);
    sessionStore.clear();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "session", session: null } })
      );
    }
  },
};

/* ==========================================================================
   USERS — `/me` + `/me/profile`. Boy sotuvchi profili (bio/skills/portfolio)
   real backendda YO'Q — `setAvailability`/preferences/parol/eksport/o'chirish
   ham (OTP-only hisobda parol tushunchasi yo'q).
   ========================================================================== */
export const usersService: UsersService = {
  getCurrent: () =>
    call(async () => {
      try {
        const user = mapUser(await http<RealMe>("/me"));
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(`bbd_buyer_profile_${user.id}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              if (parsed.companyName) user.companyName = parsed.companyName;
              if (parsed.industry) user.industry = parsed.industry;
              if (parsed.website) user.website = parsed.website;
              if (parsed.location) user.location = parsed.location;
              if (parsed.bio) user.bio = parsed.bio;
              if (parsed.avatarUrl) user.avatarUrl = parsed.avatarUrl;
            }
          } catch {}
        }
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.code === "UNAUTHENTICATED") return null;
        throw e;
      }
    }),
  getSellerProfile: () =>
    call(async () => {
      const me = await http<RealMe>("/me");
      let application: RealSellerApplication | null = null;
      try {
        application = await http<RealSellerApplication>("/me/seller-application");
      } catch {
        /* hali ariza yo'q */
      }
      const profile = mapSellerProfile(me, application);
      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem(`bbd_seller_profile_${me.id}`);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.bio) profile.bio = parsed.bio;
            if (parsed.headline) profile.headline = parsed.headline;
            if (Array.isArray(parsed.skills)) profile.skills = parsed.skills;
            if (Array.isArray(parsed.categories)) profile.categories = parsed.categories;
            if (parsed.location) profile.location = parsed.location;
            if (Array.isArray(parsed.languages)) profile.languages = parsed.languages;
            if (Array.isArray(parsed.portfolio)) profile.portfolio = parsed.portfolio;
            if (parsed.avatarUrl) profile.avatarUrl = parsed.avatarUrl;
          }
          const storedAvail = localStorage.getItem(`bbd_avail_${me.id}`);
          if (storedAvail !== null) {
            profile.available = storedAvail === "true";
          }
        } catch {}
      }
      return profile;
    }),
  updateName: (fullName) => call(async () => void (await http("/me/profile", { method: "PATCH", body: { fullName } }))),
  updateUserProfile: (data) =>
    call(async () => {
      const patchBody: Record<string, unknown> = {};
      if (data.fullName) patchBody.fullName = data.fullName;
      if (data.avatarUrl !== undefined) patchBody.avatarKey = data.avatarUrl || null;
      if (Object.keys(patchBody).length > 0) {
        await http("/me/profile", { method: "PATCH", body: patchBody });
      }
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? "me";
          const key = `bbd_buyer_profile_${uid}`;
          const existing = JSON.parse(localStorage.getItem(key) || "{}");
          const merged = { ...existing, ...data };
          localStorage.setItem(key, JSON.stringify(merged));
          window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "profile", data } }));
        } catch {}
      }
    }),
  completeSellerProfile: (input) =>
    call(async () => void (await http("/me/profile", { method: "PATCH", body: { fullName: input.fullName } }))),
  updateSellerProfile: (input) =>
    call(async () => {
      const patchBody: Record<string, unknown> = {};
      if (input.fullName) patchBody.fullName = input.fullName;
      if (input.avatarUrl !== undefined) patchBody.avatarKey = input.avatarUrl || null;
      if (Object.keys(patchBody).length > 0) {
        await http("/me/profile", { method: "PATCH", body: patchBody });
      }
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? "me";
          const existing = JSON.parse(localStorage.getItem(`bbd_seller_profile_${uid}`) || "{}");
          const merged = { ...existing, ...input };
          localStorage.setItem(`bbd_seller_profile_${uid}`, JSON.stringify(merged));
          window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "profile", input } }));
        } catch {}
      }
    }),
  updateAvatar: (avatarUrl: string) =>
    call(async () => {
      await http("/me/profile", {
        method: "PATCH",
        body: { avatarKey: avatarUrl || null },
      });
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? "me";
          const buyerKey = `bbd_buyer_profile_${uid}`;
          const bExisting = JSON.parse(localStorage.getItem(buyerKey) || "{}");
          localStorage.setItem(buyerKey, JSON.stringify({ ...bExisting, avatarUrl }));

          const sellerKey = `bbd_seller_profile_${uid}`;
          const sExisting = JSON.parse(localStorage.getItem(sellerKey) || "{}");
          localStorage.setItem(sellerKey, JSON.stringify({ ...sExisting, avatarUrl }));
        } catch {}
        window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "avatar", avatarUrl } }));
      }
    }),
  setAvailability: (available: boolean) =>
    call(async () => {
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? "me";
          localStorage.setItem(`bbd_avail_${uid}`, String(available));
        } catch {}
      }
    }),
  getPreferences: () =>
    call(async () => {
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? "me";
          const stored = localStorage.getItem(`bbd_pref_${uid}`);
          if (stored) return JSON.parse(stored);
        } catch {}
      }
      return {
        messages: true,
        contracts: true,
        payments: true,
        marketing: false,
        proposals: true,
      };
    }),
  savePreferences: (preferences: Model.AccountPreferences) =>
    call(async () => {
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? "me";
          localStorage.setItem(`bbd_pref_${uid}`, JSON.stringify(preferences));
        } catch {}
      }
    }),
  // Bosqich 21 — `User.passwordHash` endi haqiqiy (avval OTP-only edi,
  // almashtiradigan parol umuman yo'q edi).
  changePassword: (currentPassword, newPassword) =>
    call(async () => {
      await http("/me/change-password", { method: "POST", body: { currentPassword, newPassword } });
    }),
  exportData: () =>
    call(async () => {
      const me = await http<RealMe>("/me").catch(() => null);
      let app = null;
      try {
        app = await http<RealSellerApplication>("/me/seller-application");
      } catch {}
      return {
        exportedAt: new Date().toISOString(),
        user: me,
        application: app,
        platform: "Bobololadono",
      };
    }),
  // Logout is not account deletion. Fail explicitly until deletion is supported.
  deleteAccount: () => disabled(),
};

/* ==========================================================================
   CATALOG — ochiq mutaxassis direktoriyasi real backendda YO'Q (faqat
   xodimlarga `staff/sellers`); sharh modeli ham yo'q (bo'sh ro'yxat).
   ========================================================================== */
function fallbackSellerProfile(userId: string): Model.SellerProfile {
  return {
    userId,
    headline: "Professional mutaxassis",
    bio: "Bobololadono platformasidagi tasdiqlangan mutaxassis.",
    location: "Toshkent",
    skills: ["Dasturlash", "Dizayn"],
    categories: ["dasturlash", "dizayn"],
    portfolio: [],
    languages: [{ name: "O'zbek", level: "native" }],
    responseTimeHours: 1,
    available: true,
    rating: 0,
    reviewCount: 0,
    completedContracts: 0,
    badge: "yangi",
    memberSince: "2026-01-01T00:00:00.000Z",
  };
}

export const catalogService: CatalogService = {
  listSpecialists: () =>
    call(async () => {
      const me = sessionStore.read();
      let specialists: Model.Specialist[] = [];
      try {
        const categories = await getCategories();
        const page = await http<Page<RealPublicService>>(`/services${toQuery({ perPage: 100 })}`);
        const map = new Map<string, Model.Specialist>();
        for (const s of page.items || []) {
          if (s.sellerId && !map.has(s.sellerId)) {
            map.set(s.sellerId, {
              user: {
                id: s.sellerId,
                fullName: "Mutaxassis",
                phone: "",
                role: "mutaxassis",
                createdAt: s.createdAt,
                roleChosen: true,
                profileDone: true,
                verified: true,
              },
              profile: {
                ...fallbackSellerProfile(s.sellerId),
                headline: s.title,
                bio: s.description || "",
                categories: [slugById(categories, s.categoryId) as Model.ServiceCategory],
                memberSince: s.createdAt,
              },
            });
          }
        }
        specialists = Array.from(map.values());
      } catch {}

      if (me && me.role === "mutaxassis" && !specialists.some((s) => s.user.id === me.userId)) {
        specialists.unshift({
          user: {
            id: me.userId,
            fullName: "Mutaxassis",
            phone: "+998901234567",
            role: "mutaxassis",
            createdAt: new Date().toISOString(),
            roleChosen: true,
            profileDone: true,
            verified: true,
          },
          profile: fallbackSellerProfile(me.userId),
        });
      }
      return specialists;
    }),
  getSpecialist: (userId: string) =>
    call(async () => {
      const me = sessionStore.read();
      if ((me && (me.userId === userId || userId === "me")) || userId === "me") {
        const uid = me?.userId ?? "me";
        let fullName = "Mutaxassis";
        let phone = "+998901234567";
        try {
          const remoteMe = await http<RealMe>("/me");
          if (remoteMe && typeof remoteMe.fullName === "string") fullName = remoteMe.fullName;
          if (remoteMe && typeof remoteMe.phone === "string") phone = remoteMe.phone;
        } catch {}
        return {
          user: {
            id: uid,
            fullName,
            phone,
            role: "mutaxassis",
            createdAt: new Date().toISOString(),
            roleChosen: true,
            profileDone: true,
            verified: true,
          },
          profile: fallbackSellerProfile(uid),
        };
      }
      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem(`bbd_seller_profile_${userId}`);
          if (stored) {
            const p = JSON.parse(stored);
            const fallback = fallbackSellerProfile(userId);
            return {
              user: {
                id: userId,
                fullName: p.fullName || p.displayName || "Mutaxassis",
                phone: p.phone || "+998901110004",
                role: "mutaxassis",
                createdAt: new Date().toISOString(),
                roleChosen: true,
                profileDone: true,
                verified: true,
              },
              profile: {
                ...fallback,
                ...p,
                userId,
              },
            };
          }
        } catch {}
      }
      return null;
    }),
  listSellerReviews: () =>
    call(async () => {
      // Yangi ochilgan platformada sun'iy mock sharhlar olib tashlangan — faqat haqiqiy sharhlar qaytadi
      return [];
    }),
  listCategories: () => call(async () => (await getCategories()).map((c) => c.slug as Model.ServiceCategory)),
};

/* Saqlangan (bookmark) — brauzer xotirasi (localStorage) orqali */
const SAVED_JOBS_KEY = "bbd_saved_jobs";
const SAVED_SPECIALISTS_KEY = "bbd_saved_specialists";
const SAVED_MARKET_KEY = "bbd_saved_market";

export const savedService: SavedService = {
  listJobIds: () =>
    call(async () => {
      if (typeof window === "undefined") return [];
      try {
        const uid = sessionStore.read()?.userId ?? "guest";
        const raw = localStorage.getItem(SAVED_JOBS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return parsed[uid] ?? [];
      } catch {
        return [];
      }
    }),
  toggleJob: (jobId: string) =>
    call(async () => {
      if (typeof window === "undefined") return [];
      try {
        const uid = sessionStore.read()?.userId ?? "guest";
        const raw = localStorage.getItem(SAVED_JOBS_KEY);
        const stored = raw ? JSON.parse(raw) : {};
        const byUser = Array.isArray(stored) ? { [uid]: stored } : stored;
        const saved: string[] = byUser[uid] ?? [];
        const next = saved.includes(jobId)
          ? saved.filter((id) => id !== jobId)
          : [...saved, jobId];
        localStorage.setItem(SAVED_JOBS_KEY, JSON.stringify({ ...byUser, [uid]: next }));
        return next;
      } catch {
        return [];
      }
    }),
  listSpecialistIds: () =>
    call(async () => {
      if (typeof window === "undefined") return [];
      try {
        const uid = sessionStore.read()?.userId ?? "guest";
        const raw = localStorage.getItem(SAVED_SPECIALISTS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return parsed[uid] ?? [];
      } catch {
        return [];
      }
    }),
  toggleSpecialist: (specialistId: string) =>
    call(async () => {
      if (typeof window === "undefined") return [];
      try {
        const uid = sessionStore.read()?.userId ?? "guest";
        const raw = localStorage.getItem(SAVED_SPECIALISTS_KEY);
        const stored = raw ? JSON.parse(raw) : {};
        const byUser = Array.isArray(stored) ? { [uid]: stored } : stored;
        const saved: string[] = byUser[uid] ?? [];
        const next = saved.includes(specialistId)
          ? saved.filter((id) => id !== specialistId)
          : [...saved, specialistId];
        localStorage.setItem(SAVED_SPECIALISTS_KEY, JSON.stringify({ ...byUser, [uid]: next }));
        return next;
      } catch {
        return [];
      }
    }),
  listMarketIds: () =>
    call(async () => {
      if (typeof window === "undefined") return [];
      try {
        const uid = sessionStore.read()?.userId ?? "guest";
        const raw = localStorage.getItem(SAVED_MARKET_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return parsed[uid] ?? [];
      } catch {
        return [];
      }
    }),
  toggleMarketItem: (id: string) =>
    call(async () => {
      if (typeof window === "undefined") return [];
      try {
        const uid = sessionStore.read()?.userId ?? "guest";
        const raw = localStorage.getItem(SAVED_MARKET_KEY);
        const stored = raw ? JSON.parse(raw) : {};
        const byUser = Array.isArray(stored) ? { [uid]: stored } : stored;
        const saved: string[] = byUser[uid] ?? [];
        const next = saved.includes(id)
          ? saved.filter((itemId) => itemId !== id)
          : [...saved, id];
        localStorage.setItem(SAVED_MARKET_KEY, JSON.stringify({ ...byUser, [uid]: next }));
        return next;
      } catch {
        return [];
      }
    }),
};

/* ==========================================================================
   SERVICES — sotuvchi CRUD + ochiq katalog. Mutaxassis yaratgan xizmatlar
   buyer (xaridor) bozorida darhol ko'rinishi uchun lokal sintez bilan ta'minlangan.
   ========================================================================== */
export const servicesService: ServicesService = {
  listMine: () => call(async () => {
    const categories = await getCategories();
    const items = await allPages<RealService>("/seller/services");
    return items.map((s) => mapService(s, slugById(categories, s.categoryId)));
  }),
  listPublic: () => call(async () => {
    const categories = await getCategories();
    const items = await allPages<RealPublicService>("/services");
    return items.map((s) => mapPublicService(s, slugById(categories, s.categoryId))).filter((s) => !isTestService(s));
  }),
  get: (id) => call(async () => {
    const categories = await getCategories();
    try {
      if (currentRole() === "mutaxassis") {
        try {
          const dto = await http<RealService>(`/seller/services/${id}`);
          return mapService(dto, slugById(categories, dto.categoryId));
        } catch (error) {
          if (!(error instanceof ApiError && error.code === "NOT_FOUND")) throw error;
        }
      }
      const dto = await http<RealPublicService>(`/services/${id}`);
      return mapPublicService(dto, slugById(categories, dto.categoryId));
    } catch (error) {
      if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }),
  create: (input) => call(async () => {
    const categories = await getCategories();
    const categoryId = idBySlug(categories, input.category);
    if (!categoryId) throw new Error("INVALID_CATEGORY");
    const dto = await http<RealService>("/seller/services", {
      method: "POST", body: { categoryId, title: input.title, description: input.description,
        price: input.price, deliveryDays: input.deliveryDays },
    });
    // Creation preserves DRAFT. Publishing is a separate, explicit wizard action.
    return mapService(dto, input.category);
  }),
  update: (id, input) => call(async () => {
    const categories = await getCategories();
    const body: Record<string, unknown> = {};
    for (const key of ["title", "description", "price", "deliveryDays"] as const) {
      if (input[key] !== undefined) body[key] = input[key];
    }
    if (input.category !== undefined) {
      const categoryId = idBySlug(categories, input.category);
      if (!categoryId) throw new Error("INVALID_CATEGORY");
      body.categoryId = categoryId;
    }
    const dto = await http<RealService>(`/seller/services/${id}`, { method: "PATCH", body });
    return mapService(dto, slugById(categories, dto.categoryId));
  }),
  remove: (id) => call(async () => { await http(`/seller/services/${id}/archive`, { method: "POST" }); }),
  submit: (id) => changeServiceStatus(id, "submit"),
  pause: (id) => changeServiceStatus(id, "pause"),
  resume: (id) => changeServiceStatus(id, "resume"),
};

async function changeServiceStatus(id: string, action: "submit" | "pause" | "resume"): Promise<Model.Service> {
  return call(async () => {
    const categories = await getCategories();
    const dto = await http<RealService>(`/seller/services/${id}/${action}`, { method: "POST" });
    return mapService(dto, slugById(categories, dto.categoryId));
  });
}

interface RealJob {
  id: string;
  buyerId: string;
  buyerName?: string;
  buyerRating?: number;
  title: string;
  description: string;
  category: string;
  categoryId?: string;
  budgetMin: number;
  budgetMax: number;
  currency?: string;
  skillsRequired?: string[];
  screeningQuestions?: string[];
  proposalsCount?: number;
  status: "ochiq" | "yopilgan" | "OPEN" | "CLOSED";
  postedAt?: string;
  deadline?: string;
  attachedImages?: string[];
  createdAt?: string;
}

function mapJob(dto: RealJob): Model.Job {
  const status: Model.JobStatus =
    dto.status === "CLOSED" || dto.status === "yopilgan" ? "yopilgan" : "ochiq";
  return {
    id: dto.id,
    buyerId: dto.buyerId,
    buyerName: dto.buyerName || "Ish beruvchi",
    buyerRating: dto.buyerRating ?? 5.0,
    title: dto.title,
    description: dto.description,
    category: (dto.category as Model.ServiceCategory) || "dasturlash",
    budgetMin: Number(dto.budgetMin) || 0,
    budgetMax: Number(dto.budgetMax) || 0,
    currency: "UZS",
    skillsRequired: dto.skillsRequired || [],
    screeningQuestions: dto.screeningQuestions || [],
    proposalsCount: dto.proposalsCount || 0,
    postedAt: dto.postedAt || dto.createdAt || new Date().toISOString(),
    status,
    deadline: dto.deadline,
    attachedImages: dto.attachedImages || [],
  };
}

/* Job/Proposal/Offer — ish e'lonlari va takliflar xizmatlari */
export const jobsService: JobsService = {
  list: () => call(async () => (await allPages<RealJob>("/jobs")).map(mapJob)),
  listMine: () => call(async () => (await allPages<RealJob>("/jobs/mine")).map(mapJob)),
  get: (id) => call(async () => {
    try { return mapJob(await http<RealJob>(`/jobs/${id}`)); }
    catch (error) {
      if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }),
  create: (input) => call(async () => {
    if (!Number.isSafeInteger(input.budgetMin) || input.budgetMin < MIN_JOB_BUDGET ||
        !Number.isSafeInteger(input.budgetMax) || input.budgetMax < input.budgetMin) {
      throw new ApiError({ code: "VALIDATION", status: 422, message: "INVALID_BUDGET", retryable: false });
    }
    return mapJob(await http<RealJob>("/jobs", {
      method: "POST", body: { ...input, attachedImages: (input.attachedImages || []).slice(0, 5) },
    }));
  }),
  close: (id) => call(async () => mapJob(await http<RealJob>(`/jobs/${id}/close`, { method: "PATCH" }))),
};

export const proposalsService: ProposalsService = {
  listMine: () => call(() => http<Model.Proposal[]>("/jobs/proposals/mine")),
  get: (id) => call(async () => {
    try { return await http<Model.Proposal>(`/jobs/proposals/${id}`); }
    catch (error) {
      if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }),
  listForJob: (jobId) => call(() => http<Model.Proposal[]>(`/jobs/${jobId}/proposals`)),
  create: ({ jobId, ...input }) => call(() => http<Model.Proposal>(`/jobs/${jobId}/proposals`, {
    method: "POST", body: { ...input, attachedImages: input.attachedImages.slice(0, 5) },
  })),
  // Proposal hiring creates a durable contract with milestones
  setStatus: () => disabled(),
  hire: (proposalId, milestones) =>
    call(() =>
      http<Model.Contract>(`/jobs/proposals/${proposalId}/hire`, {
        method: "POST",
        body: { milestones },
      })
    ),
  withdraw: (id) => call(() => http<Model.Proposal>(`/jobs/proposals/${id}/withdraw`, { method: "POST" })),
};

export const offersService: OffersService = {
  get: (id) => call(() => getOffer(id)),
  create: (data) => call(() => createOffer(data)),
  listSent: () => call(() => getSentOffers()),
  listIncoming: () => call(() => getIncomingOffers()),
  // Mock offers cannot create durable, authorized financial contracts.
  accept: () => disabled(),
  withdraw: (id) => call(() => withdrawOffer(id)),
  decline: (id) => call(() => declineOffer(id)),
};

/* ==========================================================================
   CONTRACTS + MILESTONES — real backend'ning asosiy oqimi.
   ========================================================================== */
export const contractsService: ContractsService = {
  list: () =>
    call(async () => {
      const role = currentRole();
      const base = role === "mutaxassis" ? "/seller/contracts" : "/me/contracts";
      const items = await allPages<RealContract>(base);
      return Promise.all(items.map((c) => hydrateContract(c)));
    }),
  get: (id) =>
    call(async () => {
      const role = currentRole();
      const base = role === "mutaxassis" ? "/seller/contracts" : "/me/contracts";
      try {
        const c = await http<RealContract>(`${base}/${id}`);
        return await hydrateContract(c);
      } catch (e) {
        if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
        throw e;
      }
    }),
  create: (input, idempotencyKey) =>
    call(async () => {
      const c = await http<RealContract>("/contracts", { method: "POST", body: input, idempotencyKey });
      return hydrateContract(c);
    }),
  accept: (id) =>
    call(async () => {
      const c = await http<RealContract>(`/seller/contracts/${id}/accept`, { method: "POST" });
      return hydrateContract(c);
    }),
  reject: (id) =>
    call(async () => {
      const c = await http<RealContract>(`/seller/contracts/${id}/reject`, { method: "POST" });
      return hydrateContract(c);
    }),
  cancel: (id) =>
    call(async () => {
      const c = await http<RealContract>(`/me/contracts/${id}/cancel`, { method: "POST" });
      return hydrateContract(c);
    }),
  /* Ikki tomonlama "yopish so'rovi" oqimi real backendda yo'q — yakunlanish
     FAQAT oxirgi bosqich tasdiqlanganda avtomatik sodir bo'ladi. */
  requestClose: () => disabled(),
  approveClose: () => disabled(),
  sign: () => disabled(),
};

export const milestonesService: MilestonesService = {
  list: (contractId) =>
    call(async () => {
      const role = currentRole();
      const base = role === "mutaxassis" ? "/seller/contracts" : "/me/contracts";
      const c = await http<RealContract>(`${base}/${contractId}`);
      const hydrated = await hydrateContract(c);
      return c.milestones
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((m) => mapMilestone(m, !!hydrated.fundedAt, c.platformFeeRateBps));
    }),
  listMine: () =>
    call(async () => {
      const role = currentRole();
      const base = role === "mutaxassis" ? "/seller/contracts" : "/me/contracts";
      const results: Model.Milestone[] = [];
      const items = await allPages<RealContract>(base);
      for (const c of items) {
        const hydrated = await hydrateContract(c);
        for (const m of c.milestones) results.push(mapMilestone(m, !!hydrated.fundedAt, c.platformFeeRateBps));
      }
      return results;
    }),
  submit: (contractId, milestoneId, deliverable) =>
    call(async () => {
      const m = await http<RealMilestone>(`/seller/contracts/${contractId}/milestones/${milestoneId}/submit`, {
        method: "POST",
        body: {
          message: deliverable?.note,
          deliverableUrls: deliverable?.link ? [deliverable.link] : undefined,
        },
      });
      return mapMilestone(m, true);
    }),
  accept: (contractId, milestoneId) =>
    call(async () => {
      const m = await http<RealMilestone>(`/me/contracts/${contractId}/milestones/${milestoneId}/approve`, {
        method: "POST",
      });
      return mapMilestone(m, true);
    }),
  requestRevision: (contractId, milestoneId, comment) =>
    call(async () => {
      const m = await http<RealMilestone>(
        `/me/contracts/${contractId}/milestones/${milestoneId}/request-revision`,
        { method: "POST", body: { reason: comment } },
      );
      return mapMilestone(m, true);
    }),
};

/* Fayl yuklash — S3 presigned infratuzilmasi hali yo'q (backend Bosqich 5+) */
export const filesService: FilesService = {
  upload: () => disabled(),
};

/* ==========================================================================
   PAYMENTS — real Payme checkout oqimi + sotuvchi ledger balansi. Karta/
   yechish/B2B kabi mock-only usullar real backendda yo'q.
   ========================================================================== */
export const paymentsService: PaymentsService = {
  fundContract: () => disabled(),
  fundMilestone: () => disabled(),
  getBalance: () =>
    call(async () => {
      if (currentRole() !== "mutaxassis") return 0;
      const res = await http<{ currency: string; available: number }>("/seller/balance");
      return res.available;
    }),
  // No tokenized card binding or verified destination API exists. Local card
  // metadata cannot authorize a payout and must not masquerade as a bound card.
  getCards: () => call(async () => []),
  addCard: () => disabled(),
  removeCard: () => disabled(),
  withdrawEarnings: () => disabled(),
  withdrawBalance: () => disabled(),
  getWithdrawnTotal: () => call(async () => {
    if (currentRole() !== "mutaxassis") return 0;
    return (await allPages<RealPayout>("/seller/payouts"))
      .filter((p) => p.status === "SUCCEEDED").reduce((sum, p) => sum + p.amount, 0);
  }),
  getPendingWithdrawalTotal: () => call(async () => {
    if (currentRole() !== "mutaxassis") return 0;
    return (await allPages<RealPayout>("/seller/payouts"))
      .filter((p) => p.status === "PENDING" || p.status === "PROCESSING").reduce((sum, p) => sum + p.amount, 0);
  }),
  listMyWithdrawalRequests: () => call(async () => {
    if (currentRole() !== "mutaxassis") return [];
    const me = await http<RealMe>("/me");
    return (await allPages<RealPayout>("/seller/payouts")).map((p) => mapPayout(p, asStr(me.fullName)));
  }),
  createContractPayment: (contractId, idempotencyKey) =>
    call(async () => {
      return mapPayment(
        await http<RealPayment>(`/me/contracts/${contractId}/payment`, { method: "POST", idempotencyKey })
      );
    }),
  getContractPayment: (contractId) => call(async () => {
    const page = await http<Page<RealPayment>>(`/me/payments${toQuery({ contractId, perPage: 1 })}`);
    return page.items[0] ? mapPayment(page.items[0]) : null;
  }),
};

/* Xabarlar/chat — in-memory + localStorage store */
export const messagesService: MessagesService = {
  list: (threadId) => call(() => getMessages(threadId)),
  listMine: () => call(() => getAllMessages()),
  send: (threadId, body, image, attachments) => call(() => sendMessage(threadId, body, image, attachments)),
  getReadStatus: () => call(() => getThreadReads()),
  markRead: (threadId) => call(() => markThreadRead(threadId)),
};

/* Ichki bildirishnoma feed */
export const notificationsService: NotificationsService = {
  list: () => call(() => getNotifications()),
  markRead: (id) => call(() => markNotificationRead(id)),
  markAllRead: () => call(() => markAllNotificationsRead()),
};

/* Sharhlar — real backendda Review modeli yo'q */
export const reviewsService: ReviewsService = {
  listMine: () => call(async () => []),
  getForContract: () => call(async () => null),
  create: () => disabled(),
};

/* ==========================================================================
   DISPUTES — real backend oqimi.
   ========================================================================== */
export const disputesService: DisputesService = {
  listMine: () => call(async () => (await allPages<RealDispute>("/me/disputes")).map(mapDispute)),
  getForContract: (contractId) => call(async () => {
    const items = await allPages<RealDispute>("/me/disputes");
    const match = items.find((d) => d.contractId === contractId);
    return match ? mapDispute(match) : null;
  }),
  open: (contractId, input) =>
    call(async () => {
      const d = await http<RealDispute>(`/me/contracts/${contractId}/disputes`, {
        method: "POST",
        body: { reason: input.reason.toUpperCase(), description: input.description },
        idempotencyKey: crypto.randomUUID(),
      });
      return mapDispute(d);
    }),
  withdraw: (contractId) =>
    call(async () => {
      const items = await allPages<RealDispute>("/me/disputes");
      const match = items.find((d) => d.contractId === contractId);
      if (!match) throw new Error("DISPUTE_NOT_FOUND");
      await http(`/me/disputes/${match.id}/cancel`, { method: "POST" });
    }),
};

export const sellerApplicationService: SellerApplicationService = {
  getCurrent: () =>
    call(async () => {
      try {
        const app = await http<RealSellerApplication>("/me/seller-application");
        return {
          status: mapSellerApplicationStatus(app.status),
          legalName: app.legalName,
          displayName: app.displayName,
          description: asStr(app.description),
          rejectionReason: asStr(app.rejectionReason),
          submittedAt: asStr(app.submittedAt),
        };
      } catch (e) {
        if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
        throw e;
      }
    }),
  submit: (input) =>
    call(async () => {
      await http("/me/seller-application", { method: "POST", body: input });
    }),
};

/* KYC — Real document verification with encrypted storage, magic bytes check and malware scanner */
export const verificationService: VerificationService = {
  getMine: () =>
    call(async () => {
      try {
        return await http<Model.VerificationRecord | null>("/kyc/me");
      } catch (err) {
        if (err instanceof ApiError && err.code === "NOT_FOUND") return null;
        throw err;
      }
    }),
  submit: (input) =>
    call(() =>
      http<Model.VerificationRecord>("/kyc/submit", {
        method: "POST",
        body: {
          ...input,
          documentType: (input.documentType || "passport").toUpperCase(),
        },
      })
    ),
};

/* Support ticketlar — Help Center uchun chiptalar boshqaruvi */
export const supportService: SupportService = {
  listMine: () =>
    call(async () => {
      try {
        const res = await http<Model.SupportTicket[] | { items: Model.SupportTicket[] }>("/support/tickets/mine?perPage=100");
        return Array.isArray(res) ? res : res.items || [];
      } catch {
        if (typeof window !== "undefined") {
          try {
            const session = sessionStore.read();
            const uid = session?.userId || "me";
            const key = `bbd_support_${uid}`;
            const stored = localStorage.getItem(key);
            if (stored) return JSON.parse(stored);
          } catch {}
        }
        return [];
      }
    }),
  listReplies: (ticketId: string) =>
    call(async () => {
      try {
        const res = await http<{ messages?: { senderName: string; text: string; createdAt: string; isAdmin: boolean }[] }>(`/support/tickets/${ticketId}`);
        return (res.messages || []).map((m) => ({
          authorName: m.senderName,
          message: m.text,
          createdAt: m.createdAt,
          isAdmin: m.isAdmin,
        }));
      } catch {
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(`bbd_replies_${ticketId}`);
            if (stored) return JSON.parse(stored);
          } catch {}
        }
        return [];
      }
    }),
  create: (input) =>
    call(async () => {
      const session = sessionStore.read();
      if (!session?.userId) throw new Error("NO_SESSION");
      const uid = session.userId;
      const categoryMap: Record<string, Model.SupportRequestCategory> = {
        tolov: "tolov_escrow", shartnoma: "loyiha", nizo: "loyiha",
        hisob: "hisob", texnik: "texnik", boshqa: "boshqa",
      };

      // 1. Deliver support request (Telegram / notification) — fail closed if delivery fails
      await supportRequestService.submit({
        category: categoryMap[input.topic] ?? "boshqa",
        contactName: "Foydalanuvchi", contactInfo: `ID: ${uid}`, userId: uid,
        source: "help_center", route: typeof window !== "undefined" ? window.location.pathname : "/yordam",
        message: `${input.subject}\n\n${input.message}`,
      });

      // 2. Submit to persistent backend API if available
      let ticket: Model.SupportTicket | null = null;
      try {
        const res = await http<Model.SupportTicket>("/support/tickets", {
          method: "POST",
          body: {
            topic: input.topic,
            subject: input.subject,
            message: input.message,
          },
        });
        if (res && res.id) ticket = res;
      } catch {}

      if (!ticket) {
        ticket = {
          id: `ticket_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          userId: uid,
          topic: input.topic,
          subject: input.subject,
          message: input.message,
          status: "ochiq",
          createdAt: new Date().toISOString(),
        };
      }
      if (!ticket.userId) {
        ticket.userId = uid;
      }

      // 3. Persist to local cache for offline/instant history
      if (typeof window !== "undefined") {
        try {
          const key = `bbd_support_${uid}`;
          const existing: Model.SupportTicket[] = JSON.parse(localStorage.getItem(key) || "[]");
          localStorage.setItem(key, JSON.stringify([ticket, ...existing.filter((x) => x.id !== ticket!.id)]));
        } catch {}
      }

      return ticket;
    }),
};

/* Yagona haqiqiy backend-integratsiyalangan service — mock-api'ga emas,
   /api/support route handler'ga (u yerdan Telegram Bot API'ga) haqiqiy
   fetch qiladi. Token bu faylga ham, brauzerga ham chiqmaydi. */
export const supportRequestService: SupportRequestService = {
  submit: (input) =>
    call(async () => {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) return;
      const body = await res.json().catch(() => null);
      if (body?.error === "VALIDATION") throw new Error("VALIDATION");
      if (body?.error === "RATE_LIMITED") throw new Error("RATE_LIMITED");
      throw new Error("SUPPORT_SEND_FAILED");
    }),
};

/**
 * Ma'lumot o'zgargani haqidagi signal. Real backend'da WebSocket/SSE yo'q
 * (bo'lim 91-K — "soxta realtime yo'q"), shuning uchun bu endi hech qachon
 * chiqarilmaydi — ekranlar `reload()`/fokusda qayta yuklash yoki bounded
 * polling bilan yangilanadi. `DATA_CHANGED_EVENT` nomi eski chaqiruv
 * joylari (`window.addEventListener(DATA_CHANGED_EVENT, ...)`) buzilmasin
 * deb saqlangan — hodisa shunchaki hech qachon `dispatchEvent` qilinmaydi.
 */
export const DATA_CHANGED_EVENT = "bobololadono:data-changed";
export const resetDemoData = (): void => {};
