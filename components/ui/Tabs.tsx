"use client";

import { useId, useRef } from "react";

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  /** "lg" — kengroq ekranlarda (xl+) yirikroq nishonlar; kichik ekranlarda "md" bilan bir xil */
  size?: "md" | "lg";
  /** Only use tab semantics when the caller owns an associated content panel. */
  panelId?: string;
  idPrefix?: string;
}

export function Tabs({ items, value, onChange, size = "md", panelId, idPrefix }: TabsProps) {
  const generatedId = useId();
  const prefix = idPrefix ?? generatedId;
  const listRef = useRef<HTMLDivElement>(null);

  /* WAI-ARIA tab naqshi klaviatura bilan yurishni talab qiladi: strelkalar
     bilan tab'lar orasida o'tiladi, Home/End chetlarga sakraydi. Ilgari
     role="tab" e'lon qilingan, lekin bu xatti-harakat yo'q edi. */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key) || items.length === 0) return;
    e.preventDefault();
    const index = items.findIndex((item) => item.value === value);
    const current = index < 0 ? 0 : index;
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    onChange(items[next].value);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-tab-value]');
    buttons?.[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role={panelId ? "tablist" : "group"}
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            id={`${prefix}-tab-${item.value}`}
            data-tab-value={item.value}
            role={panelId ? "tab" : undefined}
            aria-selected={panelId ? active : undefined}
            aria-pressed={panelId ? undefined : active}
            aria-controls={panelId}
            /* Roving tabindex: tab ro'yxatiga bitta Tab bosishda kiriladi */
            tabIndex={active || (!items.some((entry) => entry.value === value) && item === items[0]) ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors duration-150 ${
              size === "lg" ? "xl:px-4 xl:py-3 xl:text-base" : ""
            } ${
              active
                ? "border-primary font-medium text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {item.label}
            {typeof item.count === "number" && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-2xs ${
                  size === "lg" ? "xl:px-2 xl:py-0.5 xl:text-xs" : ""
                } ${
                  active ? "bg-primary/10 text-primary-deep" : "bg-card-hover text-faint"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
