import {
  AdditiveBlending,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { createNoise3D, terrainNoise } from "./SimplexNoise";
import { getTerrainParams } from "./TerrainPresets";
import {
  cartesianFromSpherical,
  quaternionFromSurfaceNormal,
  seededRandom,
  tangentFrame,
} from "./SphericalMath";
import { PROP_TERRAIN_SINK, surfaceDisplacementAt } from "./TerrainSurface";

const REF_UP = new Vector3(0, 1, 0);
const SMOKE_COUNT = 6;
const LANDING_DIST = 1.0;
const MARKER_SCALE = 0.06;

/* ── Smoke billboard shaders ─────────────────────────────────── */

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
varying vec2 vUv;
varying float vLife;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  vec3 col = vec3(0.65, 0.62, 0.58);
  float fadeIn = smoothstep(0.0, 0.15, vLife);
  float fadeOut = 1.0 - smoothstep(0.5, 1.0, vLife);
  float lifeFade = fadeIn * fadeOut;
  float alpha = (1.0 - smoothstep(0.3, 1.0, d)) * lifeFade;
  gl_FragColor = vec4(col, alpha * 0.35);
}
`;

/* ── Beacon beam shaders ──────────────────────────────────── */

const beamVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const beamFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float xFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
  xFade = pow(xFade, 3.0);
  float yFade = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float pulse = 0.7 + 0.3 * sin(uTime * 2.0);
  vec3 col = vec3(1.0, 0.85, 0.5);
  float alpha = xFade * yFade * pulse * 0.35;
  gl_FragColor = vec4(col, alpha);
}
`;

function createCampfireIconTexture(): CanvasTexture {
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  const cx = S / 2;
  const cy = S / 2;

  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#fff";
  const bx = cx - 16;
  const by = cy + 8;
  ctx.fillRect(bx, by, 8, 16);
  ctx.fillRect(bx + 12, by + 4, 8, 12);
  ctx.fillRect(bx + 24, by, 8, 16);

  const drawFlame = (fx: number, fy: number, w: number, h: number) => {
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx + w * 0.5, fy - h, fx + w, fy);
    ctx.fill();
  };

  ctx.fillStyle = "#FFB347";
  drawFlame(bx - 2, by, 36, 30);
  ctx.fillStyle = "#FF6B35";
  drawFlame(bx + 4, by, 24, 22);
  ctx.fillStyle = "#FFD700";
  drawFlame(bx + 10, by, 14, 16);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

interface SmokeWisp {
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  scale: number;
  baseScale: number;
}

const STORAGE_KEY = "globefly_campsite";

export class CampsiteMarker {
  readonly group = new Group();
  readonly worldPosition = new Vector3();
  readonly surfaceNormal = new Vector3();
  readonly surfaceQuat = new Quaternion();

  private smokeWisps: SmokeWisp[] = [];
  private smokeMat: ShaderMaterial;
  private smokeInstanced: InstancedMesh;
  private smokePlaneGeo: PlaneGeometry;
  private smokeLifeAttr: InstancedBufferAttribute;
  private beamMat: ShaderMaterial;
  private iconSprite: Sprite;
  private time = 0;
  private seedVal: number;

  private tmpMat = new Matrix4();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();
  private tmpPos = new Vector3();

