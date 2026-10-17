/** "Invite a friend": both players are rewarded once the invited player has really started playing. */
export const REFERRAL = {
  /** Deliveries the invited player must complete. */
  deliveriesNeeded: 3,
  inviterCents: 2_500_00,
  inviterCoins: 30,
  inviteeCents: 1_500_00,
  /** Rewarded invites per player in 30 days. */
  monthlyLimit: 10,
} as const;

export const REFERRAL_CODE = /^[A-Z2-9]{8}$/;
