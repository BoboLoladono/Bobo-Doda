"use client";

import { useT } from "@/lib/i18n";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** i18n yorliqlari; berilmasa inglizcha standart */
  labels?: { prev?: string; next?: string; page?: string; nav?: string };
  className?: string;
}

/* Ko'rinadigan sahifa raqamlari oynasi: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

/* Accessible pagination — <nav>, faol sahifada aria-current, chetlarda
   prev/next disabled. Server yoki client — onChange orqali backend-ready. */
export function Pagination({
  page,
  totalPages,
  onChange,
  labels,
  className = "",
}: PaginationProps) {
  const { t } = useT();
  if (totalPages <= 1) return null;
  const prev = labels?.prev ?? "Previous";
  const next = labels?.next ?? "Next";
  const pageWord = labels?.page ?? "Page";

  const btn =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-btn border border-line px-2.5 text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <nav aria-label={labels?.nav ?? t("a11y.pagination")} className={`flex items-center justify-center gap-1.5 ${className}`}>
      <button
        type="button"
        className={`${btn} text-muted hover:text-ink`}
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label={prev}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} aria-hidden="true" className="px-1 text-faint">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`${pageWord} ${p}`}
            className={`${btn} ${
              p === page
                ? "border-primary bg-primary/15 font-semibold text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        className={`${btn} text-muted hover:text-ink`}
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label={next}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </nav>
  );
}
