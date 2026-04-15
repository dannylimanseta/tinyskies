import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { sampleTerrain } from "./SimplexNoise";
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
/** Vertical beacon beam on the globe (halved from original 3.0). */
const BEAM_HEIGHT = 1.5;
const BEAM_WIDTH = 0.12;

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
  /* Young = ember/orange; old = cool ash — reads as fire + smoke, not white haze. */
  vec3 ember = vec3(1.0, 0.38, 0.06);
  vec3 ash = vec3(0.28, 0.24, 0.22);
  vec3 col = mix(ember, ash, smoothstep(0.12, 0.72, vLife));
  float fadeIn = smoothstep(0.0, 0.15, vLife);
  float fadeOut = 1.0 - smoothstep(0.5, 1.0, vLife);
  float lifeFade = fadeIn * fadeOut;
  float alpha = (1.0 - smoothstep(0.3, 1.0, d)) * lifeFade * 0.32;
  gl_FragColor = vec4(col, alpha);
}
`;

/* ── Beacon beam (warm orange beacon, not white searchlight) ───────── */

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
  xFade = pow(xFade, 2.8);
  float yFade = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
  float pulse = 0.78 + 0.22 * sin(uTime * 2.0);
  vec3 base = vec3(1.0, 0.42, 0.08);
  vec3 tip = vec3(1.0, 0.62, 0.18);
  vec3 col = mix(base, tip, vUv.y);
  float alpha = xFade * yFade * pulse * 0.2;
  gl_FragColor = vec4(col, alpha);
}
`;

/* ── Ground ember bed + small flame cards ─────────────────────────── */

const emberFrag = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float flicker = 0.88 + 0.12 * sin(uTime * 7.0 + d * 4.0);
  float core = (1.0 - smoothstep(0.15, 1.0, d)) * flicker;
  vec3 inner = vec3(1.0, 0.45, 0.1);
  vec3 outer = vec3(1.0, 0.22, 0.02);
  vec3 col = mix(inner, outer, smoothstep(0.0, 0.85, d));
  gl_FragColor = vec4(col, core * 0.75);
}
`;

const emberVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const flameFrag = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
void main() {
  float taper = 1.0 - abs(vUv.x - 0.5) * 2.0;
  taper = pow(max(taper, 0.0), 1.4);
  float h = vUv.y;
  float waver = sin(uTime * 9.0 + vUv.x * 10.0 + h * 8.0) * 0.05;
  float body = smoothstep(0.0, 0.18, h + waver) * (1.0 - smoothstep(0.68, 1.0, h));
  vec3 deep = vec3(1.0, 0.18, 0.02);
  vec3 mid = vec3(1.0, 0.42, 0.08);
  vec3 tip = vec3(1.0, 0.68, 0.2);
  vec3 col = mix(deep, mid, smoothstep(0.0, 0.45, h));
  col = mix(col, tip, smoothstep(0.3, 0.92, h));
  float a = taper * body * 0.52;
  gl_FragColor = vec4(col, a);
}
`;

const flameVert = beamVert;

/**
 * HUD-matching tent icon in a rounded square (same paths as `.hud-campsite-btn` SVG).
 * Used on a billboard sprite so it stays screen-upright for the player.
 */
function createCampsiteTentIconTexture(): CanvasTexture {
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  const cx = S / 2;
  const cy = S / 2;
  const box = S * 0.72;
  const x0 = cx - box / 2;
  const y0 = cy - box / 2;
  const r = S * 0.09;

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x0, y0, box, box, r);
  ctx.fill();
  ctx.stroke();

  /* Same tent strokes as HUD: viewBox 0 0 24 24 */
  ctx.save();
  ctx.translate(cx, cy);
  const scale = box / 24 * 0.78;
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 2.2 / scale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(12, 2);
  ctx.lineTo(3, 20);
  ctx.lineTo(21, 20);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9, 20);
  ctx.lineTo(9, 14);
  ctx.lineTo(12, 12);
  ctx.lineTo(15, 14);
  ctx.lineTo(15, 20);
  ctx.stroke();
  ctx.restore();

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

interface StoredCampsiteLocation {
  seed: number;
  terrainType: string;
  nx: number;
  ny: number;
  nz: number;
}

