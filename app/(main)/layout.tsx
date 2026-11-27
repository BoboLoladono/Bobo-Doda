"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { TopNav as XaridorTopNav } from "@/components/xaridor/TopNav";
import { TopNav as MutaxassisTopNav } from "@/components/mutaxassis/TopNav";
import { GuestTopNav } from "@/components/shared/GuestTopNav";
import { CabinetFooter } from "@/components/shared/CabinetFooter";
import { SkipLink } from "@/components/shared/SkipLink";
import { authService } from "@/lib/api";
import { hasAccessToken } from "@/lib/api/http";

export default function MainLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function check() {
      const isMutaxassisRoute = pathname.startsWith("/mutaxassis");
      const isXaridorRoute = pathname.startsWith("/xaridor");
      const isProtectedRoute = isMutaxassisRoute || isXaridorRoute;

      let session = authService.getSession();
      if (!session || (isProtectedRoute && !hasAccessToken())) {
        session = await authService.refresh();
        if (!active) return;
      }

      setUserRole(session?.role || null);

      if (session) {
        // Enforce role-based boundaries
        if (session.role === "mutaxassis" && isXaridorRoute) {
          router.replace("/mutaxassis");
          return;
        }
        if (session.role === "xaridor" && isMutaxassisRoute) {
          router.replace("/xaridor");
          return;
        }
        
        // Enforce onboarding boundary for mutaxassis (faqat mutaxassis ichki yo'llari uchun)
        const isOnboarding = pathname === "/mutaxassis/settings/royxat";
        if (session.role === "mutaxassis" && !session.profileDone && !isOnboarding && isMutaxassisRoute) {
          router.replace("/mutaxassis/settings/royxat");
          return;
        }
      } else {
        // Guest attempting to access protected routes
        if (isMutaxassisRoute || isXaridorRoute) {
          router.replace("/kirish");
          return;
        }
      }

      setReady(true);
    }

    void check();

    return () => {
      active = false;
    };
  }, [router, pathname]);

  if (!ready) return null;

  const isSpecialist = userRole === "mutaxassis";
  const isBuyer = userRole === "xaridor";
  const isOnboarding = pathname === "/mutaxassis/settings/royxat";

  if (isOnboarding) {
    return (
      <div className="flex min-h-screen flex-col bg-bg">
        <GuestTopNav />
        <main className="flex flex-1 justify-center px-4 py-8">
          <div className="w-full max-w-lg">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <SkipLink />
      {isSpecialist ? (
        <MutaxassisTopNav base="/mutaxassis" />
      ) : isBuyer ? (
        <XaridorTopNav base="/xaridor" />
      ) : (
        <GuestTopNav />
      )}
      <main
        id="main-content"
        tabIndex={-1}
        className="workspace-container flex-1 px-4 py-6 focus:outline-none sm:px-6 sm:py-8 xl:px-10 2xl:px-14"
      >
        {children}
      </main>
      <CabinetFooter />
    </div>
  );
}
