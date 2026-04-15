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

import { getTerrainParams, type TerrainParams } from "./TerrainPresets";

interface TerrainVector {
  x: number;
  y: number;
  z: number;
}

interface TerrainFieldValue {
  params: TerrainParams;
  rawValue: number;
  value: number;
}

interface OceanRegionCacheEntry {
  width: number;
  height: number;
  mainOceanId: number;
  componentByCell: Int32Array;
}

export interface TerrainSample {
  rawValue: number;
  value: number;
  isLand: boolean;
  elevation: number;
  waterDepth: number;
}

const terrainNoiseBySeed = new Map<number, Noise3DFn>();
const backboneAxesBySeed = new Map<number, readonly TerrainVector[]>();
const oceanRegionCache = new Map<string, OceanRegionCacheEntry>();

function cachedNoise3D(seed: number): Noise3DFn {
  let noise = terrainNoiseBySeed.get(seed);
  if (!noise) {
    noise = createNoise3D(seed);
    terrainNoiseBySeed.set(seed, noise);
  }
  return noise;
}

function seededRandom(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function smoothstep(min: number, max: number, x: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

function dotVector(ax: number, ay: number, az: number, b: TerrainVector): number {
  return ax * b.x + ay * b.y + az * b.z;
}

function crossVector(a: TerrainVector, b: TerrainVector): TerrainVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVector(v: TerrainVector): TerrainVector {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return {
    x: v.x / len,
    y: v.y / len,
    z: v.z / len,
  };
}

function randomUnitVector(rand: () => number): TerrainVector {
  const z = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return {
    x: Math.cos(theta) * r,
    y: z,
    z: Math.sin(theta) * r,
  };
}

function backboneAxesForSeed(seed: number): readonly TerrainVector[] {
  let axes = backboneAxesBySeed.get(seed);
  if (axes) return axes;

  const rand = seededRandom((seed ^ 0x9e3779b9) >>> 0);
  const axisA = randomUnitVector(rand);
  let helper = randomUnitVector(rand);
  if (Math.abs(dotVector(axisA.x, axisA.y, axisA.z, helper)) > 0.92) {
    helper = Math.abs(axisA.y) < 0.9
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };
  }

  let axisPerp = crossVector(axisA, helper);
  if (axisPerp.x === 0 && axisPerp.y === 0 && axisPerp.z === 0) {
    axisPerp = crossVector(axisA, { x: 0, y: 1, z: 0 });
  }
  axisPerp = normalizeVector(axisPerp);

  const spread = 0.95 + rand() * 0.45;
  const spreadSin = Math.sin(spread);
  const spreadCos = Math.cos(spread);
  const axisB = normalizeVector({
    x: axisA.x * spreadCos + axisPerp.x * spreadSin,
    y: axisA.y * spreadCos + axisPerp.y * spreadSin,
    z: axisA.z * spreadCos + axisPerp.z * spreadSin,
  });
  const axisC = normalizeVector({
    x: axisA.x * spreadCos - axisPerp.x * spreadSin,
    y: axisA.y * spreadCos - axisPerp.y * spreadSin,
    z: axisA.z * spreadCos - axisPerp.z * spreadSin,
  });

  axes = [axisA, axisB, axisC];
  backboneAxesBySeed.set(seed, axes);
  return axes;
}

function oceanBackboneMask(
  seed: number,
  params: TerrainParams,
  nx: number,
  ny: number,
  nz: number,
): number {
  if (params.oceanBackboneStrength <= 0 || params.oceanBackboneWidth <= 0) {
    return 0;
  }

  const innerWidth = params.oceanBackboneWidth;
  const outerWidth = innerWidth * 1.9;
  let mask = 0;
  for (const axis of backboneAxesForSeed(seed)) {
    const dist = Math.abs(dotVector(nx, ny, nz, axis));
    const band = 1 - smoothstep(innerWidth, outerWidth, dist);
    if (band > mask) mask = band;
  }
  return mask;
}

function sampleTerrainFieldValue(
  seed: number,
  terrainType: string,
  nx: number,
  ny: number,
  nz: number,
): TerrainFieldValue {
  const params = getTerrainParams(terrainType);
  const rawValue = terrainNoise(
    cachedNoise3D(seed),
    nx,
    ny,
    nz,
    params.octaves,
    params.lacunarity,
    params.persistence,
    params.scale,
  );
  const value = rawValue - oceanBackboneMask(seed, params, nx, ny, nz) * params.oceanBackboneStrength;
  return { params, rawValue, value };
}

export function terrainIsLand(terrainType: string, value: number): boolean {
  return value > getTerrainParams(terrainType).threshold;
}

export function terrainElevationFromValue(terrainType: string, value: number): number {
  const params = getTerrainParams(terrainType);
  if (value <= params.threshold) return 0;
  return (value - params.threshold) / (1 - params.threshold);
}

export function terrainWaterDepthFromValue(terrainType: string, value: number): number {
  const params = getTerrainParams(terrainType);
  if (value > params.threshold) return 0;
  return Math.min(1, (params.threshold - value) * 4);
}

export function sampleTerrainValue(
  seed: number,
  terrainType: string,
  nx: number,
  ny: number,
  nz: number,
): number {
  return sampleTerrainFieldValue(seed, terrainType, nx, ny, nz).value;
}

export function sampleTerrain(
  seed: number,
  terrainType: string,
  nx: number,
  ny: number,
  nz: number,
): TerrainSample {
  const sampled = sampleTerrainFieldValue(seed, terrainType, nx, ny, nz);
  return {
    rawValue: sampled.rawValue,
    value: sampled.value,
    isLand: sampled.value > sampled.params.threshold,
    elevation: terrainElevationFromValue(terrainType, sampled.value),
    waterDepth: terrainWaterDepthFromValue(terrainType, sampled.value),
  };
}

function oceanRegionCacheKey(seed: number, terrainType: string): string {
  return `${seed}:${terrainType}`;
}

function indexForOceanGrid(x: number, y: number, width: number): number {
  return y * width + x;
}

function oceanRegionFor(seed: number, terrainType: string): OceanRegionCacheEntry {
  const key = oceanRegionCacheKey(seed, terrainType);
  const cached = oceanRegionCache.get(key);
  if (cached) return cached;

  const width = 96;
  const height = 48;
  const ocean = new Uint8Array(width * height);
  const componentByCell = new Int32Array(width * height);
  componentByCell.fill(-1);

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const theta = u * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);
      if (!sampleTerrain(seed, terrainType, nx, ny, nz).isLand) {
        ocean[indexForOceanGrid(x, y, width)] = 1;
      }
    }
  }

  let nextComponentId = 0;
  let mainOceanId = -1;
  let mainOceanSize = -1;
  const queue: number[] = [];

  for (let start = 0; start < ocean.length; start++) {
    if (!ocean[start] || componentByCell[start] !== -1) continue;

    componentByCell[start] = nextComponentId;
    queue.push(start);
    let size = 0;

    while (queue.length) {
      const current = queue.pop()!;
      size++;
      const cx = current % width;
      const cy = Math.floor(current / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = (cx + dx + width) % width;
        const ny = cy + dy;
        if (ny < 0 || ny >= height) continue;
        const next = indexForOceanGrid(nx, ny, width);
        if (!ocean[next] || componentByCell[next] !== -1) continue;
        componentByCell[next] = nextComponentId;
        queue.push(next);
      }
    }

    if (size > mainOceanSize) {
      mainOceanSize = size;
      mainOceanId = nextComponentId;
    }
    nextComponentId++;
  }

  const built = { width, height, mainOceanId, componentByCell };
  oceanRegionCache.set(key, built);
  return built;
}

