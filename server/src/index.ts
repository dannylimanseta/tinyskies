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

app.use("/api/worlds", createWorldsRouter(prisma, roomManager));
app.use("/api/lanterns", createLanternsRouter(prisma));
app.use("/api/save-feed", createSaveFeedRouter(prisma));

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
