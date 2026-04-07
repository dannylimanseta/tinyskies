import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import type { RoomManager } from "../rooms/RoomManager.js";
import { generateUniqueWorldName } from "../utils/worldNames.js";

function worldToConfig(w: {
  id: string;
  slug: string;
  name: string;
  globeRadius: number;
  texture: string;
  seed: number;
  terrainType: string;
  createdBy: string;
}) {
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    globeRadius: w.globeRadius,
    texture: w.texture,
    seed: w.seed,
    terrainType: w.terrainType,
    createdBy: w.createdBy,
  };
}

let overflowLock: Promise<void> = Promise.resolve();

function withOverflowLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = overflowLock;
  let resolve!: () => void;
  overflowLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(resolve);
}

export function createWorldsRouter(
  prisma: PrismaClient,
  roomManager: RoomManager,
) {
  const router = Router();

  /* ── Auto-join: server picks the best world ─────────────────── */

  router.post("/auto-join", async (_req, res) => {
    try {
      const MAX_ATTEMPTS = 5;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const bestSlug = roomManager.findBestWorld();

        if (bestSlug) {
          const reservationId = roomManager.reserveSlot(bestSlug);
          if (reservationId) {
            const world = await prisma.world.findUnique({
              where: { slug: bestSlug },
            });
            if (world) {
              res.json({ ...worldToConfig(world), reservationId });
              return;
            }
          }
          continue;
        }

        // All worlds full -- create overflow (serialized via lock)
        const result = await withOverflowLock(async () => {
          // Re-check after acquiring lock; another request may have created space
          const recheck = roomManager.findBestWorld();
          if (recheck) {
            const rid = roomManager.reserveSlot(recheck);
            if (rid) {
              const w = await prisma.world.findUnique({
                where: { slug: recheck },
              });
              if (w) return { world: w, reservationId: rid };
            }
            return null;
          }

          const existingNames = new Set<string>();
          const allWorlds = await prisma.world.findMany({
            select: { name: true },
          });
          for (const w of allWorlds) existingNames.add(w.name);

          const name = generateUniqueWorldName(existingNames);
          const slug = nanoid(10);
          const seed = Math.floor(Math.random() * 2147483647);

          const created = await prisma.world.create({
            data: {
              slug,
              name,
              texture: "earth",
              globeRadius: 5.0,
              seed,
              terrainType: "default",
              createdBy: "System",
            },
          });
          roomManager.addWorldSlug(slug);
          const rid = roomManager.reserveSlot(slug);
          return { world: created, reservationId: rid };
        });

        if (result) {
          res.json({
            ...worldToConfig(result.world),
            reservationId: result.reservationId,
          });
          return;
        }
      }

      res.status(503).json({ error: "No available worlds, try again" });
    } catch (err) {
      console.error("Auto-join failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /* ── Create world (admin/testing) ───────────────────────────── */

  router.post("/", async (req, res) => {
    try {
      const { name, texture, createdBy, globeRadius, terrainType } = req.body;
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const slug = nanoid(10);
      const seed = Math.floor(Math.random() * 2147483647);
      const world = await prisma.world.create({
        data: {
          slug,
          name: name.slice(0, 64),
          texture: texture || "earth",
          globeRadius: globeRadius ?? 5.0,
          seed,
          terrainType: terrainType || "default",
          createdBy: createdBy || "Anonymous",
        },
      });

      res.json(worldToConfig(world));
    } catch (err) {
      console.error("Failed to create world:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/:slug", async (req, res) => {
    try {
      const world = await prisma.world.findUnique({
        where: { slug: req.params.slug },
      });

      if (!world) {
        res.status(404).json({ error: "World not found" });
        return;
      }

      res.json(worldToConfig(world));
    } catch (err) {
      console.error("Failed to fetch world:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/", async (_req, res) => {
    try {
      const worlds = await prisma.world.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      const activeSlugs = new Set(roomManager.getActiveRoomSlugs());

      const result = worlds.map((w) => ({
        ...worldToConfig(w),
        playerCount: roomManager.getRoomPlayerCount(w.slug),
        effectiveCount: roomManager.getEffectiveCount(w.slug),
        active: activeSlugs.has(w.slug),
      }));

      res.json(result);
    } catch (err) {
      console.error("Failed to list worlds:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
