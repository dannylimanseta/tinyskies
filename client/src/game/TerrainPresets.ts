export interface TerrainParams {
  scale: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  threshold: number;
}

const TERRAIN_PRESETS: Record<string, TerrainParams> = {
  default: {
    scale: 1.5,
    octaves: 4,
    lacunarity: 2.05,
    persistence: 0.48,
    threshold: 0.0,
  },
  archipelago: {
    scale: 3.0,
    octaves: 4,
    lacunarity: 2.2,
    persistence: 0.45,
    threshold: 0.2,
  },
  pangaea: {
    scale: 0.8,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.54,
    threshold: -0.15,
  },
  waterworld: {
    scale: 2.5,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.4,
    threshold: 0.35,
  },
};

export function getTerrainParams(terrainType: string): TerrainParams {
  return TERRAIN_PRESETS[terrainType] ?? TERRAIN_PRESETS.default;
}
