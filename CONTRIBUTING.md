# Bobo-Doda — Ishga Kirishish Qo'llanmasi

Markaziy Osiyo xizmatlar marketplace'i — **Next.js 16 / React 19 / TypeScript** stack.

---

## 📦 Loyiha Tuzilmasi

```
Bobo-Doda/
├── app/                    # Next.js App Router sahifalari
│   ├── (auth)/             # Autentifikatsiya sahifalari
│   ├── (main)/             # Asosiy sahifalar (xaridor + mutaxassis)
│   │   ├── xaridor/        # Xaridor dashboard va oqimlari
│   │   └── mutaxassis/     # Mutaxassis dashboard va oqimlari
│   ├── admin/              # Admin panel sahifalari
│   ├── bozor/              # Ommaviy marketplace
│   └── ...
├── components/             # Umumiy UI komponentlar
│   └── ui/                 # Asosiy dizayn tizimi komponentlari
├── lib/                    # Biznes logika va API qatlami
│   ├── api/                # API client va contracts
│   │   ├── client.ts       # ← Asosiy API bridge (mock → real)
│   │   └── contracts.ts    # ← Barcha typed interfeys'lar
│   └── mock-api/           # Hozirgi local mock data (backend kelguncha)
├── docs/                   # Texnik hujjatlar (API, schema, qarorlar)
├── backend/                # NestJS backend (alohida workspace)
└── packages/               # Umumiy paketlar (contracts types)
```

---

## 🚀 Ishga Tushirish

```bash
# 1. Talablar: Node.js 20+, npm 10+
node --version   # v20+
npm --version    # 10+

# 2. O'rnatish
npm install

# 3. Environment setup
cp .env.example .env.local
# .env.local ni to'ldiring (quyida batafsil)

# 4. Development server
npm run dev
# → http://localhost:3000
```

### Environment Variables

`.env.local` ga qo'shilishi kerak bo'lgan asosiy o'zgaruvchilar:

```env
# API URL (backend ishga tushirilganda)
NEXT_PUBLIC_API_URL=http://localhost:3001

# Hozir mock rejimida ishlaydi, backend tayyor bo'lganda o'zgartiring
```

Barcha o'zgaruvchilar ro'yxati uchun [`.env.example`](.env.example) ga qarang.

---

## 🏗️ Arxitektura — Muhim Nuqtalar

### API Qatlami (eng muhim!)

Butun loyiha **bitta fayldan** ishlaydi: [`lib/api/client.ts`](lib/api/client.ts)

```
Hozir:   lib/mock-api  ← local mock data
Backend tayyor bo'lsa: API server ← bu faylni almashtirish kifoya
```

**Mock → Real backend o'tish:** `lib/api/client.ts`dagi `export` ni o'zgartiring. Boshqa hech narsa o'zgarmaydi.

### Rol Tizimi

| Rol | Yo'l | Tavsif |
|-----|------|--------|
| Xaridor | `/app/(main)/xaridor/` | Ish e'loni beradi, mutaxassis yollaydi |
| Mutaxassis | `/app/(main)/mutaxassis/` | Xizmat sotadi, takliflar yuboradi |
| Admin | `/app/admin/` | Moderatsiya, KYC, nizolar |
| SuperAdmin | `/app/admin/super/` | Tizim sozlamalari |

---

## 💻 Rivojlantirish Qoidalari

### Branch Strategiyasi

```
main          ← production stable
develop       ← integration branch (bu yerdan ishlaymiz)
feature/...   ← yangi feature'lar
fix/...       ← bug fix'lar
```

**Workflow:**
1. `develop` dan yangi branch oling: `git checkout -b feature/mening-feature`
2. Ishni bajaring
3. Pull Request → `develop` ga
4. Review o'tgach merge

### Commit Xabarlari (Conventional Commits)

```
feat(modul): yangi narsa qo'shildi
fix(modul): xato tuzatildi
refactor(modul): kod qayta yozildi
docs: hujjat yangilandi
test: test qo'shildi
chore: konfig o'zgarishi
```

**Modul misollari:** `auth`, `contracts`, `payments`, `chat`, `admin`, `market`

### Kod Standartlari

- **DRY**: Mavjud `components/ui/` komponentlarini ishlating, xom HTML yozmang
- **200 qator qoida**: Fayl 200 qatordan oshsa — refaktoring qiling
- **TypeScript**: `any` ishlatish taqiqlanadi, barcha typelar aniqlangan bo'lishi shart
- **Linting**: `npm run lint` 0 ogohlantirish bilan o'tishi kerak

```bash
# Tekshirish
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm run build       # Production build
```

---

## 🧪 Test Qilish

```bash
npm run test          # Backend unit testlar
npm run test:e2e      # E2E testlar (lifecycle + stress)
npm run test:a11y     # Accessibility testlar
```

---

## 📚 Muhim Hujjatlar

| Hujjat | Nima uchun |
|--------|------------|
| [`README.md`](README.md) | Loyiha umumiy tavsifi |
| [`HANDOVER.md`](HANDOVER.md) | **Yangi dev uchun qo'llanma** ← BU YERDAN BOSHLANG |
| [`BACKEND_INTEGRATION.md`](BACKEND_INTEGRATION.md) | Backend API arxitekturasi |
| [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) | Launch uchun nima qoldi |
| [`docs/00-api-surface.md`](docs/00-api-surface.md) | API endpoint'lari ro'yxati |
| [`docs/01-data-model.md`](docs/01-data-model.md) | Ma'lumot modellari |
| [`docs/02-decisions.md`](docs/02-decisions.md) | Texnik qarorlar tarixi |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Operational runbook |

---

## ❓ Savollar

Yangi developer sifatida biron narsani tushunmagan bo'lsangiz:
1. Avval [`docs/02-decisions.md`](docs/02-decisions.md) ga qarang — sabablari yozilgan
2. GitHub Issues'da yangi issue oching
3. Loyiha egasiga murojaat qiling
