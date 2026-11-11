"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, error, hint, id, className = "", "aria-describedby": describedBy, ...rest }, ref) {
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
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={[describedBy, error || hint ? messageId : undefined].filter(Boolean).join(" ") || undefined}
          rows={rest.rows ?? 4}
          className={`w-full rounded-input border bg-card px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors duration-150 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
            error ? "border-danger" : "border-field"
          } ${className}`}
          {...rest}
        />
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
  }
);
