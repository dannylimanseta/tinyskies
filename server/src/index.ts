import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@globefly/shared";
import { nanoid } from "nanoid";
import { RoomManager } from "./rooms/RoomManager.js";
import { createWorldsRouter } from "./routes/worlds.js";
import { createLanternsRouter } from "./routes/lanterns.js";
import { createSaveFeedRouter } from "./routes/saveFeed.js";
import { createEventsRouter } from "./routes/events.js";
import { generateUniqueWorldName } from "./utils/worldNames.js";

const PORT = Number(process.env.PORT) || 3001;

/** Origins for REST + Socket.io. Always allow known Vercel deploys + local dev; merge CLIENT_URL (comma-separated for extras). */
function corsAllowedOrigins(): string[] {
  const defaults = [
    "http://localhost:5173",
    "https://tinyskies.vercel.app",
    "https://globefly.vercel.app",
  ];
  const fromEnv = process.env.CLIENT_URL;
  const extra = fromEnv
    ? fromEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return [...new Set([...defaults, ...extra])];
}

const corsOrigins = corsAllowedOrigins();

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / non-browser
  if (corsOrigins.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === "vercel.app" || host.endsWith(".vercel.app")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: (origin, cb) => {
      cb(null, isAllowedCorsOrigin(origin));
    },
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin: (origin, cb) => {
      cb(null, isAllowedCorsOrigin(origin));
    },
  }),
);
app.use(express.json());

const roomManager = new RoomManager();

const DASHBOARD_META_CACHE_MS = 30_000;
type DashboardWorldMeta = { slug: string; name: string; createdBy: string };
let dashboardWorldMetaCacheUntil = 0;
let dashboardWorldMetaCache = new Map<string, DashboardWorldMeta>();

async function loadDashboardWorldMeta(activeSlugs: string[]): Promise<Map<string, DashboardWorldMeta>> {
  if (activeSlugs.length === 0) return new Map();
  const now = Date.now();
  const cacheCoversActive = activeSlugs.every((slug) => dashboardWorldMetaCache.has(slug));
  if (now < dashboardWorldMetaCacheUntil && cacheCoversActive) {
    return dashboardWorldMetaCache;
  }

  const worlds = await prisma.world.findMany({
    where: { slug: { in: activeSlugs } },
    select: { slug: true, name: true, createdBy: true },
  });
  dashboardWorldMetaCache = new Map(
    worlds.map((world) => [
      world.slug,
      {
        slug: world.slug,
        name: world.name,
        createdBy: world.createdBy,
      },
    ]),
  );
  dashboardWorldMetaCacheUntil = now + DASHBOARD_META_CACHE_MS;
  return dashboardWorldMetaCache;
}

app.use("/api/worlds", createWorldsRouter(prisma, roomManager));
app.use("/api/lanterns", createLanternsRouter(prisma));
app.use("/api/save-feed", createSaveFeedRouter(prisma));
app.use("/api/events", createEventsRouter(prisma));

