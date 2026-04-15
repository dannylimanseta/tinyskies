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
  skyGradient: [
    { stop: 0.0, color: "#1a4a82" },
    { stop: 0.1, color: "#266498" },
    { stop: 0.2, color: "#2080b0" },
    { stop: 0.3, color: "#209cc8" },
    { stop: 0.4, color: "#28b8dc" },
    { stop: 0.5, color: "#38d0ea" },
    { stop: 0.6, color: "#50e4f4" },
    { stop: 0.7, color: "#70f2fc" },
    { stop: 0.8, color: "#8cf7ff" },
    { stop: 0.9, color: "#a8fbff" },
    { stop: 1.0, color: "#c4fdff" },
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
  skyGradient: [
    { stop: 0.0, color: "#02030c" },
    { stop: 0.15, color: "#050a1e" },
    { stop: 0.3, color: "#081032" },
    { stop: 0.45, color: "#0c1846" },
    { stop: 0.55, color: "#101e58" },
    { stop: 0.65, color: "#142668" },
    { stop: 0.75, color: "#182e74" },
    { stop: 0.85, color: "#1c3684" },
    { stop: 1.0, color: "#203c94" },
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

  rimColor: 0x3070ff,
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
