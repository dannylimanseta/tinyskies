import {
  AdditiveBlending,
  Camera,
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
uniform float uOpacity;
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

  // Gravitational swirl: spins exponentially faster near the center to simulate intense distortion
  float gravity = 1.0 / (r + 0.15);
  float swirlAngle = a - uTime * 2.0 - gravity * 3.5;

  // Base space color
  vec3 col = vec3(0.01, 0.0, 0.03);

  // Deep Nebula Clouds (low frequency noise for voluminous gas)
  float n1 = noise(vec2(r * 1.5 - uTime * 0.3, swirlAngle * 1.2));
  float n2 = noise(vec2(r * 4.0 + uTime * 0.5, swirlAngle * 3.0));
  float n3 = noise(vec2(r * 8.0 - uTime * 0.8, swirlAngle * 5.0));
  
  // Combine noise into a cloudy nebula texture
  float nebula = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  
  // Nebula intensity: glowing near the center, fading into the void
  float nebulaMask = smoothstep(0.05, 0.35, r) * smoothstep(1.0, 0.2, r);
  float gas = pow(nebula, 1.2) * nebulaMask;
  
  // Voluminous nebula colors (Deep cosmic blues, purples)
  col += vec3(0.05, 0.1, 0.5) * gas * 2.5;      // Deep dark blue
  col += vec3(0.3, 0.05, 0.6) * pow(gas, 1.5) * 2.0; // Deep purple mid gas
  col += vec3(0.5, 0.1, 0.8) * pow(gas, 2.0) * 1.5; // Violet core highlights

  // Accretion disk / sharp spiral arms slicing through the nebula
  float spiral = sin(swirlAngle * 4.0) * 0.5 + 0.5;
  float diskMask = smoothstep(0.15, 0.4, r) * smoothstep(0.9, 0.2, r);
  float disk = pow(spiral * n2, 1.5) * diskMask;
  
  // Mix of different shades of purple and dark blue, avoiding blowing out to pure white
  col += vec3(0.2, 0.05, 0.5) * disk * 1.8;           // Deep purple streaks
  col += vec3(0.05, 0.1, 0.6) * pow(disk, 2.0) * 1.5; // Dark blue
  col += vec3(0.4, 0.1, 0.8) * pow(disk, 3.0) * 1.2; // Rich violet core

  // Stars (streaking into the black hole due to the extreme swirl angle)
  vec2 st = vec2(r * cos(swirlAngle), r * sin(swirlAngle));
  vec2 sCoord = st * 60.0;
  vec2 cell = floor(sCoord) + 0.5;
  float h = hash12(cell);
  
  // Twinkle
  float tw = 0.5 + 0.5 * sin(uTime * 5.0 + h * 20.0);
  
  // Stars get stretched by the swirl naturally
  float star = step(0.965, h) * tw;
  
  // Fade stars near center
  float starMask = smoothstep(0.3, 0.5, r) * smoothstep(0.95, 0.6, r);
  star *= starMask;
  
  // Color the streaking stars (dark blues and purples instead of bright white)
  vec3 starColor = mix(vec3(0.1, 0.2, 0.8), vec3(0.5, 0.1, 0.9), hash12(cell + 10.0));
  col += starColor * star * 1.2;

  // Soft tone mapping to prevent any additive colors from blowing out into pure white
  col = 1.0 - exp(-col * 1.5);

  // Event Horizon (pure black core)
  float eventHorizon = smoothstep(0.18, 0.25, r);
  col *= eventHorizon;

  // Extremely soft fade at the outer edge of the portal so it blends into the world invisibly
  // Starting the fade at r = 0.3 makes the edge highly feathered
  float edgeA = 1.0 - smoothstep(0.3, 0.9, r);
  
  gl_FragColor = vec4(col, edgeA * uOpacity);
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
    this.scaledGroup.scale.set(0.65, 1.25, 1.0);
    this.group.add(this.scaledGroup);

    this.innerMat = new ShaderMaterial({
      uniforms: { 
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
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

  applyPose(worldPosition: Vector3) {
    this.group.position.copy(worldPosition);
    this.group.matrixWorldNeedsUpdate = true;
  }

  update(time: number, camera: Camera, opacity: number) {
    this.innerMat.uniforms.uTime.value = time + this.timePhase;
    this.innerMat.uniforms.uOpacity.value = opacity;
    this.group.quaternion.copy(camera.quaternion);
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
    /** Just above ground / carpet — keep low so the portal reads near the terrain. */
    const altitude = minAlt + 0.04;
    const heading = rand() * Math.PI * 2;
    return { qPosition: finalQ, heading, altitude };
  }
  return {
    qPosition: moveOnSphere(new Quaternion(), 0, 0.4),
    heading: 0,
    altitude: 0.22 + portalHalfHeight,
  };
}

/**
 * One fixed “cosmic” portal in the world for carpet / capy runs (room for more logic later).
 */
export class CosmicWorldPortal {
  readonly group = new Group();
  readonly worldPosition = new Vector3();
  private time = 0;
  private readonly visual: CosmicWorldPortalVisual;

  constructor(
    globeRadius: number,
    seed: number,
    terrainType: string,
    index: number,
  ) {
    const rand = seededUnit(seed + 19023841 + index * 9999);
    const { qPosition, heading, altitude } = pickWorldPose(
      globeRadius,
      seed + index * 100,
      terrainType,
      rand,
    );
    this.worldPosition.copy(cartesianFromSpherical(qPosition, altitude, globeRadius));

    this.visual = new CosmicWorldPortalVisual(seed * 0.0012 + index * 10);
    this.visual.applyPose(this.worldPosition);
    this.group.add(this.visual.group);
  }

  update(dt: number, camera: Camera, opacity: number) {
    this.time += dt;
    this.visual.update(this.time, camera, opacity);
  }

  dispose() {
    this.visual.dispose();
    this.group.clear();
  }
}
