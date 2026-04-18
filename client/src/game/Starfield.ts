import {
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  AdditiveBlending,
  Group,
  Vector3,
  Quaternion,
} from "three";

const STAR_COUNT = 6000;
const BRIGHT_STAR_COUNT = 240;
const SPHERE_RADIUS = 80;

const MILKY_STAR_COUNT = 8000;
const MILKY_CLOUD_COUNT = 1200;
const BAND_TILT = Math.PI * 0.35;

const starVert = `
attribute float aSize;
attribute float aBrightness;
varying float vBrightness;
void main() {
  vBrightness = aBrightness;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const starFrag = `
uniform float uOpacity;
varying float vBrightness;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.4, d);
  float glow = 1.0 - smoothstep(0.2, 1.0, d);
  float a = (core * 0.8 + glow * 0.3) * vBrightness * uOpacity;
  vec3 col = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 1.0, 1.0), core);
  gl_FragColor = vec4(col, a);
}
`;

const nebulaVert = `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const nebulaFrag = `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * a * vAlpha * uOpacity;
  gl_FragColor = vec4(vColor, a);
}
`;

const NEBULA_PALETTE = [
  [0.35, 0.20, 0.60],
  [0.50, 0.25, 0.70],
  [0.20, 0.25, 0.65],
  [0.65, 0.20, 0.50],
  [0.80, 0.35, 0.55],
  [0.25, 0.40, 0.75],
  [0.40, 0.55, 0.80],
  [0.70, 0.50, 0.35],
  [0.55, 0.30, 0.65],
  [0.30, 0.35, 0.80],
];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function bandPoint(rand: () => number, tiltQuat: Quaternion): Vector3 {
  const phi = rand() * Math.PI * 2;
  const spread = (rand() - 0.5) * 0.45;
  const theta = Math.PI * 0.5 + spread;
  const v = new Vector3(
    SPHERE_RADIUS * Math.sin(theta) * Math.cos(phi),
    SPHERE_RADIUS * Math.cos(theta),
    SPHERE_RADIUS * Math.sin(theta) * Math.sin(phi),
  );
  v.applyQuaternion(tiltQuat);
  return v;
}

export class Starfield {
  readonly group: Group;
  private materials: ShaderMaterial[] = [];
  private opacityUniform = { value: 1.0 };

  constructor() {
    this.group = new Group();
    const rand = seededRandom(9999);

    this.group.add(this.buildStars(rand));

    const tiltQuat = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0.3).normalize(),
      BAND_TILT,
    );
    this.group.add(this.buildMilkyStars(rand, tiltQuat));
    this.group.add(this.buildNebulaClouds(rand, tiltQuat));
  }

  private buildStars(rand: () => number): Points {
    const totalStars = STAR_COUNT + BRIGHT_STAR_COUNT;
    const positions = new Float32Array(totalStars * 3);
    const sizes = new Float32Array(totalStars);
    const brightnesses = new Float32Array(totalStars);

    for (let i = 0; i < totalStars; i++) {
      const theta = Math.acos(2 * rand() - 1);
      const phi = 2 * Math.PI * rand();

      positions[i * 3] = SPHERE_RADIUS * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = SPHERE_RADIUS * Math.sin(theta) * Math.sin(phi);
      positions[i * 3 + 2] = SPHERE_RADIUS * Math.cos(theta);

      const isBright = i >= STAR_COUNT;
      if (isBright) {
        sizes[i] = 1.5 + rand() * 3.0;
        brightnesses[i] = 0.7 + rand() * 0.3;
      } else {
        sizes[i] = 0.3 + rand() * 1.2;
        brightnesses[i] = 0.15 + rand() * 0.45;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
    geo.setAttribute("aBrightness", new Float32BufferAttribute(brightnesses, 1));

    const mat = new ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: { uOpacity: this.opacityUniform },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.materials.push(mat);

    const pts = new Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private buildMilkyStars(rand: () => number, tiltQuat: Quaternion): Points {
    const positions = new Float32Array(MILKY_STAR_COUNT * 3);
    const sizes = new Float32Array(MILKY_STAR_COUNT);
    const brightnesses = new Float32Array(MILKY_STAR_COUNT);

    for (let i = 0; i < MILKY_STAR_COUNT; i++) {
      const v = bandPoint(rand, tiltQuat);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      sizes[i] = 0.2 + rand() * 0.8;
      brightnesses[i] = 0.2 + rand() * 0.5;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
    geo.setAttribute("aBrightness", new Float32BufferAttribute(brightnesses, 1));

    const mat = new ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: { uOpacity: this.opacityUniform },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.materials.push(mat);

    const pts = new Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private buildNebulaClouds(rand: () => number, tiltQuat: Quaternion): Points {
    const positions = new Float32Array(MILKY_CLOUD_COUNT * 3);
    const sizes = new Float32Array(MILKY_CLOUD_COUNT);
    const colors = new Float32Array(MILKY_CLOUD_COUNT * 3);
    const alphas = new Float32Array(MILKY_CLOUD_COUNT);

    for (let i = 0; i < MILKY_CLOUD_COUNT; i++) {
      const v = bandPoint(rand, tiltQuat);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;

      const sizeRoll = rand();
      sizes[i] = sizeRoll < 0.4
        ? 3 + rand() * 8
        : sizeRoll < 0.75
          ? 12 + rand() * 20
          : 30 + rand() * 45;

      const pal = NEBULA_PALETTE[Math.floor(rand() * NEBULA_PALETTE.length)];
      const brighten = 0.8 + rand() * 0.4;
      colors[i * 3] = pal[0] * brighten;
      colors[i * 3 + 1] = pal[1] * brighten;
      colors[i * 3 + 2] = pal[2] * brighten;

      alphas[i] = 0.04 + rand() * 0.10;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
    geo.setAttribute("aColor", new Float32BufferAttribute(colors, 3));
    geo.setAttribute("aAlpha", new Float32BufferAttribute(alphas, 1));

    const mat = new ShaderMaterial({
      vertexShader: nebulaVert,
      fragmentShader: nebulaFrag,
      uniforms: { uOpacity: this.opacityUniform },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.materials.push(mat);

    const pts = new Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  setOpacity(weight: number) {
    this.opacityUniform.value = weight;
  }

  dispose() {
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
    });
    for (const mat of this.materials) mat.dispose();
  }
}
