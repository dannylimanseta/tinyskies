import type { SocketClient } from "./SocketClient";
import type { Plane } from "../game/Plane";

const SEND_RATE_MS = 50; // 20 Hz

export class StateSync {
  private client: SocketClient;
  private plane: Plane;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(client: SocketClient, plane: Plane) {
    this.client = client;
    this.plane = plane;
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
      qx: this.plane.qPosition.x,
      qy: this.plane.qPosition.y,
      qz: this.plane.qPosition.z,
      qw: this.plane.qPosition.w,
      heading: this.plane.heading,
      pitch: this.plane.pitch,
      altitude: this.plane.altitude,
      speed: this.plane.speed,
      timestamp: Date.now(),
    });
  }
}
