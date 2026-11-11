"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import {
  ContractStatusBadge,
  OfferStatusBadge,
} from "@/components/shared/StatusBadge";
import { authService, contractsService, messagesService, offersService } from "@/lib/api";
import type { Message } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";

/* Suhbat shartnoma yoki kelgan taklif (Offer) chatidan bo'lishi mumkin */
interface Thread {
  id: string;
  href: string;
  name: string;
  title: string;
  last: Message;
  badge: ReactNode;
  unread: boolean;
}

export default function XabarlarPage() {
  const { t, lang } = useT();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const myId = authService.getSession()?.userId ?? null;

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      messagesService.listMine(),
      contractsService.list(),
      offersService.listIncoming(),
      messagesService.getReadStatus(),
    ])
      .then(async ([messages, contracts, offers, reads]) => {
        const list: Thread[] = [];
        const isUnread = (threadId: string, last: Message) =>
          last.senderId !== myId &&
          (!reads[threadId] || last.createdAt > reads[threadId]);

        /* Shartnoma suhbatlari — xabar bo'lmasa ham shartnoma suhbat ro'yxatida ko'rinadi */
        const byContract = new Map<string, Message>();
        for (const msg of messages) {
          const current = byContract.get(msg.contractId);
          if (!current || msg.createdAt > current.createdAt) {
            byContract.set(msg.contractId, msg);
          }
        }
        for (const contract of contracts) {
          const lastMsg = byContract.get(contract.id);
          const last: Message = lastMsg || {
            id: `init_${contract.id}`,
            contractId: contract.id,
            senderId: "",
            text: t("chat.noMessages") || "Hali xabarlar yo'q",
            createdAt: contract.createdAt,
          };
          list.push({
            id: contract.id,
            href: `/mutaxassis/contracts/${contract.id}`,
            name: contract.buyerName,
            title: contract.title,
            last,
            badge: <ContractStatusBadge status={contract.status} />,
            unread: lastMsg ? isUnread(contract.id, lastMsg) : false,
          });
        }

        /* Kelgan taklif suhbatlari (qabul qilinganlari shartnomaga ko'chgan) */
        const openOffers = offers.filter((o) => o.status === "yuborilgan");
        /* `allSettled` — bitta taklif suhbati yuklanmasa BUTUN inbox
           xatoga o'tib ketmasin (ilgari `all` bilan shunday bo'lardi). */
        const offerThreads = await Promise.allSettled(
          openOffers.map((o) => messagesService.list(o.id))
        );
        openOffers.forEach((offer, i) => {
          const settled = offerThreads[i];
          if (settled.status !== "fulfilled") return;
          const msgs = settled.value;
          if (msgs.length === 0) return;
          const last = msgs[msgs.length - 1];
          list.push({
            id: offer.id,
            href: `/mutaxassis/applications/kelgan/${offer.id}`,
            name: offer.buyerName,
            title: offer.title,
            last,
            badge: <OfferStatusBadge status={offer.status} />,
            unread: isUnread(offer.id, last),
          });
        });

        list.sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt));
        setThreads(list);
      })
      /* Yuklash xatosi bo'sh ro'yxat EMAS — alohida holat ko'rsatiladi */
      .catch(setLoadError);
  }, [myId, t]);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-extrabold text-ink">
        {t("messages.title")}
      </h1>

      {loadError ? (
        <ErrorState error={loadError} onRetry={load} />
      ) : !threads ? (
        <SkeletonCard />
      ) : threads.length === 0 ? (
        <EmptyState
          title={t("messages.empty")}
          description="Sizda hali xabarlar yo'q. E'lonlarga ariza yuborsangiz yoki buyurtma olsangiz, mijozlar bilan muloqot shu yerda bo'ladi."
          action={
            <Link href="/bozor?tab=jobs">
              <Button size="sm">Ochiq ishlarni ko'rish</Button>
            </Link>
          }
        />
      ) : (
        <Card padding="none">
          {threads.map((thread, i) => {
            const mine = thread.last.senderId === myId;
            return (
              <Link
                key={thread.id}
                href={thread.href}
                className={`flex items-center gap-3 p-4 transition-colors duration-150 hover:bg-card-hover ${
                  i > 0 ? "border-t border-line" : ""
                } ${thread.unread ? "bg-primary/5" : ""}`}
              >
                <span className="relative shrink-0">
                  <Avatar name={thread.name} />
                  {thread.unread && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-bg"
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p
                      className={`truncate text-sm ${thread.unread ? "font-bold text-ink" : "font-medium text-ink"}`}
                    >
                      {thread.name}
                      <span className="ml-2 hidden text-2xs font-normal text-faint sm:inline">
                        {thread.title}
                      </span>
                    </p>
                    <span className="shrink-0 text-2xs text-faint">
                      {formatDate(thread.last.createdAt, lang)}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 truncate text-xs ${thread.unread ? "font-medium text-ink" : "text-muted"}`}
                  >
                    {mine && <span className="text-faint">{t("chat.you")}: </span>}
                    {/* Faqat fayl biriktirilgan xabar ham ko'rinsin — ilgari
                        matnsiz fayl xabari inbox'da BO'SH qator bo'lib
                        qolardi va foydalanuvchi nima kelganini bilmasdi. */}
                    {thread.last.text ||
                      (thread.last.image
                        ? t("chat.imagePreview")
                        : thread.last.files?.length
                          ? `📎 ${t("chat.fileFrom")}`
                          : "")}
                  </p>
                </div>
                {thread.badge}
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
