import type { Socket } from "socket.io";
import type {
  BrazierLitEvent,
  BrazierSyncPayload,
  PlayerState,
  ServerToClientEvents,
  ClientToServerEvents,
  Vehicle,
} from "@globefly/shared";

/** Must match `BRAZIER_COUNT` / `BRAZIER_BURN_MS` in `@globefly/shared`. */
const BRAZIER_COUNT = 5;
const BRAZIER_BURN_MS = 45_000;

interface ConnectedPlayer {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>;
  state: PlayerState;
}

export const MAX_PLAYERS = 15;

export class Room {
  readonly slug: string;
  private players = new Map<string, ConnectedPlayer>();
  /** Per-index wall-clock burn end (ms), or null — shared by everyone in this world room. */
  private brazierBurnEndsAt: (number | null)[] = Array.from(
    { length: BRAZIER_COUNT },
    () => null,
  );

  constructor(slug: string) {
    this.slug = slug;
  }

  get playerCount() {
    return this.players.size;
  }

  get isEmpty() {
    return this.players.size === 0;
  }

  get isFull() {
    return this.players.size >= MAX_PLAYERS;
  }

  addPlayer(
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
    name: string,
    vehicle: Vehicle = "plane",
  ): PlayerState | null {
    if (this.isFull) return null;
    const state: PlayerState = {
      id: socket.id,
      name,
      vehicle,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      heading: 0,
      pitch: 0,
      altitude: 0.55,
      speed: 1.0,
      bankAngle: 0,
      rollAngle: 0,
      timestamp: Date.now(),
    };

    this.players.set(socket.id, { socket, state });

    // Notify existing players
    for (const [id, player] of this.players) {
      if (id !== socket.id) {
        player.socket.emit("player:joined", state);
      }
    }

    // Send current world state to the new player
    const allPlayers = Array.from(this.players.values())
      .filter((p) => p.socket.id !== socket.id)
      .map((p) => p.state);
    socket.emit("world:state", allPlayers);

    return state;
  }

  removePlayer(socketId: string) {
    this.players.delete(socketId);

    for (const [, player] of this.players) {
      player.socket.emit("player:left", socketId);
    }
  }

  /** Current burn schedule for clients that just joined (expired slots → null). */
  getBrazierSyncPayload(): BrazierSyncPayload {
    const now = Date.now();
    return {
      expiries: this.brazierBurnEndsAt.map((t) =>
        t != null && t > now ? t : null,
      ),
    };
  }

  /** A player lit a brazier (proximity) — broadcast to the whole room. */
  igniteBrazier(socketId: string, index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= BRAZIER_COUNT) return;
    const player = this.players.get(socketId);
    if (!player) return;

    const burnEndsAt = Date.now() + BRAZIER_BURN_MS;
    this.brazierBurnEndsAt[index] = burnEndsAt;

    const payload: BrazierLitEvent = {
      index,
      playerId: socketId,
      playerName: player.state.name,
      burnEndsAt,
    };

    for (const [, p] of this.players) {
      p.socket.emit("brazier:lit", payload);
    }
  }

  updatePlayer(socketId: string, state: Omit<PlayerState, "id">) {
    const player = this.players.get(socketId);
    if (!player) return;

    const fullState: PlayerState = {
      ...state,
      id: socketId,
      name: player.state.name,
      vehicle: state.vehicle || player.state.vehicle,
    };
    player.state = fullState;

    // Broadcast to all other players
    for (const [id, other] of this.players) {
      if (id !== socketId) {
        other.socket.emit("player:update", fullState);
      }
    }
  }
}
