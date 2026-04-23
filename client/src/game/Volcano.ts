import {
  AdditiveBlending,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { createNoise3D, sampleTerrain, terrainNoise } from "./SimplexNoise";
import {
  cartesianFromSpherical,
  tangentFrame,
} from "./SphericalMath";
import { PROP_TERRAIN_SINK, surfaceDisplacementAt } from "./TerrainSurface";
import { addRimLight } from "./RimLight";

export const VOLCANO_COUNT = 2;
export const VOLCANO_XP = 40;

const LAVA_BLOB_COUNT = 30;
const SMOKE_COUNT = 15;
const FLY_OVER_DIST = 0.65;
const REWARD_COOLDOWN_SEC = 90;

const REF_UP = new Vector3(0, 1, 0);

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

export function getVolcanoPlacementNormal(
  worldSeed: number,
  terrainType: string,
  volcanoIndex: number,
): Vector3 {
  const rand = seededRandom(worldSeed + volcanoIndex * 314159);

  let bestNormal: Vector3 | null = null;
  let bestElevation = 0;

  for (let attempts = 0; attempts < 3000; attempts++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    const sample = sampleTerrain(worldSeed, terrainType, nx, ny, nz);
    if (!sample.isLand) continue;
    const elevation = sample.elevation;
    if (elevation < 0.4) continue;

    if (elevation > bestElevation) {
      bestElevation = elevation;
      bestNormal = new Vector3(nx, ny, nz);
    }

    if (bestElevation > 0.6) break;
  }

  if (!bestNormal) {
    for (let k = 0; k < 128; k++) {
      const y = 1 - (k / 127) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = k * 0.6180339887 * Math.PI * 2;
      const nx = Math.cos(theta) * r;
      const ny = y;
      const nz = Math.sin(theta) * r;
      if (!sampleTerrain(worldSeed, terrainType, nx, ny, nz).isLand) continue;
      bestNormal = new Vector3(nx, ny, nz);
      break;
    }
  }

  return bestNormal ?? new Vector3(0, 1, 0);
}

/* ── Volcano body profile ──────────────────────────────────────── */

const S = 0.35;
const H = 1.25;
function buildVolcanoGeometry(seed: number): LatheGeometry {
  const profile: Vector2[] = [];
  const steps = 24;
  
  // Crater interior
  profile.push(new Vector2(0.00 * S, 0.88 * S * H));
  profile.push(new Vector2(0.06 * S, 0.88 * S * H)); // crater floor edge
  profile.push(new Vector2(0.09 * S, 0.94 * S * H)); // inner wall slope
  profile.push(new Vector2(0.12 * S, 0.98 * S * H)); // inner rim edge
  profile.push(new Vector2(0.18 * S, 1.00 * S * H)); // rim peak
  profile.push(new Vector2(0.24 * S, 0.98 * S * H)); // outer rim edge
  
  // Exterior slopes
  for (let i = 1; i <= steps; i++) {
    const t = i / steps; // 0 at top, 1 at bottom
    const r = 0.24 * S + Math.pow(t, 1.6) * 1.15 * S; // Reduced base width from 1.38 to 1.15
    const y = (1.0 - t) * 0.98 * S * H;
    profile.push(new Vector2(r, y));
  }

  const geo = new LatheGeometry(profile, 32);

  /* ── Perturb vertices for an irregular, non-circular shape ───── */
  const posAttr = geo.attributes.position;
  const rimY = S * H * 1.0;
  const noise = createNoise3D(seed);

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    if (r < 0.001) continue;

    const t = y / rimY;

    // Use 3D noise for organic, rocky shape
    const nVal = terrainNoise(noise, x * 4.0, y * 4.0, z * 4.0, 4, 2.0, 0.5, 1.0);
    const warp = (nVal - 0.5) * 2.0;

    const slopeBand = Math.sin(t * Math.PI);
    const heightFade = Math.max(slopeBand, (1.0 - t) * 0.6);
    const radialScale = 1.0 + warp * 0.25 * heightFade;

    posAttr.setX(i, x * radialScale);
    posAttr.setZ(i, z * radialScale);

    const yWarp = warp * 0.08 * S * slopeBand;
    posAttr.setY(i, y + yWarp);
  }
  posAttr.needsUpdate = true;

  /* ── Vertex colors ───────────────────────────────────────────── */
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    const t = Math.max(0, y / rimY);

    // Noise to break up color banding
    const cNoise = terrainNoise(noise, x * 10.0, y * 10.0, z * 10.0, 3, 2.0, 0.5, 1.0);
    const tMod = Math.max(0, Math.min(1, t + (cNoise - 0.5) * 0.25));

    let cr: number, cg: number, cb: number;
    if (tMod > 0.88 && r < 0.1 * S) {
      // Magma core inside
      cr = 0.85; cg = 0.25; cb = 0.05;
    } else if (tMod > 0.82) {
      // Scorched rim
      cr = 0.16; cg = 0.10; cb = 0.08;
    } else if (tMod > 0.55) {
      // Upper slopes (dark ash/rock)
      const tipT = (tMod - 0.55) / (0.82 - 0.55);
      const darkR = 0.16; const darkG = 0.10; const darkB = 0.08;
      const midR = 0.38; const midG = 0.24; const midB = 0.18;
      cr = midR + (darkR - midR) * tipT;
      cg = midG + (darkG - midG) * tipT;
      cb = midB + (darkB - midB) * tipT;
    } else {
      // Lower slopes (blending into terrain)
      const slopeT = Math.max(0, Math.min(1, tMod / 0.55));
      const topR = 0.38; const topG = 0.24; const topB = 0.18;
      const botR = 0.28; const botG = 0.32; const botB = 0.22; // Greenish-brown base
      cr = botR + (topR - botR) * slopeT;
      cg = botG + (topG - botG) * slopeT;
      cb = botB + (topB - botB) * slopeT;
    }
    
    // Add some subtle highlight noise
    const highlight = (cNoise - 0.5) * 0.1;
    colors[i * 3] = Math.max(0, Math.min(1, cr + highlight));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, cg + highlight));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, cb + highlight));
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ── Lava blob shaders ─────────────────────────────────────────── */

