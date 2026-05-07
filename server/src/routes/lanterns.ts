import { Router } from "express";
import { lanternsByWorldSlug } from "../memoryStore.js";

export function createLanternsRouter() {
  const router = Router();

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

      lanternsByWorldSlug.set(worldSlug, (lanternsByWorldSlug.get(worldSlug) ?? 0) + count);

      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to add lanterns:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
