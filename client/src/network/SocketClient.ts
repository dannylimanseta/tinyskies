import { io, Socket } from "socket.io-client";
import type {
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

  joinWorld(slug: string, playerName: string, vehicle: Vehicle = "plane") {
    this.socket.emit("world:join", slug, playerName, vehicle);
  }

  sendMove(state: Omit<PlayerState, "id">) {
    this.socket.emit("player:move", state);
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

  disconnect() {
    this.socket.disconnect();
  }
}
