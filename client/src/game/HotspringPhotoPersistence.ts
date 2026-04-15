const STORAGE_KEY = "globefly_carpet_hotspring_selfies_v1";

type Store = Record<string, boolean[]>;

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch { /* ignore */ }
  return {};
}

function saveStore(data: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

/** Per-world seed: which hotspring indices already granted the selfie XP (carpet only). */
export function loadHotspringSelfieFlags(worldSeed: number, count: number): boolean[] {
  const key = String(worldSeed);
  const all = loadStore();
  const arr = all[key];
  if (!arr || arr.length !== count) return new Array(count).fill(false);
  return arr.map(Boolean);
}

export function markHotspringSelfieTaken(worldSeed: number, index: number, count: number) {
  const key = String(worldSeed);
  const all = loadStore();
  const prev = all[key];
  const next = prev && prev.length === count ? [...prev] : new Array(count).fill(false);
  next[index] = true;
  all[key] = next;
  saveStore(all);
}
