import { PerspectiveCamera, Vector3, Quaternion } from "three";
import { cartesianFromSpherical, tangentFrame } from "./SphericalMath";

const FOLLOW_DISTANCE = 1.2;
const FOLLOW_DISTANCE_BOOST = 0.6;
const FOLLOW_HEIGHT = 0.7;
const FOLLOW_HEIGHT_BOOST = 0.15;
const POSITION_SMOOTH = 10.0;
const LOOKAT_SMOOTH = 12.0;
const MAX_TILT = 0.06;
const TILT_SMOOTH = 5.0;
const ZOOM_SMOOTH = 3.0;

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
  ) {
    const frame = tangentFrame(planeQPosition);
    const planeWorldPos = cartesianFromSpherical(
      planeQPosition,
      planeAltitude,
      globeRadius,
    );

    this.currentZoom += (speedRatio - this.currentZoom) * Math.min(1, ZOOM_SMOOTH * dt);
    const dist = FOLLOW_DISTANCE + FOLLOW_DISTANCE_BOOST * this.currentZoom;
    const height = FOLLOW_HEIGHT + FOLLOW_HEIGHT_BOOST * this.currentZoom;

    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(planeHeading))
      .addScaledVector(frame.east, Math.sin(planeHeading))
      .normalize();

    this.targetPos
      .copy(planeWorldPos)
      .addScaledVector(forward, -dist)
      .addScaledVector(frame.up, height);

    this.targetLookAt.copy(planeWorldPos).addScaledVector(forward, 0.5);

    // Smooth follow via exponential decay
    const posFactor = 1 - Math.exp(-POSITION_SMOOTH * dt);
    const lookFactor = 1 - Math.exp(-LOOKAT_SMOOTH * dt);

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

    const targetTilt = -turnRate * MAX_TILT * tiltScale;
    this.currentTilt += (targetTilt - this.currentTilt) * Math.min(1, TILT_SMOOTH * dt);
    if (Math.abs(this.currentTilt) > 0.0001) {
      this.camera.rotateZ(this.currentTilt);
    }
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Snap immediately to the target (no smoothing), e.g. on spawn. */
  snapTo(
    planeQPosition: Quaternion,
    planeHeading: number,
    planeAltitude: number,
    globeRadius: number,
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

    this.currentPos
      .copy(planeWorldPos)
      .addScaledVector(forward, -FOLLOW_DISTANCE)
      .addScaledVector(frame.up, FOLLOW_HEIGHT);

    this.currentLookAt.copy(planeWorldPos).addScaledVector(forward, 0.5);

    this.camera.position.copy(this.currentPos);
    this.camera.up.copy(this.currentPos.clone().normalize());
    this.camera.lookAt(this.currentLookAt);
  }
}
