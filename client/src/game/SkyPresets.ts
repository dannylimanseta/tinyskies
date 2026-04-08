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
    { stop: 0.0, color: "#0a1e4a" },
    { stop: 0.1, color: "#12306e" },
    { stop: 0.2, color: "#1c4a90" },
    { stop: 0.3, color: "#2866b0" },
    { stop: 0.4, color: "#3580cc" },
    { stop: 0.5, color: "#4898dc" },
    { stop: 0.6, color: "#60b0ea" },
    { stop: 0.7, color: "#78c4f2" },
    { stop: 0.8, color: "#90d4f8" },
    { stop: 0.9, color: "#a8e0fc" },
    { stop: 1.0, color: "#c0ecff" },
  ],
  fogColor: 0xa0d8f0,
  fogNear: 15,
  fogFar: 40,

  hemiSkyColor: 0x99ccff,
  hemiGroundColor: 0x66aa44,
  hemiIntensity: 1.0,

  ambientColor: 0xffffff,
  ambientIntensity: 0.6,

  sunColor: 0xfff0d0,
  sunIntensity: 3.0,
  sun2Color: 0xfff0d0,
  sun2Intensity: 2.0,

  fillColor: 0xaabbdd,
  fillIntensity: 1.0,
  fill2Color: 0xaabbdd,
  fill2Intensity: 0.8,

  backColor: 0xccddee,
  backIntensity: 0.8,

  oceanShallow: 0x2a8ca0,
  oceanDeep: 0x1560a0,
  oceanFoam: 0xb3ffff,

  rimColor: 0xffeebb,
  cloudOpacity: 0.2,

  atmosphereGlow: 0xeeddbb,
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
  hemiIntensity: 0.75,

  ambientColor: 0xffd8a0,
  ambientIntensity: 0.35,

  sunColor: 0xffaa40,
  sunIntensity: 2.8,
  sun2Color: 0xaa6640,
  sun2Intensity: 0.8,

  fillColor: 0xcc8855,
  fillIntensity: 0.7,
  fill2Color: 0x886644,
  fill2Intensity: 0.4,

  backColor: 0xaa7766,
  backIntensity: 0.5,

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
    { stop: 0.0, color: "#020408" },
    { stop: 0.15, color: "#06081a" },
    { stop: 0.3, color: "#0a1028" },
    { stop: 0.45, color: "#0e1838" },
    { stop: 0.55, color: "#101c44" },
    { stop: 0.65, color: "#122050" },
    { stop: 0.75, color: "#16285a" },
    { stop: 0.85, color: "#1a3068" },
    { stop: 1.0, color: "#1e3878" },
  ],
  fogColor: 0x081828,
  fogNear: 10,
  fogFar: 30,

  hemiSkyColor: 0x334477,
  hemiGroundColor: 0x1a2a30,
  hemiIntensity: 0.5,

  ambientColor: 0x99aadd,
  ambientIntensity: 0.3,

  sunColor: 0x1a2a6e,
  sunIntensity: 1.0,
  sun2Color: 0x152255,
  sun2Intensity: 0.5,

  fillColor: 0x556699,
  fillIntensity: 0.5,
  fill2Color: 0x445577,
  fill2Intensity: 0.35,

  backColor: 0x556677,
  backIntensity: 0.4,

  oceanShallow: 0x0c1a30,
  oceanDeep: 0x060e1e,
  oceanFoam: 0x3366aa,

  rimColor: 0x4488ff,
  cloudOpacity: 0.06,

  atmosphereGlow: 0x3366dd,
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