export function isMainOcean(
  seed: number,
  terrainType: string,
  nx: number,
  ny: number,
  nz: number,
): boolean {
  if (isLand(seed, terrainType, nx, ny, nz)) return false;

  const region = oceanRegionFor(seed, terrainType);
  if (region.mainOceanId < 0) return false;

  const theta = (Math.atan2(nz, nx) + Math.PI * 2) % (Math.PI * 2);
  const x = Math.min(
    region.width - 1,
    Math.floor((theta / (Math.PI * 2)) * region.width),
  );
  const y = Math.min(
    region.height - 1,
    Math.floor((Math.acos(Math.max(-1, Math.min(1, ny))) / Math.PI) * region.height),
  );
  const idx = indexForOceanGrid(x, y, region.width);
  if (region.componentByCell[idx] === region.mainOceanId) {
    return true;
  }

  for (let oy = -1; oy <= 1; oy++) {
    const sy = y + oy;
    if (sy < 0 || sy >= region.height) continue;
    for (let ox = -1; ox <= 1; ox++) {
      const sx = (x + ox + region.width) % region.width;
      const sIdx = indexForOceanGrid(sx, sy, region.width);
      if (region.componentByCell[sIdx] === region.mainOceanId) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Reusable helper: returns true if the point on the unit sphere is land.
 */
export function isLand(
  seed: number,
  terrainType: string,
  nx: number, ny: number, nz: number,
): boolean {
  return terrainIsLand(terrainType, sampleTerrainValue(seed, terrainType, nx, ny, nz));
}
