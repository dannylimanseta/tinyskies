const ADJECTIVES = [
  "Emerald", "Whispering", "Golden", "Misty", "Crimson",
  "Sapphire", "Drifting", "Luminous", "Frosted", "Ancient",
  "Velvet", "Silent", "Coral", "Amber", "Twilight",
  "Azure", "Hollow", "Sunken", "Wandering", "Forgotten",
  "Crystal", "Mossy", "Starlit", "Ivory", "Painted",
  "Dusky", "Shimmering", "Rugged", "Verdant", "Phantom",
];

const NOUNS = [
  "Archipelago", "Peaks", "Lagoon", "Tundra", "Meadows",
  "Reef", "Horizon", "Canopy", "Shores", "Expanse",
  "Valley", "Isles", "Frontier", "Hollows", "Drift",
  "Fjords", "Caldera", "Ravine", "Steppe", "Atoll",
  "Bluffs", "Cascade", "Enclave", "Thicket", "Narrows",
  "Basin", "Spires", "Marshlands", "Coves", "Ridge",
];

export function generateWorldName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

export function generateUniqueWorldName(existing: Set<string>): string {
  const maxAttempts = 200;
  for (let i = 0; i < maxAttempts; i++) {
    const name = generateWorldName();
    if (!existing.has(name)) return name;
  }
  return `World ${Date.now()}`;
}
