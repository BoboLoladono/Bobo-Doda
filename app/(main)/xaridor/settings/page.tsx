"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { LocationPicker } from "@/components/ui/LocationPicker";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CardManager } from "@/components/shared/cards";
import { AccountSecurity } from "@/components/shared/AccountSecurity";
import { authService, paymentsService, usersService } from "@/lib/api";
import { processAvatarImage } from "@/lib/avatar-image";
import type { AccountPreferences, PaymentCard, User } from "@/lib/types";
import { useT, type Lang } from "@/lib/i18n";
import { initials } from "@/lib/format";

type SettingsTab =
  | "profile"
  | "billing"
  | "security"
  | "notifications"
  | "preferences"
  | "account";

const DEFAULT_PREFERENCES: AccountPreferences = {
  messages: true,
  contracts: true,
  payments: true,
  marketing: false,
  proposals: true,
};

export default function XaridorSozlamalarPage() {
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Profile form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("it");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [nameError, setNameError] = useState("");

  // Billing state
  const [cards, setCards] = useState<PaymentCard[]>([]);

  // Notifications state
  const [preferences, setPreferences] = useState<AccountPreferences>(DEFAULT_PREFERENCES);
  const [savingPreferences, setSavingPreferences] = useState(false);

  // Preferences (Currency)
  const [currency, setCurrency] = useState<"UZS" | "USD">("UZS");

  // Account state
  const [logoutOpen, setLogoutOpen] = useState(false);

  // General lifecycle
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      usersService.getCurrent(),
      /* Bosqich 17 — real backendda karta boshqaruvi yo'q: butun sahifani
         yiqitmasin deb bo'sh ro'yxatga tushadi (Billing tabi nav'dan olib
         tashlangan, shuning uchun bu ko'rinmas holat). */
      paymentsService.getCards().catch(() => []),
      usersService.getPreferences().catch(() => DEFAULT_PREFERENCES),
    ])
      .then(([user, cardList, prefs]) => {
        if (user) {
          setCurrentUser(user);
          setFullName(user.fullName || "");
          setPhone(user.phone || "");
          setCompanyName(user.companyName || "");
          setIndustry(user.industry || "it");
          setWebsite(user.website || "");
          setLocation(user.location || "");
          setBio(user.bio || "");
          setAvatarUrl(user.avatarUrl || "");
        }
        setCards(cardList || []);
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...prefs,
        });
        setLoading(false);
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  // Support ?tab= query parameter from other pages
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tabParam = new URLSearchParams(window.location.search).get("tab");
    const validTabs: SettingsTab[] = ["profile", "security", "preferences", "account"];
    if (tabParam && validTabs.includes(tabParam as SettingsTab)) {
      setActiveTab(tabParam as SettingsTab);
    }
  }, []);

  // Avatar upload handler with client-side center-crop and compression
  async function handleAvatarChange(files: FileList | null) {
    if (!files || !files[0]) return;
    setAvatarError("");
    try {
      const processed = await processAvatarImage(files[0], 320);
      setAvatarUrl(processed);
      await usersService.updateAvatar(processed);
      setCurrentUser((prev) => (prev ? { ...prev, avatarUrl: processed } : null));
      toast(t("bset.savedSuccess"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("upload.rejected");
      setAvatarError(msg);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAvatarRemove() {
    setAvatarError("");
    try {
      setAvatarUrl("");
      await usersService.updateAvatar("");
      setCurrentUser((prev) => (prev ? { ...prev, avatarUrl: undefined } : null));
      toast(t("bset.savedSuccess"));
    } catch {
      toast(t("common.error"), "error");
    }
  }

  // Profile save
  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setNameError(t("onboard.errName"));
      return;
    }
    setSavingProfile(true);
    try {
      await usersService.updateUserProfile({
        fullName: fullName.trim(),
        companyName: companyName.trim(),
        industry,
        website: website.trim(),
        location: location.trim(),
        bio: bio.trim(),
        avatarUrl,
      });
      setCurrentUser((prev) =>
        prev
          ? {
              ...prev,
              fullName: fullName.trim(),
              companyName: companyName.trim(),
              industry,
              website: website.trim(),
              location: location.trim(),
              bio: bio.trim(),
              avatarUrl,
            }
          : null
      );
      toast(t("bset.savedSuccess"));
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSavingProfile(false);
    }
  }

  // Save Notifications
  async function handleSaveNotifications() {
    setSavingPreferences(true);
    try {
      await usersService.savePreferences(preferences);
      toast(t("bset.savedSuccess"));
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSavingPreferences(false);
    }
  }

  async function handleLogout() {
    await authService.logout();
    router.push("/kirish");
  }

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;
  if (loading) return <SkeletonCard />;

  const industryOptions = [
    { value: "it", label: "IT & Dasturlash (Web, Mobile, AI)" },
    { value: "design", label: "Dizayn & Media (UI/UX, Grafik, 3D)" },
    { value: "marketing", label: "Marketing, SMM & Reklama" },
    { value: "education", label: "Ta'lim, Kurslar & Ilm-fan" },
    { value: "ecommerce", label: "E-tijorat & Chakana savdo" },
    { value: "services", label: "Xizmatlar & Ishlab chiqarish" },
    { value: "finance", label: "Moliya, Huquq & Konsalting" },
    { value: "other", label: "Boshqa faoliyat sohasi" },
  ];

  const navTabs: {
    id: SettingsTab;
    label: string;
    description: string;
    icon: string;
    badge?: number | string;
  }[] = [
    {
      id: "profile",
      label: t("bset.tabProfile"),
      description: "Kompaniya va shaxsiy ma'lumotlar",
      icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    },
    {
      id: "security",
      label: t("bset.tabSecurity"),
      description: "Hisob va tasdiqlash",
      icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    },
    {
      id: "preferences",
      label: t("bset.tabPreferences"),
      description: "Interfeys tili va valyuta",
      icon: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
    },
    {
      id: "account",
      label: t("bset.tabAccount"),
      description: "Ma'lumotlar eksporti va chiqish",
      icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
    },
  ];

  return (
    <div className="flex flex-col gap-6 pb-16">
      <div className="flex items-center justify-between">
        <BackButton href="/xaridor" label={t("nav.dashboard")} />
      </div>
      {/* Top Header Card with Quick Stats & Badges */}
      <div className="rounded-2xl border border-line/60 bg-gradient-to-r from-card via-card to-surface p-5 sm:p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-primary/20 bg-primary/5 text-primary-deep shadow-sm">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={companyName || fullName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="font-heading text-xl font-black">
                  {initials(companyName || fullName || "IB")}
                </span>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-heading text-xl font-extrabold text-ink sm:text-2xl">
                  {companyName || fullName || t("settings.title")}
                </h1>
                {currentUser?.verified && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 border border-emerald-500/20">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M13.5 4.5l-7 7L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t("bset.verifiedEmployer")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted sm:text-sm">
                {fullName} {phone ? `· ${phone}` : ""}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Mobile Horizontal Navigation Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none lg:hidden">
        {navTabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2 rounded-btn px-4 py-2.5 text-xs font-medium transition-all ${
                active
                  ? "bg-primary text-on-primary shadow-sm ring-2 ring-primary/30"
                  : "border border-line bg-card text-muted hover:text-ink"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={tab.icon} />
              </svg>
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    active ? "bg-white/20 text-on-primary" : "bg-primary/10 text-primary-deep"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid items-start gap-8 lg:grid-cols-[280px_1fr] xl:grid-cols-[300px_1fr]">
        {/* Left Sidebar Column */}
        <aside className="hidden flex-col gap-5 lg:sticky lg:top-24 lg:flex">
          {/* Navigation Links */}
          <nav className="flex flex-col gap-1.5 rounded-2xl border border-line/70 bg-card p-2 shadow-card" aria-label="Sozlamalar bo'limlari">
            {navTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`group flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition-all ${
                    active
                      ? "bg-primary text-on-primary shadow-sm"
                      : "text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                        active ? "text-on-primary" : "text-muted group-hover:text-ink"
                      }`}
                      aria-hidden="true"
                    >
                      <path d={tab.icon} />
                    </svg>
                    <div className="truncate">
                      <p className="text-sm font-semibold leading-snug">{tab.label}</p>
                      <p
                        className={`truncate text-2xs ${
                          active ? "text-white/80" : "text-faint"
                        }`}
                      >
                        {tab.description}
                      </p>
                    </div>
                  </div>

                  {tab.badge && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${
                        active
                          ? "bg-white/25 text-on-primary"
                          : "bg-primary/10 text-primary-deep"
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Escrow Guarantee Highlight Widget */}
          <Card padding="md" className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 to-emerald-500/10">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                  Escrow Kafolati
                </h3>
                <p className="mt-1 text-2xs leading-relaxed text-muted">
                  Barcha mablag&apos;lar Escrow tizimida xavfsiz saqlanadi. Ish qabul qilinmaguncha to&apos;lov chiqarilmaydi.
                </p>
              </div>
            </div>
          </Card>

          {/* Verification Widget */}
          {!currentUser?.verified && (
            <Card padding="md" className="border-amber-500/25 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-amber-900">
                    Ishonch nishonini oling
                  </h3>
                  <p className="mt-1 text-2xs text-muted">
                    Kompaniyangizni tasdiqlang va mutaxassislardan 3 barobar ko&apos;p taklif oling.
                  </p>
                  <Link
                    href="/xaridor/verifikatsiya"
                    className="mt-2.5 inline-flex items-center gap-1 text-2xs font-semibold text-amber-700 hover:text-amber-800"
                  >
                    Hozir tasdiqlash →
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </aside>

        {/* Right Content Column */}
        <main className="min-w-0 flex flex-col gap-6">
          {/* TAB 1: COMPANY & PROFILE */}
          {activeTab === "profile" && (
            <Card padding="lg">
              <div className="border-b border-line/60 pb-4 mb-6">
                <h2 className="font-heading text-lg font-bold text-ink">
                  {t("bset.profileSection")}
                </h2>
                <p className="text-xs text-muted mt-1">
                  {t("bset.profileHint")}
                </p>
              </div>

              <form onSubmit={handleSaveProfile} className="flex flex-col gap-6" noValidate>
                {/* Logo / Avatar Upload section */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-4 rounded-xl border border-line/70 bg-surface/50">
                  <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-line bg-card shadow-sm">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarUrl}
                        alt={companyName || fullName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-heading text-2xl font-black text-primary-deep">
                        {initials(companyName || fullName || "K")}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-ink">
                      {t("bset.avatarUpload")}
                    </label>
                    <p className="text-2xs text-muted">
                      {t("bset.avatarHint")}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t("bset.changeAvatar")}
                      </Button>
                      {avatarUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={handleAvatarRemove}
                        >
                          {t("bset.removeAvatar")}
                        </Button>
                      )}
                    </div>
                    {avatarError && (
                      <p className="text-2xs text-danger mt-1" role="alert">
                        {avatarError}
                      </p>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(e) => handleAvatarChange(e.target.files)}
                    />
                  </div>
                </div>

                {/* Form fields grid */}
                <div className="grid gap-5 sm:grid-cols-2">
                  <Input
                    label={t("bset.companyName")}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={t("bset.companyNamePh")}
                  />

                  <Select
                    label={t("bset.industry")}
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    options={industryOptions}
                  />

                  <Input
                    label={t("bset.representative")}
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      setNameError("");
                    }}
                    error={nameError}
                    required
                  />

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted">
                      {t("bset.phoneVerified")}
                    </label>
                    <div className="relative">
                      <Input
                        value={phone}
                        disabled
                        readOnly
                        className="bg-surface/70 cursor-not-allowed pl-9 font-mono text-xs"
                      />
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                        aria-hidden="true"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                  </div>

                  <Input
                    label={t("bset.website")}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://company.uz yoki @username"
                  />

                  <LocationPicker
                    label={t("bset.location")}
                    value={location}
                    onChange={setLocation}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Textarea
                    label={t("bset.bio")}
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, 500))}
                    placeholder={t("bset.bioPh")}
                    rows={4}
                  />
                  <div className="flex justify-between text-2xs text-faint">
                    <span>Mutaxassislar e&apos;loningizga taklif yuborayotganda ko&apos;rishadi</span>
                    <span>{bio.length}/500</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-line/60">
                  <Button type="submit" loading={savingProfile} className="px-8">
                    {t("common.save")}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {/* TAB 2: BILLING & FINANCES */}
          {activeTab === "billing" && (
            <div className="flex flex-col gap-6">
              {/* Escrow Guarantee Banner */}
              <div className="relative overflow-hidden rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-card">
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-2xs font-bold uppercase tracking-wide text-primary-deep">
                      {t("bset.escrowSecurityTitle")}
                    </span>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {t("bset.escrowSecurityDesc")}
                    </p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3 pt-4 border-t border-line/60">
                      <div className="flex items-center gap-2 text-xs font-medium text-ink">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">✓</span>
                        Bosqichma-bosqich to&apos;lov
                      </div>
                      <div className="flex items-center gap-2 text-xs font-medium text-ink">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">✓</span>
                        100% qaytarish kafolati
                      </div>
                      <div className="flex items-center gap-2 text-xs font-medium text-ink">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">✓</span>
                        Rasmiy invoys va cheklar
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cards Management */}
              <Card padding="lg">
                <div className="border-b border-line/60 pb-4 mb-6">
                  <h2 className="font-heading text-lg font-bold text-ink">
                    {t("bset.billingSection")}
                  </h2>
                  <p className="text-xs text-muted mt-1">
                    {t("bset.billingHint")}
                  </p>
                </div>

                <CardManager cards={cards} onChange={setCards} />
              </Card>

              {/* Invoices and Expense history link */}
              <Card padding="lg" className="bg-surface/40">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-heading text-base font-bold text-ink">
                      {t("bset.viewInvoices")}
                    </h3>
                    <p className="text-xs text-muted mt-1">
                      Barcha to&apos;langan shartnomalar, depozitlar va yuklab olinadigan invoyslar tarixi.
                    </p>
                  </div>
                  <Link
                    href="/xaridor/billing"
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-btn bg-primary px-5 text-xs font-medium text-on-primary shadow-btn hover:bg-primary-hover transition-colors"
                  >
                    <span>Invoyslarni ko&apos;rish</span>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              </Card>
            </div>
          )}

          {/* TAB 3: SECURITY & LOGINS */}
          {activeTab === "security" && (
            <div className="flex flex-col gap-6">
              {/* Identity & Verification Card */}
              <Card padding="lg">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary-deep">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-heading text-base font-bold text-ink">
                          {t("nav.verification")}
                        </h3>
                        {currentUser?.verified ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-2xs font-semibold text-emerald-700">
                            Tasdiqlangan
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-semibold text-amber-800">
                            Tasdiqlanmagan
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted max-w-lg">
                        {t("bset.verificationHint")}
                      </p>
                    </div>
                  </div>

                  <Link
                    href="/xaridor/verifikatsiya"
                    className="inline-flex h-9 shrink-0 items-center rounded-btn border border-line bg-card px-4 text-xs font-medium text-ink shadow-card transition-colors hover:border-primary hover:bg-card-hover"
                  >
                    {t("bset.verificationOpen")}
                  </Link>
                </div>
              </Card>

              {/* Password Change */}
              <AccountSecurity />
            </div>
          )}

          {/* TAB 4: NOTIFICATIONS */}
          {activeTab === "notifications" && (
            <Card padding="lg">
              <div className="border-b border-line/60 pb-4 mb-6">
                <h2 className="font-heading text-lg font-bold text-ink">
                  {t("bset.notifSection")}
                </h2>
                <p className="text-xs text-muted mt-1">
                  {t("bset.notifHint")}
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="p-3.5 rounded-xl border border-line/70 bg-card hover:bg-surface/50 transition-colors">
                  <Checkbox
                    id="ntf-proposals"
                    label={t("bset.ntfProposals")}
                    checked={preferences.proposals ?? true}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, proposals: e.target.checked }))
                    }
                  />
                  <p className="ml-6 mt-1 text-2xs text-muted">
                    E&apos;loningizga yangi frilanser taklif yuborganda bir zumda xabar olasiz.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-line/70 bg-card hover:bg-surface/50 transition-colors">
                  <Checkbox
                    id="ntf-milestones"
                    label={t("bset.ntfMilestones")}
                    checked={preferences.contracts}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, contracts: e.target.checked }))
                    }
                  />
                  <p className="ml-6 mt-1 text-2xs text-muted">
                    Mutaxassis ish topshirganda yoki bosqichni tekshiruvga yuborganda bildirishnoma keladi.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-line/70 bg-card hover:bg-surface/50 transition-colors">
                  <Checkbox
                    id="ntf-messages"
                    label={t("bset.ntfMessages")}
                    checked={preferences.messages}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, messages: e.target.checked }))
                    }
                  />
                  <p className="ml-6 mt-1 text-2xs text-muted">
                    Frilanserlar va xizmat ko&apos;rsatuvchilar tomonidan yuborilgan yangi chat xabarlari.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-line/70 bg-card hover:bg-surface/50 transition-colors">
                  <Checkbox
                    id="ntf-payments"
                    label={t("bset.ntfPayments")}
                    checked={preferences.payments}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, payments: e.target.checked }))
                    }
                  />
                  <p className="ml-6 mt-1 text-2xs text-muted">
                    Escrow to&apos;lov muzlatilishi, mablag&apos; yechilishi va cheklar haqida ogohlantirishlar.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-line/70 bg-card hover:bg-surface/50 transition-colors">
                  <Checkbox
                    id="ntf-marketing"
                    label={t("bset.ntfMarketing")}
                    checked={preferences.marketing}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, marketing: e.target.checked }))
                    }
                  />
                  <p className="ml-6 mt-1 text-2xs text-muted">
                    Bobololadono platformasidagi yangiliklar, chegirmalar va tavsiyalar.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end border-t border-line/60 pt-4">
                <Button
                  onClick={handleSaveNotifications}
                  loading={savingPreferences}
                  className="px-8"
                >
                  {t("common.save")}
                </Button>
              </div>
            </Card>
          )}

          {/* TAB 5: PREFERENCES (LANG & CURRENCY) */}
          {activeTab === "preferences" && (
            <div className="flex flex-col gap-6">
              {/* Interface Language */}
              <Card padding="lg">
                <div className="border-b border-line/60 pb-4 mb-6">
                  <h2 className="font-heading text-lg font-bold text-ink">
                    {t("settings.langSection")}
                  </h2>
                  <p className="text-xs text-muted mt-1">
                    {t("bset.prefsHint")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { id: "uz", name: "O'zbekcha", desc: "Lotin yozuvida" },
                    { id: "ru", name: "Русский", desc: "На русском языке" },
                    { id: "en", name: "English", desc: "International English" },
                  ].map((item) => {
                    const isSelected = lang === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setLang(item.id as Lang)}
                        className={`flex flex-col items-start p-4 rounded-xl border-2 text-left transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-line/70 bg-card hover:border-line hover:bg-surface"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="font-heading text-sm font-bold text-ink">
                            {item.name}
                          </span>
                          {isSelected && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-on-primary text-2xs">
                              ✓
                            </span>
                          )}
                        </div>
                        <span className="text-2xs text-muted mt-1">{item.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              {/* Currency Display */}
              <Card padding="lg">
                <div className="border-b border-line/60 pb-4 mb-6">
                  <h2 className="font-heading text-lg font-bold text-ink">
                    {t("bset.currencySection")}
                  </h2>
                  <p className="text-xs text-muted mt-1">
                    {t("bset.currencyHint")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 max-w-lg">
                  <button
                    type="button"
                    onClick={() => setCurrency("UZS")}
                    className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                      currency === "UZS"
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-line/70 bg-card hover:border-line"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-primary-deep bg-primary/10 px-2 py-1 rounded">
                        UZS
                      </span>
                      <div className="text-left">
                        <p className="text-xs font-semibold text-ink">O&apos;zbekiston so&apos;mi</p>
                        <p className="text-2xs text-muted">Asosiy milliy valyuta</p>
                      </div>
                    </div>
                    {currency === "UZS" && <span className="text-primary font-bold">✓</span>}
                  </button>

                  <button
                    type="button"
                    onClick={() => setCurrency("USD")}
                    className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                      currency === "USD"
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-line/70 bg-card hover:border-line"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-primary-deep bg-primary/10 px-2 py-1 rounded">
                        USD
                      </span>
                      <div className="text-left">
                        <p className="text-xs font-semibold text-ink">AQSH Dollari ($)</p>
                        <p className="text-2xs text-muted">Xalqaro hisob-kitoblar</p>
                      </div>
                    </div>
                    {currency === "USD" && <span className="text-primary font-bold">✓</span>}
                  </button>
                </div>
              </Card>
            </div>
          )}

          {/* TAB 6: ACCOUNT MANAGEMENT */}
          {activeTab === "account" && (
            <div className="flex flex-col gap-6">
              {/* Logout Card */}
              <Card padding="lg">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="font-heading text-base font-bold text-ink">
                      {t("settings.logoutTitle")}
                    </h2>
                    <p className="text-xs text-muted mt-1">
                      {t("bset.dangerZoneHint")}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setLogoutOpen(true)}
                    className="shrink-0 text-danger hover:bg-danger/10 hover:text-danger hover:border-danger/30"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    {t("common.logout")}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>

      {/* Logout Confirmation Dialog */}
      <ConfirmDialog
        open={logoutOpen}
        title={t("settings.logoutTitle")}
        description={t("settings.logoutDesc")}
        confirmLabel={t("common.logout")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />
    </div>
  );
}
