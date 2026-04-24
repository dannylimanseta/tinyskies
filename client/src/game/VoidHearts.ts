import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  PointLight,
  ShaderMaterial,
  Vector3,
} from "three";
import { createHeartExtrudeGeometry } from "./GremlinHearts";
import { holoVert, holoFrag } from "./Rings";

const HEART_COUNT = 5;
const COLLECT_RADIUS = 0.28;
const SPAWN_RING_MIN = 1.4;
const SPAWN_RING_MAX = 3.2;
const HEART_SCALE = 0.08;
const SPIN_RATE = 2.2;
const BOB_AMP = 0.018;
const RESPAWN_DELAY = 12.0;
/** HP restored to the shield per heart. */
export const VOID_HEART_HEAL = 2;

interface HeartState {
  mesh: Mesh;
  light: PointLight;
  worldPos: Vector3;
  upAxis: Vector3;
  active: boolean;
  phase: number;
  spinAngle: number;
  spawnScale: number;
  respawnTimer: number;
}

export class VoidHearts {
  readonly group = new Group();
  private hearts: HeartState[] = [];
  private readonly geo = createHeartExtrudeGeometry();
  private time = 0;

  /** Fired when the player collects a heart. Arg is HP to restore. */
  onCollect: ((heal: number) => void) | null = null;

  /**
   * @param flamePos World position of the eternal flame.
   * @param planeUp  Radial-up unit vector of the void plane.
   * @param planeN   North tangent vector of the void plane.
   * @param planeE   East tangent vector of the void plane.
   */
  constructor(
    flamePos: Vector3,
    planeUp: Vector3,
    planeN: Vector3,
    planeE: Vector3,
  ) {
    for (let i = 0; i < HEART_COUNT; i++) {
      this.spawnHeart(flamePos, planeUp, planeN, planeE);
    }
  }

  private spawnHeart(
    flamePos: Vector3,
    planeUp: Vector3,
    planeN: Vector3,
    planeE: Vector3,
  ) {
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
    const mesh = new Mesh(this.geo, mat);
    mesh.frustumCulled = false;

    const light = new PointLight(0xff5566, 0.4, 0.5, 1.5);
    mesh.add(light);
    this.group.add(mesh);

    const angle = (this.hearts.length / HEART_COUNT) * Math.PI * 2 + Math.random() * 0.8;
    const dist = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
    const worldPos = flamePos.clone()
      .addScaledVector(planeN, Math.cos(angle) * dist)
      .addScaledVector(planeE, Math.sin(angle) * dist)
      .addScaledVector(planeUp, (Math.random() - 0.5) * 0.3);

    mesh.position.copy(worldPos);
    mesh.scale.setScalar(0);

    this.hearts.push({
      mesh,
      light,
      worldPos,
      upAxis: planeUp.clone(),
      active: true,
      phase: Math.random() * Math.PI * 2,
      spinAngle: Math.random() * Math.PI * 2,
      spawnScale: 0,
      respawnTimer: 0,
    });
  }

  update(dt: number, carpetWorldPos: Vector3) {
    this.time += dt;

    for (const h of this.hearts) {
      const mat = h.mesh.material as ShaderMaterial;

      if (!h.active) {
        h.respawnTimer -= dt;
        if (h.respawnTimer <= 0) {
          h.active = true;
          h.mesh.visible = true;
          h.spawnScale = 0;
        }
        continue;
      }

      // Spawn-in pop
      if (h.spawnScale < 1) {
        h.spawnScale = Math.min(1, h.spawnScale + dt * 3.0);
        mat.uniforms.spawnScale.value = h.spawnScale;
        h.mesh.scale.setScalar(HEART_SCALE * h.spawnScale);
      }

      // Bob + spin
      const bob = Math.sin(this.time * 1.8 + h.phase) * BOB_AMP;
      h.spinAngle += SPIN_RATE * dt;
      const bobVec = h.upAxis.clone().multiplyScalar(bob);
      h.mesh.position.copy(h.worldPos).add(bobVec);
      h.mesh.quaternion.setFromAxisAngle(h.upAxis, h.spinAngle);

      mat.uniforms.time.value = this.time + h.phase;

      // Proximity collect
      if (h.mesh.position.distanceTo(carpetWorldPos) < COLLECT_RADIUS) {
        h.active = false;
        h.mesh.visible = false;
        h.respawnTimer = RESPAWN_DELAY;
        this.onCollect?.(VOID_HEART_HEAL);
      }
    }
  }

  dispose() {
    this.geo.dispose();
    for (const h of this.hearts) {
      (h.mesh.material as ShaderMaterial).dispose();
    }
    this.group.clear();
    this.hearts = [];
  }
}
