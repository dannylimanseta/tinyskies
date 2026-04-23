import type { Vehicle } from "@globefly/shared";

export interface UpgradeState {
  // ── Plane performance ─────────────────────────────
  maxSpeedMult: number;
  boostSpeedMult: number;
  boostDurationMult: number;
  /** Retained so legacy `quick_climb`/`quick_brake` saves don't throw. No new card touches it. */
  altSpeedMult: number;
  bankMult: number;
  /** Retained so legacy `quick_brake` saves don't throw. */
  brakeDecelMult: number;

  // ── Carpet performance ────────────────────────────
  carpetSpeedMult: number;
  carpetBoostSpeedMult: number;
  carpetBoostDurationMult: number;
  carpetBankMult: number;
  /** Trigger-circle radius multiplier for the carpet portal. */
  carpetPortalRadiusMult: number;
  /** Retained for legacy saves; portal teleports no longer award XP. */
  carpetPortalXpMult: number;
  /** XP bonus on landmark selfie quest completions. */
  carpetSelfieXpMult: number;

  // ── Boat performance ──────────────────────────────
  boatSpeedMult: number;
  boatTurnMult: number;
  boatAccelMult: number;
  /** Diamond XP multiplier while boat is at >=80% of its max speed. */
  boatHighSpeedDiamondMult: number;

  // ── Boat fishing (OceanFish) ────────────────────────
  /** Multiplier on fishing catch / exit chord radii. */
  fishCatchRadiusMult: number;
  /** Multiplier on capture bar fill rate. */
  fishFillRateMult: number;
  /** XP multiplier for fish catches (applied in awardXP). */
  fishXpMult: number;
  /** How many fish can be hooked at once (1–3). */
  fishMaxConcurrent: number;

  // ── Paintball (plane-only) ────────────────────────
  paintballSpeedMult: number;
  paintballRangeMult: number;
  /** Double-Tap burst fire: 2 paintballs ~90ms apart, longer post-burst cooldown. */
  paintballDoubleTapEnabled: boolean;

  // ── Shared economy ────────────────────────────────
  /** Diamond pickup-radius multiplier (real magnet). */
  magnetMult: number;
  diamondXpMult: number;
  deliveryXpMult: number;
  frequentFlyerEnabled: boolean;
  nightOwlEnabled: boolean;

  // ── Combo tuning (diamond streaks) ────────────────
  comboWindowMs: number;
  comboMaxSteps: number;
  comboRatePerStep: number;

  // ── Spawn-count bonuses (only rainbows are live) ──
  extraRainbows: number;
  /** Retained so legacy saves don't throw. No card feeds them. */
  diamondCountBonus: number;
  extraFireflies: number;
  extraLanterns: number;
}

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  category: "performance" | "economy";
  apply: (state: UpgradeState) => void;
}

function defaultState(): UpgradeState {
  return {
    maxSpeedMult: 1,
    boostSpeedMult: 1,
    boostDurationMult: 1,
    altSpeedMult: 1,
    bankMult: 1,
    brakeDecelMult: 1,

    carpetSpeedMult: 1,
    carpetBoostSpeedMult: 1,
    carpetBoostDurationMult: 1,
    carpetBankMult: 1,
    carpetPortalRadiusMult: 1,
    carpetPortalXpMult: 1,
    carpetSelfieXpMult: 1,

    boatSpeedMult: 1,
    boatTurnMult: 1,
    boatAccelMult: 1,
    boatHighSpeedDiamondMult: 1,

    fishCatchRadiusMult: 1,
    fishFillRateMult: 1,
    fishXpMult: 1,
    fishMaxConcurrent: 1,

    paintballSpeedMult: 1,
    paintballRangeMult: 1,
    paintballDoubleTapEnabled: false,

    magnetMult: 1,
    diamondXpMult: 1,
    deliveryXpMult: 1,
    frequentFlyerEnabled: false,
    nightOwlEnabled: false,

    comboWindowMs: 900,
    comboMaxSteps: 5,
    comboRatePerStep: 0.028,

    extraRainbows: 0,
    diamondCountBonus: 0,
    extraFireflies: 0,
    extraLanterns: 0,
  };
}

