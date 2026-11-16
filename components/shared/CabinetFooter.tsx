"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

/* Kabinet ichidagi ixcham pastki qism. Ilgari huquqiy sahifalar
   (shartlar/maxfiylik/oferta) va Yordam markazi FAQAT landing footer'idan
   havola qilingan edi — kabinetga kirgan foydalanuvchi ularga umuman
   chiqa olmasdi. */
const LINKS = [
  { href: "/shartlar", key: "foot.terms" },
  { href: "/maxfiylik", key: "foot.privacy" },
  { href: "/oferta", key: "foot.offer" },
  { href: "/yordam-markazi", key: "foot.help" },
  { href: "/savol-javob", key: "foot.faq" },
];

export function CabinetFooter() {
  const { t } = useT();
  return (
    <footer className="mt-14 border-t border-line bg-surface/30 px-4 py-6 sm:px-6 xl:px-10 2xl:px-14">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-xs text-muted">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Bobololadono" className="h-6 w-auto object-contain shrink-0" />
          <span className="font-heading font-extrabold text-ink tracking-tight text-sm">Bobololadono</span>
          <span className="text-faint hidden sm:inline">•</span>
          <span className="text-2xs text-muted hidden sm:inline">100% Escrow Kafolati</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-2xs text-muted transition-colors duration-150 hover:text-primary hover:underline"
            >
              {t(link.key)}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("bobololadono:open-feedback"));
              }
            }}
            className="text-2xs text-muted transition-colors duration-150 hover:text-primary hover:underline cursor-pointer"
          >
            {t("foot.feedback")}
          </button>
          <span className="text-2xs text-faint">
            © {new Date().getFullYear()} Bobololadono
          </span>
        </nav>
      </div>
    </footer>
  );
}
