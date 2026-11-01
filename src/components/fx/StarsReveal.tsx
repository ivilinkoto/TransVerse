/**
 * 1.1.4.3: a client's stars appear one after another (for the newest reviews).
 * Plain CSS — with animations off they are simply there.
 */
export function StarsReveal({ stars, animate, label }: { stars: number; animate: boolean; label: string }) {
  return (
    <span className="inline-flex text-gold-400" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`${n <= stars ? '' : 'text-asphalt-600'} ${animate && n <= stars ? 'fx-pop inline-block' : ''}`} style={animate && n <= stars ? { animationDelay: `${n * 140}ms` } : undefined} aria-hidden="true">★</span>
      ))}
    </span>
  );
}
