import type { Socket } from "socket.io";
import type {
  BrazierLitEvent,
  BrazierMoonPausePayload,
  BrazierSyncPayload,
  PlayerState,
  ServerToClientEvents,
  ClientToServerEvents,
  Vehicle,
} from "@globefly/shared";

/** Must match `BRAZIER_COUNT` / `BRAZIER_BURN_MS` / `BRAZIER_MOON_PAUSE_MS` in `@globefly/shared`. */
const BRAZIER_COUNT = 5;
const BRAZIER_BURN_MS = 45_000;
const BRAZIER_MOON_PAUSE_MS = 60_000;

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
  /** Wall-clock ms when shared moon-pause shield ends; null if not active. */
  private brazierMoonPauseEndsAt: number | null = null;

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

  /** Remaining shield pause for a client that just joined, or null if none / expired. */
  getMoonPauseRemainingMsIfActive(): number | null {
    const end = this.brazierMoonPauseEndsAt;
    if (end == null) return null;
    const now = Date.now();
    if (end <= now) {
      this.brazierMoonPauseEndsAt = null;
      return null;
    }
    return end - now;
  }

  private allBraziersActive(now: number): boolean {
    return this.brazierBurnEndsAt.every((t) => t != null && t > now);
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

    const now = Date.now();
    if (!this.allBraziersActive(now)) return;

    for (let i = 0; i < BRAZIER_COUNT; i++) {
      this.brazierBurnEndsAt[i] = null;
    }
    this.brazierMoonPauseEndsAt = now + BRAZIER_MOON_PAUSE_MS;

    const syncPayload = this.getBrazierSyncPayload();
    const moonPausePayload: BrazierMoonPausePayload = {
      remainingMs: BRAZIER_MOON_PAUSE_MS,
    };

    for (const [, p] of this.players) {
      p.socket.emit("brazier:sync", syncPayload);
      p.socket.emit("brazier:moonPause", moonPausePayload);
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
