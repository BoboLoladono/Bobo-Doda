"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "@/lib/i18n";

type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastContextValue {
  toast: (text: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((text: string, kind: ToastKind = "success") => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, kind, text }]);

  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        /* Xatolar darhol e'lon qilinishi kerak — "polite" navbatda kutib
           qolardi va foydalanuvchi xatoni eshitmasligi mumkin edi. */
        aria-live={items.some((i) => i.kind === "error") ? "assertive" : "polite"}
        className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
      >
        {items.map((item) => (
          <ToastMessage key={item.id} item={item} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastMessage({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(item.kind === "error" ? 7000 : 3500);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, item.id, dismiss]);
  return (
          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
            }}
            role={item.kind === "error" ? "alert" : "status"}
            className={`sb-fade-in pointer-events-auto flex items-center gap-3 rounded-card border bg-card px-4 py-3 text-sm shadow-overlay ${
              item.kind === "success"
                ? "border-success/40 text-ink"
                : "border-danger/40 text-ink"
            }`}
          >
            {item.kind === "success" ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                <circle cx="8" cy="8" r="7" stroke="#15803D" strokeWidth="1.5" />
                <path d="M5 8.3 7 10.3 11 5.8" stroke="#15803D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                <circle cx="8" cy="8" r="7" stroke="#DC2626" strokeWidth="1.5" />
                <path d="M8 4.5v4M8 11v.5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            <span className="flex-1">{item.text}</span>
            <ToastDismiss onClick={() => dismiss(item.id)} />
          </div>
  );
}

/* Yopish tugmasi — avtomatik yo'qolishini kutmasdan olib tashlash uchun.
   Alohida komponent, chunki `useT` faqat client komponentda ishlaydi. */
function ToastDismiss({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("a11y.dismissToast")}
      className="-mr-1 shrink-0 rounded p-1 text-faint transition-colors duration-150 hover:text-ink"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
