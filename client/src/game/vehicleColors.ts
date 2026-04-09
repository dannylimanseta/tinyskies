import type { Vehicle } from "@globefly/shared";

/** Primary hull / body tint for biplanes (fuselage, wings). */
export const PLANE_HULL_PALETTE = [
  0xe84444, 0x3d8cff, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0xecf0f1,
] as const;

/** Hull paint for boats (open-top shell). */
export const BOAT_HULL_PALETTE = [
  0xc0392b, 0x2980b9, 0x16a085, 0x8e44ad, 0xd35400, 0x27ae60, 0x7f8c8d, 0x2c3e50,
] as const;

/** Main carpet body fabric. */
export const CARPET_HULL_PALETTE = [
  0x6b1d6e, 0x8e2463, 0x1a5276, 0x117a65, 0x6c3483, 0x922b21, 0x1e8449, 0x784212,
] as const;

export function pickRandomVehicleColor(vehicle: Vehicle): number {
  if (vehicle === "boat") {
    return BOAT_HULL_PALETTE[Math.floor(Math.random() * BOAT_HULL_PALETTE.length)]!;
  }
  if (vehicle === "carpet") {
    return CARPET_HULL_PALETTE[Math.floor(Math.random() * CARPET_HULL_PALETTE.length)]!;
  }
  return PLANE_HULL_PALETTE[Math.floor(Math.random() * PLANE_HULL_PALETTE.length)]!;
}
