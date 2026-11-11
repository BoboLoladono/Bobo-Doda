// ─────────────────────────────────────────────────────────────────────────
// GENERATSIYA QILINGAN — QO'LDA TAHRIR QILINMANG.
// Manba: backend/prisma/schema.prisma  ·  npm run generate:contracts
// ─────────────────────────────────────────────────────────────────────────

export const Role = {
  SELLER: 'SELLER',
  BUYER: 'BUYER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const RoleValues = ['SELLER', 'BUYER'] as const;

export const StaffRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPERATIONS: 'OPERATIONS',
  FINANCE: 'FINANCE',
  SUPPORT: 'SUPPORT',
  TRUST_SAFETY: 'TRUST_SAFETY',
  KYC_REVIEWER: 'KYC_REVIEWER',
  ADMIN: 'ADMIN',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];
export const StaffRoleValues = ['SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'TRUST_SAFETY', 'KYC_REVIEWER', 'ADMIN'] as const;

export const StaffPermission = {
  DASHBOARD: 'DASHBOARD',
  USERS: 'USERS',
  SERVICES: 'SERVICES',
  JOBS: 'JOBS',
  ORDERS: 'ORDERS',
  KYC: 'KYC',
  DISPUTES: 'DISPUTES',
  PAYMENTS: 'PAYMENTS',
  REPORTS: 'REPORTS',
  APPEALS: 'APPEALS',
  REVIEWS: 'REVIEWS',
  SUPPORT: 'SUPPORT',
  CATEGORIES: 'CATEGORIES',
  SETTINGS: 'SETTINGS',
  AUDIT: 'AUDIT',
  STAFF: 'STAFF',
} as const;
export type StaffPermission = (typeof StaffPermission)[keyof typeof StaffPermission];
export const StaffPermissionValues = ['DASHBOARD', 'USERS', 'SERVICES', 'JOBS', 'ORDERS', 'KYC', 'DISPUTES', 'PAYMENTS', 'REPORTS', 'APPEALS', 'REVIEWS', 'SUPPORT', 'CATEGORIES', 'SETTINGS', 'AUDIT', 'STAFF'] as const;

export const AuditActorType = {
  USER: 'USER',
  STAFF: 'STAFF',
  SYSTEM: 'SYSTEM',
} as const;
export type AuditActorType = (typeof AuditActorType)[keyof typeof AuditActorType];
export const AuditActorTypeValues = ['USER', 'STAFF', 'SYSTEM'] as const;

export const OutboxStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  DEAD: 'DEAD',
  SKIPPED: 'SKIPPED',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];
export const OutboxStatusValues = ['PENDING', 'PROCESSING', 'SENT', 'DEAD', 'SKIPPED'] as const;

export const NotificationChannel = {
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  TELEGRAM: 'TELEGRAM',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];
export const NotificationChannelValues = ['SMS', 'EMAIL', 'TELEGRAM'] as const;

export const OutboxDeliveryAttemptStatus = {
  DELIVERED: 'DELIVERED',
  RETRYABLE_FAILURE: 'RETRYABLE_FAILURE',
  PERMANENT_FAILURE: 'PERMANENT_FAILURE',
} as const;
export type OutboxDeliveryAttemptStatus = (typeof OutboxDeliveryAttemptStatus)[keyof typeof OutboxDeliveryAttemptStatus];
export const OutboxDeliveryAttemptStatusValues = ['DELIVERED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE'] as const;

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const UserStatusValues = ['ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;

export const StaffStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
} as const;
export type StaffStatus = (typeof StaffStatus)[keyof typeof StaffStatus];
export const StaffStatusValues = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;

export const SellerStatus = {
  NOT_APPLIED: 'NOT_APPLIED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type SellerStatus = (typeof SellerStatus)[keyof typeof SellerStatus];
export const SellerStatusValues = ['NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;

export const SellerApplicationStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type SellerApplicationStatus = (typeof SellerApplicationStatus)[keyof typeof SellerApplicationStatus];
export const SellerApplicationStatusValues = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const CategoryStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CategoryStatus = (typeof CategoryStatus)[keyof typeof CategoryStatus];
export const CategoryStatusValues = ['ACTIVE', 'ARCHIVED'] as const;

export const ServiceStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];
export const ServiceStatusValues = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'PAUSED', 'ARCHIVED'] as const;

export const JobStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];
export const JobStatusValues = ['OPEN', 'CLOSED'] as const;

export const ContractSourceType = {
  SERVICE: 'SERVICE',
  JOB: 'JOB',
} as const;
export type ContractSourceType = (typeof ContractSourceType)[keyof typeof ContractSourceType];
export const ContractSourceTypeValues = ['SERVICE', 'JOB'] as const;

export const KycVerificationStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  SCANNING: 'SCANNING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RESUBMISSION_REQUIRED: 'RESUBMISSION_REQUIRED',
} as const;
export type KycVerificationStatus = (typeof KycVerificationStatus)[keyof typeof KycVerificationStatus];
export const KycVerificationStatusValues = ['DRAFT', 'PENDING', 'SCANNING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED'] as const;

