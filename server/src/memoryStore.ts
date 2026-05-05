import { nanoid } from "nanoid";
import { generateUniqueWorldName } from "./utils/worldNames.js";

export interface WorldRecord {
  id: string;
  slug: string;
  name: string;
  texture: string;
  globeRadius: number;
  seed: number;
  terrainType: string;
  createdBy: string;
  createdAt: Date;
}

export interface SaveFeedEntry {
  playerName: string;
  worldName: string;
  worldSlug: string;
  createdAt: Date;
}

export interface GameEvent {
  id: string;
  type: string;
  playerName: string;
  worldSlug: string;
  worldName: string | null;
  vehicle: string | null;
  level: number | null;
  runDurationSec: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const SEED_WORLD_COUNT = 20;
const MAX_SAVE_FEED = 50;
const MAX_GAME_EVENTS = 1_000;

export const worlds: WorldRecord[] = [];
export const saveFeedEntries: SaveFeedEntry[] = [];
export const gameEvents: GameEvent[] = [];
export const lanternsByWorldSlug = new Map<string, number>();

export function createWorld(data: {
  name: string;
  texture?: string;
  globeRadius?: number;
  terrainType?: string;
  createdBy?: string;
}): WorldRecord {
  const world: WorldRecord = {
    id: nanoid(16),
    slug: nanoid(10),
    name: data.name.slice(0, 64),
    texture: data.texture || "earth",
    globeRadius: data.globeRadius ?? 5.0,
    seed: Math.floor(Math.random() * 2147483647),
    terrainType: data.terrainType || "default",
    createdBy: data.createdBy || "Anonymous",
    createdAt: new Date(),
  };
  worlds.unshift(world);
  return world;
}

export function seedWorlds() {
  const systemCount = worlds.filter((world) => world.createdBy === "System").length;
  const missingCount = Math.max(0, SEED_WORLD_COUNT - systemCount);
  if (missingCount === 0) return;

  const usedNames = new Set(worlds.map((world) => world.name));
  for (let i = 0; i < missingCount; i++) {
    const name = generateUniqueWorldName(usedNames);
    usedNames.add(name);
    createWorld({ name, createdBy: "System" });
  }
}

export function findWorld(slug: string): WorldRecord | undefined {
  return worlds.find((world) => world.slug === slug);
}

export function removeWorlds(slugs: string[]) {
  const remove = new Set(slugs);
  for (let i = worlds.length - 1; i >= 0; i--) {
    if (remove.has(worlds[i].slug)) worlds.splice(i, 1);
  }
}

export function addSaveFeedEntry(entry: SaveFeedEntry) {
  saveFeedEntries.unshift(entry);
  saveFeedEntries.length = Math.min(saveFeedEntries.length, MAX_SAVE_FEED);
}

export function addGameEvent(event: GameEvent) {
  gameEvents.unshift(event);
  gameEvents.length = Math.min(gameEvents.length, MAX_GAME_EVENTS);
}
