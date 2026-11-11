> **2026-11-08 re-audit: NOT READY for a real-money production launch.**
> This document below is historical and describes an older frontend integration.
> Current evidence and release blockers: [local re-audit](docs/REAUDIT.md),
> [all original findings](docs/REAUDIT-ORIGINAL-FINDINGS.md),
> [financial review](docs/REAUDIT-FINANCIAL.md), [security review](docs/REAUDIT-SECURITY.md).
> The backend now exists; mock-backed chat/profile/admin functions and disabled
> job hiring, card binding/payout initiation, KYC and deletion remain incomplete.
> No live deployment, financial transaction or production-data access was performed.

# Bobololadono production readiness

Holat: frontend mahsulot oqimlari tayyor va **backend ulanishiga tayyor**;
real launch server va operatsion infratuzilmasiz mumkin emas.

Frontend tomonidan bajarilgan (launch uchun old shart):

- UI faqat `lib/api` domen service'lari orqali ishlaydi; mock adapter butunlay
  `client.ts` orqasida (`export * from "@/lib/mock-api"` tikuvi yopilgan).
  Backend'ga o'tish = bitta faylni almashtirish.
- Har bir operatsiya `contracts.ts` da typed interfeys bilan qoplangan.
- Yuklash xatolari `ApiError` taksonomiyasi bo'yicha ekranda ko'rsatiladi
  (`ErrorState`, qayta urinish bilan); xato bo'sh ro'yxatga aylanmaydi.
- Sessiya yo'q bo'lganda UI demo hisob identifikatoriga tushmaydi (ilgari
  `?? SELLER_ID` xabar egaligini noto'g'ri hisoblardi).

## P0 — launchni bloklaydi

1. `lib/mock-api` o‘rniga autentifikatsiyalangan server API.
2. PostgreSQL kabi tranzaksion ma’lumotlar bazasi va migratsiyalar.
3. OTP/Telegram tasdiqlashning server implementatsiyasi, rate limit va session
   rotation.
4. Click/Payme merchant shartnomalari, server-side payment yaratish, imzo
   tekshirish, idempotency va webhook.
5. Escrow uchun double-entry ledger, reconciliation, refund va chargeback.
6. KYC hujjatlari uchun shifrlangan object storage, antivirus tekshiruvi,
   retention va moderator paneli.
7. Nizo/support uchun admin panel, SLA, audit log va moderator rollari.
8. Huquqiy matnlarni faoliyat yuritiladigan mamlakatlar bo‘yicha yurist
   tasdiqlashi.

## P1 — public launchdan oldin

- Password reset, phone-change va session/device management server oqimlari.
- Email/SMS/Telegram notification delivery va unsubscribe mexanizmi.
- Fayllarni signed URL orqali yuklash, content scanning va download policy.
- Search index, pagination, server-side filter va abuse/spam nazorati.
- Observability: structured logs, error tracking, metrics va alertlar.
- Backup/restore sinovi va disaster recovery rejasi.
- Fraud rules: velocity limits, account linking, suspicious payout hold.
- Soliq/fiskal chek va marketplace komissiya hisoboti.
- FX: har bir yozuvning asl valyutasi, kurs manbasi, rounding va settlement
  qoidalari. Kurs bo‘lmaguncha UI faqat UZS ko‘rsatadi.

## P2 — o‘sish bosqichi

- Buyer kompaniya profili va jamoaviy accountlar.
- Mutaxassis paketlari, recurring contract va hourly work.
- Tavsiya/matching, saved search va alertlar.
- Referral/promo, analytics va cohort reporting.
- Mobil ilovalar va push notification.

## Frontend tekshiruv mezonlari

- `npm run lint`
- `npm run build`
- 360, 390, 430, 768, 1024 va 1280px responsive smoke test
- Klaviatura navigatsiyasi, focus trap/restore va screen-reader label tekshiruvi
- Payment/KYC/dispute uchun success, pending, failed, retry va blocked holatlari
- UZ/RU/EN tarjima completeness