  constructor(
    scene: Scene,
    globeRadius: number,
    worldSeed: number,
    terrainType: string,
  ) {
    this.seedVal = worldSeed + 8837291;

    const loc = this.loadOrAssignLocation(worldSeed, terrainType);
    this.surfaceNormal.set(loc.nx, loc.ny, loc.nz);
    this.surfaceQuat.copy(quaternionFromSurfaceNormal(loc.nx, loc.ny, loc.nz));

    const displacement = surfaceDisplacementAt(
      worldSeed, terrainType, loc.nx, loc.ny, loc.nz,
    );
    const surfaceR = globeRadius + displacement - PROP_TERRAIN_SINK;

    this.group.position.copy(
      this.surfaceNormal.clone().multiplyScalar(surfaceR),
    );
    this.group.quaternion.setFromUnitVectors(REF_UP, this.surfaceNormal);

    this.worldPosition.copy(this.group.position);

    /* ── Campfire logs ────────────────────────────────────── */
    const logGeo = new CylinderGeometry(0.006, 0.006, 0.05, 5);
    const logMat = new MeshPhongMaterial({ color: 0x5c3a1e });
    for (let i = 0; i < 4; i++) {
      const log = new Mesh(logGeo, logMat);
      const angle = (i / 4) * Math.PI * 2;
      log.position.set(
        Math.cos(angle) * 0.015,
        0.012,
        Math.sin(angle) * 0.015,
      );
      log.rotation.z = Math.PI / 2 + (i * 0.3);
      log.rotation.y = angle;
      this.group.add(log);
    }

    /* ── Glow sphere ─────────────────────────────────────── */
    const glowGeo = new SphereGeometry(0.015, 6, 4);
    const glowMat = new MeshPhongMaterial({
      color: 0xff6600,
      emissive: 0xff4400,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.7,
    });
    const glow = new Mesh(glowGeo, glowMat);
    glow.position.y = 0.02;
    this.group.add(glow);

    /* ── Smoke wisps ─────────────────────────────────────── */
    this.smokePlaneGeo = new PlaneGeometry(MARKER_SCALE, MARKER_SCALE);
    const lifeArr = new Float32Array(SMOKE_COUNT);
    this.smokeLifeAttr = new InstancedBufferAttribute(lifeArr, 1);
    this.smokePlaneGeo.setAttribute("aLife", this.smokeLifeAttr);

    this.smokeMat = new ShaderMaterial({
      vertexShader: smokeVert,
      fragmentShader: smokeFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.smokeInstanced = new InstancedMesh(
      this.smokePlaneGeo, this.smokeMat, SMOKE_COUNT,
    );
    this.smokeInstanced.frustumCulled = false;
    this.smokeInstanced.renderOrder = 11;
    this.group.add(this.smokeInstanced);

    const rand = seededRandom(this.seedVal);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      this.smokeWisps.push(this.spawnWisp(rand));
    }

    /* ── Beacon beam ──────────────────────────────────────── */
    const BEAM_HEIGHT = 3.0;
    const BEAM_WIDTH = 0.12;
    const beamGeo = new PlaneGeometry(BEAM_WIDTH, BEAM_HEIGHT);
    beamGeo.translate(0, BEAM_HEIGHT / 2, 0);
    this.beamMat = new ShaderMaterial({
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const beam1 = new Mesh(beamGeo, this.beamMat);
    beam1.position.y = 0.02;
    this.group.add(beam1);

    const beam2 = new Mesh(beamGeo, this.beamMat);
    beam2.position.y = 0.02;
    beam2.rotation.y = Math.PI / 2;
    this.group.add(beam2);

    /* ── Campfire icon sprite at beam top ─────────────────── */
    const iconTex = createCampfireIconTexture();
    const iconMat = new SpriteMaterial({
      map: iconTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });
    this.iconSprite = new Sprite(iconMat);
    this.iconSprite.scale.set(0.35, 0.35, 1);
    this.iconSprite.position.y = BEAM_HEIGHT + 0.15;
    this.group.add(this.iconSprite);

    scene.add(this.group);
  }

  /* ── Location persistence ──────────────────────────────────── */

  private loadOrAssignLocation(
    worldSeed: number,
    terrainType: string,
  ): { nx: number; ny: number; nz: number } {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.nx != null && data.ny != null && data.nz != null) {
          return data;
        }
      } catch { /* regenerate */ }
    }

    const loc = this.findLandLocation(worldSeed, terrainType);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    return loc;
  }

