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

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

const roomManager = new RoomManager();

app.use("/api/worlds", createWorldsRouter(prisma, roomManager));
app.use("/api/lanterns", createLanternsRouter(prisma));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("world:join", (slug, playerName, vehicle, reservationId) => {
    console.log(`Player ${socket.id} joining world: ${slug}`);
    const v = vehicle === "boat" ? "boat" : vehicle === "carpet" ? "carpet" : "plane";
    roomManager.joinRoom(slug, socket, playerName, v, reservationId);
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const SEED_WORLD_COUNT = 20;

async function ensureWorldsSeeded() {
  const total = await prisma.world.count();
  const systemCount = await prisma.world.count({ where: { createdBy: "System" } });

  if (systemCount >= SEED_WORLD_COUNT && total === systemCount) return;

  console.log(`Reseeding worlds (${total} total, ${systemCount} system — need exactly ${SEED_WORLD_COUNT})...`);
  await prisma.world.deleteMany();

  const usedNames = new Set<string>();
  const toCreate = [];
  for (let i = 0; i < SEED_WORLD_COUNT; i++) {
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
  console.log(`Seeded ${toCreate.length} fresh world(s)`);
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
