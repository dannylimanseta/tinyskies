import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { CapybaraFlameShots } from "./CapybaraFlameShots";
import type { PaintballSystem } from "./PaintballSystem";
import type { VoidFlameShield } from "./VoidFlameShield";

/** Cosmic-void moths: stay on the same flat tangent plane as the carpet (not a sphere around world origin). */
export type VoidMothPlaneContext = {
  planeUp: Vector3;
  planeN: Vector3;
  planeE: Vector3;
  flamePos: Vector3;
};

const WING_SPEED = 18;
const FLIGHT_SPEED = 0.18;
const TURN_SPEED = 0.9;
/** Slightly above the carpet’s spherical shell so moths read a bit “higher” in the void. */
const MOTH_RADIAL_LIFT = 0.05;
/** Moth spawns: ring distance from the flame in the void plane (world units). */
const VOID_SPAWN_RING_MIN = 2.6;
const VOID_SPAWN_RING_SPAN = 2.2;
/** After taking damage, flight speed is multiplied by this for {@link MOTH_POST_HIT_SLOW_SEC} seconds. */
const MOTH_POST_HIT_SLOW_MULT = 0.26;
const MOTH_POST_HIT_SLOW_SEC = 1.0;
const JITTER_AMP = 0.62;
const MOTH_MAX_HP = 3;
const MOTH_VISUAL_SCALE = 1.3;
const MOTH_HIT_RADIUS = 0.028 * MOTH_VISUAL_SCALE;

/** Mothwing Eldest — large, slow, harder to kill. */
const ELDER_VISUAL_SCALE = 2.8;
const ELDER_MAX_HP = 9;
const ELDER_FLIGHT_SPEED = 0.075;
const ELDER_JITTER_AMP = 0.25;
const ELDER_HIT_RADIUS = 0.028 * ELDER_VISUAL_SCALE;
const HP_BAR_W = 0.08;
const HP_BAR_H = 0.01;
const HP_BAR_D = 0.01;
const HP_BAR_SEG = 8;
const HP_BAR_CR = 0.0042;
const HP_BAR_INSET = 0.0014;
const HP_TWEEN = 12;
const HP_LIFT = 0.05;

// three.js non-camera `lookAt` orients +localZ toward the target. Head and leading wing edge use +Z.
// Wings: flat in XZ, span along ±X, chord toward +Z (forward / leading edge).
function buildMothWingGeo(mirrorX: boolean): BufferGeometry {
  const s = mirrorX ? -1 : 1;
  // Forewing: low-poly kite in XZ, y=0, root at origin; leading at +Z
  const fxVerts = new Float32Array([
    0, 0, 0, // root on thorax
    s * -0.038, 0, 0.01, // leading outer
    s * -0.048, 0, -0.012, // trailing tip
    s * -0.018, 0, -0.014, // inner trailing
  ]);
  const fxIdx = [0, 1, 2, 0, 2, 3];
  // Hindwing: more toward -Z (rear)
  const hxVerts = new Float32Array([
    0, 0, -0.004,
    s * -0.028, 0, -0.008,
    s * -0.032, 0, -0.028,
    s * -0.012, 0, -0.022,
  ]);
  const hxIdx = [0, 1, 2, 0, 2, 3];

  const g = new BufferGeometry();
  const n = fxVerts.length + hxVerts.length;
  const all = new Float32Array(n);
  all.set(fxVerts);
  all.set(hxVerts, fxVerts.length);
  const o = hxIdx.length;
  const idx = new Uint16Array(fxIdx.length + o);
  idx.set(fxIdx);
  for (let i = 0; i < o; i++) {
    idx[fxIdx.length + i] = hxIdx[i]! + fxVerts.length / 3;
  }
  g.setAttribute("position", new BufferAttribute(all, 3));
  g.setIndex([...idx]);
  g.computeVertexNormals();
  return g;
}

const shared = {
  foreHindLeftGeo: null as BufferGeometry | null,
  foreHindRightGeo: null as BufferGeometry | null,
  hpTrackGeo: null as RoundedBoxGeometry | null,
  hpFillGeo: null as RoundedBoxGeometry | null,
  trackMat: null as MeshBasicMaterial | null,
  fillMat: null as MeshBasicMaterial | null,
  antMat: null as MeshBasicMaterial | null,
};

function ensureSharedWingGeos() {
  if (shared.foreHindLeftGeo) return;
  shared.foreHindLeftGeo = buildMothWingGeo(false);
  shared.foreHindRightGeo = buildMothWingGeo(true);
}

