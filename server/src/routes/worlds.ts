import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import type { RoomManager } from "../rooms/RoomManager.js";

export function createWorldsRouter(
  prisma: PrismaClient,
  roomManager: RoomManager,
) {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { name, texture, createdBy, globeRadius } = req.body;
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const slug = nanoid(10);
      const world = await prisma.world.create({
        data: {
          slug,
          name: name.slice(0, 64),
          texture: texture || "earth",
          globeRadius: globeRadius ?? 5.0,
          createdBy: createdBy || "Anonymous",
        },
      });

      res.json({
        id: world.id,
        slug: world.slug,
        name: world.name,
        globeRadius: world.globeRadius,
        texture: world.texture,
        createdBy: world.createdBy,
      });
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

      res.json({
        id: world.id,
        slug: world.slug,
        name: world.name,
        globeRadius: world.globeRadius,
        texture: world.texture,
        createdBy: world.createdBy,
      });
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
        id: w.id,
        slug: w.slug,
        name: w.name,
        globeRadius: w.globeRadius,
        texture: w.texture,
        createdBy: w.createdBy,
        playerCount: roomManager.getRoomPlayerCount(w.slug),
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
