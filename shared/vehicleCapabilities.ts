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
  /** Camera follow distance behind the vehicle */
  cameraFollowDistance: number;
  /** Camera height above the vehicle */
  cameraFollowHeight: number;
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
    cameraFollowDistance: 1.2,
    cameraFollowHeight: 0.7,
  },
  boat: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: false,
    contrails: false,
    wakeTrail: true,
    cameraTiltScale: 0.28,
    barrelRollBonus: false,
    cameraFollowDistance: 1.2,
    cameraFollowHeight: 0.7,
  },
  carpet: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: false,
    contrails: false,
    wakeTrail: false,
    cameraTiltScale: 0.5,
    barrelRollBonus: false,
    cameraFollowDistance: 0.6,
    cameraFollowHeight: 0.3,
  },
};

export function getVehicleFeatures(vehicle: Vehicle | undefined): VehicleGameFeatures {
  if (vehicle && vehicle in VEHICLE_FEATURES) return VEHICLE_FEATURES[vehicle];
  return VEHICLE_FEATURES.plane;
}
