import { Quaternion, Vector3 } from "three";

export type LandmarkType =
  | "village"
  | "peak"
  | "forest"
  | "coast"
  | "island"
  | "lighthouse"
  | "windmill"
  | "observatory"
  | "stonehenge"
  | "shrine"
  | "hotspring"
  | "mushroom"
  | "butterfly"
  | "pyramid"
  | "statue"
  | "race_banner";

export interface Landmark {
  type: LandmarkType;
  name: string;
  normal: Vector3;
  enterDot: number;
  exitDot: number;
}

const VILLAGE_ENTER_DOT = 0.995;
const VILLAGE_EXIT_DOT = 0.990;

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

const LIGHTHOUSE_PREFIXES = [
  "Storm", "Beacon", "Gull", "Tide", "Cape", "Drift", "Anchor", "Reef",
  "Salt", "Fog", "Ember", "North", "South", "Lantern", "Harbour", "Crag",
];

const LIGHTHOUSE_SUFFIXES = [
  " Light", " Point", " Watch", " Rock", " Bluff", " Head", " Reach", " Keep",
];

const WINDMILL_PREFIXES = [
  "Breeze", "Gale", "Harvest", "Golden", "Mill", "Grain", "Wheat", "Rustic",
  "Old", "Meadow", "Spring", "Summer", "Copper", "Iron", "Dusty", "Hilltop",
];

const WINDMILL_SUFFIXES = [
  " Mill", " Wind", " Farm", " Rise", " Knoll", " Hollow", " Wheel", " Grist",
];

const OBSERVATORY_PREFIXES = [
  "Star", "Sky", "Luna", "Astral", "Zenith", "Polar", "Crescent", "Eclipse",
  "Comet", "Solar", "Nebula", "Cosmos", "Aurora", "Meridian", "Apex", "Summit",
];

const OBSERVATORY_SUFFIXES = [
  " Observatory", " Dome", " Watch", " Peak", " Lookout", " Station", " Spire", " Summit",
];

const STONEHENGE_PREFIXES = [
  "Ancient", "Old", "Standing", "Broken", "Hollow", "Forgotten", "Worn", "Silent",
  "Mossy", "Grey", "Crooked", "Lonely", "Wandering", "Sunken", "Crumbling", "Lost",
];

const STONEHENGE_SUFFIXES = [
  " Stones", " Circle", " Ring", " Henge", " Monoliths", " Pillars", " Ruins", " Altar",
];

const SHRINE_PREFIXES = [
  "Quiet", "Moss", "Cedar", "Pine", "Bamboo", "Stone", "Red", "Morning", "Evening", "Lotus",
  "Willow", "Maple", "Silver", "Hidden", "Ancient", "Peaceful", "Misty", "River", "Hill", "Forest",
];

const SHRINE_SUFFIXES = [
  " Shrine", " Gate", " Sanctuary", " Grove", " Rest", " Torii", " Path", " Garden",
];

const HOTSPRING_PREFIXES = [
  "Misty", "Steam", "Warm", "Golden", "Cedar", "Lotus", "Moon", "Dawn", "Willow", "Stone",
  "Hidden", "Ancient", "Silver", "Cloud", "Pine", "River", "Hill", "Valley", "Sun", "Star",
];

const HOTSPRING_SUFFIXES = [
  " Hot Spring", " Springs", " Bath", " Pool", " Onsen", " Waters", " Soak", " Basin",
];

const MUSHROOM_PREFIXES = [
  "Fairy", "Pastel", "Spore", "Toadstool", "Glimmer", "Magic", "Whisper", "Dream", "Witch", "Myco", "Luminous", "Wanderer",
];

const MUSHROOM_SUFFIXES = [
  " Grove", " Garden", " Patch", " Ring", " Hollow", " Thicket", " Glade", " Shade",
];

const BUTTERFLY_PREFIXES = [
  "Monarch", "Flutter", "Painted", "Swallowtail", "Azure", "Silk", "Petal", "Nectar", "Breeze", "Sunwing", "Gossamer",
];

const BUTTERFLY_SUFFIXES = [
  " Garden", " Meadow", " Sanctuary", " Haven", " Bloom", " Rest", " Field", " Retreat",
];

const PYRAMID_PREFIXES = [
  "Sun", "Sand", "Lost", "Golden", "Ancient", "Silent", "Stone", "Desert", "Buried", "Forgotten",
  "Lonely", "Dusk", "Ember", "Crimson", "Ivory", "Sunken", "Lone",
];

const PYRAMID_SUFFIXES = [
  " Pyramid", " Monument", " Tomb", " Ziggurat", " Mausoleum", " Needle", " Spire", " Mound",
];

const STATUE_PREFIXES = [
  "Guardian", "Stone", "Bronze", "Marble", "Silent", "Forgotten", "Hero", "Sage", "Watcher", "Eternal",
  "Golden", "Weathered", "Ancient", "Lone", "Sky", "Summit", "Hollow", "Crimson", "Ivory", "Iron",
];

const STATUE_SUFFIXES = [
  " Memorial", " Monument", " Statue", " Figure", " Effigy", " Colossus", " Sentinel", " Tribute",
];

const RACE_BANNER_PREFIXES = [
  "Sky", "Cloud", "Aero", "Wind", "Storm", "Gale", "Breeze", "Sun", "Star", "Moon",
  "High", "Grand", "Apex", "Zenith", "Summit", "Crest", "Peak", "Crown",
];