  private findLandLocation(
    worldSeed: number,
    terrainType: string,
  ): { nx: number; ny: number; nz: number } {
    const noise = createNoise3D(worldSeed);
    const params = getTerrainParams(terrainType);
    const rand = seededRandom(worldSeed + 5551234);

    let bestNormal = { nx: 0, ny: 1, nz: 0 };
    let bestScore = -1;

    for (let attempts = 0; attempts < 3000; attempts++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;
      const elevation = (value - params.threshold) / (1 - params.threshold);
      if (elevation < 0.15 || elevation > 0.5) continue;

      const score = 1.0 - Math.abs(elevation - 0.3);
      if (score > bestScore) {
        bestScore = score;
        bestNormal = { nx, ny, nz };
      }
      if (bestScore > 0.8) break;
    }

    return bestNormal;
  }

  /* ── Smoke particle lifecycle ──────────────────────────────── */

  private spawnWisp(rand: () => number): SmokeWisp {
    const baseScale = 0.8 + rand() * 0.6;
    return {
      pos: new Vector3(
        (rand() - 0.5) * 0.02,
        0.03 + rand() * 0.01,
        (rand() - 0.5) * 0.02,
      ),
      vel: new Vector3(
        (rand() - 0.5) * 0.003,
        0.012 + rand() * 0.01,
        (rand() - 0.5) * 0.003,
      ),
      life: rand() * 2.0,
      maxLife: 2.0 + rand() * 2.0,
      scale: baseScale,
      baseScale,
    };
  }

  private recycleWisp(w: SmokeWisp) {
    const rand = seededRandom(this.seedVal + Math.floor(this.time * 1000));
    const r = rand;
    w.baseScale = 0.8 + r() * 0.6;
    w.pos.set(
      (r() - 0.5) * 0.02,
      0.03 + r() * 0.01,
      (r() - 0.5) * 0.02,
    );
    w.vel.set(
      (r() - 0.5) * 0.003,
      0.012 + r() * 0.01,
      (r() - 0.5) * 0.003,
    );
    w.life = 0;
    w.maxLife = 2.0 + r() * 2.0;
    w.scale = w.baseScale;
  }

  /* ── Update ────────────────────────────────────────────────── */

  update(dt: number) {
    this.time += dt;

    this.beamMat.uniforms.uTime.value = this.time;
    const bob = Math.sin(this.time * 1.5) * 0.06;
    this.iconSprite.position.y = 3.0 + 0.15 + bob;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const w = this.smokeWisps[i]!;
      w.life += dt;
      if (w.life >= w.maxLife) this.recycleWisp(w);

      w.pos.addScaledVector(w.vel, dt);
      const lifeRatio = w.life / w.maxLife;
      w.scale = w.baseScale * (1 + lifeRatio * 1.2);

      this.smokeLifeAttr.setX(i, lifeRatio);
      this.tmpScale.setScalar(w.scale);
      this.tmpQuat.identity();
      this.tmpMat.compose(w.pos, this.tmpQuat, this.tmpScale);
      this.smokeInstanced.setMatrixAt(i, this.tmpMat);
    }
    this.smokeInstanced.instanceMatrix.needsUpdate = true;
    this.smokeLifeAttr.needsUpdate = true;
  }

  isPlayerNear(
    playerQ: Quaternion,
    playerAlt: number,
    globeRadius: number,
  ): boolean {
    const playerPos = this.tmpPos.copy(
      cartesianFromSpherical(playerQ, playerAlt, globeRadius),
    );
    return playerPos.distanceTo(this.worldPosition) < LANDING_DIST;
  }

  dispose() {
    this.smokePlaneGeo.dispose();
    this.smokeMat.dispose();
    this.smokeInstanced.dispose();
    this.beamMat.dispose();
    const iconMat = this.iconSprite.material as SpriteMaterial;
    iconMat.map?.dispose();
    iconMat.dispose();
    this.group.removeFromParent();
  }
}
