import { io, Socket } from "socket.io-client";
import type {
  PaintballFiredEvent,
  PaintballHitEvent,
  PaintballUpgradeFlags,
  PlayerState,
  ServerToClientEvents,
  ClientToServerEvents,
  Vehicle,
} from "@globefly/shared";

export class SocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  constructor(serverUrl: string) {
    this.socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      transports: ["websocket"],
    });

    this.socket.on("connect", () => {
      console.log("Connected to server:", this.socket.id);
    });

    this.socket.on("disconnect", (reason) => {
      console.log("Disconnected:", reason);
    });
  }

  get id(): string {
    return this.socket.id ?? "";
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  joinWorld(slug: string, playerName: string, vehicle: Vehicle = "plane", reservationId?: string) {
    this.socket.emit("world:join", slug, playerName, vehicle, reservationId);
  }

  sendMove(state: Omit<PlayerState, "id">) {
    this.socket.emit("player:move", state);
  }

  emitPaintballFire() {
    this.socket.emit("paintball:fire");
  }

  emitPaintballSetUpgrades(flags: PaintballUpgradeFlags) {
    this.socket.emit("paintball:setUpgrades", flags);
  }

  onPaintballFired(cb: (ev: PaintballFiredEvent) => void) {
    this.socket.on("paintball:fired", cb);
  }

  onPaintballHit(cb: (ev: PaintballHitEvent) => void) {
    this.socket.on("paintball:hit", cb);
  }

  onPlayerJoined(cb: (player: PlayerState) => void) {
    this.socket.on("player:joined", cb);
  }

  onPlayerLeft(cb: (playerId: string) => void) {
    this.socket.on("player:left", cb);
  }

  onPlayerUpdate(cb: (player: PlayerState) => void) {
    this.socket.on("player:update", cb);
  }

  onWorldState(cb: (players: PlayerState[]) => void) {
    this.socket.on("world:state", cb);
  }

  onWorldFull(cb: (slug: string) => void) {
    this.socket.on("world:full", cb);
  }

  disconnect() {
    this.socket.disconnect();
  }
}
