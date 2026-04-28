import {
  Scene,
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  MeshPhongMaterial,
  MeshBasicMaterial,
  Material,
  Quaternion,
  type Camera,
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
import { RemoteCarpetPortalSystem } from "./CarpetPortalSystem";
import { PlayerBeacon } from "./PlayerBeacon";

const INTERPOLATION_DELAY_MS = 100;
const CORRECTION_DURATION_MS = 150;
const MAX_BUFFER_SIZE = 6;
const MIN_ALTITUDE = 0.15;
const MIN_ALTITUDE_BOAT = -0.02;
const MAX_ALTITUDE = 3.0;

const BOAT_BOB_AMPLITUDE = 0.009;
const BOAT_BOB_SPEED = 2.6;
const BOAT_PITCH_BOB_AMP = 0.042;
const BOAT_PITCH_BOB_SPEED = 2.1;
const BOAT_ROLL_BOB_AMP = 0.05;
const BOAT_ROLL_BOB_SPEED = 1.55;

type PartialState = Pick<
  PlayerState,
  "qx" | "qy" | "qz" | "qw" | "heading" | "pitch" | "altitude" | "speed" | "bankAngle" | "rollAngle"
>;

interface BufferedSnapshot {
  state: PlayerState;
  receivedAt: number;
}

const STRING_LENGTH = 0.12;

function createRemoteCarryPackage(): Group {
  const g = new Group();
  const stringGeo = new CylinderGeometry(0.001, 0.001, STRING_LENGTH, 4);
  stringGeo.translate(0, -STRING_LENGTH / 2, 0);
  g.add(new Mesh(stringGeo, new MeshBasicMaterial({ color: 0xf5deb3 })));

  const pkg = new Group();
  pkg.add(new Mesh(new BoxGeometry(0.05, 0.04, 0.05), new MeshPhongMaterial({ color: 0x8b6914 })));
  const strapGeo = new BoxGeometry(0.056, 0.004, 0.008);
  const strapMat = new MeshPhongMaterial({ color: 0xf5deb3 });
  const s1 = new Mesh(strapGeo, strapMat);
  s1.position.y = 0.022;
  pkg.add(s1);
  const s2 = new Mesh(strapGeo, strapMat);
  s2.position.y = 0.022;
  s2.rotation.y = Math.PI / 2;
  pkg.add(s2);
  pkg.position.y = -STRING_LENGTH;
  g.add(pkg);

  g.visible = false;
  return g;
}

/** Multiplayer hot-flag marker above remote vehicles (separate from package `carrying`). */
function createRemoteHotFlag(timeUniform: { value: number }): Group {
  const g = new Group();
  const pole = new Mesh(
    new CylinderGeometry(0.003, 0.003, 0.14, 6),
    new MeshBasicMaterial({ color: 0xf7c948 }),
  );
  pole.position.y = 0.07;
  g.add(pole);

  const clothGeo = new BoxGeometry(0.07, 0.045, 0.005, 10, 4, 1);
  const clothMat = new MeshBasicMaterial({ color: 0xe8b030 });
  clothMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float edge = smoothstep(-0.035, 0.035, position.x);
       float wave = sin(position.x * 40.0 - uTime * 8.0) * 0.6
                  + sin(position.y * 30.0 - uTime * 5.0) * 0.4;
       transformed.z += wave * 0.025 * edge;
      `
    );
  };
  const cloth = new Mesh(clothGeo, clothMat);
  cloth.position.set(0.0375, 0.115, 0);
  g.add(cloth);
  g.position.y = 0.125;
  g.visible = false;
  return g;
}

const REMOTE_COLORS = [0x44aaff, 0x44dd66, 0xffaa22, 0xdd44dd, 0x22dddd, 0xff6688];
let colorIndex = 0;

function nextRemoteColor(): number {
  const c = REMOTE_COLORS[colorIndex % REMOTE_COLORS.length];
  colorIndex++;
  return c;
}

const REMOTE_OPACITY_EPSILON = 0.001;

interface RemoteOpacityMaterial {
  material: Material & { opacity: number; transparent: boolean; depthWrite: boolean };
  baseOpacity: number;
}

/** Remote vehicle material list is stable after construction; cache it instead of traversing every frame. */
function collectRemoteOpacityMaterials(root: Group): RemoteOpacityMaterial[] {
  const seen = new Set<Material>();
  const out: RemoteOpacityMaterial[] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (seen.has(mat) || !("opacity" in mat)) continue;
      seen.add(mat);
      const m = mat as Material & { opacity: number; transparent: boolean; depthWrite: boolean };
      out.push({ material: m, baseOpacity: m.opacity });
    }
  });
  return out;
}

/** Scale cached remote mesh material opacities. */
function applyRemoteOpacity(materials: RemoteOpacityMaterial[], opacity: number) {
  const o = Math.max(0, Math.min(1, opacity));
  for (const { material, baseOpacity } of materials) {
    material.opacity = baseOpacity * o;
    material.transparent = material.opacity < 0.998 || baseOpacity < 0.998;
    material.depthWrite = material.opacity >= 0.998;
  }
}

class RemotePlane {
  readonly id: string;
  private _name: string;
  get name(): string {
    return this._name;
  }
  readonly group: Group;
  readonly beacon: PlayerBeacon;
  readonly vehicleType: Vehicle;
  private readonly vehicle: Vehicle;
  private readonly remoteCarpetPortals: RemoteCarpetPortalSystem | null;
  private readonly carryPackage: Group;
  private readonly hotFlag: Group;
  private carrying = false;

  private buffer: BufferedSnapshot[] = [];
  private globeRadius: number;

  private correcting = false;
  private correctionFrom: PartialState | null = null;
  private correctionProgress = 0;
  private lastRendered: PartialState | null = null;
  private wasDeadReckoning = false;
  private bobTime = Math.random() * Math.PI * 2;
  private timeUniform = { value: 0 };
  private hullColor: number;
  private visibilityTarget = 1;
  private visibilitySmooth = 1;
  private lastAppliedOpacity = Number.NaN;
  private readonly opacityMaterials: RemoteOpacityMaterial[];
  private lastCarpetPortalTeleportSeq: number | null = null;

  private paintballWobbleAmp = 0;
  private paintballWobblePhase = 0;
  private paintballWobbleBank = 0;

  get visibilityOpacity(): number {
    return this.visibilitySmooth;
  }

  get portalGroup(): Group | null {
    return this.remoteCarpetPortals?.group ?? null;
  }

  constructor(
    id: string,
    name: string,
    globeRadius: number,
    vehicle: Vehicle = "plane",
    initialHullColor?: number,
  ) {
    this.id = id;
    this._name = name;
    this.globeRadius = globeRadius;
    this.vehicle = vehicle;
    this.vehicleType = vehicle;
    const color = initialHullColor ?? nextRemoteColor();
    this.hullColor = color;
    this.group =
      vehicle === "boat"
        ? createBoat(color)
        : vehicle === "carpet"
          ? createCarpet(color)
          : createBiplane(color);
    this.remoteCarpetPortals =
      vehicle === "carpet" ? new RemoteCarpetPortalSystem(globeRadius) : null;
    this.group.matrixAutoUpdate = false;
    this.beacon = new PlayerBeacon(color);
    this.carryPackage = createRemoteCarryPackage();
    this.group.add(this.carryPackage);
    this.hotFlag = createRemoteHotFlag(this.timeUniform);
    this.group.add(this.hotFlag);
    this.opacityMaterials = collectRemoteOpacityMaterials(this.group);
  }

  /** Multiplayer hot-flag bearer (not related to {@link PlayerState.carrying} / package). */
  setCarryingFlag(on: boolean) {
    this.hotFlag.visible = on;
  }

  private applyHullColor(hex: number) {
    if (hex === this.hullColor) return;
    this.hullColor = hex;
    const mat = this.group.userData.hullMaterial as MeshPhongMaterial | undefined;
    if (mat) mat.color.setHex(hex);
    this.beacon.setColor(hex);
  }

  pushState(state: PlayerState) {
    if (state.name) this._name = state.name;
    if (state.vehicleColor !== undefined) {
      this.applyHullColor(state.vehicleColor);
    }
    const nextPortalTeleportSeq = state.carpetPortalTeleportSeq;
    const portalTeleported =
      this.vehicle === "carpet" &&
      nextPortalTeleportSeq !== undefined &&
      this.lastCarpetPortalTeleportSeq !== null &&
      nextPortalTeleportSeq !== this.lastCarpetPortalTeleportSeq;
    if (nextPortalTeleportSeq !== undefined) {
      this.lastCarpetPortalTeleportSeq = nextPortalTeleportSeq;
    }
    this.remoteCarpetPortals?.sync(state.carpetPortals);
    if (portalTeleported) {
      this.buffer.length = 0;
      this.correcting = false;
      this.correctionFrom = null;
      this.correctionProgress = 0;
      this.wasDeadReckoning = false;
      this.visibilitySmooth = 0;
      this.lastAppliedOpacity = 0;
      applyRemoteOpacity(this.opacityMaterials, 0);
      this.beacon.setOpacityMultiplier(0);
    }
    this.buffer.push({ state, receivedAt: Date.now() });
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }
    this.carrying = state.carrying ?? false;
    this.carryPackage.visible = this.carrying;
    this.visibilityTarget = Math.max(0, Math.min(1, state.visibility ?? 1));

    if (!portalTeleported && this.wasDeadReckoning && this.lastRendered) {
      this.correcting = true;
      this.correctionFrom = { ...this.lastRendered };
      this.correctionProgress = 0;
    }
    this.wasDeadReckoning = false;
  }

  /** Rolls the biplane mesh briefly (visual only); no-op for boat/carpet. */
  triggerPaintballHitWobble() {
    if (this.vehicle !== "plane") return;
    this.paintballWobbleAmp = 0.42;
    this.paintballWobblePhase = 0;
  }

  update(dt: number) {
    this.timeUniform.value += dt;
    if (this.vehicle === "plane") {
      if (this.paintballWobbleAmp > 0.002) {
        this.paintballWobblePhase += dt * 19;
        this.paintballWobbleBank =
          Math.sin(this.paintballWobblePhase) * this.paintballWobbleAmp;
        this.paintballWobbleAmp *= Math.exp(-4.2 * dt);
      } else {
        this.paintballWobbleAmp = 0;
        this.paintballWobbleBank = 0;
      }
    }
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
          name: this._name,
          ...this.correctionFrom,
          timestamp: 0,
        };
        const to: PlayerState = {
          id: this.id,
          name: this._name,
          ...computed,
          timestamp: 0,
        };
        computed = slerpPlayerState(from, to, this.correctionProgress);
      }
    }

    this.lastRendered = computed;
    this.applyToMesh(computed, dt);

    if (this.group.userData.propeller && computed.speed !== undefined) {
      this.group.userData.propeller.rotation.z -= (computed.speed * 15 + 10) * dt;
    }

    this.remoteCarpetPortals?.update(dt);
    this.visibilitySmooth += (this.visibilityTarget - this.visibilitySmooth) * Math.min(1, dt * 10);
    if (
      Number.isNaN(this.lastAppliedOpacity) ||
      Math.abs(this.visibilitySmooth - this.lastAppliedOpacity) > REMOTE_OPACITY_EPSILON
    ) {
      this.lastAppliedOpacity = this.visibilitySmooth;
      applyRemoteOpacity(this.opacityMaterials, this.visibilitySmooth);
      this.beacon.setOpacityMultiplier(this.visibilitySmooth);
    }
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
    const minAlt = this.vehicle === "boat" ? MIN_ALTITUDE_BOAT : MIN_ALTITUDE;
    return deadReckon(
      lastSnap.state,
      elapsed,
      this.globeRadius,
      minAlt,
      MAX_ALTITUDE,
    );
  }

  private applyToMesh(state: PartialState, dt: number) {
    const qPos = new Quaternion(state.qx, state.qy, state.qz, state.qw);
    let m;
    if (this.vehicle === "boat") {
      this.bobTime += dt;
      const bobAlt = state.altitude + Math.sin(this.bobTime * BOAT_BOB_SPEED) * BOAT_BOB_AMPLITUDE;
      const bobPitch = Math.sin(this.bobTime * BOAT_PITCH_BOB_SPEED + 1.3) * BOAT_PITCH_BOB_AMP;
      const bobRoll = Math.sin(this.bobTime * BOAT_ROLL_BOB_SPEED + 2.7) * BOAT_ROLL_BOB_AMP;
      m = buildBoatMatrix(qPos, state.heading, bobAlt, this.globeRadius, bobPitch, bobRoll);
    } else {
      const bank = (state.bankAngle ?? 0) + this.paintballWobbleBank;
      m = buildPlaneMatrix(
        qPos,
        state.heading,
        state.pitch,
        bank,
        state.altitude,
        this.globeRadius,
      );
    }
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;

    const pos = this.group.position.setFromMatrixPosition(m);
    this.beacon.mesh.position.copy(pos);
  }

  dispose() {
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) (child as any).material.dispose();
    });
    this.remoteCarpetPortals?.dispose();
    this.beacon.dispose();
  }
}

/** World-space label anchor for each remote player (used by HUD name pills). */
export interface RemotePlayerForLabel {
  id: string;
  name: string;
  group: Group;
  vehicleType: Vehicle;
  /** Smoothed 0–1 for name pill / mesh fade (moon cutscene). */
  visibilityOpacity: number;
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

  forEachRemote(fn: (player: RemotePlayerForLabel) => void) {
    for (const [, rp] of this.planes) {
      fn({
        id: rp.id,
        name: rp.name,
        group: rp.group,
        vehicleType: rp.vehicleType,
        visibilityOpacity: rp.visibilityOpacity,
      });
    }
  }

  addPlayer(state: PlayerState) {
    if (this.planes.has(state.id)) return;
    const v: Vehicle =
      state.vehicle === "boat" ? "boat" :
      state.vehicle === "carpet" ? "carpet" : "plane";
    const rp = new RemotePlane(state.id, state.name, this.globeRadius, v, state.vehicleColor);
    rp.pushState(state);
    this.planes.set(state.id, rp);
    this.scene.add(rp.group);
    this.scene.add(rp.beacon.mesh);
    if (rp.portalGroup) this.scene.add(rp.portalGroup);
  }

  removePlayer(playerId: string) {
    const rp = this.planes.get(playerId);
    if (!rp) return;
    this.scene.remove(rp.group);
    this.scene.remove(rp.beacon.mesh);
    if (rp.portalGroup) this.scene.remove(rp.portalGroup);
    rp.dispose();
    this.planes.delete(playerId);
  }

  /** Biplane root for paint splatters (see `BiplaneMesh` `splatterAnchor`). */
  getPlaneGroup(playerId: string): Group | null {
    return this.planes.get(playerId)?.group ?? null;
  }

  setPlayerCarryingFlag(playerId: string, on: boolean) {
    this.planes.get(playerId)?.setCarryingFlag(on);
  }

  triggerPaintballHitWobble(playerId: string) {
    this.planes.get(playerId)?.triggerPaintballHitWobble();
  }

  updatePlayer(state: PlayerState) {
    const rp = this.planes.get(state.id);
    if (!rp) {
      this.addPlayer(state);
      return;
    }
    const incomingVehicle: Vehicle =
      state.vehicle === "boat" ? "boat" :
      state.vehicle === "carpet" ? "carpet" : "plane";
    if (rp.vehicleType !== incomingVehicle) {
      this.removePlayer(state.id);
      this.addPlayer(state);
      return;
    }
    rp.pushState(state);
  }

  setVisible(visible: boolean) {
    for (const rp of this.planes.values()) {
      rp.group.visible = visible;
      rp.beacon.mesh.visible = visible;
      if (rp.portalGroup) rp.portalGroup.visible = visible;
    }
  }

  update(dt: number, camera?: Camera) {
    for (const [, rp] of this.planes) {
      rp.update(dt);
      if (camera) rp.beacon.update(camera);
    }
  }

  dispose() {
    for (const [, rp] of this.planes) {
      this.scene.remove(rp.group);
      this.scene.remove(rp.beacon.mesh);
      if (rp.portalGroup) this.scene.remove(rp.portalGroup);
      rp.dispose();
    }
    this.planes.clear();
  }
}
