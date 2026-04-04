/**
 * Single source of truth for radial surface displacement vs the base sphere radius.
 * Must match Globe mesh vertices and boat / prop placement.
 */
import { MathUtils } from "three";
import { createNoise3D, terrainNoise } from "./SimplexNoise";
import { getTerrainParams } from "./TerrainPresets";

export const MOUNTAIN_HEIGHT = 0.52;

/** `createNoise3D` is expensive to construct — cache (Globe calls displacement ~260k× per load). */
const noiseFnBySeed = new Map<number, ReturnType<typeof createNoise3D>>();
function noiseForSeed(seed: number): ReturnType<typeof createNoise3D> {
  let n = noiseFnBySeed.get(seed);
  if (!n) {
    n = createNoise3D(seed);
    noiseFnBySeed.set(seed, n);
  }
  return n;
}
export const PROP_TERRAIN_SINK = 0.018;

const LAND_HEIGHT = 0.02;
const OCEAN_DEPTH = 0.01;

function landDisplacement(
  nx: number,
  ny: number,
  nz: number,
  elevation: number,
  ruggedNoise: ReturnType<typeof createNoise3D>,
): number {
  const rugged = terrainNoise(
    ruggedNoise,
    nx,
    ny,
    nz,
    5,
    2.2,
    0.5,
    7.0,
  );
  const r01 = (rugged + 1) * 0.5;
  const peakMask = Math.pow(
    MathUtils.smoothstep(0.52, 0.86, elevation),
    1.35,
  );
  const jagged = 1 + 0.38 * Math.pow(r01, 1.2) * peakMask;
  const micro = 0.06 * rugged * elevation * peakMask;
  return LAND_HEIGHT + elevation * MOUNTAIN_HEIGHT * jagged + micro;
}

/**
 * Radial displacement from undeformed globe radius (same as vertex displacement in Globe.createSurface).
 * Alias: `surfaceAltitudeAt` — same value used as player `altitude` offset from base sphere.
 */
export function surfaceDisplacementAt(
  seed: number,
  terrainType: string,
  nx: number,
  ny: number,
  nz: number,
): number {
  const noise = noiseForSeed(seed);
  const ruggedNoise = noiseForSeed(seed + 9001);
  const params = getTerrainParams(terrainType);
  const value = terrainNoise(
    noise,
    nx,
    ny,
    nz,
    params.octaves,
    params.lacunarity,
    params.persistence,
    params.scale,
  );
  if (value > params.threshold) {
    const elevation = (value - params.threshold) / (1 - params.threshold);
    return landDisplacement(nx, ny, nz, elevation, ruggedNoise);
  }
  const depth = Math.min(1, (params.threshold - value) * 4);
  return -OCEAN_DEPTH * depth;
}

/**
 * Same displacement as {@link surfaceDisplacementAt} but reuses an already-sampled terrain value
 * (avoids a second `terrainNoise` eval per vertex in Globe).
 */
export function surfaceDisplacementFromValue(
  seed: number,
  terrainType: string,
  nx: number,
  ny: number,
  nz: number,
  value: number,
): number {
  const ruggedNoise = noiseForSeed(seed + 9001);
  const params = getTerrainParams(terrainType);
  if (value > params.threshold) {
    const elevation = (value - params.threshold) / (1 - params.threshold);
    return landDisplacement(nx, ny, nz, elevation, ruggedNoise);
  }
  const depth = Math.min(1, (params.threshold - value) * 4);
  return -OCEAN_DEPTH * depth;
}

export const surfaceAltitudeAt = surfaceDisplacementAt;
