import { Router } from "express";
import { addSaveFeedEntry, saveFeedEntries } from "../memoryStore.js";

const MAX_NAME = 48;
const MAX_WORLD = 80;
const MAX_SLUG = 32;
const MAX_RECENT = 5;

function trimStr(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

export function createSaveFeedRouter() {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const limitRaw = req.query.limit;
      const n =
        typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
          ? Math.min(MAX_RECENT, Math.max(1, parseInt(limitRaw, 10)))
          : MAX_RECENT;

      const entries = saveFeedEntries
        .slice(0, n)
        .map(({ playerName, worldName, createdAt }) => ({ playerName, worldName, createdAt }));

      res.json({ entries });
    } catch (err) {
      console.error("save-feed GET failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const playerName = trimStr(req.body?.playerName, MAX_NAME);
      const worldName = trimStr(req.body?.worldName, MAX_WORLD);
      const worldSlug = trimStr(req.body?.worldSlug, MAX_SLUG);

      if (playerName.length === 0 || worldName.length === 0) {
        res.status(400).json({ error: "playerName and worldName are required" });
        return;
      }
      if (worldSlug.length === 0) {
        res.status(400).json({ error: "worldSlug is required" });
        return;
      }

      addSaveFeedEntry({ playerName, worldName, worldSlug, createdAt: new Date() });

      res.json({ ok: true });
    } catch (err) {
      console.error("save-feed POST failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
