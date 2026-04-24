import { Quaternion, Vector3, Matrix4 } from "three";
import type { PlayerState } from "@globefly/shared";

const _v = new Vector3();
const _q = new Quaternion();

const REF_UP = new Vector3(0, 1, 0);

export interface TangentFrame {
  up: Vector3;
  north: Vector3;
  east: Vector3;
}

/**
 * Given a position quaternion, returns the local tangent frame
 * (up = radial, north = tangent toward pole, east = tangent eastward).
 */
/** Maps local +Y up to surface normal `(nx,ny,nz)` (unit). */
export function quaternionFromSurfaceNormal(nx: number, ny: number, nz: number): Quaternion {
  const n = new Vector3(nx, ny, nz).normalize();
  return new Quaternion().setFromUnitVectors(REF_UP, n);
}

/** Park–Miller LCG — deterministic stream from an integer seed. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Uniform random surface orientation + horizontal heading (radians).
 * Used for plane/carpet spawn; combine world `seed` with a per-session salt.
 */
export function randomSpawnQuaternionAndHeading(seed: number): {
  qPosition: Quaternion;
  heading: number;
} {
  const rnd = seededRandom(seed + 1337);
  const theta = rnd() * Math.PI * 2;
  const phi = Math.acos(2 * rnd() - 1);
  const nx = Math.sin(phi) * Math.cos(theta);
  const ny = Math.sin(phi) * Math.sin(theta);
  const nz = Math.cos(phi);
  return {
    qPosition: quaternionFromSurfaceNormal(nx, ny, nz),
    heading: rnd() * Math.PI * 2,
  };
}

export function tangentFrame(qPosition: Quaternion): TangentFrame {
  const up = REF_UP.clone().applyQuaternion(qPosition).normalize();

  // "North" is the tangent direction toward the reference pole.
  // We derive it by rotating the reference "north tangent" (0, 0, -1) at the pole.
  const north = new Vector3(0, 0, -1).applyQuaternion(qPosition).normalize();

  const east = new Vector3().crossVectors(up, north).normalize();
  // Re-orthogonalize north against up and east
  north.crossVectors(east, up).normalize();

  return { up, north, east };
}

/**
 * Advance a position quaternion along a great-circle arc.
 * `heading` is in radians (0 = north, PI/2 = east).
 * `arcAngle` is the arc distance in radians (distance / globeRadius).
 */
export function moveOnSphere(
  qPosition: Quaternion,
  heading: number,
  arcAngle: number,
): Quaternion {
  if (Math.abs(arcAngle) < 1e-10) return qPosition.clone();

  const frame = tangentFrame(qPosition);

  // Direction on tangent plane based on heading
  const dir = new Vector3()
    .addScaledVector(frame.north, Math.cos(heading))
    .addScaledVector(frame.east, Math.sin(heading))
    .normalize();

  // Rotation axis is perpendicular to both up and direction: up x dir
  // But we want to rotate the position around this axis by arcAngle
  // The axis for great-circle motion in `dir` direction is: dir x up (right-hand rule)
  const axis = new Vector3().crossVectors(dir, frame.up).normalize();

  _q.setFromAxisAngle(axis, -arcAngle);

  return qPosition.clone().premultiply(_q);
}

/**
 * Convert a position quaternion + altitude to a Cartesian world position.
 */
export function cartesianFromSpherical(
  qPosition: Quaternion,
  altitude: number,
  globeRadius: number,
): Vector3 {
  return REF_UP.clone()
    .multiplyScalar(globeRadius + altitude)
    .applyQuaternion(qPosition);
}

/**
 * World ray from plane nose — must stay aligned with server `paintball/hitTest` and {@link buildPlaneMatrix}.
 */
export function paintballRayFromPlaneState(
  qPosition: Quaternion,
  heading: number,
  pitch: number,
  altitude: number,
  globeRadius: number,
): { origin: Vector3; direction: Vector3 } {
  const origin = cartesianFromSpherical(qPosition, altitude, globeRadius);
  const frame = tangentFrame(qPosition);
  const forward = new Vector3()
    .addScaledVector(frame.north, Math.cos(heading))
    .addScaledVector(frame.east, Math.sin(heading))
    .normalize();
  const right = new Vector3().crossVectors(forward, frame.up).normalize();
  const pitchQ = _q.setFromAxisAngle(right, -pitch);
  const direction = forward.clone().applyQuaternion(pitchQ).normalize();
  return { origin, direction };
}

/**
 * Build the full 4x4 world matrix for rendering a plane.
 * Composes position (on sphere) with orientation (heading, pitch, bank in local frame).
 */
