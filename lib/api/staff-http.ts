import { ApiError, toApiError, toNetworkError } from "./errors";
import type { AdminAccount, AdminRole, AdminSession } from "@/lib/admin-types";

/**
 * Bosqich 17 — staff (admin) HTTP qatlami. Marketplace `http.ts`dan ATAYLAB
 * ALOHIDA: butunlay boshqa cookie (`staff_refresh_token`), boshqa access
 * token, boshqa `/staff/*` endpoint oilasi — ikkalasi bir-biriga
 * ARALASHMASLIGI SHART (bo'lim 91-J, xodim va bozor sessiyasi mustaqil).
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const SESSION_KEY = "bd_staff_session";

let accessToken: string | null = null;
export function setStaffAccessToken(token: string | null): void {
  accessToken = token;
}

function readSession(): AdminSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AdminSession;
    if (Date.parse(session.expiresAt) <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}
function writeSession(session: AdminSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}
export const staffSessionStore = { read: readSession, write: writeSession, clear: clearSession };

const ACCOUNT_KEY = "bd_staff_account";
function readAccount(): AdminAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as AdminAccount) : null;
  } catch {
    return null;
  }
}
function writeAccount(account: AdminAccount): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}
function clearAccount(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCOUNT_KEY);
}
export const staffAccountStore = { read: readAccount, write: writeAccount, clear: clearAccount };

export function roleToLower(role: string): AdminRole {
  return role.toLowerCase() as AdminRole;
}

function decodeJwtSub(token: string): string {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { sub?: string }).sub ?? "";
  } catch {
    return "";
  }
}
export { decodeJwtSub as decodeStaffJwtSub };

/**
 * Server session verdict is gone: local staff state is cleared and the admin
 * shell is told to leave (the event carries the role so a super_admin is sent
 * to `/rahbariyat/kirish`, not the operator login that rejects that role).
 */
export const STAFF_SESSION_EXPIRED_EVENT = "bd:staff-session-expired";

/** Auth endpoints whose 401 is an answer about credentials, not an expired access token. */
const NO_REFRESH_PATHS = new Set(["/staff/auth/login", "/staff/auth/refresh"]);

type RefreshOutcome = { kind: "ok" } | { kind: "rejected" } | { kind: "unavailable"; cause: unknown };

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/* The page-load refresh can clear the stored account before the admin layout
   runs its guard; keep the role in memory so it still picks the right login. */
let expiredRole: AdminRole | null = null;
export function takeExpiredStaffRole(): AdminRole | null {
  const role = expiredRole;
  expiredRole = null;
  return role;
}

function expireSession(): void {
  const role = readAccount()?.role ?? null;
  clearSession();
  clearAccount();
  setStaffAccessToken(null);
  // No stored account = no logged-in UI to tear down (e.g. during adminLogout).
  if (role && typeof window !== "undefined") {
    expiredRole = role;
    window.dispatchEvent(new CustomEvent(STAFF_SESSION_EXPIRED_EVENT, { detail: { role } }));
  }
}

async function performRefresh(): Promise<RefreshOutcome> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/staff/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  } catch (cause) {
    return { kind: "unavailable", cause };
  }
  // Only 401/403 are a verdict on the session; a 5xx/429 during a deploy must not log staff out.
  if (res.status === 401 || res.status === 403) {
    expireSession();
    return { kind: "rejected" };
  }
  if (!res.ok) return { kind: "unavailable", cause: new Error(`refresh ${res.status}`) };
  let body: { accessToken: string; role: string };
  try {
    body = (await res.json()) as { accessToken: string; role: string };
  } catch (cause) {
    return { kind: "unavailable", cause };
  }
  setStaffAccessToken(body.accessToken);
  if (readAccount()) {
    writeSession({
      adminId: decodeJwtSub(body.accessToken),
      role: roleToLower(body.role),
      expiresAt: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
    });
  }
  return { kind: "ok" };
}
function refreshOnce(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export function bootstrapStaffSession(): void {
  if (typeof window === "undefined") return;
  if (accessToken) return;
  // Keyed on the stored account (what the UI trusts), not the 14-minute
  // session record: after 14 minutes the old gate skipped the refresh and
  // every page load sent its first requests without a token.
  if (!readAccount()) return;
  void refreshOnce();
}

/**
 * Confirms the stored account still has a live server session before the UI
 * trusts it. `offline` = refresh could not get a verdict (network/5xx); the
 * caller keeps the session and lets requests surface their own error.
 */
export async function ensureStaffSession(): Promise<"valid" | "expired" | "offline"> {
  if (accessToken) return "valid";
  if (!readAccount()) return "expired";
  const outcome = await refreshOnce();
  if (outcome.kind === "ok") return "valid";
  return outcome.kind === "rejected" ? "expired" : "offline";
}

function sessionExpiredError(): ApiError {
  return new ApiError({ code: "UNAUTHENTICATED", status: 401, retryable: false, message: "TOKEN_EXPIRED" });
}

export interface StaffHttpInit extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Idempotency-Key header — moliyaviy mutatsiyalar uchun barqaror kalit */
  idempotencyKey?: string;
}

async function rawFetch(path: string, init: StaffHttpInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${API_BASE}${path}`, { ...init, body, headers, credentials: "include" });
}

export async function staffHttp<T>(path: string, init: StaffHttpInit = {}, allowRetry = true): Promise<T> {
  const refreshable = !NO_REFRESH_PATHS.has(path.split("?")[0]);
  // After a full page load the access token (memory only) is gone: restore it
  // BEFORE sending, instead of sending unauthenticated requests that 401.
  if (refreshable && !accessToken && readAccount()) {
    const outcome = await refreshOnce();
    if (outcome.kind === "rejected") throw sessionExpiredError();
    if (outcome.kind === "unavailable") throw toNetworkError(outcome.cause);
  }
  let res: Response;
  try {
    res = await rawFetch(path, init);
  } catch (cause) {
    throw toNetworkError(cause);
  }
  if (res.status === 401 && allowRetry && refreshable) {
    const outcome = await refreshOnce();
    if (outcome.kind === "ok") return staffHttp<T>(path, init, false);
    throw await toApiError(res);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function normalizeStaffProtectedPath(pathOrUrl: string): string {
  const apiMatch = pathOrUrl.match(/\/api\/v1(\/.*)$/);
  if (apiMatch) return apiMatch[1]!;
  return pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
}

export async function staffHttpBlob(pathOrUrl: string, allowRetry = true): Promise<Blob> {
  const path = normalizeStaffProtectedPath(pathOrUrl);
  if (!accessToken && readAccount()) {
    const outcome = await refreshOnce();
    if (outcome.kind === "rejected") throw sessionExpiredError();
    if (outcome.kind === "unavailable") throw toNetworkError(outcome.cause);
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
    const outcome = await refreshOnce();
    if (outcome.kind === "ok") return staffHttpBlob(path, false);
    throw await toApiError(res);
  }
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

export function staffToQuery(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
