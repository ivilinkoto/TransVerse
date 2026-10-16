/** VIP status is granted by an administrator until a date; it is active while that date is in the future. */
export function isVip(vipUntil: Date | string | null | undefined, now: Date | number): boolean {
  if (!vipUntil) return false;
  return new Date(vipUntil).getTime() > (typeof now === 'number' ? now : now.getTime());
}

export const VIP_MAX_DAYS = 3650;