export function buildPlaneMatrix(
  qPosition: Quaternion,
  heading: number,
  pitch: number,
  bankAngle: number,
  altitude: number,
  globeRadius: number,
): Matrix4 {
  const frame = tangentFrame(qPosition);

  // Forward direction on tangent plane from heading
  const forward = new Vector3()
    .addScaledVector(frame.north, Math.cos(heading))
    .addScaledVector(frame.east, Math.sin(heading))
    .normalize();

  const right = new Vector3().crossVectors(forward, frame.up).normalize();

  // Apply pitch: rotate forward around right axis
  const pitchQ = _q.setFromAxisAngle(right, -pitch);
  const pitchedForward = forward.clone().applyQuaternion(pitchQ).normalize();
  const pitchedUp = frame.up.clone().applyQuaternion(pitchQ).normalize();

  // Apply bank: rotate around forward axis
  const bankQ = new Quaternion().setFromAxisAngle(pitchedForward, bankAngle);
  const bankedRight = right.clone().applyQuaternion(bankQ).normalize();
  const bankedUp = pitchedUp.clone().applyQuaternion(bankQ).normalize();

  const pos = cartesianFromSpherical(qPosition, altitude, globeRadius);

  // Construct rotation matrix from basis vectors
  // Three.js Matrix4 is column-major: [right, up, -forward] for a standard basis
  const m = new Matrix4();
  m.makeBasis(bankedRight, bankedUp, pitchedForward.negate());
  m.setPosition(pos);

  return m;
}

/**
 * Carpet in the cosmic void: a fixed 2D “floor” in world space (tangent plane at void entry,
 * u/v in north/east), no spherical drift.
 */
export function buildCarpetMatrixVoidPlane(
  worldPos: Vector3,
  voidNorth: Vector3,
  voidEast: Vector3,
  voidUp: Vector3,
  heading: number,
  pitch: number,
  bankAngle: number,
  rollExtra: number,
): Matrix4 {
  const forward = new Vector3()
    .addScaledVector(voidNorth, Math.cos(heading))
    .addScaledVector(voidEast, Math.sin(heading))
    .normalize();
  const right = new Vector3().crossVectors(forward, voidUp).normalize();
  const pitchQ = _q.setFromAxisAngle(right, -pitch);
  const pitchedForward = forward.clone().applyQuaternion(pitchQ).normalize();
  const pitchedUp = voidUp.clone().applyQuaternion(pitchQ).normalize();
  const totalRoll = bankAngle + rollExtra;
  const bankQ = new Quaternion().setFromAxisAngle(pitchedForward, totalRoll);
  const bankedRight = right.clone().applyQuaternion(bankQ).normalize();
  const bankedUp = pitchedUp.clone().applyQuaternion(bankQ).normalize();
  const m = new Matrix4();
  m.makeBasis(bankedRight, bankedUp, pitchedForward.negate());
  m.setPosition(worldPos);
  return m;
}

/**
 * Hull on the tangent plane with small pitch/roll for bobbing — +Z forward in local space.
 */
export function buildBoatMatrix(
  qPosition: Quaternion,
  heading: number,
  altitude: number,
  globeRadius: number,
  pitch: number = 0,
  roll: number = 0,
): Matrix4 {
  return buildPlaneMatrix(qPosition, heading, pitch, roll, altitude, globeRadius);
}

/**
 * Interpolate between two angles (radians) taking the shortest path.
 * Handles wrapping at 0/2PI correctly.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  // Normalize diff to [-PI, PI]
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Sphere-safe interpolation between two player states.
 * Uses slerp for position quaternion, lerpAngle for heading, linear lerp for the rest.
 */
export function slerpPlayerState(
  a: PlayerState,
  b: PlayerState,
  t: number,
): Pick<PlayerState, "qx" | "qy" | "qz" | "qw" | "heading" | "pitch" | "altitude" | "speed" | "bankAngle" | "rollAngle"> {
  const qA = new Quaternion(a.qx, a.qy, a.qz, a.qw);
  const qB = new Quaternion(b.qx, b.qy, b.qz, b.qw);
  const qResult = qA.slerp(qB, t);

  return {
    qx: qResult.x,
    qy: qResult.y,
    qz: qResult.z,
    qw: qResult.w,
    heading: lerpAngle(a.heading, b.heading, t),
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    altitude: a.altitude + (b.altitude - a.altitude) * t,
    speed: a.speed + (b.speed - a.speed) * t,
    bankAngle: lerpAngle(a.bankAngle, b.bankAngle, t),
    rollAngle: lerpAngle(a.rollAngle, b.rollAngle, t),
  };
}

/**
 * Dead-reckon a player state forward by `elapsed` seconds.
 * Continues the great-circle arc at the last known heading/speed.
 */
export function deadReckon(
  state: PlayerState,
  elapsed: number,
  globeRadius: number,
  minAlt: number,
  maxAlt: number,
): Pick<PlayerState, "qx" | "qy" | "qz" | "qw" | "heading" | "pitch" | "altitude" | "speed" | "bankAngle" | "rollAngle"> {
  const qPos = new Quaternion(state.qx, state.qy, state.qz, state.qw);

  const arcAngle =
    (Math.cos(state.pitch) * state.speed * elapsed) / globeRadius;
  const predicted = moveOnSphere(qPos, state.heading, arcAngle);

  const predictedAlt = Math.max(
    minAlt,
    Math.min(maxAlt, state.altitude + Math.sin(state.pitch) * state.speed * elapsed),
  );

  return {
    qx: predicted.x,
    qy: predicted.y,
    qz: predicted.z,
    qw: predicted.w,
    heading: state.heading,
    pitch: state.pitch,
    altitude: predictedAlt,
    speed: state.speed,
    bankAngle: state.bankAngle,
    rollAngle: state.rollAngle,
  };
}
