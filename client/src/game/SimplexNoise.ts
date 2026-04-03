/**
 * Seeded 3D simplex noise — public domain algorithm (Stefan Gustavson).
 * Self-contained, no dependencies.
 */

const GRAD3: [number, number, number][] = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

const F3 = 1 / 3;
const G3 = 1 / 6;

function buildPermutation(seed: number): Uint8Array {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

export type Noise3DFn = (x: number, y: number, z: number) => number;

export function createNoise3D(seed: number): Noise3DFn {
  const perm = buildPermutation(seed);

  return (x: number, y: number, z: number): number => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;

    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;

    if (x0 >= y0) {
      if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
      else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
      else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
    } else {
      if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
      else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
      else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n = 0;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 > 0) {
      t0 *= t0;
      const g = GRAD3[perm[ii + perm[jj + perm[kk]]] % 12];
      n += t0 * t0 * (g[0]*x0 + g[1]*y0 + g[2]*z0);
    }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 > 0) {
      t1 *= t1;
      const g = GRAD3[perm[ii+i1 + perm[jj+j1 + perm[kk+k1]]] % 12];
      n += t1 * t1 * (g[0]*x1 + g[1]*y1 + g[2]*z1);
    }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 > 0) {
      t2 *= t2;
      const g = GRAD3[perm[ii+i2 + perm[jj+j2 + perm[kk+k2]]] % 12];
      n += t2 * t2 * (g[0]*x2 + g[1]*y2 + g[2]*z2);
    }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 > 0) {
      t3 *= t3;
      const g = GRAD3[perm[ii+1 + perm[jj+1 + perm[kk+1]]] % 12];
      n += t3 * t3 * (g[0]*x3 + g[1]*y3 + g[2]*z3);
    }

    return 32 * n;
  };
}

export function terrainNoise(
  noise: Noise3DFn,
  x: number, y: number, z: number,
  octaves: number,
  lacunarity: number,
  persistence: number,
  scale: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = scale;
  let maxAmplitude = 0;

  for (let o = 0; o < octaves; o++) {
    value += noise(x * frequency, y * frequency, z * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxAmplitude;
}

import { getTerrainParams } from "./TerrainPresets";

let cachedSeed: number | null = null;
let cachedType: string | null = null;
let cachedNoise: Noise3DFn | null = null;

/**
 * Reusable helper: returns true if the point on the unit sphere is land.
 * Caches the noise function for repeated calls with the same seed/type.
 */
export function isLand(
  seed: number,
  terrainType: string,
  nx: number, ny: number, nz: number,
): boolean {
  if (cachedSeed !== seed || cachedType !== terrainType) {
    cachedNoise = createNoise3D(seed);
    cachedSeed = seed;
    cachedType = terrainType;
  }
  const params = getTerrainParams(terrainType);
  const value = terrainNoise(
    cachedNoise!, nx, ny, nz,
    params.octaves, params.lacunarity, params.persistence, params.scale,
  );
  return value > params.threshold;
}
