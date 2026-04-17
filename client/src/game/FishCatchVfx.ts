/**
 * One-shot VFX: simple fish mesh arcs from catch point toward the boat; water splash particles at lift-off and landing.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from "three";

const JUMP_SEC = 0.62;
const ARC_HEIGHT = 0.18;
/** Fade fish mesh after landing on boat (seconds). */
const FISH_FADE_AT_BOAT_SEC = 0.16;
/** Overall size vs globe (~5u radius); keep visually small next to the boat. */
const FISH_GROUP_SCALE = 0.2;

/** Splash particle pool per burst */
const SPLASH_N = 56;
const SPLASH_LIFE = 0.45;
/** Pull particles slightly toward globe center (reads like water spray falling back). */
const SPLASH_INWARD = 1.4;

type Splash = {
  alive: boolean;
  age: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
};

function makeSplashTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  g.addColorStop(0, "rgba(220,245,255,1)");
  g.addColorStop(0.45, "rgba(120,190,230,0.5)");
  g.addColorStop(1, "rgba(80,150,200,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let sharedSplashTex: CanvasTexture | null = null;
function splashTex(): CanvasTexture {
  if (!sharedSplashTex) sharedSplashTex = makeSplashTexture();
  return sharedSplashTex;
}

/**
 * Build a very simple fish: stretched body + cone tail, faces +X.
 */
function createFishMesh(): { group: Group; matBody: MeshBasicMaterial; matTail: MeshBasicMaterial } {
  const mat = new MeshBasicMaterial({
    color: 0x5a9ec8,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
  });
  const matTail = new MeshBasicMaterial({
    color: 0x3d7aa8,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
  });
  const g = new Group();

  const body = new Mesh(new SphereGeometry(0.05, 10, 8), mat);
  body.scale.set(2.2, 1.0, 1.15);
  body.position.x = 0;
  g.add(body);

  const tail = new Mesh(new ConeGeometry(0.045, 0.09, 6), matTail);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.1;
  g.add(tail);

  const eye = new Mesh(new SphereGeometry(0.012, 6, 6), matTail);
  eye.position.set(0.06, 0.02, 0.028);
  g.add(eye);

  g.scale.setScalar(FISH_GROUP_SCALE);
  return { group: g, matBody: mat, matTail: matTail };
}

function createSplashPoints(): { points: Points; pool: Splash[]; geo: BufferGeometry; mat: PointsMaterial } {
  const pool: Splash[] = [];
  for (let i = 0; i < SPLASH_N; i++) {
    pool.push({ alive: false, age: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 });
  }
  const pos = new Float32Array(SPLASH_N * 3);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const mat = new PointsMaterial({
    map: splashTex(),
    color: 0xa8ddff,
    size: 0.055,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: AdditiveBlending,
    alphaTest: 0.05,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 400;
  return { points, pool, geo, mat };
}

function emitSplash(
  pool: Splash[],
  origin: Vector3,
  radial: Vector3,
  tangent: Vector3,
  binorm: Vector3,
  speedScale: number,
) {
  const count = Math.floor(SPLASH_N * 0.55);
  for (let i = 0; i < count; i++) {
    const p = pool[i]!;
    p.alive = true;
    p.age = 0;
    const u = Math.random();
    const v = Math.random();
    const out = (u - 0.5) * 1.2;
    const side = (v - 0.5) * 1.2;
    p.px = origin.x + (Math.random() - 0.5) * 0.015;
    p.py = origin.y + (Math.random() - 0.5) * 0.015;
    p.pz = origin.z + (Math.random() - 0.5) * 0.015;
    const ju = 0.35 + Math.random() * 0.45;
    p.vx = (radial.x * ju + tangent.x * out + binorm.x * side) * speedScale;
    p.vy = (radial.y * ju + tangent.y * out + binorm.y * side) * speedScale;
    p.vz = (radial.z * ju + tangent.z * out + binorm.z * side) * speedScale;
  }
}

function updateSplash(dt: number, pool: Splash[], pos: Float32Array): number {
  let alive = 0;
  for (let i = 0; i < SPLASH_N; i++) {
    const p = pool[i]!;
    if (!p.alive) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      continue;
    }
    p.age += dt;
    if (p.age > SPLASH_LIFE) {
      p.alive = false;
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      continue;
    }
    p.vx -= p.px * SPLASH_INWARD * dt;
    p.vy -= p.py * SPLASH_INWARD * dt;
    p.vz -= p.pz * SPLASH_INWARD * dt;
    p.px += p.vx * dt;
    p.py += p.vy * dt;
    p.pz += p.vz * dt;
    pos[i * 3] = p.px;
    pos[i * 3 + 1] = p.py;
    pos[i * 3 + 2] = p.pz;
    alive++;
  }
  return alive;
}

const _rad = new Vector3();
const _tan = new Vector3();
const _bin = new Vector3();
const _pa = new Vector3();
const _pb = new Vector3();
const _aim = new Vector3();
const _ax = new Vector3();
const _ay = new Vector3();
const _az = new Vector3();
const _basis = new Matrix4();

function arcPoint(p0: Vector3, p1: Vector3, u: number, out: Vector3): Vector3 {
  const base = out.copy(p0).lerp(p1, u);
  _rad.copy(base).normalize();
  base.addScaledVector(_rad, ARC_HEIGHT * Math.sin(Math.PI * u));
  return base;
}

/** Local +X = swim direction; +Y = “belly” toward globe center (radial-ish). */
function orientFishToPath(fish: Group, base: Vector3, swimDir: Vector3) {
  _ax.copy(swimDir).normalize();
  _ay.copy(base).normalize();
  _az.crossVectors(_ax, _ay);
  if (_az.lengthSq() < 1e-8) {
    _az.set(0, 1, 0);
    _az.crossVectors(_ax, _ay);
  }
  _az.normalize();
  _ay.crossVectors(_az, _ax).normalize();
  _basis.makeBasis(_ax, _ay, _az);
  fish.quaternion.setFromRotationMatrix(_basis);
}

/**
 * Single fish jump + splashes; parented to `scene` (world space).
 */
export class FishCatchCelebration {
  private readonly root: Group;
  private readonly fish: Group;
  private readonly fishMaterials: MeshBasicMaterial[] = [];
  private time = 0;
  /** Seconds spent fading the fish after it reaches the boat (0 until arrival). */
  private fishFadeT = 0;
  private readonly p0: Vector3;
  private readonly p1: Vector3;
  /** Splash only where the fish leaves the water (catch point), not at the boat. */
  private readonly takeoffSplash: ReturnType<typeof createSplashPoints>;
  private finished = false;

  constructor(scene: Object3D, fishCatchWorld: Vector3, boatWorld: Vector3) {
    this.p0 = fishCatchWorld.clone();
    // Target slightly above boat deck, shifted toward boat center (radial in)
    _rad.copy(boatWorld).normalize();
    _tan.subVectors(fishCatchWorld, boatWorld);
    _tan.addScaledVector(_rad, -_rad.dot(_tan));
    if (_tan.lengthSq() < 1e-8) _tan.set(0.001, 0, 0);
    _tan.normalize();
    _bin.crossVectors(_rad, _tan).normalize();

    this.p1 = boatWorld.clone().addScaledVector(_rad, 0.14).addScaledVector(_tan, 0.06);

    this.root = new Group();
    const built = createFishMesh();
    this.fish = built.group;
    this.fishMaterials.push(built.matBody, built.matTail);
    this.root.add(this.fish);

    this.takeoffSplash = createSplashPoints();
    this.root.add(this.takeoffSplash.points);

    // Splash as the fish is pulled from the water (surface frame at catch point)
    _rad.copy(this.p0).normalize();
    _tan.subVectors(boatWorld, this.p0);
    _tan.addScaledVector(_rad, -_rad.dot(_tan));
    if (_tan.lengthSq() < 1e-8) _tan.set(0.001, 0, 0);
    _tan.normalize();
    _bin.crossVectors(_rad, _tan).normalize();
    emitSplash(this.takeoffSplash.pool, this.p0, _rad.clone(), _tan.clone(), _bin.clone(), 0.55);

    scene.add(this.root);

    // Initial placement + facing toward boat
    this.fish.position.copy(this.p0);
    _aim.subVectors(this.p1, this.p0);
    if (_aim.lengthSq() > 1e-10) {
      orientFishToPath(this.fish, this.p0, _aim);
    } else {
      this.fish.quaternion.identity();
    }
  }

  /**
   * @returns true while still updating (keep calling), false when done and disposed.
   */
  update(dt: number): boolean {
    if (this.finished) return false;

    this.time += dt;
    const u = Math.min(1, this.time / JUMP_SEC);

    const base = arcPoint(this.p0, this.p1, u, _pa);
    this.fish.position.copy(base);

    const uNext = Math.min(1, u + 0.06);
    arcPoint(this.p0, this.p1, uNext, _pb);
    _aim.subVectors(_pb, base);
    if (_aim.lengthSq() < 1e-8) {
      _aim.subVectors(this.p1, this.p0);
    }
    if (_aim.lengthSq() > 1e-10) {
      orientFishToPath(this.fish, base, _aim);
    }

    const posT = this.takeoffSplash.geo.attributes.position.array as Float32Array;
    updateSplash(dt, this.takeoffSplash.pool, posT);
    (this.takeoffSplash.geo.attributes.position as BufferAttribute).needsUpdate = true;
    // Keep splash material visible while droplets live; gentle fade after typical lifetime
    this.takeoffSplash.mat.opacity = Math.max(
      0,
      0.95 * (1 - Math.max(0, this.time - SPLASH_LIFE * 0.85) / (SPLASH_LIFE * 1.2)),
    );

    if (u >= 1) {
      this.fishFadeT += dt;
      const k = Math.min(1, this.fishFadeT / FISH_FADE_AT_BOAT_SEC);
      const op = 1 - k;
      for (const m of this.fishMaterials) {
        m.opacity = op;
        m.depthWrite = op > 0.08;
      }
      this.fish.visible = op > 0.02;
    }

    const tailTime = JUMP_SEC + FISH_FADE_AT_BOAT_SEC + SPLASH_LIFE + 0.25;
    if (this.time >= tailTime) {
      this.disposeFromScene();
      this.finished = true;
      return false;
    }
    return true;
  }

  private disposeFromScene() {
    this.root.parent?.remove(this.root);
    this.fish.traverse((c) => {
      const m = c as Mesh;
      m.geometry?.dispose();
    });
    for (const m of this.fishMaterials) m.dispose();
    this.takeoffSplash.geo.dispose();
    this.takeoffSplash.mat.map = null;
    this.takeoffSplash.mat.dispose();
  }
}

/**
 * Holds active celebrations; attach to scene root, call {@link update} each frame.
 */
export class FishCatchVfx {
  private readonly celebrations: FishCatchCelebration[] = [];

  spawn(scene: Object3D | null, fishWorld: Vector3, boatWorld: Vector3) {
    if (!scene) return;
    this.celebrations.push(new FishCatchCelebration(scene, fishWorld, boatWorld));
  }

  update(dt: number) {
    for (let i = this.celebrations.length - 1; i >= 0; i--) {
      if (!this.celebrations[i]!.update(dt)) {
        this.celebrations.splice(i, 1);
      }
    }
  }

  dispose() {
    this.celebrations.length = 0;
  }
}
