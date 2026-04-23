import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from "three";
import { CARPET_HOVER_HEIGHT } from "./Carpet";
import { isLand } from "./SimplexNoise";
import { cartesianFromSpherical, moveOnSphere, tangentFrame } from "./SphericalMath";
import { surfaceAltitudeAt } from "./TerrainSurface";

/** Matches {@link CarpetPortalSystem} base torus/inner size; this portal is a bit larger. */
const BASE_PORTAL_RADIUS = 0.15;
const BASE_TUBE_RADIUS = 0.022;

/** Slightly larger than the player-placed carpet portal. */
export const COSMIC_WORLD_PORTAL_SCALE = 1.3;

const R = BASE_PORTAL_RADIUS * COSMIC_WORLD_PORTAL_SCALE;
const T = BASE_TUBE_RADIUS * COSMIC_WORLD_PORTAL_SCALE;

function seededUnit(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

const cosmicRingColor = 0x9966ff;

const cosmicInnerVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const cosmicInnerFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;

// Pseudo-random noise
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 2D noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = vUv - 0.5;
  float r = length(uv) * 2.0; // 0 at center, 1 at edge
  if (r > 1.0) discard;
  
  float a = atan(uv.y, uv.x);

  // Swirl angle based on radius and time (center spins faster)
  float swirlAngle = a - uTime * 1.5 + (1.0 - r) * 6.0;

  // Base deep space color
  vec3 col = vec3(0.01, 0.0, 0.03);

  // Nebula / Spiral arms using noise and sine waves
  float spiral = sin(swirlAngle * 3.0) * 0.5 + 0.5;
  
  // Add some turbulence to the spiral
  float turb = noise(vec2(r * 5.0, swirlAngle * 2.0 - uTime));
  spiral = mix(spiral, turb, 0.4);

  // Focus spiral arms in the mid-range
  float armMask = smoothstep(0.1, 0.4, r) * smoothstep(0.9, 0.6, r);
  float arms = pow(spiral, 2.0) * armMask;
  
  // Violet and blue nebula colors
  col += vec3(0.4, 0.1, 0.9) * arms * 1.2;
  col += vec3(0.1, 0.6, 1.0) * pow(arms, 2.0) * 1.5;
  col += vec3(1.0, 0.4, 0.8) * pow(arms, 4.0) * 2.0;

  // Stars (using swirling coordinates so they streak and spin)
  vec2 st = vec2(r * cos(swirlAngle), r * sin(swirlAngle));
  vec2 sCoord = st * 70.0;
  vec2 cell = floor(sCoord) + 0.5;
  float h = hash12(cell);
  
  // Twinkle
  float tw = 0.5 + 0.5 * sin(uTime * 4.0 + h * 20.0);
  
  // Only show brightest stars
  float star = step(0.96, h) * tw;
  
  // Fade stars near center and edge
  float starMask = smoothstep(0.15, 0.4, r) * smoothstep(0.9, 0.7, r);
  star *= starMask;
  
  // Give stars a slight color variation
  vec3 starColor = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.8, 0.9), hash12(cell + 10.0));
  col += starColor * star * 3.0;

  // Core black hole (pure black in the center)
  float blackHole = smoothstep(0.12, 0.28, r);
  col *= blackHole;

  // Outer glowing accretion ring
  float ring = smoothstep(0.65, 0.9, r) * smoothstep(1.0, 0.85, r);
  col += vec3(0.5, 0.2, 1.0) * ring * 0.9;
  col += vec3(0.2, 0.6, 1.2) * pow(ring, 3.0) * 1.5;

  // Opaque disc; soften the outer rim to blend into the world
  float edgeA = 1.0 - smoothstep(0.85, 1.0, r);
  
  gl_FragColor = vec4(col, edgeA);
}
`;

/**
 * A single pre-placed portal: same “Portal 2” style stack as `CarpetPortalSystem` (procedural
 * torus + inner disc), scaled up, with a cosmic void / starfield inner surface.
 */
class CosmicWorldPortalVisual {
  readonly group = new Group();
  private readonly scaledGroup = new Group();
  private inner: Mesh;
  private innerMat: ShaderMaterial;
  private readonly timePhase: number;

  constructor(timePhase: number) {
    this.timePhase = timePhase;
    this.group.matrixAutoUpdate = false;
    this.scaledGroup.scale.set(0.65, 1.25, 1.0);
    this.group.add(this.scaledGroup);

    this.innerMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: cosmicInnerVert,
      fragmentShader: cosmicInnerFrag,
      transparent: true,
      side: DoubleSide,
      depthWrite: true,
      depthTest: true,
      blending: NormalBlending,
    });

    // Full portal size
    this.inner = new Mesh(new CircleGeometry(R * 1.25, 40), this.innerMat);
    this.scaledGroup.add(this.inner);
  }

  applyPose(
    worldPosition: Vector3,
    right: Vector3,
    up: Vector3,
    forward: Vector3,
  ) {
    const m = new Matrix4().makeBasis(right, up, forward);
    m.setPosition(worldPosition);
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
  }

  update(time: number) {
    this.innerMat.uniforms.uTime.value = time + this.timePhase;
  }

  dispose() {
    this.inner.geometry.dispose();
    this.innerMat.dispose();
  }
}

function pickWorldPose(
  globeRadius: number,
  worldSeed: number,
  terrainType: string,
  rand: () => number,
): { qPosition: Quaternion; heading: number; altitude: number } {
  const portalHalfHeight = R * 1.25 + T;
  const safePad = 0.02;
  for (let k = 0; k < 500; k++) {
    const q = new Quaternion();
    const h0 = rand() * Math.PI * 2;
    const a0 = 0.35 + rand() * 2.2;
    const q1 = moveOnSphere(q, h0, a0);
    const h1 = rand() * Math.PI * 2;
    const a1 = rand() * 1.4;
    const finalQ = moveOnSphere(q1, h1, a1);
    const frame = tangentFrame(finalQ);
    const surfN = new Vector3(frame.up.x, frame.up.y, frame.up.z);
    if (!isLand(worldSeed, terrainType, surfN.x, surfN.y, surfN.z)) continue;

    const minAlt =
      surfaceAltitudeAt(worldSeed, terrainType, frame.up.x, frame.up.y, frame.up.z) + CARPET_HOVER_HEIGHT;
    const altitude = Math.max(minAlt + portalHalfHeight + safePad, minAlt);
    const heading = rand() * Math.PI * 2;
    return { qPosition: finalQ, heading, altitude };
  }
  return {
    qPosition: moveOnSphere(new Quaternion(), 0, 0.4),
    heading: 0,
    altitude: 0.5 + portalHalfHeight,
  };
}

/**
 * One fixed “cosmic” portal in the world for carpet / capy runs (room for more logic later).
 */
export class CosmicWorldPortal {
  readonly group = new Group();
  private time = 0;
  private readonly visual: CosmicWorldPortalVisual;

  constructor(
    globeRadius: number,
    seed: number,
    terrainType: string,
  ) {
    const rand = seededUnit(seed + 19023841);
    const { qPosition, heading, altitude } = pickWorldPose(
      globeRadius,
      seed,
      terrainType,
      rand,
    );
    const worldPosition = cartesianFromSpherical(qPosition, altitude, globeRadius);
    const frame = tangentFrame(qPosition);
    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(heading))
      .addScaledVector(frame.east, Math.sin(heading))
      .normalize();
    const right = new Vector3().crossVectors(forward, frame.up).normalize();

    this.visual = new CosmicWorldPortalVisual(seed * 0.0012);
    this.visual.applyPose(worldPosition, right, frame.up, forward);
    this.group.add(this.visual.group);
  }

  update(dt: number) {
    this.time += dt;
    this.visual.update(this.time);
  }

  dispose() {
    this.visual.dispose();
    this.group.clear();
  }
}
