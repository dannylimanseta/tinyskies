import { Quaternion, Vector3 } from "three";
import type { PlayerState } from "@globefly/shared";
import {
  PAINTBALL_COLOR_PALETTE,
  PAINTBALL_HIT_RADIUS,
  PAINTBALL_RANGE_FACTOR,
  PAINTBALL_SPEED,
} from "./constants.js";

const REF_UP = new Vector3(0, 1, 0);
const _q = new Quaternion();

function tangentFrame(qPosition: Quaternion): { up: Vector3; north: Vector3; east: Vector3 } {
  const up = REF_UP.clone().applyQuaternion(qPosition).normalize();
  const north = new Vector3(0, 0, -1).applyQuaternion(qPosition).normalize();
  const east = new Vector3().crossVectors(up, north).normalize();
  north.crossVectors(east, up).normalize();
  return { up, north, east };
}

export function cartesianFromSpherical(
  qPosition: Quaternion,
  altitude: number,
  globeRadius: number,
): Vector3 {
  return REF_UP.clone()
    .multiplyScalar(globeRadius + altitude)
    .applyQuaternion(qPosition);
}

/** Forward from nose after pitch (matches client buildPlaneMatrix; bank rolls around this axis). */
function planeForward(state: PlayerState, qPos: Quaternion): Vector3 {
  const frame = tangentFrame(qPos);
  const forward = new Vector3()
    .addScaledVector(frame.north, Math.cos(state.heading))
    .addScaledVector(frame.east, Math.sin(state.heading))
    .normalize();
  const right = new Vector3().crossVectors(forward, frame.up).normalize();
  const pitchQ = _q.setFromAxisAngle(right, -state.pitch);
  return forward.clone().applyQuaternion(pitchQ).normalize();
}

function rayPointClosestDistance(
  origin: Vector3,
  dir: Vector3,
  maxRange: number,
  point: Vector3,
): number {
  const op = new Vector3().subVectors(point, origin);
  let t = op.dot(dir);
  if (t < 0) t = 0;
  if (t > maxRange) t = maxRange;
  const closest = origin.clone().add(dir.clone().multiplyScalar(t));
  return point.distanceTo(closest);
}

export interface PaintballShotResult {
  fired: {
    ox: number;
    oy: number;
    oz: number;
    dx: number;
    dy: number;
    dz: number;
    speed: number;
    rangeMult: number;
    color: number;
  };
  hit: { victimId: string; color: number; splatSeed: number } | null;
}

export interface PaintballShotParams {
  /** Sharpshooter speed multiplier (already clamped by caller). */
  speedMult: number;
  /** Sharpshooter range multiplier (already clamped by caller). */
  rangeMult: number;
}

/**
 * Server-side hit test: ray from shooter's nose along pitched forward, sphere segment up to max range.
 */
export function computePaintballShot(
  shooter: PlayerState,
  shooterId: string,
  others: { id: string; state: PlayerState }[],
  globeRadius: number,
  params: PaintballShotParams = { speedMult: 1, rangeMult: 1 },
): PaintballShotResult {
  const q = new Quaternion(shooter.qx, shooter.qy, shooter.qz, shooter.qw);
  const origin = cartesianFromSpherical(q, shooter.altitude, globeRadius);
  const dir = planeForward(shooter, q);
  const maxRange = globeRadius * PAINTBALL_RANGE_FACTOR * params.rangeMult;
  const shotSpeed = PAINTBALL_SPEED * params.speedMult;

  const shotColor =
    PAINTBALL_COLOR_PALETTE[Math.floor(Math.random() * PAINTBALL_COLOR_PALETTE.length)]!;
  const splatSeed = (Math.random() * 0xffffffff) >>> 0;

  let best: { id: string; dist: number } | null = null;
  for (const { id, state } of others) {
    if (id === shooterId) continue;
    const v = state.vehicle === "boat" ? "boat" : state.vehicle === "carpet" ? "carpet" : "plane";
    if (v !== "plane") continue;

    const tq = new Quaternion(state.qx, state.qy, state.qz, state.qw);
    const targetPos = cartesianFromSpherical(tq, state.altitude, globeRadius);
    const dist = rayPointClosestDistance(origin, dir, maxRange, targetPos);
    if (dist < PAINTBALL_HIT_RADIUS) {
      if (!best || dist < best.dist) {
        best = { id, dist };
      }
    }
  }

  return {
    fired: {
      ox: origin.x,
      oy: origin.y,
      oz: origin.z,
      dx: dir.x,
      dy: dir.y,
      dz: dir.z,
      speed: shotSpeed,
      rangeMult: params.rangeMult,
      color: shotColor,
    },
    hit: best
      ? {
          victimId: best.id,
          color: shotColor,
          splatSeed,
        }
      : null,
  };
}
