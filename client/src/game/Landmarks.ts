import { Quaternion, Vector3 } from "three";

export type LandmarkType = "village" | "peak" | "forest" | "coast" | "island";

export interface Landmark {
  type: LandmarkType;
  name: string;
  normal: Vector3;
  enterDot: number;
  exitDot: number;
}

const VILLAGE_ENTER_DOT = 0.997;
const VILLAGE_EXIT_DOT = 0.994;

const REF_UP = new Vector3(0, 1, 0);

/* ── Seeded RNG (same algorithm as Globe.ts) ────────────────────────── */

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ── Name Generator ─────────────────────────────────────────────────── */

const VILLAGE_PREFIXES = [
  "Wind", "Sun", "Moon", "Stone", "River", "Cedar", "Elm", "Fox", "Hawk",
  "Oak", "Pine", "Maple", "Willow", "Fern", "Moss", "Brook", "Cliff",
  "Dawn", "Dusk", "Star", "Amber", "Sage", "Iron", "Coral", "Birch",
  "Briar", "Thorn", "Ash", "Cinder", "Frost", "Hazel", "Laurel",
];

const VILLAGE_SUFFIXES = [
  "haven", "shire", "dale", "ford", "crest", "hollow", "ridge", "brook",
  "vale", "field", "meadow", "town", "wick", "bridge", "moor", "gate",
  "well", "wood", "marsh", "glen", "stead", "worth", "bury", "ham",
];

const WORD_LISTS: Record<LandmarkType, { prefixes: string[]; suffixes: string[] }> = {
  village: { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  peak:    { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  forest:  { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  coast:   { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  island:  { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
};

export function generateLandmarkNames(
  seed: number,
  count: number,
  type: LandmarkType,
): string[] {
  const rand = seededRandom(seed * 7919 + type.charCodeAt(0));
  const { prefixes, suffixes } = WORD_LISTS[type];
  const used = new Set<string>();
  const names: string[] = [];

  for (let i = 0; i < count; i++) {
    let name = "";
    let retries = 0;
    do {
      const pi = Math.floor(rand() * prefixes.length);
      const si = Math.floor(rand() * suffixes.length);
      name = prefixes[pi] + suffixes[si];
      retries++;
    } while (used.has(name) && retries < 50);

    used.add(name);
    names.push(name);
  }

  return names;
}

/* ── Registry ───────────────────────────────────────────────────────── */

export class LandmarkRegistry {
  private landmarks: Landmark[] = [];

  register(landmark: Landmark) {
    this.landmarks.push(landmark);
  }

  registerVillages(
    villages: { normal: Vector3; houseCount: number }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, villages.length, "village");
    for (let i = 0; i < villages.length; i++) {
      this.landmarks.push({
        type: "village",
        name: names[i],
        normal: villages[i].normal.clone().normalize(),
        enterDot: VILLAGE_ENTER_DOT,
        exitDot: VILLAGE_EXIT_DOT,
      });
    }
  }

  getAll(): readonly Landmark[] {
    return this.landmarks;
  }
}

/* ── Detector ───────────────────────────────────────────────────────── */

export class LandmarkDetector {
  private active: Landmark | null = null;
  private readonly _playerNormal = new Vector3();

  onEnter: ((landmark: Landmark) => void) | null = null;
  onExit: (() => void) | null = null;

  constructor(private registry: LandmarkRegistry) {}

  update(qPosition: Quaternion) {
    this._playerNormal.copy(REF_UP).applyQuaternion(qPosition).normalize();

    const landmarks = this.registry.getAll();
    let best: Landmark | null = null;
    let bestDot = -1;

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const dot = this._playerNormal.dot(lm.normal);

      if (this.active === lm) {
        if (dot < lm.exitDot) continue;
        if (dot > bestDot) {
          best = lm;
          bestDot = dot;
        }
      } else {
        if (dot > lm.enterDot && dot > bestDot) {
          best = lm;
          bestDot = dot;
        }
      }
    }

    if (best !== this.active) {
      if (this.active && !best) {
        this.active = null;
        this.onExit?.();
      } else if (best && !this.active) {
        this.active = best;
        this.onEnter?.(best);
      } else if (best && this.active && best !== this.active) {
        this.active = best;
        this.onEnter?.(best);
      }
    }
  }
}
