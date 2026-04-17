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
  /** Camera follow distance behind the vehicle */
  cameraFollowDistance: number;
  /** Camera height above the vehicle */
  cameraFollowHeight: number;
  /** How much the camera zooms out at max speed (0 = none, 1 = full default) */
  cameraSpeedZoom: number;
  /** FOV increase in degrees at max speed */
  cameraFovBoost: number;
  /** Village-to-village package delivery quests */
  packageQuests: boolean;
  /** Ocean fish shadows + fishing range + catch progress (boat only) */
  fishingMiniGame: boolean;
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
    cameraFollowDistance: 1.2,
    cameraFollowHeight: 0.7,
    cameraSpeedZoom: 0,
    cameraFovBoost: 28,
    packageQuests: true,
    fishingMiniGame: false,
  },
  boat: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: false,
    contrails: false,
    wakeTrail: true,
    carpetTrail: false,
    cameraTiltScale: 0.28,
    cameraFollowDistance: 1.2,
    cameraFollowHeight: 0.95,
    cameraSpeedZoom: 0,
    cameraFovBoost: 10,
    packageQuests: false,
    fishingMiniGame: true,
  },
  carpet: {
    collectibleDiamonds: true,
    xpProgressionUI: true,
    speedLines: true,
    contrails: false,
    wakeTrail: false,
    carpetTrail: true,
    cameraTiltScale: 0.5,
    cameraFollowDistance: 0.32,
    cameraFollowHeight: 0.34,
    /** Negative = pull in slightly at speed; keep mild so chase distance stays above CameraRig floor. */
    cameraSpeedZoom: -0.22,
    /** Was 50° — wide FOV + tight chase made motion feel like violent spins when zoomed in. */
    cameraFovBoost: 26,
    packageQuests: false,
    fishingMiniGame: false,
  },
};

export function getVehicleFeatures(vehicle: Vehicle | undefined): VehicleGameFeatures {
  if (vehicle && vehicle in VEHICLE_FEATURES) return VEHICLE_FEATURES[vehicle];
  return VEHICLE_FEATURES.plane;
}
