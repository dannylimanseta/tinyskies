import {
  AdditiveBlending,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Shape,
  Vector3,
} from "three";
import { cartesianFromSpherical, moveOnSphere } from "./SphericalMath";
import type { Plane } from "./Plane";
import { holoVert, holoFrag } from "./Rings";

/** Matches plane starting cruise in Rings / `Plane.ALTITUDE`. */
const HEART_FLIGHT_ALTITUDE = 0.55;
const HEART_COUNT = 7;
const COLLECT_RADIUS = 0.3;
const SPIN_RATE = 2.4;
/** Slightly larger than the old tube heart read. */
const HEART_MESH_SCALE = 0.1;
const RESPAWN_DELAY_MIN = 2.0;
const RESPAWN_DELAY_MAX = 4.0;
const BOB_LIFT = 0.01;
const BOB_AMP = 0.014;
const HEAL_HP = 3;
const MIN_SPACING = 1.45;
const MIN_PLAYER_SPAWN_DIST = 1.9;

const _q = new Quaternion();
const _qAlign = new Quaternion();
const _Y = new Vector3(0, 1, 0);

/**
 * Filled 2D heart in XY, symmetric about Y, opening at top cleft — classic
 * Bezier heart (e.g. canvas tutorials). Vertices ordered CCW for outer normal.
 */
function buildHeartProfileShape(): Shape {
  const s = 1;
  const w = 1.35; // Widen the heart profile
  const x = 0;
  const y = 0;
  const sh = new Shape();
  sh.moveTo(x, y + s * 0.25);
  sh.bezierCurveTo(x, y, x - s * 0.5 * w, y, x - s * 0.5 * w, y + s * 0.25);
  sh.bezierCurveTo(x - s * 0.5 * w, y + s * 0.65, x, y + s * 0.85, x, y + s * 1.15);
  sh.bezierCurveTo(x, y + s * 0.85, x + s * 0.5 * w, y + s * 0.65, x + s * 0.5 * w, y + s * 0.25);
  sh.bezierCurveTo(x + s * 0.5 * w, y, x, y, x, y + s * 0.25);
  return sh;
}

export function createHeartExtrudeGeometry(): ExtrudeGeometry {
  const shape = buildHeartProfileShape();
  const geo = new ExtrudeGeometry(shape, {
    depth: 0.15,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.15,
    bevelOffset: 0,
    bevelSegments: 8,
    curveSegments: 24,
  });
  geo.center();
  // Shape is authored like canvas coordinates (y+ down); flip so cleft is up on the globe.
  geo.scale(1, -1, 1);
  geo.computeVertexNormals();
  return geo;
}

interface HeartState {
  mesh: Mesh;
  pointLight: PointLight;
  qPosition: Quaternion;
  active: boolean;
  spawnScale: number;
  phase: number;
  spinAngle: number;
  upAxis: Vector3;
  pendingRespawn: { timer: number; delay: number } | null;
}

export class GremlinHearts {
  readonly group = new Group();
  private readonly globeRadius: number;
  private time = 0;
  private hearts: HeartState[] = [];
  private readonly heartGeometry: ExtrudeGeometry;
  private heartHealMult = 1;

  onCollect: ((heal: number, worldPos: Vector3) => void) | null = null;

  constructor(globeRadius: number, seed: number, _terrainType: string) {
    this.globeRadius = globeRadius;
    void _terrainType;
    void seed;
    this.heartGeometry = createHeartExtrudeGeometry();
    for (let i = 0; i < HEART_COUNT; i++) {
      this.pushNewHeart();
    }
  }

  setHeartHealMult(m: number) {
    this.heartHealMult = Math.max(0.1, m);
  }

  /** Add extra world hearts (e.g. from Heart Orchard upgrade). */
  addBonusHearts(n: number) {
    for (let i = 0; i < n; i++) {
      this.pushNewHeart();
    }
  }