const RACE_BANNER_SUFFIXES = [
  " Dash", " Run", " Sprint", " Derby", " Rally", " Circuit", " Track", " Course",
  " Trial", " Chase", " Flight", " Glide", " Soar", " Dive", " Drop", " Plunge",
];

const WORD_LISTS: Record<LandmarkType, { prefixes: string[]; suffixes: string[] }> = {
  village:      { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  peak:         { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  forest:       { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  coast:        { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  island:       { prefixes: VILLAGE_PREFIXES, suffixes: VILLAGE_SUFFIXES },
  lighthouse:   { prefixes: LIGHTHOUSE_PREFIXES, suffixes: LIGHTHOUSE_SUFFIXES },
  windmill:     { prefixes: WINDMILL_PREFIXES, suffixes: WINDMILL_SUFFIXES },
  observatory:  { prefixes: OBSERVATORY_PREFIXES, suffixes: OBSERVATORY_SUFFIXES },
  stonehenge:   { prefixes: STONEHENGE_PREFIXES,  suffixes: STONEHENGE_SUFFIXES },
  shrine:       { prefixes: SHRINE_PREFIXES,      suffixes: SHRINE_SUFFIXES },
  hotspring:    { prefixes: HOTSPRING_PREFIXES,   suffixes: HOTSPRING_SUFFIXES },
  mushroom:     { prefixes: MUSHROOM_PREFIXES,    suffixes: MUSHROOM_SUFFIXES },
  butterfly:    { prefixes: BUTTERFLY_PREFIXES,   suffixes: BUTTERFLY_SUFFIXES },
  pyramid:      { prefixes: PYRAMID_PREFIXES,     suffixes: PYRAMID_SUFFIXES },
  statue:       { prefixes: STATUE_PREFIXES,      suffixes: STATUE_SUFFIXES },
  race_banner:  { prefixes: RACE_BANNER_PREFIXES, suffixes: RACE_BANNER_SUFFIXES },
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

  registerLighthouses(
    lighthouses: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, lighthouses.length, "lighthouse");
    for (let i = 0; i < lighthouses.length; i++) {
      this.landmarks.push({
        type: "lighthouse",
        name: names[i],
        normal: lighthouses[i].normal.clone().normalize(),
        enterDot: 0.997,
        exitDot: 0.993,
      });
    }
  }

  registerWindmills(
    windmills: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, windmills.length, "windmill");
    for (let i = 0; i < windmills.length; i++) {
      this.landmarks.push({
        type: "windmill",
        name: names[i],
        normal: windmills[i].normal.clone().normalize(),
        enterDot: 0.996,
        exitDot: 0.992,
      });
    }
  }

  registerObservatories(
    observatories: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, observatories.length, "observatory");
    for (let i = 0; i < observatories.length; i++) {
      this.landmarks.push({
        type: "observatory",
        name: names[i],
        normal: observatories[i].normal.clone().normalize(),
        enterDot: 0.996,
        exitDot: 0.992,
      });
    }
  }

  registerStonehenges(
    stonehenges: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, stonehenges.length, "stonehenge");
    for (let i = 0; i < stonehenges.length; i++) {
      this.landmarks.push({
        type: "stonehenge",
        name: names[i]!,
        normal: stonehenges[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  registerShrines(
    shrines: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, shrines.length, "shrine");
    for (let i = 0; i < shrines.length; i++) {
      this.landmarks.push({
        type: "shrine",
        name: names[i]!,
        normal: shrines[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  registerHotsprings(
    hotsprings: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, hotsprings.length, "hotspring");
    for (let i = 0; i < hotsprings.length; i++) {
      this.landmarks.push({
        type: "hotspring",
        name: names[i]!,
        normal: hotsprings[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  registerMushrooms(
    mushrooms: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, mushrooms.length, "mushroom");
    for (let i = 0; i < mushrooms.length; i++) {
      this.landmarks.push({
        type: "mushroom",
        name: names[i]!,
        normal: mushrooms[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  registerButterflies(
    butterflies: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, butterflies.length, "butterfly");
    for (let i = 0; i < butterflies.length; i++) {
      this.landmarks.push({
        type: "butterfly",
        name: names[i]!,
        normal: butterflies[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  registerPyramids(
    pyramids: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, pyramids.length, "pyramid");
    for (let i = 0; i < pyramids.length; i++) {
      this.landmarks.push({
        type: "pyramid",
        name: names[i]!,
        normal: pyramids[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  registerStatues(
    statues: { normal: Vector3 }[],
    seed: number,
    /** Shown in the fly-over HUD when the eternal-victory memorial exists. */
    memorialPilotName?: string,
  ) {
    const fallback = generateLandmarkNames(seed, statues.length, "statue");
    const pilot = memorialPilotName?.trim();
    for (let i = 0; i < statues.length; i++) {
      this.landmarks.push({
        type: "statue",
        name: pilot && pilot.length > 0 ? pilot : fallback[i]!,
        normal: statues[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  registerRaceBanners(
    banners: { normal: Vector3 }[],
    seed: number,
  ) {
    const names = generateLandmarkNames(seed, banners.length, "race_banner");
    for (let i = 0; i < banners.length; i++) {
      this.landmarks.push({
        type: "race_banner",
        name: names[i]!,
        normal: banners[i]!.normal.clone().normalize(),
        enterDot: 0.995,
        exitDot: 0.991,
      });
    }
  }

  getAll(): readonly Landmark[] {
    return this.landmarks;
  }

  getByType(type: LandmarkType): Landmark[] {
    return this.landmarks.filter((lm) => lm.type === type);
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