export const KycDocumentStatus = {
  QUARANTINED: 'QUARANTINED',
  SCANNING: 'SCANNING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
  REJECTED: 'REJECTED',
} as const;
export type KycDocumentStatus = (typeof KycDocumentStatus)[keyof typeof KycDocumentStatus];
export const KycDocumentStatusValues = ['QUARANTINED', 'SCANNING', 'CLEAN', 'INFECTED', 'REJECTED'] as const;

export const KycDocumentType = {
  PASSPORT: 'PASSPORT',
  ID_CARD: 'ID_CARD',
  RESIDENCE_PERMIT: 'RESIDENCE_PERMIT',
  DRIVER_LICENSE: 'DRIVER_LICENSE',
} as const;
export type KycDocumentType = (typeof KycDocumentType)[keyof typeof KycDocumentType];
export const KycDocumentTypeValues = ['PASSPORT', 'ID_CARD', 'RESIDENCE_PERMIT', 'DRIVER_LICENSE'] as const;

export const ContractStatus = {
  PENDING_SELLER: 'PENDING_SELLER',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];
export const ContractStatusValues = ['PENDING_SELLER', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'REJECTED'] as const;

export const MilestoneStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  APPROVED: 'APPROVED',
} as const;
export type MilestoneStatus = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];
export const MilestoneStatusValues = ['PENDING', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'APPROVED'] as const;

export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PaymentStatusValues = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;

export const RefundStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];
export const RefundStatusValues = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'] as const;

export const PayoutStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
export const PayoutStatusValues = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'] as const;

export const DisputeStatus = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];
export const DisputeStatusValues = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'CANCELLED'] as const;

export const DisputeReason = {
  SCOPE: 'SCOPE',
  QUALITY: 'QUALITY',
  DEADLINE: 'DEADLINE',
  PAYMENT: 'PAYMENT',
  COMMUNICATION: 'COMMUNICATION',
  OTHER: 'OTHER',
} as const;
export type DisputeReason = (typeof DisputeReason)[keyof typeof DisputeReason];
export const DisputeReasonValues = ['SCOPE', 'QUALITY', 'DEADLINE', 'PAYMENT', 'COMMUNICATION', 'OTHER'] as const;

export const DisputeResolutionType = {
  BUYER_FULL_REFUND: 'BUYER_FULL_REFUND',
  SELLER_FULL_RELEASE: 'SELLER_FULL_RELEASE',
  SPLIT: 'SPLIT',
} as const;
export type DisputeResolutionType = (typeof DisputeResolutionType)[keyof typeof DisputeResolutionType];
export const DisputeResolutionTypeValues = ['BUYER_FULL_REFUND', 'SELLER_FULL_RELEASE', 'SPLIT'] as const;

export const ReconciliationTrigger = {
  AUTOMATIC: 'AUTOMATIC',
} as const;
export type ReconciliationTrigger = (typeof ReconciliationTrigger)[keyof typeof ReconciliationTrigger];
export const ReconciliationTriggerValues = ['AUTOMATIC'] as const;

export const ReconciliationRunStatus = {
  NO_CHANGE: 'NO_CHANGE',
  RECONCILED: 'RECONCILED',
  ANOMALY: 'ANOMALY',
  ERROR: 'ERROR',
} as const;
export type ReconciliationRunStatus = (typeof ReconciliationRunStatus)[keyof typeof ReconciliationRunStatus];
export const ReconciliationRunStatusValues = ['NO_CHANGE', 'RECONCILED', 'ANOMALY', 'ERROR'] as const;

export const FinancialAnomalySeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;
export type FinancialAnomalySeverity = (typeof FinancialAnomalySeverity)[keyof typeof FinancialAnomalySeverity];
export const FinancialAnomalySeverityValues = ['INFO', 'WARNING', 'CRITICAL'] as const;

export const LedgerAccountType = {
  PAYMENT_CLEARING: 'PAYMENT_CLEARING',
  ESCROW: 'ESCROW',
  SELLER_PAYABLE: 'SELLER_PAYABLE',
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
  REFUND_CLEARING: 'REFUND_CLEARING',
  PAYOUT_CLEARING: 'PAYOUT_CLEARING',
  DISPUTE_HOLD: 'DISPUTE_HOLD',
} as const;
export type LedgerAccountType = (typeof LedgerAccountType)[keyof typeof LedgerAccountType];
export const LedgerAccountTypeValues = ['PAYMENT_CLEARING', 'ESCROW', 'SELLER_PAYABLE', 'PLATFORM_REVENUE', 'REFUND_CLEARING', 'PAYOUT_CLEARING', 'DISPUTE_HOLD'] as const;

export const LedgerAccountOwnerType = {
  PLATFORM: 'PLATFORM',
  USER: 'USER',
} as const;
export type LedgerAccountOwnerType = (typeof LedgerAccountOwnerType)[keyof typeof LedgerAccountOwnerType];
export const LedgerAccountOwnerTypeValues = ['PLATFORM', 'USER'] as const;

