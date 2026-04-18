import type { Socket } from "socket.io";
import type {
  BrazierLitEvent,
  BrazierMoonPausePayload,
  BrazierSyncPayload,
  MoonstoneRuinActivatedEvent,
  MoonstoneRuinSyncPayload,
  PaintballFiredEvent,
  PaintballHitEvent,
  PaintballUpgradeFlags,
  PlayerState,
  ServerToClientEvents,
  ClientToServerEvents,
  Vehicle,
} from "@globefly/shared";
import {
  PAINTBALL_BURST_WINDOW_MS,
  PAINTBALL_COOLDOWN_MS,
  PAINTBALL_RANGE_MULT_MAX,
  PAINTBALL_SPEED_MULT_MAX,
} from "../paintball/constants.js";
import { computePaintballShot } from "../paintball/hitTest.js";

interface PaintballUpgradeRecord {
  doubleTap: boolean;
  speedMult: number;
  rangeMult: number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Must match `@globefly/shared` runtime constants. */
const BRAZIER_COUNT = 5;
const BRAZIER_BURN_MS = 45_000;
const BRAZIER_MOON_PAUSE_MS = 60_000;
const MOONSTONE_RUIN_COUNT = 2;
const MOONSTONE_RAISE_MS = 5_000;
const MOONSTONE_FLOAT_MS = 15_000;
const MOONSTONE_LOWER_MS = 5_000;
const MOONSTONE_TOTAL_MS = MOONSTONE_RAISE_MS + MOONSTONE_FLOAT_MS + MOONSTONE_LOWER_MS;

interface ConnectedPlayer {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>;
  state: PlayerState;
}

export const MAX_PLAYERS = 15;

export class Room {
  readonly slug: string;
  /** World globe radius — used for paintball raycast (matches Prisma world row). */
  readonly globeRadius: number;
  private players = new Map<string, ConnectedPlayer>();
  /** Rolling pair of the two most recent paintball shot timestamps per socket (ms). */
  private paintballShotHistory = new Map<string, number[]>();
  /** Client-reported paintball upgrade flags per socket (server validates / clamps). */
  private paintballUpgrades = new Map<string, PaintballUpgradeRecord>();
  /** Per-index wall-clock burn end (ms), or null — shared by everyone in this world room. */
  private brazierBurnEndsAt: (number | null)[] = Array.from(
    { length: BRAZIER_COUNT },
    () => null,
  );
  /** Wall-clock ms when shared moon-pause shield ends; null if not active. */
  private brazierMoonPauseEndsAt: number | null = null;
  /** Per-index wall-clock cycle start (ms), or null when the ruin is idle. */
  private moonstoneCycleStartsAt: (number | null)[] = Array.from(
    { length: MOONSTONE_RUIN_COUNT },
    () => null,
  );

  constructor(slug: string, globeRadius: number) {
    this.slug = slug;
    this.globeRadius = globeRadius;
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
    this.paintballShotHistory.delete(socketId);
    this.paintballUpgrades.delete(socketId);

    for (const [, player] of this.players) {
      player.socket.emit("player:left", socketId);
    }
  }

  /** Client pushes its paintball upgrade flags so the hit test / cooldown mirror them. */
  setPaintballUpgrades(socketId: string, flags: PaintballUpgradeFlags) {
    if (!this.players.has(socketId)) return;
    if (!flags || typeof flags !== "object") return;
    const record: PaintballUpgradeRecord = {
      doubleTap: flags.doubleTap === true,
      speedMult: clamp(Number(flags.speedMult) || 1, 1, PAINTBALL_SPEED_MULT_MAX),
      rangeMult: clamp(Number(flags.rangeMult) || 1, 1, PAINTBALL_RANGE_MULT_MAX),
    };
    this.paintballUpgrades.set(socketId, record);
  }

