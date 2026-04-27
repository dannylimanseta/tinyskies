/**
 * Two-phase eternal-flame victory cutscene.
 *
 * Phase 1 (globe view):  5 glowing orbs launch from braziers along Bézier arcs
 *                        with a fading light trail behind each one.
 * Phase 2 (moon close-up): orbs converge on the moon's near face and explode.
 */
import {
  Group,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  AdditiveBlending,
  Vector3,
  Points,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
} from "three";

/* ── Timing ──────────────────────────────────────────────────────── */
const P1_BEAM_TRAVEL_SEC = 3.5;   // slower, more cinematic
const P1_BEAM_DELAY      = 0.30;
const P1_GLOW_FADE_SEC   = 1.5;
const P2_BEAM_TRAVEL_SEC = 0.9;
const P2_BEAM_DELAY      = 0.35;
const P2_HOLD_SEC        = 2.2;
const IMPACT_LIFETIME    = 1.5;

/* ── Trail geometry ──────────────────────────────────────────────── */
const TRAIL_POINTS  = 56;
/** Fraction of bezier parameter covered by the trail (tail lags head by this much). */
const TRAIL_LENGTH  = 0.32;
/** World-space radius of the orb sprite in globe view. */
const ORB_P1_SCALE  = 0.9;
/** Smaller in moon close-up (moon is much closer to camera). */
const ORB_P2_SCALE  = 0.42;

/* ── Impact particles ────────────────────────────────────────────── */
const P1_PARTICLES = 80;
const P2_PARTICLES = 280;

/* ── Trail shader ─────────────────────────────────────────────────── */
const trailVert = `
attribute float aAge;    // 0 = head (newest), 1 = tail (oldest)
attribute float aSize;
varying float vAge;
void main() {
  vAge = aAge;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (280.0 / -mv.z);
  gl_Position  = projectionMatrix * mv;
}`;

const trailFrag = `
uniform vec3  uColor;
uniform float uGlobalAlpha;
varying float vAge;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float r  = dot(uv, uv) * 4.0;
  float circle = smoothstep(1.0, 0.2, r);
  float fade   = (1.0 - vAge) * (1.0 - vAge);
  float a = circle * fade * uGlobalAlpha;
  if (a < 0.01) discard;
  float bright = 1.5 + (1.0 - vAge) * 2.5;
  gl_FragColor = vec4(uColor * bright, a);
}`;

/* ── Impact particle shader ──────────────────────────────────────── */
const ptVert = `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (220.0 / -mv.z);
  gl_Position  = projectionMatrix * mv;
}`;

const ptFrag = `
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float r = dot(uv, uv) * 4.0;
  float a = smoothstep(1.0, 0.0, r) * vAlpha;
  if (a < 0.005) discard;
  gl_FragColor = vec4(1.0, 0.85, 0.45, a);
}`;

/* ── Helpers ─────────────────────────────────────────────────────── */
function cubicBez(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3) {
  const m = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p0, m*m*m).addScaledVector(p1, 3*m*m*t)
    .addScaledVector(p2, 3*m*t*t).addScaledVector(p3, t*t*t);
}

