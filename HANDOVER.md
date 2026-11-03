# 🤝 Loyiha Topshirish Hujjati (Handover Document)

**Loyiha:** Bobo-Doda — Markaziy Osiyo xizmatlar marketplace'i  
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS · NestJS (backend)  
**Topshirilgan sana:** 2026-11-03  
**Holat:** Frontend tayyor ✅ · Backend integratsiya talab qiladi ⏳

---

## 🎯 Loyiha Maqsadi

**Nima qurildi?**  
Markaziy Osiyo (asosan O'zbekiston) uchun ikki tomonlama xizmatlar platformasi:
- **Xaridor** → mutaxassis topadi, ish e'loni beradi, bosqichli escrow orqali to'laydi
- **Mutaxassis** → xizmat sotadi, e'lonlarga taklif yuboradi, ishni topshiradi, daromad oladi

**Nima tayyor?**
- ✅ Barcha frontend sahifalari (70+ sahifa)
- ✅ UI/UX dizayn tizimi (komponentlar)
- ✅ Mock API (local ma'lumotlar bilan ishlaydi)
- ✅ Admin panel (KYC, nizolar, moderatsiya)
- ✅ To'lov sahifalari (Click, Payme, bank kartasi — UI tayyor)
- ✅ Chat, bildirishnomalar, reyting tizimi
- ✅ KYC/verifikatsiya markazi
- ✅ Ko'p tillilik (UZ/RU/EN)

**Nima qoldi?**
- ⏳ Real backend API ulanishi (`lib/mock-api` → real server)
- ⏳ Click/Payme merchant shartnomasi va webhook'lar
- ⏳ OTP tasdiqlash (Telegram/SMS) server-side
- ⏳ KYC hujjatlari uchun xavfsiz storage
- ⏳ Escrow ledger server-side

---

## 📁 Kod Tuzilmasi — Qaerga Nima

### Sahifalar Xaritasi

```
Ommaviy sahifalar:
  /                    → app/page.tsx           (Landing)
  /bozor               → app/(main)/bozor/      (Marketplace)
  /kirish              → app/(auth)/kirish/      (Login)
  /royxatdan-otish     → app/(auth)/royxatdan-otish/ (Register)
  /yordam-markazi      → app/yordam-markazi/    (Help center)
  /shartlar            → app/shartlar/          (ToS)
  /maxfiylik           → app/maxfiylik/         (Privacy)

Xaridor (auth kerak):
  /xaridor             → Dashboard
  /xaridor/my-jobs     → Mening ish e'lonlarim
  /xaridor/contracts   → Shartnomalar
  /xaridor/messages    → Chat
  /xaridor/billing     → To'lovlar
  /xaridor/disputes    → Nizolar

Mutaxassis (auth kerak):
  /mutaxassis          → Dashboard
  /mutaxassis/services → Xizmatlarim
  /mutaxassis/applications → Arizalarim
  /mutaxassis/contracts → Shartnomalar
  /mutaxassis/messages → Chat
  /mutaxassis/billing  → Daromad va pul chiqarish

Admin panel:
  /admin               → Dashboard
  /admin/foydalanuvchilar → Foydalanuvchilar
  /admin/verifikatsiya → KYC navbat
  /admin/nizolar       → Nizo navbat
  /admin/tolovlar      → To'lovlar
  /admin/shartnomalar  → Shartnomalar
```

### Eng Muhim Fayllar

| Fayl | Nima qiladi |
|------|-------------|
| `lib/api/client.ts` | **API bridge** — mock → real server bu yerda almashadi |
| `lib/api/contracts.ts` | Barcha TypeScript interface'lar |
| `lib/mock-api/` | Hozirgi local mock ma'lumotlar |
| `components/ui/` | Dizayn tizimi komponentlari |
| `app/layout.tsx` | Root layout, global provider'lar |
| `next.config.mjs` | Next.js konfiguratsiyasi, CSP header'lar |
| `tailwind.config.ts` | Dizayn token'lari va rang palitasi |

---

## 🔌 Backend Ulanishi — Asosiy Vazifa

**Hozirgi holat:** Frontend `lib/mock-api` dan ma'lumot oladi (browser'da).

**Maqsad:** `lib/api/client.ts` → real NestJS server'ga o'tish.

### Qanday o'tish kerak?

1. **`lib/api/client.ts` faylini oching** — shu yerda `export` ni o'zgartirish kifoya
2. **`NEXT_PUBLIC_API_URL`** env variable'ni server URL'ga ko'rsating
3. **JWT token'lar** uchun HTTP client (fetch/axios) qo'shing
4. **Har bir service** (`AuthService`, `JobsService`, `ContractsService` va h.k.) real API call'larga o'zgartiring

### Backend endpoint'lar

Barcha endpoint'lar [`BACKEND_INTEGRATION.md`](BACKEND_INTEGRATION.md) da batafsil yozilgan.

**Asosiy pattern:**
```
/api/v1/auth/...        — Autentifikatsiya
/api/v1/users/...       — Foydalanuvchilar
/api/v1/jobs/...        — Ish e'lonlari
/api/v1/contracts/...   — Shartnomalar + Escrow
/api/v1/admin/...       — Admin operatsiyalar
```

---

## ⚠️ Muhim Ogohlantirishlar

### Hozir qanday ishlaydi
Butun frontend **mock data** bilan ishlaydi — hech qanday haqiqiy server yo'q.  
Login qilsangiz — demo foydalanuvchi bilan kiradi.  
To'lov qilsangiz — simulation ko'rinadi, haqiqiy pul o'tmaydi.

### Taqiqlangan narsalar
- `localStorage` da JWT token saqlash — **XSS xavfi**! HttpOnly cookie ishlatish
- `lib/api/contracts.ts` dagi interface'larni o'zgartirmasdan backend'ni o'zgartirish
- KZT/KGS/TJS/TMT valyuta konvertatsiyasi — backend real FX kursi berguncha **yoqilmaydi**

### Backend uchun muhim
- Click/Payme — **merchant shartnomasi** kerak (hozir yo'q)
- KYC hujjatlari — **shifrlangan object storage** kerak (S3/MinIO)
- OTP — **Telegram Bot API** yoki SMS gateway kerak

---

## 🧩 Asosiy Biznes Qoidalari

- Bir kunda mutaxassis **ko'pi bilan 2 ta** ish e'loniga ariza topshira oladi
- Mutaxassis shu kuni **boshqa ish uchun tasdiqlanganda** — qolgan arizalari bekor qilinadi
- Escrow: xaridor pul o'tkazadi → ishchi topshiradi → xaridor qabul qiladi → pul chiqariladi
- Milestones: 3 kun ichida qabul qilinmasa — **avtomatik qabul** bo'ladi

---

## 🛠️ Rivojlantirish Muhiti

### Kerakli narsalar
- Node.js 20+
- npm 10+
- Git

### Buyruqlar
```bash
npm install          # O'rnatish
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm run lint         # Kod tekshirish
npm run typecheck    # TypeScript tekshirish
```

---

## 📋 Birinchi Hafta Vazifalar (Yangi Dev Uchun)

**Kun 1-2: Tushunish**
- [ ] README.md o'qing
- [ ] `npm run dev` bilan ishga tushiring
- [ ] Barcha sahifalarni ko'ring (asosan xaridor va mutaxassis oqimi)
- [ ] `lib/api/contracts.ts` ni o'qing — interface'larni tushunish

**Kun 3-4: Backend**
- [ ] `BACKEND_INTEGRATION.md` o'qing
- [ ] `docs/00-api-surface.md` o'qing
- [ ] Local NestJS backend'ni ishga tushiring (`cd backend && npm run start:dev`)
- [ ] Birinchi endpoint'ni uling (auth/login)

**Kun 5: Infra**
- [ ] `.env.local` ni to'liq sozlang
- [ ] CI/CD pipeline'ni tushunib oling (`.github/workflows/`)
- [ ] Deploy jarayonini tushuning

---

## 📞 Aloqa va Yordam

Savollar yoki muammolar bo'lsa:
- **GitHub Issues** dan foydalaning — barcha texnik muammolarni shu yerda yozing
- Har bir Issue uchun label qo'ying: `bug`, `feature`, `question`, `backend`

---

*Bu hujjat loyiha topshirilish vaqtida yozilgan. O'zgarishlar bo'lsa — yangilang.*
