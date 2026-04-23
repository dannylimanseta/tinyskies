/** Duplicated from `shared/types.ts` — keep numeric values in sync. */
export const PAINTBALL_COOLDOWN_MS = 500;
/** Double-Tap post-burst window (ms). Must match shared constant. */
export const PAINTBALL_BURST_WINDOW_MS = 700;
export const PAINTBALL_SPEED = 7;
export const PAINTBALL_RANGE_FACTOR = 0.85;
export const PAINTBALL_HIT_RADIUS = 0.14;
/** Upper bounds on client-supplied paintball upgrade multipliers (anti-cheat clamp). */
export const PAINTBALL_SPEED_MULT_MAX = 1.5;
export const PAINTBALL_RANGE_MULT_MAX = 1.65;
export const PAINTBALL_COLOR_PALETTE: readonly number[] = [
  0xe898a8, 0xe5b098, 0xe8d898, 0x98d8b8, 0x98c8e8, 0xc8b8e8, 0xe898c8, 0xa8c8d8,
];
