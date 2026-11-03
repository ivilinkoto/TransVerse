import { faceFor } from '@/lib/game/portraits';
import { FRAME_COLORS, type DriverLook } from '@/lib/game/items';

/**
 * 1.2: a driver's drawn portrait (viewBox 0 0 100 100), made of parts chosen
 * from the id and name. It is the same face every time (no moods). Cap,
 * glasses and a gold frame come from the inventory.
 */
export function DriverPortrait({ id, name, look = {}, fresh, className = 'h-12 w-12' }: { id: string; name: string; fresh?: 'cap' | 'glasses' | 'frame'; look?: DriverLook; className?: string }) {
  const f = faceFor(id, name);
  const shade = 'rgba(0,0,0,0.12)';
  const eyeY = 50;
  return (
    <svg viewBox="0 0 100 100" className={`${className} shrink-0 rounded-2xl`} role="img" aria-label={name}>
      <defs>
        <clipPath id={`clip-${id}`}><rect x="0" y="0" width="100" height="100" rx="18" /></clipPath>
      </defs>
      <g clipPath={`url(#clip-${id})`}>
        <rect width="100" height="100" fill="#1e293b" />
        <circle cx="50" cy="38" r="40" fill="#334155" opacity="0.6" />
        {/* long hair behind the head */}
        {f.female && f.hair !== 1 && <path d="M24 48 q-2 30 8 44 h36 q10 -14 8 -44 q-26 -26 -52 0 z" fill={f.hairColor} />}
        {/* body: a work jacket with a collar */}
        <path d="M14 100 q4 -24 36 -26 q32 2 36 26 z" fill={f.jacket} />
        <path d="M40 75 l10 12 l10 -12" fill="#f8fafc" opacity="0.9" />
        <path d="M30 84 l6 16 M70 84 l-6 16" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
        {/* neck and head */}
        <rect x="42" y="62" width="16" height="14" rx="5" fill={f.skin} />
        <ellipse cx="50" cy="48" rx="20" ry="23" fill={f.skin} />
        <ellipse cx="30.5" cy="51" rx="3.5" ry="5" fill={f.skin} />
        <ellipse cx="69.5" cy="51" rx="3.5" ry="5" fill={f.skin} />
        <path d="M50 50 q-2 3.5 1 5.5" fill="none" stroke={shade} strokeWidth="2" strokeLinecap="round" />
        {/* hair on top */}
        {f.hair === 0 && <path d="M29 44 q2 -22 21 -22 q19 0 21 22 q-6 -12 -21 -12 q-15 0 -21 12 z" fill={f.hairColor} />}
        {f.hair === 1 && <path d="M30 40 q4 -16 20 -16 q16 0 20 16 q-10 -8 -20 -6 q-10 -2 -20 6 z" fill={f.hairColor} />}
        {f.hair === 2 && <path d="M28 46 q-2 -26 22 -26 q24 0 22 26 l-4 -10 q-8 -6 -18 -4 q-10 -4 -18 4 z" fill={f.hairColor} />}
        {f.hair === 3 && <path d="M31 36 q8 -12 19 -12 q11 0 19 12 q-2 -4 -19 -6 q-17 2 -19 6 z" fill={f.hairColor} opacity="0.55" />}
        {/* brows */}
        <path d={f.brows ? 'M38 42 q5 -3 9 0 M53 42 q5 -3 9 0' : 'M38 43 h9 M53 43 h9'} stroke={f.hairColor === '#d6d3d1' ? '#78716c' : f.hairColor} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        {/* eyes */}
        <g fill="#1f2937">
          <ellipse cx="42" cy={eyeY} rx="2.8" ry="3" />
          <ellipse cx="58" cy={eyeY} rx="2.8" ry="3" />
          <circle cx="43" cy={eyeY - 1} r="0.9" fill="#fff" />
          <circle cx="59" cy={eyeY - 1} r="0.9" fill="#fff" />
        </g>
        {/* beard: full (1), a moustache (2), a goatee (3). The full beard leaves the lips free (its top edge is below the mouth). */}
        {f.beard === 1 && <path d="M31 52 q1 22 19 23 q18 -1 19 -23 q-3 9 -9 13 q-10 3 -20 0 q-6 -4 -9 -13 z" fill={f.hairColor} />}
        {f.beard === 3 && <path d="M45 67 q5 5 10 0 q-1 5 -5 6 q-4 -1 -5 -6 z" fill={f.hairColor} />}
        {/* moustache under the nose, then a calm mouth just below it */}
        {(f.beard === 1 || f.beard === 2) && <path d="M41.5 58.5 q4.5 -2.5 8.5 -0.8 q4 -1.7 8.5 0.8 q-2 2.6 -8.5 1.4 q-6.5 1.2 -8.5 -1.4 z" fill={f.hairColor} />}
        <path d="M45.5 62.6 q4.5 2 9 0" fill="none" stroke="#8b3a2f" strokeWidth="2.1" strokeLinecap="round" />
        {/* items from the inventory */}
        {look.glasses && (
          <g className={fresh === 'glasses' ? 'fx-drop' : undefined}>
            <path d="M33 49 h34" stroke="#0f172a" strokeWidth="2" />
            <rect x="35" y="45" width="13" height="9" rx="3" fill="#0f172a" />
            <rect x="52" y="45" width="13" height="9" rx="3" fill="#0f172a" />
            <path d="M37 47 l4 4 M54 47 l4 4" stroke="#38bdf8" strokeWidth="1.5" opacity="0.7" />
          </g>
        )}
        {look.cap && (
          <g className={fresh === 'cap' ? 'fx-drop' : undefined}>
            <path d="M28 38 q0 -20 22 -20 q22 0 22 20 z" fill="#ea580c" />
            <path d="M28 38 h30 v5 h-34 a4 4 0 0 1 4 -5 z" fill="#1f2937" />
            <rect x="44" y="26" width="14" height="7" rx="1.5" fill="#f8fafc" />
          </g>
        )}
      </g>
      {look.frame && FRAME_COLORS[look.frame] && (
        <g className={fresh === 'frame' ? 'fx-pop' : undefined} style={{ transformOrigin: '50% 50%', transformBox: 'fill-box' }}>
          <rect x="2" y="2" width="96" height="96" rx="17" fill="none" stroke={FRAME_COLORS[look.frame][0]} strokeWidth="4" />
          {FRAME_COLORS[look.frame][1] && <rect x="2" y="2" width="96" height="96" rx="17" fill="none" stroke={FRAME_COLORS[look.frame][1]} strokeWidth="4" strokeDasharray="6 10" />}
        </g>
      )}
    </svg>
  );
}