/** Shared pool — drawn for any vehicle. */
const SHARED_UPGRADES: UpgradeDefinition[] = [
  {
    id: "prospector",
    name: "Prospector",
    description: "+25% XP per diamond",
    category: "economy",
    apply: (s) => { s.diamondXpMult *= 1.25; },
  },
  {
    id: "magnet_field",
    name: "Magnet Field",
    description: "Diamond pickup radius x2",
    category: "economy",
    apply: (s) => { s.magnetMult *= 2.0; },
  },
  {
    id: "night_owl",
    name: "Night Owl",
    description: "+20% XP from every source at night",
    category: "economy",
    apply: (s) => { s.nightOwlEnabled = true; },
  },
  {
    id: "combo_hunter",
    name: "Combo Hunter",
    description: "Longer diamond combo window, higher pitch ceiling",
    category: "economy",
    apply: (s) => {
      s.comboWindowMs = 1800;
      s.comboMaxSteps = 8;
      s.comboRatePerStep = 0.045;
    },
  },
  {
    id: "rainbow_finder",
    name: "Rainbow Finder",
    description: "+2 rainbow arches in the world",
    category: "economy",
    apply: (s) => { s.extraRainbows += 2; },
  },
];

/** Plane ability pool — drawn only while flying the biplane. */
const PLANE_UPGRADES: UpgradeDefinition[] = [
  {
    id: "tailwind",
    name: "Tailwind",
    description: "+10% cruise speed",
    category: "performance",
    apply: (s) => { s.maxSpeedMult *= 1.10; },
  },
  {
    id: "afterburner",
    name: "Afterburner",
    description: "+18% boost speed",
    category: "performance",
    apply: (s) => { s.boostSpeedMult *= 1.18; },
  },
  {
    id: "nitro_tank",
    name: "Nitro Tank",
    description: "+30% boost duration",
    category: "performance",
    apply: (s) => { s.boostDurationMult *= 1.30; },
  },
  {
    id: "tight_turn",
    name: "Tight Turn",
    description: "+18% turning responsiveness",
    category: "performance",
    apply: (s) => { s.bankMult *= 1.18; },
  },
  {
    id: "sharpshooter",
    name: "Sharpshooter",
    description: "Paintball speed +30%, range +25%",
    category: "performance",
    apply: (s) => {
      s.paintballSpeedMult *= 1.30;
      s.paintballRangeMult *= 1.25;
    },
  },
  {
    id: "double_tap",
    name: "Double Tap",
    description: "Fire two paintballs in rapid succession; slower post-burst cooldown",
    category: "performance",
    apply: (s) => { s.paintballDoubleTapEnabled = true; },
  },
  {
    id: "generous_tip",
    name: "Generous Tip",
    description: "+35% delivery quest XP",
    category: "economy",
    apply: (s) => { s.deliveryXpMult *= 1.35; },
  },
  {
    id: "frequent_flyer",
    name: "Frequent Flyer",
    description: "Every 5th diamond collected gives double XP",
    category: "economy",
    apply: (s) => { s.frequentFlyerEnabled = true; },
  },
];

/** Carpet ability pool. */
const CARPET_UPGRADES: UpgradeDefinition[] = [
  {
    id: "silk_wind",
    name: "Silk Wind",
    description: "+12% carpet cruise speed",
    category: "performance",
    apply: (s) => { s.carpetSpeedMult *= 1.12; },
  },
  {
    id: "thermal_surge",
    name: "Thermal Surge",
    description: "Diamond boost duration +35% and peak speed +10%",
    category: "performance",
    apply: (s) => {
      s.carpetBoostDurationMult *= 1.35;
      s.carpetBoostSpeedMult *= 1.10;
    },
  },
  {
    id: "tight_tassels",
    name: "Tight Tassels",
    description: "+18% bank responsiveness",
    category: "performance",
    apply: (s) => { s.carpetBankMult *= 1.18; },
  },
  {
    id: "wide_portal",
    name: "Wide Portal",
    description: "Portal trigger radius +30%",
    category: "performance",
    apply: (s) => {
      s.carpetPortalRadiusMult *= 1.30;
    },
  },
  {
    id: "leaf_flourish",
    name: "Leaf Flourish",
    description: "+40% XP from landmark selfie quests",
    category: "economy",
    apply: (s) => { s.carpetSelfieXpMult *= 1.40; },
  },
];

