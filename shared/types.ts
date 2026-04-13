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
}

/** ms between paintball shots (client UX + server authority). */
export const PAINTBALL_COOLDOWN_MS = 500;
/** Projectile travel speed in world units per second. */
export const PAINTBALL_SPEED = 7;
/** Max travel distance = globeRadius * this factor. */
export const PAINTBALL_RANGE_FACTOR = 0.56;
/**
 * Hit test: max distance from shot ray to the **victim’s globe position point** (not full mesh).
 * Wider than a true hull but much smaller than 0.22 — tune feel vs. “free” hits.
 */
export const PAINTBALL_HIT_RADIUS = 0.14;
/** Splatter opacity fades to zero over this many seconds. */
export const SPLATTER_LIFETIME_SEC = 14;
/**
 * Pastel-ish tints (0xRRGGBB) for paintballs and splatters — no pure white.
 * Server picks one per hit.
 */
export const PAINTBALL_COLOR_PALETTE: readonly number[] = [
  0xe898a8, 0xe5b098, 0xe8d898, 0x98d8b8, 0x98c8e8, 0xc8b8e8, 0xe898c8, 0xa8c8d8,
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
  "paintball:fire": () => void;
}
