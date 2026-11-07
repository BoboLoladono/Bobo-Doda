"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/ui/BackButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { FileUpload } from "@/components/ui/FileUpload";
import { Input } from "@/components/ui/Input";
import { LocationPicker } from "@/components/ui/LocationPicker";
import { Modal } from "@/components/ui/Modal";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { TagInput } from "@/components/ui/TagInput";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { Checkbox } from "@/components/ui/Checkbox";
import { CardManager } from "@/components/shared/cards";
import { AccountControls } from "@/components/shared/AccountControls";
import { AccountSecurity } from "@/components/shared/AccountSecurity";
import { CATEGORIES } from "@/lib/category-fields";
import { authService, paymentsService, servicesService, usersService } from "@/lib/api";
import { processAvatarImage } from "@/lib/avatar-image";
import { initials } from "@/lib/format";
import type {
  AccountPreferences,
  LanguageLevel,
  PaymentCard,
  PortfolioItem,
  ProfileLanguage,
  Service,
  ServiceCategory,
  User,
} from "@/lib/types";
import { useT, type Lang } from "@/lib/i18n";
import { LIMITS } from "@/lib/validate";
import {
  completenessItems,
  completenessPercent,
} from "@/lib/profile-completeness";

const LEVELS: LanguageLevel[] = ["native", "fluent", "intermediate", "basic"];

type SettingsTab =
  | "profile"
  | "languages"
  | "portfolio"
  | "availability"
  | "payments"
  | "security"
  | "notifications"
  | "privacy"
  | "account";

export default function SozlamalarPage() {
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  /* Oxirgi SAQLANGAN profil qiymatlari. Til/portfolio avtosaqlanganda
     tahrirlangan, lekin hali tasdiqlanmagan (va "Saqlash" bosilmagan)
     profil maydonlari yon ta'sir sifatida yozilib ketmasligi uchun. */
  const [persisted, setPersisted] = useState({
    fullName: "",
    headline: "",
    bio: "",
    location: "",
  });
  const [location, setLocation] = useState("");
  const [languages, setLanguages] = useState<ProfileLanguage[]>([]);
  const [newLangName, setNewLangName] = useState("");
  const [newLangLevel, setNewLangLevel] = useState<LanguageLevel>("native");
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [activeServices, setActiveServices] = useState<Service[]>([]);
  const [cards, setCards] = useState<PaymentCard[]>([]);
  const [available, setAvailable] = useState(true);

  /* Portfolio modal */
  const [pfOpen, setPfOpen] = useState(false);
  const [pfTitle, setPfTitle] = useState("");
  const [pfDesc, setPfDesc] = useState("");
  const [pfImage, setPfImage] = useState<string[]>([]);
  const [pfCategory, setPfCategory] = useState<ServiceCategory>(CATEGORIES[0]);
  const [pfError, setPfError] = useState("");
  const [viewingPfItem, setViewingPfItem] = useState<PortfolioItem | null>(null);

  /* Validation & states */
  const [errors, setErrors] = useState<{
    fullName?: string;
    bio?: string;
    location?: string;
  }>({});
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);

