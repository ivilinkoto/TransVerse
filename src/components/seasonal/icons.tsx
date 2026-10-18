/** Original seasonal artwork (Halloween): small SVG icons and decorations. */

export function PumpkinIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 6c-1-2.4-.4-4 1.6-4.6l.5 1.6c-.9.3-1.1 1-.6 2.4z" fill="#4d7c0f" />
      <ellipse cx="10.5" cy="18" rx="7.5" ry="10" fill="#ea580c" />
      <ellipse cx="21.5" cy="18" rx="7.5" ry="10" fill="#ea580c" />
      <ellipse cx="16" cy="18" rx="6.5" ry="10.5" fill="#f97316" />
      <path d="M10 15l3 2.5-3.5.5zM22 15l-3 2.5 3.5.5z" fill="#1c1917" />
      <path d="M9.5 21.5c2 2.4 4.3 3.2 6.5 3.2s4.5-.8 6.5-3.2l-2 .4-1.4 1.2-1.4-1.2-1.7 1.4-1.7-1.4-1.4 1.2-1.4-1.2z" fill="#1c1917" />
    </svg>
  );
}

export function BatIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 24" className={className} aria-hidden="true">
      <path
        d="M24 9c1.2-2.6 2.4-3.6 2.4-3.6.4 1.4.4 2.4.4 2.4 3-.4 5.2 0 5.2 0C34.6 4 41.4 3 47 6c-3.8.8-5.4 3.2-5.6 6-2.2-1.6-5-1.6-6.8.6-1.4-1.6-3.6-2-5.2-1C27.6 13.4 26 15.6 24 19c-2-3.4-3.6-5.6-5.4-7.4-1.6-1-3.8-.6-5.2 1-1.8-2.2-4.6-2.2-6.8-.6-.2-2.8-1.8-5.2-5.6-6 5.6-3 12.4-2 15 1.8 0 0 2.2-.4 5.2 0 0 0 0-1 .4-2.4 0 0 1.2 1 2.4 3.6z"
        fill="currentColor"
      />
    </svg>
  );
}

export function GhostTruckIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M3 22V10a2 2 0 0 1 2-2h14v14z" fill="#e9d5ff" opacity="0.85" />
      <path d="M19 12h5l4 5v5h-9z" fill="#c4b5fd" opacity="0.85" />
      <path d="M3 22c1.5 1.6 3 1.6 4.5 0s3-1.6 4.5 0 3 1.6 4.5 0 3-1.6 4.5 0 3 1.6 4.5 0 2.2-1.2 3.5-.6" fill="none" stroke="#e9d5ff" strokeWidth="1.6" opacity="0.7" />
      <circle cx="8" cy="14" r="1.4" fill="#1e1b4b" />
      <circle cx="13" cy="14" r="1.4" fill="#1e1b4b" />
      <path d="M21 13.5h2.6l2.2 2.8H21z" fill="#1e1b4b" opacity="0.7" />
    </svg>
  );
}

/** A cobweb for a corner (top left by default; flip with CSS). */
export function Cobweb({ className = 'h-16 w-16' }: { className?: string }) {
  const rays = [0, 18, 36, 54, 72, 90];
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1">
      {rays.map((a) => {
        const r = (a * Math.PI) / 180;
        return <path key={a} d={`M0 0 L${(Math.cos(r) * 100).toFixed(1)} ${(Math.sin(r) * 100).toFixed(1)}`} />;
      })}
      {[22, 42, 62, 82].map((d) => (
        <path
          key={d}
          d={rays
            .map((a, i) => {
              const r = (a * Math.PI) / 180;
              const x = (Math.cos(r) * d).toFixed(1);
              const y = (Math.sin(r) * d).toFixed(1);
              return i === 0 ? `M${x} ${y}` : `Q${(Math.cos(r - 0.16) * d * 0.86).toFixed(1)} ${(Math.sin(r - 0.16) * d * 0.86).toFixed(1)} ${x} ${y}`;
            })
            .join(' ')}
        />
      ))}
    </svg>
  );
}
