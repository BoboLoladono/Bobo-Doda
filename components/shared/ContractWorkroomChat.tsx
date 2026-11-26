"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChatFileAttach } from "@/components/ui/ChatFileAttach";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { AntiCircumventionModal } from "@/components/shared/AntiCircumventionModal";
import { MilestoneStatusBadge } from "@/components/shared/StatusBadge";
import {
  authService,
  filesService,
  messagesService,
  DATA_CHANGED_EVENT,
} from "@/lib/api";
import { checkCircumvention, reportCircumventionViolation, type CircumventionCheckResult } from "@/lib/chat-filter";
import { formatDate, formatFileSize, formatTime, triggerFileDownload } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { Contract, DeliverableFile, Message, Milestone } from "@/lib/types";

export interface ContractWorkroomChatProps {
  contract: Contract;
  milestones: Milestone[];
  counterpartName: string;
  role: "xaridor" | "mutaxassis";
}

export function ContractWorkroomChat({
  contract,
  milestones,
  counterpartName,
  role,
}: ContractWorkroomChatProps) {
  const { t, lang } = useT();
  const { toast } = useToast();
  const isMockMessaging = process.env.NEXT_PUBLIC_DEMO_WORKSPACE === "1";

  const [tab, setTab] = useState<"chat" | "deliverables">("deliverables");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<DeliverableFile[]>([]);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [circumventionResult, setCircumventionResult] = useState<CircumventionCheckResult | null>(null);
  const [circumventionModalOpen, setCircumventionModalOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const myId = authService.getSession()?.userId ?? null;

  // Topshirilgan ish natijalari mavjud bosqichlar
  const deliverableMilestones = milestones.filter(
    (m) =>
      Boolean(m.deliverableLink) ||
      Boolean(m.deliverableNote) ||
      (m.deliverableFiles && m.deliverableFiles.length > 0)
  );

  const load = useCallback(() => {
    if (!isMockMessaging) {
      setMessages([]);
      return;
    }
    messagesService
      .list(contract.id)
      .then((list) => {
        setMessages((prev) => {
          if (!prev || prev.length !== list.length || list.some((m, i) => m.id !== prev[i]?.id)) {
            return list;
          }
          return prev;
        });
        void messagesService.markRead(contract.id);
      })
      .catch((err) => {
        if (!messages) setLoadError(err);
      });
  }, [contract.id, messages, isMockMessaging]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id]);

  useEffect(() => {
    if (!contract.id) return;
    const interval = setInterval(load, 4000);
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || detail.key === "sb_messages" || !detail.key) {
        load();
      }
    };
    window.addEventListener(DATA_CHANGED_EVENT, handleEvent);
    window.addEventListener("storage", handleEvent);
    return () => {
      clearInterval(interval);
      window.removeEventListener(DATA_CHANGED_EVENT, handleEvent);
      window.removeEventListener("storage", handleEvent);
    };
  }, [contract.id, load]);

  useEffect(() => {
    if (tab === "chat") {
      chatEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages?.length, tab]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const hasMedia = attachedImages.length > 0 || attachedFiles.length > 0;
    if (!text && !hasMedia) return;

    // To'lovdan oldin telefon/kontakt almashish tekshiruvi
    if (!contract.fundedAt) {
      const check = checkCircumvention(text);
      if (check.hasViolation) {
        setCircumventionResult(check);
        setCircumventionModalOpen(true);
        const current = authService.getSession();
        reportCircumventionViolation({
          senderId: current?.userId,
          targetType: "message",
          targetId: contract.id,
          targetTitle: contract.title,
          matchedText: check.matchedText,
          violationType: check.type,
          fullContent: text,
        });
        return;
      }
    }

    setSending(true);
    try {
      const primaryImage = attachedImages[0];
      const message = await messagesService.send(
        contract.id,
        text,
        primaryImage,
        hasMedia
          ? {
              images: attachedImages.length > 0 ? attachedImages : undefined,
              files: attachedFiles.length > 0 ? attachedFiles : undefined,
            }
          : undefined
      );
      setMessages((prev) => [...(prev ?? []), message]);
      setDraft("");
      setAttachedImages([]);
      setAttachedFiles([]);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSend(e);
    }
  }

  function removeAttachedImage(index: number) {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;

  const isClosed = contract.status === "yakunlangan" || contract.status === "bekor_qilingan";

  return (
    <>
      <Card padding="none" className="flex flex-col overflow-hidden shadow-xs border-line">
        {/* Yuqori sarlavha paneli */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/50 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <Avatar name={counterpartName} size="sm" />
            <div>
              <h3 className="font-heading text-sm font-bold text-ink">
                {t("workroom.chatTitle")}
              </h3>
              <p className="text-2xs text-muted">
                {counterpartName} · {role === "xaridor" ? t("market.tabSpecialists") : t("jobs.buyer")}
              </p>
            </div>
          </div>
          <div className="w-full sm:w-auto">
            <Tabs
              value={tab}
              onChange={(val) => setTab(val as "chat" | "deliverables")}
              items={[
                {
                  value: "chat",
                  label: t("workroom.tabChat"),
                  count: messages?.length ?? undefined,
                },
                {
                  value: "deliverables",
                  label: t("workroom.tabDeliverables"),
                  count: deliverableMilestones.length || undefined,
                },
              ]}
            />
          </div>
        </div>

        {/* Escrow kafolat xabari */}
        <div className="flex items-center gap-2 border-b border-line bg-primary/5 px-4 py-2 text-2xs text-muted">
          <span className="shrink-0">🛡️</span>
          <span className="leading-tight">{t("workroom.escrowNotice")}</span>
        </div>

        {tab === "chat" ? (
          <>
            {/* Xabarlar lentasi */}
            <div className="flex max-h-[460px] min-h-[260px] flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-5">
              {!messages ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-14 w-3/4 self-start" />
                  <Skeleton className="h-14 w-2/3 self-end" />
                  <Skeleton className="h-14 w-1/2 self-start" />
                </div>
              ) : messages.length === 0 ? (
                <div className="m-auto flex max-w-xs flex-col items-center gap-1.5 text-center">
                  <span className="text-2xl">💬</span>
                  <p className="font-heading text-xs font-semibold text-ink">
                    {t("chat.empty")}
                  </p>
                  <p className="text-2xs text-muted leading-relaxed">
                    {t("workroom.chatDesc")}
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const mine = msg.senderId === myId;
                  const allImages = msg.images || (msg.image ? [msg.image] : []);
                  const hasFiles = msg.files && msg.files.length > 0;

                  return (
                    <div
                      key={msg.id}
                      className={`flex max-w-[88%] sm:max-w-[80%] flex-col gap-1 ${
                        mine ? "items-end self-end" : "items-start self-start"
                      }`}
                    >
                      <div
                        className={`flex flex-col gap-2 rounded-2xl p-3.5 text-sm shadow-2xs ${
                          mine
                            ? "rounded-br-xs bg-primary text-on-primary"
                            : "rounded-bl-xs border border-line bg-card text-ink"
                        }`}
                      >
                        {/* Rasmlar */}
                        {allImages.length > 0 && (
                          <div
                            className={`grid gap-1.5 ${
                              allImages.length === 1 ? "grid-cols-1" : "grid-cols-2"
                            }`}
                          >
                            {allImages.map((img, i) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={i}
                                src={img}
                                alt={t("chat.attachedImage")}
                                className="max-h-56 w-full rounded-lg object-cover"
                              />
                            ))}
                          </div>
                        )}

                        {/* Xabar matni */}
                        {msg.text && (
                          <p className="whitespace-pre-line break-words leading-relaxed text-xs sm:text-sm">
                            {msg.text}
                          </p>
                        )}

                        {/* Biriktirilgan fayllar */}
                        {hasFiles && (
                          <div className="flex flex-col gap-1.5 pt-1">
                            {msg.files?.map((file) => (
                              <div
                                key={file.id || file.url}
                                className={`flex items-center justify-between gap-2.5 rounded-lg p-2 text-xs ${
                                  mine
                                    ? "bg-white/15 text-on-primary"
                                    : "bg-surface border border-line text-ink"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="shrink-0"
                                    aria-hidden="true"
                                  >
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="16" y1="13" x2="8" y2="13" />
                                    <line x1="16" y1="17" x2="8" y2="17" />
                                    <polyline points="10 9 9 9 8 9" />
                                  </svg>
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-2xs">{file.name}</p>
                                    <p className="text-3xs opacity-80">{formatFileSize(file.size)}</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => (file.url.includes("/uploads/") ? void filesService.download(file.url, file.name) : triggerFileDownload(file))}
                                  className={`shrink-0 rounded-md px-2 py-1 text-2xs font-semibold transition-colors duration-150 ${
                                    mine
                                      ? "bg-white/20 text-white hover:bg-white/30"
                                      : "bg-primary/10 text-primary-deep hover:bg-primary/20"
                                  }`}
                                  title={file.name}
                                >
                                  {t("workroom.download")}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Muallif va vaqt */}
                      <span suppressHydrationWarning className="text-3xs text-faint px-1">
                        {mine ? t("chat.you") : counterpartName.split(" ")[0]} ·{" "}
                        {formatTime(msg.createdAt, lang)}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Xabar yuborish shakli */}
            {!isMockMessaging ? (
              <div className="border-t border-line bg-surface p-3 text-center text-2xs text-muted">
                Shaxsiy chat xizmati keyingi relizda yoqiladi. Barcha ish natijalari va tuzatish izohlari yuqoridagi bosqichlar orqali yuboriladi.
              </div>
            ) : !isClosed ? (
              <form onSubmit={handleSend} className="border-t border-line bg-card p-3 sm:p-4">
                {/* Yuborishdan oldin tanlangan fayllar/rasmlar preview'si */}
                {(attachedImages.length > 0 || attachedFiles.length > 0) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {attachedImages.map((img, i) => (
                      <div key={i} className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img}
                          alt="preview"
                          className="h-12 w-12 rounded-lg border border-line object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeAttachedImage(i)}
                          className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-white text-3xs font-bold shadow-xs"
                          aria-label="Remove image"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {attachedFiles.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-2xs text-ink"
                      >
                        <span className="truncate max-w-[120px]">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachedFile(i)}
                          className="text-muted hover:text-danger ml-1"
                          aria-label="Remove file"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <ChatFileAttach
                    onAddImages={(newImgs) => setAttachedImages((prev) => [...prev, ...newImgs])}
                    onAddFiles={(newFl) => setAttachedFiles((prev) => [...prev, ...newFl])}
                    attachedCount={attachedImages.length + attachedFiles.length}
                    disabled={sending}
                    onError={(msg) => toast(msg, "error")}
                  />
                  <div className="flex-1">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t("workroom.sendPh")}
                      rows={2}
                      className="w-full resize-none rounded-input border border-line bg-surface px-3 py-2 text-xs sm:text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                      maxLength={5000}
                    />
                  </div>
                  <Button
                    type="submit"
                    loading={sending}
                    disabled={!draft.trim() && attachedImages.length === 0 && attachedFiles.length === 0}
                    size="sm"
                    className="h-11 px-4"
                  >
                    {t("chat.send")}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="border-t border-line bg-surface p-3 text-center text-2xs text-faint">
                {t("pchat.closed")}
              </p>
            )}
          </>
        ) : (
          /* TAB 2: TOPSHIRILGAN FAYLLAR VA NATIJALAR */
          <div className="flex max-h-[500px] min-h-[260px] flex-col gap-4 overflow-y-auto p-4 sm:p-5">
            {deliverableMilestones.length === 0 ? (
              <div className="m-auto flex max-w-sm flex-col items-center gap-2 py-8 text-center">
                <span className="text-3xl">📁</span>
                <p className="font-heading text-sm font-bold text-ink">
                  {t("workroom.emptyDeliverables")}
                </p>
                <p className="text-xs text-muted leading-relaxed">
                  {t("workroom.emptyDeliverablesHint")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {deliverableMilestones.map((milestone, idx) => (
                  <div
                    key={milestone.id}
                    className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-2xs font-bold text-primary-deep">
                          {idx + 1}
                        </span>
                        <h4 className="font-heading text-xs sm:text-sm font-bold text-ink">
                          {milestone.title}
                        </h4>
                      </div>
                      <MilestoneStatusBadge status={milestone.status} />
                    </div>

                    {milestone.submittedAt && (
                      <span className="text-3xs text-faint">
                        {t("ms.submittedAt")}: {formatDate(milestone.submittedAt, lang)}
                      </span>
                    )}

                    {/* Tashqi havola */}
                    {milestone.deliverableLink && (
                      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs">
                        <span className="font-medium text-primary-deep shrink-0">🔗 {t("sm.link")}:</span>
                        <a
                          href={
                            milestone.deliverableLink.startsWith("http")
                              ? milestone.deliverableLink
                              : `https://${milestone.deliverableLink}`
                          }
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-medium text-primary hover:underline break-all"
                        >
                          {milestone.deliverableLink}
                        </a>
                      </div>
                    )}

                    {/* Izoh */}
                    {milestone.deliverableNote && (
                      <div className="rounded-lg bg-surface p-2.5 text-xs border border-line/60">
                        <p className="text-2xs font-semibold text-muted uppercase tracking-wider mb-1">
                          {t("sm.note")}:
                        </p>
                        <p className="whitespace-pre-line text-ink leading-relaxed">
                          {milestone.deliverableNote}
                        </p>
                      </div>
                    )}

                    {/* Biriktirilgan fayllar */}
                    {milestone.deliverableFiles && milestone.deliverableFiles.length > 0 && (
                      <div className="flex flex-col gap-2 pt-1">
                        <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
                          {t("sm.deliverableFiles")} ({milestone.deliverableFiles.length}):
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {milestone.deliverableFiles.map((file) => (
                            <div
                              key={file.id || file.url}
                              className="flex items-center justify-between gap-2.5 rounded-lg border border-line bg-surface p-2.5 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  className="text-muted shrink-0"
                                  aria-hidden="true"
                                >
                                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                                  <polyline points="13 2 13 9 20 9" />
                                </svg>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-ink text-2xs">{file.name}</p>
                                  <p className="text-3xs text-faint">{formatFileSize(file.size)}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => (file.url.includes("/uploads/") ? void filesService.download(file.url, file.name) : triggerFileDownload(file))}
                                className="shrink-0 rounded-btn bg-card hover:bg-card-hover px-2.5 py-1 text-2xs font-semibold text-primary border border-line transition-colors shadow-2xs"
                              >
                                {t("workroom.download")}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <AntiCircumventionModal
        open={circumventionModalOpen}
        onClose={() => setCircumventionModalOpen(false)}
        result={circumventionResult}
      />
    </>
  );
}
