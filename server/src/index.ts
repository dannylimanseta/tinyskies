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
import { generateUniqueWorldName } from "./utils/worldNames.js";

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const roomManager = new RoomManager();

app.use("/api/worlds", createWorldsRouter(prisma, roomManager));

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
  const existing = await prisma.world.findMany({ select: { name: true, createdBy: true } });
  const systemWorlds = existing.filter((w) => w.createdBy === "System");

  if (systemWorlds.length >= SEED_WORLD_COUNT) return;

  console.log(`Reseeding worlds (found ${systemWorlds.length} system worlds, need ${SEED_WORLD_COUNT})...`);
  await prisma.world.deleteMany({ where: { createdBy: "System" } });

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
