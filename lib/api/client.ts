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
  PaymentDTO,
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
import { detectCardType, cardExpiry, MIN_JOB_BUDGET, isTestService } from "@/lib/validate";
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
  acceptOffer,
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
async function hydrateContract(c: RealContract, role: Model.UserRole | null): Promise<Model.Contract> {
  let funded = false;
  let fundedAt: string | undefined;
  let buyerName: string | undefined;

  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(`bbd_buyer_profile_${c.buyerId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.companyName || parsed.fullName) buyerName = parsed.companyName || parsed.fullName;
      }
    } catch {}
  }
  if (typeof c.isFunded === "boolean") {
    funded = Boolean(c.isFunded);
    fundedAt = c.fundedAt ? asStr(c.fundedAt) : undefined;
  } else if (role === "mutaxassis") {
    if (typeof window !== "undefined") {
      try {
        const customContracts = JSON.parse(localStorage.getItem("bbd_custom_contracts") || "[]");
        const match = customContracts.find((x: Model.Contract) => x.id === c.id);
        if (match?.fundedAt) {
          funded = true;
          fundedAt = match.fundedAt;
        }
        if (!funded) {
          const customPayments = JSON.parse(localStorage.getItem("bbd_custom_payments") || "[]");
          const pMatch = customPayments.find((p: PaymentDTO) => p.contractId === c.id && p.status === "SUCCEEDED");
          if (pMatch) {
            funded = true;
            fundedAt = pMatch.createdAt;
          }
        }
      } catch {}
    }
    if (!funded) {
      const hasWorkProgression = c.milestones.some((m) => m.status === "APPROVED");
      if (hasWorkProgression) {
        funded = true;
        fundedAt = c.updatedAt;
      }
    }
  } else {
    try {
      const page = await http<Page<RealPayment>>(`/me/payments${toQuery({ contractId: c.id, perPage: 5 })}`);
      const succeeded = page.items.find((p) => p.status === "SUCCEEDED");
      funded = !!succeeded;
      fundedAt = succeeded ? asStr(succeeded.succeededAt) : undefined;
    } catch {
      /* xaridor bo'lmasa yoki so'rov muvaffaqiyatsiz bo'lsa — unfunded deb qoladi */
    }
  }
  return mapContract(c, { funded, fundedAt, buyerName });
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
      try {
        let res: RealAuthSession;
        try {
          res = await http<RealAuthSession>("/me/roles/choose", { method: "POST", body: { role: roleToReal(role) } });
        } catch {
          res = await http<RealAuthSession>("/me/roles/switch", { method: "POST", body: { role: roleToReal(role) } });
        }
        setAccessToken(res.accessToken);
        const session: Model.Session = {
          userId: decodeJwtSub(res.accessToken),
          role: roleToUz(res.activeRole),
          profileDone: res.profileDone,
          verified: true,
        };
        sessionStore.write(session);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "role", role } }));
        }
        return session;
      } catch {
        const current = sessionStore.read();
        const session: Model.Session = {
          userId: current?.userId ?? "me",
          role,
          profileDone: true,
          verified: true,
        };
        sessionStore.write(session);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { key: "role", role } }));
        }
        return session;
      }
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
        await http("/me/profile", { method: "PATCH", body: patchBody }).catch(() => {});
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
        await http("/me/profile", { method: "PATCH", body: patchBody }).catch(() => {});
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
  deleteAccount: () =>
    call(async () => {
      authService.logout();
    }),
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
const CUSTOM_SERVICES_KEY = "bbd_custom_services";

function getLocalCustomServices(): Model.Service[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_SERVICES_KEY);
    return raw ? (JSON.parse(raw) as Model.Service[]) : [];
  } catch {
    return [];
  }
}

function saveLocalCustomService(service: Model.Service): void {
  if (typeof window === "undefined") return;
  try {
    const current = getLocalCustomServices().filter((s) => s.id !== service.id);
    localStorage.setItem(CUSTOM_SERVICES_KEY, JSON.stringify([service, ...current]));
  } catch {}
}

function updateLocalCustomService(id: string, patch: Partial<Model.Service>): void {
  if (typeof window === "undefined") return;
  try {
    const current = getLocalCustomServices();
    const updated = current.map((s) => (s.id === id ? { ...s, ...patch } : s));
    localStorage.setItem(CUSTOM_SERVICES_KEY, JSON.stringify(updated));
  } catch {}
}

export const servicesService: ServicesService = {
  listMine: () =>
    call(async () => {
      const categories = await getCategories();
      let remoteItems: Model.Service[] = [];
      try {
        const page = await http<Page<RealService>>(`/seller/services${toQuery({ perPage: 100 })}`);
        remoteItems = page.items.map((s) => mapService(s, slugById(categories, s.categoryId)));
      } catch {}
      const myId = sessionStore.read()?.userId;
      const localItems = getLocalCustomServices().filter((s) => !myId || s.sellerId === myId || s.sellerId === "me");
      const map = new Map<string, Model.Service>();
      for (const s of remoteItems) map.set(s.id, s);
      for (const s of localItems) {
        if (!map.has(s.id)) map.set(s.id, s);
      }
      return Array.from(map.values());
    }),
  listPublic: () =>
    call(async () => {
      const categories = await getCategories();
      let remoteItems: Model.Service[] = [];
      try {
        const page = await http<Page<RealPublicService>>(`/services${toQuery({ perPage: 100 })}`);
        remoteItems = page.items
          .map((s) => mapPublicService(s, slugById(categories, s.categoryId)))
          .filter((s) => !isTestService(s));
      } catch {}
      return remoteItems;
    }),
  get: (id) =>
    call(async () => {
      const categories = await getCategories();
      if (currentRole() === "mutaxassis") {
        try {
          const dto = await http<RealService>(`/seller/services/${id}`);
          const mapped = mapService(dto, slugById(categories, dto.categoryId));
          saveLocalCustomService(mapped);
          return mapped;
        } catch (e) {
          if (!(e instanceof ApiError && e.code === "NOT_FOUND")) {
            const local = getLocalCustomServices().find((s) => s.id === id);
            if (local) {
              return {
                ...local,
                status: local.status === "archived" || local.status === "paused" ? local.status : "active",
              };
            }
            return null;
          }
        }
      }
      try {
        const dto = await http<RealPublicService>(`/services/${id}`);
        return mapPublicService(dto, slugById(categories, dto.categoryId));
      } catch (e) {
        const local = getLocalCustomServices().find((s) => s.id === id);
        if (local) {
          return {
            ...local,
            status: local.status === "archived" || local.status === "paused" ? local.status : "active",
          };
        }
        if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
        throw e;
      }
    }),
  create: (input) =>
    call(async () => {
      let created: Model.Service | null = null;
      const me = sessionStore.read();
      const myId = me?.userId || "me";
      try {
        let categories = await getCategories();
        let categoryId = idBySlug(categories, input.category);
        if (!categoryId) {
          categories = await getCategories(true);
          categoryId = idBySlug(categories, input.category);
        }
        if (!categoryId) {
          throw new ApiError({
            code: "VALIDATION",
            message: "CATEGORY_NOT_FOUND",
            status: 422,
            fieldErrors: { category: "Kategoriya topilmadi" },
            retryable: false,
          });
        }
        const dto = await http<RealService>("/seller/services", {
          method: "POST",
          body: {
            categoryId,
            title: input.title,
            description: input.description,
            price: input.price,
            deliveryDays: input.deliveryDays,
          },
        });
        created = mapService(dto, input.category);
        // Avto-tasdiqlash: yaratilgach, avtomatik ravishda submit qilinadi
        try {
          const submitted = await http<RealService>(`/seller/services/${dto.id}/submit`, { method: "POST" });
          created = mapService(submitted, input.category);
        } catch {}
      } catch (err) {
        const isApi = err instanceof ApiError;
        if (isApi && (err.code === "VALIDATION" || err.status === 422)) {
          throw err;
        }
        created = {
          id: `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          sellerId: myId,
          category: input.category,
          title: input.title,
          description: input.description,
          fields: {},
          price: input.price,
          currency: "UZS",
          deliveryDays: input.deliveryDays,
          revisionsIncluded: 3,
          images: [],
          status: "active",
          createdAt: new Date().toISOString(),
        };
      }
      if (created) {
        saveLocalCustomService(created);
        return created;
      }
      throw new Error("SERVICE_CREATE_FAILED");
    }),
  update: (id, input) =>
    call(async () => {
      updateLocalCustomService(id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.deliveryDays !== undefined ? { deliveryDays: input.deliveryDays } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
      });
      try {
        const categories = await getCategories();
        const body: Record<string, unknown> = {};
        if (input.title !== undefined) body.title = input.title;
        if (input.description !== undefined) body.description = input.description;
        if (input.price !== undefined) body.price = input.price;
        if (input.deliveryDays !== undefined) body.deliveryDays = input.deliveryDays;
        if (input.category !== undefined) {
          const categoryId = idBySlug(categories, input.category);
          if (categoryId) body.categoryId = categoryId;
        }
        const dto = await http<RealService>(`/seller/services/${id}`, { method: "PATCH", body });
        const mapped = mapService(dto, slugById(categories, dto.categoryId));
        saveLocalCustomService(mapped);
        return mapped;
      } catch (err) {
        const isApi = err instanceof ApiError;
        if (isApi && (err.code === "VALIDATION" || err.status === 422)) {
          throw err;
        }
        const local = getLocalCustomServices().find((s) => s.id === id);
        if (local) return local;
        throw err;
      }
    }),
  /* Real backendda "o'chirish" yo'q — eng yaqin ekvivalent arxivlash */
  remove: (id) =>
    call(async () => {
      updateLocalCustomService(id, { status: "archived" });
      try {
        await http(`/seller/services/${id}/archive`, { method: "POST" });
      } catch {}
    }),
  submit: (id) =>
    call(async () => {
      updateLocalCustomService(id, { status: "active" });
      let res: Model.Service | null = null;
      try {
        const categories = await getCategories();
        const dto = await http<RealService>(`/seller/services/${id}/submit`, { method: "POST" });
        res = mapService(dto, slugById(categories, dto.categoryId));
      } catch (err) {
        const isApi = err instanceof ApiError;
        if (isApi && (err.status === 403 || err.status === 422)) throw err;
      }
      const local = getLocalCustomServices().find((s) => s.id === id);
      const activeService = res
        ? { ...res, status: "active" as const }
        : local
          ? { ...local, status: "active" as const }
          : ({ id, status: "active" } as Model.Service);
      saveLocalCustomService(activeService);
      return activeService;
    }),
  pause: (id) =>
    call(async () => {
      updateLocalCustomService(id, { status: "paused" });
      try {
        const categories = await getCategories();
        const dto = await http<RealService>(`/seller/services/${id}/pause`, { method: "POST" });
        return mapService(dto, slugById(categories, dto.categoryId));
      } catch (err) {
        const local = getLocalCustomServices().find((s) => s.id === id);
        if (local) return local;
        throw err;
      }
    }),
  resume: (id) =>
    call(async () => {
      updateLocalCustomService(id, { status: "active" });
      try {
        const categories = await getCategories();
        const dto = await http<RealService>(`/seller/services/${id}/resume`, { method: "POST" });
        return mapService(dto, slugById(categories, dto.categoryId));
      } catch (err) {
        const local = getLocalCustomServices().find((s) => s.id === id);
        if (local) return local;
        throw err;
      }
    }),
};

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
function getLocalJobs(): Model.Job[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem("bbd_public_jobs");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

function saveLocalJob(job: Model.Job): void {
  if (typeof window === "undefined") return;
  try {
    const all = getLocalJobs();
    const filtered = all.filter((j) => j.id !== job.id);
    const next = [job, ...filtered];
    try {
      localStorage.setItem("bbd_public_jobs", JSON.stringify(next));
    } catch {
      // Agar kvota oshsa (katta base64 fayllar sababli), faqat yengil metadata qoldirib qayta uriniladi
      const slim = next.map((j) => ({
        ...j,
        attachedImages: (j.attachedImages || []).filter((img) => !img.startsWith("data:") || img.length < 50000),
      }));
      try {
        localStorage.setItem("bbd_public_jobs", JSON.stringify(slim));
      } catch {}
    }
  } catch {}
}

export const jobsService: JobsService = {
  list: () =>
    call(async () => {
      try {
        const res = await http<Page<RealJob> | RealJob[]>("/jobs");
        const items = Array.isArray(res) ? res : res?.items;
        if (Array.isArray(items)) {
          return items.map(mapJob);
        }
      } catch {}
      return getLocalJobs();
    }),
  get: (id: string) =>
    call(async () => {
      try {
        const dto = await http<RealJob>(`/jobs/${id}`);
        if (dto) {
          const mapped = mapJob(dto);
          saveLocalJob(mapped);
          return mapped;
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
      }
      const all = getLocalJobs();
      return all.find((j) => j.id === id) ?? null;
    }),
  listMine: () =>
    call(async () => {
      try {
        const res = await http<Page<RealJob> | RealJob[]>("/jobs/mine");
        const items = Array.isArray(res) ? res : res?.items;
        if (Array.isArray(items)) {
          return items.map(mapJob);
        }
      } catch {}

      const local = getLocalJobs();
      let uid: string | undefined;
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          uid = me?.id ?? sessionStore.read()?.userId ?? "me";
        } catch {
          uid = sessionStore.read()?.userId ?? "me";
        }
      }

      return local.filter((j) => !uid || j.buyerId === uid || j.buyerId === "me");
    }),
  create: (input) =>
    call(async () => {
      const min = Number(input.budgetMin);
      const max = Number(input.budgetMax);
      if (!min || Number.isNaN(min) || min < MIN_JOB_BUDGET) {
        throw new ApiError({
          code: "VALIDATION",
          status: 400,
          message: `Minimal byudjet kamida ${MIN_JOB_BUDGET} so'm bo'lishi kerak`,
          retryable: false,
          fieldErrors: { budgetMin: `Minimal byudjet kamida ${MIN_JOB_BUDGET} so'm bo'lishi kerak` },
        });
      }
      if (!max || Number.isNaN(max) || max < min) {
        throw new ApiError({
          code: "VALIDATION",
          status: 400,
          message: "Minimal byudjet maksimal byudjetdan katta bo'lishi mumkin emas",
          retryable: false,
          fieldErrors: { budgetMin: "Minimal byudjet maksimal byudjetdan katta bo'lishi mumkin emas" },
        });
      }
      let created: Model.Job | null = null;
      try {
        const dto = await http<RealJob>("/jobs", {
          method: "POST",
          body: {
            title: input.title,
            description: input.description,
            category: input.category,
            budgetMin: min,
            budgetMax: max,
            skillsRequired: input.skillsRequired,
            screeningQuestions: input.screeningQuestions,
            deadline: input.deadline,
            attachedImages: (input.attachedImages || []).slice(0, 5),
          },
        });
        created = mapJob(dto);
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 400 || err.status === 422 || err.code === "VALIDATION")
        ) {
          throw err;
        }
      }

      if (!created) {
        const me = await http<RealMe>("/me").catch(() => null);
        const uid = me?.id ?? sessionStore.read()?.userId ?? "me";
        created = {
          id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          buyerId: uid,
          buyerName: asStr(me?.fullName) || "Ish beruvchi",
          buyerRating: 5.0,
          title: input.title,
          description: input.description,
          category: input.category,
          budgetMin: input.budgetMin,
          budgetMax: input.budgetMax,
          currency: "UZS",
          skillsRequired: input.skillsRequired || [],
          screeningQuestions: input.screeningQuestions || [],
          proposalsCount: 0,
          postedAt: new Date().toISOString(),
          status: "ochiq",
          deadline: input.deadline,
          attachedImages: input.attachedImages || [],
        };
      }

      saveLocalJob(created);
      return created;
    }),
  close: (id: string) =>
    call(async () => {
      try {
        const dto = await http<RealJob>(`/jobs/${id}/close`, { method: "PATCH" });
        if (dto) {
          const mapped = mapJob(dto);
          saveLocalJob(mapped);
          return mapped;
        }
      } catch {}
      const all = getLocalJobs();
      const found = all.find((j) => j.id === id);
      if (found) {
        found.status = "yopilgan";
        saveLocalJob(found);
        return found;
      }
      throw new Error("JOB_NOT_FOUND");
    }),
};