/** Boat ability pool — fishing-focused + handling + speed. */
const BOAT_UPGRADES: UpgradeDefinition[] = [
  {
    id: "keel_cut",
    name: "Keel Cut",
    description: "+18% cruise speed",
    category: "performance",
    apply: (s) => { s.boatSpeedMult *= 1.18; },
  },
  {
    id: "steady_rudder",
    name: "Steady Rudder",
    description: "+22% turning responsiveness",
    category: "performance",
    apply: (s) => { s.boatTurnMult *= 1.22; },
  },
  {
    id: "wide_cast",
    name: "Wide Cast",
    description: "+15% fishing range radius",
    category: "performance",
    apply: (s) => { s.fishCatchRadiusMult *= 1.15; },
  },
  {
    id: "quick_reel",
    name: "Quick Reel",
    description: "+22% catch speed",
    category: "performance",
    apply: (s) => { s.fishFillRateMult *= 1.22; },
  },
  {
    id: "twin_lines",
    name: "Twin Lines",
    description: "Fish two targets at once",
    category: "performance",
    apply: (s) => { s.fishMaxConcurrent = Math.min(2, s.fishMaxConcurrent + 1); },
  },
  {
    id: "fish_bounty",
    name: "Fish Bounty",
    description: "+25% XP from fish catches",
    category: "economy",
    apply: (s) => { s.fishXpMult *= 1.25; },
  },
];

/** Old boat cards — not drawn, but `apply` must run for restored saves. */
const LEGACY_BOAT_UPGRADES: UpgradeDefinition[] = [
  {
    id: "foam_surge",
    name: "Foam Surge",
    description: "+35% acceleration from standstill",
    category: "performance",
    apply: (s) => { s.boatAccelMult *= 1.35; },
  },
  {
    id: "wake_rider",
    name: "Wake Rider",
    description: "+25% diamond XP when at 80% max speed or higher",
    category: "economy",
    apply: (s) => { s.boatHighSpeedDiamondMult *= 1.25; },
  },
];

const ALL_POOLS: UpgradeDefinition[][] = [
  SHARED_UPGRADES,
  PLANE_UPGRADES,
  CARPET_UPGRADES,
  BOAT_UPGRADES,
  LEGACY_BOAT_UPGRADES,
];

function vehiclePool(vehicle: Vehicle): UpgradeDefinition[] {
  if (vehicle === "plane") return PLANE_UPGRADES;
  if (vehicle === "carpet") return CARPET_UPGRADES;
  return BOAT_UPGRADES;
}

function findUpgradeDef(id: string): UpgradeDefinition | undefined {
  for (const pool of ALL_POOLS) {
    const def = pool.find((u) => u.id === id);
    if (def) return def;
  }
  return undefined;
}

/** Fisher-Yates shuffle (in-place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export class UpgradeManager {
  state: UpgradeState = defaultState();
  readonly appliedIds = new Set<string>();
  /** Vehicle this manager draws cards for. Defaults to "plane" for callers that haven't plumbed it through yet. */
  private vehicle: Vehicle = "plane";

  setVehicle(vehicle: Vehicle) {
    this.vehicle = vehicle;
  }

  /**
   * Hybrid draw: at least 1 card from the vehicle-specific pool, up to 2 from the shared pool,
   * topped up from whatever remains if the ideal mix can't be filled.
   */
  drawCards(count = 3): UpgradeDefinition[] {
    const vPool = vehiclePool(this.vehicle).filter((u) => !this.appliedIds.has(u.id));
    const sPool = SHARED_UPGRADES.filter((u) => !this.appliedIds.has(u.id));

    const picked: UpgradeDefinition[] = [];
    const seen = new Set<string>();

    const vehicleTarget = Math.min(1, count, vPool.length);
    const shuffledV = shuffle([...vPool]);
    for (let i = 0; i < vehicleTarget; i++) {
      const def = shuffledV[i]!;
      picked.push(def);
      seen.add(def.id);
    }

    const sharedTarget = Math.min(count - picked.length, 2, sPool.length);
    const shuffledS = shuffle([...sPool]);
    for (let i = 0; i < sharedTarget; i++) {
      const def = shuffledS[i]!;
      if (seen.has(def.id)) continue;
      picked.push(def);
      seen.add(def.id);
    }

    if (picked.length < count) {
      const leftover = [
        ...shuffledV.slice(vehicleTarget),
        ...shuffledS.slice(sharedTarget),
      ].filter((u) => !seen.has(u.id));
      shuffle(leftover);
      for (const def of leftover) {
        if (picked.length >= count) break;
        picked.push(def);
        seen.add(def.id);
      }
    }

    return picked;
  }

  /** Apply an upgrade by id. No-ops if already applied or id unknown (supports old save compat). */
  apply(id: string) {
    if (this.appliedIds.has(id)) return;
    const def = findUpgradeDef(id);
    this.appliedIds.add(id);
    if (!def) return;
    def.apply(this.state);
  }

  /** Replay a batch of previously-earned upgrade IDs onto a fresh state. */
  restoreUpgrades(ids: string[]) {
    for (const id of ids) this.apply(id);
  }

  /** Reset to defaults (call on session teardown). */
  reset() {
    this.state = defaultState();
    this.appliedIds.clear();
  }
}
