import type { Socket } from "socket.io";
import { Quaternion, Vector3 } from "three";
import type {
  FlagCaptureEndEvent,
  FlagCaptureStartEvent,
  FlagCollectedEvent,
  FlagDroppedEvent,
  FlagSpawnedEvent,
  FlagStolenEvent,
  FlagSyncEvent,
  PaintballFiredEvent,
  PaintballHitEvent,
  PaintballUpgradeFlags,
  PlayerState,
  ServerToClientEvents,
  ClientToServerEvents,
  Vehicle,
} from "@globefly/shared";
import {
  FLAG_AUTO_RESPAWN_MS,
  FLAG_CAPTURE_DURATION_MS,
  FLAG_CAPTURE_GRACE_MS,
  FLAG_CAPTURE_RADIUS,
  FLAG_COLLECT_RADIUS,
  FLAG_HOVER_ALTITUDE,
  FLAG_IMMUNITY_MS,
  FLAG_SPAWN_DELAY_MS,
} from "../flagConstants.js";
import {
  PAINTBALL_BURST_WINDOW_MS,
  PAINTBALL_COOLDOWN_MS,
  PAINTBALL_RANGE_MULT_MAX,
  PAINTBALL_SPEED_MULT_MAX,
} from "../paintball/constants.js";
import { cartesianFromSpherical, computePaintballShot } from "../paintball/hitTest.js";
import { surfaceDisplacementAt } from "../terrain/TerrainSurface.js";

const REF_UP = new Vector3(0, 1, 0);

interface PaintballUpgradeRecord {
  doubleTap: boolean;
  speedMult: number;
  rangeMult: number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

interface ConnectedPlayer {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>;
  state: PlayerState;
}

interface ChallengerEntry {
  startMs: number;
  outOfRangeSinceMs: number | null;
}

type HotFlagMode = "inactive" | "free" | "held";

function isFlagVehicle(vehicle: Vehicle | undefined): boolean {
  return vehicle === "carpet" || vehicle === undefined || vehicle === "plane";
}

function randomUnitQuaternion(target: Quaternion): Quaternion {
  const u1 = Math.random();
  const u2 = Math.random() * Math.PI * 2;
  const u3 = Math.random() * Math.PI * 2;
  const sq1 = Math.sqrt(1 - u1);
  const sq2 = Math.sqrt(u1);
  return target.set(
    sq1 * Math.sin(u2),
    sq1 * Math.cos(u2),
    sq2 * Math.sin(u3),
    sq2 * Math.cos(u3),
  );
}

const _qFlag = new Quaternion();
/** Scratch for flag spawn / drop / free pickup only — never alias two live positions in one scope. */
const _vFlag = new Vector3();
const _vCarrier = new Vector3();
const _vOtherPlayer = new Vector3();

function playerWorldPos(state: PlayerState, globeRadius: number, out: Vector3): Vector3 {
  _qFlag.set(state.qx, state.qy, state.qz, state.qw);
  return out.copy(cartesianFromSpherical(_qFlag, state.altitude, globeRadius));
}

export const MAX_PLAYERS = 15;

export class Room {
  readonly slug: string;
  /** World globe radius — used for paintball raycast (matches Prisma world row). */
  readonly globeRadius: number;
  /** Matches client Globe terrain (Prisma `World.seed`). */
  readonly worldSeed: number;
  /** Matches client terrain preset id (Prisma `World.terrainType`). */
  readonly terrainType: string;
  private players = new Map<string, ConnectedPlayer>();
  /** Rolling pair of the two most recent paintball shot timestamps per socket (ms). */
  private paintballShotHistory = new Map<string, number[]>();
  /** Client-reported paintball upgrade flags per socket (server validates / clamps). */
  private paintballUpgrades = new Map<string, PaintballUpgradeRecord>();
  /** Players temporarily outside world-space flag play (e.g. carpet cosmic void). */
  private flagSuppressedPlayers = new Set<string>();

