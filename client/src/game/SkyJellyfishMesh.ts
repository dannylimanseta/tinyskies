import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";

/**
 * Sky Jellyfish — shader-driven bell + ribbon tendrils.
 *
 * Bell: hemisphere with vertex-displacement breathing pulse + noise ripples.
 * Tendrils: wide ribbons with sine waves travelling toward the tips + lateral sway.
 *
 * Each jelly gets its own `ShaderMaterial` instances so it can carry per-instance
 * `uPhase` and `uColor` uniforms. Geometries are shared between jellies for
 * modest memory wins (6 jellies × 5 tendrils = 30 tendril materials, small).
 */

const TENDRIL_COUNT = 6;
const TENDRIL_LENGTH = 1.25;
const TENDRIL_WIDTH = 0.055;
/** More length segments = smoother bends when flow + waves stack. */
const TENDRIL_LENGTH_SEGMENTS = 52;
const BELL_RADIUS = 0.18;

const _tmpColor = new Color();
const _flowMeshScratch = new Vector3();
const _flowInvWorld = new Matrix4();

const noiseGLSL = `
float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0,0.0,0.0)), f.x),
        mix(hash3(i + vec3(0.0,1.0,0.0)), hash3(i + vec3(1.0,1.0,0.0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0.0,0.0,1.0)), hash3(i + vec3(1.0,0.0,1.0)), f.x),
        mix(hash3(i + vec3(0.0,1.0,1.0)), hash3(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}
`;

// Shared GLSL snippet: asymmetric jellyfish contraction pulse.
// Fast squeeze (25% of cycle), slow relaxed glide (75% of cycle).
// Returns contraction in [0,1], relaxed = 1-contraction.
const pulseGLSL = `
float jellyPulse(float t, float phase) {
  float cycle = fract(t * 0.75 + phase * 0.15);
  float cNorm = clamp(cycle / 0.25, 0.0, 1.0);
  float rNorm = clamp((cycle - 0.25) / 0.75, 0.0, 1.0);
  float cSmooth = cNorm * cNorm * (3.0 - 2.0 * cNorm);
  float rSmooth = rNorm * rNorm * (3.0 - 2.0 * rNorm);
  return cSmooth * (1.0 - rSmooth);
}
`;

