import { Router } from "express";
import { nanoid } from "nanoid";
import { addGameEvent, gameEvents } from "../memoryStore.js";

const EVENT_TYPES = new Set([
  "world_saved",
  "quest_completed",
  "session_heartbeat",
  "session_ended",
  "flag_event",
]);
const VEHICLES = new Set(["plane", "boat", "carpet"]);
const MAX_NAME = 48;
const MAX_WORLD = 80;
const MAX_SLUG = 32;
const MAX_TYPE = 32;
const MAX_METADATA_BYTES = 4_000;

type CountRow = {
  type: string;
  count: number;
  durationSec: number;
};

type VehicleRow = {
  vehicle: string | null;
  count: number;
};

function trimStr(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

function optionalTrimStr(s: unknown, max: number): string | null {
  const v = trimStr(s, max);
  return v.length > 0 ? v : null;
}

function optionalInt(n: unknown, min: number, max: number): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asPlainMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const json = JSON.stringify(value);
  if (json.length > MAX_METADATA_BYTES) return null;
  return value as Record<string, unknown>;
}

function eventToJson(row: { createdAt: Date }) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

function countEvents(events: typeof gameEvents): CountRow[] {
  const counts = new Map<string, CountRow>();
  for (const event of events) {
    const row = counts.get(event.type) ?? { type: event.type, count: 0, durationSec: 0 };
    row.count += 1;
    row.durationSec += event.runDurationSec ?? 0;
    counts.set(event.type, row);
  }
  return Array.from(counts.values());
}

function countVehicles(events: typeof gameEvents): VehicleRow[] {
  const counts = new Map<string, VehicleRow>();
  for (const event of events) {
    if (!event.vehicle) continue;
    if (!["world_saved", "quest_completed", "flag_event"].includes(event.type)) continue;
    const row = counts.get(event.vehicle) ?? { vehicle: event.vehicle, count: 0 };
    row.count += 1;
    counts.set(event.vehicle, row);
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function createEventsRouter() {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const type = trimStr(req.body?.type, MAX_TYPE);
      const playerName = trimStr(req.body?.playerName, MAX_NAME) || "Pilot";
      const worldSlug = trimStr(req.body?.worldSlug, MAX_SLUG);
      const worldName = optionalTrimStr(req.body?.worldName, MAX_WORLD);
      const vehicleRaw = optionalTrimStr(req.body?.vehicle, 16);
      const vehicle = vehicleRaw && VEHICLES.has(vehicleRaw) ? vehicleRaw : null;
      const level = optionalInt(req.body?.level, 1, 999);
      const runDurationSec = optionalInt(req.body?.runDurationSec, 0, 24 * 60 * 60);
      const metadata = asPlainMetadata(req.body?.metadata);

      if (!EVENT_TYPES.has(type)) {
        res.status(400).json({ error: "invalid event type" });
        return;
      }
      if (worldSlug.length === 0) {
        res.status(400).json({ error: "worldSlug is required" });
        return;
      }

      addGameEvent({
        id: nanoid(16),
        type,
        playerName,
        worldSlug,
        worldName,
        vehicle,
        level,
        runDurationSec,
        metadata,
        createdAt: new Date(),
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("events POST failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/dashboard", async (_req, res) => {
    try {
      const today = startOfToday();
      const todayEvents = gameEvents.filter((event) => event.createdAt >= today);
      const recentWorldSaves = gameEvents.filter((event) => event.type === "world_saved").slice(0, 10);
      const recentQuestCompletions = gameEvents
        .filter((event) => event.type === "quest_completed")
        .slice(0, 12);

      res.setHeader("Cache-Control", "no-store");
      res.json({
        recentWorldSaves: recentWorldSaves.map(eventToJson),
        recentQuestCompletions: recentQuestCompletions.map(eventToJson),
        totals: countEvents(gameEvents),
        todayTotals: countEvents(todayEvents),
        vehicleCounts: countVehicles(gameEvents),
      });
    } catch (err) {
      console.error("events dashboard failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
