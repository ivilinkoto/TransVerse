/**
 * 1.2.6 „На една вълна“: partner loads. The best-paid long loads come in two
 * legs for two different players — the first driver takes it to the middle and
 * agrees a partner for the second leg, by an invitation in private messages or
 * a „Търся партньор“ line in the global chat. The second leg is kept for that
 * partner; both on time with a partner they agreed on → a bonus for both, pass
 * points, and after a few loads together — trusted partners.
 */
export const PARTNER = {
  /** How many partner loads wait on the board. */
  open: 3,
  minKm: 700,
  maxKm: 1600,
  /** Pay over the board for each leg, and the bonus each gets when both arrive on time together. */
  multiplier: 1.35,
  bonusShare: 0.25,
  ttlHours: 10,
  /** After the hand-over, how long the second leg waits for the partner. */
  handoverHours: 8,
  /** Pass points for each when it arrives. */
  passPoints: 600,
  /** Loads together after which two players are trusted partners (a badge for both). */
  trustedAfter: 3,
  badge: 'trusted-partners',
} as const;
