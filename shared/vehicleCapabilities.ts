import type { Vehicle } from "./types";

/**
 * Declarative per-vehicle gameplay and presentation flags.
 *
 * Use {@link getVehicleFeatures} from gameplay code instead of ad hoc
 * `vehicle === "plane"` checks. Add new vehicles here first, then wire assets
 * and systems. Server can import the same helpers if rules must match client.
 */
export interface VehicleGameFeatures {
  /** Floating diamond collectibles + collection / respawn logic */
  collectibleDiamonds: boolean;
  /** XP bar and level readout (session XP from diamonds for now) */
  xpProgressionUI: boolean;
  speedLines: boolean;
  contrails: boolean;
  wakeTrail: boolean;
  /** Multiplier for camera roll when turning (1 = full plane tilt) */
  cameraTiltScale: number;
  /** Extra XP when collecting while barrel rolling */
  barrelRollBonus: boolean;
}

const VEHICLE_FEATURES: Record<Vehicle, VehicleGameFeatures> = {
  plane: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: true,
    contrails: true,
    wakeTrail: false,
    cameraTiltScale: 1,
    barrelRollBonus: true,
  },
  boat: {
    collectibleDiamonds: false,
    xpProgressionUI: false,
    speedLines: false,
    contrails: false,
    wakeTrail: true,
    cameraTiltScale: 0.28,
    barrelRollBonus: false,
  },
};

export function getVehicleFeatures(vehicle: Vehicle | undefined): VehicleGameFeatures {
  return vehicle === "boat" ? VEHICLE_FEATURES.boat : VEHICLE_FEATURES.plane;
}
