export type UserRole = "mutaxassis" | "xaridor";

export interface User {
  id: string;
  phone: string;
  fullName: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: string;
  /* Onboarding holati hisobda ham saqlanadi — login'da sessiya tiklanadi */
  roleChosen?: boolean;
  profileDone?: boolean;
  verified?: boolean;
  /* Ish beruvchi / Xaridor qo'shimcha ma'lumotlari */
  companyName?: string;
  industry?: string;
  website?: string;
  location?: string;
  bio?: string;
  email?: string;
}

export type TrustBadge = "yangi" | "ishonchli" | "top_mutaxassis";
// yangi: standart | ishonchli: 5+ shartnoma va 4.5+ reyting
// top_mutaxassis: 25+ shartnoma va 4.8+ reyting

/** til bilish darajasi — i18n: lang.native | lang.fluent | lang.intermediate | lang.basic */
export type LanguageLevel = "native" | "fluent" | "intermediate" | "basic";

export interface ProfileLanguage {
  name: string;
  level: LanguageLevel;
}

/** Mutaxassis o'zi qo'shadigan bajarilgan ish namunasi */
export interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  /** muqova rasmi — base64 data-URL yoki URL */
  image: string;
  category?: ServiceCategory;
}

export interface SellerProfile {
  userId: string;
  avatarUrl?: string;
  /** kasbiy sarlavha (Upwork/Fiverr uslubidagi tagline) */
  headline: string;
  bio: string;
  skills: string[];
  categories: string[];
  location: string;
  languages: ProfileLanguage[];
  /** bajarilgan ishlar namunasi — xaridor ishonchi uchun */
  portfolio: PortfolioItem[];
  /** o'rtacha javob vaqti (soatda) — ishonch signali */
  responseTimeHours: number;
  /** O'rtacha reyting (0-5). `reviewCount` bilan BIRGA yangilanadi —
      ikkalasi denormallashtirilgan hisoblagich: sharh qo'shilganda/
      o'chirilganda `applyReviewToProfile` qayta hisoblaydi. */
  rating: number;
  /** Reytingni tashkil qilgan sharhlar soni. Ilgari bu maydon yo'q edi va
      ochiq profil yulduz yonida ko'rsatilayotgan xizmatlardagi sharhlar
      sonini (`reviews.length`) chizardi — 4.9 reyting "(2)" bilan
      ko'rinardi, ya'ni raqamlar bir-biriga mos kelmasdi. */
  reviewCount: number;
  completedContracts: number;
  badge: TrustBadge;
  memberSince: string;
  /** yangi buyurtmalarga tayyorlik holati */
  available: boolean;
  /** band bo'lsa, qachon avtomatik "tayyor"ga qaytishi (ISO sana, ixtiyoriy) */
  availableUntil?: string;
  /** Shaxsi tasdiqlangan (KYC) — VerificationRecord.status'dan hisoblanadi,
      saqlanmaydi. Telegram `User.verified`dan farqli, real hujjat tekshiruvi. */
  identityVerified?: boolean;
  /** Yakunlangan / (yakunlangan + bekor qilingan) shartnomalar nisbati (0-100).
      Hisoblanadi, saqlanmaydi. Kamida 1 ta yakunlangan yoki bekor qilingan
      shartnoma bo'lmasa aniqlanmagan (undefined) — yangi hisob uchun 0%
      ko'rsatish chalg'ituvchi bo'lardi. */
  completionRate?: number;
}

export type ServiceCategory =
  | "dizayn"
  | "dasturlash"
  | "tarjima"
  | "kontent"
  | "marketing"
  | "video"
  | "audio"
  | "biznes";

/** `pending_review`/`rejected`/`archived` — real backend moderatsiya
    holatlari (Bosqich 17). Mock hech qachon bu qiymatlarni yozmaydi. */
export type ServiceStatus = "active" | "paused" | "draft" | "pending_review" | "rejected" | "archived";

