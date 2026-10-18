import Link from 'next/link';

/** TransVerse mark: two lanes converging into a route chevron. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  // The wrapper carries seasonal badges (a pumpkin at Halloween) via CSS.
  return (
    <span className="brand-mark inline-flex shrink-0">
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <defs>
          <linearGradient id="tv-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#2f7bff" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="12" fill="#0e131b" stroke="#263347" />
        <path d="M10 34 L22 14 L26 14 L16 34 Z" fill="url(#tv-mark)" />
        <path d="M22 34 L34 14 L38 14 L28 34 Z" fill="#f6c343" />
        <circle cx="36" cy="34" r="3" fill="#22d3ee" />
      </svg>
    </span>
  );
}

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="TransVerse — начало">
      <LogoMark />
      <span className="font-display text-lg font-bold tracking-tight">
        Trans<span className="text-cyan-glow">Verse</span>
      </span>
    </Link>
  );
}
