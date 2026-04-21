import type { Vehicle } from "@globefly/shared";
import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Material, Object3D } from "three";
import { createBiplane } from "../game/BiplaneMesh";
import { createBoat } from "../game/BoatMesh";
import { createCarpet } from "../game/CarpetMesh";

type UnlockVehicle = "carpet" | "boat";

const PREVIEW_COLORS: Record<Vehicle, number> = {
  plane: 0xe65345,
  carpet: 0x6b1d6e,
  boat: 0xb83c2b,
};

const PREVIEW_TARGET_SIZE: Record<Vehicle, number> = {
  plane: 1.38,
  /** Slightly smaller so tall subjects (capybara) stay inside the frame. */
  carpet: 1.4,
  boat: 1.38,
};

export class VehicleUnlockPreview {
  private readonly host: HTMLElement;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.01, 20);
  private readonly renderer: WebGLRenderer;
  private readonly stage = new Group();
  private readonly modelPivot = new Group();
  private readonly camPos = new Vector3(0, 0.55, 2.65);
  private readonly camLook = new Vector3(0, 0.1, 0);
  /** Base yaw (rad) for 3/4 front; orbit anim adds a small wobble on Y. */
  private baseYaw = -0.48;
  private pivotPitch = 0.08;
  private pivotRoll = 0;
  private bobY = 0.03;
  private model: Group | null = null;
  private currentVehicle: UnlockVehicle | null = null;
  private running = false;
  private rafId = 0;
  private time = 0;
  private lastFrameTime = 0;
  private readonly resizeHandler = () => this.resize();

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.host.appendChild(this.renderer.domElement);

    this.applyCamera();

    const hemi = new HemisphereLight(0xf5f7ff, 0x2d1e1a, 1.5);
    this.scene.add(hemi);

    const key = new DirectionalLight(0xfff7ea, 1.9);
    key.position.set(1.8, 1.4, 2.8);
    this.scene.add(key);

    const rim = new DirectionalLight(0xa7c7ff, 0.75);
    rim.position.set(-2.4, 1.0, -2.2);
    this.scene.add(rim);

    this.stage.add(this.modelPivot);
    this.scene.add(this.stage);

    window.addEventListener("resize", this.resizeHandler);
    this.resize();
  }

  show(vehicle: UnlockVehicle) {
    if (this.currentVehicle !== vehicle) {
      this.currentVehicle = vehicle;
      this.setVehicle(vehicle);
    }
    this.resize();
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = 0;
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  hide() {
    this.running = false;
    if (this.rafId !== 0) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 320));
    const height = Math.max(1, Math.round(rect.height || 200));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderFrame();
  }

  dispose() {
    this.hide();
    window.removeEventListener("resize", this.resizeHandler);
    if (this.model) {
      this.modelPivot.remove(this.model);
      this.disposeObject3D(this.model);
      this.model = null;
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private setVehicle(vehicle: Vehicle) {
    if (this.model) {
      this.modelPivot.remove(this.model);
      this.disposeObject3D(this.model);
      this.model = null;
    }

    const model =
      vehicle === "boat"
        ? createBoat(PREVIEW_COLORS.boat)
        : vehicle === "carpet"
          ? createCarpet(PREVIEW_COLORS.carpet)
          : createBiplane(PREVIEW_COLORS.plane);

    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const scale = PREVIEW_TARGET_SIZE[vehicle] / maxDim;

    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    model.position.y += vehicle === "boat" ? -0.04 : 0.02;
    if (vehicle === "carpet") {
      model.position.y += 0.02;
    }

    // Lower in frame so tops (capybara head, mast) are not cropped by the viewport.
    if (vehicle === "carpet") {
      model.position.y -= 0.11;
    } else if (vehicle === "boat") {
      model.position.y -= -0.09;
    }

    if (vehicle === "carpet") {
      // 3/4 front: slightly from the right, carpet top toward camera; +π yaw faces capybara forward (not its back).
      this.camPos.set(0.38, 0.62, 2.58);
      this.camLook.set(0, 0.11, 0);
      this.baseYaw = -0.42 + Math.PI;
      this.pivotPitch = 0.1;
      this.pivotRoll = 0;
      this.bobY = 0.025;
    } else if (vehicle === "boat") {
      this.camPos.set(0.4, 0.52, 2.48);
      this.camLook.set(0, 0.07, 0);
      // Match carpet: +π yaw so bow / cabin face the camera instead of the stern.
      this.baseYaw = -0.46 + Math.PI;
      this.pivotPitch = 0.07;
      this.pivotRoll = -0.04;
      this.bobY = 0.022;
    } else {
      this.camPos.set(0, 0.22, 3.05);
      this.camLook.set(0, 0.04, 0);
      this.baseYaw = -0.35;
      this.pivotPitch = -0.06;
      this.pivotRoll = 0;
      this.bobY = 0.03;
    }

    this.modelPivot.rotation.set(this.pivotPitch, this.baseYaw, this.pivotRoll);
    this.modelPivot.position.set(0, 0, 0);
    this.modelPivot.add(model);
    this.applyCamera();
    this.model = model;
    this.time = 0;
    this.lastFrameTime = 0;
    this.renderFrame();
  }

  private tick = (now: number) => {
    if (!this.running) return;
    const nowSec = now * 0.001;
    const dt =
      this.lastFrameTime > 0
        ? Math.min(0.05, Math.max(0.001, nowSec - this.lastFrameTime))
        : 0.016;
    this.lastFrameTime = nowSec;
    this.time += dt;

    const orbitAmp = this.currentVehicle === "carpet" || this.currentVehicle === "boat" ? 0.09 : 0.12;
    this.modelPivot.rotation.y = this.baseYaw + Math.sin(this.time * 0.55) * orbitAmp;
    this.modelPivot.rotation.x = this.pivotPitch;
    this.modelPivot.rotation.z = this.pivotRoll;
    this.modelPivot.position.y =
      this.bobY + Math.sin(this.time * 1.8) * (this.currentVehicle === "carpet" || this.currentVehicle === "boat" ? 0.022 : 0.035);

    if (this.model?.userData.propeller) {
      this.model.userData.propeller.rotation.z -= 18 * dt;
    }
    if (this.model?.userData.timeUniform) {
      this.model.userData.timeUniform.value = this.time;
    }

    this.renderFrame();
    this.rafId = window.requestAnimationFrame(this.tick);
  };

  private applyCamera() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private renderFrame() {
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
  }

  private disposeObject3D(root: Object3D) {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => mat.dispose());
      } else {
        (child.material as Material | undefined)?.dispose?.();
      }
    });
  }
}
