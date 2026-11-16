"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/shared/Logo";
import { LangSwitch } from "@/components/shared/LangSwitch";
import { Avatar } from "@/components/ui/Avatar";
import { authService, usersService } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Session } from "@/lib/types";

export function GuestTopNav() {
  const { t } = useT();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const cur = authService.getSession();
    setSession(cur);
    if (cur) {
      usersService
        .getCurrent()
        .then((u) => {
          if (u) {
            setUserName(u.fullName || u.email || "");
            setAvatarUrl(u.avatarUrl);
          }
        })
        .catch(() => {});
    }
  }, []);

  async function handleLogout() {
    await authService.logout();
    router.push("/kirish");
  }

  const cabinetHref =
    session?.role === "mutaxassis"
      ? session.profileDone
        ? "/mutaxassis"
        : "/mutaxassis/settings/royxat"
      : session?.role === "xaridor"
        ? "/xaridor"
        : "/rol-tanlash";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="workspace-container mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 xl:px-10 2xl:px-14">
        <div className="flex items-center gap-4 sm:gap-6 shrink-0 min-w-0">
          <Logo href="/" className="shrink-0" />
          <nav className="hidden items-center gap-6 md:flex shrink-0">
            <Link
              href="/bozor"
              className="text-[15px] font-medium text-ink transition-colors hover:text-primary whitespace-nowrap shrink-0"
            >
              {t("nav_market") || "Bozor"}
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <LangSwitch />

          {session ? (
            <div className="flex items-center gap-3">
              <Link
                href={cabinetHref}
                className="flex items-center gap-2 rounded-xl border border-line bg-card hover:bg-card-hover px-3 py-1.5 transition-all shadow-sm"
              >
                <Avatar name={userName || "Foydalanuvchi"} src={avatarUrl} size="sm" />
                <span className="hidden sm:inline text-xs font-semibold text-ink max-w-[120px] truncate">
                  {userName || "Kabinetim"}
                </span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs font-medium text-muted hover:text-danger px-2 py-1.5 rounded-lg transition-colors"
                title="Chiqish"
              >
                {t("onboard.logout") || "Chiqish"}
              </button>
            </div>
          ) : (
            <>
              <Link
                href="/kirish"
                className="hidden items-center justify-center rounded-xl border border-line bg-card hover:bg-card-hover px-4 py-2 text-[14px] font-semibold text-ink transition-all sm:flex whitespace-nowrap shrink-0 shadow-sm"
              >
                {t("nav_login") || "Kirish"}
              </Link>
              <Link
                href="/rol-tanlash"
                className="flex items-center justify-center rounded-xl bg-primary hover:bg-primary-hover px-4 py-2 text-[14px] font-semibold text-primary-contrast transition-all shadow-sm active:scale-[0.99] whitespace-nowrap shrink-0"
              >
                {t("nav_register") || "Ro'yxatdan o'tish"}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