function ensureSharedHpMats() {
  if (shared.hpTrackGeo) return;
  shared.antMat = new MeshBasicMaterial({ color: 0xaaccff });
  shared.hpTrackGeo = new RoundedBoxGeometry(HP_BAR_W, HP_BAR_H, HP_BAR_D, HP_BAR_SEG, HP_BAR_CR);
  {
    const fillH = HP_BAR_H * 0.62;
    const fillD = HP_BAR_D * 0.45;
    const fillR = Math.min(HP_BAR_CR * 0.5, fillH * 0.45, fillD * 0.45);
    shared.hpFillGeo = new RoundedBoxGeometry(1, fillH, fillD, HP_BAR_SEG, fillR);
  }
  shared.trackMat = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  shared.fillMat = new MeshBasicMaterial({
    color: 0xffe8aa,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
}

/** World path length: ribbon always spans this, regardless of how fast the moth flaps. */
const MOTH_RIBBON_MAX_ARC = 0.48;
const MOTH_RIBBON_LEN = 22;
const MOTH_RIBBON_HALF_W = 0.013;

const mothRibbonVert = `
attribute float alpha;
attribute float aU;
attribute float aAlong;
varying float vAlpha;
varying float vU;
varying float vAlong;
void main() {
  vAlpha = alpha;
  vU = aU;
  vAlong = aAlong;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const mothRibbonFrag = `
varying float vAlpha;
varying float vU;
varying float vAlong;
void main() {
  float t = abs(vU);
  float core = exp(-t * t * 1.12);
  float halo = exp(-t * t * 0.3) * 0.44;
  float a = vAlpha * 0.8 * (core * 0.9 + halo);
  if (a < 0.01) discard;
  vec3 c0 = vec3(0.95, 0.12, 0.08);
  vec3 c1 = vec3(1.0, 0.45, 0.12);
  vec3 grad = mix(c0, c1, vAlong);
  float edge = 0.8 + 0.2 * core;
  gl_FragColor = vec4(grad * edge, a);
}
`;

/** Purple-to-teal gradient trail used by the Mothwing Eldest. */
const elderRibbonFrag = `
varying float vAlpha;
varying float vU;
varying float vAlong;
void main() {
  float t = abs(vU);
  float core = exp(-t * t * 1.12);
  float halo = exp(-t * t * 0.3) * 0.44;
  float a = vAlpha * 0.9 * (core * 0.9 + halo);
  if (a < 0.01) discard;
  vec3 c0 = vec3(0.55, 0.05, 0.9);
  vec3 c1 = vec3(0.1, 0.75, 0.9);
  vec3 grad = mix(c0, c1, vAlong);
  float edge = 0.8 + 0.2 * core;
  gl_FragColor = vec4(grad * edge, a);
}
`;

const _mrbA = new Vector3();
const _mrbCum: number[] = [];
const _mrbResampled: Vector3[] = [];
const _mribDir = new Vector3();
const _mribRad = new Vector3();
const _mribBit = new Vector3();
const _mribFallback = new Vector3(0, 0, 1);

function trimPathToMaxArc(path: Vector3[], maxArc: number) {
  if (path.length < 2) return;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const d = a.distanceTo(b);
    if (acc + d >= maxArc) {
      const t = Math.max(0, (maxArc - acc) / Math.max(d, 1e-8));
      const end = new Vector3().lerpVectors(a, b, t);
      path.splice(i + 1, path.length - i - 1, end);
      return;
    }
    acc += d;
  }
}

/**
 * Evenly sample `n` points along the polyline from index 0 (newest) toward older vertices.
 * Result length === n, written into `out` (reused, cleared and pushed).
 */
function resamplePathEqualArc(
  path: Vector3[],
  n: number,
  out: Vector3[],
  cumScratch: number[],
) {
  out.length = 0;
  if (path.length === 0) return;
  if (path.length === 1) {
    for (let i = 0; i < n; i++) {
      out.push(path[0]!.clone());
    }
    return;
  }
  cumScratch.length = 0;
  cumScratch.push(0);
  for (let i = 0; i < path.length - 1; i++) {
    const d = path[i]!.distanceTo(path[i + 1]!);
    cumScratch.push(cumScratch[i]! + d);
  }
  const total = cumScratch[cumScratch.length - 1]! || 1e-6;
  for (let k = 0; k < n; k++) {
    const s = (k / Math.max(1, n - 1)) * total;
    let j = 0;
    while (j < cumScratch.length - 1 && s > cumScratch[j + 1]!) {
      j++;
    }
    const t0 = cumScratch[j]!;
    const t1 = cumScratch[Math.min(j + 1, cumScratch.length - 1)]!;
    const seg = Math.max(1e-8, t1 - t0);
    const u = (s - t0) / seg;
    _mrbA.lerpVectors(
      path[j]!,
      path[Math.min(j + 1, path.length - 1)]!,
      Math.min(1, Math.max(0, u)),
    );
    out.push(_mrbA.clone());
  }
}

/**
 * World-space red→orange ribbon: fixed world arc length, resampled to fixed segment count
 * (length does not change with airspeed).
 */
class MothVoidGradientRibbon {
  private path: Vector3[] = [];
  private lastBit = new Vector3(0, 1, 0);
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private aUAttr: BufferAttribute;
  private aAlongAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  constructor(isElder = false) {
    const vCount = MOTH_RIBBON_LEN * 2;
    const posArray = new Float32Array(vCount * 3);
    const alphaArray = new Float32Array(vCount);
    const aU = new Float32Array(vCount);
    const aAlong = new Float32Array(vCount);
    const n1 = MOTH_RIBBON_LEN - 1;
    for (let i = 0; i < MOTH_RIBBON_LEN; i++) {
      const al = n1 > 0 ? i / n1 : 0;
      aU[i * 2] = -1;
      aU[i * 2 + 1] = 1;
      aAlong[i * 2] = al;
      aAlong[i * 2 + 1] = al;
    }
    this.posAttr = new BufferAttribute(posArray, 3);
    this.alphaAttr = new BufferAttribute(alphaArray, 1);
    this.aUAttr = new BufferAttribute(aU, 1);
    this.aAlongAttr = new BufferAttribute(aAlong, 1);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("alpha", this.alphaAttr);
    this.geometry.setAttribute("aU", this.aUAttr);
    this.geometry.setAttribute("aAlong", this.aAlongAttr);
    const indices: number[] = [];
    for (let i = 0; i < MOTH_RIBBON_LEN - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geometry.setIndex(indices);
    this.material = new ShaderMaterial({
      vertexShader: mothRibbonVert,
      fragmentShader: isElder ? elderRibbonFrag : mothRibbonFrag,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
  }

  update(worldPos: Vector3) {
    this.path.unshift(worldPos.clone());
    trimPathToMaxArc(this.path, MOTH_RIBBON_MAX_ARC);
    if (this.path.length > 200) {
      this.path.length = 200;
    }
    resamplePathEqualArc(this.path, MOTH_RIBBON_LEN, _mrbResampled, _mrbCum);
    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const count = _mrbResampled.length;
    const halfW = MOTH_RIBBON_HALF_W;
    const aAlongBuf = this.aAlongAttr.array as Float32Array;
    const nSeg = MOTH_RIBBON_LEN - 1;
    for (let i = 0; i < MOTH_RIBBON_LEN; i++) {
      const along = nSeg > 0 ? i / nSeg : 0;
      aAlongBuf[i * 2] = along;
      aAlongBuf[i * 2 + 1] = along;
      const p = _mrbResampled[i];
      if (!p) {
        positions[i * 6] = 0;
        positions[i * 6 + 1] = 0;
        positions[i * 6 + 2] = 0;
        positions[i * 6 + 3] = 0;
        positions[i * 6 + 4] = 0;
        positions[i * 6 + 5] = 0;
        alphas[i * 2] = 0;
        alphas[i * 2 + 1] = 0;
        continue;
      }
      _mribRad.copy(p).normalize();
      const prevIdx = Math.max(i - 1, 0);
      const nextIdx = Math.min(i + 1, count - 1);
      _mribDir.subVectors(_mrbResampled[prevIdx]!, _mrbResampled[nextIdx]!);
      if (count < 2 || _mribDir.lengthSq() < 1e-10) {
        _mribBit.set(0, 1, 0).cross(_mribRad);
        if (_mribBit.lengthSq() < 1e-8) {
          _mribBit.set(1, 0, 0).cross(_mribRad);
        }
        _mribBit.normalize();
        this.lastBit.copy(_mribBit);
      } else {
        _mribDir.normalize();
        _mribBit.crossVectors(_mribRad, _mribDir);
        if (_mribBit.lengthSq() < 1e-8) {
          _mribBit.crossVectors(_mribRad, _mribFallback);
        }
        _mribBit.normalize();
        this.lastBit.copy(_mribBit);
      }
      const fadeIn = Math.min(1, i / 4);
      const fadeOut = 1 - i / MOTH_RIBBON_LEN;
      const w = halfW * fadeOut * (0.86 + 0.14 * fadeIn);
      positions[i * 6] = p.x + _mribBit.x * w;
      positions[i * 6 + 1] = p.y + _mribBit.y * w;
      positions[i * 6 + 2] = p.z + _mribBit.z * w;
      positions[i * 6 + 3] = p.x - _mribBit.x * w;
      positions[i * 6 + 4] = p.y - _mribBit.y * w;
      positions[i * 6 + 5] = p.z - _mribBit.z * w;
      const a = fadeIn * fadeOut * fadeOut * 0.72;
      alphas[i * 2] = a;
      alphas[i * 2 + 1] = a;
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.aAlongAttr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

class VoidMoth {
  readonly group = new Group();
  /** World-space trail; parented to VoidMothsManager, not this.group. */
  readonly mothTrail: MothVoidGradientRibbon;
  readonly isElder: boolean;
  private readonly wobbleRig = new Group();
  private readonly leftWing: Group;
  private readonly rightWing: Group;
  private readonly timeOffset = Math.random() * Math.PI * 2;
  private readonly jitterPhase = Math.random() * 50;
  private velocity = new Vector3();
  private scratch = new Vector3();
  private toTargetW = new Vector3();
  private vNav = new Vector3();
  private hitWobbleAmp = 0;
  private hitWobblePhase = 0;
  /** >0: reduced pursuing speed after being hit (see {@link MOTH_POST_HIT_SLOW_SEC}). */
  private postHitSlowTimer = 0;

  health: number;
  maxHealth: number;
  hpDisplay = 1;
  isDead = false;
  private hpBarRoot: Group;
  private hpFillMesh: Mesh;
  private hpBarInnerW: number;
  private hpPosScratch = new Vector3();
  private hpUpScratch = new Vector3();
  private hpCamQ = new Quaternion();
  private trailWorldPos = new Vector3();

  constructor(elder = false) {
    this.isElder = elder;
    this.mothTrail = new MothVoidGradientRibbon(elder);
    const hp = elder ? ELDER_MAX_HP : MOTH_MAX_HP;
    this.health = hp;
    this.maxHealth = hp;

    ensureSharedWingGeos();
    ensureSharedHpMats();

    const bodyMat = new MeshPhongMaterial({
      color: elder ? 0x1a0033 : 0x112244,
      emissive: elder ? 0x0d0020 : 0x051122,
      flatShading: true,
    });

    // Nose at +Z (Object3D.lookAt: +Z points at flight target for non-camera)
    const headGeo = new SphereGeometry(0.0065, 6, 6);
    const head = new Mesh(headGeo, bodyMat);
    head.position.set(0, 0, 0.019);
    this.wobbleRig.add(head);

    const thoraxGeo = new SphereGeometry(0.009, 7, 7);
    const thorax = new Mesh(thoraxGeo, bodyMat);
    thorax.scale.set(1, 0.8, 1.35);
    thorax.position.set(0, 0, 0.006);
    this.wobbleRig.add(thorax);

    const abdomenGeo = new ConeGeometry(0.008, 0.034, 6);
    abdomenGeo.rotateX(Math.PI / 2);
    const abdomen = new Mesh(abdomenGeo, bodyMat);
    abdomen.position.set(0, 0, -0.02);
    abdomen.scale.setScalar(elder ? ELDER_VISUAL_SCALE : MOTH_VISUAL_SCALE);
    this.group.add(abdomen);

    const eyeGeo = new SphereGeometry(0.0024, 5, 5);
    const eyeMat = new MeshPhongMaterial({
      color: elder ? 0xcc44ff : 0xff1a1a,
      emissive: new Color(elder ? 0xaa22ee : 0xff0000),
      emissiveIntensity: 1.4,
      flatShading: true,
    });
    const leftEye = new Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.0045, 0.0018, 0.022);
    const rightEye = new Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.0045, 0.0018, 0.022);
    this.wobbleRig.add(leftEye, rightEye);

    const wingMat = new MeshPhongMaterial({
      color: elder ? 0x220044 : 0x3355aa,
      emissive: elder ? 0x150030 : 0x1a2a55,
      side: DoubleSide,
      transparent: true,
      opacity: elder ? 0.78 : 0.86,
      flatShading: true,
    });

    this.leftWing = new Group();
    this.leftWing.position.set(0, 0, 0.01);
    const lMesh = new Mesh(shared.foreHindLeftGeo!, wingMat);
    this.leftWing.add(lMesh);

    this.rightWing = new Group();
    this.rightWing.position.set(0, 0, 0.01);
    const rMesh = new Mesh(shared.foreHindRightGeo!, wingMat);
    this.rightWing.add(rMesh);
    this.wobbleRig.add(this.leftWing, this.rightWing);

    const addAnt = (x: number, rz: number) => {
      const g = new ConeGeometry(0.0009, 0.022, 4);
      g.translate(0, 0.011, 0);
      const m = new Mesh(g, shared.antMat!);
      m.position.set(x, 0.004, 0.02);
      m.rotation.x = Math.PI / 2.4;
      m.rotation.z = rz;
      this.wobbleRig.add(m);
    };
    addAnt(-0.003, -0.5);
    addAnt(0.003, 0.5);
    this.wobbleRig.scale.setScalar(elder ? ELDER_VISUAL_SCALE : MOTH_VISUAL_SCALE);
    this.group.add(this.wobbleRig);

    const innerW = HP_BAR_W - 2 * HP_BAR_INSET;
    this.hpBarInnerW = innerW;
    this.hpBarRoot = new Group();
    const track = new Mesh(shared.hpTrackGeo!, shared.trackMat!);
    track.position.z = 0.0001;
    track.renderOrder = 400;
    this.hpFillMesh = new Mesh(shared.hpFillGeo!, shared.fillMat!);
    this.hpFillMesh.position.z = 0.0002;
    this.hpFillMesh.renderOrder = 401;
    this.hpBarRoot.add(track, this.hpFillMesh);
    this.hpBarRoot.visible = false;
  }

  getHpBarRoot() {
    return this.hpBarRoot;
  }

  applyDamage() {
    if (this.isDead) return;
    this.health = Math.max(0, this.health - 2);
    if (this.health <= 0) {
      this.isDead = true;
      return;
    }
    this.postHitSlowTimer = MOTH_POST_HIT_SLOW_SEC;
  }

  get hitRadius(): number {
    return this.isElder ? ELDER_HIT_RADIUS : MOTH_HIT_RADIUS;
  }

  takeHitWobble() {
    this.hitWobbleAmp = 0.55;
    this.hitWobblePhase = 0;
  }

  update(
    dt: number,
    time: number,
    target: Vector3,
    playerShellRadius: number,
    camera: Camera,
    voidPlane: VoidMothPlaneContext | null = null,
  ) {
    if (this.isDead) return;

    // Flap: +Z forward along body; X rotation = up/down
    const flap = Math.sin(time * WING_SPEED + this.timeOffset);
    const amp = 0.55;
    this.leftWing.rotation.x = -flap * amp - 0.12;
    this.rightWing.rotation.x = flap * amp + 0.12;

    const jt = this.jitterPhase;
    this.scratch.set(
      (Math.sin(time * 11.3 + jt) + Math.sin(time * 7.1 + jt * 0.3)) * 0.5,
      (Math.sin(time * 9.2 + jt) + Math.cos(time * 6.4 + jt)) * 0.4,
      (Math.cos(time * 10.5 + jt) + Math.sin(time * 8.0 + jt * 0.7)) * 0.5,
    );
    const inPostHitSlow = this.postHitSlowTimer > 0;
    if (inPostHitSlow) {
      this.postHitSlowTimer = Math.max(0, this.postHitSlowTimer - dt);
    }
    const slowK = inPostHitSlow ? MOTH_POST_HIT_SLOW_MULT : 1;
    this.scratch.multiplyScalar(
      (this.isElder ? ELDER_JITTER_AMP : JITTER_AMP) * dt * (0.35 + 0.65 * slowK),
    );
    this.velocity.add(this.scratch);

    this.toTargetW.subVectors(target, this.group.position);
    const distSq = this.toTargetW.lengthSq();

    if (distSq > 0.0004) {
      this.toTargetW.normalize();
      const base = this.isElder ? ELDER_FLIGHT_SPEED : FLIGHT_SPEED;
      this.vNav.copy(this.toTargetW).multiplyScalar(base * slowK);
      this.velocity.lerp(this.vNav, TURN_SPEED * dt);
      this.group.position.addScaledVector(this.velocity, dt);

      if (this.velocity.lengthSq() > 0.0001) {
        if (voidPlane) {
          this.group.up.copy(voidPlane.planeUp);
        } else {
          this.scratch.copy(this.group.position);
          if (this.scratch.lengthSq() > 1e-8) {
            this.group.up.copy(this.scratch).normalize();
          } else {
            this.group.up.set(0, 1, 0);
          }
        }
        this.scratch.copy(this.group.position).add(this.velocity);
        this.group.lookAt(this.scratch);
      }
    } else {
      this.velocity.multiplyScalar(1 - dt * 1.2);
    }

    if (this.hitWobbleAmp > 0.002) {
      this.hitWobblePhase += dt * 25;
      this.wobbleRig.rotation.z =
        Math.sin(this.hitWobblePhase) * this.hitWobbleAmp;
      this.hitWobbleAmp *= Math.exp(-5 * dt);
    } else {
      this.wobbleRig.rotation.z = 0;
      this.hitWobbleAmp = 0;
    }

    if (voidPlane) {
      const u = voidPlane.planeUp;
      const T = voidPlane.flamePos;
      this.scratch.copy(this.group.position).sub(T);
      const h = this.scratch.dot(u);
      this.group.position.addScaledVector(u, -h);
    } else if (playerShellRadius > 0.1) {
      // Hold |pos| to a sphere (globe) — void flat mode uses the branch above.
      this.scratch.copy(this.group.position);
      const len = this.scratch.length();
      if (len > 1e-5) {
        this.scratch
          .normalize()
          .multiplyScalar(
            len + (playerShellRadius - len) * Math.min(1, 6.0 * dt),
          );
        this.group.position.copy(this.scratch);
        const n = this.scratch.copy(this.group.position).normalize();
        const vr = n.dot(this.velocity);
        this.velocity.addScaledVector(n, -vr);
      } else {
        this.group.position.set(0, 0, playerShellRadius);
      }
    }

    this.group.getWorldPosition(this.trailWorldPos);
    this.mothTrail.update(this.trailWorldPos);
  }

  updateHpBar(
    dt: number,
    camera: Camera,
    voidUp: Vector3 | null = null,
  ) {
    const maxH = this.maxHealth;
    const tgt = this.health <= 0 ? 0 : this.health / maxH;
    this.hpDisplay += (tgt - this.hpDisplay) * Math.min(1, HP_TWEEN * dt);
    const innerW = this.hpBarInnerW;
    const r = Math.max(0, Math.min(1, this.hpDisplay));
    const show =
      !this.isDead && this.health > 0 && (this.health < maxH || r < 0.998);
    this.hpBarRoot.visible = show;
    if (!show) return;

    const rw = Math.max(0.001, innerW * r);
    this.hpFillMesh.scale.set(rw, 1, 1);
    this.hpFillMesh.position.x = -innerW * 0.5 + rw * 0.5;

    this.scratch.copy(this.group.position);
    if (voidUp) {
      this.hpUpScratch.copy(voidUp);
    } else {
      this.hpUpScratch.copy(this.scratch).normalize();
    }
    this.hpPosScratch
      .copy(this.scratch)
      .addScaledVector(this.hpUpScratch, HP_LIFT);
    this.hpBarRoot.position.copy(this.hpPosScratch);
    camera.getWorldQuaternion(this.hpCamQ);
    this.hpBarRoot.quaternion.copy(this.hpCamQ);
  }

  dispose() {
    const sharedGeos: (BufferGeometry | RoundedBoxGeometry | null)[] = [
      shared.foreHindLeftGeo,
      shared.foreHindRightGeo,
      shared.hpTrackGeo,
      shared.hpFillGeo,
    ];
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        const g = mesh.geometry;
        if (g && !sharedGeos.includes(g)) g.dispose();
        const m = mesh.material;
        if (
          m &&
          m !== shared.trackMat &&
          m !== shared.fillMat &&
          m !== shared.antMat
        ) {
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      }
    });
    this.mothTrail.dispose();
  }
}

export class VoidMothsManager {
  readonly group = new Group();
  private moths: VoidMoth[] = [];
  private time = 0;
  private spawnTimer = 0;
  /** False until the eternal-flame intro dialogue finishes; blocks new spawns. */
  private mothSpawningEnabled = false;
  /** Max concurrent live moths for the current wave (-1 = legacy unlimited). */
  private waveMaxConcurrent = 15;
  /** Total moths to spawn this wave before spawning stops (-1 = unlimited). */
  private waveLimit = -1;
  /** How many moths have been spawned so far in the current wave. */
  private waveTotalSpawned = 0;
  /** Spawn interval range [min, max] seconds for this wave. */
  private spawnIntervalMin = 1.5;
  private spawnIntervalMax = 3.5;
  /** Probability [0,1] that any given spawn is a Mothwing Eldest. */
  private elderChance = 0;
  private readonly _shieldCenter = new Vector3();
  private readonly _mothImpactPos = new Vector3();
  private readonly _spawnRing = new Vector3();

  constructor(
    private readonly paintballSystem: PaintballSystem | null,
    private readonly onMothStruck: (isKill: boolean) => void,
    /** Called the first time a moth reaches the flame when the shield is gone. */
    private readonly onFlameHit?: () => void,
  ) {
    ensureSharedWingGeos();
    ensureSharedHpMats();
  }

  /**
   * For auto-aim: writes world position of the living moth closest to `from` (e.g. carpet center).
   */
  getNearestMothToPoint(from: Vector3, out: Vector3): boolean {
    let best = Infinity;
    let pick: VoidMoth | null = null;
    for (const m of this.moths) {
      if (m.isDead) continue;
      const d = m.group.position.distanceToSquared(from);
      if (d < best) {
        best = d;
        pick = m;
      }
    }
    if (!pick) return false;
    out.copy(pick.group.position);
    return true;
  }

  /** When enabled, the first spawn is scheduled after a normal inter-spawn delay. */
  setMothSpawningEnabled(v: boolean) {
    this.mothSpawningEnabled = v;
    if (v) {
      this.spawnTimer = 0.8 + Math.random() * 1.2;
    }
  }

  /**
   * Configure per-wave spawn parameters. Call before enabling spawning for a new wave.
   * @param totalForWave Total moths to spawn this wave (all stop spawning after), -1 = unlimited.
   * @param maxConcurrent Max live moths at once.
   * @param spawnMin Min seconds between spawns.
   * @param spawnMax Max seconds between spawns.
   */
  configureWave(
    totalForWave: number,
    maxConcurrent: number,
    spawnMin: number,
    spawnMax: number,
    elderChance = 0,
  ) {
    this.waveLimit = totalForWave;
    this.waveMaxConcurrent = maxConcurrent;
    this.waveTotalSpawned = 0;
    this.spawnIntervalMin = spawnMin;
    this.spawnIntervalMax = spawnMax;
    this.elderChance = Math.max(0, Math.min(1, elderChance));
  }

  /** Number of currently living (non-dead) moths. */
  getAliveCount(): number {
    let n = 0;
    for (const m of this.moths) if (!m.isDead) n++;
    return n;
  }

  /**
   * Fills `out` with world positions of up to `limit` living moths.
   * Useful for off-screen arrow indicators.
   */
  getLivingPositions(out: Vector3[], limit: number) {
    out.length = 0;
    for (const m of this.moths) {
      if (m.isDead) continue;
      out.push(m.group.position);
      if (out.length >= limit) break;
    }
  }

  /**
   * True when this wave has finished: all assigned moths have spawned and been killed.
   * Returns false if the wave has no limit (waveLimit === -1).
   */
  isWaveCleared(): boolean {
    if (this.waveLimit < 0) return false;
    return this.waveTotalSpawned >= this.waveLimit && this.getAliveCount() === 0;
  }

  private orbHitMoth(m: VoidMoth) {
    m.group.updateMatrixWorld(true);
    this.paintballSystem?.playMothSparkAtWorld(
      this._mothImpactPos.setFromMatrixPosition(m.group.matrixWorld),
    );
    m.applyDamage();
    if (!m.isDead) m.takeHitWobble();
    this.onMothStruck(m.isDead);
  }

  update(
    dt: number,
    targetPos: Vector3 | null,
    /** Same shell as the carpet: `cartesianFromSpherical(carpet.q, carpet.alt, globeRadius)` */
    carpetWorldPos: Vector3,
    camera: Camera,
    capybara: CapybaraFlameShots | null,
    voidShield: VoidFlameShield | null = null,
    voidPlane: VoidMothPlaneContext | null = null,
  ) {
    this.time += dt;
    if (this.mothSpawningEnabled) {
      this.spawnTimer -= dt;
    }

    const playerR = carpetWorldPos.length();
    const mothShellR = playerR + MOTH_RADIAL_LIFT;

    const canSpawnMore = this.waveLimit < 0 || this.waveTotalSpawned < this.waveLimit;
    if (
      this.mothSpawningEnabled &&
      this.spawnTimer <= 0 &&
      this.moths.length < this.waveMaxConcurrent &&
      canSpawnMore &&
      targetPos
    ) {
      this.spawnTimer = this.spawnIntervalMin + Math.random() * (this.spawnIntervalMax - this.spawnIntervalMin);
      this.waveTotalSpawned++;
      const isElder = this.elderChance > 0 && Math.random() < this.elderChance;
      const moth = new VoidMoth(isElder);
      this.group.add(moth.getHpBarRoot());
      const angle = Math.random() * Math.PI * 2;
      const ring = VOID_SPAWN_RING_MIN + Math.random() * VOID_SPAWN_RING_SPAN;
      if (voidPlane) {
        const { planeN, planeE, planeUp, flamePos } = voidPlane;
        this._spawnRing
          .set(0, 0, 0)
          .addScaledVector(planeN, Math.cos(angle) * ring)
          .addScaledVector(planeE, Math.sin(angle) * ring)
          .addScaledVector(planeUp, (Math.random() - 0.5) * 0.4);
        moth.group.position.copy(flamePos).add(this._spawnRing);
      } else {
        const offset = new Vector3(
          Math.cos(angle) * ring,
          (Math.random() - 0.5) * 1.6,
          Math.sin(angle) * ring,
        );
        moth.group.position.copy(targetPos).add(offset);
        if (mothShellR > 0.1) {
          moth.group.position.normalize().multiplyScalar(mothShellR);
        }
      }
      this.moths.push(moth);
      this.group.add(moth.group);
      this.group.add(moth.mothTrail.mesh);
    }

    for (const moth of this.moths) {
      if (!moth.isDead && targetPos) {
        moth.update(
          dt,
          this.time,
          voidPlane?.flamePos ?? targetPos,
          voidPlane ? 0 : mothShellR,
          camera,
          voidPlane,
        );
      }
    }

    if (voidShield && voidShield.canBlock() && targetPos) {
      voidShield.getWorldPosition(this._shieldCenter);
      const r = voidShield.getCollisionRadius();
      for (const moth of this.moths) {
        if (moth.isDead) continue;
        if (moth.group.position.distanceTo(this._shieldCenter) < r) {
          voidShield.registerMothImpact();
          moth.isDead = true;
          moth.group.updateMatrixWorld(true);
          this.paintballSystem?.playMothSparkAtWorld(
            this._mothImpactPos.setFromMatrixPosition(moth.group.matrixWorld),
          );
          this.onMothStruck(true);
        }
      }
    } else if (targetPos) {
      // Shield gone — first moth to reach the flame triggers the shatter callback.
      const FLAME_HIT_RADIUS = 0.2;
      for (const moth of this.moths) {
        if (moth.isDead) continue;
        if (moth.group.position.distanceTo(targetPos) < FLAME_HIT_RADIUS) {
          moth.isDead = true;
          moth.group.updateMatrixWorld(true);
          this.paintballSystem?.playMothSparkAtWorld(
            this._mothImpactPos.setFromMatrixPosition(moth.group.matrixWorld),
          );
          this.onFlameHit?.();
          break;
        }
      }
    }

    for (const moth of this.moths) {
      if (!moth.isDead && targetPos) {
        moth.updateHpBar(
          dt,
          camera,
          voidPlane ? voidPlane.planeUp : null,
        );
      }
    }

    if (capybara && this.moths.length > 0) {
      const targets: { position: Vector3; hitRadius: number; onHit: () => void }[] = [];
      for (const m of this.moths) {
        if (m.isDead) continue;
        targets.push({
          position: m.group.position,
          hitRadius: m.hitRadius,
          onHit: () => this.orbHitMoth(m),
        });
      }
      capybara.testSphereHits(targets);
    }

    for (let i = this.moths.length - 1; i >= 0; i--) {
      const moth = this.moths[i]!;
      if (moth.isDead) {
        this.group.remove(moth.group);
        this.group.remove(moth.getHpBarRoot());
        this.group.remove(moth.mothTrail.mesh);
        moth.dispose();
        this.moths.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const moth of this.moths) {
      this.group.remove(moth.getHpBarRoot());
      this.group.remove(moth.mothTrail.mesh);
      moth.dispose();
    }
    this.moths = [];
    this.group.clear();
  }
}
