import {
  AdditiveBlending,
  Camera,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  Quaternion,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
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

/** Extra altitude above surface + {@link CARPET_HOVER_HEIGHT} so the rim always floats above the terrain. */
const PORTAL_CLEARANCE_ABOVE_HOVER = 0.22;

function seededUnit(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

/** Shared dark-blue radial halo (outer atmosphere). ~4× portal disc diameter. */
let portalHaloTex: CanvasTexture | null = null;
function getPortalHaloTexture(): CanvasTexture {
  if (portalHaloTex) return portalHaloTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.0, "rgba(0,8,32,0.12)");
  grad.addColorStop(0.2, "rgba(0,20,64,0.18)");
  grad.addColorStop(0.5, "rgba(0,32,100,0.12)");
  grad.addColorStop(0.78, "rgba(8,50,120,0.08)");
  grad.addColorStop(1.0, "rgba(0,0,0,0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  portalHaloTex = tex;
  return tex;
}

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
  float rRaw = length(uv) * 2.0; // 0 at center, 1 at edge
  float a = atan(uv.y, uv.x);

  // ── Edge distortion: spinning noise warps the portal silhouette ──────────
  // Sample two noise octaves driven by the angle and time so the rim churns.
  float edgeNoise1 = noise(vec2(a * 2.5 + uTime * 1.8, uTime * 0.7)) * 0.5 + 0.5;
  float edgeNoise2 = noise(vec2(a * 5.0 - uTime * 2.4, uTime * 1.1)) * 0.5 + 0.5;
  // Distortion is strongest at the rim and fades inward.
  float edgeDist = (edgeNoise1 * 0.6 + edgeNoise2 * 0.4 - 0.5) * 0.18 * smoothstep(0.55, 1.0, rRaw);
  float r = rRaw + edgeDist;

  // Discard outside the (now irregular) boundary
  if (r > 1.02) discard;

  // Gravitational swirl: spins exponentially faster near the center
  float gravity = 1.0 / (r + 0.15);
  float swirlAngle = a - uTime * 4.5 - gravity * 6.0;

  // Base space color
  vec3 col = vec3(0.01, 0.0, 0.03);

  // Deep Nebula Clouds
  float n1 = noise(vec2(r * 1.5 - uTime * 0.3, swirlAngle * 1.2));
  float n2 = noise(vec2(r * 4.0 + uTime * 0.5, swirlAngle * 3.0));
  float n3 = noise(vec2(r * 8.0 - uTime * 0.8, swirlAngle * 5.0));
  float nebula = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  float nebulaMask = smoothstep(0.05, 0.35, r) * smoothstep(1.0, 0.2, r);
  float gas = pow(nebula, 1.2) * nebulaMask;
  col += vec3(0.05, 0.1, 0.5) * gas * 2.5;
  col += vec3(0.3, 0.05, 0.6) * pow(gas, 1.5) * 2.0;
  col += vec3(0.5, 0.1, 0.8) * pow(gas, 2.0) * 1.5;

  // Wide disk mask so streaks cover the full face of the portal
  float diskMask = smoothstep(0.10, 0.28, r) * smoothstep(0.98, 0.15, r);

  // Spiral 1 — 3 arms, co-rotating, deep purple/blue
  // Lower pow = wider/thicker streak cross-section
  float spiral1 = sin(swirlAngle * 3.0) * 0.5 + 0.5;
  float disk1 = pow(spiral1 * n2, 0.7) * diskMask;
  col += vec3(0.2, 0.05, 0.5) * disk1 * 2.2;
  col += vec3(0.05, 0.1, 0.6) * pow(disk1, 1.2) * 1.8;
  col += vec3(0.4, 0.1, 0.8) * pow(disk1, 1.8) * 1.5;

  // Spiral 2 — 5 arms, counter-rotating, cyan/violet
  float swirlAngle2 = a + uTime * 3.5 - gravity * 4.0;
  float spiral2 = sin(swirlAngle2 * 5.0) * 0.5 + 0.5;
  float disk2 = pow(spiral2 * n2, 0.8) * diskMask;
  col += vec3(0.0, 0.5, 1.0) * disk2 * 2.2;
  col += vec3(0.7, 0.0, 1.0) * pow(disk2, 1.2) * 1.8;

  // Spiral 3 — 2 very broad arms, fast co-rotating, warm magenta accent
  float swirlAngle3 = a - uTime * 6.0 - gravity * 8.0;
  float spiral3 = sin(swirlAngle3 * 2.0) * 0.5 + 0.5;
  float disk3 = pow(spiral3 * n1, 0.6) * diskMask;
  col += vec3(0.9, 0.1, 0.4) * disk3 * 1.6;
  col += vec3(1.0, 0.4, 0.1) * pow(disk3, 1.0) * 1.2;

  // Spiral 4 — 8 arms, counter-rotating, electric blue (outer emphasis)
  float outerDiskMask = smoothstep(0.32, 0.50, r) * smoothstep(0.98, 0.40, r);
  float swirlAngle4 = a + uTime * 5.2 - gravity * 2.5;
  float spiral4 = sin(swirlAngle4 * 8.0) * 0.5 + 0.5;
  float disk4 = pow(spiral4, 2.0) * outerDiskMask;
  col += vec3(0.0, 0.8, 1.0) * disk4 * 2.8;
  col += vec3(0.5, 0.0, 1.0) * pow(disk4, 1.4) * 2.0;

  // Energy tendrils — broad whipping strands across the whole disc
  float n4 = noise(vec2(r * 10.0 - uTime * 2.8, swirlAngle * 7.0));
  float n5 = noise(vec2(r * 16.0 + uTime * 4.0, swirlAngle * 10.0));
  float tendrils = pow(n4 * n5, 0.9) * smoothstep(0.05, 0.22, r) * smoothstep(0.96, 0.08, r);
  col += vec3(0.1, 0.7, 1.0) * tendrils * 5.5;

  // Filigree threads — slightly thickened so they read over the nebula
  float n6 = noise(vec2(r * 22.0 - uTime * 5.5, swirlAngle * 15.0));
  float n7 = noise(vec2(r * 30.0 + uTime * 7.0, swirlAngle * 20.0));
  float filigree = pow(n6 * n7, 1.3) * smoothstep(0.1, 0.28, r) * smoothstep(0.92, 0.12, r);
  col += vec3(0.4, 0.9, 1.0) * filigree * 4.0;

  // Outer lensing ring
  float lensRing = exp(-pow((r - 0.88) * 30.0, 2.0));
  float lGrad = 0.5 + 0.5 * sin(a * 2.0 - uTime * 3.8);
  vec3 lensCol = mix(vec3(0.0, 0.55, 1.0), vec3(0.38, 0.2, 0.95), lGrad);
  col += lensCol * lensRing * 2.0;

  // Deep blue rim fill
  col += vec3(0.0, 0.06, 0.35) * smoothstep(0.5, 0.98, r) * 2.5;

  // Stars streaking with the swirl
  vec2 st = vec2(r * cos(swirlAngle), r * sin(swirlAngle));
  vec2 cell = floor(st * 60.0) + 0.5;
  float h = hash12(cell);
  float tw = 0.5 + 0.5 * sin(uTime * 5.0 + h * 20.0);
  float star = step(0.94, h) * tw * smoothstep(0.3, 0.5, r) * smoothstep(0.95, 0.6, r);
  col += mix(vec3(0.1, 0.2, 0.8), vec3(0.5, 0.1, 0.9), hash12(cell + 10.0)) * star * 1.2;

  // Tone mapping
  col = 1.0 - exp(-col * 1.5);

  // Event Horizon (pure black core)
  col *= smoothstep(0.18, 0.25, r);

  // Edge alpha — uses distorted r so the fade follows the churning silhouette
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
  private readonly halo: Sprite;
  private readonly haloMat: SpriteMaterial;
  private readonly timePhase: number;

  constructor(timePhase: number) {
    this.timePhase = timePhase;
    this.scaledGroup.scale.set(0.65, 1.25, 1.0);
    this.group.add(this.scaledGroup);

    // Outer dark-blue atmosphere (drawn under the disc)
    this.haloMat = new SpriteMaterial({
      map: getPortalHaloTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.halo = new Sprite(this.haloMat);
    this.halo.renderOrder = -1;
    const portalDiameter = 2.0 * R * 1.25 * 1.25;
    this.halo.scale.setScalar(portalDiameter * 4.0);
    this.scaledGroup.add(this.halo);

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
    this.inner.renderOrder = 0;
    this.scaledGroup.add(this.inner);
  }

  applyPose(worldPosition: Vector3) {
    this.group.position.copy(worldPosition);
    this.group.matrixWorldNeedsUpdate = true;
  }

  update(time: number, camera: Camera, opacity: number) {
    this.innerMat.uniforms.uTime.value = time + this.timePhase;
    this.innerMat.uniforms.uOpacity.value = opacity;
    this.haloMat.opacity = 0.45 * opacity;
    this.group.quaternion.copy(camera.quaternion);
  }

  dispose() {
    this.inner.geometry.dispose();
    this.innerMat.dispose();
    this.haloMat.dispose();
  }
}

function pickWorldPose(
  globeRadius: number,
  worldSeed: number,
  terrainType: string,
  rand: () => number,
  /** Bias the starting heading to a 120°-wide sector so portals spread across the globe. */
  sectorAngle = 0,
): { qPosition: Quaternion; heading: number; altitude: number } {
  for (let k = 0; k < 500; k++) {
    const q = new Quaternion();
    // Restrict start heading to ±60° of the sector centre so each portal lives in its own third.
    const h0 = sectorAngle + (rand() - 0.5) * ((Math.PI * 2) / 3);
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
    const altitude = minAlt + PORTAL_CLEARANCE_ABOVE_HOVER;
    const heading = rand() * Math.PI * 2;
    return { qPosition: finalQ, heading, altitude };
  }
  const fallbackQ = moveOnSphere(new Quaternion(), 0, 0.4);
  const fb = tangentFrame(fallbackQ);
  const minAlt =
    surfaceAltitudeAt(worldSeed, terrainType, fb.up.x, fb.up.y, fb.up.z) + CARPET_HOVER_HEIGHT;
  return {
    qPosition: fallbackQ,
    heading: 0,
    altitude: minAlt + PORTAL_CLEARANCE_ABOVE_HOVER,
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
    const sectorAngle = (index / 3) * Math.PI * 2;
    const { qPosition, heading, altitude } = pickWorldPose(
      globeRadius,
      seed + index * 100,
      terrainType,
      rand,
      sectorAngle,
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
