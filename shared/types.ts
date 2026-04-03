export interface PlayerState {
  id: string;
  name: string;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  heading: number;
  pitch: number;
  altitude: number;
  speed: number;
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
}

export interface ClientToServerEvents {
  "player:move": (state: Omit<PlayerState, "id">) => void;
  "world:join": (worldSlug: string, playerName: string) => void;
}
