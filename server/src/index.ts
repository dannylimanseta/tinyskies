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

  socket.on("world:join", (slug, playerName, vehicle) => {
    console.log(`Player ${socket.id} joining world: ${slug}`);
    const v = vehicle === "boat" ? "boat" : "plane";
    roomManager.joinRoom(slug, socket, playerName, v);
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`GlobeFly server running on http://localhost:${PORT}`);
});