const STORAGE_KEY = "globefly_campsite_v2";

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
  private emberGeo: CircleGeometry;
  private emberMat: ShaderMaterial;
  private flameGeo: PlaneGeometry;
  private flameMat: ShaderMaterial;
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

    /* ── Campfire logs (warm brown, subtle ember catch) ─────────── */
    const logGeo = new CylinderGeometry(0.006, 0.006, 0.05, 5);
    const logMat = new MeshPhongMaterial({
      color: 0x4a2e18,
      emissive: 0x331006,
      emissiveIntensity: 0.35,
    });
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

    /* ── Ember bed (horizontal disc, orange — not white) ─────────── */
    this.emberGeo = new CircleGeometry(0.028, 20);
    this.emberMat = new ShaderMaterial({
      vertexShader: emberVert,
      fragmentShader: emberFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const emberDisc = new Mesh(this.emberGeo, this.emberMat);
    emberDisc.rotation.x = -Math.PI / 2;
    emberDisc.position.y = 0.005;
    emberDisc.renderOrder = 10;
    this.group.add(emberDisc);

    /* ── Flame cards (crossed planes, orange gradient) ───────────── */
    this.flameGeo = new PlaneGeometry(0.032, 0.048);
    this.flameMat = new ShaderMaterial({
      vertexShader: flameVert,
      fragmentShader: flameFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const flame1 = new Mesh(this.flameGeo, this.flameMat);
    flame1.position.y = 0.036;
    flame1.renderOrder = 10;
    this.group.add(flame1);
    const flame2 = new Mesh(this.flameGeo, this.flameMat);
    flame2.position.y = 0.036;
    flame2.rotation.y = Math.PI / 2;
    flame2.renderOrder = 10;
    this.group.add(flame2);

    /* ── Smoke / ember wisps ─────────────────────────────────────── */
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
    const iconTex = createCampsiteTentIconTexture();
    const iconMat = new SpriteMaterial({
      map: iconTex,
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      opacity: 0.95,
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
        const data = JSON.parse(stored) as Partial<StoredCampsiteLocation>;
        if (
          data.seed === worldSeed &&
          data.terrainType === terrainType &&
          typeof data.nx === "number" &&
          typeof data.ny === "number" &&
          typeof data.nz === "number" &&
          this.isValidStoredLocation(worldSeed, terrainType, data.nx, data.ny, data.nz)
        ) {
          return { nx: data.nx, ny: data.ny, nz: data.nz };
        }
      } catch { /* regenerate */ }
    }

    const loc = this.findLandLocation(worldSeed, terrainType);
    const storedLoc: StoredCampsiteLocation = { seed: worldSeed, terrainType, ...loc };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedLoc));
    return loc;
  }

  private isValidStoredLocation(
    worldSeed: number,
    terrainType: string,
    nx: number,
    ny: number,
    nz: number,
  ): boolean {
    const sample = sampleTerrain(worldSeed, terrainType, nx, ny, nz);
    return sample.isLand && sample.elevation >= 0.15 && sample.elevation <= 0.5;
  }

  private findLandLocation(
    worldSeed: number,
    terrainType: string,
  ): { nx: number; ny: number; nz: number } {
    const rand = seededRandom(worldSeed + 5551234);

    let bestNormal = { nx: 0, ny: 1, nz: 0 };
    let bestScore = -1;

    for (let attempts = 0; attempts < 3000; attempts++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const sample = sampleTerrain(worldSeed, terrainType, nx, ny, nz);
      if (!sample.isLand) continue;
      const elevation = sample.elevation;
      if (elevation < 0.15 || elevation > 0.5) continue;

      const score = 1.0 - Math.abs(elevation - 0.3);
      if (score > bestScore) {
        bestScore = score;
        bestNormal = { nx, ny, nz };
      }
      if (bestScore > 0.8) break;
    }

    if (bestScore >= 0) return bestNormal;

    for (let k = 0; k < 128; k++) {
      const y = 1 - (k / 127) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = k * 0.6180339887 * Math.PI * 2;
      const nx = Math.cos(theta) * r;
      const ny = y;
      const nz = Math.sin(theta) * r;
      if (this.isValidStoredLocation(worldSeed, terrainType, nx, ny, nz)) {
        return { nx, ny, nz };
      }
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
    this.emberMat.uniforms.uTime.value = this.time;
    this.flameMat.uniforms.uTime.value = this.time;
    const bob = Math.sin(this.time * 1.5) * 0.06;
    this.iconSprite.position.y = BEAM_HEIGHT + 0.15 + bob;

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
    this.emberGeo.dispose();
    this.emberMat.dispose();
    this.flameGeo.dispose();
    this.flameMat.dispose();
    const iconMat = this.iconSprite.material as SpriteMaterial;
    iconMat.map?.dispose();
    iconMat.dispose();
    this.group.removeFromParent();
  }
}
