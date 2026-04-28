export type Vehicle = "plane" | "boat" | "carpet";
export type TimeOfDay = "day" | "evening" | "night";

export type { VehicleGameFeatures } from "./vehicleCapabilities";
export { getVehicleFeatures } from "./vehicleCapabilities";

export interface CarpetPortalEndpointSnapshot {
  id: number;
  /** Seconds since this endpoint was spawned; used to line up remote spawn animation. */
  age: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  heading: number;
  altitude: number;
}

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
  /** Carpet-only: the latest two local portal endpoints, relayed for remote visuals. */
  carpetPortals?: CarpetPortalEndpointSnapshot[];
  /** Carpet-only: increments on portal travel so remotes snap/fade instead of interpolating. */
  carpetPortalTeleportSeq?: number;
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

/** Matches client `Globe` moonstone ruin placement count. */
export const MOONSTONE_RUIN_COUNT = 2;
/** Carpet-near activation raises a ruin over this many ms. */
export const MOONSTONE_RAISE_MS = 5_000;
/** After raising completes, the ruin stays suspended for this many ms. */
export const MOONSTONE_FLOAT_MS = 15_000;
/** Lowering mirrors the raise unless retuned later. */
export const MOONSTONE_LOWER_MS = 5_000;

/** ms between paintball shots (client UX + server authority). */
export const PAINTBALL_COOLDOWN_MS = 500;
/** Double-tap burst: min window between the start of successive bursts (post-burst recovery). */
export const PAINTBALL_BURST_WINDOW_MS = 700;
/** Projectile travel speed in world units per second. */
export const PAINTBALL_SPEED = 7;
/** Max travel distance = globeRadius * this factor. */
export const PAINTBALL_RANGE_FACTOR = 0.85;
/** Upper bounds on client-supplied paintball upgrade multipliers (anti-cheat clamp). */
export const PAINTBALL_SPEED_MULT_MAX = 1.5;
/** High enough for Sharpshooter + Long Shot (and further stacks) after clamp. */
export const PAINTBALL_RANGE_MULT_MAX = 1.65;
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

/**
 * Hot-potato flag: max 3D distance for free-flag pickup (world units).
 * ~1.35 allows a fly-by on a ~radius-5 globe without lining up on the exact radial (see server copy).
 */
export const FLAG_COLLECT_RADIUS = 0.8;
/** Hot-potato flag: challenger must stay within this of carrier. */
export const FLAG_CAPTURE_RADIUS = 1.0;
/**
 * Clearance above terrain surface for free flag spawn (server: `surfaceDisplacement + this`).
 * Matches carpet low hover; spawn altitude must include terrain (see server `Room.spawnHotFlagAtRandomPosition`).
 */
export const FLAG_HOVER_ALTITUDE = 0.05;
export const FLAG_CAPTURE_DURATION_MS = 3000;
export const FLAG_IMMUNITY_MS = 10_000;
export const FLAG_AUTO_RESPAWN_MS = 45_000;
export const FLAG_SPAWN_DELAY_MS = 5000;
export const FLAG_CAPTURE_GRACE_MS = 300;

export interface FlagSpawnedEvent {
  x: number;
  y: number;
  z: number;
}

export interface FlagCollectedEvent {
  holderId: string;
  holderName: string;
}

export interface FlagCaptureStartEvent {
  challengerId: string;
  challengerName: string;
  startMs: number;
}

export interface FlagCaptureEndEvent {
  challengerId: string;
}

export interface FlagStolenEvent {
  newHolderId: string;
  newHolderName: string;
  previousHolderId: string;
  previousHolderName: string;
  immuneUntilMs: number;
}

export interface FlagDroppedEvent {
  x: number;
  y: number;
  z: number;
  droppedById: string;
  droppedByName: string;
}

/** Sent only to a player on join so their client matches room flag state. */
export interface FlagSyncEvent {
  /** True when the flag is on the ground waiting to be picked up. */
  free: boolean;
  x?: number;
  y?: number;
  z?: number;
  holderId?: string;
  holderName?: string;
  immuneUntilMs?: number;
}

export interface ServerToClientEvents {
  "player:joined": (player: PlayerState) => void;
  "player:left": (playerId: string) => void;
  "player:update": (player: PlayerState) => void;
  "world:state": (players: PlayerState[]) => void;
  "world:config": (config: WorldConfig) => void;
  "world:full": (slug: string) => void;
  "paintball:fired": (event: PaintballFiredEvent) => void;
  "paintball:hit": (event: PaintballHitEvent) => void;
  "flag:spawned": (ev: FlagSpawnedEvent) => void;
  "flag:collected": (ev: FlagCollectedEvent) => void;
  "flag:capture_start": (ev: FlagCaptureStartEvent) => void;
  "flag:capture_end": (ev: FlagCaptureEndEvent) => void;
  "flag:stolen": (ev: FlagStolenEvent) => void;
  "flag:dropped": (ev: FlagDroppedEvent) => void;
  "flag:cleared": () => void;
  "flag:sync": (ev: FlagSyncEvent) => void;
}

export interface ClientToServerEvents {
  "player:move": (state: Omit<PlayerState, "id">) => void;
  "world:join": (
    worldSlug: string,
    playerName: string,
    vehicle?: Vehicle,
    reservationId?: string,
  ) => void;
  "paintball:fire": () => void;
  "paintball:setUpgrades": (flags: PaintballUpgradeFlags) => void;
  /** True while the local player is in a non-world scene where flag play is suspended. */
  "flag:setSuppressed": (suppressed: boolean) => void;
  "debug:forceFlagSpawn": () => void;
}
