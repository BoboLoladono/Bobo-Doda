"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT, type Lang } from "@/lib/i18n";
import { PLATFORM_FEE_PERCENT } from "@/lib/fees";
import { useSupportModal } from "@/components/shared/SupportModalProvider";
import { authService, DATA_CHANGED_EVENT } from "@/lib/api";
import type * as Model from "@/lib/types";

/* ── Formatter (Hydration mismatch #418 oldini olish uchun deterministik format) ── */
function formatSum(num: number): string {
  return Math.round(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export default function LandingPage() {
  const { t, lang, setLang } = useT();
  const { openSupportModal } = useSupportModal();

  const [menuOpen, setMenuOpen] = useState(false);
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [calcBudget, setCalcBudget] = useState(4000000);
  const [session, setSession] = useState<Model.Session | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /* Foydalanuvchi sessiyasi — navigatsiya panelida Kirish o'rniga Kabinet ko'rsatish */
  useEffect(() => {
    setSession(authService.getSession());
    const onSessionChange = () => setSession(authService.getSession());
    window.addEventListener(DATA_CHANGED_EVENT, onSessionChange);
    window.addEventListener("storage", onSessionChange);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, onSessionChange);
      window.removeEventListener("storage", onSessionChange);
    };
  }, []);

  const cabinetHref = !session
    ? "/kirish?tab=kirish"
    : session.role === "mutaxassis"
      ? session.profileDone
        ? "/mutaxassis"
        : "/mutaxassis/settings/royxat"
      : session.role === "xaridor"
        ? "/xaridor"
        : "/rol-tanlash";

  /* Landing page title translations */
  useEffect(() => {
    const titles: Record<Lang, string> = {
      uz: "Bobololadono — Mutaxassislar bozori",
      ru: "Bobololadono — Биржа специалистов",
      en: "Bobololadono — Specialist Marketplace",
    };
    document.title = titles[lang] || titles.uz;
  }, [lang]);

  /* Headline rotator (To'xtatish / davom ettirish qo'llab-quvvatlanadi, prefers-reduced-motion inobatga olingan) */
  useEffect(() => {
    if (heroPaused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(() => {
      setHeadlineIndex((prev) => (prev + 1) % 4);
    }, 4500);
    return () => clearInterval(timer);
  }, [heroPaused]);

  /* Scroll reveal */
  useEffect(() => {
    const nodes = rootRef.current?.querySelectorAll(".reveal");
    if (!nodes || nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const tr = (uz: string, ru: string, en: string): string => {
    if (lang === "ru") return ru;
    if (lang === "en") return en;
    return uz;
  };

  const langOptions: Lang[] = ["uz", "ru", "en"];

  const navLinks = [
    { href: "#portfolio", label: tr("Buyurtmalar", "Проекты", "Projects") },
    { href: "#stages", label: tr("Qanday ishlaydi", "Как это работает", "How it works") },
    { href: "#categories", label: tr("Yo'nalishlar", "Направления", "Categories") },
    { href: "#security", label: tr("Kafolat", "Гарантия", "Escrow") },
    { href: "#faq", label: tr("Savollar", "Вопросы", "FAQ") },
  ];

  /* ── Headlines (Yoshlar Ventures Rotating Hero Titles) ─────────────── */
  const headlines = [
    {
      line1: tr("Ishonchli mutaxassis qidiryapsizmi?", "Ищете надежного исполнителя?", "Looking for a vetted expert?"),
      line2: tr("Biz natijani kafolatlaymiz.", "Мы гарантируем результат.", "We guarantee delivery."),
    },
    {
      line1: tr("Katta va murakkab loyihangizmi?", "Есть сложный цифровой проект?", "Have a complex digital project?"),
      line2: tr("Top mutaxassislarni topamiz.", "Найдем топ команду.", "We assemble elite talent."),
    },
    {
      line1: tr("Oldindan to'lovdan qo'rqyapsizmi?", "Боитесь потерять предоплату?", "Afraid of upfront risk?"),
      line2: tr("Mablag' Escrow himoyasida.", "Деньги в безопасности Escrow.", "Funds safe in Escrow."),
    },
    {
      line1: tr("O'z xizmatingizni sotmoqchimisiz?", "Хотите работать удаленно?", "Want high-ticket projects?"),
      line2: tr("Kafolatlangan daromad oling.", "Берите заказы с гарантией.", "Get paid on time, every time."),
    },
  ];

  /* ── Portfolio / Live Job Cards (Marquee) ───────────────────────────── */
  const portfolioItems = [
    {
      num: "01",
      title: tr("Payme & Click E-Commerce", "E-Commerce с Payme & Click", "Payme & Click E-Commerce"),
      category: "FinTech / Web",
      desc: tr(
        "Onlayn do'kon va to'lov tizimlarining to'liq integratsiyasi.",
        "Интернет-магазин и интеграция национальных платежей.",
        "E-commerce platform with automated payment integration."
      ),
      budget: "12,500,000 UZS",
      bids: 8,
      isHot: true,
      tag: "Next.js / Node",
    },
    {
      num: "02",
      title: tr("Restoran CRM & Mobil Ilova", "CRM ресторана & мобильное приложение", "Restaurant CRM & Mobile App"),
      category: "Mobile / iOS & Android",
      desc: tr(
        "Yetkazib berish mobil ilovasi va kassa tizimi integratsiyasi.",
        "Приложение доставки и синхронизация с кассой iiko.",
        "Delivery app synced with restaurant POS system."
      ),
      budget: "18,000,000 UZS",
      bids: 14,
      isHot: false,
      tag: "Flutter / FastAPI",
    },
    {
      num: "03",
      title: tr("Fintech Brendbuk & UI/UX", "FinTech брендбук & UI/UX", "Fintech Brandbook & UI/UX"),
      category: "Design / Product",
      desc: tr(
        "To'liq dizayn tizimi, logotip va mobil ilova prototipi.",
        "Полная дизайн-система и мобильный интерфейс необанка.",
        "Comprehensive design system & neobank mobile interface."
      ),
      budget: "6,000,000 UZS",
      bids: 19,
      isHot: true,
      tag: "Figma / UI System",
    },
    {
      num: "04",
      title: tr("Telegram Savdo Boti (Click)", "Telegram-бот для продаж (Click)", "Telegram Sales Bot (Click)"),
      category: "Telegram / Python",
      desc: tr(
        "Buyurtma qabul qiluvchi va to'lovli avtomatlashgan bot.",
        "Умный бот для приема заказов с авто-оплатой и складом.",
        "Smart automated e-commerce bot with stock management."
      ),
      budget: "4,500,000 UZS",
      bids: 11,
      isHot: false,
      tag: "Python / Aiogram",
    },
    {
      num: "05",
      title: tr("B2B Logistika Platformasi", "B2B платформа логистики", "B2B Logistics Platform"),
      category: "SaaS / Enterprise",
      desc: tr(
        "Yuk tashuvchilar va buyurtmachilar uchun dispetcherlik portali.",
        "Система мониторинга грузоперевозок и автодиспетчеризация.",
        "Freight tracking and auto-dispatching logistics portal."
      ),
      budget: "24,000,000 UZS",
      bids: 7,
      isHot: true,
      tag: "React / PostgreSQL",
    },
    {
      num: "06",
      title: tr("Reels & Viral Video Montaj", "Монтаж вирусных Reels & видео", "Viral Reels & Video Editing"),
      category: "Media / Motion",
      desc: tr(
        "Kompaniya uchun 30 ta sifatli Reels, 3D vizual va ovozlashtirish.",
        "Пакет из 30 вирусных видеороликов с 3D графикой и озвучкой.",
        "Pack of 30 viral Reels with 3D motion graphics."
      ),
      budget: "5,000,000 UZS",
      bids: 16,
      isHot: false,
      tag: "After Effects / 3D",
    },
  ];

  /* ── Categories List with full 3-language support (To'g'ridan-to'g'ri bozor katalogiga ulanadi) ─ */
  const categoriesList = [
    {
      key: "dasturlash",
      icon: "💻",
      title: tr("Dasturlash & IT", "Разработка & IT", "Development & IT"),
      count: tr("Web, Mobile & Botlar", "Web, Mobile & Боты", "Web, Mobile & Bots"),
      price: tr("500,000 so'mdan", "от 500 000 сум", "from 500,000 UZS"),
    },
    {
      key: "dizayn",
      icon: "🎨",
      title: tr("Dizayn & Kreativ", "Дизайн & Креатив", "Design & Creative"),
      count: tr("UI/UX, Logotip & Brending", "UI/UX, Логотипы & Брендинг", "UI/UX, Logo & Branding"),
      price: tr("300,000 so'mdan", "от 300 000 сум", "from 300,000 UZS"),
    },
    {
      key: "marketing",
      icon: "📈",
      title: tr("Marketing & SMM", "Маркетинг & SMM", "Marketing & SMM"),
      count: tr("Target, SEO & Reklama", "Таргет, SEO & Реклама", "Targeting, SEO & Ads"),
      price: tr("400,000 so'mdan", "от 400 000 сум", "from 400,000 UZS"),
    },
    {
      key: "dasturlash",
      icon: "🤖",
      title: tr("Sun'iy Intellekt & Data", "ИИ & Аналитика данных", "AI & Data Science"),
      count: tr("AI botlar & Avtomatlashtirish", "AI-боты & Автоматизация", "AI Bots & Automation"),
      price: tr("800,000 so'mdan", "от 800 000 сум", "from 800,000 UZS"),
    },
    {
      key: "video",
      icon: "🎬",
      title: tr("Video & Motion 3D", "Видео & 3D Моушн", "Video & 3D Motion"),
      count: tr("Reels, Montaj & Grafika", "Reels, Монтаж & Графика", "Reels, Editing & Motion"),
      price: tr("350,000 so'mdan", "от 350 000 сум", "from 350,000 UZS"),
    },
    {
      key: "kontent",
      icon: "✍️",
      title: tr("Matn & Tarjima", "Тексты & Переводы", "Writing & Translation"),
      count: tr("Kopirayting & Redaktura", "Копирайтинг & Редактура", "Copywriting & Editing"),
      price: tr("150,000 so'mdan", "от 150 000 сум", "from 150,000 UZS"),
    },
    {
      key: "biznes",
      icon: "💼",
      title: tr("Biznes & Konsalting", "Бизнес & Консалтинг", "Business & Consulting"),
      count: tr("Biznes-reja & Moliya", "Бизнес-план & Финансы", "Business Plan & Finance"),
      price: tr("600,000 so'mdan", "от 600 000 сум", "from 600,000 UZS"),
    },
    {
      key: "dasturlash",
      icon: "🛡️",
      title: tr("Kiberxavfsizlik & QA", "Кибербезопасность & QA", "Cybersecurity & QA"),
      count: tr("Xavfsizlik auditi & Testlash", "Аудит безопасности & Тесты", "Security Audit & QA"),
      price: tr("700,000 so'mdan", "от 700 000 сум", "from 700,000 UZS"),
    },
  ];

  /* ── FAQ Items ─────────────────────────────────────────────────────── */
  const faqs = [
    { q: t("q1"), a: t("a1") },
    { q: t("q2"), a: t("a2") },
    { q: t("q3"), a: t("a3") },
    { q: t("q4"), a: t("a4") },
    { q: t("q5"), a: t("a5") },
  ];

  const platformFee = Math.round((calcBudget * PLATFORM_FEE_PERCENT) / 100);
  const specialistShare = Math.round(calcBudget * (1 - PLATFORM_FEE_PERCENT / 100));

  return (
    <div ref={rootRef}>
      <style>{`
        :root {
          /* ── Yoshlar Ventures Design Tokens ───────────────────────── */
          --orange: #ff7a1a;
          --orange2: #ff9a4d;
          --orange-ink: #c7500b;
          --lime: #c8f230;
          --ink: #141414;
          --n700: #2b2f38;
          --n500: #4b5262;
          --n300: #b8bec9;
          --surface: #fbfbfa;
          --warm: #fff4e9;
          --warm-ink: #a8480a;
          --card: #ffffff;
          --btn: #141414;
          --btn-fg: #ffffff;
          --hair: rgba(20, 20, 20, 0.08);
          --shell: rgba(20, 20, 20, 0.03);
          --elev: 0 40px 80px -40px rgba(20, 20, 20, 0.25);
          --elev-sm: 0 24px 48px -32px rgba(20, 20, 20, 0.18);
          --hi: inset 0 1px 0 rgba(255, 255, 255, 0.9);
          --navbg: rgba(255, 255, 255, 0.85);
          --ease: cubic-bezier(0.32, 0.72, 0, 1);

          --font-display: var(--font-unbounded), sans-serif;
          --font-sans: var(--font-onest), sans-serif;
        }

        .yv-lp * { box-sizing: border-box; }
        .yv-lp *:focus-visible {
          outline: 2px solid var(--orange);
          outline-offset: 3px;
        }
        .btn-find-work:focus-visible,
        .btn-apply-header:focus-visible,
        .btn-primary:focus-visible,
        .btn-outline:focus-visible,
        .nav-btn-login:focus-visible,
        .nav-link-item:focus-visible,
        .lang-capsule button:focus-visible {
          border-radius: 999px;
        }
        .yv-lp {
          font-family: var(--font-sans);
          color: var(--ink);
          line-height: 1.55;
          background: var(--surface);
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
          position: relative;
        }
        .yv-lp a { text-decoration: none; color: inherit; }
        .yv-lp ul { list-style: none; margin: 0; padding: 0; }
        .container-yv {
          width: 100%;
          max-width: 1200px;
          margin-inline: auto;
          padding-inline: 24px;
        }

        /* ── Dynamic Ambient Background (Grid & Auroras) ──────────── */
        .ambient-canvas {
          position: fixed;
          inset: -2%;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
          background: var(--surface);
        }
        .grid-pattern {
          position: absolute;
          inset: -10%;
          background-image: linear-gradient(90deg, var(--hair) 1px, transparent 1px),
                            linear-gradient(180deg, var(--hair) 1px, transparent 1px);
          background-size: 56px 56px;
          opacity: 0.45;
          animation: yv-gridDrift 28s linear infinite;
          -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 30%, #000, transparent 78%);
          mask-image: radial-gradient(ellipse 90% 70% at 50% 30%, #000, transparent 78%);
        }
        .aurora-a {
          position: absolute;
          top: -14%;
          left: -12%;
          width: 60vw;
          height: 60vw;
          max-width: 860px;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 40%, rgba(255, 122, 26, 0.18), transparent 65%);
          filter: blur(28px);
          animation: yv-auroraA 24s ease-in-out infinite;
        }
        .aurora-b {
          position: absolute;
          top: 24%;
          right: -14%;
          width: 54vw;
          height: 54vw;
          max-width: 780px;
          border-radius: 50%;
          background: radial-gradient(circle at 55% 45%, rgba(200, 242, 48, 0.15), transparent 66%);
          filter: blur(30px);
          animation: yv-auroraB 30s ease-in-out infinite;
        }
        .aurora-c {
          position: absolute;
          bottom: -16%;
          left: 24%;
          width: 56vw;
          height: 56vw;
          max-width: 820px;
          border-radius: 50%;
          background: radial-gradient(circle at 50% 50%, rgba(255, 154, 77, 0.14), transparent 64%);
          filter: blur(28px);
          animation: yv-auroraC 26s ease-in-out infinite;
        }

        @keyframes yv-gridDrift { 0% { background-position: 0 0; } 100% { background-position: 56px 56px; } }
        @keyframes yv-auroraA {
          0%, 100% { transform: translate(-4%) scale(1); }
          50% { transform: translate(12%, 8%) scale(1.15); }
        }
        @keyframes yv-auroraB {
          0%, 100% { transform: translate(0) scale(1.05); }
          50% { transform: translate(-14%, 10%) scale(0.9); }
        }
        @keyframes yv-auroraC {
          0%, 100% { transform: translateY(-4%) scale(0.96); }
          50% { transform: translate(-10%, 12%) scale(1.12); }
        }

        /* ── Floating Capsule Navbar (Kengaytirilgan & Ikkala tarafga 5cm uzaytirilgan) ── */
        .nav-container {
          width: 100%;
          max-width: 1580px;
          margin-inline: auto;
          padding-inline: 24px;
        }
        .header-floating {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
          padding: 22px 0 0;
        }
        .nav-capsule {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 8px 10px 8px 20px;
          background: var(--navbg);
          border: 1px solid var(--hair);
          border-radius: 999px;
          box-shadow: var(--elev-sm);
          backdrop-filter: blur(20px) saturate(160%);
          -webkit-backdrop-filter: blur(20px) saturate(160%);
          position: relative;
        }
        .nav-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
          text-decoration: none;
        }
        .nav-brand-icon {
          height: 44px;
          width: auto;
          display: block;
          object-fit: contain;
          filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.08));
          transition: transform 0.25s var(--ease);
        }
        .nav-brand:hover .nav-brand-icon {
          transform: translateY(-1px) scale(1.04);
        }
        .nav-brand-title {
          font-family: var(--font-display);
          font-size: 21px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--ink);
        }
        .nav-menu-links {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-inline: auto;
        }
        .nav-link-item {
          padding: 8px 13px;
          font-size: 14.5px;
          font-weight: 600;
          color: var(--n700);
          border-radius: 999px;
          transition: all 0.18s var(--ease);
          white-space: nowrap;
        }
        .nav-link-item:hover {
          background: var(--shell);
          color: var(--ink);
        }
        .nav-actions-group {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: auto;
          flex-shrink: 0;
        }
        .lang-capsule {
          display: flex;
          align-items: center;
          background: var(--shell);
          border: 1px solid var(--hair);
          border-radius: 999px;
          padding: 3px;
          gap: 2px;
        }
        .lang-capsule button {
          border: none;
          background: transparent;
          padding: 7px 11px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--n500);
          cursor: pointer;
          transition: all 0.18s var(--ease);
        }
        .lang-capsule button[aria-pressed="true"] {
          background: var(--card);
          color: var(--ink);
          box-shadow: var(--hi);
        }
        .nav-btn-login {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 16px;
          height: 40px;
          font-size: 14.5px;
          font-weight: 600;
          color: var(--n700);
          border-radius: 999px;
          transition: all 0.18s var(--ease);
          white-space: nowrap;
          text-decoration: none;
        }
        .nav-btn-login:hover {
          background: var(--shell);
          color: var(--ink);
        }
        .nav-btn-login .login-icon {
          font-size: 14px;
          opacity: 0.8;
        }
        .btn-find-work {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 48px;
          box-sizing: border-box;
          padding: 4px 4px 4px 16px;
          background: #ffffff;
          border: 1.5px solid rgba(20, 20, 20, 0.13);
          color: var(--ink);
          font-size: 14.5px;
          font-weight: 700;
          border-radius: 999px;
          white-space: nowrap;
          text-decoration: none;
          transition: all 0.22s var(--ease);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
        }
        .btn-find-work:hover {
          border-color: rgba(20, 20, 20, 0.3);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
          transform: translateY(-1px);
        }
        .btn-find-work .work-badge {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          background: var(--shell);
          border: 1px solid rgba(20, 20, 20, 0.06);
          display: grid;
          place-items: center;
          color: var(--ink);
          font-size: 14px;
          transition: all 0.2s var(--ease);
        }
        .btn-find-work:hover .work-badge {
          background: #ebebe5;
          transform: scale(1.05);
        }
        .btn-apply-header {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 48px;
          box-sizing: border-box;
          padding: 4px 4px 4px 16px;
          background: var(--btn);
          border: 1.5px solid transparent;
          color: #ffffff !important;
          font-size: 14.5px;
          font-weight: 700;
          border-radius: 999px;
          white-space: nowrap;
          text-decoration: none;
          transition: all 0.22s var(--ease);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
        }
        .btn-apply-header span {
          color: #ffffff !important;
        }
        .btn-apply-header:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
        }
        .btn-apply-header .arrow-badge {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          background: var(--orange);
          display: grid;
          place-items: center;
          color: #ffffff !important;
          font-size: 15px;
          font-weight: 700;
          transition: transform 0.2s var(--ease);
        }
        .btn-apply-header:hover .arrow-badge {
          transform: scale(1.05);
        }
        .btn-mobile-toggle {
          display: none;
          width: 46px;
          height: 46px;
          border-radius: 999px;
          background: var(--ink);
          color: #ffffff;
          border: none;
          cursor: pointer;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }

        /* ── Yoshlar Ventures Buttons ──────────────────────────────── */
        .btn-primary {
          background: var(--btn);
          min-height: 58px;
          color: #ffffff !important;
          box-shadow: var(--elev-sm);
          transition: transform 0.4s var(--ease);
          border-radius: 999px;
          align-items: center;
          gap: 14px;
          padding: 6px 6px 6px 28px;
          font-size: 16.5px;
          font-weight: 600;
          display: inline-flex;
          border: none;
          cursor: pointer;
        }
        .btn-primary span {
          color: #ffffff !important;
        }
        .btn-primary:hover {
          transform: translateY(-3px);
        }
        .btn-primary .badge {
          background: var(--orange);
          color: #ffffff;
          border-radius: 999px;
          place-items: center;
          width: 46px;
          height: 46px;
          font-size: 17px;
          display: inline-grid;
        }
        .btn-outline {
          border: 1px solid var(--hair);
          min-height: 58px;
          color: var(--ink);
          transition: transform 0.4s var(--ease), background 0.3s var(--ease);
          background: transparent;
          border-radius: 999px;
          align-items: center;
          gap: 8px;
          padding: 0 28px;
          font-size: 16.5px;
          font-weight: 600;
          display: inline-flex;
        }
        .btn-outline:hover {
          background: var(--shell);
          transform: translateY(-3px);
        }

        /* Eyebrows */
        .eyebrow-pill {
          background: var(--warm);
          color: var(--warm-ink);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          border-radius: 999px;
          align-items: center;
          gap: 11px;
          padding: 9px 22px 9px 13px;
          font-size: 14px;
          font-weight: 800;
          display: inline-flex;
          border: 1px solid rgba(255, 122, 26, 0.24);
          box-shadow: 0 4px 14px rgba(255, 122, 26, 0.1);
          margin-bottom: 22px;
        }
        .eyebrow-pill-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--orange);
          box-shadow: 0 0 0 3px rgba(255, 122, 26, 0.22);
        }

        /* ── Hero Section (Navbar bilan teng chegaralar & Kengaytirilgan) ── */
        .hero-section {
          position: relative;
          padding: 160px 0 84px;
          overflow: hidden;
          z-index: 1;
        }
        .hero-section .container-yv {
          max-width: 1580px;
          padding-inline: 24px;
        }
        .hero-grid {
          display: grid;
          grid-template-columns: 1.15fr 0.85fr;
          gap: 56px;
          align-items: center;
        }
        .hero-pause-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: var(--card);
          border: 1px solid var(--hair);
          color: var(--n500);
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .hero-pause-toggle:hover {
          color: var(--ink);
          border-color: rgba(20, 20, 20, 0.2);
          transform: scale(1.05);
        }
        .hero-pause-toggle:focus-visible {
          outline: 2px solid var(--orange);
          outline-offset: 2px;
        }
        .hero-title {
          font-family: var(--font-display);
          font-size: clamp(38px, 4.6vw, 70px);
          font-weight: 800;
          letter-spacing: -0.04em;
          line-height: 1.05;
          margin: 0 0 22px;
          color: var(--ink);
        }
        .hero-title .accent-orange {
          color: #d45100;
        }
        .hero-desc {
          font-size: 19px;
          line-height: 1.62;
          color: var(--n500);
          max-width: 580px;
          margin: 0 0 34px;
        }
        .hero-cta {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 28px;
        }

        /* ── Hero Right: Live Deal & Escrow Card (Zamonaviy Interfeys) ── */
        .hero-deal-card-wrap {
          position: relative;
          max-width: 530px;
          width: 100%;
          margin-left: auto;
          margin-right: 0;
        }
        .hero-deal-card {
          background: rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(24px) saturate(180%);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          border: 1px solid rgba(20, 20, 20, 0.08);
          border-radius: 34px;
          padding: 30px;
          box-shadow: 0 32px 64px -20px rgba(20, 20, 20, 0.14),
                      0 0 0 1px rgba(255, 255, 255, 0.8) inset;
          transition: transform 0.4s var(--ease), box-shadow 0.4s var(--ease);
          position: relative;
          z-index: 2;
        }
        .hero-deal-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 40px 80px -24px rgba(20, 20, 20, 0.18),
                      0 0 0 1px rgba(255, 255, 255, 0.9) inset;
        }
        .deal-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--hair);
          margin-bottom: 20px;
        }
        .deal-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .deal-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
          animation: yvPulse 2s infinite;
        }
        @keyframes yvPulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .deal-escrow-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--warm);
          color: var(--warm-ink);
          border: 1px solid rgba(255, 122, 26, 0.18);
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 12.5px;
          font-weight: 700;
        }
        .deal-title-row {
          margin-bottom: 18px;
        }
        .deal-cat-tag {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--n500);
          margin-bottom: 6px;
        }
        .deal-project-title {
          font-family: var(--font-display);
          font-size: 21px;
          font-weight: 800;
          color: var(--ink);
          letter-spacing: -0.02em;
          line-height: 1.32;
          margin: 0;
        }
        .deal-budget-box {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          background: var(--shell);
          border: 1px solid var(--hair);
          border-radius: 20px;
          padding: 16px 20px;
          margin-bottom: 18px;
        }
        .deal-budget-label {
          font-size: 13.5px;
          color: var(--n500);
          font-weight: 600;
        }
        .deal-budget-value {
          font-family: var(--font-display);
          font-size: 25px;
          font-weight: 800;
          color: var(--orange-ink);
          letter-spacing: -0.02em;
        }
        .deal-parties-grid {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
          background: #ffffff;
          border: 1px solid var(--hair);
          border-radius: 20px;
          padding: 12px 14px;
        }
        .deal-party-card {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
        }
        .party-avatar {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 13px;
          flex-shrink: 0;
        }
        .party-avatar.buyer {
          background: #e0f2fe;
          color: #0369a1;
        }
        .party-avatar.freelancer {
          background: #fef3c7;
          color: #92400e;
        }
        .party-name {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--ink);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .party-role {
          font-size: 11px;
          color: var(--n500);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .deal-parties-arrow {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--shell);
          border: 1px solid var(--hair);
          display: grid;
          place-items: center;
          font-size: 12px;
          color: var(--n500);
        }
        .deal-milestone-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .deal-milestone-step {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          padding: 8px 12px;
          border-radius: 12px;
          background: var(--surface);
          border: 1px solid var(--hair);
        }
        .milestone-left {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          color: var(--n700);
        }
        .milestone-status {
          font-weight: 700;
          font-size: 11px;
        }
        .milestone-status.done {
          color: #047857;
        }
        .milestone-status.escrow {
          color: #9a3412;
        }
        .deal-floating-badge-top {
          position: absolute;
          top: -14px;
          right: 4px;
          z-index: 3;
          background: #ffffff;
          border: 1px solid var(--hair);
          border-radius: 999px;
          padding: 9px 18px 9px 14px;
          box-shadow: var(--elev-sm);
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          color: var(--ink);
          animation: yvFloatSlow 6s ease-in-out infinite;
        }
        .deal-floating-badge-bottom {
          position: absolute;
          bottom: -14px;
          left: -8px;
          z-index: 3;
          background: var(--ink);
          color: #ffffff;
          border-radius: 999px;
          padding: 9px 18px 9px 14px;
          box-shadow: 0 16px 36px -10px rgba(20, 20, 20, 0.35);
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          animation: yvFloatSlow 6s ease-in-out 3s infinite;
        }
        @keyframes yvFloatSlow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-7px); }
        }

        /* ── Yoshlar Ventures Statbar (Metrikalar) ─────────────────── */
        .statbar-wrap {
          border-top: 1px solid var(--hair);
          border-bottom: 1px solid var(--hair);
          background: var(--card);
          position: relative;
          z-index: 1;
        }
        .statbar {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          align-items: start;
          margin: 0 auto;
          width: 100%;
        }
        .statbar > div {
          border-right: 1px solid var(--hair);
          padding: clamp(28px, 3.5vw, 44px) clamp(20px, 2.5vw, 48px);
        }
        .statbar > div:last-child { border-right: none; }
        .statbar dt {
          font-family: var(--font-display);
          font-size: clamp(28px, 5vw, 56px);
          font-weight: 700;
          letter-spacing: -0.04em;
          line-height: 1;
          color: var(--ink);
          margin-bottom: 8px;
        }
        .statbar dt.highlight {
          color: var(--orange-ink);
        }
        .statbar dd {
          margin: 0;
          font-size: 13px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-weight: 600;
          line-height: 1.45;
          color: var(--n500);
        }

        /* ── Stages (Support for your stage - 01, 02, 03) ──────────── */
        .stages-section {
          padding: clamp(64px, 8vw, 112px) 0;
          position: relative;
          z-index: 1;
        }
        .section-title {
          font-family: var(--font-display);
          letter-spacing: -0.04em;
          font-size: clamp(32px, 5.2vw, 56px);
          font-weight: 700;
          line-height: 1.05;
          margin: 0 0 16px;
        }
        .stage-list {
          list-style: none;
          margin: 48px 0 0;
          padding: 0;
          border-top: 1px solid var(--hair);
        }
        .stage-item {
          display: grid;
          grid-template-columns: 88px 1fr 1fr;
          gap: 8px 28px;
          padding: 30px 24px;
          border-bottom: 1px solid var(--hair);
          border-radius: 20px;
          align-items: baseline;
          transition: background 0.3s var(--ease);
        }
        .stage-item:hover {
          background: var(--shell);
        }
        .stage-item.lime-card {
          background: var(--lime);
          border-bottom-color: transparent;
        }
        .stage-num {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: var(--n500);
        }
        .stage-item.lime-card .stage-num {
          color: #5A6A18;
        }
        .stage-head {
          font-family: var(--font-display);
          font-size: clamp(24px, 3.4vw, 36px);
          font-weight: 700;
          letter-spacing: -0.03em;
          margin: 0;
          color: var(--ink);
        }
        .stage-desc {
          margin: 0;
          font-size: 16px;
          line-height: 1.6;
          color: var(--n500);
        }
        .stage-item.lime-card .stage-desc {
          color: #31380F;
        }

        /* ── Strikethrough Stereotypes Block (Yoshlar Ventures uslubi) */
        .barriers-section {
          background: var(--warm);
          border-top: 1px solid var(--hair);
          border-bottom: 1px solid var(--hair);
          position: relative;
          z-index: 1;
        }
        .barriers-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          align-items: center;
          gap: clamp(32px, 5vw, 72px);
          padding: clamp(64px, 8vw, 112px) 24px;
        }
        .strike-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .strike-item {
          font-family: var(--font-display);
          font-size: clamp(24px, 3.4vw, 40px);
          font-weight: 700;
          letter-spacing: -0.03em;
          color: var(--n700);
          text-decoration: line-through;
          text-decoration-thickness: 3px;
          text-decoration-color: var(--orange-ink);
          padding: 16px 0;
          border-bottom: 1px solid rgba(20, 20, 20, 0.08);
        }
        .strike-item:last-child {
          border-bottom: none;
        }

        /* ── Marquee Portfolio / Jobs Carousel ─────────────────────── */
        .marquee-container {
          overflow: hidden;
          padding: 16px 0 32px;
          position: relative;
        }
        .marquee-track {
          display: flex;
          gap: 20px;
          width: max-content;
          animation: yv-marquee 42s linear infinite;
        }
        .marquee-track:hover {
          animation-play-state: paused;
        }
        @keyframes yv-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .yv-job-card {
          flex: 0 0 clamp(280px, 80vw, 360px);
          background: var(--card);
          border: 1px solid var(--hair);
          border-radius: 28px;
          padding: 28px;
          box-shadow: var(--elev-sm);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: transform 0.4s var(--ease), box-shadow 0.4s var(--ease);
        }
        .yv-job-card:hover {
          transform: translateY(-6px);
          box-shadow: var(--elev);
        }
        .card-big-num {
          position: absolute;
          right: -8px;
          top: -18px;
          font-family: var(--font-display);
          font-size: 96px;
          font-weight: 800;
          letter-spacing: -0.06em;
          color: rgba(20, 20, 20, 0.04);
          pointer-events: none;
          line-height: 1;
          user-select: none;
        }
        .card-big-num::before {
          content: attr(data-num);
        }
        .card-tag {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--n500);
          margin-bottom: 12px;
        }
        .card-job-title {
          font-family: var(--font-display);
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--ink);
          margin: 0 0 10px;
          line-height: 1.25;
        }
        .card-job-desc {
          font-size: 14px;
          line-height: 1.6;
          color: var(--n500);
          margin: 0 0 24px;
        }
        .card-job-footer {
          padding-top: 16px;
          border-top: 1px solid var(--hair);
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }
        .card-job-amount {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.03em;
          color: var(--orange-ink);
        }
        .card-bid-pill {
          font-size: 12px;
          font-weight: 700;
          color: var(--ink);
          background: var(--warm);
          padding: 4px 10px;
          border-radius: 999px;
        }

        /* ── Categories Grid ───────────────────────────────────────── */
        .cat-grid-yv {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
          margin-top: 40px;
        }
        .cat-card-yv {
          background: var(--card);
          border: 1px solid var(--hair);
          border-radius: 22px;
          padding: 24px;
          transition: transform 0.3s var(--ease), box-shadow 0.3s var(--ease);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .cat-card-yv:hover {
          transform: translateY(-4px);
          box-shadow: var(--elev-sm);
        }
        .cat-icon-wrap {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: var(--warm);
          color: var(--orange);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 18px;
        }
        .cat-card-yv h3 {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 700;
          margin: 0 0 8px;
        }
        .cat-card-yv p {
          font-size: 13.5px;
          color: var(--n500);
          margin: 0 0 16px;
        }
        .cat-card-bottom {
          padding-top: 14px;
          border-top: 1px solid var(--hair);
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          font-weight: 700;
          color: var(--ink);
        }

        /* ── Escrow Simulator Section ──────────────────────────────── */
        .calc-box-yv {
          background: var(--card);
          border: 1px solid var(--hair);
          border-radius: 32px;
          padding: clamp(32px, 5vw, 64px);
          box-shadow: var(--elev-sm);
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 48px;
          align-items: center;
        }
        .calc-slider-input {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: var(--shell);
          outline: none;
          accent-color: var(--orange);
          cursor: pointer;
          margin: 20px 0;
        }

        /* ── FAQ Section (Toza Akkordeon) ──────────────────────────── */
        .faq-box-yv {
          max-width: 800px;
          margin: 40px auto 0;
        }
        .faq-row {
          border-bottom: 1px solid var(--hair);
          padding: 20px 0;
        }
        .faq-trigger-btn {
          width: 100%;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          text-align: left;
          font-family: var(--font-display);
          font-size: 17px;
          font-weight: 700;
          color: var(--ink);
        }
        .faq-icon-cross {
          font-size: 20px;
          color: var(--orange-ink);
          transition: transform 0.2s;
        }
        .faq-row[data-open="true"] .faq-icon-cross {
          transform: rotate(45deg);
        }
        .faq-content-p {
          padding-top: 14px;
          font-size: 15px;
          color: var(--n500);
          line-height: 1.65;
          margin: 0;
        }

        /* ── Final Call To Action ──────────────────────────────────── */
        .cta-final-yv {
          padding: clamp(80px, 10vw, 130px) 0;
          text-align: center;
          position: relative;
          z-index: 1;
        }
        .cta-final-title {
          font-family: var(--font-display);
          font-size: clamp(34px, 5vw, 62px);
          font-weight: 800;
          letter-spacing: -0.04em;
          line-height: 1.05;
          max-width: 760px;
          margin: 0 auto 20px;
        }

        /* ── Footer (Yoshlar Ventures uslubi) ──────────────────────── */
        .footer-yv {
          border-top: 1px solid var(--hair);
          background: var(--card);
          padding: 60px 0 36px;
          position: relative;
          z-index: 1;
        }
        .footer-grid-yv {
          display: grid;
          grid-template-columns: 1.6fr 1fr 1fr 1fr;
          gap: 40px;
          margin-bottom: 48px;
        }
        .footer-logo-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 800;
          margin-bottom: 12px;
        }
        .footer-desc-p {
          font-size: 14px;
          color: var(--n500);
          line-height: 1.6;
          max-width: 280px;
        }
        .footer-col-yv h4 {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-weight: 700;
          color: var(--n500);
          margin-bottom: 16px;
        }
        .footer-col-yv ul { display: flex; flex-direction: column; gap: 10px; }
        .footer-col-yv a, .footer-col-yv button {
          color: var(--n700);
          font-size: 14px;
          font-weight: 500;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
        }
        .footer-col-yv a:hover, .footer-col-yv button:hover {
          color: var(--orange-ink);
        }

        /* ── Mobile Responsive ─────────────────────────────────────── */
        @media (max-width: 1380px) {
          .nav-link-item { padding: 7px 9px; font-size: 13.5px; }
          .nav-capsule { gap: 8px; padding-left: 14px; padding-right: 8px; }
          .btn-find-work, .btn-apply-header { padding: 4px 4px 4px 13px; font-size: 13.5px; }
        }
        @media (max-width: 1240px) {
          .nav-menu-links { display: none; }
        }
        @media (max-width: 980px) {
          .hero-grid { grid-template-columns: 1fr; }
          .hero-deal-card-wrap { max-width: 100%; }
          .deal-floating-badge-top, .deal-floating-badge-bottom { display: none; }
          .statbar { grid-template-columns: 1fr; }
          .statbar > div { border-right: none; border-bottom: 1px solid var(--hair); }
          .stage-item { grid-template-columns: 1fr; }
          .barriers-grid { grid-template-columns: 1fr; }
          .cat-grid-yv { grid-template-columns: repeat(2, 1fr); }
          .calc-box-yv { grid-template-columns: 1fr; }
          .footer-grid-yv { grid-template-columns: 1fr 1fr; }
          .nav-actions-group .btn-find-work,
          .nav-actions-group .btn-apply-header,
          .nav-actions-group .nav-btn-login,
          .nav-actions-group .lang-capsule { display: none; }
          .btn-mobile-toggle { display: flex; }
        }
        @media (max-width: 640px) {
          .cat-grid-yv { grid-template-columns: 1fr; }
          .footer-grid-yv { grid-template-columns: 1fr; }
          .hero-cta { flex-direction: column; width: 100%; }
          .hero-cta a { width: 100%; justify-content: center; }
        }

        /* ── Reduced Motion Accessibility ──────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
          .grid-pattern,
          .aurora-a,
          .aurora-b,
          .aurora-c,
          .marquee-track,
          .deal-status-dot,
          .deal-floating-badge-top,
          .deal-floating-badge-bottom {
            animation: none !important;
          }
          .marquee-track {
            transform: none !important;
          }
          .marquee-container {
            overflow-x: auto;
          }
          .yv-job-card,
          .btn-primary,
          .btn-outline,
          .btn-find-work,
          .btn-apply-header,
          .hero-deal-card,
          .cat-card-yv {
            transition: none !important;
            transform: none !important;
          }
        }
      `}</style>

      <div className="yv-lp">
        {/* Dynamic Background Canvas */}
        <div className="ambient-canvas" aria-hidden="true">
          <div className="grid-pattern" />
          <div className="aurora-a" />
          <div className="aurora-b" />
          <div className="aurora-c" />
        </div>

        {/* ── FLOATING CAPSULE NAVBAR ───────────────────────────────── */}
        <header className="header-floating">
          <div className="nav-container">
            <nav className="nav-capsule" aria-label="Asosiy navigatsiya">
              <Link href="/" className="nav-brand" aria-label="Bobololadono">
                {/* next/image emas — landing o'z JSX/ranglarini alohida chizadi (CLAUDE.md), statik logotip, sobit o'lcham */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.png"
                  alt="Bobololadono"
                  className="nav-brand-icon"
                />
                <span className="nav-brand-title">Bobololadono</span>
              </Link>

              <div className="nav-menu-links">
                {navLinks.map((l) => (
                  <a key={l.href} href={l.href} className="nav-link-item">
                    {l.label}
                  </a>
                ))}
              </div>

              <div className="nav-actions-group">
                <div className="lang-capsule" role="group" aria-label={t("a11y.language")}>
                  {langOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setLang(opt)}
                      aria-pressed={lang === opt}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                <Link href={cabinetHref} className="nav-btn-login">
                  <span className="login-icon" aria-hidden="true">👤</span>
                  <span>{session ? tr("Kabinetga o'tish", "В кабинет", "Dashboard") : tr("Kirish", "Войти", "Log in")}</span>
                </Link>

                {/* Bosqich 24 — QA audit: ilgari `/bozor/ish-elonlari`ga
                    olib borardi — bu yo'l (Job/Proposal, "B yo'l") backend'da
                    hech qachon ulanmagan, sahifa doim ErrorState ko'rsatardi
                    (bosilsa doim ishlamaydigan tugma). Platformada mutaxassis
                    ish topishning HAQIQIY yo'li ro'yxatdan o'tib bozorda
                    ko'rinish (xaridor to'g'ridan-to'g'ri taklif yuboradi) —
                    "Mutaxassis bo'lish" CTA'si bilan bir xil manzilga. */}
                <Link href="/kirish?tab=register&role=mutaxassis" className="btn-find-work">
                  <span>{tr("Ish topish", "Найти работу", "Find jobs")}</span>
                  <span className="work-badge" aria-hidden="true">💼</span>
                </Link>

                <Link href="/kirish?tab=register&role=xaridor" className="btn-apply-header">
                  <span>{tr("E'lon berish", "Заказать", "Post a job")}</span>
                  <span className="arrow-badge" aria-hidden="true">↗</span>
                </Link>

                <button
                  type="button"
                  className="btn-mobile-toggle"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label={tr("Menyu", "Меню", "Menu")}
                  aria-expanded={menuOpen}
                  aria-controls="mobile-nav-dropdown"
                >
                  {menuOpen ? "✕" : "☰"}
                </button>
              </div>
            </nav>

            {/* Mobile Dropdown */}
            {menuOpen && (
              <div
                id="mobile-nav-dropdown"
                role="region"
                aria-label={tr("Mobil navigatsiya menyusi", "Мобильное меню навигации", "Mobile navigation menu")}
                style={{
                  background: "var(--card)",
                  borderRadius: 24,
                  border: "1px solid var(--hair)",
                  boxShadow: "var(--elev)",
                  padding: "20px 24px",
                  marginTop: 12,
                }}
              >
                {navLinks.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    style={{
                      display: "block",
                      padding: "12px 0",
                      fontSize: 16,
                      fontWeight: 600,
                      borderBottom: "1px solid var(--hair)",
                    }}
                  >
                    {l.label}
                  </a>
                ))}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                  {session ? (
                    <Link
                      href={cabinetHref}
                      className="btn-primary"
                      style={{ width: "100%", textAlign: "center", justifyContent: "center", minHeight: 48, padding: "0 20px" }}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span>👤 {tr("Kabinetga o'tish", "В кабинет", "Dashboard")}</span>
                      <span className="badge" aria-hidden="true">→</span>
                    </Link>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 10 }}>
                        <Link
                          href={cabinetHref}
                          className="btn-outline"
                          style={{ flex: 1, textAlign: "center", justifyContent: "center", minHeight: 46 }}
                          onClick={() => setMenuOpen(false)}
                        >
                          👤 {tr("Kirish", "Войти", "Log in")}
                        </Link>
                        <Link
                          href="/kirish?tab=register&role=mutaxassis"
                          className="btn-outline"
                          style={{ flex: 1, textAlign: "center", justifyContent: "center", minHeight: 46, borderColor: "rgba(20,20,20,0.15)", background: "#ffffff", fontWeight: 700 }}
                          onClick={() => setMenuOpen(false)}
                        >
                          💼 {tr("Ish topish", "Найти работу", "Find jobs")}
                        </Link>
                      </div>
                      <Link
                        href="/kirish?tab=register&role=xaridor"
                        className="btn-primary"
                        style={{ width: "100%", textAlign: "center", justifyContent: "center", minHeight: 48, padding: "0 20px" }}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span>{tr("E'lon berish", "Разместить заказ", "Post a job")}</span>
                        <span className="badge" aria-hidden="true">↗</span>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        <main id="main-content">
          {/* ── HERO SECTION ─────────────────────────────────────────── */}
          <section className="hero-section">
            <div className="container-yv">
              <div className="hero-grid">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <span className="eyebrow-pill" style={{ margin: 0 }}>
                      <span className="eyebrow-pill-dot" aria-hidden="true" />
                      {tr(
                        "Markaziy Osiyo raqamli xizmatlar bozori",
                        "Рынок цифровых услуг Центральной Азии",
                        "Central Asia Digital Services Marketplace"
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setHeroPaused((v) => !v)}
                      className="hero-pause-toggle"
                      aria-label={heroPaused ? tr("Sarlavhalar aylanishini yoqish", "Включить авторотацию", "Enable title rotation") : tr("Sarlavhalar aylanishini to'xtatish", "Приостановить авторотацию", "Pause title rotation")}
                      title={heroPaused ? tr("Aylantirish", "Возобновить", "Play") : tr("To'xtatish", "Пауза", "Pause")}
                    >
                      {heroPaused ? "▶" : "⏸"}
                    </button>
                  </div>

                  <h1
                    className="hero-title"
                    onMouseEnter={() => setHeroPaused(true)}
                    onMouseLeave={() => setHeroPaused(false)}
                    onFocus={() => setHeroPaused(true)}
                    onBlur={() => setHeroPaused(false)}
                    aria-live="polite"
                  >
                    <span>{headlines[headlineIndex].line1}</span>
                    <br />
                    <span className="accent-orange">{headlines[headlineIndex].line2}</span>
                  </h1>

                  <p className="hero-desc">
                    {tr(
                      "Xavfsiz bitimlar platformasi. Mablag'ingiz xavfsiz Escrow hisobida muzlatiladi va ish to'liq topshirilgandagina ijrochiga to'lanadi.",
                      "Платформа безопасных сделок. Средства надежно блокируются на счете Escrow и выплачиваются исполнителю только после полного приема работы.",
                      "Escrow-secured digital marketplace. Your budget is protected and released to the freelancer only upon your 100% satisfaction."
                    )}
                  </p>

                  <div className="hero-cta">
                    <Link href="/kirish?tab=register&role=xaridor" className="btn-primary">
                      <span>{tr("Buyurtma berish", "Разместить заказ", "Post a project")}</span>
                      <span className="badge" aria-hidden="true">↗</span>
                    </Link>
                    <Link href="/bozor?tab=jobs" className="btn-outline">
                      {tr("Buyurtmalarni ko'rish", "Смотреть заказы", "Explore jobs")}
                    </Link>
                  </div>

                  <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "8px 18px 8px 12px", borderRadius: 999, background: "var(--card)", border: "1px solid var(--hair)", boxShadow: "var(--elev-sm)" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: "var(--orange-ink)" }}>
                      100%
                    </span>
                    <span style={{ fontSize: 13.5, color: "var(--n500)", fontWeight: 600 }}>
                      {tr("Kafolatlangan Escrow xavfsizligi", "Гарантированная защита Escrow", "Guaranteed Escrow Protection")}
                    </span>
                  </div>
                </div>

                {/* Right Visual: Live Deal & Escrow Dashboard Card */}
                <div>
                  <div className="hero-deal-card-wrap">
                    {/* Floating Trust Badge 1 */}
                    <div className="deal-floating-badge-top" aria-hidden="true">
                      <span style={{ fontSize: 16 }}>⚡</span>
                      <span>{tr("Tezkor takliflar va saralash", "Быстрые отклики и подбор", "Fast proposals & talent matching")}</span>
                    </div>

                    <div className="hero-deal-card">
                      <div className="deal-card-header">
                        <div className="deal-status-pill">
                          <span className="deal-status-dot" aria-hidden="true" />
                          <span>{tr("Escrow bitimi namunasi", "Пример сделки в Escrow", "Escrow deal preview")}</span>
                        </div>
                        <div className="deal-escrow-badge">
                          <span aria-hidden="true">🛡️</span>
                          <span>100% Escrow</span>
                        </div>
                      </div>

                      <div className="deal-title-row">
                        <div className="deal-cat-tag">
                          {tr("FinTech / E-Tijorat", "FinTech / Э-Коммерция", "FinTech / E-Commerce")}
                        </div>
                        <h3 className="deal-project-title">
                          {tr(
                            "Payme & Click integratsiyali onlayn do'kon",
                            "Интернет-магазин с интеграцией Payme & Click",
                            "Online store with Payme & Click integration"
                          )}
                        </h3>
                      </div>

                      <div className="deal-budget-box">
                        <span className="deal-budget-label">
                          {tr("Muzlatilgan kafolat depoziti:", "Защищенный депозит:", "Escrow deposit:")}
                        </span>
                        <span className="deal-budget-value">8,500,000 UZS</span>
                      </div>

                      <div className="deal-parties-grid">
                        <div className="deal-party-card">
                          <div className="party-avatar buyer">AQ</div>
                          <div style={{ overflow: "hidden" }}>
                            <div className="party-name">Azamat Q.</div>
                            <div className="party-role">
                              {tr("Xaridor (Verified)", "Заказчик (Verified)", "Client (Verified)")}
                            </div>
                          </div>
                        </div>

                        <div className="deal-parties-arrow" aria-hidden="true">⇄</div>

                        <div className="deal-party-card">
                          <div className="party-avatar freelancer">DR</div>
                          <div style={{ overflow: "hidden" }}>
                            <div className="party-name">Diyora R.</div>
                            <div className="party-role">⭐ 4.99 • Senior UI/UX</div>
                          </div>
                        </div>
                      </div>

                      <div className="deal-milestone-list">
                        <div className="deal-milestone-step">
                          <div className="milestone-left">
                            <span>✓</span>
                            <span>
                              {tr("Depozit Escrow hisobida muzlatildi", "Депозит заблокирован в Escrow", "Deposit locked in Escrow")}
                            </span>
                          </div>
                          <span className="milestone-status escrow">8,500,000 UZS</span>
                        </div>
                        <div className="deal-milestone-step">
                          <div className="milestone-left">
                            <span>✓</span>
                            <span>
                              {tr("Sayt dizayni va arxitekturasi topshirildi", "Дизайн и код согласованы", "Design & code approved")}
                            </span>
                          </div>
                          <span className="milestone-status done">
                            {tr("Qabul qilindi", "Принято", "Approved")}
                          </span>
                        </div>
                        <div className="deal-milestone-step">
                          <div className="milestone-left">
                            <span>⏳</span>
                            <span>
                              {tr("Yakuniy to'lov ijrochiga o'tkazilmoqda", "Выплата исполнителю", "Payout to specialist")}
                            </span>
                          </div>
                          <span className="milestone-status" style={{ color: "var(--n500)" }}>
                            {tr("Jarayonda", "В процессе", "In progress")}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Floating Trust Badge 2 */}
                    <div className="deal-floating-badge-bottom" aria-hidden="true">
                      <span style={{ color: "var(--lime)" }}>🔒</span>
                      <span>{tr("Natija tekshirilgach to'lanadi", "Выплата только после проверки", "Payment released upon approval")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── STATBAR (Halol va tasdiqlangan afzalliklar) ───────────── */}
          <section className="statbar-wrap">
            <dl className="nav-container statbar">
              <div>
                <dt>100%</dt>
                <dd>
                  <span>{tr("Escrow himoyasi", "Защита средств Escrow", "Escrow protection")}</span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--n500)", margin: "6px 0 0", textTransform: "none", letterSpacing: "normal", fontWeight: 400 }}>
                    {tr("Mablag' qabul qilinguncha xavfsiz muzlatiladi", "Средства надежно резервируются до приемки", "Funds safely held until your approval")}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="highlight">0%</dt>
                <dd>
                  <span>{tr("Xaridor komissiyasi", "Комиссия заказчика", "Client platform fee")}</span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--n500)", margin: "6px 0 0", textTransform: "none", letterSpacing: "normal", fontWeight: 400 }}>
                    {tr("Xaridor uchun xizmat mutlaqo bepul", "Для заказчика сервис абсолютно бесплатный", "Zero platform fee for clients")}
                  </span>
                </dd>
              </div>
              <div>
                <dt>100%</dt>
                <dd>
                  <span>{tr("Elektron shartnoma", "Электронный договор", "Legal digital contract")}</span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--n500)", margin: "6px 0 0", textTransform: "none", letterSpacing: "normal", fontWeight: 400 }}>
                    {tr("Har bir buyurtma uchun avtomatik shartnoma", "Каждая сделка оформляется договором", "Every milestone backed by formal agreement")}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          {/* ── STAGES: SUPPORT FOR YOUR STAGE (01, 02, 03) ────────────── */}
          <section className="stages-section" id="stages">
            <div className="container-yv">
              <span className="eyebrow-pill">
                <span className="eyebrow-pill-dot" aria-hidden="true" />
                {tr("Ish jarayoni", "Процесс работы", "Process")}
              </span>
              <h2 className="section-title">
                {tr("Har bir bosqichda to'liq nazorat", "Простые шаги к результату", "Simple steps to success")}
              </h2>

              <ul className="stage-list">
                <li className="stage-item">
                  <span className="stage-num">01</span>
                  <h3 className="stage-head">
                    {tr("E'lon va talablar", "Размещение заказа", "Post requirements")}
                  </h3>
                  <p className="stage-desc">
                    {tr(
                      "Loyihangiz tavsifi va byudjetini kiriting. Sara mutaxassislar bir necha daqiqada o'z takliflarini berishadi.",
                      "Опишите задачу и бюджет. Проверенные специалисты предложат решения в течение нескольких минут.",
                      "Describe your task and budget. Vetted specialists will submit proposals within minutes."
                    )}
                  </p>
                </li>

                <li className="stage-item">
                  <span className="stage-num">02</span>
                  <h3 className="stage-head">
                    {tr("Escrow muzlatish", "Заморозка средств", "Escrow deposit")}
                  </h3>
                  <p className="stage-desc">
                    {tr(
                      "Mablag' xavfsiz Escrow hisobida ushlab turiladi. Mutaxassis to'lov kafolatlanganini bilgan holda ishga kirishadi.",
                      "Средства безопасно резервируются сервисом. Исполнитель приступает к работе, зная, что оплата гарантирована.",
                      "Funds are safely reserved in Escrow. The specialist starts work knowing payment is guaranteed."
                    )}
                  </p>
                </li>

                <li className="stage-item lime-card">
                  <span className="stage-num">03</span>
                  <h3 className="stage-head">
                    {tr("Tasdiqlash va to'lov", "Приемка и выплата", "Review & payout")}
                  </h3>
                  <p className="stage-desc">
                    {tr(
                      "Siz natijani to'liq tekshirib qabul qilasiz. Pul faqat siz tasdiqlaganingizdan keyingina mutaxassisga o'tkaziladi.",
                      "Вы проверяете результат. Деньги переводятся специалисту только после вашего окончательного подтверждения.",
                      "You review and approve the result. Money is released to the specialist only after your confirmation."
                    )}
                  </p>
                </li>
              </ul>
            </div>
          </section>

          {/* ── STRIKETHROUGH STEREOTYPES (Yoshlar Ventures uslubi) ─────── */}
          <section className="barriers-section">
            <div className="container-yv barriers-grid">
              <ul className="strike-list">
                <li className="strike-item">
                  {tr("«Mutaxassis pulni olib yo'qolsa-chi?»", "«А вдруг исполнитель исчезнет?»", "“What if the freelancer disappears?”")}
                </li>
                <li className="strike-item">
                  {tr("«Sifatsiz ish topshirilsa-chi?»", "«Сделают не то, что просили»", "“What if the work is unsatisfactory?”")}
                </li>
                <li className="strike-item">
                  {tr("«Qayerdan ishonchli odam topaman?»", "«У меня нет времени на споры»", "“Where do I find trusted talent?”")}
                </li>
              </ul>

              <div>
                <h2 className="section-title" style={{ fontSize: "clamp(28px, 4vw, 46px)" }}>
                  {tr("Bularning bari ortda qoldi", "Никаких рисков с Bobololadono", "Zero risks with Bobololadono")}
                </h2>
                <p style={{ margin: "18px 0 28px", fontSize: 17, lineHeight: 1.65, color: "var(--n700)" }}>
                  {tr(
                    "Bizning 100% Escrow kafolati va mustaqil hakamlik tizimimiz har bir so'mingiz himoyada bo'lishini ta'minlaydi. Faqat sifatli natija uchun to'laysiz.",
                    "Наша система Escrow и независимый арбитраж гарантируют, что ни один сум не пропадет зря. Вы платите только за реальный результат.",
                    "Our 100% Escrow protection and independent dispute resolution ensure every soum is safe. You only pay for verified results."
                  )}
                </p>
                <Link href="/kirish?tab=register&role=xaridor" className="btn-primary">
                  <span>{tr("Xavfsiz boshlash", "Начать без риска", "Start risk-free")}</span>
                  <span className="badge" aria-hidden="true">↗</span>
                </Link>
              </div>
            </div>
          </section>

          {/* ── MARQUEE PORTFOLIO / RECENT JOBS ───────────────────────── */}
          <section className="stages-section" id="portfolio" style={{ paddingBottom: 30 }}>
            <div className="container-yv" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 36, flexWrap: "wrap", gap: 16 }}>
              <div>
                <span className="eyebrow-pill">
                  <span className="eyebrow-pill-dot" aria-hidden="true" />
                  {tr("Bozor talabi", "Лента заказов", "Marketplace demand")}
                </span>
                <h2 className="section-title" style={{ margin: 0 }}>
                  {tr("Ommabop loyihalar oqimi", "Популярные проекты и направления", "Trending marketplace projects")}
                </h2>
              </div>
              <Link
                href="/bozor?tab=jobs"
                className="btn-outline"
                style={{ display: "inline-flex", minHeight: 44, padding: "0 22px", borderRadius: 999 }}
              >
                {tr("Barcha e'lonlarni ko'rish ↗", "Все заказы ↗", "Explore all jobs ↗")}
              </Link>
            </div>

            <div className="marquee-container">
              <div className="marquee-track">
                {/* 1-loop */}
                {portfolioItems.map((item) => (
                  <Link
                    href="/bozor?tab=jobs"
                    key={item.num}
                    className="yv-job-card"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <span className="card-big-num" aria-hidden="true" data-num={item.num} />
                    <div>
                      <div className="card-tag">{item.category}</div>
                      <h3 className="card-job-title">{item.title}</h3>
                      <p className="card-job-desc">{item.desc}</p>
                    </div>
                    <div className="card-job-footer">
                      <div>
                        <div style={{ fontSize: 11.5, color: "var(--n500)", textTransform: "uppercase", fontWeight: 700 }}>
                          {tr("Byudjet", "Бюджет", "Budget")}
                        </div>
                        <div className="card-job-amount">{item.budget}</div>
                      </div>
                      <span className="card-bid-pill">
                        {tr(`${item.bids} ta taklif`, `${item.bids} откликов`, `${item.bids} proposals`)}
                      </span>
                    </div>
                  </Link>
                ))}
                {/* 2-loop (infinite marquee seamless effect) */}
                {portfolioItems.map((item) => (
                  <Link
                    href="/bozor?tab=jobs"
                    key={`loop-${item.num}`}
                    className="yv-job-card"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <span className="card-big-num" aria-hidden="true" data-num={item.num} />
                    <div>
                      <div className="card-tag">{item.category}</div>
                      <h3 className="card-job-title">{item.title}</h3>
                      <p className="card-job-desc">{item.desc}</p>
                    </div>
                    <div className="card-job-footer">
                      <div>
                        <div style={{ fontSize: 11.5, color: "var(--n500)", textTransform: "uppercase", fontWeight: 700 }}>
                          {tr("Byudjet", "Бюджет", "Budget")}
                        </div>
                        <div className="card-job-amount">{item.budget}</div>
                      </div>
                      <span className="card-bid-pill">
                        {tr(`${item.bids} ta taklif`, `${item.bids} откликов`, `${item.bids} proposals`)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* ── CATEGORIES (Yo'nalishlar) ─────────────────────────────── */}
          <section className="stages-section" id="categories" style={{ paddingTop: 30 }}>
            <div className="container-yv">
              <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
                <span className="eyebrow-pill">
                  <span className="eyebrow-pill-dot" aria-hidden="true" />
                  {tr("Xizmat toifalari", "Направления", "Categories")}
                </span>
                <h2 className="section-title">
                  {tr("Istalgan sohadagi professionallar", "Все сферы цифровых услуг", "Experts across all digital fields")}
                </h2>
              </div>

              <div className="cat-grid-yv">
                {categoriesList.map((c) => (
                  <Link href={`/bozor?tab=services&category=${c.key}`} key={`${c.key}-${c.title}`} className="cat-card-yv">
                    <div>
                      <div className="cat-icon-wrap">
                        <span style={{ fontSize: 20 }}>{c.icon}</span>
                      </div>
                      <h3>{c.title}</h3>
                      <p>{c.count}</p>
                    </div>
                    <div className="cat-card-bottom">
                      <span>{c.price}</span>
                      <span aria-hidden="true">↗</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* ── ESCROW CALCULATOR ─────────────────────────────────────── */}
          <section className="stages-section" id="security" style={{ background: "var(--warm)" }}>
            <div className="container-yv">
              <div className="calc-box-yv">
                <div>
                  <span className="eyebrow-pill">
                    <span className="eyebrow-pill-dot" aria-hidden="true" />
                    {tr("Kalkulyator", "Калькулятор", "Calculator")}
                  </span>
                  <h2 className="section-title" style={{ fontSize: "clamp(28px, 4vw, 44px)" }}>
                    {tr("Shaffof hisob-kitob va kafolat", "Рассчитайте бюджет сделки", "Transparent pricing & guarantee")}
                  </h2>
                  <p style={{ color: "var(--n500)", fontSize: 16, lineHeight: 1.65 }}>
                    {tr(
                      "Hech qanday yashirin komissiyalarsiz. Xaridor uchun xizmat haqi 0%. Mablag' to'liq xavfsiz hisobda muzlatiladi.",
                      "Никаких скрытых комиссий. Для заказчика комиссия 0%. Escrow блокирует всю сумму до финала.",
                      "No hidden fees. 0% platform fee for clients. Escrow locks the entire budget securely until final delivery."
                    )}
                  </p>
                </div>

                <div style={{ background: "var(--card)", padding: 32, borderRadius: 24, border: "1px solid var(--hair)" }}>
                  <label
                    htmlFor="escrow-calc-slider"
                    style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--n500)", cursor: "pointer" }}
                  >
                    {tr("Loyiha summasi", "Сумма проекта", "Project budget")}
                  </label>
                  <div
                    style={{ fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 800, color: "var(--orange-ink)", margin: "8px 0" }}
                    aria-live="polite"
                  >
                    {formatSum(calcBudget)} UZS
                  </div>
                  <input
                    id="escrow-calc-slider"
                    type="range"
                    min={500000}
                    max={20000000}
                    step={500000}
                    value={calcBudget}
                    onChange={(e) => setCalcBudget(Number(e.target.value))}
                    aria-label={tr("Loyiha summasi", "Сумма проекта", "Project budget")}
                    aria-valuemin={500000}
                    aria-valuemax={20000000}
                    aria-valuenow={calcBudget}
                    aria-valuetext={`${formatSum(calcBudget)} UZS`}
                    className="calc-slider-input"
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--hair)", paddingTop: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                      <span style={{ color: "var(--n500)" }}>{tr("Xaridor to'lovi:", "Оплата заказчика:", "Client pays:")}</span>
                      <strong>{formatSum(calcBudget)} UZS</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                      <span style={{ color: "var(--n500)" }}>{tr("Escrow himoyasi:", "Защита Escrow:", "Escrow protection:")}</span>
                      <strong style={{ color: "var(--orange-ink)" }}>
                        {tr("100% Kafolatlangan", "100% Гарантировано", "100% Guaranteed")}
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                      <span style={{ color: "var(--n500)" }}>{tr("Platforma xizmati:", "Комиссия платформы:", "Platform fee:")}</span>
                      <span style={{ color: "var(--n700)", fontWeight: 600 }}>{formatSum(platformFee)} UZS</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800 }}>
                      <span>{tr("Mutaxassis oladi:", "Исполнитель получит:", "Specialist receives:")}</span>
                      <span style={{ color: "var(--ink)" }}>{formatSum(specialistShare)} UZS</span>
                    </div>
                  </div>
                  <p style={{ color: "var(--n500)", fontSize: 13, marginTop: 16, textAlign: "center", borderTop: "1px dashed var(--hair)", paddingTop: 14 }}>
                    {tr(
                      "To'lovlar Payme, Click va Uzum orqali xavfsiz qabul qilinadi. Escrow depoziti ish qabul qilinguncha kafolatlanadi.",
                      "Платежи безопасно проводятся через Payme, Click и Uzum. Депозит застрахован до полного приема работы.",
                      "Payments are securely processed via Payme, Click, and Uzum. Escrow deposits are held safely until completion."
                    )}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── FAQ ───────────────────────────────────────────────────── */}
          <section className="stages-section" id="faq">
            <div className="container-yv">
              <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto" }}>
                <span className="eyebrow-pill">
                  <span className="eyebrow-pill-dot" aria-hidden="true" />
                  {t("faq_tag")}
                </span>
                <h2 className="section-title">{t("faq_h2")}</h2>
              </div>

              <div className="faq-box-yv">
                {faqs.map((f, i) => {
                  const open = openFaq === i;
                  return (
                    <div key={f.q} className="faq-row" data-open={open}>
                      <button
                        type="button"
                        id={`faq-trigger-${i}`}
                        className="faq-trigger-btn"
                        onClick={() => setOpenFaq(open ? null : i)}
                        aria-expanded={open}
                        aria-controls={`faq-answer-${i}`}
                      >
                        <span>{f.q}</span>
                        <span className="faq-icon-cross" aria-hidden="true">+</span>
                      </button>
                      {open && (
                        <div id={`faq-answer-${i}`} role="region" aria-labelledby={`faq-trigger-${i}`}>
                          <p className="faq-content-p">{f.a}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ textAlign: "center", marginTop: 32 }}>
                <button
                  type="button"
                  onClick={() => openSupportModal({ source: "faq" })}
                  className="btn-outline"
                  style={{ minHeight: 46, fontSize: 14 }}
                >
                  {t("faq_still_need_help")} {t("faq_ask_support")} ↗
                </button>
              </div>
            </div>
          </section>

          {/* ── FINAL CALL TO ACTION ──────────────────────────────────── */}
          <section className="cta-final-yv">
            <div className="container-yv">
              <span className="eyebrow-pill">
                <span className="eyebrow-pill-dot" aria-hidden="true" />
                Bobololadono
              </span>
              <h2 className="cta-final-title">
                {tr(
                  "Keyingi loyihangizni bugun xavfsiz boshlang",
                  "Начните ваш следующий проект прямо сейчас",
                  "Start your next project safely today"
                )}
              </h2>
              <p style={{ fontSize: 18, color: "var(--n500)", maxWidth: 520, margin: "0 auto 36px" }}>
                {tr(
                  "E'lon joylashtiring va bir necha daqiqada sara mutaxassislardan takliflar oling.",
                  "Разместите задачу за 2 минуты и получите первые отклики проверенных специалистов.",
                  "Post your task in 2 minutes and get proposals from top verified experts."
                )}
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
                <Link href="/kirish?tab=register&role=xaridor" className="btn-primary">
                  <span>{tr("E'lon berish", "Разместить заказ", "Post a job")}</span>
                  <span className="badge" aria-hidden="true">↗</span>
                </Link>
                <Link href="/kirish?tab=register&role=mutaxassis" className="btn-outline">
                  {tr("Mutaxassis bo'lish", "Стать исполнителем", "Become a specialist")}
                </Link>
              </div>
            </div>
          </section>
        </main>

        {/* ── FOOTER ────────────────────────────────────────────────── */}
        <footer className="footer-yv">
          <div className="container-yv">
            <div className="footer-grid-yv">
              <div>
                <div className="footer-logo-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- landing o'z JSX'ini alohida chizadi, statik logotip */}
                  <img
                    src="/logo.png"
                    alt="Bobololadono"
                    height={32}
                    style={{ height: 32, width: "auto", objectFit: "contain", display: "block" }}
                  />
                  <span>Bobololadono</span>
                </div>
                <p className="footer-desc-p">{t("foot_desc")}</p>
              </div>

              <div className="footer-col-yv">
                <h4>{t("f_product")}</h4>
                <ul>
                  <li><a href="#portfolio">{tr("Buyurtmalar", "Проекты", "Projects")}</a></li>
                  <li><a href="#stages">{t("f_how")}</a></li>
                  <li><a href="#categories">{t("nav_cats")}</a></li>
                </ul>
              </div>

              <div className="footer-col-yv">
                <h4>{t("f_legal")}</h4>
                <ul>
                  <li><Link href="/shartlar">{t("f_terms")}</Link></li>
                  <li><Link href="/maxfiylik">{t("f_privacy")}</Link></li>
                  <li><Link href="/oferta">{t("f_offer")}</Link></li>
                </ul>
              </div>

              <div className="footer-col-yv">
                <h4>{t("f_support")}</h4>
                <ul>
                  <li><Link href="/savol-javob">{t("f_faq")}</Link></li>
                  <li><Link href="/yordam-markazi">{t("f_help")}</Link></li>
                  <li>
                    <button type="button" onClick={() => openSupportModal({ source: "footer" })}>
                      {t("f_contact_us")}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          window.dispatchEvent(new CustomEvent("bobololadono:open-feedback"));
                        }
                      }}
                      className="cursor-pointer hover:underline"
                    >
                      {t("foot.feedback")}
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--hair)", paddingTop: 24, fontSize: 13, color: "var(--n500)", flexWrap: "wrap", gap: 14 }}>
              <div>&copy; 2026 Bobololadono. {t("foot_rights")}</div>
              <div className="lang-capsule" role="group" aria-label={t("a11y.language")}>
                {langOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setLang(opt)}
                    aria-pressed={lang === opt}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