app.get("/api/dashboard/worlds", async (_req, res) => {
  try {
    const activeSlugs = roomManager
      .getActiveRoomSlugs()
      .sort((a, b) => roomManager.getRoomPlayerCount(b) - roomManager.getRoomPlayerCount(a));
    const meta = await loadDashboardWorldMeta(activeSlugs);
    const worlds = activeSlugs.map((slug) => {
      const m = meta.get(slug);
      const playerCount = roomManager.getRoomPlayerCount(slug);
      return {
        slug,
        name: m?.name ?? slug,
        createdBy: m?.createdBy ?? "Unknown",
        playerCount,
        effectiveCount: roomManager.getEffectiveCount(slug),
      };
    });

    res.setHeader("Cache-Control", "no-store");
    res.json({
      generatedAt: new Date().toISOString(),
      totalPlayers: worlds.reduce((sum, world) => sum + world.playerCount, 0),
      activeWorlds: worlds.length,
      worlds,
    });
  } catch (err) {
    console.error("Dashboard status failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/dashboard", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Tiny Skies World Dashboard</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #0b0f17;
      color: #eef3ff;
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: clamp(1.45rem, 4vw, 2rem); line-height: 1.1; }
    .muted { color: rgba(238, 243, 255, 0.58); }
    .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .card, table {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 14px;
    }
    .card { padding: 14px 16px; }
    .card strong { display: block; font-size: 1.5rem; line-height: 1.1; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { padding: 12px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); text-align: left; }
    th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(238, 243, 255, 0.55); }
    tr:last-child td { border-bottom: 0; }
    code { color: #a6d5ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .right { text-align: right; }
    .empty { padding: 30px 18px; text-align: center; }
    .history { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
    .panel { background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 14px; padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 1rem; }
    .event-list { display: grid; gap: 10px; }
    .event { padding-bottom: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
    .event:last-child { padding-bottom: 0; border-bottom: 0; }
    .event-title { font-weight: 700; }
    .event-meta { margin-top: 2px; font-size: 0.82rem; color: rgba(238, 243, 255, 0.56); }
    .totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
    @media (max-width: 640px) {
      header { display: block; }
      .cards, .history, .totals { grid-template-columns: 1fr; }
      th:nth-child(3), td:nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Tiny Skies World Dashboard</h1>
        <div class="muted">Live in-memory room counts. Refreshes every 5 seconds.</div>
      </div>
      <div class="muted" id="updated">Loading...</div>
    </header>

    <section class="cards">
      <div class="card"><span class="muted">Players Online</span><strong id="totalPlayers">0</strong></div>
      <div class="card"><span class="muted">Active Worlds</span><strong id="activeWorlds">0</strong></div>
      <div class="card"><span class="muted">Poll Interval</span><strong>5s</strong></div>
    </section>

    <table>
      <thead>
        <tr>
          <th>World</th>
          <th>Slug</th>
          <th>Created By</th>
          <th class="right">Players</th>
          <th class="right">Players + Reserved</th>
        </tr>
      </thead>
      <tbody id="worldRows">
        <tr><td colspan="5" class="empty muted">Loading active worlds...</td></tr>
      </tbody>
    </table>

    <section class="totals" id="historyTotals"></section>

    <section class="history">
      <div class="panel">
        <h2>Hall of Saviors</h2>
        <div id="worldSaves" class="event-list"><div class="muted">Loading...</div></div>
      </div>
      <div class="panel">
        <h2>Recent Quest Completions</h2>
        <div id="questCompletions" class="event-list"><div class="muted">Loading...</div></div>
      </div>
    </section>
  </main>
  <script>
    const rows = document.getElementById("worldRows");
    const totalPlayers = document.getElementById("totalPlayers");
    const activeWorlds = document.getElementById("activeWorlds");
    const updated = document.getElementById("updated");
    const historyTotals = document.getElementById("historyTotals");
    const worldSaves = document.getElementById("worldSaves");
    const questCompletions = document.getElementById("questCompletions");

    function cell(text, className) {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      return td;
    }

    async function refresh() {
      try {
        const [res, historyRes] = await Promise.all([
          fetch("/api/dashboard/worlds", { cache: "no-store" }),
          fetch("/api/events/dashboard", { cache: "no-store" }),
        ]);
        if (!res.ok || !historyRes.ok) throw new Error("dashboard fetch failed");
        const data = await res.json();
        const history = await historyRes.json();
        totalPlayers.textContent = String(data.totalPlayers ?? 0);
        activeWorlds.textContent = String(data.activeWorlds ?? 0);
        updated.textContent = "Updated " + new Date(data.generatedAt).toLocaleTimeString();
        renderHistory(history);
        rows.replaceChildren();
        if (!data.worlds || data.worlds.length === 0) {
          const tr = document.createElement("tr");
          const td = cell("No active worlds right now.", "empty muted");
          td.colSpan = 5;
          tr.appendChild(td);
          rows.appendChild(tr);
          return;
        }
        for (const world of data.worlds) {
          const tr = document.createElement("tr");
          tr.appendChild(cell(world.name || world.slug));
          const slug = document.createElement("td");
          const code = document.createElement("code");
          code.textContent = world.slug;
          slug.appendChild(code);
          tr.appendChild(slug);
          tr.appendChild(cell(world.createdBy || "Unknown"));
          tr.appendChild(cell(String(world.playerCount ?? 0), "right"));
          tr.appendChild(cell(String(world.effectiveCount ?? world.playerCount ?? 0), "right"));
          rows.appendChild(tr);
        }
      } catch (err) {
        updated.textContent = "Update failed";
        console.error(err);
      }
    }

    function titleize(value) {
      return String(value || "unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function totalsMap(rows) {
      const out = new Map();
      for (const row of rows || []) out.set(row.type, row);
      return out;
    }

    function renderHistory(history) {
      const all = totalsMap(history.totals);
      const today = totalsMap(history.todayTotals);
      const totalPlaytime =
        (all.get("session_heartbeat")?.durationSec ?? 0) +
        (all.get("session_ended")?.durationSec ?? 0);
      const todayPlaytime =
        (today.get("session_heartbeat")?.durationSec ?? 0) +
        (today.get("session_ended")?.durationSec ?? 0);
      const cards = [
        ["World Saves", all.get("world_saved")?.count ?? 0, "Today: " + (today.get("world_saved")?.count ?? 0)],
        ["Quest Completions", all.get("quest_completed")?.count ?? 0, "Today: " + (today.get("quest_completed")?.count ?? 0)],
        ["Total Playtime", formatDuration(totalPlaytime), "Today: " + formatDuration(todayPlaytime)],
        ["Top Vehicle", topVehicle(history.vehicleCounts), "Milestone events"],
      ];
      historyTotals.replaceChildren(...cards.map(([label, value, sub]) => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = '<span class="muted"></span><strong></strong><div class="muted"></div>';
        div.children[0].textContent = label;
        div.children[1].textContent = value;
        div.children[2].textContent = sub;
        return div;
      }));
      renderEventList(worldSaves, history.recentWorldSaves, "No world saves recorded yet.");
      renderEventList(questCompletions, history.recentQuestCompletions, "No quest completions recorded yet.");
    }

    function topVehicle(rows) {
      const top = (rows || [])[0];
      return top?.vehicle ? titleize(top.vehicle) : "None yet";
    }

    function formatDuration(sec) {
      sec = Math.max(0, Math.round(Number(sec) || 0));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      if (h > 0) return h + "h " + m + "m";
      return m + "m";
    }

    function renderEventList(root, events, emptyText) {
      root.replaceChildren();
      if (!events || events.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = emptyText;
        root.appendChild(empty);
        return;
      }
      for (const event of events) {
        const div = document.createElement("div");
        div.className = "event";
        const meta = event.metadata || {};
        const title = document.createElement("div");
        title.className = "event-title";
        title.textContent = (event.playerName || "Pilot") + " · " + titleize(meta.milestone || meta.questType || event.type);
        const detail = document.createElement("div");
        detail.className = "event-meta";
        detail.textContent = [
          event.worldName || event.worldSlug,
          event.vehicle ? titleize(event.vehicle) : "",
          event.level ? "Lvl " + event.level : "",
          event.runDurationSec != null ? formatDuration(event.runDurationSec) : "",
          new Date(event.createdAt).toLocaleString(),
        ].filter(Boolean).join(" · ");
        div.appendChild(title);
        div.appendChild(detail);
        root.appendChild(div);
      }
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("world:join", async (slug, playerName, vehicle, reservationId) => {
    console.log(`Player ${socket.id} joining world: ${slug}`);
    const v = vehicle === "boat" ? "boat" : vehicle === "carpet" ? "carpet" : "plane";
    let globeRadius = 5;
    let worldSeed = 0;
    let terrainType = "default";
    try {
      const world = await prisma.world.findUnique({ where: { slug } });
      if (world) {
        globeRadius = world.globeRadius;
        worldSeed = world.seed;
        terrainType = world.terrainType;
      }
    } catch (err) {
      console.warn("world:join globeRadius lookup failed:", err);
    }
    roomManager.joinRoom(slug, socket, playerName, v, reservationId, globeRadius, worldSeed, terrainType);
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const SEED_WORLD_COUNT = 20;

async function ensureWorldsSeeded() {
  const worlds = await prisma.world.findMany({
    select: { name: true, createdBy: true },
  });
  const systemCount = worlds.filter((world) => world.createdBy === "System").length;
  const missingCount = Math.max(0, SEED_WORLD_COUNT - systemCount);

  if (missingCount === 0) return;

  console.log(
    `Seeding ${missingCount} missing system world(s) ` +
    `(${worlds.length} total, ${systemCount} system)...`,
  );

  const usedNames = new Set(worlds.map((world) => world.name));
  const toCreate = [];
  for (let i = 0; i < missingCount; i++) {
    const name = generateUniqueWorldName(usedNames);
    usedNames.add(name);
    toCreate.push({
      slug: nanoid(10),
      name,
      texture: "earth",
      globeRadius: 5.0,
      seed: Math.floor(Math.random() * 2147483647),
      terrainType: "default",
      createdBy: "System",
    });
  }

  await prisma.world.createMany({ data: toCreate });
  console.log(`Seeded ${toCreate.length} system world(s)`);
}

async function bootstrap() {
  await ensureWorldsSeeded();
  await roomManager.loadWorldSlugs(prisma);
  console.log(`Loaded ${roomManager.getAllWorldSlugs().length} world(s) into cache`);
  roomManager.startOverflowCleanup(prisma);

  httpServer.listen(PORT, () => {
    console.log(`Tiny Skies server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
