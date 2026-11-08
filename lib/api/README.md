> **Current integration warning (2026-11-08):** this adapter is hybrid. Server
> rejection must propagate for marketplace, identity and financial operations;
> browser mock state is not a durable backend. Unsupported hiring, card binding,
> payout initiation, KYC and account deletion explicitly fail. See
> [re-audit evidence](../../docs/REAUDIT.md) for current boundaries. Historical
> integration notes below do not establish production readiness.

# `lib/api` — Frontend API chegarasi (backend-ready)

UI faqat shu paketdan import qiladi. Hozirgi implementatsiya brauzer ichidagi
mock adapterga (`lib/mock-api`, `localStorage`) delegatsiya qiladi. **Haqiqiy
backend `client.ts` ni almashtiradi — sahifa/komponentlar qayta yozilmaydi.**

## Qatlamlar

| Fayl | Vazifa | Backend'da |
|---|---|---|
| `contracts.ts` | Typed service interfeyslari + DTO'lar (`AuthService`, `JobsService`, `PaymentDTO`, `ApiPage<T>`, `ApiListQuery`) | **O'zgarmaydi** — shartnoma shu |
| `errors.ts` | `ApiError` + `ApiErrorCode` taksonomiyasi (HTTP statusga bog'langan, `retryable`, `fieldErrors`) | **O'zgarmaydi** |
| `state-machines.ts` | Holat o'tishlari (shartnoma/bosqich/…) — UI va server bir manbadan | Ulashiladi |
| `client.ts` | Kabinetlar adapteri: interfeyslarni **amalga oshiradi** | **Shu fayl almashadi** |
| `admin.ts` | Admin adapteri: har bir amalni `guard()`/`guardAsync()` bilan o'rab, xatoni `ApiError` ga o'giradi | **Shu fayl ham almashadi** |
| `index.ts` | Yagona ommaviy chegara (`export *`) | O'zgarmaydi |

UI qoidasi: har doim `@/lib/api` dan import qiling, hech qachon `@/lib/mock-api`
dan to'g'ridan-to'g'ri emas. Domen service obyektlarini afzal ko'ring
(`jobsService.list()`), `client.ts` dagi kabi.

**Admin uchun ham xuddi shu qoida**: `app/admin/**` va `components/admin/**`
faqat `@/lib/api/admin` dan import qiladi, `@/lib/admin-api` dan EMAS.
Admin funksiyalari sinxron bo'lgani uchun `admin.ts` sinxron `guard()`
ishlatadi (`client.ts` dagi async `call()` o'rniga) — imzolar o'zgarmaydi,
lekin xato baribir `ApiError` bo'lib chiqadi va `<ErrorState>` uni kod
bo'yicha to'g'ri ko'rsatadi.

**Admin sahifasi `localStorage` ga tegmaydi.** Kerakli amal qatlamda bo'lmasa,
uni sahifada "vaqtincha" yozib qo'ymang — `lib/admin-api.ts` ga qo'shing va
`lib/api/admin.ts` dan chiqaring. Aks holda amal ruxsat tekshiruvidan, audit
izidan va kvota himoyasidan tashqarida qoladi va backend ulanganda jimgina
ishlamay qoladi.

## Backend'ga o'tish retsepti

`client.ts` dagi har bir metodni `fetch` bilan almashtiring — **interfeys bir xil
qoladi**, shuning uchun UI umuman o'zgarmaydi:

```ts
// Hozir (mock):
export const jobsService: JobsService = {
  list: () => call(mock.getJobs),
  get: (id) => call(() => mock.getJob(id)),
  // ...
};

// Backend (misol):
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) throw await toApiError(res); // status → ApiErrorCode
  return res.status === 204 ? (undefined as T) : res.json();
}

export const jobsService: JobsService = {
  list: () => call(() => http<Job[]>("/jobs")),
  get: (id) => call(() => http<Job | null>(`/jobs/${id}`)),
  // ...
};
```

`call(...)` (= `withNormalizedErrors`) o'z joyida qoladi — u har qanday
tashlanган xatoni `ApiError` ga normalizatsiya qiladi.

### Xato shartnomasi (server → UI)

Server javobidagi HTTP statusni `ApiErrorCode` ga bog'lang (`toApiError`):

| HTTP | `ApiErrorCode` | UI xatti-harakati |
|---|---|---|
| 401 | `UNAUTHENTICATED` | login'ga yo'naltirish |
| 403 | `FORBIDDEN` | "ruxsat yo'q" |
| 404 | `NOT_FOUND` | topilmadi holati |
| 409 | `CONFLICT` / `INVALID_TRANSITION` | qayta yuklash / holat eskirgan |
| 422 | `VALIDATION` | `fieldErrors` ni forma maydonlariga bering |
| 429 | `RATE_LIMITED` | keyinroq urinish |
| 503 | `PAYMENTS_PAUSED` | `retryable` — qayta urinish tugmasi |
| 0 (offline) | `NETWORK` | `retryable` |

`fieldErrors?: Record<string,string>` — server maydon-darajali validatsiyani
qaytarganda, uni to'g'ridan-to'g'ri `Input error` proplariga ulash mumkin.

**`LEGACY_CODES` — shartnomaning bir qismi.** Ma'lumot qatlami tashlaydigan
har bir kod (`"PHONE_EXISTS"`, `"ACCOUNT_BLOCKED"`, `"CARD_LIMIT"` …) shu
jadvalda bo'lishi SHART. Jadvalda yo'q kod `UNKNOWN` + 500 + `retryable: true`
ga tushadi, ya'ni ekranda hech qachon yordam bermaydigan "Qayta urinish"
tugmasi chiqadi. Yangi `throw new Error("...")` qo'shsangiz, kodni `errors.ts`
ga ham yozing — buni lint ushlay olmaydi.

## Pagination (backend'da yoqiladi)

`ApiListQuery` (`cursor`/`limit`/`search`/`sort`) va `ApiPage<T>`
(`items`/`nextCursor`/`total`) allaqachon aniqlangan — kursorli. Hozir ro'yxatlar
to'liq qaytariladi va client-side sahifalanadi (`Pagination` komponenti,
`useDebouncedValue`). Backend'da: service metodini `ApiListQuery` qabul qilib
`ApiPage<T>` qaytaradigan qilib kengaytiring; UI'dagi `page/PER_PAGE` mantiqi
`cursor/nextCursor` ga o'tadi (faqat ro'yxat sahifalarida, komponentlar emas).

