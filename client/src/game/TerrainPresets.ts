export interface TerrainParams {
  scale: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  threshold: number;
  oceanBackboneWidth: number;
  oceanBackboneStrength: number;
}

const TERRAIN_PRESETS: Record<string, TerrainParams> = {
  default: {
    scale: 1.5,
    octaves: 4,
    lacunarity: 2.05,
    persistence: 0.48,
    threshold: 0.0,
    oceanBackboneWidth: 0.10,
    oceanBackboneStrength: 0.22,
  },
  archipelago: {
    scale: 3.0,
    octaves: 4,
    lacunarity: 2.2,
    persistence: 0.45,
    threshold: 0.2,
    oceanBackboneWidth: 0.09,
    oceanBackboneStrength: 0.14,
  },
  pangaea: {
    scale: 0.8,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.54,
    threshold: -0.15,
    oceanBackboneWidth: 0.16,
    oceanBackboneStrength: 0.26,
  },
  waterworld: {
    scale: 2.5,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.4,
    threshold: 0.35,
    oceanBackboneWidth: 0.08,
    oceanBackboneStrength: 0.08,
  },
};

export function getTerrainParams(terrainType: string): TerrainParams {
  return TERRAIN_PRESETS[terrainType] ?? TERRAIN_PRESETS.default;
}
