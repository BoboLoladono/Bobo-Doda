import type { Metadata, Viewport } from "next";
import "@fontsource/onest/400.css";
import "@fontsource/onest/500.css";
import "@fontsource/onest/700.css";
import "@fontsource/unbounded/700.css";
import "@fontsource/unbounded/800.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { LanguageProvider, type Lang } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/Toast";
import { OfflineSupport } from "@/components/shared/OfflineSupport";
import { SupportModalProvider } from "@/components/shared/SupportModalProvider";
import { PageFeedbackWidget } from "@/components/shared/PageFeedbackWidget";
import { InactivityTimeout } from "@/components/shared/InactivityTimeout";

const SITE_URL = "https://bobololadono.uz";
const TITLE = "Bobololadono — Mutaxassislar bozori";
const DESCRIPTION =
  "Markaziy Osiyo mutaxassislari uchun to'lov kafolati bilan ishlaydigan onlayn bozor";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bobololadono",
  },
  alternates: { canonical: "/" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Bobololadono",
    locale: "uz_UZ",
    type: "website",
    images: [{ url: "/logo.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#FF7A1A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const headerList = await headers();
  const headerLang = headerList.get("x-lang");
  const cookieLang = cookieStore.get("sb_lang")?.value;
  const initialLang: Lang =
    headerLang === "ru" || headerLang === "en"
      ? (headerLang as Lang)
      : cookieLang === "ru" || cookieLang === "en"
      ? (cookieLang as Lang)
      : "uz";

  return (
    <html lang={initialLang} suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <LanguageProvider initialLang={initialLang}>
          <ToastProvider>
            <SupportModalProvider>
              <OfflineSupport />
              <InactivityTimeout />
              {children}
              <PageFeedbackWidget />
            </SupportModalProvider>
          </ToastProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
