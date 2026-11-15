/**
 * Multimodal logistics (v2.0 "Светът се отваря"), game data: a truck takes a
 * container to a rail or sea terminal, the train or ship carries it (the
 * line's real time), and the last leg from the other terminal is a new load —
 * first for the driver of the first leg, then for anyone. Each leg on time
 * pays a bonus; one driver for both earns more.
 */
export const INTERMODAL = { open: 6, ttlHours: 30, multiplier: 1.1, nearKm: 350, holdHours: 2, giveUpHours: 6, bonusShare: 0.1, sameDriverShare: 0.15 } as const;
