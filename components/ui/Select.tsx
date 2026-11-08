"use client";

import { forwardRef, useId, type SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { label, error, options, placeholder, id, className = "", "aria-describedby": describedBy, ...rest },
    ref
  ) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const messageId = `${inputId}-msg`;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-muted">
            {label}
          </label>
        )}
        {/* `appearance-none` tizim strelkasini olib tashlaydi — o'rniga o'z
            chevron'imizni chizamiz, aks holda tanlash maydoni oddiy matn
            maydonidan farq qilmaydi va bosish mumkinligi bilinmaydi. */}
        <div className="relative">
        <select
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={[describedBy, error ? messageId : undefined].filter(Boolean).join(" ") || undefined}
          className={`h-10 w-full appearance-none rounded-input border bg-card pl-3 pr-9 text-sm text-ink transition-colors duration-150 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
            error ? "border-danger" : "border-field"
          } ${className}`}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {error && (
          <p id={messageId} className="text-2xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);