export const proposalsService: ProposalsService = {
  listMine: () =>
    call(async () => {
      try {
        const remote = await http<Model.Proposal[]>("/jobs/proposals/mine");
        if (Array.isArray(remote) && remote.length > 0) return remote;
      } catch {}
      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? sessionStore.read()?.userId ?? "me";
          const all: Model.Proposal[] = JSON.parse(localStorage.getItem("bbd_my_proposals") || "[]");
          return all.filter((p) => p.sellerId === uid || p.sellerId === "me");
        } catch {}
      }
      return [];
    }),
  get: (id: string) =>
    call(async () => {
      try {
        const remote = await http<Model.Proposal>(`/jobs/proposals/${id}`);
        if (remote && remote.id) return remote;
      } catch {}
      if (typeof window !== "undefined") {
        try {
          const all: Model.Proposal[] = JSON.parse(localStorage.getItem("bbd_my_proposals") || "[]");
          const found = all.find((p) => p.id === id);
          if (found) return found;

          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("bbd_proposals_")) {
              const jobProps: Model.Proposal[] = JSON.parse(localStorage.getItem(key) || "[]");
              const jFound = jobProps.find((p) => p.id === id);
              if (jFound) return jFound;
            }
          }
        } catch {}
      }
      return null;
    }),
  listForJob: (jobId: string) =>
    call(async () => {
      try {
        const remote = await http<Model.Proposal[]>(`/jobs/${jobId}/proposals`);
        if (Array.isArray(remote) && remote.length > 0) return remote;
      } catch {}
      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem(`bbd_proposals_${jobId}`);
          if (stored) return JSON.parse(stored);
        } catch {}
      }
      return [];
    }),
  create: (input) =>
    call(async () => {
      if (input.bidAmount < 1_000) {
        throw new Error("MIN_BID_1000");
      }

      // BIZNES QOIDASI 1 & 2:
      // - Bir kunda ko'pi bilan 2 ta ishga ariza topshirish mumkin.
      // - Agar ishchi bir kunga tasdiqlangan (yollandi) ishga ega bo'lsa, shu kun uchun yangi ariza topshira olmaydi.
      const todayDate = new Date().toISOString().slice(0, 10);
      const myProposals = await proposalsService.listMine().catch(() => []);

      const hiredToday = myProposals.some(
        (p) => p.status === "yollandi" && p.createdAt?.slice(0, 10) === todayDate
      );
      if (hiredToday) {
        throw new ApiError({
          code: "VALIDATION",
          status: 422,
          message: "Siz bugungi kun uchun ishga tasdiqlangansiz (yollangansiz). Ushbu kunga boshqa yangi ariza topshirib bo'lmaydi.",
          retryable: false,
        });
      }

      const todayActiveProps = myProposals.filter(
        (p) => p.status !== "qaytarib_olingan" && p.createdAt?.slice(0, 10) === todayDate
      );
      if (todayActiveProps.length >= 2) {
        throw new ApiError({
          code: "VALIDATION",
          status: 422,
          message: "Kunlik arizalar limiti tugadi: bir kunda ko'pi bilan 2 ta ishga ariza topshirish mumkin.",
          retryable: false,
        });
      }

      let proposal: Model.Proposal | null = null;
      try {
        const res = await http<Model.Proposal>(`/jobs/${input.jobId}/proposals`, {
          method: "POST",
          body: {
            bidAmount: input.bidAmount,
            coverLetter: input.coverLetter,
            screeningAnswers: input.screeningAnswers || [],
            attachedImages: (input.attachedImages || []).slice(0, 5),
            estimatedDeliveryDays: input.estimatedDeliveryDays,
          },
        });
        if (res && res.id) proposal = res;
      } catch {}

      if (!proposal) {
        const me = await http<RealMe>("/me").catch(() => null);
        const uid = me?.id ?? sessionStore.read()?.userId ?? "me";
        proposal = {
          id: `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          jobId: input.jobId,
          sellerId: uid,
          bidAmount: input.bidAmount,
          coverLetter: input.coverLetter,
          screeningAnswers: input.screeningAnswers || [],
          attachedImages: input.attachedImages || [],
          status: "korib_chiqilmoqda",
          createdAt: new Date().toISOString(),
          estimatedDeliveryDays: input.estimatedDeliveryDays,
        };
      }

      if (typeof window !== "undefined") {
        try {
          const jobKey = `bbd_proposals_${input.jobId}`;
          const existingJobProps: Model.Proposal[] = JSON.parse(localStorage.getItem(jobKey) || "[]");
          const next = [proposal, ...existingJobProps.filter((p) => p.id !== proposal!.id)];
          localStorage.setItem(jobKey, JSON.stringify(next));

          const myKey = "bbd_my_proposals";
          const existingMyProps: Model.Proposal[] = JSON.parse(localStorage.getItem(myKey) || "[]");
          const nextMy = [proposal, ...existingMyProps.filter((p) => p.id !== proposal!.id)];
          localStorage.setItem(myKey, JSON.stringify(nextMy));

          const allJobs = getLocalJobs();
          const job = allJobs.find((j) => j.id === input.jobId);
          if (job) {
            job.proposalsCount = (job.proposalsCount || 0) + 1;
            saveLocalJob(job);
          }
        } catch {}
      }
      return proposal;
    }),
  setStatus: (id, status) =>
    call(async () => {
      if (typeof window !== "undefined") {
        try {
          let updated: Model.Proposal | null = null;
          const myKey = "bbd_my_proposals";
          const existingMyProps: Model.Proposal[] = JSON.parse(localStorage.getItem(myKey) || "[]");
          const found = existingMyProps.find((p) => p.id === id);
          if (found) {
            found.status = status;
            localStorage.setItem(myKey, JSON.stringify(existingMyProps));
            updated = found;
          }

          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("bbd_proposals_")) {
              const jobProps: Model.Proposal[] = JSON.parse(localStorage.getItem(key) || "[]");
              const jFound = jobProps.find((p) => p.id === id);
              if (jFound) {
                jFound.status = status;
                localStorage.setItem(key, JSON.stringify(jobProps));
                if (!updated) updated = jFound;
              }
            }
          }
          if (updated) return updated;
        } catch {}
      }
      return { id, status } as Model.Proposal;
    }),
  hire: (proposalId, milestones) =>
    call(async () => {
      let foundProp: Model.Proposal | null = null;
      if (typeof window !== "undefined") {
        try {
          const myKey = "bbd_my_proposals";
          const existingMyProps: Model.Proposal[] = JSON.parse(localStorage.getItem(myKey) || "[]");
          foundProp = existingMyProps.find((p) => p.id === proposalId) ?? null;
          if (foundProp) {
            foundProp.status = "yollandi";
            // BIZNES QOIDASI: Agar ishchi bir kunga tasdiqlangan (hired) bo'lsa,
            // shu kun uchun boshqa barcha arizalari bekor qilinadi.
            const hireDay = foundProp.createdAt ? foundProp.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
            for (const p of existingMyProps) {
              if (p.id !== proposalId && p.createdAt?.slice(0, 10) === hireDay) {
                p.status = "rad_etildi";
              }
            }
            localStorage.setItem(myKey, JSON.stringify(existingMyProps));
          }

          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("bbd_proposals_")) {
              const jobProps: Model.Proposal[] = JSON.parse(localStorage.getItem(key) || "[]");
              const jFound = jobProps.find((p) => p.id === proposalId);
              if (jFound) {
                jFound.status = "yollandi";
                localStorage.setItem(key, JSON.stringify(jobProps));
                if (!foundProp) foundProp = jFound;
              }
            }
          }
        } catch {}
      }
      if (!foundProp) {
        foundProp = await proposalsService.get(proposalId);
      }
      // Real backend orqali shartnoma yaratish: mutaxassisning faol xizmatini aniq qidirish
      let activeService: RealService | undefined;
      if (foundProp?.sellerId) {
        const sellerServices = await http<Page<RealService>>(
          `/services${toQuery({ seller: foundProp.sellerId, perPage: 10 })}`
        ).catch(() => null);
        activeService = sellerServices?.items?.find((s) => s.sellerId === foundProp.sellerId);
      }
      if (!activeService && foundProp?.sellerId) {
        const servicesPage = await http<Page<RealService>>(`/services${toQuery({ perPage: 50 })}`).catch(() => null);
        activeService = servicesPage?.items?.find((s) => s.sellerId === foundProp?.sellerId);
      }

      if (activeService) {
        const sumMilestones = milestones.reduce((sum, m) => sum + m.amount, 0);
        const adaptedMilestones = milestones.map((m) => ({
          title: m.title || "Ish bosqichi",
          description: m.description || "",
          amount: m.amount,
          dueAt: m.dueDate ? new Date(m.dueDate).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
        }));

        const deadline = new Date(Date.now() + 14 * 86400000).toISOString();
        const realContract = await contractsService.create(
          {
            serviceId: activeService.id,
            agreedAmount: sumMilestones,
            deadline,
            milestones: adaptedMilestones,
          },
          `hire_${proposalId}`
        );
        if (realContract) {
          try {
            await http(`/jobs/proposals/${proposalId}/hire`, { method: "POST" });
          } catch {}
          if (foundProp?.jobId) {
            try {
              await jobsService.close(foundProp.jobId);
            } catch {}
          }
          return realContract;
        }
      }

      throw new ApiError({
        code: "VALIDATION",
        status: 400,
        message: "Mutaxassisning faol xizmati topilmadi. Shartnoma tuzish uchun mutaxassisda faol xizmat bo'lishi kerak",
        retryable: false,
      });
    }),
  withdraw: (id) =>
    call(async () => {
      let updated: Model.Proposal | null = null;
      try {
        const remote = await http<Model.Proposal>(`/jobs/proposals/${id}/withdraw`, { method: "POST" });
        if (remote && remote.id) updated = remote;
      } catch {}

      if (typeof window !== "undefined") {
        try {
          const myKey = "bbd_my_proposals";
          const existingMyProps: Model.Proposal[] = JSON.parse(localStorage.getItem(myKey) || "[]");
          const found = existingMyProps.find((p) => p.id === id);
          if (found) {
            found.status = "qaytarib_olingan";
            localStorage.setItem(myKey, JSON.stringify(existingMyProps));
            if (!updated) updated = found;
          }

          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("bbd_proposals_")) {
              const jobProps: Model.Proposal[] = JSON.parse(localStorage.getItem(key) || "[]");
              const jFound = jobProps.find((p) => p.id === id);
              if (jFound) {
                jFound.status = "qaytarib_olingan";
                localStorage.setItem(key, JSON.stringify(jobProps));
                if (!updated) updated = jFound;
              }
            }
          }
        } catch {}
      }
      if (updated) return updated;
      return { id, status: "qaytarib_olingan" } as Model.Proposal;
    }),
};

export const offersService: OffersService = {
  get: (id) => call(() => getOffer(id)),
  create: (data) => call(() => createOffer(data)),
  listSent: () => call(() => getSentOffers()),
  listIncoming: () => call(() => getIncomingOffers()),
  accept: (id) =>
    call(async () => {
      const contract = await acceptOffer(id);
      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem("bbd_custom_contracts") || "[]";
          const allCnt = JSON.parse(stored);
          if (!allCnt.some((c: Model.Contract) => c.id === contract.id)) {
            localStorage.setItem("bbd_custom_contracts", JSON.stringify([contract, ...allCnt]));
          }
        } catch {}
      }
      return contract;
    }),
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
      const page = await http<Page<RealContract>>(`${base}${toQuery({ perPage: 100 })}`);
      return Promise.all(page.items.map((c) => hydrateContract(c, role)));
    }),
  get: (id) =>
    call(async () => {
      const role = currentRole();
      const base = role === "mutaxassis" ? "/seller/contracts" : "/me/contracts";
      try {
        const c = await http<RealContract>(`${base}/${id}`);
        return await hydrateContract(c, role);
      } catch (e) {
        if (e instanceof ApiError && e.code === "NOT_FOUND") return null;
        throw e;
      }
    }),
  create: (input, idempotencyKey) =>
    call(async () => {
      const c = await http<RealContract>("/contracts", { method: "POST", body: input, idempotencyKey });
      return hydrateContract(c, "xaridor");
    }),
  accept: (id) =>
    call(async () => {
      const c = await http<RealContract>(`/seller/contracts/${id}/accept`, { method: "POST" });
      return hydrateContract(c, "mutaxassis");
    }),
  reject: (id) =>
    call(async () => {
      const c = await http<RealContract>(`/seller/contracts/${id}/reject`, { method: "POST" });
      return hydrateContract(c, "mutaxassis");
    }),
  cancel: (id) =>
    call(async () => {
      const c = await http<RealContract>(`/me/contracts/${id}/cancel`, { method: "POST" });
      return hydrateContract(c, "xaridor");
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
      const hydrated = await hydrateContract(c, role);
      return c.milestones
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((m) => mapMilestone(m, !!hydrated.fundedAt));
    }),
  listMine: () =>
    call(async () => {
      const role = currentRole();
      const base = role === "mutaxassis" ? "/seller/contracts" : "/me/contracts";
      const results: Model.Milestone[] = [];
      const page = await http<Page<RealContract>>(`${base}${toQuery({ perPage: 100 })}`);
      for (const c of page.items) {
        const hydrated = await hydrateContract(c, role);
        for (const m of c.milestones) results.push(mapMilestone(m, !!hydrated.fundedAt));
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
  getCards: () =>
    call(async () => {
      if (typeof window !== "undefined") {
        try {
          const session = sessionStore.read();
          const uid = session?.userId || "me";
          const stored = localStorage.getItem(`bbd_cards_${uid}`);
          if (stored) return JSON.parse(stored);
          const fallback = localStorage.getItem("bbd_cards_me");
          if (fallback) return JSON.parse(fallback);
        } catch {}
      }
      return [];
    }),
  addCard: (data) =>
    call(async () => {
      const rawNumber = data.number.replace(/\D/g, "");
      if (rawNumber.length !== 16) throw new Error("INVALID_CARD");
      const cardType = detectCardType(rawNumber);
      if (!cardType) throw new Error("INVALID_CARD");
      cardExpiry(data.expiry);
      if (!data.holderName?.trim()) throw new Error("INVALID_HOLDER");

      const session = sessionStore.read();
      const uid = session?.userId || "me";

      const card: Model.PaymentCard = {
        id: `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userId: uid,
        type: cardType,
        last4: rawNumber.slice(-4),
        holderName: data.holderName.trim().toUpperCase(),
        expiry: data.expiry,
        createdAt: new Date().toISOString(),
      };

      if (typeof window !== "undefined") {
        const key = `bbd_cards_${uid}`;
        let existing: Model.PaymentCard[] = [];
        try {
          existing = JSON.parse(localStorage.getItem(key) || "[]");
        } catch {
          existing = [];
        }
        if (existing.some((c) => c.last4 === card.last4 && c.type === card.type)) {
          throw new Error("CARD_EXISTS");
        }
        if (existing.length >= 5) {
          throw new Error("CARD_LIMIT");
        }
        const updated = [card, ...existing];
        try {
          localStorage.setItem(key, JSON.stringify(updated));
          if (uid !== "me") {
            localStorage.setItem("bbd_cards_me", JSON.stringify(updated));
          }
        } catch {}
      }
      return card;
    }),
  removeCard: (id) =>
    call(async () => {
      if (typeof window !== "undefined") {
        try {
          const session = sessionStore.read();
          const uid = session?.userId || "me";
          const key = `bbd_cards_${uid}`;
          const existing: Model.PaymentCard[] = JSON.parse(localStorage.getItem(key) || "[]");
          const updated = existing.filter((c) => c.id !== id);
          localStorage.setItem(key, JSON.stringify(updated));
          if (uid !== "me") {
            localStorage.setItem("bbd_cards_me", JSON.stringify(updated));
          }
        } catch {}
      }
    }),
  withdrawEarnings: (destination, amount) =>
    call(async () => {
      let cardDetails = "Plastik karta";
      if (typeof destination === "string") {
        cardDetails = destination;
      } else if (typeof destination === "object" && destination.type === "card") {
        cardDetails = destination.cardId;
      } else if (typeof destination === "object" && destination.type === "bank_account") {
        cardDetails = `Bank: ${destination.bankAccount.accountNumber} (MFO: ${destination.bankAccount.mfo})`;
      }

      let userName = "Mutaxassis";
      try {
        const me = await http<RealMe>("/me");
        if (me && typeof me.fullName === "string") userName = me.fullName;
      } catch {}

      const reqAmount = Math.round(Number(amount)) || 0;
      if (reqAmount <= 0) {
        throw new ApiError({
          code: "VALIDATION",
          status: 400,
          message: "Summa 0 dan katta bo'lishi kerak",
          retryable: false,
        });
      }

      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `wd_${Date.now()}`;

      const res = await http<RealPayout>("/seller/payouts", {
        method: "POST",
        body: {
          amount: reqAmount,
          destinationReference: cardDetails,
        },
        idempotencyKey,
      });

      return mapPayout(res, userName);
    }),
  withdrawBalance: () => disabled(),
  getWithdrawnTotal: () =>
    call(async () => {
      if (currentRole() === "mutaxassis") {
        try {
          const page = await http<Page<RealPayout>>("/seller/payouts?page=1&perPage=100");
          return page.items
            .filter((p) => p.status === "SUCCEEDED")
            .reduce((sum, p) => sum + p.amount, 0);
        } catch {}
      }
      return 0;
    }),
  getPendingWithdrawalTotal: () =>
    call(async () => {
      if (currentRole() === "mutaxassis") {
        try {
          const page = await http<Page<RealPayout>>("/seller/payouts?page=1&perPage=100");
          return page.items
            .filter((p) => p.status === "PENDING" || p.status === "PROCESSING")
            .reduce((sum, p) => sum + p.amount, 0);
        } catch {}
      }
      return 0;
    }),
  listMyWithdrawalRequests: () =>
    call(async () => {
      if (currentRole() === "mutaxassis") {
        try {
          let userName = "Mutaxassis";
          try {
            const me = await http<RealMe>("/me");
            if (me && typeof me.fullName === "string") userName = me.fullName;
          } catch {}
          const page = await http<Page<RealPayout>>("/seller/payouts?page=1&perPage=100");
          return page.items.map((p) => mapPayout(p, userName));
        } catch {}
      }
      return [];
    }),
  createContractPayment: (contractId, idempotencyKey) =>
    call(async () => {
      return mapPayment(
        await http<RealPayment>(`/me/contracts/${contractId}/payment`, { method: "POST", idempotencyKey })
      );
    }),
  getContractPayment: (contractId) =>
    call(async () => {
      try {
        const page = await http<Page<RealPayment>>(`/me/payments${toQuery({ contractId, perPage: 1 })}`);
        const latest = page.items[0];
        if (latest) return mapPayment(latest);
      } catch {}
      return null;
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
  listMine: () =>
    call(async () => {
      try {
        const page = await http<Page<RealDispute>>(`/me/disputes${toQuery({ perPage: 100 })}`);
        return page.items.map(mapDispute);
      } catch {
        if (typeof window !== "undefined") {
          try {
            const raw = localStorage.getItem("sb2_disputes");
            if (raw) return JSON.parse(raw);
          } catch {}
        }
        return [];
      }
    }),
  getForContract: (contractId) =>
    call(async () => {
      const page = await http<Page<RealDispute>>(`/me/disputes${toQuery({ perPage: 100 })}`);
      const match = page.items.find((d) => d.contractId === contractId);
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
      const page = await http<Page<RealDispute>>(`/me/disputes${toQuery({ perPage: 100 })}`);
      const match = page.items.find((d) => d.contractId === contractId);
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

/* KYC — real backendda yo'q, shuning uchun /me/seller-application va localStorage orqali ishlaydi */
export const verificationService: VerificationService = {
  getMine: () =>
    call(async () => {
      try {
        const app = await http<RealSellerApplication>("/me/seller-application");
        if (app) {
          const statusMap: Record<string, Model.VerificationRecord["status"]> = {
            PENDING: "korib_chiqilmoqda",
            APPROVED: "tasdiqlangan",
            REJECTED: "rad_etilgan",
          };
          const descStr = typeof app.description === "string" ? app.description : "";
          const passportMatch = descStr.match(/Pasport\/ID:\s*([^|\]]+)/);
          const innMatch = descStr.match(/STIR\/INN:\s*([^|\]]+)/);
          const companyMatch = descStr.match(/Yuridik:\s*([^|\]]+)/);
          return {
            userId: app.userId,
            country: "UZ",
            documentType: "passport",
            legalName: app.legalName || "Foydalanuvchi",
            birthDate: "1995-01-01",
            documents: [],
            status: statusMap[app.status] ?? "korib_chiqilmoqda",
            submittedAt: app.createdAt,
            rejectionReason: app.rejectionReason,
            passportNumber: passportMatch ? passportMatch[1].trim() : undefined,
            inn: innMatch ? innMatch[1].trim() : undefined,
            companyDetails: companyMatch ? companyMatch[1].trim() : undefined,
          };
        }
      } catch {}

      if (typeof window !== "undefined") {
        try {
          const me = await http<RealMe>("/me").catch(() => null);
          const uid = me?.id ?? "me";
          const stored = localStorage.getItem(`bbd_verification_${uid}`);
          if (stored) return JSON.parse(stored);
        } catch {}
      }
      return null;
    }),
  submit: (input) =>
    call(async () => {
      const me = await http<RealMe>("/me").catch(() => null);
      const uid = me?.id ?? "me";
      try {
        await http("/me/seller-application", {
          method: "POST",
          body: {
            legalName: input.legalName,
            displayName: input.legalName,
            description: `Hujjat turi: ${input.documentType}, Davlat: ${input.country}`,
            passportNumber: input.passportNumber,
            inn: input.inn,
            companyDetails: input.companyDetails,
          },
        });
      } catch {}

      const record: Model.VerificationRecord = {
        ...input,
        userId: uid,
        status: "korib_chiqilmoqda",
        submittedAt: new Date().toISOString(),
      };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`bbd_verification_${uid}`, JSON.stringify(record));
        } catch {}
      }
      return record;
    }),
};

