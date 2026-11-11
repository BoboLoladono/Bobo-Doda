import type {
  VerificationRecord,
  SupportTicket,
} from "@/lib/types";
import type {
  TransactionRecord,
  TrustReport,
  UserAppeal,
  CategoryManagementItem,
  PlatformSettingItem,
  InternalNote,
  AuditEvent,
} from "@/lib/admin-types";
import { PLATFORM_FEE_PERCENT } from "@/lib/fees";

/* ==========================================================================
   1. KYC / VERIFICATION APPLICATIONS
   ========================================================================== */
export const seedVerifications: VerificationRecord[] = [];

/* `seedDisputes` asosiy seed'ga (`lib/mock-api/seed.ts`) ko'chirildi —
   ikkala tomon (foydalanuvchi va admin) bitta manbadan foydalanishi uchun. */
export { seedDisputes } from "@/lib/mock-api/seed";

/* ==========================================================================
   3. SUPPORT TICKETS
   ========================================================================== */
export const seedSupportTickets: SupportTicket[] = [];

/* ==========================================================================
   4. PAYOUT / WITHDRAWAL REQUESTS
   ========================================================================== */
export { seedWithdrawals } from "@/lib/mock-api/seed";

/* ==========================================================================
   5. TRANSACTIONS
   ========================================================================== */
export const seedTransactions: TransactionRecord[] = [];

/* ==========================================================================
   6. TRUST & SAFETY REPORTS
   ========================================================================== */
export const seedTrustReports: TrustReport[] = [];

/* ==========================================================================
   7. USER APPEALS
   ========================================================================== */
export const seedUserAppeals: UserAppeal[] = [];

/* ==========================================================================
   8. CATEGORIES & TAXONOMY
   ========================================================================== */
/* Slug'lar ilovaning HAQIQIY kategoriyalari bilan bir xil
   (`lib/category-fields.ts` → `CATEGORIES`). Ilgari bu ro'yxat mustaqil edi:
   admin panelida ilovada mavjud bo'lmagan "mobil-ilovalar"/"matnlar" turardi,
   ilovadagi kontent/video/audio/biznes esa umuman ko'rinmasdi.
   `serviceCount` seed'da 0 — haqiqiy son `getAdminData()` da xizmatlardan
   HISOBLANADI (ilgari qattiq yozilgan o'ylab topilgan raqam edi). */
export const seedCategories: CategoryManagementItem[] = [
  {
    id: "cat-dasturlash",
    slug: "dasturlash",
    nameUz: "Dasturlash va IT",
    nameRu: "Разработка и IT",
    nameEn: "Development & IT",
    icon: "💻",
    order: 1,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-1", slug: "veb-saytlar", nameUz: "Veb-saytlar yaratish", nameRu: "Создание сайтов", nameEn: "Web Development", active: true },
      { id: "sub-2", slug: "telegram-botlar", nameUz: "Telegram botlar", nameRu: "Телеграм боты", nameEn: "Telegram Bots", active: true },
      { id: "sub-3", slug: "backend-api", nameUz: "Backend va API", nameRu: "Бэкенд и API", nameEn: "Backend & APIs", active: true },
    ],
  },
  {
    id: "cat-dizayn",
    slug: "dizayn",
    nameUz: "Dizayn va Brending",
    nameRu: "Дизайн и брендинг",
    nameEn: "Design & Branding",
    icon: "🎨",
    order: 2,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-4", slug: "logotip", nameUz: "Logotip va Brandbook", nameRu: "Логотипы и брендбуки", nameEn: "Logos & Brand Identity", active: true },
      { id: "sub-5", slug: "ui-ux", nameUz: "Veb va Mobil UI/UX", nameRu: "Веб и мобайл UI/UX", nameEn: "UI/UX Design", active: true },
    ],
  },
  {
    id: "cat-marketing",
    slug: "marketing",
    nameUz: "Marketing va SMM",
    nameRu: "Маркетинг и SMM",
    nameEn: "Marketing & SMM",
    icon: "📈",
    order: 3,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-6", slug: "smm-boshqaruvi", nameUz: "SMM to'liq yuritish", nameRu: "Ведение SMM", nameEn: "SMM Management", active: true },
      { id: "sub-7", slug: "target-reklama", nameUz: "Target reklama", nameRu: "Таргетированная реклама", nameEn: "Targeted Ads", active: true },
    ],
  },
  {
    id: "cat-kontent",
    slug: "kontent",
    nameUz: "Kontent va Kopirayting",
    nameRu: "Контент и копирайтинг",
    nameEn: "Content & Copywriting",
    icon: "✍️",
    order: 4,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-8", slug: "seo-maqolalar", nameUz: "SEO maqolalar", nameRu: "SEO статьи", nameEn: "SEO Articles", active: true },
    ],
  },
  {
    id: "cat-tarjima",
    slug: "tarjima",
    nameUz: "Tarjima Xizmatlari",
    nameRu: "Услуги перевода",
    nameEn: "Translation Services",
    icon: "🌐",
    order: 5,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-9", slug: "ingliz-rus-uzbek", nameUz: "Ingliz, Rus, O'zbek", nameRu: "Английский, русский, узбекский", nameEn: "EN, RU, UZ Translation", active: true },
    ],
  },
  {
    id: "cat-video",
    slug: "video",
    nameUz: "Video va Animatsiya",
    nameRu: "Видео и анимация",
    nameEn: "Video & Animation",
    icon: "🎬",
    order: 6,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-10", slug: "montaj", nameUz: "Video montaj", nameRu: "Видеомонтаж", nameEn: "Video Editing", active: true },
    ],
  },
  {
    id: "cat-audio",
    slug: "audio",
    nameUz: "Audio va Ovoz",
    nameRu: "Аудио и озвучка",
    nameEn: "Audio & Voice",
    icon: "🎧",
    order: 7,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-11", slug: "ovoz-berish", nameUz: "Ovoz berish", nameRu: "Озвучка", nameEn: "Voice Over", active: true },
    ],
  },
  {
    id: "cat-biznes",
    slug: "biznes",
    nameUz: "Biznes va Konsalting",
    nameRu: "Бизнес и консалтинг",
    nameEn: "Business & Consulting",
    icon: "📊",
    order: 8,
    active: true,
    serviceCount: 0,
    subcategories: [
      { id: "sub-12", slug: "biznes-reja", nameUz: "Biznes reja", nameRu: "Бизнес-план", nameEn: "Business Plans", active: true },
    ],
  },
];