  private pushNewHeart() {
    const mat = new ShaderMaterial({
      vertexShader: holoVert,
      fragmentShader: holoFrag,
      uniforms: {
        time: { value: 0 },
        phaseOffset: { value: Math.random() * Math.PI * 2 },
        spawnScale: { value: 0 },
      },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(this.heartGeometry, mat);
    mesh.frustumCulled = false;
    const pointLight = new PointLight(0xff6677, 0.38, 0.45, 1.2);
    pointLight.position.set(0, 0, 0);
    mesh.add(pointLight);
    this.group.add(mesh);
    this.hearts.push(this.createHeartState(mesh, pointLight));
  }

  private createHeartState(
    mesh: Mesh,
    pointLight: PointLight,
  ): HeartState {
    const qPos = this.randomSpherePosition();
    const worldPos = cartesianFromSpherical(qPos, HEART_FLIGHT_ALTITUDE, this.globeRadius);
    const upAxis = worldPos.clone().normalize();
    mesh.position.copy(worldPos);
    mesh.scale.setScalar(0);
    return {
      mesh,
      pointLight,
      qPosition: qPos,
      active: true,
      spawnScale: 0,
      phase: Math.random() * Math.PI * 2,
      spinAngle: Math.random() * Math.PI * 2,
      upAxis,
      pendingRespawn: null,
    };
  }

  private randomSpherePosition(avoidQ?: Quaternion): Quaternion {
    for (let attempt = 0; attempt < 80; attempt++) {
      const q = new Quaternion();
      const h = Math.random() * Math.PI * 2;
      const a = 0.35 + Math.random() * 2.4;
      const q1 = moveOnSphere(q, h, a);
      const h2 = Math.random() * Math.PI * 2;
      const a2 = Math.random() * 1.4;
      const finalQ = moveOnSphere(q1, h2, a2);
      const candidate = cartesianFromSpherical(
        finalQ,
        HEART_FLIGHT_ALTITUDE,
        this.globeRadius,
      );
      let tooClose = false;
      for (const s of this.hearts) {
        if (!s.active) continue;
        const other = cartesianFromSpherical(
          s.qPosition,
          HEART_FLIGHT_ALTITUDE,
          this.globeRadius,
        );
        if (candidate.distanceTo(other) < MIN_SPACING) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      if (avoidQ) {
        const playerP = cartesianFromSpherical(
          avoidQ,
          HEART_FLIGHT_ALTITUDE,
          this.globeRadius,
        );
        if (candidate.distanceTo(playerP) < MIN_PLAYER_SPAWN_DIST) continue;
      }
      return finalQ;
    }
    const q = new Quaternion();
    return moveOnSphere(q, Math.random() * Math.PI * 2, 0.5 + Math.random() * 2.0);
  }

  /**
   * Only runs for plane; caller gates on vehicle.
   * @param portalInteractionSuppressed — when true, skip (same as diamond rings)
   */
  update(dt: number, localPlayer: Plane, portalInteractionSuppressed: boolean) {
    this.time += dt;
    const planePos = cartesianFromSpherical(
      localPlayer.qPosition,
      localPlayer.altitude,
      this.globeRadius,
    );

    for (const h of this.hearts) {
      if (h.pendingRespawn) {
        h.pendingRespawn.timer += dt;
        if (h.pendingRespawn.timer >= h.pendingRespawn.delay) {
          h.qPosition.copy(this.randomSpherePosition(localPlayer.qPosition));
          const base = cartesianFromSpherical(
            h.qPosition,
            HEART_FLIGHT_ALTITUDE,
            this.globeRadius,
          );
          h.upAxis.copy(base).normalize();
          h.mesh.position.copy(base);
          h.mesh.scale.setScalar(0);
          h.spawnScale = 0;
          h.active = true;
          h.mesh.visible = true;
          h.pendingRespawn = null;
        }
      }

      if (!h.active) continue;

      if (h.spawnScale < 1) {
        h.spawnScale = Math.min(1, h.spawnScale + dt * 2.2);
        const t = 0.5 + 0.5 * (1 - Math.pow(1 - h.spawnScale, 3));
        const s = HEART_MESH_SCALE * t;
        h.mesh.scale.set(s, s, s);
      } else {
        h.mesh.scale.setScalar(HEART_MESH_SCALE);
      }

      const mat = h.mesh.material as ShaderMaterial;
      mat.uniforms.time.value = this.time;
      mat.uniforms.spawnScale.value = h.spawnScale;

      const bob =
        BOB_LIFT + Math.sin(this.time * 1.35 + h.phase) * BOB_AMP;
      const worldPos = cartesianFromSpherical(
        h.qPosition,
        HEART_FLIGHT_ALTITUDE,
        this.globeRadius,
      );
      h.mesh.position.copy(worldPos).addScaledVector(h.upAxis, bob);

      h.spinAngle += SPIN_RATE * dt;
      _qAlign.setFromUnitVectors(_Y, h.upAxis);
      _q.setFromAxisAngle(_Y, h.spinAngle);
      h.mesh.quaternion.copy(_qAlign).multiply(_q);

      h.pointLight.intensity = 0.3 + 0.18 * Math.sin(this.time * 2.1 + h.phase * 0.5);

      if (portalInteractionSuppressed) continue;
      if (!localPlayer.canHealFromGremlinPickups()) continue;

      const d = h.mesh.position.distanceTo(planePos);
      if (d < COLLECT_RADIUS) {
        const worldPos = new Vector3();
        h.mesh.getWorldPosition(worldPos);
        h.active = false;
        h.mesh.visible = false;
        const heal = Math.max(1, Math.round(HEAL_HP * this.heartHealMult));
        this.onCollect?.(heal, worldPos);
        h.pendingRespawn = {
          timer: 0,
          delay: RESPAWN_DELAY_MIN + Math.random() * (RESPAWN_DELAY_MAX - RESPAWN_DELAY_MIN),
        };
      }
    }
  }

  dispose() {
    for (const child of this.group.children) {
      const m = child as Mesh;
      if (m.material) (m.material as ShaderMaterial).dispose();
    }
    this.heartGeometry.dispose();
    this.hearts.length = 0;
  }
}
