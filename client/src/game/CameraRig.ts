import { PerspectiveCamera, Vector3, Quaternion } from "three";
import { cartesianFromSpherical, tangentFrame } from "./SphericalMath";

const FOLLOW_DISTANCE = 1.2;
const FOLLOW_HEIGHT = 0.5;
const POSITION_SMOOTH = 4.0;
const LOOKAT_SMOOTH = 6.0;

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private targetPos = new Vector3();
  private targetLookAt = new Vector3();
  private currentPos = new Vector3(0, 10, 0);
  private currentLookAt = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(60, aspect, 0.01, 200);
    this.camera.position.set(0, 10, 0);
  }

  update(
    dt: number,
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

    // Camera target: behind and above the plane in its local frame
    const forward = new Vector3()
      .addScaledVector(frame.north, Math.cos(planeHeading))
      .addScaledVector(frame.east, Math.sin(planeHeading))
      .normalize();

    this.targetPos
      .copy(planeWorldPos)
      .addScaledVector(forward, -FOLLOW_DISTANCE)
      .addScaledVector(frame.up, FOLLOW_HEIGHT);

    this.targetLookAt.copy(planeWorldPos).addScaledVector(forward, 0.5);

    // Smooth follow via exponential decay
    const posFactor = 1 - Math.exp(-POSITION_SMOOTH * dt);
    const lookFactor = 1 - Math.exp(-LOOKAT_SMOOTH * dt);

    this.currentPos.lerp(this.targetPos, posFactor);
    this.currentLookAt.lerp(this.targetLookAt, lookFactor);

    this.camera.position.copy(this.currentPos);

    // Up vector: radial direction at the camera's position (not the plane's)
    const camUp = this.currentPos.clone().normalize();
    this.camera.up.copy(camUp);
    this.camera.lookAt(this.currentLookAt);
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
