import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@globefly/shared";
import { RoomManager } from "./rooms/RoomManager.js";
import { createWorldsRouter } from "./routes/worlds.js";

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

async function bootstrap() {
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
