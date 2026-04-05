import {
  Scene,
  Group,
  Quaternion,
} from "three";
import type { PlayerState, Vehicle } from "@globefly/shared";
import {
  slerpPlayerState,
  deadReckon,
  buildPlaneMatrix,
  buildBoatMatrix,
} from "./SphericalMath";
import { createBiplane } from "./BiplaneMesh";
import { createBoat } from "./BoatMesh";
import { createCarpet } from "./CarpetMesh";

const INTERPOLATION_DELAY_MS = 100;
const CORRECTION_DURATION_MS = 150;
const MAX_BUFFER_SIZE = 6;
const MIN_ALTITUDE = 0.15;
const MAX_ALTITUDE = 3.0;

type PartialState = Pick<
  PlayerState,
  "qx" | "qy" | "qz" | "qw" | "heading" | "pitch" | "altitude" | "speed" | "bankAngle" | "rollAngle"
>;

interface BufferedSnapshot {
  state: PlayerState;
  receivedAt: number;
}

const REMOTE_COLORS = [0x44aaff, 0x44dd66, 0xffaa22, 0xdd44dd, 0x22dddd, 0xff6688];
let colorIndex = 0;

function nextRemoteColor(): number {
  const c = REMOTE_COLORS[colorIndex % REMOTE_COLORS.length];
  colorIndex++;
  return c;
}

class RemotePlane {
  readonly id: string;
  readonly name: string;
  readonly group: Group;
  private readonly vehicle: Vehicle;

  private buffer: BufferedSnapshot[] = [];
  private globeRadius: number;

  private correcting = false;
  private correctionFrom: PartialState | null = null;
  private correctionProgress = 0;
  private lastRendered: PartialState | null = null;
  private wasDeadReckoning = false;

  constructor(id: string, name: string, globeRadius: number, vehicle: Vehicle = "plane") {
    this.id = id;
    this.name = name;
    this.globeRadius = globeRadius;
    this.vehicle = vehicle;
    const color = nextRemoteColor();
    this.group =
      vehicle === "boat"
        ? createBoat(color)
        : vehicle === "carpet"
          ? createCarpet(color)
          : createBiplane(color);
    this.group.matrixAutoUpdate = false;
  }

  pushState(state: PlayerState) {
    this.buffer.push({ state, receivedAt: Date.now() });
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }

    // If we were dead reckoning, start a correction blend
    if (this.wasDeadReckoning && this.lastRendered) {
      this.correcting = true;
      this.correctionFrom = { ...this.lastRendered };
      this.correctionProgress = 0;
    }
    this.wasDeadReckoning = false;
  }

  update(dt: number) {
    const now = Date.now();
    const renderTime = now - INTERPOLATION_DELAY_MS;

    let computed: PartialState;

    // Try interpolation first
    const interpResult = this.tryInterpolate(renderTime);
    if (interpResult) {
      computed = interpResult;
      this.wasDeadReckoning = false;
    } else {
      // Fall back to dead reckoning
      computed = this.doDeadReckon(renderTime);
      this.wasDeadReckoning = true;
    }

    // Apply correction smoothing if active
    if (this.correcting && this.correctionFrom) {
      this.correctionProgress += (dt * 1000) / CORRECTION_DURATION_MS;
      if (this.correctionProgress >= 1) {
        this.correcting = false;
        this.correctionFrom = null;
      } else {
        const from: PlayerState = {
          id: this.id,
          name: this.name,
          ...this.correctionFrom,
          timestamp: 0,
        };
        const to: PlayerState = {
          id: this.id,
          name: this.name,
          ...computed,
          timestamp: 0,
        };
        computed = slerpPlayerState(from, to, this.correctionProgress);
      }
    }

    this.lastRendered = computed;
    this.applyToMesh(computed);
  }

  private tryInterpolate(renderTime: number): PartialState | null {
    if (this.buffer.length < 2) return null;

    // Find two snapshots that bracket renderTime
    let a: PlayerState | null = null;
    let b: PlayerState | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const sa = this.buffer[i].state;
      const sb = this.buffer[i + 1].state;
      if (sa.timestamp <= renderTime && sb.timestamp >= renderTime) {
        a = sa;
        b = sb;
        break;
      }
    }

    if (!a || !b) return null;

    const range = b.timestamp - a.timestamp;
    const t = range > 0 ? (renderTime - a.timestamp) / range : 0;

    return slerpPlayerState(a, b, Math.max(0, Math.min(1, t)));
  }

  private doDeadReckon(renderTime: number): PartialState {
    const lastSnap = this.buffer[this.buffer.length - 1];
    if (!lastSnap) {
      return {
        qx: 0, qy: 0, qz: 0, qw: 1,
        heading: 0, pitch: 0, altitude: 0.55, speed: 1.0,
        bankAngle: 0, rollAngle: 0,
      };
    }

    const elapsed = Math.max(0, (renderTime - lastSnap.state.timestamp) / 1000);
    return deadReckon(
      lastSnap.state,
      elapsed,
      this.globeRadius,
      MIN_ALTITUDE,
      MAX_ALTITUDE,
    );
  }

  private applyToMesh(state: PartialState) {
    const qPos = new Quaternion(state.qx, state.qy, state.qz, state.qw);
    const m =
      this.vehicle === "boat"
        ? buildBoatMatrix(qPos, state.heading, state.altitude, this.globeRadius)
        : buildPlaneMatrix(
            qPos,
            state.heading,
            state.pitch,
            state.bankAngle,
            state.altitude,
            this.globeRadius,
          );
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
  }

  dispose() {
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) (child as any).material.dispose();
    });
  }
}

export class RemotePlaneManager {
  private scene: Scene;
  private globeRadius: number;
  private planes = new Map<string, RemotePlane>();

  constructor(scene: Scene, globeRadius: number) {
    this.scene = scene;
    this.globeRadius = globeRadius;
  }

  get count() {
    return this.planes.size;
  }

  addPlayer(state: PlayerState) {
    if (this.planes.has(state.id)) return;
    const v: Vehicle =
      state.vehicle === "boat" ? "boat" :
      state.vehicle === "carpet" ? "carpet" : "plane";
    const rp = new RemotePlane(state.id, state.name, this.globeRadius, v);
    rp.pushState(state);
    this.planes.set(state.id, rp);
    this.scene.add(rp.group);
  }

  removePlayer(playerId: string) {
    const rp = this.planes.get(playerId);
    if (!rp) return;
    this.scene.remove(rp.group);
    rp.dispose();
    this.planes.delete(playerId);
  }

  updatePlayer(state: PlayerState) {
    const rp = this.planes.get(state.id);
    if (!rp) {
      this.addPlayer(state);
      return;
    }
    rp.pushState(state);
  }

  update(dt: number) {
    for (const [, rp] of this.planes) {
      rp.update(dt);
    }
  }

  dispose() {
    for (const [, rp] of this.planes) {
      rp.dispose();
    }
    this.planes.clear();
  }
}