export const LedgerTransactionType = {
  PAYMENT_FUNDING: 'PAYMENT_FUNDING',
  CONTRACT_SETTLEMENT: 'CONTRACT_SETTLEMENT',
  REFUND: 'REFUND',
  PAYOUT_RESERVATION: 'PAYOUT_RESERVATION',
  PAYOUT_RELEASE: 'PAYOUT_RELEASE',
  DISPUTE_HOLD: 'DISPUTE_HOLD',
  DISPUTE_RESOLUTION: 'DISPUTE_RESOLUTION',
  DISPUTE_HOLD_RELEASE: 'DISPUTE_HOLD_RELEASE',
} as const;
export type LedgerTransactionType = (typeof LedgerTransactionType)[keyof typeof LedgerTransactionType];
export const LedgerTransactionTypeValues = ['PAYMENT_FUNDING', 'CONTRACT_SETTLEMENT', 'REFUND', 'PAYOUT_RESERVATION', 'PAYOUT_RELEASE', 'DISPUTE_HOLD', 'DISPUTE_RESOLUTION', 'DISPUTE_HOLD_RELEASE'] as const;

export const OtpPurpose = {
  REGISTER: 'REGISTER',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];
export const OtpPurposeValues = ['REGISTER', 'PASSWORD_RESET'] as const;

export const SupportTicketStatus = {
  OPEN: 'OPEN',
  WAITING_USER: 'WAITING_USER',
  ANSWERED: 'ANSWERED',
  CLOSED: 'CLOSED',
} as const;
export type SupportTicketStatus = (typeof SupportTicketStatus)[keyof typeof SupportTicketStatus];
export const SupportTicketStatusValues = ['OPEN', 'WAITING_USER', 'ANSWERED', 'CLOSED'] as const;

export const TrustReportTargetType = {
  USER: 'USER',
  SERVICE: 'SERVICE',
  JOB: 'JOB',
  MESSAGE: 'MESSAGE',
} as const;
export type TrustReportTargetType = (typeof TrustReportTargetType)[keyof typeof TrustReportTargetType];
export const TrustReportTargetTypeValues = ['USER', 'SERVICE', 'JOB', 'MESSAGE'] as const;

export const TrustReportReasonType = {
  SCAM: 'SCAM',
  SPAM: 'SPAM',
  PLAGIARISM: 'PLAGIARISM',
  OFF_PLATFORM: 'OFF_PLATFORM',
  INAPPROPRIATE: 'INAPPROPRIATE',
  FAKE_PROFILE: 'FAKE_PROFILE',
  COPYRIGHT: 'COPYRIGHT',
} as const;
export type TrustReportReasonType = (typeof TrustReportReasonType)[keyof typeof TrustReportReasonType];
export const TrustReportReasonTypeValues = ['SCAM', 'SPAM', 'PLAGIARISM', 'OFF_PLATFORM', 'INAPPROPRIATE', 'FAKE_PROFILE', 'COPYRIGHT'] as const;

export const TrustReportSeverity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type TrustReportSeverity = (typeof TrustReportSeverity)[keyof typeof TrustReportSeverity];
export const TrustReportSeverityValues = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const TrustReportStatus = {
  NEW: 'NEW',
  INVESTIGATING: 'INVESTIGATING',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type TrustReportStatus = (typeof TrustReportStatus)[keyof typeof TrustReportStatus];
export const TrustReportStatusValues = ['NEW', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'] as const;

export const TrustReportActionTaken = {
  NONE: 'NONE',
  WARNED: 'WARNED',
  RESTRICTED: 'RESTRICTED',
  SUSPENDED: 'SUSPENDED',
  REMOVED: 'REMOVED',
} as const;
export type TrustReportActionTaken = (typeof TrustReportActionTaken)[keyof typeof TrustReportActionTaken];
export const TrustReportActionTakenValues = ['NONE', 'WARNED', 'RESTRICTED', 'SUSPENDED', 'REMOVED'] as const;

export const UserAppealRestrictionType = {
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
  RESTRICTED: 'RESTRICTED',
} as const;
export type UserAppealRestrictionType = (typeof UserAppealRestrictionType)[keyof typeof UserAppealRestrictionType];
export const UserAppealRestrictionTypeValues = ['SUSPENDED', 'BLOCKED', 'RESTRICTED'] as const;

export const UserAppealStatus = {
  PENDING: 'PENDING',
  REVIEWING: 'REVIEWING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
} as const;
export type UserAppealStatus = (typeof UserAppealStatus)[keyof typeof UserAppealStatus];
export const UserAppealStatusValues = ['PENDING', 'REVIEWING', 'ACCEPTED', 'REJECTED'] as const;

export const ReviewStatus = {
  APPROVED: 'APPROVED',
  FLAGGED: 'FLAGGED',
  HIDDEN: 'HIDDEN',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];
export const ReviewStatusValues = ['APPROVED', 'FLAGGED', 'HIDDEN'] as const;