## To'lov (PaymentDTO)

`PaymentDTO.idempotencyKey` — to'lovni **takroran yuborishdan** himoya (tarmoq
qayta urinishi ikki marta yechmasligi uchun). Backend gateway (Payme/Click/karta)
`providerReference` ni to'ldiradi; `status` webhook orqali yangilanadi.

## Migratsiya tikuvi (seam) — YOPILGAN

Ilgari `index.ts` da vaqtincha `export * from "@/lib/mock-api"` bor edi.
**U olib tashlandi.** Endi barcha ekranlar faqat domen service'larini import
qiladi (`contractsService`, `paymentsService`, `catalogService`, `savedService`
va h.k.) — mock butunlay `client.ts` orqasida.

Amaldagi holat:

- `app/` va `components/` ichida `@/lib/mock-api` importi **0 ta**.
- `@/lib/api` dan import qilinadigan no-service nomlar — faqat ikkitasi:
  `DATA_CHANGED_EVENT` (ma'lumot yangilanganini bildiruvchi signal; backend'da
  websocket/SSE push yoki kesh invalidatsiyasiga almashadi) va `ApiError`
  (`ErrorState` xato kodini o'qish uchun; `@/lib/api/errors` dan ham
  import qilinadi).
- Model tiplari (`Specialist`, `AccountPreferences` va boshqalar) `@/lib/types`
  da — mock qatlamida emas.

### Yangi operatsiya qo'shish tartibi

1. `contracts.ts` ga metodni **interfeysga** yozing (DTO bilan).
2. `client.ts` da uni amalga oshiring (`call(() => ...)` ichida).
3. Ekranda service orqali chaqiring. Loose funksiya eksport qilinmaydi.

Shu tartib buzilmasa, backend'ga o'tish **faqat `client.ts` ni almashtirish**
bo'lib qoladi.

## Yuklash xatolari (UI shartnomasi)

Har bir ekranda `loadError` holati bor va `<ErrorState error onRetry>` bilan
ko'rsatiladi (`components/ui/ErrorState.tsx`). Qoidalar:

- **Xato hech qachon bo'sh ro'yxatga aylantirilmaydi** va "topilmadi" ham
  emas: `null` qaytishi (topilmadi) va `throw` (xato) alohida holatlar.
- `ApiError.code` ga qarab matn tanlanadi: `UNAUTHENTICATED` (sessiya tugadi),
  `FORBIDDEN`, `NOT_FOUND`, `NETWORK`, `RATE_LIMITED`, aks holda umumiy xato.
- `retryable` bo'lsa "Qayta urinish" tugmasi chiqadi.
- Header (har sahifada turadi) fon yangilanishida xatoni yutadi — sessiya
  tugaganda ekran xato bilan to'lib ketmasligi uchun; yo'naltirishni layout
  guard'i bajaradi.
