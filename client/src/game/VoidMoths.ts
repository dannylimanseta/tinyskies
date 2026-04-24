import { BufferAttribute, BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  Camera,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { CapybaraFlameShots } from "./CapybaraFlameShots";
import type { PaintballSystem } from "./PaintballSystem";
import type { VoidFlameShield } from "./VoidFlameShield";

const WING_SPEED = 28;
const FLIGHT_SPEED = 0.3;
const TURN_SPEED = 1.35;
/** Slightly above the carpet’s spherical shell so moths read a bit “higher” in the void. */
const MOTH_RADIAL_LIFT = 0.05;
const JITTER_AMP = 0.9;
const MOTH_MAX_HP = 3;
const MOTH_HIT_RADIUS = 0.028;
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

class VoidMoth {
  readonly group = new Group();
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

  health = MOTH_MAX_HP;
  maxHealth = MOTH_MAX_HP;
  hpDisplay = 1;
  isDead = false;
  private hpBarRoot: Group;
  private hpFillMesh: Mesh;
  private hpBarInnerW: number;
  private hpPosScratch = new Vector3();
  private hpUpScratch = new Vector3();
  private hpCamQ = new Quaternion();

  constructor() {
    ensureSharedWingGeos();
    ensureSharedHpMats();

    const bodyMat = new MeshPhongMaterial({
      color: 0x112244,
      emissive: 0x051122,
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
    this.group.add(abdomen);

    const eyeGeo = new SphereGeometry(0.0024, 5, 5);
    const eyeMat = new MeshPhongMaterial({
      color: 0xff1a1a,
      emissive: new Color(0xff0000),
      emissiveIntensity: 1.2,
      flatShading: true,
    });
    const leftEye = new Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.0045, 0.0018, 0.022);
    const rightEye = new Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.0045, 0.0018, 0.022);
    this.wobbleRig.add(leftEye, rightEye);

    const wingMat = new MeshPhongMaterial({
      color: 0x3355aa,
      emissive: 0x1a2a55,
      side: DoubleSide,
      transparent: true,
      opacity: 0.86,
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
    this.health = Math.max(0, this.health - 1);
    if (this.health <= 0) this.isDead = true;
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
    this.scratch.multiplyScalar(JITTER_AMP * dt);
    this.velocity.add(this.scratch);

    this.toTargetW.subVectors(target, this.group.position);
    const distSq = this.toTargetW.lengthSq();

    if (distSq > 0.0004) {
      this.toTargetW.normalize();
      this.vNav.copy(this.toTargetW).multiplyScalar(FLIGHT_SPEED);
      this.velocity.lerp(this.vNav, TURN_SPEED * dt);
      this.group.position.addScaledVector(this.velocity, dt);

      if (this.velocity.lengthSq() > 0.0001) {
        this.scratch.copy(this.group.position);
        if (this.scratch.lengthSq() > 1e-8) {
          this.group.up.copy(this.scratch).normalize();
        } else {
          this.group.up.set(0, 1, 0);
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

    // Hold |pos| to target shell (carpet altitude + MOTH_RADIAL_LIFT)
    if (playerShellRadius > 0.1) {
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
  }

  updateHpBar(dt: number, camera: Camera) {
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
    this.hpUpScratch.copy(this.scratch).normalize();
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
  }
}

export class VoidMothsManager {
  readonly group = new Group();
  private moths: VoidMoth[] = [];
  private time = 0;
  private spawnTimer = 0;
  private readonly _shieldCenter = new Vector3();

  constructor(
    private readonly paintballSystem: PaintballSystem | null,
    private readonly onMothStruck: (isKill: boolean) => void,
  ) {
    ensureSharedWingGeos();
    ensureSharedHpMats();
  }

  private orbHitMoth(m: VoidMoth) {
    this.paintballSystem?.playImpactAtGroup(m.group, 0x88aaff, false);
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
  ) {
    this.time += dt;
    this.spawnTimer -= dt;

    const playerR = carpetWorldPos.length();
    const mothShellR = playerR + MOTH_RADIAL_LIFT;

    if (this.spawnTimer <= 0 && this.moths.length < 15 && targetPos) {
      this.spawnTimer = 2.0 + Math.random() * 2.5;
      const moth = new VoidMoth();
      this.group.add(moth.getHpBarRoot());
      const angle = Math.random() * Math.PI * 2;
      const ring = 4.2 + Math.random() * 2.8;
      const offset = new Vector3(
        Math.cos(angle) * ring,
        (Math.random() - 0.5) * 1.6,
        Math.sin(angle) * ring,
      );
      moth.group.position.copy(targetPos).add(offset);
      if (mothShellR > 0.1) {
        moth.group.position.normalize().multiplyScalar(mothShellR);
      }
      this.moths.push(moth);
      this.group.add(moth.group);
    }

    for (const moth of this.moths) {
      if (!moth.isDead && targetPos) {
        moth.update(
          dt,
          this.time,
          targetPos,
          mothShellR,
          camera,
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
          this.paintballSystem?.playImpactAtGroup(moth.group, 0x99ccff, false);
          this.onMothStruck(true);
        }
      }
    }

    for (const moth of this.moths) {
      if (!moth.isDead && targetPos) {
        moth.updateHpBar(dt, camera);
      }
    }

    if (capybara && this.moths.length > 0) {
      const targets: { position: Vector3; hitRadius: number; onHit: () => void }[] = [];
      for (const m of this.moths) {
        if (m.isDead) continue;
        targets.push({
          position: m.group.position,
          hitRadius: MOTH_HIT_RADIUS,
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
        moth.dispose();
        this.moths.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const moth of this.moths) {
      this.group.remove(moth.getHpBarRoot());
      moth.dispose();
    }
    this.moths = [];
    this.group.clear();
  }
}