const lavaVert = /* glsl */ `
attribute float aLife;
varying vec2 vUv;
varying float vLife;
void main() {
  vUv = uv;
  vLife = aLife;
  vec4 worldPos = instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * worldPos;
}
`;

const lavaFrag = /* glsl */ `
varying vec2 vUv;
varying float vLife;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  vec3 core = vec3(1.0, 0.75, 0.15);
  vec3 mid  = vec3(1.0, 0.45, 0.02);
  vec3 edge = vec3(0.9, 0.20, 0.0);
  vec3 col = mix(core, mid, smoothstep(0.0, 0.5, d));
  col = mix(col, edge, smoothstep(0.4, 0.9, d));
  float fade = 1.0 - smoothstep(0.65, 1.0, vLife);
  float alpha = (1.0 - smoothstep(0.5, 1.0, d)) * fade;
  gl_FragColor = vec4(col * 3.0, alpha);
}
`;

/* ── Smoke shaders (billboard) ─────────────────────────────────── */

const smokeVert = /* glsl */ `
attribute float aLife;
varying vec2 vUv;
varying float vLife;
void main() {
  vUv = uv;
  vLife = aLife;
  vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 mvPos = modelViewMatrix * instancePos;
  float scaleX = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float scaleY = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
  mvPos.xy += position.xy * vec2(scaleX, scaleY);
  gl_Position = projectionMatrix * mvPos;
}
`;

