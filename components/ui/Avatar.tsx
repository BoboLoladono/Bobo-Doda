import { useState } from "react";
import { initials } from "@/lib/format";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-2xs",
  md: "h-10 w-10 text-xs",
  lg: "h-16 w-16 text-lg",
  xl: "h-20 w-20 text-xl",
  "2xl": "h-24 w-24 text-2xl",
};

export function Avatar({ name, src, size = "md", className = "" }: AvatarProps) {
  const [imageError, setImageError] = useState(false);

  if (src && !imageError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        onError={() => setImageError(true)}
        className={`shrink-0 rounded-full object-cover ${sizeClasses[size]} ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading font-bold text-primary-deep ${sizeClasses[size]} ${className}`}
    >
      {initials(name)}
    </span>
  );
}
