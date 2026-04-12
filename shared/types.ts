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

export interface ServerToClientEvents {
  "player:joined": (player: PlayerState) => void;
  "player:left": (playerId: string) => void;
  "player:update": (player: PlayerState) => void;
  "world:state": (players: PlayerState[]) => void;
  "world:config": (config: WorldConfig) => void;
  "world:full": (slug: string) => void;
  "brazier:sync": (payload: BrazierSyncPayload) => void;
  "brazier:lit": (event: BrazierLitEvent) => void;
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
}
