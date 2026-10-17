/** A player's picture, or the first letter of their name when they have none. */
export function Avatar({ userId, username, version = 0, vip = false, className = 'h-10 w-10 text-base', rounded = 'rounded-full' }: { userId: string; username: string; version?: number; vip?: boolean; className?: string; rounded?: string }) {
  if (version > 0) {
    // eslint-disable-next-line @next/next/no-img-element -- small user image served by our own API
    return <img src={`/api/players/${userId}/avatar?v=${version}`} alt="" className={`${className} ${rounded} object-cover`} />;
  }
  return (
    <span className={`${className} ${rounded} flex items-center justify-center bg-gradient-to-br from-volt-500/40 to-cyan-glow/20 font-display font-bold ${vip ? 'text-gold-400' : 'text-white'}`} aria-hidden="true">
      {username.slice(0, 1).toUpperCase()}
    </span>
  );
}