  /** Server-authoritative paintball: validates cooldown and vehicle; broadcasts to room. */
  firePaintball(socketId: string) {
    const me = this.players.get(socketId);
    if (!me) return;

    const veh = me.state.vehicle === "boat" ? "boat" : me.state.vehicle === "carpet" ? "carpet" : "plane";
    if (veh !== "plane") return;

    const now = Date.now();
    const upgrades = this.paintballUpgrades.get(socketId);
    const doubleTap = upgrades?.doubleTap === true;
    const speedMult = upgrades ? upgrades.speedMult : 1;
    const rangeMult = upgrades ? upgrades.rangeMult : 1;

    const history = this.paintballShotHistory.get(socketId) ?? [];
    const last1 = history[history.length - 1] ?? 0;
    const last2 = history[history.length - 2] ?? 0;

    if (doubleTap) {
      // Burst allowed: up to 2 shots per PAINTBALL_BURST_WINDOW_MS; no sub-cooldown between shot 1 and shot 2.
      if (last2 > 0 && now - last2 < PAINTBALL_BURST_WINDOW_MS) return;
    } else {
      // Classic single-shot cooldown.
      if (now - last1 < PAINTBALL_COOLDOWN_MS) return;
    }

    history.push(now);
    if (history.length > 2) history.splice(0, history.length - 2);
    this.paintballShotHistory.set(socketId, history);

    const others = Array.from(this.players.entries())
      .filter(([id]) => id !== socketId)
      .map(([id, p]) => ({ id, state: p.state }));

    const result = computePaintballShot(me.state, socketId, others, this.globeRadius, {
      speedMult,
      rangeMult,
    });

    const firedPayload: PaintballFiredEvent = {
      shooterId: socketId,
      ...result.fired,
    };
    for (const [, p] of this.players) {
      p.socket.emit("paintball:fired", firedPayload);
    }

    if (result.hit) {
      const hitPayload: PaintballHitEvent = {
        shooterId: socketId,
        victimId: result.hit.victimId,
        color: result.hit.color,
        splatSeed: result.hit.splatSeed,
      };
      for (const [, p] of this.players) {
        p.socket.emit("paintball:hit", hitPayload);
      }
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

  private getActiveMoonstoneStart(startAt: number | null, now: number): number | null {
    if (startAt == null) return null;
    if (startAt + MOONSTONE_TOTAL_MS <= now) return null;
    return startAt;
  }

  /** Current ruin lift schedule for clients that just joined (expired slots -> null). */
  getMoonstoneSyncPayload(): MoonstoneRuinSyncPayload {
    const now = Date.now();
    return {
      cycleStartsAt: this.moonstoneCycleStartsAt.map((t, i) => {
        const active = this.getActiveMoonstoneStart(t, now);
        this.moonstoneCycleStartsAt[i] = active;
        return active;
      }),
    };
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
      announce: true,
    };

    for (const [, p] of this.players) {
      p.socket.emit("brazier:sync", syncPayload);
      p.socket.emit("brazier:moonPause", moonPausePayload);
    }
  }

  /** A carpet player activated a moonstone ruin; shared timing is authoritative on the server. */
  activateMoonstone(socketId: string, index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= MOONSTONE_RUIN_COUNT) return;
    const player = this.players.get(socketId);
    if (!player) return;
    if (player.state.vehicle !== "carpet") return;

    const now = Date.now();
    const activeStart = this.getActiveMoonstoneStart(this.moonstoneCycleStartsAt[index], now);
    this.moonstoneCycleStartsAt[index] = activeStart;
    if (activeStart != null) return;

    const cycleStartAt = now;
    this.moonstoneCycleStartsAt[index] = cycleStartAt;

    const payload: MoonstoneRuinActivatedEvent = {
      index,
      playerId: socketId,
      playerName: player.state.name,
      cycleStartAt,
    };

    for (const [, p] of this.players) {
      p.socket.emit("moonstone:activated", payload);
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
