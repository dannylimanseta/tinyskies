/**
 * Hot-flag tuning for `Room.ts`. Must stay in sync with `shared/types.ts` (client + types).
 */
export const FLAG_COLLECT_RADIUS = 0.8;
export const FLAG_CAPTURE_RADIUS = 1.0;
/** Added to `surfaceDisplacementAt` at spawn so height matches client terrain + carpet hover. */
export const FLAG_HOVER_ALTITUDE = 0.05;
export const FLAG_CAPTURE_DURATION_MS = 3000;
export const FLAG_IMMUNITY_MS = 10_000;
export const FLAG_AUTO_RESPAWN_MS = 45_000;
export const FLAG_SPAWN_DELAY_MS = 5000;
export const FLAG_CAPTURE_GRACE_MS = 300;