/* A) Passiv yo'l — tayyor xizmat */
export interface Service {
  id: string;
  sellerId: string;
  category: ServiceCategory;
  title: string;
  description: string;
  fields: Record<string, string | string[]>;
  price: number;
  currency: "UZS";
  deliveryDays: number;
  images: string[];
  status: ServiceStatus;
  createdAt: string;
  /** Narxga kiritilgan bepul tuzatishlar soni. Belgilanmasa (eski xizmatlar)
      cheklov qo'llanilmaydi — faqat shu maydon orqali va'da qilingan
      xizmatlarda tekshiriladi. */
  revisionsIncluded?: number;
  /** Narxga aynan nima kiritilgani — har bir xizmat uchun alohida, umumiy
      matn emas (masalan "Manba fayllar", "3 ta konseptsiya"). */
  included?: string[];
  /** Ishni boshlash uchun xaridordan nima talab qilinishi — har bir xizmat
      uchun alohida (masalan "Brendbuk", "Texnik topshiriq"). */
  requirements?: string[];
  /** Ixtiyoriy qo'shimcha xizmatlar (masalan "Tezkor topshirish" +qo'shimcha
      narx) — xaridor tanlab, asosiy narxga qo'shib taklif yuboradi. */
  extras?: { label: string; price: number }[];
}

/* B) Faol yo'l — xaridor e'lon qilgan ish (mock, faqat o'qish uchun) */
export type JobStatus = "ochiq" | "yopilgan";

export interface Job {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerRating: number;
  title: string;
  description: string;
  category: ServiceCategory;
  budgetMin: number;
  budgetMax: number;
  currency: "UZS";
  skillsRequired: string[];
  screeningQuestions: string[];
  proposalsCount: number;
  postedAt: string;
  status: JobStatus;
  /** Xaridor kutayotgan yakuniy muddat (ixtiyoriy) */
  deadline?: string;
  /** Loyiha uchun namuna/texnik topshiriq rasmlari (ixtiyoriy) */
  attachedImages?: string[];
}

export type ProposalStatus =
  | "yuborilgan"
  | "korib_chiqilmoqda"
  | "suhbat"
  | "yollandi"
  | "rad_etildi"
  | "qaytarib_olingan";

export interface Proposal {
  id: string;
  jobId: string;
  sellerId: string;
  bidAmount: number;
  coverLetter: string;
  screeningAnswers: { question: string; answer: string }[];
  attachedImages: string[];
  status: ProposalStatus;
  createdAt: string;
  /** Mutaxassis taxmin qilgan yetkazib berish muddati (kun) */
  estimatedDeliveryDays?: number;
}

/* To'g'ridan-to'g'ri taklif (xaridor → mutaxassis, to'lovsiz).
   Mutaxassis qabul qilsa shartnoma ochiladi; mablag'lash workroom'da. */
export type OfferStatus =
  | "yuborilgan"
  | "qabul_qilindi"
  | "rad_etildi"
  | "bekor_qilingan"; // xaridor o'zi qaytarib oldi

export interface Offer {
  id: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  /** xizmat sahifasidan yuborilgan bo'lsa */
  serviceId?: string;
  title: string;
  /** xaridorning boshlang'ich xabari (chat'da birinchi xabar sifatida ham boradi) */
  message: string;
  /** taklif qilinayotgan byudjet — to'lov emas, kelishuv boshlang'ich nuqtasi */
  budget: number;
  status: OfferStatus;
  /** qabul qilinganda ochilgan shartnoma */
  contractId?: string;
  createdAt: string;
}

/* Ikkala yo'l ham shu umumiy tuzilmaga keladi.
   imzolangan: taraflar rozi, shartnoma tuzilgan — lekin xaridor hali escrow'ga
   to'lamagan (ish boshlanmaydi). To'lov tushgach → faol. */
export type ContractStatus =
  | "imzolangan"
  | "faol"
  | "yakunlangan"
  | "bekor_qilingan"
  | "nizo";