const bellVert = `
uniform float uTime;
uniform float uPhase;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vSkirt;
varying float vWobble;
varying float vContraction;
${noiseGLSL}
${pulseGLSL}
void main() {
  float contraction = jellyPulse(uTime, uPhase);
  float relaxed = 1.0 - contraction;

  // Bell is centred at origin; yUnit: 0 = rim, 1 = top of dome.
  float yUnit = clamp((position.y + ${BELL_RADIUS.toFixed(3)}) / (2.0 * ${BELL_RADIUS.toFixed(3)}), 0.0, 1.0);
  float skirt = smoothstep(0.8, 0.0, yUnit);
  vSkirt = skirt;
  vContraction = contraction;

  vec3 displaced = position;

  // 1. Real jellyfish contraction: rim folds inward+upward on power stroke.
  //    Top of bell depresses slightly inward as the ring muscles pull.
  displaced.xz *= 1.0 - contraction * 0.45 * skirt;    // rim squeezes in
  displaced.y  += contraction * 0.18 * skirt;            // rim lifts up
  displaced.y  -= contraction * 0.06 * (1.0 - skirt);   // top depresses

  // 2. Organic wobble — only significant during relaxed phase (bell ripples as it opens).
  float n = noise3(position * 15.0 + vec3(uTime * 1.2, uPhase, uTime * 0.8));
  float bulge = (n - 0.5) * 0.5 * skirt * relaxed;
  displaced.xz *= 1.0 + bulge;
  displaced += normal * ((n - 0.5) * 0.05 * relaxed);

  // 3. Gentle skirt flutter during relaxation (open phase only).
  float flutter = sin(uTime * 4.5 + position.x * 22.0 + position.z * 22.0 + uPhase * 2.0);
  displaced.y   += flutter * 0.018 * skirt * relaxed;
  displaced.xz  *= 1.0 + flutter * 0.012 * skirt * relaxed;

  vWobble = n;

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = viewMatrix * worldPos;
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

const bellFrag = `
uniform float uTime;
uniform float uPhase;
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vSkirt;
varying float vWobble;
varying float vContraction;
void main() {
  float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.0);

  // Flash brighter on the power stroke, dim during glide.
  float glow = 0.7 + 0.6 * vContraction;
  vec3 softColor = mix(uColor, vec3(1.0), 0.35);
  vec3 core  = softColor * glow;
  vec3 inner = uColor   * (0.4 + 0.3 * vWobble) * glow;
  vec3 col   = mix(inner, core, rim * 0.6);
  col += uColor     * 0.30 * vSkirt * glow;
  col += softColor  * 0.30 * rim;

  float alpha = clamp(0.18 + rim * 0.32, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

const tendrilVert = `
uniform float uTime;
uniform float uPhase;
uniform vec3 uFlowVelocity;
varying vec2 vUv;
varying float vTipFade;
varying float vContraction;
${noiseGLSL}
${pulseGLSL}
void main() {
  vUv = uv;
  // tipWeight: 0 at base (bell rim), 1 at tip.
  float tipWeight = 1.0 - uv.y;
  float ampShape  = smoothstep(0.0, 1.0, tipWeight);
  float ampShape2 = ampShape * ampShape;
  float ampShape3 = ampShape2 * ampShape;

  float contraction = jellyPulse(uTime, uPhase);
  float relaxed = 1.0 - contraction;
  vContraction = contraction;

  vec3 displaced = position;

  float flowSpd = length(uFlowVelocity);
  // Undulation gets livelier when the jelly moves; still some motion when nearly idle.
  float flowBoost = 1.0 + smoothstep(0.0, 1.4, flowSpd) * 1.1;
  // Keep soft waves through contraction so tips never look frozen.
  float flapMult = mix(0.42, 1.0, relaxed * relaxed);

  // --- Power stroke: tips sweep upward toward bell (fold inward) ---
  displaced.y += contraction * 0.55 * ampShape2;
  displaced.x *= 1.0 - contraction * 0.6 * ampShape2;
  displaced.z *= 1.0 - contraction * 0.6 * ampShape2;

  // --- Procedural waves (travelling phase tied to motion reads as inertia) ---
  float travel = tipWeight * flowSpd * 2.4;
  float w1 = sin(uTime * 2.5 + tipWeight * 8.0  - travel + uPhase)       * 0.32 * flapMult * flowBoost;
  float w2 = sin(uTime * 3.8 + tipWeight * 5.0  - travel * 0.7 + uPhase * 1.7) * 0.22 * flapMult * flowBoost;
  float w3 = sin(uTime * 1.9 + tipWeight * 12.0 + uPhase * 0.6) * 0.11 * flapMult * flowBoost;
  displaced.x += (w1 + w2 + w3) * ampShape2;

  float z1 = sin(uTime * 2.2 + tipWeight * 7.0  - travel * 0.85 + uPhase * 2.1) * 0.28 * flapMult * flowBoost;
  float z2 = sin(uTime * 3.1 + tipWeight * 10.0 - travel + uPhase * 0.8) * 0.16 * flapMult * flowBoost;
  float zNoise = (noise3(vec3(tipWeight * 4.0, uTime * 0.8, uPhase)) - 0.5) * 0.26 * flapMult * flowBoost;
  displaced.z += (z1 + z2 + zNoise) * ampShape2;

  // Secondary slow meander (different frequency) so motion never reads as one stiff sine.
  float meander = sin(uTime * 0.95 + tipWeight * 14.0 + uPhase * 1.2 + flowSpd * 0.5);
  displaced.x += meander * 0.08 * ampShape3 * flowBoost;
  displaced.z += cos(uTime * 1.1 + tipWeight * 11.0 + uPhase) * 0.07 * ampShape3 * flowBoost;

  // Resting curl
  float curl = ampShape2 * ampShape * 0.22;
  displaced.x += sin(uPhase * 2.3) * curl * relaxed;
  displaced.z += cos(uPhase * 1.9) * curl * relaxed;

  // Elongation / droop
  displaced.y -= ampShape2 * 0.18 * relaxed;
  displaced.y -= sin(uTime * 3.5 + uPhase) * 0.08 * ampShape * relaxed;

  // --- Motion drag: mesh-local velocity; tips bend opposite travel (ribbon is XY, bend uses z + x) ---
  vec3 drag = -uFlowVelocity;
  float tipLag = ampShape2 * (1.0 + ampShape * 0.9);
  float dragScale = 0.58 + 0.25 * smoothstep(0.0, 2.0, flowSpd);
  displaced.x += drag.x * tipLag * dragScale;
  displaced.y += drag.y * tipLag * 0.28 * dragScale;
  displaced.z += drag.z * tipLag * 0.78 * dragScale;

  vTipFade = tipWeight;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const tendrilFrag = `
uniform float uTime;
uniform float uPhase;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vTipFade;
varying float vContraction;
void main() {
  float edge       = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  // Base glow concentrated near the bell where energy originates, fading toward tip.
  float baseGlow   = smoothstep(1.0, 0.0, vTipFade);          // bright at base
  float tipFade    = smoothstep(0.0, 0.45, 1.0 - vTipFade);   // fade at tip
  float shimmer    = 0.7 + 0.3 * sin(uTime * 3.5 + vTipFade * 8.0 + uPhase);
  float pulseBurst = 1.0 + 1.8 * vContraction; // big brightness pop on power stroke

  // Inner core line down the ribbon centre (Additive so it adds on top)
  float centreLine = 1.0 - abs(vUv.x - 0.5) * 8.0;  // bright streak along spine
  centreLine = max(centreLine, 0.0);

  vec3 col = uColor * shimmer * pulseBurst;
  col += uColor * centreLine * (0.8 + 0.6 * baseGlow) * pulseBurst; // spine highlight
  col += uColor * baseGlow   * 0.5 * pulseBurst;                     // bell-root glow halo

  float alpha = edge * tipFade * (0.35 + 0.30 * shimmer + 0.25 * centreLine) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

export interface JellyfishVisual {
  group: Group;
  bell: Mesh;
  bellMat: ShaderMaterial;
  tendrils: Mesh[];
  tendrilMats: ShaderMaterial[];
  /** Call each frame with the current time seconds. */
  setTime(t: number): void;
  setOpacity(o: number): void;
  /** World-space velocity (units/s); tendrils bend per-mesh in local space. */
  updateTendrilFlow(worldVelocity: Vector3): void;
  dispose(): void;
}

export interface JellyfishGeomCache {
  bellGeo: SphereGeometry;
  tendrilGeo: PlaneGeometry;
}

export function createJellyfishGeoms(): JellyfishGeomCache {
  // Top hemisphere only: phi from 0 to PI/2 covers the upper dome.
  // We actually want a flared bell with a rim near y=0, so use full sphere
  // cut to top half via phiLength — but SphereGeometry already supports that.
  const bellGeo = new SphereGeometry(BELL_RADIUS, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.55);
  bellGeo.translate(0, -BELL_RADIUS * 0.1, 0); // sit rim a touch below origin

  // PlaneGeometry segmented lengthwise so vertex shader has room for waves.
  // Default plane is on XY plane with +Y up — perfect, base at top, tip at bottom.
  const tendrilGeo = new PlaneGeometry(
    TENDRIL_WIDTH,
    TENDRIL_LENGTH,
    1,
    TENDRIL_LENGTH_SEGMENTS,
  );
  // Shift so base (top of plane) is at origin, tip hangs down into -Y.
  tendrilGeo.translate(0, -TENDRIL_LENGTH / 2, 0);
  return { bellGeo, tendrilGeo };
}

/**
 * Build a single jellyfish with per-instance uniforms.
 * `colorHex` is a CSS hex string like `"#ff4fb0"`.
 */
export function createJellyfish(
  geoms: JellyfishGeomCache,
  colorHex: string,
  phase: number,
): JellyfishVisual {
  _tmpColor.set(colorHex);
  const uColor = { value: _tmpColor.clone() };
  const uTime = { value: 0 };
  const uPhase = { value: phase };
  const uOpacity = { value: 1.0 };

  const bellMat = new ShaderMaterial({
    vertexShader: bellVert,
    fragmentShader: bellFrag,
    uniforms: {
      uTime,
      uPhase,
      uColor,
      uOpacity,
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  });

  const bell = new Mesh(geoms.bellGeo, bellMat);
  bell.renderOrder = 320;
  bell.frustumCulled = false; // the bell displaces and it is tiny; disable to be safe

  const group = new Group();
  group.add(bell);

  const tendrilMats: ShaderMaterial[] = [];
  const tendrils: Mesh[] = [];
  for (let i = 0; i < TENDRIL_COUNT; i++) {
    // Fan tendrils around the rim: radius at rim is slightly less than BELL_RADIUS
    const angle = (i / TENDRIL_COUNT) * Math.PI * 2;
    const rimR = BELL_RADIUS * 0.78;
    const tMat = new ShaderMaterial({
      vertexShader: tendrilVert,
      fragmentShader: tendrilFrag,
      uniforms: {
        uTime,
        uPhase: { value: phase + i * 0.73 },
        uColor,
        uOpacity,
        uFlowVelocity: { value: new Vector3() },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    const tendril = new Mesh(geoms.tendrilGeo, tMat);
    tendril.position.set(Math.cos(angle) * rimR, -BELL_RADIUS * 0.1, Math.sin(angle) * rimR);
    // Face outward by rotating the ribbon around world Y so its flat face
    // points roughly tangent to the bell — this way sway goes tangentially.
    tendril.rotation.y = angle + Math.PI * 0.5;
    tendril.renderOrder = 319;
    tendril.frustumCulled = false;
    group.add(tendril);
    tendrils.push(tendril);
    tendrilMats.push(tMat);
  }

  return {
    group,
    bell,
    bellMat,
    tendrils,
    tendrilMats,
    setTime(t: number) {
      uTime.value = t;
    },
    setOpacity(o: number) {
      uOpacity.value = o;
    },
    updateTendrilFlow(worldVelocity: Vector3) {
      group.updateMatrixWorld(true);
      for (let ti = 0; ti < tendrils.length; ti++) {
        const mesh = tendrils[ti]!;
        _flowMeshScratch.copy(worldVelocity);
        _flowInvWorld.copy(mesh.matrixWorld).invert();
        _flowMeshScratch.transformDirection(_flowInvWorld);
        (tendrilMats[ti]!.uniforms.uFlowVelocity!.value as Vector3).copy(
          _flowMeshScratch,
        );
      }
    },
    dispose() {
      bellMat.dispose();
      for (const m of tendrilMats) m.dispose();
    },
  };
}

/**
 * Dispose the shared geometries. Only call this once when the whole
 * jellyfish system is torn down.
 */
export function disposeJellyfishGeoms(geoms: JellyfishGeomCache) {
  geoms.bellGeo.dispose();
  geoms.tendrilGeo.dispose();
}

export const JELLY_BELL_RADIUS = BELL_RADIUS;
