const HOTSPRING_STORAGE_KEY = "globefly_carpet_hotspring_selfies_v1";
const SHRINE_STORAGE_KEY = "globefly_carpet_shrine_selfies_v1";
const MUSHROOM_STORAGE_KEY = "globefly_carpet_mushroom_selfies_v1";

type BoolArrayStore = Record<string, boolean[]>;

function loadKeyedStore(key: string): BoolArrayStore {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as BoolArrayStore;
  } catch { /* ignore */ }
  return {};
}

function saveKeyedStore(storageKey: string, data: BoolArrayStore) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch { /* ignore */ }
}

/** Per-world seed: which hotspring indices already granted the selfie XP (carpet only). */
export function loadHotspringSelfieFlags(worldSeed: number, count: number): boolean[] {
  const key = String(worldSeed);
  const all = loadKeyedStore(HOTSPRING_STORAGE_KEY);
  const arr = all[key];
  if (!arr || arr.length !== count) return new Array(count).fill(false);
  return arr.map(Boolean);
}

export function markHotspringSelfieTaken(worldSeed: number, index: number, count: number) {
  const key = String(worldSeed);
  const all = loadKeyedStore(HOTSPRING_STORAGE_KEY);
  const prev = all[key];
  const next = prev && prev.length === count ? [...prev] : new Array(count).fill(false);
  next[index] = true;
  all[key] = next;
  saveKeyedStore(HOTSPRING_STORAGE_KEY, all);
}

/** Per-world seed: which shrine indices already granted the selfie XP (carpet only). */
export function loadShrineSelfieFlags(worldSeed: number, count: number): boolean[] {
  const key = String(worldSeed);
  const all = loadKeyedStore(SHRINE_STORAGE_KEY);
  const arr = all[key];
  if (!arr || arr.length !== count) return new Array(count).fill(false);
  return arr.map(Boolean);
}

export function markShrineSelfieTaken(worldSeed: number, index: number, count: number) {
  const key = String(worldSeed);
  const all = loadKeyedStore(SHRINE_STORAGE_KEY);
  const prev = all[key];
  const next = prev && prev.length === count ? [...prev] : new Array(count).fill(false);
  next[index] = true;
  all[key] = next;
  saveKeyedStore(SHRINE_STORAGE_KEY, all);
}

/** Per-world seed: which mushroom indices already granted the selfie XP (carpet only). */
export function loadMushroomSelfieFlags(worldSeed: number, count: number): boolean[] {
  const key = String(worldSeed);
  const all = loadKeyedStore(MUSHROOM_STORAGE_KEY);
  const arr = all[key];
  if (!arr || arr.length !== count) return new Array(count).fill(false);
  return arr.map(Boolean);
}

export function markMushroomSelfieTaken(worldSeed: number, index: number, count: number) {
  const key = String(worldSeed);
  const all = loadKeyedStore(MUSHROOM_STORAGE_KEY);
  const prev = all[key];
  const next = prev && prev.length === count ? [...prev] : new Array(count).fill(false);
  next[index] = true;
  all[key] = next;
  saveKeyedStore(MUSHROOM_STORAGE_KEY, all);
}