export interface Contract {
  id: string;
  sourceType: "xizmat" | "taklif" | "taklifnoma";
  serviceId?: string;
  jobId?: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  /** denormalizatsiya — xaridor tomonida mutaxassis ismini ko'rsatish uchun */
  sellerName: string;
  title: string;
  totalAmount: number;
  status: ContractStatus;
  rawStatus?: "PENDING_SELLER" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "REJECTED";
  createdAt: string;
  closeRequested?: boolean;
  closeRequestNote?: string;
  closeRequestedAt?: string;
  paymentMethod?: PaymentMethod;
  fundedAt?: string;
  escrowReference?: string;
  b2bPending?: boolean;
  b2bReceiptUrl?: string;
  b2bReceiptName?: string;
  b2bSubmittedAt?: string;
  contractNumber?: string;
  buyerAcceptedAt?: string;
  buyerAcceptedName?: string;
  buyerAcceptedPhone?: string;
  sellerAcceptedAt?: string;
  sellerAcceptedName?: string;
  sellerAcceptedPhone?: string;
  cancelReason?: string;
  paymentStatus?: ContractPaymentStatus;
  paymentReference?: string;
  paymentReceiptUrl?: string;
  paymentReceiptName?: string;
  paymentReceiptSize?: number;
  paymentSubmittedAt?: string;
  paymentVerifiedAt?: string;
  paymentVerifiedBy?: string;
  paymentRejectReason?: string;
  paymentNotes?: string;
  revisionsIncluded?: number;
}

/** Shartnoma to'lovi holatlari (MVP Manual Bank Transfer) */
export type ContractPaymentStatus =
  | "awaiting_payment"      // Awaiting Payment (To'lov kutilmoqda)
  | "receipt_uploaded"      // Receipt Uploaded (Kvitansiya yuklandi)
  | "pending_verification"  // Pending Verification (Tekshirilmoqda)
  | "payment_confirmed"     // Payment Confirmed / Funds Secured (To'lov tasdiqlandi)
  | "payment_rejected"      // Payment Rejected (To'lov rad etildi)
  | "refund_pending"        // Refund Pending (Qaytarish kutilmoqda)
  | "refunded";             // Refunded (Qaytarildi)

export type MilestoneStatus =
  | "kutilmoqda" // hali mablag'lanmagan
  | "mablaglangan" // escrow'da, ish boshlanishi mumkin
  | "topshirildi" // ko'rib chiqish muddati boshlandi
  | "qabul_qilindi" // tasdiqlandi, to'landi
  | "ozgartirish_soraldi"; // buyurtmachi o'zgartirish so'radi

export interface DeliverableFile {
  id: string;
  name: string;
  size: number;
  url: string;
  type?: string;
}

export interface Milestone {
  id: string;
  contractId: string;
  title: string;
  description: string;
  amount: number;
  status: MilestoneStatus;
  dueDate: string;
  submittedAt?: string;
  reviewDeadline?: string; // submittedAt + 3 kun
  approvedAt?: string;
  /** buyurtmachi o'zgartirish so'raganda qoldirgan izohi */
  revisionComment?: string;
  /** Ushbu bosqichda nechta marta o'zgartirish so'ralgani */
  revisionCount?: number;
  /** Ushbu bosqichga kiritilgan maksimal bepul qayta ishlashlar soni (sukut: 3) */
  revisionsIncluded?: number;
  /** Topshirilgan ish havolasi (Figma, GitHub, Google Drive va h.k.) */
  deliverableLink?: string;
  /** Topshirilgan ish bo'yicha mutaxassis izohi */
  deliverableNote?: string;
  /** Topshirilgan ish fayllari (ZIP, PDF, rasmlar, hujjatlar) */
  deliverableFiles?: DeliverableFile[];
}

export interface Message {
  id: string;
  contractId: string;
  senderId: string;
  text: string;
  /** ixtiyoriy ilova — bitta rasm, base64 data-URL */
  image?: string;
  /** bir nechta rasmlar */
  images?: string[];
  /** biriktirilgan fayllar (PDF, ZIP, va h.k.) */
  files?: DeliverableFile[];
  createdAt: string;
}