const smokeFrag = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying float vLife;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  vec3 inner = vec3(0.6, 0.12, 0.03);
  vec3 outer = vec3(0.35, 0.05, 0.01);
  float t = smoothstep(0.0, 0.8, d);
  vec3 col = mix(inner, outer, t);
  float fadeIn = smoothstep(0.0, 0.15, vLife);
  float fadeOut = 1.0 - smoothstep(0.5, 1.0, vLife);
  float lifeFade = fadeIn * fadeOut;
  float alpha = (1.0 - smoothstep(0.3, 1.0, d)) * uOpacity * lifeFade;
  gl_FragColor = vec4(col * 1.2, alpha * 0.45);
}
`;

/* ── Per-particle state ────────────────────────────────────────── */

interface LavaBlob {
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  scale: number;
}

interface SmokeWisp {
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  scale: number;
  baseScale: number;
}

/* ── Volcano Class ─────────────────────────────────────────────── */

export class Volcano {
  readonly group = new Group();
  readonly craterWorldPos = new Vector3();

  private globeRadius: number;
  private normal = new Vector3();
  private up = new Vector3();
  private north = new Vector3();
  private east = new Vector3();

  private lavaMat: ShaderMaterial;
  private smokeMat: ShaderMaterial;
  private volcanoBodyMat: MeshPhongMaterial;
  private volcanoGeo: LatheGeometry;
  private lavaSphereGeo: SphereGeometry;
  private smokePlaneGeo: PlaneGeometry;

  private lavaInstanced: InstancedMesh;
  private smokeInstanced: InstancedMesh;
  private lavaBlobs: LavaBlob[] = [];
  private smokeWisps: SmokeWisp[] = [];
  private lavaLifeAttr: InstancedBufferAttribute;
  private smokeLifeAttr: InstancedBufferAttribute;

  private rewarded = false;
  private cooldown = 0;
  private time = 0;

  private tmpMat = new Matrix4();
  private tmpPos = new Vector3();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();

  private seedVal: number;

  constructor(
    scene: Scene,
    globeRadius: number,
    worldSeed: number,
    terrainType: string,
    volcanoIndex: number,
  ) {
    this.globeRadius = globeRadius;
    this.seedVal = worldSeed + volcanoIndex * 7723451;

    this.placeOnHighTerrain(worldSeed, terrainType, volcanoIndex);

    /* ── Volcano body ──────────────────────────────────────────── */
    this.volcanoGeo = buildVolcanoGeometry(this.seedVal);
    this.volcanoBodyMat = new MeshPhongMaterial({
      vertexColors: true,
      flatShading: true,
      emissive: 0x2a0a00,
      shininess: 5,
      side: DoubleSide,
    });
    addRimLight(this.volcanoBodyMat, 0xff5533, 0.52, 2.55);
    const bodyMesh = new Mesh(this.volcanoGeo, this.volcanoBodyMat);
    bodyMesh.castShadow = true;
    this.group.add(bodyMesh);

    /* ── Lava blobs (instanced) ────────────────────────────────── */
    this.lavaSphereGeo = new SphereGeometry(0.02, 5, 4);
    const lifeArray = new Float32Array(LAVA_BLOB_COUNT);
    this.lavaLifeAttr = new InstancedBufferAttribute(lifeArray, 1);
    this.lavaSphereGeo.setAttribute("aLife", this.lavaLifeAttr);

    this.lavaMat = new ShaderMaterial({
      vertexShader: lavaVert,
      fragmentShader: lavaFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.lavaInstanced = new InstancedMesh(this.lavaSphereGeo, this.lavaMat, LAVA_BLOB_COUNT);
    this.lavaInstanced.frustumCulled = false;
    this.lavaInstanced.renderOrder = 10;
    this.group.add(this.lavaInstanced);

    for (let i = 0; i < LAVA_BLOB_COUNT; i++) {
      this.lavaBlobs.push(this.spawnLavaBlob(i));
    }

    /* ── Smoke wisps (instanced billboard) ─────────────────────── */
    this.smokePlaneGeo = new PlaneGeometry(0.07, 0.07);
    const smokeLifeArray = new Float32Array(SMOKE_COUNT);
    this.smokeLifeAttr = new InstancedBufferAttribute(smokeLifeArray, 1);
    this.smokePlaneGeo.setAttribute("aLife", this.smokeLifeAttr);

    this.smokeMat = new ShaderMaterial({
      vertexShader: smokeVert,
      fragmentShader: smokeFrag,
      uniforms: { uOpacity: { value: 1.0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.smokeInstanced = new InstancedMesh(this.smokePlaneGeo, this.smokeMat, SMOKE_COUNT);
    this.smokeInstanced.frustumCulled = false;
    this.smokeInstanced.renderOrder = 11;
    this.group.add(this.smokeInstanced);

    for (let i = 0; i < SMOKE_COUNT; i++) {
      this.smokeWisps.push(this.spawnSmokeWisp(i));
    }

    scene.add(this.group);
  }

  /* ── Terrain placement ───────────────────────────────────────── */

  private placeOnHighTerrain(
    worldSeed: number,
    terrainType: string,
    volcanoIndex: number,
  ) {
    const bestNormal = getVolcanoPlacementNormal(worldSeed, terrainType, volcanoIndex);

    this.normal.copy(bestNormal);
    const displacement = surfaceDisplacementAt(
      worldSeed, terrainType, bestNormal.x, bestNormal.y, bestNormal.z,
    );
    const surfaceR = this.globeRadius + displacement - PROP_TERRAIN_SINK;

    const sinkIntoTerrain = S * 0.42;
    const placementR = surfaceR - sinkIntoTerrain;

    this.group.position.copy(bestNormal.clone().multiplyScalar(placementR));
    this.group.quaternion.setFromUnitVectors(REF_UP, bestNormal);
    this.group.rotateY(this.seededRandom(this.seedVal + 999)() * Math.PI * 2);

    const frame = tangentFrame(this.group.quaternion);
    this.up.copy(frame.up);
    this.north.copy(frame.north);
    this.east.copy(frame.east);

    this.craterWorldPos
      .copy(bestNormal)
      .multiplyScalar(placementR + S * H * 0.92);
  }

  private seededRandom(seed: number): () => number {
    return seededRandom(seed);
  }

  /* ── Lava blob lifecycle ─────────────────────────────────────── */

  private spawnLavaBlob(index: number): LavaBlob {
    const rand = this.seededRandom(this.seedVal + index * 6971 + Math.floor(this.time * 100));
    const spread = 0.03;
    const upSpeed = 0.12 + rand() * 0.16;
    return {
      pos: new Vector3(
        (rand() - 0.5) * spread,
        S * H * 0.92,
        (rand() - 0.5) * spread,
      ),
      vel: new Vector3(
        (rand() - 0.5) * 0.12,
        upSpeed,
        (rand() - 0.5) * 0.12,
      ),
      life: rand() * 3.0,
      maxLife: 2.5 + rand() * 2.0,
      scale: 0.8 + rand() * 0.8,
    };
  }

  private recycleLavaBlob(blob: LavaBlob, index: number) {
    const rand = this.seededRandom(this.seedVal + index * 6971 + Math.floor(this.time * 1000));
    const spread = 0.03;
    const upSpeed = 0.12 + rand() * 0.16;
    blob.pos.set(
      (rand() - 0.5) * spread,
      S * H * 0.92,
      (rand() - 0.5) * spread,
    );
    blob.vel.set(
      (rand() - 0.5) * 0.12,
      upSpeed,
      (rand() - 0.5) * 0.12,
    );
    blob.life = 0;
    blob.maxLife = 2.5 + rand() * 2.0;
    blob.scale = 0.8 + rand() * 0.8;
  }

  /* ── Smoke wisp lifecycle ────────────────────────────────────── */

  private spawnSmokeWisp(index: number): SmokeWisp {
    const rand = this.seededRandom(this.seedVal + index * 3389 + Math.floor(this.time * 100));
    const baseScale = 1.0 + rand() * 1.2;
    return {
      pos: new Vector3(
        (rand() - 0.5) * 0.04,
        S * H * 0.95 + rand() * 0.05,
        (rand() - 0.5) * 0.04,
      ),
      vel: new Vector3(
        (rand() - 0.5) * 0.008,
        0.025 + rand() * 0.025,
        (rand() - 0.5) * 0.008,
      ),
      life: rand() * 3.0,
      maxLife: 2.5 + rand() * 2.5,
      scale: baseScale,
      baseScale,
    };
  }

  private recycleSmokeWisp(wisp: SmokeWisp, index: number) {
    const rand = this.seededRandom(this.seedVal + index * 3389 + Math.floor(this.time * 1000));
    wisp.baseScale = 1.0 + rand() * 1.2;
    wisp.pos.set(
      (rand() - 0.5) * 0.04,
      S * H * 0.95 + rand() * 0.05,
      (rand() - 0.5) * 0.04,
    );
    wisp.vel.set(
      (rand() - 0.5) * 0.008,
      0.025 + rand() * 0.025,
      (rand() - 0.5) * 0.008,
    );
    wisp.life = 0;
    wisp.maxLife = 2.5 + rand() * 2.5;
    wisp.scale = wisp.baseScale;
  }

  /* ── Update ──────────────────────────────────────────────────── */

  update(
    dt: number,
    playerQ: Quaternion,
    playerAlt: number,
  ): { justCollected: boolean } {
    this.time += dt;
    this.lavaMat.uniforms.uTime.value = this.time;

    const gravity = 0.08;
    const craterY = S * H * 0.92;

    /* ── Lava blobs ────────────────────────────────────────────── */
    for (let i = 0; i < LAVA_BLOB_COUNT; i++) {
      const b = this.lavaBlobs[i]!;
      b.life += dt;

      if (b.life >= b.maxLife) {
        this.recycleLavaBlob(b, i);
      }

      b.vel.y -= gravity * dt;
      b.pos.addScaledVector(b.vel, dt);

      if (b.pos.y < 0) {
        this.recycleLavaBlob(b, i);
      }

      const lifeRatio = Math.min(1, b.life / b.maxLife);
      const scaleDecay = lifeRatio < 0.7 ? 1.0 : 1.0 - (lifeRatio - 0.7) / 0.3;
      const fadeScale = b.scale * scaleDecay;

      this.lavaLifeAttr.setX(i, lifeRatio);

      this.tmpScale.setScalar(fadeScale);
      this.tmpQuat.identity();
      this.tmpMat.compose(b.pos, this.tmpQuat, this.tmpScale);
      this.lavaInstanced.setMatrixAt(i, this.tmpMat);
    }
    this.lavaInstanced.instanceMatrix.needsUpdate = true;
    this.lavaLifeAttr.needsUpdate = true;

    /* ── Smoke wisps ───────────────────────────────────────────── */
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const w = this.smokeWisps[i]!;
      w.life += dt;

      if (w.life >= w.maxLife) {
        this.recycleSmokeWisp(w, i);
      }

      w.pos.addScaledVector(w.vel, dt);

      const lifeRatio = w.life / w.maxLife;
      w.scale = w.baseScale * (1 + lifeRatio * 1.5);

      this.smokeLifeAttr.setX(i, lifeRatio);

      this.tmpScale.setScalar(w.scale);
      this.tmpQuat.identity();
      this.tmpMat.compose(w.pos, this.tmpQuat, this.tmpScale);
      this.smokeInstanced.setMatrixAt(i, this.tmpMat);
    }
    this.smokeInstanced.instanceMatrix.needsUpdate = true;
    this.smokeLifeAttr.needsUpdate = true;

    /* ── Cooldown ──────────────────────────────────────────────── */
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.rewarded = false;
      }
      return { justCollected: false };
    }
    if (this.rewarded) return { justCollected: false };

    /* ── Fly-over detection ────────────────────────────────────── */
    const playerPos = this.tmpPos.copy(
      cartesianFromSpherical(playerQ, playerAlt, this.globeRadius),
    );
    const dist = playerPos.distanceTo(this.craterWorldPos);

    let justCollected = false;
    if (dist < FLY_OVER_DIST) {
      this.rewarded = true;
      justCollected = true;
      this.cooldown = REWARD_COOLDOWN_SEC;
    }

    return { justCollected };
  }

  /* ── Dispose ─────────────────────────────────────────────────── */

  dispose() {
    this.volcanoGeo.dispose();
    this.volcanoBodyMat.dispose();
    this.lavaSphereGeo.dispose();
    this.lavaMat.dispose();
    this.lavaInstanced.dispose();
    this.smokePlaneGeo.dispose();
    this.smokeMat.dispose();
    this.smokeInstanced.dispose();
    this.group.removeFromParent();
  }
}
