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

export interface ServerToClientEvents {
  "player:joined": (player: PlayerState) => void;
  "player:left": (playerId: string) => void;
  "player:update": (player: PlayerState) => void;
  "world:state": (players: PlayerState[]) => void;
  "world:config": (config: WorldConfig) => void;
  "world:full": (slug: string) => void;
}

export interface ClientToServerEvents {
  "player:move": (state: Omit<PlayerState, "id">) => void;
  "world:join": (
    worldSlug: string,
    playerName: string,
    vehicle?: Vehicle,
    reservationId?: string,
  ) => void;
}
