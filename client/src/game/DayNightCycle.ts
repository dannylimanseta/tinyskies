import { Color } from "three";
import { getSkyPreset, type SkyPreset } from "./SkyPresets";

/*
 * Cycle layout (total = 195 seconds):
 *
 *   0 –  60s  Day          (60s)
 *  60 –  75s  Day→Evening  (15s transition)
 *  75 – 105s  Evening      (30s)
 * 105 – 120s  Evening→Night(15s transition)
 * 120 – 180s  Night         (60s)
 * 180 – 195s  Night→Day    (15s transition)
 */
const TOTAL_CYCLE = 195;

interface PhaseSegment {
  end: number;
  from: SkyPreset;
  to: SkyPreset;
  transition: boolean;
}

const DAY = getSkyPreset("day");
const EVENING = getSkyPreset("evening");
const NIGHT = getSkyPreset("night");

const SEGMENTS: PhaseSegment[] = [
  { end: 60,  from: DAY,     to: DAY,     transition: false },
  { end: 75,  from: DAY,     to: EVENING, transition: true },
  { end: 105, from: EVENING, to: EVENING, transition: false },
  { end: 120, from: EVENING, to: NIGHT,   transition: true },
  { end: 180, from: NIGHT,   to: NIGHT,   transition: false },
  { end: 195, from: NIGHT,   to: DAY,     transition: true },
];

const _ca = new Color();
const _cb = new Color();

function lerpColor(a: number, b: number, t: number): number {
  _ca.set(a);
  _cb.set(b);
  _ca.lerp(_cb, t);
  return _ca.getHex();
}

function lerpColorStr(a: string, b: string, t: number): string {
  _ca.set(a);
  _cb.set(b);
  _ca.lerp(_cb, t);
  return "#" + _ca.getHexString();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blendPresets(from: SkyPreset, to: SkyPreset, t: number): SkyPreset {
  const maxStops = Math.max(from.skyGradient.length, to.skyGradient.length);
  const skyGradient: { stop: number; color: string }[] = [];
  for (let i = 0; i < maxStops; i++) {
    const a = from.skyGradient[Math.min(i, from.skyGradient.length - 1)];
    const b = to.skyGradient[Math.min(i, to.skyGradient.length - 1)];
    skyGradient.push({
      stop: lerp(a.stop, b.stop, t),
      color: lerpColorStr(a.color, b.color, t),
    });
  }

  return {
    skyGradient,
    fogColor: lerpColor(from.fogColor, to.fogColor, t),
    fogNear: lerp(from.fogNear, to.fogNear, t),
    fogFar: lerp(from.fogFar, to.fogFar, t),

    hemiSkyColor: lerpColor(from.hemiSkyColor, to.hemiSkyColor, t),
    hemiGroundColor: lerpColor(from.hemiGroundColor, to.hemiGroundColor, t),
    hemiIntensity: lerp(from.hemiIntensity, to.hemiIntensity, t),

    ambientColor: lerpColor(from.ambientColor, to.ambientColor, t),
    ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity, t),

    sunColor: lerpColor(from.sunColor, to.sunColor, t),
    sunIntensity: lerp(from.sunIntensity, to.sunIntensity, t),
    sun2Color: lerpColor(from.sun2Color, to.sun2Color, t),
    sun2Intensity: lerp(from.sun2Intensity, to.sun2Intensity, t),

    fillColor: lerpColor(from.fillColor, to.fillColor, t),
    fillIntensity: lerp(from.fillIntensity, to.fillIntensity, t),
    fill2Color: lerpColor(from.fill2Color, to.fill2Color, t),
    fill2Intensity: lerp(from.fill2Intensity, to.fill2Intensity, t),

    backColor: lerpColor(from.backColor, to.backColor, t),
    backIntensity: lerp(from.backIntensity, to.backIntensity, t),

    oceanShallow: lerpColor(from.oceanShallow, to.oceanShallow, t),
    oceanDeep: lerpColor(from.oceanDeep, to.oceanDeep, t),
    oceanFoam: lerpColor(from.oceanFoam, to.oceanFoam, t),

    rimColor: lerpColor(from.rimColor, to.rimColor, t),
    cloudOpacity: lerp(from.cloudOpacity, to.cloudOpacity, t),

    atmosphereGlow: lerpColor(from.atmosphereGlow, to.atmosphereGlow, t),
    flareColorScale: [
      lerp(from.flareColorScale[0], to.flareColorScale[0], t),
      lerp(from.flareColorScale[1], to.flareColorScale[1], t),
      lerp(from.flareColorScale[2], to.flareColorScale[2], t),
    ],
    stars: t < 0.5 ? from.stars : to.stars,
    aurora: t < 0.5 ? from.aurora : to.aurora,
  };
}

export class DayNightCycle {
  private worldSeed: number;
  moonProgress = 0;

