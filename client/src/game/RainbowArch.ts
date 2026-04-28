import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Quaternion,
  Scene,
  ShaderMaterial,
  DoubleSide,
  Vector3,
} from "three";
import {
  cartesianFromSpherical,
  randomSpawnQuaternionAndHeading,
  tangentFrame,
} from "./SphericalMath";

export const RAINBOW_COUNT = 2;
export const RAINBOW_XP = 35;

const REWARD_COOLDOWN_SEC = 90;
const ARCH_RADIUS = 0.9;
const BAND_WIDTH = 0.24;
const INNER_R = ARCH_RADIUS - BAND_WIDTH / 2;
const OUTER_R = ARCH_RADIUS + BAND_WIDTH / 2;
const ARC_SEGMENTS = 40;
const FLY_THROUGH_DIST = 0.35;

/* ── Geometry ───────────────────────────────────────────────────── */

function createRainbowGeometry(): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const u = i / ARC_SEGMENTS;
    const angle = u * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    positions.push(INNER_R * cos, INNER_R * sin, 0);
    uvs.push(u, 0);

    positions.push(OUTER_R * cos, OUTER_R * sin, 0);
    uvs.push(u, 1);
  }

  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/* ── Shader ─────────────────────────────────────────────────────── */

const rainbowVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const rainbowFrag = /* glsl */ `
uniform float uDayWeight;
varying vec2 vUv;

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  float hue = mix(0.0, 0.75, vUv.y);
  vec3 col = hsv2rgb(vec3(hue, 0.65, 1.0));

  float groundFade = sin(vUv.x * 3.14159265);
  float edgeSoft = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
  float alpha = groundFade * edgeSoft * 0.55 * uDayWeight;

  gl_FragColor = vec4(col, alpha);
}
`;

/* ── Class ──────────────────────────────────────────────────────── */

export class RainbowArch {
  readonly group = new Group();

  private globeRadius: number;
  private mesh: Mesh;
  private material: ShaderMaterial;

  private qPosition = new Quaternion();
  private archUp = new Vector3();
  private archRight = new Vector3();
  private archCenter = new Vector3();

  private rewarded = false;
  private cooldown = 0;
  private fadeOut = 0;
  private fadeIn = 0;
  private static readonly FADE_OUT_SEC = 0.35;
  private static readonly FADE_IN_SEC = 0.3;

  private scratch = new Vector3();

  constructor(scene: Scene, globeRadius: number, worldSeed: number, archIndex: number) {
    this.globeRadius = globeRadius;

    const geo = createRainbowGeometry();
    this.material = new ShaderMaterial({
      vertexShader: rainbowVert,
      fragmentShader: rainbowFrag,
      uniforms: { uDayWeight: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, this.material);
    this.group.add(this.mesh);

    this.placeOnGlobe(worldSeed, archIndex);
    scene.add(this.group);
  }

  private placeOnGlobe(seed: number, index: number) {
    const spawn = randomSpawnQuaternionAndHeading(seed + index * 573259391);
    this.qPosition.copy(spawn.qPosition);
    const heading = spawn.heading;

    const frame = tangentFrame(this.qPosition);

    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    this.archRight
      .copy(frame.north)
      .multiplyScalar(cos)
      .addScaledVector(frame.east, sin)
      .normalize();
    this.archUp.copy(frame.up);

    const surfacePos = cartesianFromSpherical(this.qPosition, 0, this.globeRadius);
    this.archCenter.copy(surfacePos);

    const archNormal = new Vector3().crossVectors(this.archRight, this.archUp).normalize();

    this.group.position.copy(surfacePos);

    const m = this.group.matrix;
    m.makeBasis(this.archRight, this.archUp, archNormal);
    m.setPosition(surfacePos);
    this.group.matrixAutoUpdate = false;
    this.group.matrixWorldNeedsUpdate = true;
  }

  update(
    dt: number,
    playerQ: Quaternion,
    playerAlt: number,
    dayWeight: number,
  ): { justCollected: boolean } {
    const sharpDay = dayWeight * dayWeight * (3 - 2 * dayWeight);
    let opacity = sharpDay;

    if (this.fadeOut > 0) {
      this.fadeOut = Math.max(0, this.fadeOut - dt);
      opacity *= this.fadeOut / RainbowArch.FADE_OUT_SEC;
    } else if (this.rewarded) {
      opacity = 0;
    }

    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt);
      opacity *= 1 - this.fadeIn / RainbowArch.FADE_IN_SEC;
    }

    this.material.uniforms.uDayWeight.value = opacity;
    this.group.visible = opacity > 0.01;

    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.rewarded = false;
        this.fadeIn = RainbowArch.FADE_IN_SEC;
      }
      return { justCollected: false };
    }

    if (this.rewarded) return { justCollected: false };

    const playerPos = cartesianFromSpherical(playerQ, playerAlt, this.globeRadius);
    const midR = (INNER_R + OUTER_R) / 2;

    const toPlayer = this.scratch.copy(playerPos).sub(this.archCenter);
    const compRight = toPlayer.dot(this.archRight);
    const compUp = toPlayer.dot(this.archUp);

    let angle = Math.atan2(compUp, compRight);

    let dist: number;
    if (angle >= 0 && angle <= Math.PI) {
      angle = Math.max(0, Math.min(Math.PI, angle));
      const closestOnArc = new Vector3()
        .copy(this.archCenter)
        .addScaledVector(this.archRight, midR * Math.cos(angle))
        .addScaledVector(this.archUp, midR * Math.sin(angle));
      dist = playerPos.distanceTo(closestOnArc);
    } else {
      const clampedUp = Math.max(0, compUp);
      const leftFoot = new Vector3()
        .copy(this.archCenter)
        .addScaledVector(this.archRight, -midR)
        .addScaledVector(this.archUp, clampedUp);
      const rightFoot = new Vector3()
        .copy(this.archCenter)
        .addScaledVector(this.archRight, midR)
        .addScaledVector(this.archUp, clampedUp);
      dist = Math.min(playerPos.distanceTo(leftFoot), playerPos.distanceTo(rightFoot));
    }

    let justCollected = false;
    if (dist < FLY_THROUGH_DIST) {
      this.rewarded = true;
      justCollected = true;
      this.cooldown = REWARD_COOLDOWN_SEC;
      this.fadeOut = RainbowArch.FADE_OUT_SEC;
    }

    return { justCollected };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
