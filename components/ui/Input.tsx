"use client";

import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";

import { useT } from "@/lib/i18n";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  disablePasswordToggle?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className = "", "aria-describedby": describedBy, type, disablePasswordToggle, ...rest },
  ref
) {
  const { t } = useT();
  const autoId = useId();
  const inputId = id ?? autoId;
  /* Xato/izoh matni maydon bilan BOG'LANADI — aks holda skrinrider
     maydonga fokuslanganda xatoni umuman o'qimaydi (WCAG 3.3.1). */
  const messageId = `${inputId}-msg`;
  const isPassword = type === "password" && !disablePasswordToggle;
  const [showPassword, setShowPassword] = useState(false);

  const resolvedType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-muted">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          aria-invalid={!!error}
          aria-describedby={[describedBy, error || hint ? messageId : undefined].filter(Boolean).join(" ") || undefined}
          className={`h-10 w-full rounded-input border bg-card px-3 text-sm text-ink placeholder:text-faint transition-colors duration-150 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
            error ? "border-danger" : "border-field"
          } ${isPassword ? "pr-11" : ""} ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={0}
            disabled={rest.disabled}
            aria-controls={inputId}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
            title={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
            className="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-input text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 transition-colors disabled:opacity-40 disabled:pointer-events-none touch-manipulation"
          >
            {showPassword ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {error ? (
        <p id={messageId} className="text-2xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-2xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export { PasswordInput } from "./PasswordInput";
