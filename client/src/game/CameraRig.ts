import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { cartesianFromSpherical, tangentFrame } from "./SphericalMath";

const FOLLOW_DISTANCE = 1.2;
const FOLLOW_DISTANCE_BOOST = 0.6;
const FOLLOW_HEIGHT = 0.7;
const FOLLOW_HEIGHT_BOOST = 0.15;
/** Below this chase distance, small heading changes swing the camera wildly; keep a sane floor. */
const MIN_CHASE_DISTANCE = 0.42;
const POSITION_SMOOTH = 10.0;
const LOOKAT_SMOOTH = 9.0;
const MAX_TILT = 0.06;
const TILT_SMOOTH = 5.0;
const ZOOM_SMOOTH = 3.0;
const BASE_FOV = 60;

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private targetPos = new Vector3();
  private targetLookAt = new Vector3();
  private currentPos = new Vector3(0, 10, 0);
  private currentLookAt = new Vector3();

  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeTimer = 0;
  private currentTilt = 0;
  private currentZoom = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(60, aspect, 0.01, 200);
    this.camera.position.set(0, 10, 0);
  }

  shake(intensity = 0.025, duration = 0.25) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTimer = 0;
  }

  /**
   * @param tiltScale Multiplier for banking tilt when turning (0 = no tilt, 1 = default).
   */
  update(
    dt: number,
    planeQPosition: Quaternion,
    planeHeading: number,
    planeAltitude: number,
    globeRadius: number,
    turnRate: number = 0,
    speedRatio: number = 0,
    tiltScale: number = 1,
    followDist: number = FOLLOW_DISTANCE,
    followHeight: number = FOLLOW_HEIGHT,
    speedZoom: number = 1,
    fovBoost: number = 20,
  ) {
    const frame = tangentFrame(planeQPosition);
    const planeWorldPos = cartesianFromSpherical(
      planeQPosition,
      planeAltitude,
      globeRadius,
    );

    this.currentZoom += (speedRatio - this.currentZoom) * Math.min(1, ZOOM_SMOOTH * dt);
    let dist = followDist + FOLLOW_DISTANCE_BOOST * this.currentZoom * speedZoom;
    dist = Math.max(MIN_CHASE_DISTANCE, dist);
    const height = followHeight + FOLLOW_HEIGHT_BOOST * this.currentZoom * speedZoom;

    const targetFov = BASE_FOV + fovBoost * this.currentZoom;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(planeHeading))
      .addScaledVector(frame.east, Math.sin(planeHeading))
      .normalize();

    this.targetPos
      .copy(planeWorldPos)
      .addScaledVector(forward, -dist)
      .addScaledVector(frame.up, height);

    this.targetLookAt.copy(planeWorldPos).addScaledVector(forward, 0.5);

    /* Tight chase cams: slow smoothing so look-at does not outrun position (reduces dizzy spins). */
    const closeDamp = MathUtils.clamp(dist / 0.95, 0.36, 1.0);
    const posFactor = 1 - Math.exp(-POSITION_SMOOTH * closeDamp * dt);
    const lookFactor =
      1 - Math.exp(-LOOKAT_SMOOTH * closeDamp * 0.78 * dt);

    this.currentPos.lerp(this.targetPos, posFactor);
    this.currentLookAt.lerp(this.targetLookAt, lookFactor);

    this.camera.position.copy(this.currentPos);

    if (this.shakeTimer < this.shakeDuration) {
      this.shakeTimer += dt;
      const decay = 1 - this.shakeTimer / this.shakeDuration;
      const amp = this.shakeIntensity * decay * decay;
      this.camera.position.x += (Math.random() - 0.5) * 2 * amp;
      this.camera.position.y += (Math.random() - 0.5) * 2 * amp;
      this.camera.position.z += (Math.random() - 0.5) * 2 * amp;
    }

    const camUp = this.currentPos.clone().normalize();
    this.camera.up.copy(camUp);
    this.camera.lookAt(this.currentLookAt);

    const tiltDamp = MathUtils.clamp(0.45 + 0.55 * closeDamp, 0, 1);
    const targetTilt = -turnRate * MAX_TILT * tiltScale * tiltDamp;
    this.currentTilt += (targetTilt - this.currentTilt) * Math.min(1, TILT_SMOOTH * dt);
    if (Math.abs(this.currentTilt) > 0.0001) {
      this.camera.rotateZ(this.currentTilt);
    }
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Drive camera directly (used for intro flythrough). */
  setPositionAndLookAt(pos: Vector3, lookAt: Vector3, rollZ = 0, up?: Vector3) {
    this.currentPos.copy(pos);
    this.currentLookAt.copy(lookAt);
    this.camera.position.copy(pos);
    this.camera.up.copy(up ?? pos.clone().normalize());
    this.camera.lookAt(lookAt);
    if (Math.abs(rollZ) > 0.0001) {
      this.camera.rotateZ(rollZ);
    }
  }

  /** Snap immediately to the target (no smoothing), e.g. on spawn. */
  snapTo(
    planeQPosition: Quaternion,
    planeHeading: number,
    planeAltitude: number,
    globeRadius: number,
    followDist: number = FOLLOW_DISTANCE,
    followHeight: number = FOLLOW_HEIGHT,
  ) {
    const frame = tangentFrame(planeQPosition);
    const planeWorldPos = cartesianFromSpherical(
      planeQPosition,
      planeAltitude,
      globeRadius,
    );
    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(planeHeading))
      .addScaledVector(frame.east, Math.sin(planeHeading))
      .normalize();

    const dist = Math.max(MIN_CHASE_DISTANCE, followDist);
    this.currentPos
      .copy(planeWorldPos)
      .addScaledVector(forward, -dist)
      .addScaledVector(frame.up, followHeight);

    this.currentLookAt.copy(planeWorldPos).addScaledVector(forward, 0.5);

    this.camera.position.copy(this.currentPos);
    this.camera.up.copy(this.currentPos.clone().normalize());
    this.camera.lookAt(this.currentLookAt);
  }
}
