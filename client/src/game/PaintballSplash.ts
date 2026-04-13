/**
 * One-shot radial paint droplets at a world-space impact point.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
  type Scene,
} from "three";
import { seededRandom } from "./SphericalMath";

const POOL = 4;
const PARTICLE_COUNT = 56;
const GRAVITY = 1.15;
const LIFE_MIN = 0.35;
const LIFE_MAX = 0.62;

const vert = `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (42.0 / max(-mvPos.z, 0.24));
  gl_Position = projectionMatrix * mvPos;
}
`;

const frag = `
uniform vec3 uColor;
uniform float uBoost;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float edge = smoothstep(0.82, 0.98, d);
  float a = 1.0 - edge;
  if (a < 0.03) discard;
  vec3 col = uColor * uBoost;
  gl_FragColor = vec4(col, a * vAlpha);
}
`;

type P = {
  alive: boolean;
  t: number;
  life: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
};

export class PaintballSplashBurst {
  readonly points: Points;
  private readonly pool: P[];
  private readonly posAttr: BufferAttribute;
  private readonly alphaAttr: BufferAttribute;
  private readonly sizeAttr: BufferAttribute;
  private readonly geo: BufferGeometry;
  private readonly mat: ShaderMaterial;
  private active = false;

  constructor() {
    this.pool = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.pool.push({
        alive: false,
        t: 0,
        life: 1,
        px: 0,
        py: 0,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
      });
    }
    this.posAttr = new BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3);
    this.alphaAttr = new BufferAttribute(new Float32Array(PARTICLE_COUNT), 1);
    this.sizeAttr = new BufferAttribute(new Float32Array(PARTICLE_COUNT), 1);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setAttribute("aAlpha", this.alphaAttr);
    this.geo.setAttribute("aSize", this.sizeAttr);
    this.mat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uColor: { value: new Color(1, 1, 1) },
        uBoost: { value: 1.35 },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 475;
  }

  play(scene: Scene, worldOrigin: Vector3, colorHex: number, seed: number) {
    const rnd = seededRandom(seed >>> 0);
    const c = new Color(colorHex);
    this.mat.uniforms.uColor!.value.copy(c);
    this.mat.uniforms.uBoost!.value = 1.2 + rnd() * 0.45;

    const rad = worldOrigin.clone().normalize();
    const tmp = new Vector3();
    const ax =
      Math.abs(rad.y) < 0.92
        ? tmp.set(0, 1, 0).cross(rad).normalize()
        : tmp.set(1, 0, 0).cross(rad).normalize();
    const ay = new Vector3().crossVectors(rad, ax).normalize();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.pool[i]!;
      p.alive = true;
      p.t = 0;
      p.life = LIFE_MIN + rnd() * (LIFE_MAX - LIFE_MIN);
      p.px = worldOrigin.x + (rnd() - 0.5) * 0.035;
      p.py = worldOrigin.y + (rnd() - 0.5) * 0.035;
      p.pz = worldOrigin.z + (rnd() - 0.5) * 0.035;

      const spread = 0.45 + rnd() * 0.85;
      const u = (rnd() - 0.5) * 2.2;
      const v = (rnd() - 0.5) * 2.2;
      const w = 0.35 + rnd() * 0.95;
      p.vx = rad.x * w * spread + ax.x * u + ay.x * v;
      p.vy = rad.y * w * spread + ax.y * u + ay.y * v;
      p.vz = rad.z * w * spread + ax.z * u + ay.z * v;

      const base = 0.66 + rnd() * 1.35;
      const sz = base * (0.5 + rnd() * 1.0);
      this.sizeAttr.setX(i, sz);
    }

    this.flushAttrs();
    this.active = true;
    this.points.visible = true;
    scene.add(this.points);
  }

  private flushAttrs() {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.pool[i]!;
      const i3 = i * 3;
      if (p.alive) {
        this.posAttr.setXYZ(i3, p.px, p.py, p.pz);
        this.alphaAttr.setX(i, 1);
      } else {
        this.posAttr.setXYZ(i3, 0, -1e5, 0);
        this.alphaAttr.setX(i, 0);
      }
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  update(scene: Scene, dt: number): void {
    if (!this.active) return;

    let any = false;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.pool[i]!;
      if (!p.alive) continue;
      any = true;
      p.t += dt;
      const k = p.t / p.life;
      p.vy -= GRAVITY * dt * 0.055;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      this.alphaAttr.setX(i, Math.max(0, 1 - k * k * 1.15));
      const i3 = i * 3;
      this.posAttr.setXYZ(i3, p.px, p.py, p.pz);
      if (p.t >= p.life) {
        p.alive = false;
        this.posAttr.setXYZ(i3, 0, -1e5, 0);
        this.alphaAttr.setX(i, 0);
      }
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;

    if (!any) {
      this.active = false;
      this.points.visible = false;
      scene.remove(this.points);
    }
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Small pool so overlapping hits can show bursts. */
export class PaintballSplashPool {
  private readonly bursts: PaintballSplashBurst[] = [];
  private next = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      this.bursts.push(new PaintballSplashBurst());
    }
  }

  play(scene: Scene, worldOrigin: Vector3, colorHex: number, seed: number) {
    const b = this.bursts[this.next]!;
    this.next = (this.next + 1) % POOL;
    b.play(scene, worldOrigin, colorHex, seed);
  }

  update(scene: Scene, dt: number) {
    for (const b of this.bursts) b.update(scene, dt);
  }

  dispose() {
    for (const b of this.bursts) b.dispose();
  }
}
