import type { Socket } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@globefly/shared";
import { Room } from "./Room.js";

const EMPTY_ROOM_TTL_MS = 60_000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  getOrCreateRoom(slug: string): Room {
    let room = this.rooms.get(slug);
    if (!room) {
      room = new Room(slug);
      this.rooms.set(slug, room);
    }
    // Cancel any pending cleanup
    const timer = this.cleanupTimers.get(slug);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(slug);
    }
    return room;
  }

  joinRoom(
    slug: string,
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
    playerName: string,
  ) {
    const room = this.getOrCreateRoom(slug);
    room.addPlayer(socket, playerName);

    socket.on("player:move", (state) => {
      room.updatePlayer(socket.id, state);
    });

    socket.on("disconnect", () => {
      room.removePlayer(socket.id);
      if (room.isEmpty) {
        this.scheduleCleanup(slug);
      }
    });
  }

  private scheduleCleanup(slug: string) {
    const timer = setTimeout(() => {
      const room = this.rooms.get(slug);
      if (room && room.isEmpty) {
        this.rooms.delete(slug);
        this.cleanupTimers.delete(slug);
      }
    }, EMPTY_ROOM_TTL_MS);
    this.cleanupTimers.set(slug, timer);
  }

  getRoomPlayerCount(slug: string): number {
    return this.rooms.get(slug)?.playerCount ?? 0;
  }

  getActiveRoomSlugs(): string[] {
    return Array.from(this.rooms.keys()).filter(
      (slug) => (this.rooms.get(slug)?.playerCount ?? 0) > 0,
    );
  }
}
