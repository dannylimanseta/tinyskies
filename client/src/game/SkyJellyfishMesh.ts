import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
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
const BELL_RADIUS = 0.18;

const _tmpColor = new Color();

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

const bellVert = `
uniform float uTime;
uniform float uPhase;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vSkirt;
varying float vWobble;
${noiseGLSL}
void main() {
  float pulse = sin(uTime * 3.5 + uPhase); // Faster swimming pulse
  // Bell is centred at origin; +Y is the top of the dome (built from top hemisphere).
  // Normalize y from -R..+R to 0..1 where 0 = rim, 1 = top.
  float yUnit = clamp((position.y + ${BELL_RADIUS.toFixed(3)}) / (2.0 * ${BELL_RADIUS.toFixed(3)}), 0.0, 1.0);
  float skirt = smoothstep(0.8, 0.0, yUnit); // Stronger at rim
  vSkirt = skirt;

  vec3 displaced = position;

  // 1. Swimming contraction (bell squeezes in and down, then expands)
  float contract = pulse * skirt;
  displaced.xz *= 1.0 - contract * 0.2;
  displaced.y -= contract * 0.1;

  // 2. Organic wobble (position * 15.0 so noise varies across the small bell)
  float n = noise3(position * 15.0 + vec3(uTime * 1.2, uPhase, uTime * 0.8));
  float bulge = (n - 0.5) * 0.5 * skirt;
  displaced.xz *= 1.0 + bulge;

  // 3. Surface ripples
  displaced += normal * ((n - 0.5) * 0.06);

  // 4. Skirt flutter
  float flutter = sin(uTime * 5.0 + position.x * 25.0 + position.z * 25.0 + uPhase * 2.0);
  displaced.y += flutter * 0.02 * skirt;
  displaced.xz *= 1.0 + flutter * 0.015 * skirt;

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
void main() {
  float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.0);
  // Multi-layered breathing pulse — a steady slow breath plus a faster flicker.
  float slow = 0.85 + 0.6 * sin(uTime * 1.2 + uPhase);
  float fast = 0.5 + 0.5 * sin(uTime * 2.7 + uPhase * 1.4);
  float breathe = slow * (0.85 + 0.35 * fast);
  
  // Desaturate the base color slightly for a softer, less intense look
  vec3 softColor = mix(uColor, vec3(1.0), 0.4);
  
  // Strong internal emission — the bell looks like a lantern.
  vec3 core = softColor * (0.8 + 0.6 * breathe);
  vec3 inner = uColor * (0.4 + 0.3 * vWobble) * breathe;
  vec3 col = mix(inner, core, rim * 0.6);
  col += uColor * 0.35 * vSkirt * breathe;
  col += softColor * 0.35 * rim;
  
  // Lower alpha for a more translucent, glassy feel
  float alpha = clamp(0.2 + rim * 0.35, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

const tendrilVert = `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
varying float vTipFade;
${noiseGLSL}
void main() {
  vUv = uv;
  // PlaneGeometry uvs: (0,0) at the geometry's bottom, (1,1) at the top.
  // After we translate by -TENDRIL_LENGTH/2 the base ends up at world-y 0
  // (which is the geometry's TOP, uv.y = 1) and the tip hangs into -Y
  // (geometry's BOTTOM, uv.y = 0). So tipWeight = 1 - uv.y.
  float tipWeight = 1.0 - uv.y;
  // Amplitude shaped so there's almost no motion at the base and max curl near the tip.
  float ampShape = smoothstep(0.0, 1.0, tipWeight);
  float ampShape2 = ampShape * ampShape;

  vec3 displaced = position;

  // Multiple travelling sine waves at different frequencies/speeds produce
  // a "curly" ribbon rather than a pure single wave.
  float w1 = sin(uTime * 2.5 + tipWeight * 8.0  + uPhase)        * 0.25;
  float w2 = sin(uTime * 3.8 + tipWeight * 5.0  + uPhase * 1.7)  * 0.15;
  float w3 = sin(uTime * 1.9 + tipWeight * 12.0 + uPhase * 0.6)  * 0.08;
  displaced.x += (w1 + w2 + w3) * ampShape2;

  // Z-plane sway (orthogonal) with its own frequencies + noise for organic jitter.
  float z1 = sin(uTime * 2.2 + tipWeight * 7.0  + uPhase * 2.1)  * 0.20;
  float z2 = sin(uTime * 3.1 + tipWeight * 10.0 + uPhase * 0.8)  * 0.10;
  float zNoise = (noise3(vec3(tipWeight * 4.0, uTime * 0.8, uPhase)) - 0.5) * 0.20;
  displaced.z += (z1 + z2 + zNoise) * ampShape2;

  // Slight curl toward the tip — bends the ribbon in a gentle arc even at rest.
  float curl = ampShape2 * ampShape * 0.25;
  displaced.x += sin(uPhase * 2.3) * curl;
  displaced.z += cos(uPhase * 1.9) * curl;

  // Pull the tip slightly further (elongation) so motion reads as "flowing".
  displaced.y -= ampShape2 * 0.20;

  // Small time-varying stretch so tendrils appear to breathe in length too.
  displaced.y -= sin(uTime * 3.5 + uPhase) * 0.08 * ampShape;

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
void main() {
  // Fade toward tip + soft horizontal fade to hide ribbon edges
  float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  float lengthFade = smoothstep(0.0, 0.35, 1.0 - vTipFade);
  float shimmer = 0.6 + 0.4 * sin(uTime * 3.0 + vTipFade * 6.0 + uPhase);
  
  // Desaturate for a softer look
  vec3 softColor = mix(uColor, vec3(1.0), 0.4);
  vec3 col = softColor * shimmer;
  
  // Lower alpha for more translucency
  float alpha = edge * lengthFade * (0.2 + 0.25 * shimmer) * uOpacity;
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
  const tendrilGeo = new PlaneGeometry(TENDRIL_WIDTH, TENDRIL_LENGTH, 1, 32);
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
