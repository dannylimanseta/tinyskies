import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";

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

type EventRow = {
  id: string;
  type: string;
  playerName: string;
  worldSlug: string;
  worldName: string | null;
  vehicle: string | null;
  level: number | null;
  runDurationSec: number | null;
  metadata: unknown;
  createdAt: Date;
};

type CountRow = {
  type: string;
  count: bigint | number;
  durationSec: bigint | number;
};

type VehicleRow = {
  vehicle: string | null;
  count: bigint | number;
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

function numberFromDb(n: bigint | number): number {
  return typeof n === "bigint" ? Number(n) : n;
}

function eventToJson(row: EventRow) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createEventsRouter(prisma: PrismaClient) {
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
      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      if (!EVENT_TYPES.has(type)) {
        res.status(400).json({ error: "invalid event type" });
        return;
      }
      if (worldSlug.length === 0) {
        res.status(400).json({ error: "worldSlug is required" });
        return;
      }

      await prisma.$executeRaw`
        INSERT INTO "GameEvent" (
          "id", "type", "playerName", "worldSlug", "worldName", "vehicle",
          "level", "runDurationSec", "metadata"
        )
        VALUES (
          ${nanoid(16)}, ${type}, ${playerName}, ${worldSlug}, ${worldName}, ${vehicle},
          ${level}, ${runDurationSec}, CAST(${metadataJson} AS jsonb)
        )
      `;

      res.json({ ok: true });
    } catch (err) {
      console.error("events POST failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/dashboard", async (_req, res) => {
    try {
      const [recentWorldSaves, recentQuestCompletions, totals, todayTotals, vehicleCounts] =
        await Promise.all([
          prisma.$queryRaw<EventRow[]>`
            SELECT *
            FROM "GameEvent"
            WHERE "type" = 'world_saved'
            ORDER BY "createdAt" DESC
            LIMIT 10
          `,
          prisma.$queryRaw<EventRow[]>`
            SELECT *
            FROM "GameEvent"
            WHERE "type" = 'quest_completed'
            ORDER BY "createdAt" DESC
            LIMIT 12
          `,
          prisma.$queryRaw<CountRow[]>`
            SELECT "type", COUNT(*) AS "count", COALESCE(SUM("runDurationSec"), 0) AS "durationSec"
            FROM "GameEvent"
            GROUP BY "type"
          `,
          prisma.$queryRaw<CountRow[]>`
            SELECT "type", COUNT(*) AS "count", COALESCE(SUM("runDurationSec"), 0) AS "durationSec"
            FROM "GameEvent"
            WHERE "createdAt" >= date_trunc('day', now())
            GROUP BY "type"
          `,
          prisma.$queryRaw<VehicleRow[]>`
            SELECT "vehicle", COUNT(*) AS "count"
            FROM "GameEvent"
            WHERE "vehicle" IS NOT NULL
              AND "type" IN ('world_saved', 'quest_completed', 'flag_event')
            GROUP BY "vehicle"
            ORDER BY COUNT(*) DESC
          `,
        ]);

      res.setHeader("Cache-Control", "no-store");
      res.json({
        recentWorldSaves: recentWorldSaves.map(eventToJson),
        recentQuestCompletions: recentQuestCompletions.map(eventToJson),
        totals: totals.map((row) => ({
          type: row.type,
          count: numberFromDb(row.count),
          durationSec: numberFromDb(row.durationSec),
        })),
        todayTotals: todayTotals.map((row) => ({
          type: row.type,
          count: numberFromDb(row.count),
          durationSec: numberFromDb(row.durationSec),
        })),
        vehicleCounts: vehicleCounts.map((row) => ({
          vehicle: row.vehicle,
          count: numberFromDb(row.count),
        })),
      });
    } catch (err) {
      console.error("events dashboard failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
