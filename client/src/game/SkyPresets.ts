import type { TimeOfDay } from "@globefly/shared";

export interface SkyPreset {
  skyGradient: { stop: number; color: string }[];
  fogColor: number;
  fogNear: number;
  fogFar: number;

  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;

  ambientColor: number;
  ambientIntensity: number;

  sunColor: number;
  sunIntensity: number;
  sun2Color: number;
  sun2Intensity: number;

  fillColor: number;
  fillIntensity: number;
  fill2Color: number;
  fill2Intensity: number;

  backColor: number;
  backIntensity: number;

  oceanShallow: number;
  oceanDeep: number;
  oceanFoam: number;

  rimColor: number;
  cloudOpacity: number;

  atmosphereGlow: number;
  flareColorScale: [number, number, number];
  stars: boolean;
  aurora: boolean;
}

const DAY_PRESET: SkyPreset = {
  /** Zenith → horizon (see Game.paintRadialSky): blue aloft, cyan mid, wide yellow band at horizon. */
  skyGradient: [
    { stop: 0.0, color: "#1a4a82" },
    { stop: 0.12, color: "#1e5c90" },
    { stop: 0.26, color: "#2a8cb4" },
    { stop: 0.4, color: "#40c8dc" },
    { stop: 0.52, color: "#60d8e8" },
    { stop: 0.62, color: "#80e8f4" },
    { stop: 0.72, color: "#b8f4f0" },
    { stop: 0.78, color: "#e0f0d0" },
    { stop: 0.84, color: "#f2eca8" },
    { stop: 0.91, color: "#fff078" },
    { stop: 1.0, color: "#fff050" },
  ],
  fogColor: 0x60ccde,
  fogNear: 15,
  fogFar: 40,

  hemiSkyColor: 0x80ccdd,
  hemiGroundColor: 0x66aa44,
  hemiIntensity: 1.75,

  ambientColor: 0xffffff,
  ambientIntensity: 1.25,

  sunColor: 0xfff0d0,
  sunIntensity: 5.0,
  sun2Color: 0xfff0d0,
  sun2Intensity: 3.25,

  fillColor: 0x90bbcc,
  fillIntensity: 1.75,
  fill2Color: 0x90bbcc,
  fill2Intensity: 1.5,

  backColor: 0xaaddee,
  backIntensity: 1.5,

  oceanShallow: 0x2a8ca0,
  oceanDeep: 0x1560a0,
  oceanFoam: 0xb3ffff,

  rimColor: 0xffeebb,
  cloudOpacity: 0.2,

  atmosphereGlow: 0xbbddcc,
  flareColorScale: [1.0, 1.0, 1.0],
  stars: false,
  aurora: false,
};

const EVENING_PRESET: SkyPreset = {
  skyGradient: [
    { stop: 0.0, color: "#0e0a2a" },
    { stop: 0.15, color: "#1a1050" },
    { stop: 0.3, color: "#4a2078" },
    { stop: 0.45, color: "#a03060" },
    { stop: 0.55, color: "#cc4840" },
    { stop: 0.65, color: "#e07828" },
    { stop: 0.75, color: "#f0a030" },
    { stop: 0.85, color: "#f8c858" },
    { stop: 1.0, color: "#fce0a0" },
  ],
  fogColor: 0xc07848,
  fogNear: 12,
  fogFar: 35,

  hemiSkyColor: 0xff9944,
  hemiGroundColor: 0x554422,
  hemiIntensity: 0.94,

  ambientColor: 0xffd8a0,
  ambientIntensity: 0.44,

  sunColor: 0xffaa40,
  sunIntensity: 3.5,
  sun2Color: 0xaa6640,
  sun2Intensity: 1.0,

  fillColor: 0xcc8855,
  fillIntensity: 0.875,
  fill2Color: 0x886644,
  fill2Intensity: 0.5,

  backColor: 0xaa7766,
  backIntensity: 0.625,

  oceanShallow: 0x5a4a98,
  oceanDeep: 0x302868,
  oceanFoam: 0xff9944,

  rimColor: 0xffaa30,
  cloudOpacity: 0.2,

  atmosphereGlow: 0xffcc44,
  flareColorScale: [1.0, 0.75, 0.4],
  stars: false,
  aurora: false,
};

const NIGHT_PRESET: SkyPreset = {
  /** Zenith → horizon: deep blue into purple / violet (flipped vs earlier; radial in Game.paintRadialSky). */
  skyGradient: [
    { stop: 0.0, color: "#020818" },
    { stop: 0.12, color: "#050f22" },
    { stop: 0.25, color: "#08142a" },
    { stop: 0.38, color: "#0c1834" },
    { stop: 0.5, color: "#121a3c" },
    { stop: 0.62, color: "#241858" },
    { stop: 0.74, color: "#321c70" },
    { stop: 0.86, color: "#4428a0" },
    { stop: 1.0, color: "#5a34c8" },
  ],
  fogColor: 0x08142c,
  fogNear: 10,
  fogFar: 30,

  hemiSkyColor: 0x283c80,
  hemiGroundColor: 0x10202c,
  hemiIntensity: 0.625,

  ambientColor: 0x7088bb,
  ambientIntensity: 0.375,

  sunColor: 0x102060,
  sunIntensity: 1.25,
  sun2Color: 0x0c1848,
  sun2Intensity: 0.625,

  fillColor: 0x304880,
  fillIntensity: 0.625,
  fill2Color: 0x283868,
  fill2Intensity: 0.44,

  backColor: 0x303860,
  backIntensity: 0.5,

  oceanShallow: 0x081838,
  oceanDeep: 0x040c20,
  oceanFoam: 0x2050aa,

  /** Matches night sky purple; drives `globalRimColor` + globe rim. */
  rimColor: 0x9a7af0,
  cloudOpacity: 0.06,

  atmosphereGlow: 0x2850aa,
  flareColorScale: [0.3, 0.4, 0.8],
  stars: true,
  aurora: true,
};

const SKY_PRESETS: Record<TimeOfDay, SkyPreset> = {
  day: DAY_PRESET,
  evening: EVENING_PRESET,
  night: NIGHT_PRESET,
};

export function getSkyPreset(time: TimeOfDay): SkyPreset {
  return SKY_PRESETS[time] ?? DAY_PRESET;
}