function makeGlowTex(r: number, g: number, b: number, size = 128): CanvasTexture {
  const c   = document.createElement("canvas");
  c.width   = c.height = size;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grd.addColorStop(0,   `rgba(${r},${g},${b},1)`);
  grd.addColorStop(0.25,`rgba(${r},${g},${b},0.7)`);
  grd.addColorStop(0.6, `rgba(${r},${g},${b},0.2)`);
  grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

const BEAM_COLORS: [number, number, number][] = [
  [1.0, 0.85, 0.30],
  [1.0, 0.60, 0.20],
  [0.95, 0.95, 1.0],
  [1.0, 0.75, 0.25],
  [0.80, 0.95, 1.0],
];

/* ── Internal types ──────────────────────────────────────────────── */
interface OrbBeam {
  p0: Vector3; p1: Vector3; p2: Vector3; p3: Vector3;
  color: [number, number, number];
  launchTime: number;
  launched:   boolean;
  impacted:   boolean;
  orbScale:   number;
  /** Sprite — the glowing orb head. */
  orb:       Sprite;
  orbMat:    SpriteMaterial;
  /** Points — the fading light trail. */
  trail:        Points;
  trailMat:     ShaderMaterial;
  trailPosAttr: BufferAttribute;
  trailAgeAttr: BufferAttribute;
  trailSzAttr:  BufferAttribute;
  /** Brazier launch glow (P1 only). */
  launchGlow?:    Sprite;
  launchGlowMat?: SpriteMaterial;
  launchGlowAge?: number;
}

interface ImpactBurst {
  active:    boolean;
  age:       number;
  particles: { px: number; py: number; pz: number; vx: number; vy: number; vz: number }[];
  posAttr:   BufferAttribute;
  alphaAttr: BufferAttribute;
  sizeAttr:  BufferAttribute;
  points:    Points;
}

/* ══════════════════════════════════════════════════════════════════ */

export class EternalFlameBeams {
  readonly group = new Group();

  private p1Beams:   OrbBeam[] = [];
  private p1Impacts: ImpactBurst[] = [];
  private p2Beams:   OrbBeam[] = [];
  private p2Impacts: ImpactBurst[] = [];

  private moonFlashSprite: Sprite | null = null;
  private moonFlashMat:    SpriteMaterial | null = null;
  private moonFlashStrength = 0;

  private phase:  "phase1" | "phase2" | "done" = "phase1";
  private p1Time  = 0;
  private p2Time  = 0;
  private _p1Done = false;

  private orbGlowTex:  CanvasTexture;
  private moonFlashTex: CanvasTexture;

  get state()      { return this.phase; }
  get phase1Done() { return this._p1Done; }

  /** Fired each time a Phase 1 beam launches from a brazier (index = beam index 0–4). */
  onBeamLaunch:       ((beamIndex: number) => void) | null = null;
  /** Fired each time a P2 beam hits the moon (Game.ts uses this for shake). */
  onPhase2Impact:     (() => void) | null = null;
  /** Fired once when ALL P2 beams have impacted — trigger whiteout here. */
  onAllP2Impacted:    (() => void) | null = null;

  constructor(
    private readonly brazierPositions: Vector3[],
    private readonly moonPosition:     Vector3,
  ) {
    this.orbGlowTex   = makeGlowTex(255, 200, 80, 256);
    this.moonFlashTex = makeGlowTex(255, 240, 160, 512);
    this.buildPhase1();
  }

  /* ── Phase 1 ─────────────────────────────────────────────────── */

  private buildPhase1() {
    const count = Math.min(this.brazierPositions.length, 5);
    for (let bi = 0; bi < count; bi++) {
      const p0   = this.brazierPositions[bi]!.clone();
      const p3   = this.moonPosition.clone();
      const upDir  = p0.clone().normalize();
      const toMoon = p3.clone().sub(p0).normalize();
      const perp   = new Vector3(Math.sin(bi*1.618), Math.cos(bi*2.094), Math.sin(bi*2.720))
        .cross(toMoon).normalize();

      const p1 = p0.clone().addScaledVector(upDir, 3.5 + bi*0.4)
        .addScaledVector(perp, (bi%2===0?1:-1)*1.2);
      const p2 = p3.clone().addScaledVector(toMoon.clone().negate(), 2.0)
        .addScaledVector(perp, (bi%2===0?-1:1)*0.7);

      const color = BEAM_COLORS[bi % BEAM_COLORS.length]!;
      const orb   = this.makeOrb(color, ORB_P1_SCALE);

      // Brazier launch glow sprite.
      const lGlowTex = makeGlowTex(255, 180, 60, 128);
      const lGlowMat = new SpriteMaterial({ map: lGlowTex, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 });
      const lGlow    = new Sprite(lGlowMat);
      lGlow.position.copy(p0);
      lGlow.scale.setScalar(0.8);
      this.group.add(lGlow);

      const trail = this.makeTrail(color);
      this.p1Beams.push({
        p0, p1, p2, p3, color,
        launchTime: bi * P1_BEAM_DELAY,
        launched: false, impacted: false,
        orbScale: ORB_P1_SCALE,
        ...orb, ...trail,
        launchGlow: lGlow, launchGlowMat: lGlowMat, launchGlowAge: -1,
      });
      this.p1Impacts.push(this.makeImpactBurst(P1_PARTICLES));
    }
  }

  /* ── Phase 2 ─────────────────────────────────────────────────── */

  startPhase2(globeDir: Vector3, moonRadius: number, cameraPos: Vector3) {
    this.phase  = "phase2";
    this.p2Time = 0;

    const flashMat = new SpriteMaterial({ map: this.moonFlashTex, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 });
    this.moonFlashMat    = flashMat;
    this.moonFlashSprite = new Sprite(flashMat);
    this.moonFlashSprite.position.copy(this.moonPosition);
    this.moonFlashSprite.scale.setScalar(moonRadius * 5);
    this.group.add(this.moonFlashSprite);

    const toCam  = cameraPos.clone().sub(this.moonPosition).normalize();
    const arbUp  = Math.abs(toCam.y) < 0.85 ? new Vector3(0,1,0) : new Vector3(1,0,0);
    const right  = new Vector3().crossVectors(toCam, arbUp).normalize();
    const up     = new Vector3().crossVectors(right, toCam).normalize();
    const count  = this.p1Beams.length;

    for (let bi = 0; bi < count; bi++) {
      const angle = (bi / count) * Math.PI * 2 + 0.4;
      // Spread on the visible hemisphere: start in disc coords then project to sphere surface.
      const discR = 0.55 + (bi % 3) * 0.15; // fraction of hemisphere radius (0-1)
      const dx    = Math.cos(angle) * discR;
      const dy    = Math.sin(angle) * discR;
      // Project disc point to hemisphere: z = sqrt(1 - dx²- dy²)
      const dz    = Math.sqrt(Math.max(0, 1 - dx*dx - dy*dy));
      // Surface direction = toCam*dz + right*dx + up*dy, normalized.
      const surfDir = toCam.clone().multiplyScalar(dz)
        .addScaledVector(right, dx).addScaledVector(up, dy).normalize();
      // Impact ON the moon surface.
      const impactPos = this.moonPosition.clone().addScaledVector(surfDir, moonRadius * 0.98);

      // Beam starts far out on the camera side, spread wide around the frame.
      const spreadAngle = angle + 0.5;
      const p0 = this.moonPosition.clone()
        .addScaledVector(toCam, moonRadius * 3.5)
        .addScaledVector(right, Math.cos(spreadAngle) * moonRadius * 2.5)
        .addScaledVector(up,    Math.sin(spreadAngle) * moonRadius * 2.0);
      const p3 = impactPos.clone();
      // Control points arc toward the surface point from outside, matching the surface normal.
      const p1 = p0.clone().lerp(p3, 0.35)
        .addScaledVector(right, Math.cos(spreadAngle) * moonRadius * 0.6)
        .addScaledVector(up,    Math.sin(spreadAngle) * moonRadius * 0.6);
      // p2 approaches along the surface normal so beam arrives perpendicular to the moon.
      const p2 = impactPos.clone().addScaledVector(surfDir, moonRadius * 1.5);

      const color = BEAM_COLORS[bi % BEAM_COLORS.length]!;
      const orb   = this.makeOrb(color, ORB_P2_SCALE);
      const trail = this.makeTrail(color);
      this.p2Beams.push({
        p0, p1, p2, p3, color,
        launchTime: bi * P2_BEAM_DELAY,
        launched: false, impacted: false,
        orbScale: ORB_P2_SCALE,
        ...orb, ...trail,
      });
      this.p2Impacts.push(this.makeImpactBurst(P2_PARTICLES));
    }
  }

  /* ── Factories ───────────────────────────────────────────────── */

  private makeOrb(color: [number, number, number], baseScale: number) {
    const mat = new SpriteMaterial({
      map: this.orbGlowTex,
      transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0,
      color: (color[0] << 16 | color[1] << 8 | color[2]) as any,
    });
    // Use CSS-style colour multiplication: set colour as float array.
    (mat as any).color.setRGB(color[0], color[1], color[2]);
    const orb = new Sprite(mat);
    orb.scale.setScalar(baseScale);
    orb.visible = false;
    this.group.add(orb);
    return { orb, orbMat: mat };
  }

  private makeTrail(color: [number, number, number]) {
    const n   = TRAIL_POINTS;
    const pos = new Float32Array(n * 3);
    const age = new Float32Array(n);
    const sz  = new Float32Array(n);
    const geo = new BufferGeometry();
    const trailPosAttr = new BufferAttribute(pos, 3);
    const trailAgeAttr = new BufferAttribute(age, 1);
    const trailSzAttr  = new BufferAttribute(sz,  1);
    geo.setAttribute("position", trailPosAttr);
    geo.setAttribute("aAge",     trailAgeAttr);
    geo.setAttribute("aSize",    trailSzAttr);

    const mat = new ShaderMaterial({
      vertexShader: trailVert, fragmentShader: trailFrag,
      uniforms: { uColor: { value: color }, uGlobalAlpha: { value: 0 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    const trail = new Points(geo, mat);
    trail.frustumCulled = false;
    trail.visible = false;
    this.group.add(trail);
    return { trail, trailMat: mat, trailPosAttr, trailAgeAttr, trailSzAttr };
  }

  private makeImpactBurst(n: number): ImpactBurst {
    const pos = new Float32Array(n * 3);
    const al  = new Float32Array(n);
    const sz  = new Float32Array(n);
    const geo = new BufferGeometry();
    const posAttr   = new BufferAttribute(pos, 3);
    const alphaAttr = new BufferAttribute(al,  1);
    const sizeAttr  = new BufferAttribute(sz,  1);
    geo.setAttribute("position", posAttr);
    geo.setAttribute("aAlpha",   alphaAttr);
    geo.setAttribute("aSize",    sizeAttr);
    const mat    = new ShaderMaterial({ vertexShader: ptVert, fragmentShader: ptFrag, transparent: true, depthWrite: false, blending: AdditiveBlending });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    this.group.add(points);
    return { active: false, age: 0, particles: Array.from({ length: n }, () => ({ px:0,py:0,pz:0,vx:0,vy:0,vz:0 })), posAttr, alphaAttr, sizeAttr, points };
  }

  /* ── Update ──────────────────────────────────────────────────── */

  update(dt: number) {
    if (this.phase === "phase1") this.updatePhase1(dt);
    else if (this.phase === "phase2") this.updatePhase2(dt);
  }

  private updatePhase1(dt: number) {
    this.p1Time += dt;
    let allImpacted = true, allBurstsDone = true;

    for (let bi = 0; bi < this.p1Beams.length; bi++) {
      const beam   = this.p1Beams[bi]!;
      const impact = this.p1Impacts[bi]!;

      if (!beam.launched && this.p1Time >= beam.launchTime) {
        beam.launched = true;
        beam.orb.visible = true;
        beam.trail.visible = true;
        if (beam.launchGlowAge !== undefined) beam.launchGlowAge = 0;
        this.onBeamLaunch?.(bi);
      }

      // Brazier launch glow.
      if (beam.launchGlowAge !== undefined && beam.launchGlowAge >= 0 && beam.launchGlow && beam.launchGlowMat) {
        beam.launchGlowAge += dt;
        const t = beam.launchGlowAge / P1_GLOW_FADE_SEC;
        beam.launchGlowMat.opacity = Math.exp(-t * 3.5);
        beam.launchGlow.scale.setScalar(0.6 + t * 1.5);
      }

      if (beam.launched && !beam.impacted) {
        allImpacted = false;
        const localT = (this.p1Time - beam.launchTime) / P1_BEAM_TRAVEL_SEC;
        const alpha  = Math.min(1, localT * 4);
        if (localT >= 1) {
          beam.impacted = true;
          beam.orb.visible   = false;
          beam.trail.visible = false;
          this.activateBurst(impact, beam.p3, 0.8, P1_PARTICLES);
        } else {
          this.updateOrb(beam, localT, alpha);
        }
      }

      if (impact.active) { allBurstsDone = false; this.tickBurst(impact, dt); }
    }

    // Signal done as soon as all beams arrive — don't wait for bursts to fade.
    if (allImpacted && this.p1Time > 0.5) this._p1Done = true;
  }

  private updatePhase2(dt: number) {
    this.p2Time += dt;
    let allImpacted = true, allBurstsDone = true;

    for (let bi = 0; bi < this.p2Beams.length; bi++) {
      const beam   = this.p2Beams[bi]!;
      const impact = this.p2Impacts[bi]!;

      if (!beam.launched && this.p2Time >= beam.launchTime) {
        beam.launched = true;
        beam.orb.visible = true;
        beam.trail.visible = true;
      }

      if (beam.launched && !beam.impacted) {
        allImpacted = false;
        const localT = (this.p2Time - beam.launchTime) / P2_BEAM_TRAVEL_SEC;
        const alpha  = Math.min(1, localT * 5);
        if (localT >= 1) {
          beam.impacted = true;
          beam.orb.visible   = false;
          beam.trail.visible = false;
          this.activateBurst(impact, beam.p3, 1.8, P2_PARTICLES);
          this.moonFlashStrength = Math.min(1, this.moonFlashStrength + 0.55);
          this.onPhase2Impact?.();
          const allHit = this.p2Beams.every((b) => b.impacted);
          if (allHit) this.onAllP2Impacted?.();
        } else {
          this.updateOrb(beam, localT, alpha);
        }
      }

      if (impact.active) { allBurstsDone = false; this.tickBurst(impact, dt); }
    }

    if (this.moonFlashMat) {
      this.moonFlashStrength = Math.max(0, this.moonFlashStrength - 0.5 * dt);
      this.moonFlashMat.opacity = this.moonFlashStrength;
    }

    const lastImpactTime = (this.p2Beams.length - 1) * P2_BEAM_DELAY + P2_BEAM_TRAVEL_SEC;
    if (allImpacted && allBurstsDone && this.p2Time > lastImpactTime + P2_HOLD_SEC) {
      this.phase = "done";
    }
  }

  /* ── Orb + trail update ──────────────────────────────────────── */

  private readonly _pt = new Vector3();

  private updateOrb(beam: OrbBeam, localT: number, globalAlpha: number) {
    const headT = Math.min(1, localT);
    const tailT = Math.max(0, headT - TRAIL_LENGTH);

    // Position orb at head of arc.
    cubicBez(beam.p0, beam.p1, beam.p2, beam.p3, headT, this._pt);
    beam.orb.position.copy(this._pt);
    // Pulse the orb scale.
    const pulse = 1 + 0.18 * Math.sin(localT * 18);
    beam.orb.scale.setScalar(beam.orbScale * pulse);
    beam.orbMat.opacity = globalAlpha;

    // Update trail points spread from tailT to headT.
    const positions = beam.trailPosAttr.array as Float32Array;
    const ages      = beam.trailAgeAttr.array as Float32Array;
    const sizes     = beam.trailSzAttr.array as Float32Array;

    for (let i = 0; i < TRAIL_POINTS; i++) {
      const age = i / (TRAIL_POINTS - 1); // 0 = head, 1 = tail
      const t   = headT - age * (headT - tailT);
      cubicBez(beam.p0, beam.p1, beam.p2, beam.p3, Math.max(0, t), this._pt);
      positions[i*3]   = this._pt.x;
      positions[i*3+1] = this._pt.y;
      positions[i*3+2] = this._pt.z;
      ages[i]  = age;
      // Head points are large, tail points tiny.
      sizes[i] = beam.orbScale * (0.9 - age * 0.75);
    }

    beam.trailPosAttr.needsUpdate = true;
    beam.trailAgeAttr.needsUpdate = true;
    beam.trailSzAttr.needsUpdate  = true;
    beam.trailMat.uniforms.uGlobalAlpha.value = globalAlpha;
  }

  /* ── Impact burst ────────────────────────────────────────────── */

  private activateBurst(burst: ImpactBurst, pos: Vector3, speed: number, n: number) {
    burst.active = true; burst.age = 0;
    burst.points.visible = true;
    const outDir = pos.clone().normalize();
    const arbUp  = Math.abs(outDir.y) < 0.9 ? new Vector3(0,1,0) : new Vector3(1,0,0);
    const side   = new Vector3().crossVectors(outDir, arbUp).normalize();
    const up2    = new Vector3().crossVectors(side, outDir).normalize();
    for (let i = 0; i < n; i++) {
      const p = burst.particles[i]!;
      p.px = pos.x; p.py = pos.y; p.pz = pos.z;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(Math.random());
      const rx = Math.sin(phi)*Math.cos(theta), ry = Math.sin(phi)*Math.sin(theta), rz = Math.cos(phi);
      const s2 = speed * (0.3 + Math.random() * Math.random() * 2.5);
      p.vx = (outDir.x*rz + side.x*rx + up2.x*ry) * s2;
      p.vy = (outDir.y*rz + side.y*rx + up2.y*ry) * s2;
      p.vz = (outDir.z*rz + side.z*rx + up2.z*ry) * s2;
    }
  }

  private tickBurst(burst: ImpactBurst, dt: number) {
    burst.age += dt;
    const n = burst.particles.length;
    const pos = burst.posAttr.array as Float32Array;
    const al  = burst.alphaAttr.array as Float32Array;
    const sz  = burst.sizeAttr.array as Float32Array;
    const t   = burst.age / IMPACT_LIFETIME;
    for (let i = 0; i < n; i++) {
      const p = burst.particles[i]!;
      p.px += p.vx*dt; p.py += p.vy*dt; p.pz += p.vz*dt;
      p.vx *= 1-1.8*dt; p.vy *= 1-1.8*dt; p.vz *= 1-1.8*dt;
      pos[i*3] = p.px; pos[i*3+1] = p.py; pos[i*3+2] = p.pz;
      al[i] = t < 0.15 ? t/0.15 : Math.pow(1 - (t-0.15)/0.85, 1.5);
      sz[i] = 0.08 + t * 0.55;
    }
    burst.posAttr.needsUpdate = true;
    burst.alphaAttr.needsUpdate = true;
    burst.sizeAttr.needsUpdate  = true;
    if (burst.age >= IMPACT_LIFETIME) { burst.active = false; burst.points.visible = false; }
  }

  /* ── Dispose ─────────────────────────────────────────────────── */

  dispose() {
    this.orbGlowTex.dispose();
    this.moonFlashTex.dispose();
    const disposeOrb = (b: OrbBeam) => {
      b.orbMat.dispose();
      b.trailMat.dispose();
      b.trail.geometry.dispose();
      b.launchGlowMat?.dispose();
    };
    const disposeBurst = (b: ImpactBurst) => {
      b.points.geometry.dispose();
      (b.points.material as ShaderMaterial).dispose();
    };
    this.p1Beams.forEach(disposeOrb);
    this.p2Beams.forEach(disposeOrb);
    this.p1Impacts.forEach(disposeBurst);
    this.p2Impacts.forEach(disposeBurst);
    this.moonFlashMat?.dispose();
  }
}