export interface Review {
  id: string;
  contractId: string;
  /** sharh tegishli bo'lgan mutaxassis (egalik bo'yicha filtrlash uchun) */
  sellerId: string;
  /** sharh qoldirgan buyurtmachi ismi (ochiq profilda ko'rsatish uchun) */
  buyerName?: string;
  rating: number;
  comment: string;
  createdAt: string;
}

/* Bank kartalari — mahalliy (Uzcard 8600, Humo 9860) + xalqaro (Visa, Mastercard).
   Xavfsizlik: to'liq raqam saqlanmaydi, faqat oxirgi 4 raqam + niqoblangan. */
/** Escrow'ga pul kiritish usuli. Mock'da faqat yozib qo'yiladi; real
    integratsiyada gateway tanlovi shu qiymatdan kelib chiqadi. */
export type PaymentMethod =
  | "karta"
  | "click"
  | "payme"
  | "rossiya_karta"
  | "kaspi_kz"
  | "visa_mastercard_intl"
  | "b2b"
  | "balans";

export type CardType = "visa" | "mastercard" | "uzcard" | "humo" | "mir";

export interface PaymentCard {
  id: string;
  userId: string;
  type: CardType;
  /** faqat oxirgi 4 raqam saqlanadi (PCI amaliyoti) */
  last4: string;
  holderName: string;
  /** "MM/YY" */
  expiry: string;
  createdAt: string;
}

/* Pul yechish so'rovi. Foydalanuvchi yaratadi (`requestWithdrawal`), admin
   tasdiqlaydi yoki rad etadi. Tasdiqlanmaguncha summa "band" hisoblanadi —
   shuning uchun uni ikki marta so'rab bo'lmaydi. */
export type WithdrawalStatus =
  | "kutilmoqda"
  | "korib_chiqilmoqda"
  | "tasdiqlangan"
  | "rad_etilgan";

/** Mutaxassisga to'lov (Freelancer Payout) holatlari */
export type PayoutStatus =
  | "payout_pending"     // Payout Pending (Kutilmoqda)
  | "payout_processing"  // Payout Processing (Jarayonda)
  | "paid"               // Paid (To'landi)
  | "payout_failed";     // Payout Failed (Xatolik / Bekor qilingan)

export type WithdrawalPayoutMethod =
  | "card"
  | "bank_account"
  | "rossiya_karta"
  | "kaspi_kz"
  | "intl_card";

export interface BankAccountDetails {
  accountNumber: string;
  bankName: string;
  mfo: string;
  innOrPinfl: string;
  recipientName: string;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  /** Mutaxassis daromadidan (`earnings`) yoki xaridor balansidan (`balance`) */
  source: "earnings" | "balance";
  amount: number;
  currency: "UZS";
  payoutMethod?: WithdrawalPayoutMethod;
  /** Faqat oxirgi 4 raqam ko'rinadigan niqob — to'liq raqam saqlanmaydi (karta bo'lsa) */
  cardDetails?: string;
  cardId?: string;
  /** Bank hisob raqamiga o'tkazma ma'lumotlari (YaTT / O'z-o'zini band qilgan shaxslar uchun) */
  bankAccount?: BankAccountDetails;
  status: WithdrawalStatus;
  payoutStatus?: PayoutStatus;
  payoutReference?: string;
  payoutReceiptUrl?: string;
  payoutReceiptName?: string;
  createdAt: string;
  processedAt?: string;
  processedBy?: string;
  rejectionReason?: string;
}

export interface Session {
  userId: string;
  role: UserRole | null;
  profileDone: boolean;
  /** akkount Telegram orqali tasdiqlangan (oqimning eng oxirgi bosqichi) */
  verified: boolean;
}

/** `tizim` — admin qarori (KYC, arbitraj, moderatsiya). Foydalanuvchi
    o'zi boshlamagan, lekin uni bevosita ta'sir qiladigan hodisalar. */
export type NotificationKind =
  | "elon"
  | "taklif"
  | "bosqich"
  | "xabar"
  | "tolov"
  | "tizim";

