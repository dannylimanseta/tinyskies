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
  carpetTrail: boolean;
  /** Multiplier for camera roll when turning (1 = full plane tilt) */
  cameraTiltScale: number;
  /** Extra XP when collecting while barrel rolling */
  barrelRollBonus: boolean;
  /** Camera follow distance behind the vehicle */
  cameraFollowDistance: number;
  /** Camera height above the vehicle */
  cameraFollowHeight: number;
  /** How much the camera zooms out at max speed (0 = none, 1 = full default) */
  cameraSpeedZoom: number;
  /** FOV increase in degrees at max speed */
  cameraFovBoost: number;
}

const VEHICLE_FEATURES: Record<Vehicle, VehicleGameFeatures> = {
  plane: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: true,
    contrails: true,
    wakeTrail: false,
    carpetTrail: false,
    cameraTiltScale: 1,
    barrelRollBonus: true,
    cameraFollowDistance: 1.2,
    cameraFollowHeight: 0.7,
    cameraSpeedZoom: 0,
    cameraFovBoost: 40,
  },
  boat: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: false,
    contrails: false,
    wakeTrail: true,
    carpetTrail: false,
    cameraTiltScale: 0.28,
    barrelRollBonus: false,
    cameraFollowDistance: 1.2,
    cameraFollowHeight: 0.7,
    cameraSpeedZoom: 0,
    cameraFovBoost: 10,
  },
  carpet: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: true,
    contrails: false,
    wakeTrail: false,
    carpetTrail: true,
    cameraTiltScale: 0.5,
    barrelRollBonus: false,
    cameraFollowDistance: 0.6,
    cameraFollowHeight: 0.3,
    cameraSpeedZoom: -0.4,
    cameraFovBoost: 50,
  },
};

export function getVehicleFeatures(vehicle: Vehicle | undefined): VehicleGameFeatures {
  if (vehicle && vehicle in VEHICLE_FEATURES) return VEHICLE_FEATURES[vehicle];
  return VEHICLE_FEATURES.plane;
}