/* Support ticketlar — Help Center uchun chiptalar boshqaruvi */
export const supportService: SupportService = {
  listMine: () =>
    call(async () => {
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
    }),
  listReplies: (ticketId: string) =>
    call(async () => {
      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem(`bbd_replies_${ticketId}`);
          if (stored) return JSON.parse(stored);
        } catch {}
      }
      return [];
    }),
  create: (input) =>
    call(async () => {
      const session = sessionStore.read();
      const uid = session?.userId || "me";
      const key = `bbd_support_${uid}`;
      const ticket: Model.SupportTicket = {
        id: `ticket_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userId: uid,
        topic: input.topic,
        subject: input.subject,
        message: input.message,
        status: "ochiq",
        createdAt: new Date().toISOString(),
      };
      if (typeof window !== "undefined") {
        try {
          const existing: Model.SupportTicket[] = JSON.parse(localStorage.getItem(key) || "[]");
          localStorage.setItem(key, JSON.stringify([ticket, ...existing]));
        } catch {}
      }
      const categoryMap: Record<string, string> = {
        tolov: "tolov_escrow",
        shartnoma: "loyiha",
        nizo: "loyiha",
        hisob: "hisob",
        texnik: "texnik",
        boshqa: "boshqa",
      };
      void fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: categoryMap[input.topic] ?? "boshqa",
          contactName: "Foydalanuvchi",
          contactInfo: `ID: ${uid}`,
          userId: uid,
          source: "help_center",
          route: typeof window !== "undefined" ? window.location.pathname : "/yordam",
          message: `${input.subject}\n\n${input.message}`,
        }),
      }).catch(() => {});

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
