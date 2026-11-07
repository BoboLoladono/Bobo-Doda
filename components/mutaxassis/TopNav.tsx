"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/shared/Logo";
import { Avatar } from "@/components/ui/Avatar";
import { LangSwitch } from "@/components/shared/LangSwitch";
import { authService, usersService, DATA_CHANGED_EVENT } from "@/lib/api";
import { useT } from "@/lib/i18n";

export interface TopNavProps {
  base: string;
}

export function TopNav({ base }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useT();
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await authService.logout();
    router.push("/kirish");
  }

  useEffect(() => {
    function refresh() {
      usersService.getCurrent().then((user) => {
        if (user) {
          setName(user.fullName);
          setAvatarUrl(user.avatarUrl);
        }
      }).catch(() => {});
    }
    refresh();
    window.addEventListener(DATA_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const navLinks = [
    { href: "/mutaxassis", label: t("nav.dashboard") },
    { href: "/mutaxassis/applications", label: t("nav.applications") },
    { href: "/bozor?tab=jobs", label: t("nav.market"), matchPrefix: "/bozor" },
    { href: "/mutaxassis/contracts", label: t("nav.contracts") },
    { href: "/mutaxassis/messages", label: t("nav.messages") },
    { href: "/mutaxassis/billing", label: t("nav.billing") },
    { href: "/mutaxassis/services", label: t("nav.services") },
    { href: "/mutaxassis/disputes", label: t("nav.disputes") },
    { href: "/mutaxassis/settings", label: t("nav.settings") },
  ];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-line bg-surface/95 backdrop-blur">
      <div className="workspace-container mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 xl:px-10 2xl:px-14">
        <div className="flex items-center gap-3 xl:gap-4 2xl:gap-6 shrink-0 min-w-0">
          <Logo href={base} className="shrink-0" />

          {/* Desktop Nav */}
          <nav className="hidden xl:flex items-center gap-0.5 2xl:gap-1 shrink-0">
            {navLinks.map((link) => {
              const check = link.matchPrefix || link.href;
              const isActive = check === "/mutaxassis" ? pathname === "/mutaxassis" : pathname.startsWith(check);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2 2xl:px-3 py-1.5 2xl:py-2 rounded-btn text-xs 2xl:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? "bg-primary/10 text-primary-deep font-semibold"
                      : "text-muted hover:bg-card-hover hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 xl:gap-3 shrink-0">
          <Link
            href="/mutaxassis/services/yangi"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-btn bg-primary/10 text-primary-deep hover:bg-primary hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {(t("dash.newService") || "Yangi xizmat").replace(/^\+\s*/, "")}
          </Link>

          <LangSwitch />

          {/* Mobile/Tablet menu button */}
          <button
            type="button"
            className="xl:hidden p-2 text-muted hover:text-ink shrink-0"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? t("a11y.closeMenu") : t("a11y.openMenu")}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <div className="hidden sm:flex items-center gap-2 xl:gap-3 shrink-0">
            <Link
              href="/mutaxassis/settings"
              aria-label={t("nav.settings")}
              className="rounded-full shrink-0"
            >
              <Avatar name={name || "?"} src={avatarUrl} size="sm" />
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs font-medium text-muted hover:text-danger whitespace-nowrap shrink-0"
            >
              {t("common.logout")}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {menuOpen && (
        <div
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label={t("a11y.openMenu")}
          className="border-t border-line bg-surface px-4 py-3 xl:hidden"
        >
          <nav className="flex flex-col gap-2">
            <Link
              href="/mutaxassis/services/yangi"
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-btn text-sm font-semibold bg-primary text-white hover:bg-primary-deep shadow-sm mb-1"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {(t("dash.newService") || "Yangi xizmat").replace(/^\+\s*/, "")}
            </Link>

            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2 rounded-btn text-sm font-medium text-ink hover:bg-card-hover"
              >
                {link.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={handleLogout}
              className="block w-full text-left px-3 py-2 rounded-btn text-sm font-medium text-danger hover:bg-card-hover"
            >
              {t("common.logout")}
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