/* ==========================================================================
   9. PLATFORM SETTINGS
   ========================================================================== */
export const seedPlatformSettings: PlatformSettingItem[] = [
  {
    key: "platform_commission_percent",
    group: "finance",
    label: "Platforma Komissiyasi",
    description:
      "Bajarilgan shartnomalardan olinadigan xizmat haqi ulushi. Super Admin tomonidan o'zgartiriladi va real vaqtda platformaning barcha hisob-kitoblariga tatbiq etiladi.",
    value: PLATFORM_FEE_PERCENT,
    type: "percent",
    readOnly: false,
  },
  {
    key: "registration_enabled",
    group: "security",
    label: "Ro'yxatdan o'tish ochiq",
    description:
      "O'chirilsa yangi foydalanuvchilar ro'yxatdan o'ta olmaydi (mavjud hisoblar ishlayveradi). Hujum yoki texnik ishlar paytidagi kill-switch.",
    value: true,
    type: "boolean",
  },
  {
    key: "payments_paused",
    group: "finance",
    label: "To'lovlar to'xtatilgan",
    description:
      "Yoqilsa xaridorlar shartnomani mablag'lay olmaydi (escrow to'lovi bloklanadi). To'lov provayderi ishlamay qolganda ishlatiladi.",
    value: false,
    type: "boolean",
  },
  {
    key: "escrow_auto_release_days",
    group: "escrow",
    label: "Avtomatik Qabul Qilish Muddati (Kun)",
    description: "Mutaxassis ishni topshirgandan so'ng xaridor javob bermasa mablag' avtomatik o'tkaziladigan muddat.",
    value: 3,
    type: "number",
  },
  {
    key: "min_payout_amount",
    group: "finance",
    label: "Minimal Yechish Miqdori (UZS)",
    description: "Mutaxassis o'z balansidan yechib olishi mumkin bo'lgan minimal summa.",
    value: 50000,
    type: "number",
  },
  {
    key: "mandatory_kyc_threshold",
    group: "security",
    label: "Majburiy KYC Chegarasi (UZS)",
    description: "Oylik aylanmasi ushbu summadan oshgan mutaxassislar uchun shaxsni tasdiqlash majburiy bo'ladi. Chegara backend tomonida qo'llanadi — frontend prototipida aylanma hisoblanmaydi.",
    value: 15000000,
    type: "number",
    readOnly: true,
  },
  {
    key: "marketplace_instant_offer_enabled",
    group: "marketplace",
    label: "To'g'ridan-to'g'ri Takliflar Tizimi",
    description: "Xaridorlarga mutaxassisga oldindan to'lovsiz taklif yuborish imkoniyatini yoqish.",
    value: true,
    type: "boolean",
  },
];

/* ==========================================================================
   10. INTERNAL OPERATOR NOTES
   ========================================================================== */
export const seedInternalNotes: InternalNote[] = [];

/* ==========================================================================
   11. AUDIT EVENTS
   ========================================================================== */
export const seedAuditLog: AuditEvent[] = [];
