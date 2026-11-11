"use client";

import { useRef, useState } from "react";
import { useT } from "@/lib/i18n";

/** Xavfsizlik: rasm turlari va hujjatlar (2MB gacha — localStorage DoS himoyasi) */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const ALLOWED_DOC_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "text/plain",
];

export interface FileUploadProps {
  label?: string;
  /** base64 data-URL ro'yxati */
  value: string[];
  onChange: (files: string[]) => void;
  max?: number;
  maxBytes?: number;
  error?: string;
  /** Texnik topshiriq (TZ), shartnoma yoki nizo dalillari uchun PDF/Word hujjatlariga ruxsat */
  acceptDocs?: boolean;
}

export function FileUpload({
  label,
  value,
  onChange,
  max = 5,
  maxBytes = DEFAULT_MAX_BYTES,
  error,
  acceptDocs = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState("");
  const { t } = useT();

  const allowedTypes = acceptDocs
    ? [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES]
    : ALLOWED_IMAGE_TYPES;

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setFileError("");
    const remaining = max - value.length;
    const picked = Array.from(files).slice(0, remaining);
    /* Tur va hajm tekshiruvi — noto'g'ri fayllar rad etiladi */
    const valid = picked.filter(
      (f) =>
        (allowedTypes.includes(f.type) ||
          (acceptDocs && /\.(pdf|docx?|xlsx?|zip|txt)$/i.test(f.name))) &&
        f.size <= maxBytes
    );
    if (valid.length < picked.length) setFileError(t("upload.rejected"));
    if (!valid.length) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    Promise.all(
      valid.map(
        (file) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          })
      )
    ).then((results) => {
      const images = results.filter((src): src is string => !!src);
      if (images.length) onChange([...value, ...images]);
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  const full = value.length >= max;

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-xs font-medium text-muted">{label}</span>}
      <div className="flex flex-wrap gap-3">
        {value.map((src, i) => {
          const isImg = src.startsWith("data:image/") || /\.(png|jpe?g|webp)$/i.test(src);
          const docType = src.includes("application/pdf")
            ? "PDF"
            : src.includes("zip")
            ? "ZIP"
            : src.includes("word") || src.includes("document")
            ? "DOC"
            : src.includes("sheet") || src.includes("excel")
            ? "XLS"
            : "FAYL";

          return (
            <div key={i} className="group relative">
              {isImg ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={src}
                  alt={t("a11y.image").replace("{n}", String(i + 1))}
                  className="h-20 w-20 rounded-input border border-line object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-input border border-primary/20 bg-primary/5 p-2 text-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-primary">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate max-w-[60px] font-mono text-3xs font-bold text-primary uppercase">
                    {docType}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                aria-label={t("upload.remove")}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-card text-2xs text-muted transition-colors duration-150 hover:text-danger shadow-xs after:absolute after:-inset-3 after:content-[''] focus:outline-hidden focus:ring-2 focus:ring-primary/40"
              >
                ×
              </button>
            </div>
          );
        })}
        {!full && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-input border border-dashed border-line bg-card text-muted transition-colors duration-150 hover:border-primary hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="px-1 text-center text-2xs">{t("upload.cta")}</span>
          </button>
        )}
      </div>
      <p className="text-2xs text-faint" aria-live="polite">
        {full ? t("upload.limit") : `${t("upload.hint")} · ${value.length}/${max}`}
      </p>
      {(fileError || error) && (
        <p className="text-2xs text-danger" role="alert">
          {fileError || error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={
          acceptDocs
            ? "image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.xlsx,.zip,text/plain"
            : "image/png,image/jpeg,image/webp"
        }
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