  private hotFlagMode: HotFlagMode = "inactive";
  private hotFlagX = 0;
  private hotFlagY = 0;
  private hotFlagZ = 0;
  private hotFlagHolderId: string | null = null;
  private hotFlagImmuneUntilMs = 0;
  private hotFlagChallengers = new Map<string, ChallengerEntry>();
  private hotFlagSpawnTimer: ReturnType<typeof setTimeout> | null = null;
  private hotFlagFreeRespawnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(slug: string, globeRadius: number, worldSeed: number, terrainType: string) {
    this.slug = slug;
    this.globeRadius = globeRadius;
    this.worldSeed = worldSeed;
    this.terrainType = terrainType;
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

  private broadcastFlagSpawned(ev: FlagSpawnedEvent) {
    for (const [, p] of this.players) {
      p.socket.emit("flag:spawned", ev);
    }
  }

  private broadcastFlagCollected(ev: FlagCollectedEvent) {
    for (const [, p] of this.players) {
      p.socket.emit("flag:collected", ev);
    }
  }

  private broadcastFlagCaptureStart(ev: FlagCaptureStartEvent) {
    for (const [, p] of this.players) {
      p.socket.emit("flag:capture_start", ev);
    }
  }

  private broadcastFlagCaptureEnd(ev: FlagCaptureEndEvent) {
    for (const [, p] of this.players) {
      p.socket.emit("flag:capture_end", ev);
    }
  }

  private broadcastFlagStolen(ev: FlagStolenEvent) {
    for (const [, p] of this.players) {
      p.socket.emit("flag:stolen", ev);
    }
  }

  private broadcastFlagDropped(ev: FlagDroppedEvent) {
    for (const [, p] of this.players) {
      p.socket.emit("flag:dropped", ev);
    }
  }

  private broadcastFlagCleared() {
    for (const [, p] of this.players) {
      p.socket.emit("flag:cleared");
    }
  }

  private clearHotFlagTimers() {
    if (this.hotFlagSpawnTimer != null) {
      clearTimeout(this.hotFlagSpawnTimer);
      this.hotFlagSpawnTimer = null;
    }
    if (this.hotFlagFreeRespawnTimer != null) {
      clearTimeout(this.hotFlagFreeRespawnTimer);
      this.hotFlagFreeRespawnTimer = null;
    }
  }

  private clearAllChallengersWithBroadcast() {
    for (const id of this.hotFlagChallengers.keys()) {
      this.broadcastFlagCaptureEnd({ challengerId: id });
    }
    this.hotFlagChallengers.clear();
  }

  private startFreeFlagRespawnTimer() {
    if (this.hotFlagFreeRespawnTimer != null) {
      clearTimeout(this.hotFlagFreeRespawnTimer);
      this.hotFlagFreeRespawnTimer = null;
    }
    this.hotFlagFreeRespawnTimer = setTimeout(() => {
      this.hotFlagFreeRespawnTimer = null;
      if (this.hotFlagMode !== "free" || this.players.size === 0) return;
      this.spawnHotFlagAtRandomPosition();
    }, FLAG_AUTO_RESPAWN_MS);
  }

  private spawnHotFlagAtRandomPosition() {
    randomUnitQuaternion(_qFlag);
    _vFlag.copy(REF_UP).applyQuaternion(_qFlag).normalize();
    const surfaceAlt = surfaceDisplacementAt(
      this.worldSeed,
      this.terrainType,
      _vFlag.x,
      _vFlag.y,
      _vFlag.z,
    );
    const pos = cartesianFromSpherical(_qFlag, surfaceAlt + FLAG_HOVER_ALTITUDE, this.globeRadius);
    this.hotFlagMode = "free";
    this.hotFlagX = pos.x;
    this.hotFlagY = pos.y;
    this.hotFlagZ = pos.z;
    this.hotFlagHolderId = null;
    this.hotFlagImmuneUntilMs = 0;
    this.clearAllChallengersWithBroadcast();
    this.broadcastFlagSpawned({ x: pos.x, y: pos.y, z: pos.z });
    this.startFreeFlagRespawnTimer();
  }

  private scheduleHotFlagSpawnIfNeeded() {
    if (this.players.size < 2) return;
    if (this.hotFlagMode !== "inactive") return;
    if (this.hotFlagSpawnTimer != null) return;
    this.hotFlagSpawnTimer = setTimeout(() => {
      this.hotFlagSpawnTimer = null;
      if (this.players.size < 2) return;
      this.spawnHotFlagAtRandomPosition();
    }, FLAG_SPAWN_DELAY_MS);
  }

  forceFlagSpawn() {
    if (this.hotFlagSpawnTimer != null) {
      clearTimeout(this.hotFlagSpawnTimer);
      this.hotFlagSpawnTimer = null;
    }
    this.spawnHotFlagAtRandomPosition();
  }

  setFlagSuppressed(socketId: string, suppressed: boolean) {
    const player = this.players.get(socketId);
    if (!player) return;

    if (suppressed) {
      this.flagSuppressedPlayers.add(socketId);
      if (this.hotFlagChallengers.delete(socketId)) {
        this.broadcastFlagCaptureEnd({ challengerId: socketId });
      }
      if (this.hotFlagMode === "held" && this.hotFlagHolderId === socketId) {
        this.dropFlagFromHolder(player.state);
      }
      return;
    }

    this.flagSuppressedPlayers.delete(socketId);
    this.scheduleHotFlagSpawnIfNeeded();
  }

  private buildFlagSync(): FlagSyncEvent {
    if (this.hotFlagMode === "inactive") {
      return { free: false };
    }
    if (this.hotFlagMode === "free") {
      return { free: true, x: this.hotFlagX, y: this.hotFlagY, z: this.hotFlagZ };
    }
    const holder = this.hotFlagHolderId ? this.players.get(this.hotFlagHolderId) : undefined;
    return {
      free: false,
      holderId: this.hotFlagHolderId ?? undefined,
      holderName: holder?.state.name,
      immuneUntilMs: this.hotFlagImmuneUntilMs,
    };
  }

  private dropFlagFromHolder(state: PlayerState) {
    const pos = playerWorldPos(state, this.globeRadius, _vFlag);
    this.hotFlagMode = "free";
    this.hotFlagX = pos.x;
    this.hotFlagY = pos.y;
    this.hotFlagZ = pos.z;
    this.hotFlagHolderId = null;
    this.hotFlagImmuneUntilMs = 0;
    this.clearAllChallengersWithBroadcast();
    this.broadcastFlagDropped({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      droppedById: state.id,
      droppedByName: state.name,
    });
    this.startFreeFlagRespawnTimer();
  }

  private processHotFlagAfterMove() {
    const now = Date.now();

    if (this.hotFlagMode === "free") {
      for (const [id, pl] of this.players) {
        if (this.flagSuppressedPlayers.has(id)) continue;
        if (!isFlagVehicle(pl.state.vehicle)) continue;
        const ppos = playerWorldPos(pl.state, this.globeRadius, _vFlag);
        const dx = ppos.x - this.hotFlagX;
        const dy = ppos.y - this.hotFlagY;
        const dz = ppos.z - this.hotFlagZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < FLAG_COLLECT_RADIUS) {
          if (this.hotFlagFreeRespawnTimer != null) {
            clearTimeout(this.hotFlagFreeRespawnTimer);
            this.hotFlagFreeRespawnTimer = null;
          }
          this.hotFlagMode = "held";
          this.hotFlagHolderId = id;
          this.hotFlagImmuneUntilMs = 0;
          this.clearAllChallengersWithBroadcast();
          this.broadcastFlagCollected({ holderId: id, holderName: pl.state.name });
          return;
        }
      }
      return;
    }

    if (this.hotFlagMode !== "held" || !this.hotFlagHolderId) return;

    const carrier = this.players.get(this.hotFlagHolderId);
    if (!carrier) {
      this.hotFlagMode = "inactive";
      this.hotFlagHolderId = null;
      this.clearAllChallengersWithBroadcast();
      return;
    }

    playerWorldPos(carrier.state, this.globeRadius, _vCarrier);
    const immune = now < this.hotFlagImmuneUntilMs;

    for (const [cid, entry] of [...this.hotFlagChallengers.entries()]) {
      const ch = this.players.get(cid);
      if (!ch || this.flagSuppressedPlayers.has(cid) || !isFlagVehicle(ch.state.vehicle)) {
        this.hotFlagChallengers.delete(cid);
        this.broadcastFlagCaptureEnd({ challengerId: cid });
        continue;
      }
      const cpos = playerWorldPos(ch.state, this.globeRadius, _vOtherPlayer);
      const dx = cpos.x - _vCarrier.x;
      const dy = cpos.y - _vCarrier.y;
      const dz = cpos.z - _vCarrier.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const inRange = dist < FLAG_CAPTURE_RADIUS && !immune;

      if (inRange) {
        entry.outOfRangeSinceMs = null;
        if (now - entry.startMs >= FLAG_CAPTURE_DURATION_MS) {
          const newHolderId = cid;
          const newHolder = ch;
          const previousHolderId = this.hotFlagHolderId!;
          const previousHolderName = carrier.state.name;
          const losers = [...this.hotFlagChallengers.keys()].filter((x) => x !== newHolderId);
          this.hotFlagHolderId = newHolderId;
          this.hotFlagImmuneUntilMs = now + FLAG_IMMUNITY_MS;
          for (const oid of losers) {
            this.broadcastFlagCaptureEnd({ challengerId: oid });
          }
          this.hotFlagChallengers.clear();
          this.broadcastFlagStolen({
            newHolderId,
            newHolderName: newHolder.state.name,
            previousHolderId,
            previousHolderName,
            immuneUntilMs: this.hotFlagImmuneUntilMs,
          });
          return;
        }
      } else {
        if (entry.outOfRangeSinceMs == null) {
          entry.outOfRangeSinceMs = now;
        } else if (now - entry.outOfRangeSinceMs >= FLAG_CAPTURE_GRACE_MS) {
          this.hotFlagChallengers.delete(cid);
          this.broadcastFlagCaptureEnd({ challengerId: cid });
        }
      }
    }

    if (immune) return;

    for (const [id, pl] of this.players) {
      if (id === this.hotFlagHolderId) continue;
      if (this.flagSuppressedPlayers.has(id)) continue;
      if (!isFlagVehicle(pl.state.vehicle)) continue;
      if (this.hotFlagChallengers.has(id)) continue;
      const ppos = playerWorldPos(pl.state, this.globeRadius, _vOtherPlayer);
      const dx = ppos.x - _vCarrier.x;
      const dy = ppos.y - _vCarrier.y;
      const dz = ppos.z - _vCarrier.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < FLAG_CAPTURE_RADIUS) {
        const startMs = Date.now();
        this.hotFlagChallengers.set(id, { startMs, outOfRangeSinceMs: null });
        this.broadcastFlagCaptureStart({
          challengerId: id,
          challengerName: pl.state.name,
          startMs,
        });
      }
    }
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
    socket.emit("flag:sync", this.buildFlagSync());

