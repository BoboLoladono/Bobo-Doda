import type {
  AppNotification,
  Contract,
  Dispute,
  Job,
  Message,
  Milestone,
  Offer,
  PaymentCard,
  Proposal,
  Review,
  SellerProfile,
  Service,
  User,
  VerificationRecord,
  WithdrawalRequest,
} from "@/lib/types";

export const BUYER_ID = "";
export const SELLER_ID = "";
export const DEMO_PASSWORD = "";

/**
 * Production-ready clean data:
 * Barcha sun'iy mock ma'lumotlar olib tashlangan.
 * Platforma faqat real foydalanuvchilar, real e'lonlar va shartnomalar bilan ishlaydi.
 */
export const seedUsers: User[] = [];
export const seedProfiles: Record<string, SellerProfile> = {};
export const seedServices: Service[] = [];
export const seedJobs: Job[] = [];
export const seedProposals: Proposal[] = [];
export const seedContracts: Contract[] = [];
export const seedMilestones: Milestone[] = [];
export const seedMessages: Message[] = [];
export const seedOffers: Offer[] = [];
export const seedOfferMessages: Message[] = [];
export const seedReviews: Review[] = [];
export const seedNotifications: AppNotification[] = [];
export const seedWithdrawals: WithdrawalRequest[] = [];
export const seedVerifications: VerificationRecord[] = [];
export const seedCards: PaymentCard[] = [];
export const seedDisputes: Dispute[] = [];
