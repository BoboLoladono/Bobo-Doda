"use client";

import { Button } from "@/components/ui/Button";
import { CountdownBadge } from "@/components/ui/CountdownBadge";
import { MilestoneStatusBadge } from "@/components/shared/StatusBadge";
import type { Contract, Milestone } from "@/lib/types";
import { formatDate, formatFileSize, formatMoney, triggerFileDownload } from "@/lib/format";
import { useT } from "@/lib/i18n";

export interface MilestoneItemProps {
  milestone: Milestone;
  index: number;
  contractStatus: Contract["status"];
  onSubmit: (milestone: Milestone) => void;
  /** Ushbu bosqich bog'langan xizmatga narxga kiritilgan tuzatishlar soni */
  revisionsIncluded?: number;
  /** Rasmiy to'lov kvitansiyasini ko'rish callback */
  onViewReceipt?: (milestone: Milestone) => void;
}

export function MilestoneItem({
  milestone,
  index,
  contractStatus,
  onSubmit,
  revisionsIncluded,
  onViewReceipt,
}: MilestoneItemProps) {
  const { t, lang } = useT();
  const actionable = contractStatus === "faol";
  const awaitingPayment = contractStatus === "imzolangan";
  /* Ilgari "kutilmoqda" bosqich `opacity-70` bilan xiralashtirilardi —
     text-faint bilan birga kontrast ~2.9:1 ga tushib, AA (4.5:1) dan
     o'tmasdi. Endi shaffoflik o'rniga yumshoq fon ishlatiladi. */
  const dimmed = milestone.status === "kutilmoqda";

  return (
    <div
      className={`flex flex-col gap-3 rounded-card border p-4 ${
        milestone.status === "ozgartirish_soraldi"
          ? "border-danger/30 bg-danger/5"
          : milestone.status === "qabul_qilindi"
            ? "border-success/25 bg-success/5"
            : "border-line bg-card"
      } ${dimmed ? "bg-surface" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${
              milestone.status === "qabul_qilindi"
                ? "bg-success/10 text-success-deep"
                : dimmed
                  ? "bg-card-hover text-faint"
                  : "bg-primary/10 text-primary-deep"
            }`}
          >
            {index + 1}
          </span>
          <div>
            <h4 className="text-sm font-semibold text-ink">{milestone.title}</h4>
            <p className="mt-0.5 text-xs text-muted">{milestone.description}</p>
          </div>
        </div>
        <MilestoneStatusBadge status={milestone.status} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-9 text-xs text-muted">
        <span className="font-medium text-ink">
          {formatMoney(milestone.amount, lang)}
        </span>
        <span>
          {t("ms.due")}: {formatDate(milestone.dueDate, lang)}
        </span>
        {milestone.status === "qabul_qilindi" && milestone.approvedAt && (
          <span className="text-success">
            {t("ms.paid")} · {formatDate(milestone.approvedAt, lang)}
          </span>
        )}
      </div>

      {/* Holatga mos qo'shimcha qator */}
      {milestone.status === "kutilmoqda" && (
        <p className="pl-9 text-2xs text-faint">
          {awaitingPayment ? t("cfund.awaitingSeller") : t("ms.notFundedNote")}
        </p>
      )}

      {milestone.status === "mablaglangan" && (
        <div className="flex flex-wrap items-center gap-3 pl-9">
          <p className="text-2xs text-muted">{t("ms.fundedNote")}</p>
          {actionable && (
            <Button size="sm" onClick={() => onSubmit(milestone)}>
              {t("ms.submitAction")}
            </Button>
          )}
        </div>
      )}

      {milestone.status === "topshirildi" && (
        <div className="flex flex-col gap-2 pl-9">
          <div className="flex flex-wrap items-center gap-3">
            {milestone.reviewDeadline && !milestone.autoAcceptPaused && (
              <CountdownBadge deadline={milestone.reviewDeadline} />
            )}
            <span className="text-2xs text-muted">{t("ms.waitingReview")}</span>
          </div>
          <p className="text-2xs text-faint">
            {milestone.autoAcceptPaused
              ? "Nizo ochilgani sababli avtomatik tasdiqlash taymeri to'xtatildi."
              : t("ms.autoAcceptNote")}
          </p>
        </div>
      )}

      {milestone.status === "ozgartirish_soraldi" && (
        <div className="flex flex-col gap-3 pl-9">
          {milestone.revisionComment && (
            <div className="rounded-input border border-danger/25 bg-surface p-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-danger">
                {t("ms.revisionNote")}
              </p>
              <p className="mt-1 text-xs text-muted">{milestone.revisionComment}</p>
            </div>
          )}
          {revisionsIncluded !== undefined && (
            <span className="text-2xs text-faint">
              {t("bms.revisionsUsed")
                .replace("{used}", String(milestone.revisionCount ?? 0))
                .replace("{limit}", String(revisionsIncluded))}
            </span>
          )}
          {actionable && (
            <Button size="sm" onClick={() => onSubmit(milestone)} className="self-start">
              {t("ms.resubmitAction")}
            </Button>
          )}
        </div>
      )}

      {/* Topshirilgan ish natijalari (Havola, fayllar, izoh) */}
      {(milestone.deliverableLink ||
        milestone.deliverableNote ||
        (milestone.deliverableFiles && milestone.deliverableFiles.length > 0)) && (
        <div className="ml-9 flex flex-col gap-2 rounded-input border border-primary/20 bg-surface/80 p-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
              aria-hidden="true"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span>{t("sm.deliverableTitle")}</span>
          </div>

          {milestone.deliverableLink && (
            <div className="flex items-center gap-2">
              <span className="text-2xs text-muted">{t("sm.link")}:</span>
              <a
                href={milestone.deliverableLink.startsWith("http") ? milestone.deliverableLink : `https://${milestone.deliverableLink}`}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-primary hover:underline flex items-center gap-1 break-all"
              >
                {milestone.deliverableLink}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          )}

          {milestone.deliverableNote && (
            <p className="text-muted whitespace-pre-line bg-card/60 rounded-btn p-2 border border-line/40">
              {milestone.deliverableNote}
            </p>
          )}

          {milestone.deliverableFiles && milestone.deliverableFiles.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-2xs font-medium text-muted">{t("sm.deliverableFiles")}:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {milestone.deliverableFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded-btn border border-line bg-card p-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted shrink-0" aria-hidden="true">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                        <polyline points="13 2 13 9 20 9" />
                      </svg>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink text-2xs">{file.name}</p>
                        <p className="text-[10px] text-faint">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => triggerFileDownload(file)}
                      className="shrink-0 rounded-btn bg-surface hover:bg-card-hover px-2.5 py-1 text-[11px] font-medium text-primary border border-line cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary min-h-[32px] sm:min-h-0"
                      title={t("sm.downloadFile")}
                      aria-label={`${file.name} (${formatFileSize(file.size)}) — ${t("sm.downloadFile")}`}
                    >
                      {t("sm.downloadFile")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Topshirishlar va tuzatishlar tarixi (barcha versiyalar) */}
      {((milestone.submissions && milestone.submissions.length > 0) ||
        (milestone.revisionRequests && milestone.revisionRequests.length > 0)) && (
        <div className="ml-9 flex flex-col gap-2 rounded-input border border-line bg-surface p-3 text-xs">
          {milestone.submissions && milestone.submissions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                Topshirishlar tarixi ({milestone.submissions.length})
              </p>
              {milestone.submissions.map((sub, idx) => (
                <div key={sub.id} className="rounded-btn border border-line/70 bg-card p-2">
                  <div className="flex items-center justify-between text-2xs text-faint">
                    <span>#{milestone.submissions!.length - idx} topshirish</span>
                    <span>{formatDate(sub.createdAt, lang)}</span>
                  </div>
                  {sub.message && <p className="mt-1 whitespace-pre-line text-ink">{sub.message}</p>}
                  {sub.deliverableUrls.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {sub.deliverableUrls.map((url, uIdx) => (
                        <a
                          key={uIdx}
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-2xs font-medium text-primary hover:underline break-all"
                        >
                          Natija havolasi / fayl #{uIdx + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {milestone.revisionRequests && milestone.revisionRequests.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-danger">
                Tuzatish so&apos;rovlari tarixi ({milestone.revisionRequests.length})
              </p>
              {milestone.revisionRequests.map((rev, idx) => (
                <div key={rev.id} className="rounded-btn border border-danger/20 bg-danger/5 p-2">
                  <div className="flex items-center justify-between text-2xs text-faint">
                    <span>#{milestone.revisionRequests!.length - idx} tuzatish</span>
                    <span>{formatDate(rev.createdAt, lang)}</span>
                  </div>
                  <p className="mt-1 text-ink">{rev.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rasmiy kvitansiya (faqat qabul qilingan bosqichda) */}
      {milestone.status === "qabul_qilindi" && onViewReceipt && (
        <div className="pl-9">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onViewReceipt(milestone)}
            className="gap-1.5 text-xs text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            {t("receipt.download")}
          </Button>
        </div>
      )}
    </div>
  );
}

