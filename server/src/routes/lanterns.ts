import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

let cachedTotal: number | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5_000;

async function getTotal(prisma: PrismaClient): Promise<number> {
  const now = Date.now();
  if (cachedTotal !== null && now - cacheTime < CACHE_TTL_MS) {
    return cachedTotal;
  }
  const result = await prisma.lanternLedger.aggregate({
    _sum: { count: true },
  });
  cachedTotal = result._sum.count ?? 0;
  cacheTime = now;
  return cachedTotal;
}

export function createLanternsRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/total", async (_req, res) => {
    try {
      const total = await getTotal(prisma);
      res.json({ total });
    } catch (err) {
      console.error("Failed to get lantern total:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/add", async (req, res) => {
    try {
      const { count, worldSlug } = req.body;
      if (typeof count !== "number" || count < 1 || count > 30) {
        res.status(400).json({ error: "count must be 1-30" });
        return;
      }
      if (typeof worldSlug !== "string" || worldSlug.length === 0) {
        res.status(400).json({ error: "worldSlug is required" });
        return;
      }

      await prisma.lanternLedger.create({
        data: { count, worldSlug },
      });

      cachedTotal = null;
      const total = await getTotal(prisma);
      res.json({ total });
    } catch (err) {
      console.error("Failed to add lanterns:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
