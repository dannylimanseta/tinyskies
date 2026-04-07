import type { SocketClient } from "./SocketClient";
import type { Quaternion } from "three";
import type { Vehicle } from "@globefly/shared";

const SEND_RATE_MS = 50; // 20 Hz

export type SyncablePlayer = {
  qPosition: Quaternion;
  heading: number;
  pitch: number;
  altitude: number;
  speed: number;
  bankAngle: number;
  rollAngle: number;
  vehicle: Vehicle;
  carrying?: boolean;
};

export class StateSync {
  private client: SocketClient;
  private player: SyncablePlayer;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(client: SocketClient, player: SyncablePlayer) {
    this.client = client;
    this.player = player;
  }

  start() {
    this.interval = setInterval(() => this.send(), SEND_RATE_MS);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private send() {
    if (!this.client.connected) return;

    this.client.sendMove({
      name: "",
      vehicle: this.player.vehicle,
      qx: this.player.qPosition.x,
      qy: this.player.qPosition.y,
      qz: this.player.qPosition.z,
      qw: this.player.qPosition.w,
      heading: this.player.heading,
      pitch: this.player.pitch,
      altitude: this.player.altitude,
      speed: this.player.speed,
      bankAngle: this.player.bankAngle + this.player.rollAngle,
      rollAngle: this.player.rollAngle,
      carrying: this.player.carrying,
      timestamp: Date.now(),
    });
  }
}
