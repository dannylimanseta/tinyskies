export interface UpgradeState {
  // Plane performance multipliers (all default 1.0 = no-op)
  maxSpeedMult: number;
  boostSpeedMult: number;
  boostDurationMult: number;
  altSpeedMult: number;
  bankMult: number;
  brakeDecelMult: number;
  // Economy multipliers
  diamondXpMult: number;
  deliveryXpMult: number;
  // Collectible spawn bonuses (additive)
  diamondCountBonus: number;
  extraRainbows: number;
  extraFireflies: number;
  extraLanterns: number;
  // Special mechanics
  frequentFlyerEnabled: boolean;
  nightOwlEnabled: boolean;
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
    diamondXpMult: 1,
    deliveryXpMult: 1,
    diamondCountBonus: 0,
    extraRainbows: 0,
    extraFireflies: 0,
    extraLanterns: 0,
    frequentFlyerEnabled: false,
    nightOwlEnabled: false,
  };
}

const UPGRADES: UpgradeDefinition[] = [
  {
    id: "tailwind",
    name: "Tailwind",
    description: "+8% cruise speed",
    category: "performance",
    apply: (s) => { s.maxSpeedMult *= 1.08; },
  },
  {
    id: "afterburner",
    name: "Afterburner",
    description: "+15% boost speed",
    category: "performance",
    apply: (s) => { s.boostSpeedMult *= 1.15; },
  },
  {
    id: "nitro_tank",
    name: "Nitro Tank",
    description: "+25% boost duration",
    category: "performance",
    apply: (s) => { s.boostDurationMult *= 1.25; },
  },
  {
    id: "quick_climb",
    name: "Quick Climb",
    description: "+20% climb & descent speed",
    category: "performance",
    apply: (s) => { s.altSpeedMult *= 1.20; },
  },
  {
    id: "tight_turn",
    name: "Tight Turn",
    description: "+15% turning responsiveness",
    category: "performance",
    apply: (s) => { s.bankMult *= 1.15; },
  },
  {
    id: "quick_brake",
    name: "Quick Brake",
    description: "+15% braking power",
    category: "performance",
    apply: (s) => { s.brakeDecelMult *= 1.15; },
  },
  {
    id: "diamond_magnet",
    name: "Diamond Magnet",
    description: "+3 diamonds in the world",
    category: "economy",
    apply: (s) => { s.diamondCountBonus += 3; },
  },
  {
    id: "golden_touch",
    name: "Golden Touch",
    description: "+25% XP per diamond",
    category: "economy",
    apply: (s) => { s.diamondXpMult *= 1.25; },
  },
  {
    id: "generous_tip",
    name: "Generous Tip",
    description: "+25% delivery quest XP",
    category: "economy",
    apply: (s) => { s.deliveryXpMult *= 1.25; },
  },
  {
    id: "rainbow_finder",
    name: "Rainbow Finder",
    description: "+1 rainbow arch in the world",
    category: "economy",
    apply: (s) => { s.extraRainbows += 1; },
  },
  {
    id: "firefly_season",
    name: "Firefly Season",
    description: "+2 firefly clusters in the world",
    category: "economy",
    apply: (s) => { s.extraFireflies += 2; },
  },
  {
    id: "lantern_festival",
    name: "Lantern Festival",
    description: "+1 lantern cluster in the world",
    category: "economy",
    apply: (s) => { s.extraLanterns += 1; },
  },
  {
    id: "frequent_flyer",
    name: "Frequent Flyer",
    description: "Every 5th diamond collected gives double XP",
    category: "economy",
    apply: (s) => { s.frequentFlyerEnabled = true; },
  },
  {
    id: "night_owl",
    name: "Night Owl",
    description: "+20% XP from all sources during night-time",
    category: "economy",
    apply: (s) => { s.nightOwlEnabled = true; },
  },
];

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

  /** Draw `count` un-owned upgrades at random. Returns fewer if pool is smaller. */
  drawCards(count = 3): UpgradeDefinition[] {
    const available = UPGRADES.filter((u) => !this.appliedIds.has(u.id));
    return shuffle([...available]).slice(0, count);
  }

  /** Apply an upgrade by id. No-ops if already applied or id unknown. */
  apply(id: string) {
    if (this.appliedIds.has(id)) return;
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    def.apply(this.state);
    this.appliedIds.add(id);
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
