"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChatImageAttach } from "@/components/ui/ChatImageAttach";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { authService, messagesService, DATA_CHANGED_EVENT } from "@/lib/api";
import type { Message } from "@/lib/types";
import { formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { checkCircumvention, reportCircumventionViolation, type CircumventionCheckResult } from "@/lib/chat-filter";
import { AntiCircumventionModal } from "@/components/shared/AntiCircumventionModal";

export interface ProposalChatProps {
  /** Taklif (Proposal) id'si — suhbat shu id bo'yicha saqlanadi */
  proposalId: string;
  /** Qarshi tomon ismi (xabar ostidagi imzo uchun) */
  counterpartName: string;
  /** Taklif hali faolmi — yopilgan taklifda tarix faqat o'qish uchun */
  open: boolean;
}

/* E'lon orqali kelgan taklif (Proposal) uchun suhbat. Ilgari xaridor
   "Suhbatga taklif qilish" tugmasini bossa, mutaxassisga bildirishnoma ketar,
   lekin ikki tomon GAPLASHA OLMASDI — taklif uchun hech qanday kanal yo'q edi.
   Shartnoma va Offer chatlari bilan bir xil ko'rinishda. */
export function ProposalChat({
  proposalId,
  counterpartName,
  open,
}: ProposalChatProps) {
  const { t, lang } = useT();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [draftImage, setDraftImage] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [circumventionResult, setCircumventionResult] = useState<CircumventionCheckResult | null>(null);
  const [circumventionModalOpen, setCircumventionModalOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const myId = authService.getSession()?.userId ?? null;
  const isMockMessaging = process.env.NEXT_PUBLIC_DEMO_WORKSPACE === "1";

  const load = useCallback(() => {
    if (!isMockMessaging) {
      setMessages([]);
      return;
    }
    messagesService
      .list(proposalId)
      .then((list) => {
        setMessages((prev) => {
          if (!prev || prev.length !== list.length || list.some((m, i) => m.id !== prev[i]?.id)) {
            return list;
          }
          return prev;
        });
        void messagesService.markRead(proposalId);
      })
      .catch((err) => {
        setMessages((prev) => {
          if (!prev) setLoadError(err);
          return prev;
        });
      });
  }, [proposalId, isMockMessaging]);

  useEffect(() => {
    load();
    // `load` ataylab chiqarib tashlangan: u `messages`ga bog'liq (yuqorida)
    // va har render sayin identifikatori o'zgaradi — uni qo'shish bu effektni
    // "faqat proposalId o'zgarganda birinchi yuklash" o'rniga cheksiz qayta
    // ishga tushishga aylantirardi. Pastdagi interval effekti jonli yangilanishni beradi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  /* Jonli suhbat: yangi xabarlar kelganda yoki tablararo yozishmada F5 shart emas */
  useEffect(() => {
    if (!proposalId) return;
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
  }, [proposalId, load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text && !draftImage) return;

    // Platformadan tashqarida kelishish (circumvention) tekshiruvi
    const check = checkCircumvention(text);
    if (check.hasViolation) {
      setCircumventionResult(check);
      setCircumventionModalOpen(true);
      const current = authService.getSession();
      reportCircumventionViolation({
        senderId: current?.userId,
        targetType: "proposal",
        targetId: proposalId,
        targetTitle: `Taklif chati (#${proposalId})`,
        matchedText: check.matchedText,
        violationType: check.type,
        fullContent: text,
      });
      return;
    }

    setSending(true);
    try {
      const message = await messagesService.send(proposalId, text, draftImage);
      setMessages((prev) => [...(prev ?? []), message]);
      setDraft("");
      setDraftImage(undefined);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSending(false);
    }
  }

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;

  return (
    <>
      <Card padding="none" className="flex flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-heading text-sm font-bold text-ink">
          {t("pchat.title")}
        </h2>
        <p className="mt-0.5 text-2xs text-faint">{t("pchat.hint")}</p>
      </div>

      {/* Escrow Anti-circumvention ogohlantirish paneli */}
      <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-line text-2xs text-muted">
        <span>🛡️</span>
        <span className="leading-tight">
          {lang === "ru"
            ? "Безопасная сделка: передача контактов (телефон, Telegram) до оплаты контракта запрещена."
            : "Xavfsizlik kafolati: To'lov Escrow hisobiga o'tkazilgunga qadar telefon va Telegram almashish taqiqlanadi."}
        </span>
      </div>

      <div className="flex max-h-96 min-h-40 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!messages ? (
          <Skeleton className="h-16 w-full" />
        ) : messages.length === 0 ? (
          <p className="m-auto max-w-60 text-center text-xs text-faint">
            {t("chat.empty")}
          </p>
        ) : (
          messages.map((msg) => {
            const mine = msg.senderId === myId;
            return (
              <div
                key={msg.id}
                className={`flex max-w-[85%] flex-col gap-1 ${
                  mine ? "items-end self-end" : "items-start self-start"
                }`}
              >
                <div
                  className={`flex flex-col gap-1.5 rounded-card px-3 py-2 text-sm ${
                    mine
                      ? "rounded-br-[4px] bg-primary text-on-primary"
                      : "rounded-bl-[4px] bg-card-hover text-ink"
                  }`}
                >
                  {msg.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={msg.image}
                      alt={t("chat.attachedImage")}
                      className="max-h-48 rounded-input object-cover"
                    />
                  )}
                  {msg.text && (
                    <span className="whitespace-pre-line break-words">
                      {msg.text}
                    </span>
                  )}
                </div>
                <span className="text-2xs text-faint">
                  {mine ? t("chat.you") : counterpartName.split(" ")[0]} ·{" "}
                  {formatTime(msg.createdAt, lang)}
                </span>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {!isMockMessaging ? (
        <p className="border-t border-line bg-surface p-3 text-center text-2xs text-muted">
          Shaxsiy xabarlar xizmati ushbu relizda o&apos;chirilgan. Taklif shartlari shartnoma orqali kelishiladi.
        </p>
      ) : open ? (
        <form
          onSubmit={handleSend}
          className="flex items-end gap-2 border-t border-line p-3"
        >
          <ChatImageAttach value={draftImage} onChange={setDraftImage} />
          <div className="flex-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              maxLength={5000}
            />
          </div>
          <Button
            type="submit"
            loading={sending}
            disabled={!draft.trim() && !draftImage}
          >
            {t("chat.send")}
          </Button>
        </form>
      ) : (
        <p className="border-t border-line p-3 text-center text-2xs text-faint">
          {t("pchat.closed")}
        </p>
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