    this.scheduleHotFlagSpawnIfNeeded();

    return state;
  }

  removePlayer(socketId: string) {
    const player = this.players.get(socketId);
    if (!player) return;

    if (this.hotFlagChallengers.has(socketId)) {
      this.hotFlagChallengers.delete(socketId);
      this.broadcastFlagCaptureEnd({ challengerId: socketId });
    }

    if (this.hotFlagMode === "held" && this.hotFlagHolderId === socketId) {
      this.dropFlagFromHolder(player.state);
    }

    this.players.delete(socketId);
    this.paintballShotHistory.delete(socketId);
    this.paintballUpgrades.delete(socketId);
    this.flagSuppressedPlayers.delete(socketId);

    for (const [, p] of this.players) {
      p.socket.emit("player:left", socketId);
    }

    if (this.players.size === 0) {
      this.clearHotFlagTimers();
      this.hotFlagMode = "inactive";
      this.hotFlagHolderId = null;
      this.hotFlagImmuneUntilMs = 0;
      this.clearAllChallengersWithBroadcast();
      return;
    }

    if (this.players.size < 2 && this.hotFlagSpawnTimer != null) {
      clearTimeout(this.hotFlagSpawnTimer);
      this.hotFlagSpawnTimer = null;
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

    this.processHotFlagAfterMove();
  }
}