const DEFAULT_PREFERENCES: AccountPreferences = {
  proposals: true,
  contracts: true,
  messages: true,
  payments: true,
  marketing: false,
};

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<AccountPreferences>(DEFAULT_PREFERENCES);
  const [savingNotif, setSavingNotif] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      usersService.getCurrent(),
      usersService.getSellerProfile(),
      /* Bosqich 17 — real backendda karta/bildirishnoma sozlamalari yo'q:
         butun sahifani yiqitmasin deb bo'sh/standart qiymatga tushadi
         (tegishli tablar nav'dan olib tashlangan, ko'rinmas holat). */
      paymentsService.getCards().catch(() => []),
      servicesService.listMine(),
      usersService.getPreferences().catch(() => null),
    ])
      .then(([user, profile, cardList, services, pref]) => {
        if (user) {
          setCurrentUser(user);
          setFullName(user.fullName);
          setAvatarUrl(user.avatarUrl || profile.avatarUrl || "");
        } else if (profile.avatarUrl) {
          setAvatarUrl(profile.avatarUrl);
        }
        setHeadline(profile.headline || "");
        setBio(profile.bio || "");
        setSkills(profile.skills || []);
        setCategories(profile.categories || []);
        setLocation(profile.location || "");
        setLanguages(profile.languages || []);
        setPortfolio(profile.portfolio || []);
        setAvailable(profile.available ?? true);
        setCards(cardList || []);
        setActiveServices((services || []).filter((s) => s.status === "active"));
        if (pref) setPreferences(pref);
        setPersisted({
          fullName: user?.fullName ?? "",
          headline: profile.headline || "",
          bio: profile.bio || "",
          location: profile.location || "",
        });
        setLoading(false);
      })
      .catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  async function handleSaveNotifications() {
    setSavingNotif(true);
    try {
      await usersService.savePreferences(preferences);
      toast(t("bset.notifSaved") || "Bildirishnoma sozlamalari saqlandi");
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSavingNotif(false);
    }
  }

  /* Boshqaruvdagi "Profilni to'ldirish" havolasi ?tab=... bilan keladi —
     foydalanuvchi kerakli bo'limni qo'lda qidirmasin. (useSearchParams
     o'rniga window: sahifa statik prerender bo'lib qolsin.) */
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    const valid: SettingsTab[] = [
      "profile", "languages", "portfolio", "availability",
      "payments", "security", "notifications", "privacy", "account",
    ];
    if (tab && valid.includes(tab as SettingsTab)) {
      setActiveTab(tab as SettingsTab);
    }
  }, []);

  /* Profil to'liqligi — Boshqaruv bilan bitta manbadan (lib/profile-completeness.ts) */
  const completenessList = completenessItems({
    fullName,
    headline,
    bio,
    skills,
    languagesCount: languages.length,
    location,
    portfolioCount: portfolio.length,
    activeServicesCount: activeServices.length,
  });
  const percent = completenessPercent(completenessList);

  async function handleAvailability(next: boolean) {
    const previous = available;
    setAvailable(next);
    try {
      await usersService.setAvailability(next);
      toast(t("settings.saved"));
    } catch {
      /* Saqlanmagan holat UI'da "saqlangan" bo'lib ko'rinmasin — orqaga qaytaramiz */
      setAvailable(previous);
      toast(t("common.error"), "error");
    }
  }

  function addLanguage() {
    const name = newLangName.trim();
    if (!name) return;
    if (languages.some((l) => l.name.toLowerCase() === name.toLowerCase())) return;
    const updated = [...languages, { name, level: newLangLevel }];
    setLanguages(updated);
    setNewLangName("");
    setNewLangLevel("native");
    saveSellerData({ languages: updated });
  }

  function removeLanguage(name: string) {
    const updated = languages.filter((l) => l.name !== name);
    setLanguages(updated);
    saveSellerData({ languages: updated });
  }

  function openPortfolioModal() {
    setPfTitle("");
    setPfDesc("");
    setPfImage([]);
    setPfCategory(CATEGORIES[0]);
    setPfError("");
    setPfOpen(true);
  }

  function addPortfolioItem() {
    if (!pfTitle.trim() || !pfImage.length) {
      setPfError(t("settings.pfError"));
      return;
    }
    const newItem: PortfolioItem = {
      /* Loyihaning qolgan qismi kabi taxmin qilinmaydigan id — `Date.now()`
         bir millisekundda ikki element qo'shilsa to'qnashardi. */
      id: `pf-${
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 12)
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      }`,
      title: pfTitle.trim(),
      description: pfDesc.trim(),
      image: pfImage[0],
      category: pfCategory,
    };
    const updated = [...portfolio, newItem];
    setPortfolio(updated);
    setPfOpen(false);
    saveSellerData({ portfolio: updated });
  }

  function removePortfolioItem(id: string) {
    const updated = portfolio.filter((item) => item.id !== id);
    setPortfolio(updated);
    saveSellerData({ portfolio: updated });
  }

  async function saveSellerData(overrides: Partial<{
    fullName: string;
    headline: string;
    bio: string;
    skills: string[];
    categories: string[];
    location: string;
    languages: ProfileLanguage[];
    portfolio: PortfolioItem[];
  }>) {
    try {
      /* Profil maydonlari uchun zaxira qiymat — joriy INPUT emas, oxirgi
         SAQLANGAN qiymat. Aks holda ism/bio maydonini tahrirlab, "Saqlash"
         bosmasdan til qo'shsangiz, tasdiqlanmagan matn jimgina saqlanardi. */
      const payload = {
        fullName: overrides.fullName ?? persisted.fullName,
        headline: overrides.headline ?? persisted.headline,
        bio: overrides.bio ?? persisted.bio,
        skills: overrides.skills ?? skills,
        categories: overrides.categories ?? categories,
        location: overrides.location ?? persisted.location,
        languages: overrides.languages ?? languages,
        portfolio: overrides.portfolio ?? portfolio,
      };
      await usersService.updateSellerProfile(payload);
      setPersisted({
        fullName: payload.fullName,
        headline: payload.headline,
        bio: payload.bio,
        location: payload.location,
      });
      toast(t("settings.saved"));
    } catch {
      toast(t("common.error"), "error");
    }
  }

  async function handleAvatarSelect(files: FileList | null) {
    if (!files || !files[0]) return;
    setAvatarError("");
    setAvatarUploading(true);
    try {
      const processed = await processAvatarImage(files[0], 320);
      setAvatarUrl(processed);
      await usersService.updateAvatar(processed);
      setCurrentUser((prev) => (prev ? { ...prev, avatarUrl: processed } : null));
      toast("Profil rasmi muvaffaqiyatli yangilandi");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Rasmni yuklashda xatolik yuz berdi";
      setAvatarError(msg);
      toast(msg, "error");
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function handleAvatarRemove() {
    setAvatarError("");
    setAvatarUploading(true);
    try {
      setAvatarUrl("");
      await usersService.updateAvatar("");
      setCurrentUser((prev) => (prev ? { ...prev, avatarUrl: undefined } : null));
      toast("Profil rasmi o'chirildi");
    } catch {
      toast("Rasmni o'chirishda xatolik yuz berdi", "error");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!fullName.trim()) next.fullName = t("onboard.errName");
    if (bio.trim().length < 20) next.bio = t("onboard.errBio");
    if (bio.trim().length > LIMITS.bio) next.bio = t("onboard.errBioLong");
    if (!location.trim()) next.location = t("onboard.errLocation");
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await saveSellerData({
        fullName: fullName.trim(),
        headline: headline.trim(),
        bio: bio.trim(),
        skills,
        location: location.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await authService.logout();
    router.push("/kirish");
  }

  if (loadError) return <ErrorState error={loadError} onRetry={load} />;
  if (loading) return <SkeletonCard />;

  const navTabs: { id: SettingsTab; label: string; icon: string; count?: number }[] = [
    {
      id: "profile",
      label: t("settings.tabProfile"),
      icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    },
    {
      id: "languages",
      label: t("settings.tabLanguages"),
      icon: "M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129",
      count: languages.length + skills.length,
    },
    {
      id: "portfolio",
      label: t("settings.tabPortfolio"),
      icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
      count: portfolio.length,
    },
    {
      id: "availability",
      label: t("settings.tabAvailability"),
      icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      id: "payments",
      label: t("settings.tabPayments"),
      icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
      count: cards.length,
    },
    {
      id: "security",
      label: t("settings.tabSecurity"),
      icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    },
    {
      id: "notifications",
      label: t("settings.tabNotifications"),
      icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
    },
    {
      id: "privacy",
      label: t("settings.tabPrivacy"),
      icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    },
    {
      id: "account",
      label: t("settings.tabAccount"),
      icon: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
    },
  ];

  return (
    <div className="flex flex-col gap-6 pb-12">
      <div className="flex items-center justify-between">
        <BackButton href="/mutaxassis" label={t("nav.dashboard")} />
      </div>
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-ink sm:text-3xl">
            {t("settings.title")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {currentUser?.fullName} · {currentUser?.phone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/mutaxassis/settings/profil"
            className="inline-flex h-9 items-center gap-2 rounded-btn border border-line bg-card px-3.5 text-xs font-medium text-ink shadow-card transition-colors hover:border-primary hover:bg-card-hover"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            {t("nav.profile")}
          </Link>
          <Link
            href="/mutaxassis/settings/verifikatsiya"
            className="inline-flex h-9 items-center gap-2 rounded-btn border border-line bg-card px-3.5 text-xs font-medium text-ink shadow-card transition-colors hover:border-primary hover:bg-card-hover"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1.5 13.5 4v3.6c0 3.3-2.3 6.1-5.5 6.9-3.2-.8-5.5-3.6-5.5-6.9V4L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="m6 8 1.5 1.5 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("nav.verification")}
          </Link>
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
              className={`flex shrink-0 items-center gap-2 rounded-btn px-3.5 py-2 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-on-primary shadow-card"
                  : "border border-line bg-card text-muted hover:text-ink"
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === "number" && tab.count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    active ? "bg-white/20 text-on-primary" : "bg-surface text-faint"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Desktop Two-Column Layout */}
      <div className="grid items-start gap-8 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left Column: Navigation Sidebar + Completeness Card */}
        <aside className="hidden flex-col gap-5 lg:sticky lg:top-24 lg:flex">
          {/* Profile Completeness Checklist */}
          <Card padding="md" className="border-primary/20 bg-primary/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-primary-deep">
                {t("settings.completenessTitle")}
              </span>
              <span className="font-heading text-lg font-black text-primary">
                {percent}%
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-2xs text-muted">
              {percent === 100
                ? t("settings.completenessDone")
                : t("settings.completenessHint")}
            </p>

            <ul className="mt-3 flex flex-col gap-1.5 border-t border-primary/15 pt-3">
              {completenessList.map((item) => (
                <li key={item.key}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="group flex items-center justify-between gap-2 text-xs transition-colors hover:text-primary"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={item.done ? "text-success font-bold" : "text-faint"}>
                          {item.done ? "✓" : "○"}
                        </span>
                        <span className={item.done ? "text-muted line-through" : "text-ink font-medium"}>
                          {t(item.key)}
                        </span>
                      </span>
                      <span className="text-2xs text-primary opacity-0 group-hover:opacity-100">
                        +
                      </span>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveTab(item.tab as SettingsTab)}
                      className="group flex w-full items-center justify-between gap-2 text-left text-xs transition-colors hover:text-primary"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={item.done ? "text-success font-bold" : "text-faint"}>
                          {item.done ? "✓" : "○"}
                        </span>
                        <span className={item.done ? "text-muted line-through" : "text-ink font-medium"}>
                          {t(item.key)}
                        </span>
                      </span>
                      {!item.done && (
                        <span className="text-2xs text-primary opacity-0 group-hover:opacity-100">
                          →
                        </span>
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {/* Desktop Left Nav Menu */}
          <nav className="flex flex-col gap-1 rounded-card border border-line bg-card p-2 shadow-card" aria-label={t("settings.title")}>
            {navTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-between rounded-btn px-3 py-2.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary font-bold shadow-xs"
                      : "text-muted hover:bg-card-hover hover:text-ink"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className={active ? "text-primary" : "text-faint"}
                    >
                      <path d={tab.icon} />
                    </svg>
                    <span>{tab.label}</span>
                  </span>
                  {typeof tab.count === "number" && tab.count > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${
                        active ? "bg-primary text-on-primary" : "bg-surface text-faint"
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Column: Active Tab Content */}
        <main className="flex flex-col gap-6">
          {/* TAB 1: Profil ma'lumotlari */}
          {activeTab === "profile" && (
            <Card padding="lg">
              <div className="border-b border-line pb-6">
                <div>
                  <h2 className="font-heading text-lg font-bold text-ink">
                    {t("settings.tabProfile")}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {t("profile.publicNote")}
                  </p>
                </div>

                {/* Upwork-style interactive avatar uploader */}
                <div className="mt-5 flex flex-col sm:flex-row items-center gap-5 p-4 rounded-2xl border border-line bg-surface/60">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                      aria-label="Profil rasmini o'zgartirish"
                      className="group relative block h-24 w-24 rounded-full overflow-hidden border-2 border-line hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm cursor-pointer"
                    >
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarUrl}
                          alt={fullName || "Profil rasmi"}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-primary/10 font-heading text-2xl font-black text-primary-deep">
                          {initials(fullName || "?")}
                        </span>
                      )}

                      {/* Hover camera overlay */}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white transition-opacity">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        <span className="text-[10px] font-semibold mt-1">O&apos;zgartirish</span>
                      </div>

                      {/* Loading spinner */}
                      {avatarUploading && (
                        <div className="absolute inset-0 bg-ink/60 flex items-center justify-center">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        </div>
                      )}
                    </button>

                    {/* Camera badge button */}
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                      aria-label="Rasm yuklash"
                      className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink shadow-sm hover:bg-card-hover hover:text-primary transition-colors cursor-pointer"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex flex-col items-center sm:items-start text-center sm:text-left gap-1 flex-1">
                    <span className="text-sm font-semibold text-ink">
                      Profil fotosurati
                    </span>
                    <p className="text-xs text-muted max-w-sm">
                      Mijozlar ishonchini oshirish uchun yuzingiz aniq ko&apos;ringan sifatli fotosurat yuklang. (JPG, PNG yoki WebP, 10 MB gacha)
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={avatarUploading}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        {avatarUrl ? "Rasmni almashtirish" : "Rasm yuklash"}
                      </Button>
                      {avatarUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={avatarUploading}
                          className="text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={handleAvatarRemove}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          O&apos;chirish
                        </Button>
                      )}
                    </div>
                    {avatarError && (
                      <p className="mt-1 text-xs text-danger" role="alert">
                        {avatarError}
                      </p>
                    )}
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => handleAvatarSelect(e.target.files)}
                    />
                  </div>
                </div>
              </div>

              <form onSubmit={handleProfileSubmit} className="mt-6 flex flex-col gap-5" noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label={t("onboard.fullName")}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    error={errors.fullName}
                  />
                  <LocationPicker
                    label={t("onboard.location")}
                    value={location}
                    onChange={(val) => {
                      setLocation(val);
                      if (errors.location) setErrors((prev) => ({ ...prev, location: undefined }));
                    }}
                    error={errors.location}
                  />
                </div>

                <Input
                  label={t("settings.headlineLabel")}
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder={t("settings.headlinePh")}
                />

                <div>
                  <Textarea
                    label={t("onboard.bio")}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    error={errors.bio}
                    maxLength={LIMITS.bio}
                    rows={5}
                  />
                  <div className="mt-1 flex items-center justify-between text-2xs text-faint">
                    <span className={bio.trim().length >= 50 ? "text-success font-medium" : "text-faint"}>
                      {t("settings.bioHint")}
                    </span>
                    <span>
                      {bio.length}/{LIMITS.bio}
                    </span>
                  </div>
                </div>

                {/* Interface Language */}
                <div className="rounded-input border border-line bg-surface p-4">
                  <h3 className="text-xs font-bold text-ink">{t("settings.langSection")}</h3>
                  <p className="mt-0.5 text-2xs text-muted">{t("settings.langHint")}</p>
                  <div className="mt-3">
                    <RadioGroup
                      options={[
                        { value: "uz", label: "O'zbekcha" },
                        { value: "ru", label: "Русский" },
                        { value: "en", label: "English" },
                      ]}
                      value={lang}
                      onChange={(value) => setLang(value as Lang)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button type="submit" loading={saving}>
                    {t("common.save")}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {/* TAB 2: Tillar va Ko'nikmalar */}
          {activeTab === "languages" && (
            <Card padding="lg" className="flex flex-col gap-6">
              <div>
                <h2 className="font-heading text-lg font-bold text-ink">
                  {t("settings.tabLanguages")}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {t("settings.skillsIntro")}
                </p>
              </div>

              {/* Skills Section */}
              <div className="border-t border-line pt-5">
                <TagInput
                  label={t("onboard.skills")}
                  value={skills}
                  onChange={(newSkills) => {
                    setSkills(newSkills);
                    saveSellerData({ skills: newSkills });
                  }}
                  placeholder={t("onboard.skillsPh")}
                />
                <p className="mt-1.5 text-2xs text-faint">
                  {t("settings.skillsHint")}
                </p>
              </div>

              {/* Ish yo'nalishlari — ro'yxatdan o'tishda so'raladi, lekin ilgari
                  keyin O'ZGARTIRIB bo'lmasdi. Ular "Sizga mos ishlar" tanlovini
                  va bozor filtrini boshqaradi. */}
              <div className="border-t border-line pt-5">
                <span className="text-xs font-medium text-muted">
                  {t("settings.categories")}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CATEGORIES.map((cat) => {
                    const selected = categories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          const next = selected
                            ? categories.filter((c) => c !== cat)
                            : [...categories, cat];
                          if (next.length === 0) {
                            toast(t("settings.categoriesRequired"), "error");
                            return;
                          }
                          setCategories(next);
                          saveSellerData({ categories: next });
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors duration-150 ${
                          selected
                            ? "border-primary bg-primary/15 font-medium text-ink"
                            : "border-line bg-card text-muted hover:text-ink"
                        }`}
                      >
                        {t(`cat.${cat}`)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-2xs text-faint">
                  {t("settings.categoriesHint")}
                </p>
              </div>

              {/* Languages Section */}
              <div className="border-t border-line pt-5">
                <span className="text-xs font-bold text-ink">
                  {t("profile.languages")}
                </span>
                <p className="mt-0.5 text-2xs text-muted">
                  {t("settings.languagesHint")}
                </p>

                {languages.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2">
                    {languages.map((lng) => (
                      <li
                        key={lng.name}
                        className="flex items-center justify-between gap-3 rounded-input border border-line bg-card px-3.5 py-2.5 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{lng.name}</span>
                          <Badge tone="primary">{t(`lang.${lng.level}`)}</Badge>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLanguage(lng.name)}
                          aria-label={t("common.delete")}
                          className="text-faint transition-colors duration-150 hover:text-danger"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={newLangName}
                    onChange={(e) => setNewLangName(e.target.value)}
                    placeholder={t("settings.langNamePh")}
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLanguage();
                      }
                    }}
                  />
                  <Select
                    value={newLangLevel}
                    onChange={(e) => setNewLangLevel(e.target.value as LanguageLevel)}
                    options={LEVELS.map((lvl) => ({
                      value: lvl,
                      label: t(`lang.${lvl}`),
                    }))}
                    className="sm:w-44"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={addLanguage}
                    disabled={!newLangName.trim()}
                    className="sm:w-auto"
                  >
                    {t("settings.addLang")}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* TAB 3: Portfolio ishlari */}
          {activeTab === "portfolio" && (
            <Card padding="lg" className="flex flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold text-ink">
                    {t("settings.tabPortfolio")}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {t("settings.portfolioHint")}
                  </p>
                </div>
                <Button onClick={openPortfolioModal} size="sm">
                  + {t("settings.addWork")}
                </Button>
              </div>

              {portfolio.length === 0 ? (
                <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
                  <p className="font-heading text-sm font-bold text-ink">
                    {t("settings.portfolioEmptyTitle")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t("settings.portfolioEmptyDesc")}
                  </p>
                  <Button onClick={openPortfolioModal} variant="secondary" className="mt-4">
                    {t("settings.addWork")}
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {portfolio.map((item) => (
                    <div
                      key={item.id}
                      className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-card shadow-xs transition-shadow hover:shadow-card"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image}
                        alt={item.title}
                        className="aspect-[16/10] w-full border-b border-line object-cover"
                      />
                      <div className="flex flex-1 flex-col gap-2 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          {item.category && (
                            <Badge tone="primary">{t(`cat.${item.category}`)}</Badge>
                          )}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setViewingPfItem(item)}
                              className="rounded-btn p-1 text-xs text-muted hover:bg-card-hover hover:text-ink"
                              aria-label={t("profile.viewWork")}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => removePortfolioItem(item.id)}
                              aria-label={t("common.delete")}
                              className="rounded-btn p-1 text-xs text-faint hover:bg-danger/10 hover:text-danger"
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <h3 className="font-heading text-xs font-bold text-ink">
                          {item.title}
                        </h3>
                        {item.description && (
                          <p className="line-clamp-2 text-2xs text-muted">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* TAB 4: Ish holati va Bandlik */}
          {activeTab === "availability" && (
            <Card padding="lg" className="flex flex-col gap-6">
              <div>
                <h2 className="font-heading text-lg font-bold text-ink">
                  {t("settings.tabAvailability")}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {t("settings.tabAvailabilityDesc")}
                </p>
              </div>

              <div className="rounded-input border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-heading text-sm font-bold text-ink">
                      {t("settings.availTitle")}
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      {available ? t("settings.availOnDesc") : t("settings.availOffDesc")}
                    </p>
                  </div>
                  <Checkbox
                    label={t("settings.availTitle")}
                    checked={available}
                    onChange={(e) => handleAvailability(e.target.checked)}
                  />
                </div>
              </div>

              <div className="rounded-input border border-line bg-card p-5">
                <h3 className="text-xs font-bold text-ink">{t("settings.responseSpeed")}</h3>
                <p className="mt-1 text-xs text-muted">{t("settings.responseSpeedDesc")}</p>
                <div className="mt-3 flex items-center gap-3">
                  <Badge tone="success">~ 1-2 {t("common.hours")}</Badge>
                  <span className="text-2xs text-faint">{t("settings.platformAverage")}</span>
                </div>
              </div>
            </Card>
          )}

          {/* TAB 5: To'lov & Kartalar */}
          {activeTab === "payments" && (
            <Card padding="lg" className="flex flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold text-ink">
                    {t("settings.tabPayments")}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {t("card.sectionHint")}
                  </p>
                </div>
                <Link href="/mutaxassis/billing">
                  <Button variant="secondary" size="sm">
                    {t("nav.earnings")} →
                  </Button>
                </Link>
              </div>

              <div className="border-t border-line pt-4">
                <CardManager cards={cards} onChange={setCards} />
              </div>
            </Card>
          )}

          {/* TAB 6: Xavfsizlik */}
          {activeTab === "security" && (
            <div className="flex flex-col gap-6">
              <AccountSecurity />
            </div>
          )}

          {/* TAB 7: Bildirishnomalar */}
          {activeTab === "notifications" && (
            <Card padding="lg" className="flex flex-col gap-5">
              <div>
                <h2 className="font-heading text-lg font-bold text-ink">
                  {t("settings.tabNotifications")}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {t("settings.notificationsHint")}
                </p>
              </div>

              <div className="flex flex-col divide-y divide-line">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{t("settings.ntfOffersTitle")}</p>
                    <p className="text-2xs text-muted">{t("settings.ntfOffersDesc")}</p>
                  </div>
                  <Checkbox
                    id="ntf-seller-proposals"
                    label={t("settings.ntfOffersLabel")}
                    checked={preferences.proposals ?? true}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, proposals: e.target.checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{t("settings.ntfContractsTitle")}</p>
                    <p className="text-2xs text-muted">{t("settings.ntfContractsDesc")}</p>
                  </div>
                  <Checkbox
                    id="ntf-seller-contracts"
                    label={t("settings.ntfContractsTitle")}
                    checked={preferences.contracts}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, contracts: e.target.checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{t("settings.ntfMessagesTitle")}</p>
                    <p className="text-2xs text-muted">{t("settings.ntfMessagesDesc")}</p>
                  </div>
                  <Checkbox
                    id="ntf-seller-messages"
                    label={t("settings.ntfMessagesTitle")}
                    checked={preferences.messages}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, messages: e.target.checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{t("settings.ntfPaymentsTitle")}</p>
                    <p className="text-2xs text-muted">{t("settings.ntfPaymentsDesc")}</p>
                  </div>
                  <Checkbox
                    id="ntf-seller-payments"
                    label={t("settings.ntfPaymentsTitle")}
                    checked={preferences.payments}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, payments: e.target.checked }))
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button loading={savingNotif} onClick={handleSaveNotifications}>
                  {t("common.save")}
                </Button>
              </div>
            </Card>
          )}

          {/* TAB 8: Maxfiylik */}
          {activeTab === "privacy" && (
            <div className="flex flex-col gap-6">
              <AccountControls />
            </div>
          )}

          {/* TAB 9: Hisob & Chiqish */}
          {activeTab === "account" && (
            <Card padding="lg" className="border-danger/20">
              <h2 className="font-heading text-lg font-bold text-danger">
                {t("settings.tabAccount")}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {t("settings.accountSectionDesc")}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button variant="danger" onClick={() => setLogoutOpen(true)}>
                  {t("common.logout")}
                </Button>
              </div>
            </Card>
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

      {/* Add Portfolio Item Modal */}
      <Modal
        open={pfOpen}
        onClose={() => setPfOpen(false)}
        title={t("settings.addWork")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPfOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={addPortfolioItem}>{t("common.save")}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label={t("settings.pfTitle")}
            value={pfTitle}
            onChange={(e) => setPfTitle(e.target.value)}
            placeholder={t("settings.pfTitlePh")}
          />
          <Textarea
            label={t("settings.pfDesc")}
            value={pfDesc}
            onChange={(e) => setPfDesc(e.target.value)}
            placeholder={t("settings.pfDescPh")}
            rows={3}
          />
          <Select
            label={t("settings.pfCategory")}
            value={pfCategory}
            onChange={(e) => setPfCategory(e.target.value as ServiceCategory)}
            options={CATEGORIES.map((cat) => ({
              value: cat,
              label: t(`cat.${cat}`),
            }))}
          />
          <FileUpload
            label={t("settings.pfImage")}
            value={pfImage}
            onChange={setPfImage}
            max={1}
          />
          {pfError && (
            <p className="text-2xs text-danger" role="alert">
              {pfError}
            </p>
          )}
        </div>
      </Modal>

      {/* View Portfolio Item Modal */}
      {viewingPfItem && (
        <Modal
          open={true}
          onClose={() => setViewingPfItem(null)}
          title={viewingPfItem.title}
          footer={
            <Button variant="secondary" onClick={() => setViewingPfItem(null)}>
              {t("common.close")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewingPfItem.image}
              alt={viewingPfItem.title}
              className="max-h-80 w-full rounded-card border border-line object-cover"
            />
            {viewingPfItem.category && (
              <Badge tone="primary" className="self-start">
                {t(`cat.${viewingPfItem.category}`)}
              </Badge>
            )}
            {viewingPfItem.description && (
              <p className="text-sm text-muted leading-relaxed">
                {viewingPfItem.description}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
