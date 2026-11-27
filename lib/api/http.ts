import type * as Model from "@/lib/types";
import { toApiError, toNetworkError } from "./errors";
import { roleToUz } from "./mappers";

/**
 * Bosqich 17 — real backend HTTP qatlami. `NEXT_PUBLIC_API_URL` BUILD
 * VAQTIDA beriladi (`.env.example`), production'da localhost/bo'sh qiymatga
 * tushmasin — CSP `connect-src` ham shu o'zgaruvchidan to'ldiriladi
 * (`csp.config.mjs`). Lokal ishlab chiqishda backend `:4000/api/v1` da
 * turadi (`backend/.env.example`).
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

const SESSION_KEY = "bd_session";

/* ------------------------------------------------------------------------
   Access token — FAQAT xotirada (module-scope). httpOnly refresh cookie
   brauzer tomonidan avtomatik yuboriladi (`credentials:"include"`); JS
   access token'ni sahifa yangilanishidan keyin YO'QOTADI — bu ataylab,
   XSS orqali localStorage'dan o'g'irlab bo'lmaydigan joyda turadi. Birinchi
   so'rov 401 bilan qaytsa `refresh()` uni tiklaydi (pastga qarang).
   ------------------------------------------------------------------------ */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return Boolean(accessToken);
}

/* ------------------------------------------------------------------------
   Sessiya snapshot — `AuthService.getSession()` SINXRON qolishi shart
   (`contracts.ts` shartnomasi: layout guard'lari har render'da o'qiydi).
   Bu yerda faqat "kim kirgan" ko'rinadi — haqiqiy tekshiruv har so'rovda
   server tomonida (Bearer token + cookie).
   ------------------------------------------------------------------------ */
const FALLBACK_SESSION_KEY = "sb_session";

function readSession(): Model.Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY) || window.localStorage.getItem(FALLBACK_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Model.Session;
  } catch {
    return null;
  }
}

function writeSession(session: Model.Session): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(session);
  window.localStorage.setItem(SESSION_KEY, raw);
  window.localStorage.setItem(FALLBACK_SESSION_KEY, raw);
}

function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(FALLBACK_SESSION_KEY);
}

export const sessionStore = { read: readSession, write: writeSession, clear: clearSession };

/**
 * JWT `sub` claim'ini IMZONI TEKSHIRMASDAN o'qiydi — bu yerda xavfsizlik
 * qarori YO'Q (faqat UI snapshot uchun userId), haqiqiy tekshiruv har doim
 * server tomonida. Access token bilan bir xil so'rov javobida keladi,
 * shuning uchun bu chaqiruv tarmoqqa chiqmaydi.
 */
export function decodeJwtSub(token: string): string {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as { sub?: string };
    return parsed.sub ?? "";
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------------
   Refresh — SINGLE-FLIGHT: bir vaqtda faqat bitta `/auth/refresh` so'rovi
   uchadi, parallel 401'lar shu bittasiga "qo'shiladi". Muvaffaqiyatsiz
   bo'lsa sessiya tozalanadi (foydalanuvchi qayta kirishi kerak) — cheksiz
   retry YO'Q, chunki `http()` refresh'dan keyin so'rovni FAQAT bir marta
   qayta yuboradi (`retryAfterRefresh=false` bilan).
   ------------------------------------------------------------------------ */
const NO_REFRESH_PATHS = new Set([
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/register/request-otp",
  "/auth/register/verify-otp",
  "/auth/register/complete",
  "/auth/password-reset/request-otp",
  "/auth/password-reset/verify-otp",
  "/auth/password-reset/complete",
]);

let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      clearSession();
      setAccessToken(null);
      if (typeof window !== "undefined") {
        const path = window.location.pathname;
        if (
          path.startsWith("/mutaxassis") ||
          path.startsWith("/xaridor") ||
          path.startsWith("/admin")
        ) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/kirish";
        }
      }
      return null;
    }
    const body = (await res.json()) as {
      accessToken: string;
      activeRole: "SELLER" | "BUYER" | null;
      roleChosen: boolean;
      profileDone: boolean;
    };
    setAccessToken(body.accessToken);
    writeSession({
      userId: decodeJwtSub(body.accessToken),
      role: roleToUz(body.activeRole),
      profileDone: body.profileDone,
      verified: true,
    });
    return body.accessToken;
  } catch {
    return null;
  }
}

function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Sahifa yangilanganda access token xotirada yo'q — snapshot bor bo'lsa,
    birinchi haqiqiy so'rovdan OLDIN fonda bir marta tiklashga urinamiz. */
export function bootstrapSession(): void {
  if (typeof window === "undefined") return;
  if (accessToken) return;
  if (!readSession()) return;
  void refreshOnce();
}

/** `AuthService.refresh()` — tashqi (UI) chaqiruv uchun, `http()`ning
    ichki 401-retry yo'li bilan BIR XIL single-flight'dan foydalanadi. */
export async function refreshSession(): Promise<Model.Session | null> {
  const token = await refreshOnce();
  return token ? readSession() : null;
}

/* ------------------------------------------------------------------------
   `http()` — YAGONA fetch nuqtasi. Xato hech qachon xom `Error` sifatida
   chiqmaydi — doim `ApiError` (`toApiError`/`toNetworkError`).
   ------------------------------------------------------------------------ */
export interface HttpInit extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Idempotency-Key header — moliyaviy mutatsiyalar uchun barqaror kalit */
  idempotencyKey?: string;
}

async function rawFetch(path: string, init: HttpInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${API_BASE}${path}`, {
    ...init,
    body,
    headers,
    credentials: "include",
  });
}

export async function http<T>(path: string, init: HttpInit = {}, allowRetry = true): Promise<T> {
  let res: Response;
  try {
    res = await rawFetch(path, init);
  } catch (cause) {
    throw toNetworkError(cause);
  }

  if (res.status === 401 && allowRetry && !NO_REFRESH_PATHS.has(path)) {
    const token = await refreshOnce();
    if (token) return http<T>(path, init, false);
    throw await toApiError(res);
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function normalizeProtectedPath(pathOrUrl: string): string {
  const apiMatch = pathOrUrl.match(/\/api\/v1(\/.*)$/);
  if (apiMatch) return apiMatch[1]!;
  return pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
}

export async function httpBlob(pathOrUrl: string, allowRetry = true): Promise<Blob> {
  const path = normalizeProtectedPath(pathOrUrl);
  if (!accessToken && readSession()) {
    await refreshOnce();
  }
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers, credentials: "include" });
  } catch (cause) {
    throw toNetworkError(cause);
  }
  if (res.status === 401 && allowRetry) {
    const token = await refreshOnce();
    if (token) return httpBlob(path, false);
    throw await toApiError(res);
  }
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

/** Query-string qurish — `undefined`/`""` maydonlar tashlab ketiladi. */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
