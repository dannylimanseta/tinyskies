import type { Socket } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Vehicle,
} from "@globefly/shared";
import { Room, MAX_PLAYERS } from "./Room.js";
import { nanoid } from "nanoid";

const EMPTY_ROOM_TTL_MS = 60_000;
const RESERVATION_TTL_MS = 15_000;
const OVERFLOW_CLEANUP_INTERVAL_MS = 300_000;

interface Reservation {
  slug: string;
  timer: ReturnType<typeof setTimeout>;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private worldSlugs: string[] = [];
  private seededSlugs = new Set<string>();
  private reservations = new Map<string, Reservation>();
  private overflowCleanupTimer?: ReturnType<typeof setInterval>;

  async loadWorldSlugs(prisma: PrismaClient) {
    const worlds = await prisma.world.findMany({ select: { slug: true } });
    this.worldSlugs = worlds.map((w) => w.slug);
    this.seededSlugs = new Set(this.worldSlugs);
  }

  addWorldSlug(slug: string) {
    this.worldSlugs.push(slug);
  }

  getOrCreateRoom(
    slug: string,
    globeRadius: number,
    worldSeed: number,
    terrainType: string,
  ): Room {
    let room = this.rooms.get(slug);
    if (!room) {
      room = new Room(slug, globeRadius, worldSeed, terrainType);
      this.rooms.set(slug, room);
    }
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
    vehicle: Vehicle = "plane",
    reservationId?: string,
    globeRadius = 5,
    worldSeed = 0,
    terrainType = "default",
  ) {
    if (reservationId) {
      this.confirmReservation(reservationId);
    }

    const room = this.getOrCreateRoom(slug, globeRadius, worldSeed, terrainType);

    if (room.isFull) {
      socket.emit("world:full", slug);
      return;
    }

    const state = room.addPlayer(socket, playerName, vehicle);
    if (!state) {
      socket.emit("world:full", slug);
      return;
    }

    socket.on("player:move", (moveState) => {
      room.updatePlayer(socket.id, moveState);
    });

    socket.on("paintball:fire", () => {
      room.firePaintball(socket.id);
    });

    socket.on("paintball:setUpgrades", (flags) => {
      room.setPaintballUpgrades(socket.id, flags);
    });

    socket.on("flag:setSuppressed", (suppressed) => {
      room.setFlagSuppressed(socket.id, suppressed === true);
    });

    socket.on("debug:forceFlagSpawn", () => {
      room.forceFlagSpawn();
    });

    socket.on("disconnect", () => {
      room.removePlayer(socket.id);
      if (room.isEmpty) {
        this.scheduleCleanup(slug);
      }
    });
  }

  /* ── Reservations ─────────────────────────────────────────────── */

  private getReservedCount(slug: string): number {
    let count = 0;
    for (const r of this.reservations.values()) {
      if (r.slug === slug) count++;
    }
    return count;
  }

  getEffectiveCount(slug: string): number {
    return this.getRoomPlayerCount(slug) + this.getReservedCount(slug);
  }

  reserveSlot(slug: string): string | null {
    if (this.getEffectiveCount(slug) >= MAX_PLAYERS) return null;

    const id = nanoid(12);
    const timer = setTimeout(() => {
      this.reservations.delete(id);
    }, RESERVATION_TTL_MS);

    this.reservations.set(id, { slug, timer });
    return id;
  }

  private confirmReservation(reservationId: string) {
    const reservation = this.reservations.get(reservationId);
    if (reservation) {
      clearTimeout(reservation.timer);
      this.reservations.delete(reservationId);
    }
  }

  /* ── World finding ────────────────────────────────────────────── */

  findBestWorld(): string | null {
    let bestSlug: string | null = null;
    let bestCount = -1;

    for (const slug of this.worldSlugs) {
      const count = this.getEffectiveCount(slug);
      if (count < MAX_PLAYERS && count > bestCount) {
        bestCount = count;
        bestSlug = slug;
      }
    }

    return bestSlug;
  }

  /* ── Overflow cleanup ─────────────────────────────────────────── */

  startOverflowCleanup(prisma: PrismaClient) {
    this.overflowCleanupTimer = setInterval(async () => {
      const toRemove: string[] = [];

      for (const slug of this.worldSlugs) {
        if (this.seededSlugs.has(slug)) continue;
        if (this.getEffectiveCount(slug) === 0) {
          toRemove.push(slug);
        }
      }

      if (toRemove.length === 0) return;

      try {
        await prisma.world.deleteMany({
          where: { slug: { in: toRemove } },
        });
        this.worldSlugs = this.worldSlugs.filter(
          (s) => !toRemove.includes(s),
        );
        for (const slug of toRemove) {
          this.rooms.delete(slug);
          const ct = this.cleanupTimers.get(slug);
          if (ct) {
            clearTimeout(ct);
            this.cleanupTimers.delete(slug);
          }
        }
        if (toRemove.length > 0) {
          console.log(`Cleaned up ${toRemove.length} overflow world(s)`);
        }
      } catch (err) {
        console.error("Overflow cleanup failed:", err);
      }
    }, OVERFLOW_CLEANUP_INTERVAL_MS);
  }

  stopOverflowCleanup() {
    if (this.overflowCleanupTimer) {
      clearInterval(this.overflowCleanupTimer);
    }
  }

  /* ── Helpers ──────────────────────────────────────────────────── */

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

  getAllWorldSlugs(): string[] {
    return this.worldSlugs;
  }
}
