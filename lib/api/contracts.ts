import type * as Model from "@/lib/types";
import type { PaymentStatus as RealPaymentStatus } from "@bobololadono/contracts";

export interface ApiPage<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface ApiListQuery {
  cursor?: string;
  limit?: number;
  search?: string;
  sort?: string;
}

/**
 * Bosqich 17 — real backend `PaymentResponseDto` bilan bir xil shakl
 * (`packages/contracts` generatsiya qilingan `PaymentStatus` enumi orqali).
 * `checkoutUrl` FAQAT yaratish javobida keladi (bo'lim 24) — keyingi
 * so'rovlarda yo'q, shuning uchun holat SO'RASH uchun ishlatilmaydi.
 */
export interface PaymentDTO {
  id: string;
  contractId: string;
  provider: string;
  status: RealPaymentStatus;
  amount: number;
  currency: "UZS";
  checkoutUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** Ochiq katalog kategoriyasi — `GET /categories` (bo'lim 17). */
export interface CategoryDTO {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
}

export interface AuthService {
  /**
   * Joriy sessiya — SINXRON va shunday qoladi.
   *
   * Backend'da bu access token'ning o'zi emas, uning brauzerda saqlangan
   * SNAPSHOT'i (userId/role/verified). Token httpOnly cookie'da bo'ladi va
   * JS uni o'qiy olmaydi — shuning uchun bu yerda faqat "kim kirgan"
   * ma'lumoti turadi. Layout guard'lari va xabar egaligini hisoblash har
   * render'da kerak bo'lgani uchun bu chaqiruv async bo'la olmaydi.
   *
   * MUHIM: bu snapshot HIMOYA EMAS — u brauzerda o'zgartirilishi mumkin.
   * Haqiqiy tekshiruv har so'rovda server tomonida bo'ladi.
   */
  getSession(): Model.Session | null;
  /**
   * Bosqich 21 — parol bilan login. SMS xarajatini kamaytirish uchun: OTP
   * FAQAT ro'yxatdan o'tish va parolni tiklashda (telefon egaligini
   * isbotlash), ODDIY LOGIN'da SMS UMUMAN ishtirok etmaydi.
   *
   * REGISTRATION: phone → `requestRegisterOtp` → SMS kod →
   * `verifyRegisterOtp` (qisqa umrli `registrationToken` qaytaradi,
   * User HALI yaratilmagan) → `completeRegistration` (parol + grant →
   * User yaratiladi + sessiya ochiladi).
   *
   * `requestRegisterOtp` har doim `{sent:true}` (enumeration himoyasi).
   * `devOtp` — Bosqich 22, FAQAT development (`NODE_ENV!=production &&
   * SMS_PROVIDER=CONSOLE && DEV_EXPOSE_OTP=true`) — productionda HECH
   * QACHON kelmaydi.
   */
  requestRegisterOtp(phone: string): Promise<{ sent: true; devOtp?: string }>;
  /** Telefon allaqachon ro'yxatdan o'tgan bo'lsa ENDI xato bermaydi (bu
      tekshiruv `completeRegistration`da) — bu yerda faqat OTP haqiqiyligi
      tekshiriladi. */
  verifyRegisterOtp(phone: string, code: string): Promise<{ registrationToken: string }>;
  /**
   * Grant + parol mos bo'lsa: User yaratiladi, sessiya ochiladi. Telefon
   * allaqachon ro'yxatdan o'tgan bo'lsa `ApiError.message ===
   * "PHONE_EXISTS"` bilan tashlanadi (sahifa "Kirish" CTA ko'rsatadi).
   */
  completeRegistration(registrationToken: string, password: string, confirmPassword: string): Promise<Model.Session>;
  /**
   * LOGIN: telefon + parol → sessiya. `SmsProvider` HECH QACHON
   * chaqirilmaydi (asosiy invariant — SMS xarajati faqat register/reset'da).
   * Noto'g'ri telefon va noto'g'ri parol bir xil `ApiError.message ===
   * "INVALID_CREDENTIALS"` bilan tashlanadi (enumeration-safe).
   */
  login(phone: string, password: string): Promise<Model.Session>;
  /**
   * FORGOT PASSWORD: phone → `requestPasswordResetOtp` → SMS kod (FAQAT
   * hisob mavjud bo'lsa haqiqatan yuboriladi — javob baribir bir xil) →
   * `verifyPasswordResetOtp` (qisqa umrli `resetToken`) →
   * `completePasswordReset` (yangi parol — BARCHA eski sessiyalar bekor
   * qilinadi, foydalanuvchi keyin `login()` bilan qaytadan kiradi —
   * sessiya AVTOMATIK ochilmaydi).
   */
  /** `devOtp` — Bosqich 22, FAQAT development (yuqoridagi `requestRegisterOtp`
      bilan bir xil shart). */
  requestPasswordResetOtp(phone: string): Promise<{ sent: true; devOtp?: string }>;
  verifyPasswordResetOtp(phone: string, code: string): Promise<{ resetToken: string }>;
  completePasswordReset(resetToken: string, password: string, confirmPassword: string): Promise<{ ok: true }>;
  chooseRole(role: Model.UserRole): Promise<Model.Session>;
  /**
   * Access token'ni yangilaydi (`POST /auth/refresh`).
   *
   * Qaytaradi: yangilangan sessiya, yoki `null` — refresh token ham
   * o'lgan bo'lsa (foydalanuvchi qayta kirishi kerak).
   *
   * Kim chaqiradi: `client.ts` dagi HTTP qatlami. Har qanday so'rov 401
   * bilan qaytsa — BIR MARTA `refresh()` qilinadi va so'rov qayta
   * yuboriladi; ikkinchi 401 da `logout()` va login'ga yo'naltirish.
   * Bu mantiq UI'da EMAS, adapterda bo'lishi shart, aks holda har bir
   * ekran o'zi token boshqarishi kerak bo'lardi.
   */
  refresh(): Promise<Model.Session | null>;
  logout(): Promise<void> | void;
}

export interface UsersService {
  getCurrent(): Promise<Model.User | null>;
  getSellerProfile(): Promise<Model.SellerProfile>;
  updateName(fullName: string): Promise<void>;
  updateUserProfile(data: Partial<Model.User>): Promise<void>;
  completeSellerProfile(input: {
    fullName: string;
    bio: string;
    skills: string[];
    categories: string[];
    location: string;
  }): Promise<void>;
  updateSellerProfile(input: {
    fullName: string;
    bio: string;
    headline?: string;
    skills?: string[];
    categories?: string[];
    location?: string;
    languages?: Model.ProfileLanguage[];
    portfolio?: Model.PortfolioItem[];
    avatarUrl?: string;
  }): Promise<void>;
  updateAvatar(avatarUrl: string): Promise<void>;
  setAvailability(available: boolean): Promise<void>;
  getPreferences(): Promise<Model.AccountPreferences>;
  savePreferences(preferences: Model.AccountPreferences): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  exportData(): Promise<Record<string, unknown>>;
  deleteAccount(): Promise<void>;
}

/** Ochiq katalog: mutaxassis profillari va ular haqidagi sharhlar.
    Bosqich 17 — real backend'da PUBLIC mutaxassis direktoriyasi/sharh
    modeli YO'Q (`staff/sellers` faqat xodimlarga ochiq): `listSpecialists`/
    `getSpecialist` `client.ts`da `FEATURE_DISABLED` tashlaydi,
    `listSellerReviews` bo'sh ro'yxat qaytaradi (xato emas — chunki Review
    modeli umuman yo'q, bu "hali sharh yo'q" emas "sharh tushunchasi yo'q",
    lekin UI'ga bo'sh holat sifatida xavfsiz ko'rinadi). */
export interface CatalogService {
  listSpecialists(): Promise<Model.Specialist[]>;
  getSpecialist(userId: string): Promise<Model.Specialist | null>;
  listSellerReviews(sellerId: string): Promise<Model.Review[]>;
  /** Bosqich 17 — YANGI: `GET /categories` (real kategoriya ro'yxati). */
  listCategories(): Promise<Model.ServiceCategory[]>;
}

/** Saqlangan (bookmark) elementlar — e'lonlar va bozor kartalari */
export interface SavedService {
  listJobIds(): Promise<string[]>;
  toggleJob(jobId: string): Promise<string[]>;
  listSpecialistIds(): Promise<string[]>;
  toggleSpecialist(specialistId: string): Promise<string[]>;
  listMarketIds(): Promise<string[]>;
  toggleMarketItem(id: string): Promise<string[]>;
}

/**
 * Bosqich 17 — `create`/`update` kirish shakli real backend
 * `CreateServiceDto`/`UpdateServiceDto`ga moslashtirilgan (faqat
 * category/title/description/price/deliveryDays — rasm/kategoriya-xos
 * maydonlar/extras kabi mock-only qismlar real backendda saqlanmaydi).
 */
export interface ServiceInput {
  category: Model.ServiceCategory;
  title: string;
  description: string;
  price: number;
  deliveryDays: number;
}

export interface ServicesService {
  listMine(): Promise<Model.Service[]>;
  listPublic(): Promise<Model.Service[]>;
  get(id: string): Promise<Model.Service | null>;
  create(input: ServiceInput): Promise<Model.Service>;
  update(id: string, input: Partial<ServiceInput>): Promise<Model.Service>;
  /** Bosqich 17 — real backendda "o'chirish" yo'q, faqat arxivlash
      (`POST /seller/services/:id/archive`) — eng yaqin ekvivalent. */
  remove(id: string): Promise<void>;
  /** Bosqich 17 — YANGI: DRAFT → PENDING_REVIEW (moderatsiyaga yuborish) */
  submit(id: string): Promise<Model.Service>;
  /** Bosqich 17 — YANGI: ACTIVE → PAUSED */
  pause(id: string): Promise<Model.Service>;
  /** Bosqich 17 — YANGI: PAUSED → ACTIVE */
  resume(id: string): Promise<Model.Service>;
}

export interface JobsService {
  list(): Promise<Model.Job[]>;
  get(id: string): Promise<Model.Job | null>;
  listMine(): Promise<Model.Job[]>;
  create(input: {
    title: string;
    description: string;
    category: Model.Job["category"];
    budgetMin: number;
    budgetMax: number;
    skillsRequired: string[];
    screeningQuestions: string[];
    deadline?: string;
    attachedImages?: string[];
  }): Promise<Model.Job>;
  close(id: string): Promise<Model.Job>;
}

export interface ProposalsService {
  listMine(): Promise<Model.Proposal[]>;
  get(id: string): Promise<Model.Proposal | null>;
  listForJob(jobId: string): Promise<Model.Proposal[]>;
  create(input: {
    jobId: string;
    bidAmount: number;
    coverLetter: string;
    screeningAnswers: { question: string; answer: string }[];
    attachedImages: string[];
    estimatedDeliveryDays?: number;
  }): Promise<Model.Proposal>;
  setStatus(
    id: string,
    status: "korib_chiqilmoqda" | "suhbat" | "rad_etildi"
  ): Promise<Model.Proposal>;
  hire(
    proposalId: string,
    milestones: {
      title: string;
      description: string;
      amount: number;
      dueDate: string;
    }[]
  ): Promise<Model.Contract>;
  withdraw(id: string): Promise<Model.Proposal>;
}

export interface OffersService {
  get(id: string): Promise<Model.Offer | null>;
  create(input: {
    sellerId: string;
    serviceId?: string;
    title: string;
    message: string;
    budget: number;
  }): Promise<Model.Offer>;
  listSent(): Promise<Model.Offer[]>;
  listIncoming(): Promise<Model.Offer[]>;
  accept(id: string): Promise<Model.Contract>;
  withdraw(id: string): Promise<Model.Offer>;
  decline(id: string): Promise<Model.Offer>;
}

export interface ContractsService {
  list(): Promise<Model.Contract[]>;
  get(id: string): Promise<Model.Contract | null>;
  /**
   * Bosqich 17 — YANGI: xaridor xizmatdan to'g'ridan-to'g'ri shartnoma
   * yaratadi (`POST /contracts`, PENDING_SELLER holatida boshlanadi).
   * Job/Proposal/Offer oqimlari backend'da yo'q — xarid endi FAQAT shu
   * yo'l bilan boshlanadi (bo'lim 17/91-G). `idempotencyKey` BARQAROR
   * bo'lishi shart — ikki marta bosish ikkita shartnoma yaratmasin.
   */
  create(
    input: {
      serviceId: string;
      deadline: string;
      milestones: { title: string; description?: string; amount: number; dueAt?: string }[];
      agreedAmount?: number;
    },
    idempotencyKey: string
  ): Promise<Model.Contract>;
  /** Bosqich 17 — YANGI: sotuvchi PENDING_SELLER → ACTIVE */
  accept(id: string): Promise<Model.Contract>;
  /** Bosqich 17 — YANGI: sotuvchi PENDING_SELLER → REJECTED */
  reject(id: string): Promise<Model.Contract>;
  /** Faqat PENDING_SELLER holatida (sotuvchi hali javob bermagan) */
  cancel(id: string): Promise<Model.Contract>;
  requestClose(id: string, note?: string): Promise<Model.Contract>;
  approveClose(id: string): Promise<Model.Contract>;
  sign(id: string): Promise<Model.Contract>;
}

/**
 * Bosqich 17 — real backend'da bosqich amallari HAR DOIM shartnoma ID'siga
 * NEST qilingan (`POST /me/contracts/:contractId/milestones/:milestoneId/
 * approve` va h.k. — mustaqil `/milestones/:id` marshruti YO'Q). Shuning
 * uchun `contractId` endi HAR BIR amalga MAJBURIY parametr (ilgari faqat
 * `list()` talab qilardi) — chaqiruvchi ekranlar buni URL'dan allaqachon
 * biladi (`app/*\/shartnomalar/[id]/page.tsx`).
 */
export interface MilestonesService {
  list(contractId: string): Promise<Model.Milestone[]>;
  listMine(): Promise<Model.Milestone[]>;
  submit(
    contractId: string,
    milestoneId: string,
    deliverable?: {
      link?: string;
      note?: string;
      files?: Model.DeliverableFile[];
    }
  ): Promise<Model.Milestone>;
  accept(contractId: string, milestoneId: string): Promise<Model.Milestone>;
  requestRevision(contractId: string, milestoneId: string, comment: string): Promise<Model.Milestone>;
}

/** Biriktirma fayllarni yuklash (chat va ish topshirish uchun bir xil).
    Mock'da fayl data-URL ga o'giriladi; backend'da `POST /files` ga
    yuboriladi va doimiy URL qaytadi — chaqiruvchi UI o'zgarmaydi. */
export interface FilesService {
  upload(file: File): Promise<Model.DeliverableFile>;
}

export interface PaymentsService {
  /** Escrow'ni to'liq mablag'lash.
   *  `input` — to'lov usuli va (karta bo'lsa) qaysi karta. Mock uni faqat
   *  yozib qo'yadi, lekin CHEGARADA turishi shart: real gateway "qaysi
   *  usul, qaysi instrument" ni bilmasa to'lovni umuman boshlay olmaydi,
   *  va bu ma'lumot allaqachon UI'da bor edi — shunchaki tashlab
   *  yuborilardi. */
  fundContract(
    id: string,
    input?: {
      method?: Model.PaymentMethod;
      cardId?: string;
      receiptUrl?: string;
      receiptName?: string;
      receiptSize?: number;
      notes?: string;
    }
  ): Promise<Model.Contract>;
  fundMilestone(
    contractId: string,
    milestoneId: string,
    method?: Model.PaymentMethod
  ): Promise<{ contract: Model.Contract; milestone: Model.Milestone }>;
  getBalance(): Promise<number>;
  getCards(): Promise<Model.PaymentCard[]>;
  addCard(input: {
    number: string;
    holderName: string;
    expiry: string;
  }): Promise<Model.PaymentCard>;
  removeCard(id: string): Promise<void>;
  /* Yechish ADMIN TASDIG'IGA so'rov yuboradi — pul darhol yechilmaydi.
     Ilgari ikkalasi ham darhol yechar va admin navbatiga umuman tushmasdi. */
  /** Mutaxassis daromadini yechish so'rovi (karta yoki bank hisob-raqamiga) */
  withdrawEarnings(
    destination: string | { type: "card"; cardId: string } | { type: "bank_account"; bankAccount: Model.BankAccountDetails },
    amount?: number
  ): Promise<Model.WithdrawalRequest>;
  /** Xaridor balansidagi (qaytgan escrow) mablag'ni yechish so'rovi */
  withdrawBalance(
    destination: string | { type: "card"; cardId: string } | { type: "bank_account"; bankAccount: Model.BankAccountDetails },
    amount?: number
  ): Promise<Model.WithdrawalRequest>;
  getWithdrawnTotal(): Promise<number>;
  /** Kutilayotgan so'rovlar summasi — mavjud mablag'dan ayiriladi */
  getPendingWithdrawalTotal(): Promise<number>;
  listMyWithdrawalRequests(): Promise<Model.WithdrawalRequest[]>;

  /**
   * Bosqich 17 — YANGI, real to'lov oqimi: `POST /me/contracts/:id/payment`.
   * `idempotencyKey` BARQAROR bo'lishi shart (bo'lim 33 — bir xil tugma
   * ikki marta bosilsa ikkita to'lov yaratmasin). Javobdagi `checkoutUrl`
   * bo'lsa — chaqiruvchi foydalanuvchini SHU YERGA redirect qiladi (Payme
   * hosted checkout). Bu FAQAT boshlanish — muvaffaqiyat query parametridan
   * HECH QACHON o'qilmaydi (bo'lim 24), haqiqiy holat quyidagi
   * `getContractPayment` orqali so'raladi.
   */
  createContractPayment(contractId: string, idempotencyKey: string): Promise<PaymentDTO>;
  /** Shartnomaning eng so'nggi to'lovi — holat so'rash uchun (bounded polling, bo'lim 25) */
  getContractPayment(contractId: string): Promise<PaymentDTO | null>;
}

/**
 * Bosqich 17 — YANGI: sotuvchi bo'lish uchun ariza (`POST /me/seller-
 * application`, `GET /me/seller-application`). Mock'da bu tushuncha
 * umuman yo'q edi (rol tanlash = sotuvchi bo'lish); real backendda rol
 * (`SELLER`) LAYOQAT, ariza tasdiqlanishi esa HAQIQIY faoliyat huquqi —
 * ikkalasi mustaqil (`SellerEligibilityGuard`). Status'lar uchun mavjud
 * `Model.VerificationStatus` (4 xil holat) qayta ishlatiladi — boshqa
 * domen, bir xil shakl.
 */
export interface SellerApplicationService {
  getCurrent(): Promise<{
    status: Model.VerificationStatus;
    legalName?: string;
    displayName?: string;
    description?: string;
    rejectionReason?: string;
    submittedAt?: string;
  } | null>;
  submit(input: { legalName: string; displayName: string; description?: string }): Promise<void>;
}

export interface MessagesService {
  list(threadId: string): Promise<Model.Message[]>;
  listMine(): Promise<Model.Message[]>;
  send(
    threadId: string,
    body: string,
    image?: string,
    attachments?: { images?: string[]; files?: Model.DeliverableFile[] }
  ): Promise<Model.Message>;
  /** threadId -> joriy foydalanuvchi shu suhbatni oxirgi marta o'qigan vaqt */
  getReadStatus(): Promise<Record<string, string>>;
  /** Suhbat sahifasi ochilganda chaqiriladi, uni "o'qilgan" deb belgilaydi */
  markRead(threadId: string): Promise<void>;
}

export interface NotificationsService {
  list(): Promise<Model.AppNotification[]>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

export interface ReviewsService {
  listMine(): Promise<Model.Review[]>;
  getForContract(contractId: string): Promise<Model.Review | null>;
  create(contractId: string, rating: number, comment: string): Promise<Model.Review>;
}

export interface DisputesService {
  listMine(): Promise<Model.Dispute[]>;
  getForContract(contractId: string): Promise<Model.Dispute | null>;
  open(
    contractId: string,
    input: Pick<Model.Dispute, "reason" | "description" | "evidence">
  ): Promise<Model.Dispute>;
  /** Nizoni ochgan tomon uni qaytarib oladi — shartnoma `faol` ga qaytadi */
  withdraw(contractId: string): Promise<void>;
}

export interface VerificationService {
  getMine(): Promise<Model.VerificationRecord | null>;
  submit(input: Omit<Model.VerificationRecord, "userId" | "status" | "submittedAt" | "rejectionReason">): Promise<Model.VerificationRecord>;
}

export interface SupportService {
  listMine(): Promise<Model.SupportTicket[]>;
  /** Chiptaga kelgan support javoblari (egalik tekshiriladi) */
  listReplies(ticketId: string): Promise<Model.SupportReply[]>;
  create(input: Pick<Model.SupportTicket, "topic" | "subject" | "message">): Promise<Model.SupportTicket>;
}

/** In-site Support Modal — real backend (`/api/support`) orqali Telegram
    support chatga yetkaziladi. Boshqa servicelardan farqli, mock-api emas,
    haqiqiy `fetch` bilan ishlaydi (`client.ts`da). */
export interface SupportRequestService {
  submit(input: Model.SupportRequestInput & { userId?: string }): Promise<void>;
}