export interface AppNotification {
  id: string;
  /** bildirishnoma egasi (foydalanuvchi bo'yicha filtrlash uchun) */
  userId: string;
  kind: NotificationKind;
  /** i18n kaliti; {param} o'rnini params to'ldiradi */
  messageKey: string;
  params?: Record<string, string>;
  href: string;
  read: boolean;
  createdAt: string;
}

export type VerificationStatus =
  | "boshlanmagan"
  | "korib_chiqilmoqda"
  | "tasdiqlangan"
  | "rad_etilgan";

export type VerificationCountry =
  | "UZ"
  | "RU"
  | "KZ"
  | "KG"
  | "TJ"
  | "TR"
  | "AE"
  | "US"
  | "GLOBAL"
  | (string & {});

export type VerificationDocumentType =
  | "passport"
  | "id_card"
  | "internal_passport"
  | "driver_license"
  | (string & {});

export interface VerificationRecord {
  id?: string;
  userId: string;
  status: VerificationStatus;
  country: VerificationCountry;
  documentType: VerificationDocumentType;
  legalName: string;
  birthDate: string;
  documents: string[];
  submittedAt?: string;
  /** Admin qaror qabul qilgan vaqt (tasdiqlash yoki rad etish) */
  reviewedAt?: string;
  rejectionReason?: string;
  /** KYC/AML maydonlari */
  passportNumber?: string;
  inn?: string;
  companyDetails?: string;
}

/** Yordam chiptasidagi javob (hozircha faqat support operatoridan).
    Admin `replyToTicket` bilan yozadi, foydalanuvchi Yordam sahifasida
    o'qiydi — ilgari javob yozilardi-yu, foydalanuvchiga HECH QAYERDA
    ko'rsatilmasdi: u "javob berildi" bildirishnomasini olib, sahifani
    ochganda faqat holat belgisini ko'rardi. */
export interface SupportReply {
  sender: string;
  text: string;
  at: string;
  isAdmin: boolean;
}

export type SupportTopic =
  | "tolov"
  | "shartnoma"
  | "nizo"
  | "hisob"
  | "texnik"
  | "boshqa";

export interface SupportTicket {
  id: string;
  userId: string;
  topic: SupportTopic;
  subject: string;
  message: string;
  status: "ochiq" | "javob_berildi" | "yopilgan";
  createdAt: string;
}

/** In-site Support Modal — Telegram'ga sendMessage orqali yetkaziladigan
    yengil so'rov. `SupportTicket`dan farqli: localStorage'da saqlanmaydi,
    haqiqiy backend (`/api/support`) orqali support Telegram chatga boradi. */
export type SupportRequestCategory =
  | "tolov_escrow"
  | "loyiha"
  | "mutaxassis"
  | "profil"
  | "tasdiqlash"
  | "texnik"
  | "hisob"
  | "boshqa";

export interface SupportRequestInput {
  category: SupportRequestCategory;
  message: string;
  /** Guest uchun; login qilgan userda avtomatik session'dan olinadi */
  contactName?: string;
  contactInfo?: string;
  source: string;
  route: string;
}

export interface Dispute {
  id: string;
  contractId: string;
  openedBy: string;
  reason: "scope" | "quality" | "deadline" | "payment" | "communication" | "other";
  description: string;
  evidence: string[];
  status: "ochiq" | "korib_chiqilmoqda" | "hal_qilindi";
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export function computeBadge(
  completedContracts: number,
  rating: number
): TrustBadge {
  if (completedContracts >= 25 && rating >= 4.8) return "top_mutaxassis";
  if (completedContracts >= 5 && rating >= 4.5) return "ishonchli";
  return "yangi";
}

/** Ochiq katalogdagi mutaxassis: hisob + sotuvchi profili */
export interface Specialist {
  user: User;
  profile: SellerProfile;
}

/** Bildirishnoma kanallari bo'yicha hisob sozlamalari */
export interface AccountPreferences {
  messages: boolean;
  contracts: boolean;
  payments: boolean;
  marketing: boolean;
  proposals?: boolean;
}
