export type Vehicle = "plane" | "boat" | "carpet";
export type TimeOfDay = "day" | "evening" | "night";

export type { VehicleGameFeatures } from "./vehicleCapabilities";
export { getVehicleFeatures } from "./vehicleCapabilities";

export interface PlayerState {
  id: string;
  name: string;
  /** Omitted or unknown → treat as plane (backward compatible) */
  vehicle?: Vehicle;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  heading: number;
  pitch: number;
  altitude: number;
  speed: number;
  bankAngle: number;
  rollAngle: number;
  carrying?: boolean;
  /** Primary hull RGB as 0xRRGGBB (synced so remotes match local paint). */
  vehicleColor?: number;
  /** 0 = invisible, 1 = fully visible (e.g. moon cutscene fade). Omitted = 1. */
  visibility?: number;
  timestamp: number;
}

export interface WorldConfig {
  id: string;
  name: string;
  slug: string;
  globeRadius: number;
  texture: string;
  createdBy: string;
  seed: number;
  terrainType: string;
}

/** Matches client `Braziers` placement count. */
export const BRAZIER_COUNT = 5;
/** Brazier burn duration — keep in sync with client flame timer. */
export const BRAZIER_BURN_MS = 45_000;
/** When all five braziers burn together, moon approach pauses for this long (per client). */
export const BRAZIER_MOON_PAUSE_MS = 60_000;

export interface BrazierSyncPayload {
  /** ms epoch when burn ends, or null if unlit */
  expiries: (number | null)[];
}

export interface BrazierLitEvent {
  index: number;
  playerId: string;
  playerName: string;
  /** ms epoch when this brazier's burn ends */
  burnEndsAt: number;
}

/** Tells each client to pause its local moon approach for `remainingMs`. */
export interface BrazierMoonPausePayload {
  remainingMs: number;
  /** False when syncing an already-active pause to a newly joined client. */
  announce?: boolean;
}

/** Matches client `Globe` moonstone ruin placement count. */
export const MOONSTONE_RUIN_COUNT = 2;
/** Carpet-near activation raises a ruin over this many ms. */
export const MOONSTONE_RAISE_MS = 5_000;
/** After raising completes, the ruin stays suspended for this many ms. */
export const MOONSTONE_FLOAT_MS = 15_000;
/** Lowering mirrors the raise unless retuned later. */
export const MOONSTONE_LOWER_MS = 5_000;

export interface MoonstoneRuinSyncPayload {
  /** ms epoch when the current lift cycle started, or null when idle */
  cycleStartsAt: (number | null)[];
}

export interface MoonstoneRuinActivatedEvent {
  index: number;
  playerId: string;
  playerName: string;
  /** ms epoch when raise phase started */
  cycleStartAt: number;
}

/** ms between paintball shots (client UX + server authority). */
export const PAINTBALL_COOLDOWN_MS = 500;
/** Double-tap burst: min window between the start of successive bursts (post-burst recovery). */
export const PAINTBALL_BURST_WINDOW_MS = 700;
/** Projectile travel speed in world units per second. */
export const PAINTBALL_SPEED = 7;
/** Max travel distance = globeRadius * this factor. */
export const PAINTBALL_RANGE_FACTOR = 1.0;
/** Upper bounds on client-supplied paintball upgrade multipliers (anti-cheat clamp). */
export const PAINTBALL_SPEED_MULT_MAX = 1.5;
export const PAINTBALL_RANGE_MULT_MAX = 1.5;
/**
 * Hit test: max distance from shot ray to the **victim’s globe position point** (not full mesh).
 * Wider than a true hull but much smaller than 0.22 — tune feel vs. “free” hits.
 */
export const PAINTBALL_HIT_RADIUS = 0.14;
/** Splatter opacity fades to zero over this many seconds. */
export const SPLATTER_LIFETIME_SEC = 14;
/**
 * Vibrant, saturated tints (0xRRGGBB) for paintballs and splatters.
 * Server picks one per hit.
 */
export const PAINTBALL_COLOR_PALETTE: readonly number[] = [
  0xd83858, 0xd56038, 0xd8b828, 0x38b878, 0x3888d8, 0x8858d8, 0xd838a8, 0x4888a8,
];

export interface PaintballFiredEvent {
  shooterId: string;
  /** Palette color (0xRRGGBB) for this shot — same as splatter when the shot hits. */
  color: number;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  /** Range multiplier applied to globeRadius * PAINTBALL_RANGE_FACTOR (clamped). Optional for backward compat. */
  rangeMult?: number;
}

/** Client pushes its paintball upgrade flags so the server mirrors them on hit test + cooldown. */
export interface PaintballUpgradeFlags {
  doubleTap: boolean;
  speedMult: number;
  rangeMult: number;
}

export interface PaintballHitEvent {
  shooterId: string;
  victimId: string;
  /** 0xRRGGBB */
  color: number;
  /** Deterministic splatter placement/rotation on clients. */
  splatSeed: number;
}

export interface ServerToClientEvents {
  "player:joined": (player: PlayerState) => void;
  "player:left": (playerId: string) => void;
  "player:update": (player: PlayerState) => void;
  "world:state": (players: PlayerState[]) => void;
  "world:config": (config: WorldConfig) => void;
  "world:full": (slug: string) => void;
  "brazier:sync": (payload: BrazierSyncPayload) => void;
  "brazier:lit": (event: BrazierLitEvent) => void;
  "brazier:moonPause": (payload: BrazierMoonPausePayload) => void;
  "moonstone:sync": (payload: MoonstoneRuinSyncPayload) => void;
  "moonstone:activated": (event: MoonstoneRuinActivatedEvent) => void;
  "paintball:fired": (event: PaintballFiredEvent) => void;
  "paintball:hit": (event: PaintballHitEvent) => void;
}

export interface ClientToServerEvents {
  "player:move": (state: Omit<PlayerState, "id">) => void;
  "world:join": (
    worldSlug: string,
    playerName: string,
    vehicle?: Vehicle,
    reservationId?: string,
  ) => void;
  "brazier:ignite": (index: number) => void;
  "moonstone:activate": (index: number) => void;
  "paintball:fire": () => void;
  "paintball:setUpgrades": (flags: PaintballUpgradeFlags) => void;
}