  constructor(worldSeed: number) {
    this.worldSeed = worldSeed;
  }

  /** Uses wall-clock time + world seed offset so all clients stay in sync. */
  private getCycleTime(): number {
    const offsetSec = (this.worldSeed % TOTAL_CYCLE);
    const now = Date.now() / 1000;
    return ((now + offsetSec) % TOTAL_CYCLE + TOTAL_CYCLE) % TOTAL_CYCLE;
  }

  getPreset(): SkyPreset {
    const time = this.getCycleTime();
    let segStart = 0;
    let base: SkyPreset = DAY;
    for (const seg of SEGMENTS) {
      if (time < seg.end) {
        if (!seg.transition) { base = seg.from; break; }
        const duration = seg.end - segStart;
        const t = (time - segStart) / duration;
        const smooth = t * t * (3 - 2 * t);
        base = blendPresets(seg.from, seg.to, smooth);
        break;
      }
      segStart = seg.end;
    }

    if (this.moonProgress >= 0.75) {
      const t = Math.min(1, (this.moonProgress - 0.75) / 0.10);
      const smooth = t * t * (3 - 2 * t);
      return blendPresets(base, NIGHT, smooth);
    }
    return base;
  }

  /** Stars/aurora visibility weight: 0 during day, 1 during night, smooth in transitions. */
  getNightWeight(): number {
    const time = this.getCycleTime();
    let w = 0;
    if (time < 60) w = 0;
    else if (time < 75) { const t = (time - 60) / 15; w = t * t * (3 - 2 * t) * 0.5; }
    else if (time < 105) w = 0.5;
    else if (time < 120) { const t = (time - 105) / 15; w = 0.5 + t * t * (3 - 2 * t) * 0.5; }
    else if (time < 180) w = 1;
    else if (time < 195) { const t = (time - 180) / 15; w = 1 - t * t * (3 - 2 * t); }

    if (this.moonProgress >= 0.75) {
      const t = Math.min(1, (this.moonProgress - 0.75) / 0.10);
      w = w + (1 - w) * t * t * (3 - 2 * t);
    }
    return w;
  }

  /** Lens flare visibility weight: 1 during day, 0 during night. */
  getDayWeight(): number {
    return 1 - this.getNightWeight();
  }

  /**
   * Rain weight 0–1. Random episodes that can occur during any time of day.
   * Uses two slow sine waves with irrational frequency ratios seeded by
   * worldSeed so all clients see the same weather.
   * Frequencies are scaled so typical rain-on windows are ~50% shorter than
   * the base sine period would give.
   */
  getRainWeight(moonProgress = 0): number {
    const now = Date.now() / 1000;
    const s = this.worldSeed;
    const a = Math.sin(now * 0.058 + s * 1.7) * 0.5 + 0.5;
    const b = Math.sin(now * 0.026 + s * 3.1) * 0.5 + 0.5;
    const raw = a * 0.65 + b * 0.35;

    if (moonProgress >= 0.75) {
      const urgency = Math.min(1, (moonProgress - 0.75) / 0.25);
      const lo = 0.50 - urgency * 0.30;
      const hi = 0.58 + urgency * 0.15;
      const t = Math.max(0, Math.min(1, (raw - lo) / (hi - lo)));
      const base = t * t * (3 - 2 * t);
      return Math.min(1, base + urgency * 0.4);
    }

    const lo = 0.50, hi = 0.58;
    const t = Math.max(0, Math.min(1, (raw - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  }

  /** Returns per-phase music weights that always sum to 1. */
  getMusicWeights(): { day: number; evening: number; night: number } {
    const time = this.getCycleTime();

    let mw: { day: number; evening: number; night: number };
    if (time < 60) mw = { day: 1, evening: 0, night: 0 };
    else if (time < 75) {
      const t = (time - 60) / 15;
      const s = t * t * (3 - 2 * t);
      mw = { day: 1 - s, evening: s, night: 0 };
    }
    else if (time < 105) mw = { day: 0, evening: 1, night: 0 };
    else if (time < 120) {
      const t = (time - 105) / 15;
      const s = t * t * (3 - 2 * t);
      mw = { day: 0, evening: 1 - s, night: s };
    }
    else if (time < 180) mw = { day: 0, evening: 0, night: 1 };
    else if (time < 195) {
      const t = (time - 180) / 15;
      const s = t * t * (3 - 2 * t);
      mw = { day: s, evening: 0, night: 1 - s };
    }
    else mw = { day: 1, evening: 0, night: 0 };

    if (this.moonProgress >= 0.75) {
      const blend = Math.min(1, (this.moonProgress - 0.75) / 0.10);
      const s = blend * blend * (3 - 2 * blend);
      mw = {
        day: mw.day * (1 - s),
        evening: mw.evening * (1 - s),
        night: mw.night + (1 - mw.night) * s,
      };
    }
    return mw;
  }
}
