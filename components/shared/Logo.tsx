import Link from "next/link";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    // next/image emas — logotip bir necha o'lchamda (nav, TopNav, auth) qayta
    // ishlatiladi; statik PNG, ulash qulayligi LCP xavfidan ustun.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Logo mark"
      style={{ height: size, width: "auto", objectFit: "contain" }}
      className="shrink-0"
    />
  );
}

export function Logo({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center gap-2 sm:gap-2.5 select-none ${className}`}
      aria-label="Bobololadono"
    >
      <LogoMark size={28} />
      <span className="shrink-0 font-heading text-sm sm:text-base font-extrabold tracking-tight text-ink whitespace-nowrap">
        Bobololadono
      </span>
    </Link>
  );
}
