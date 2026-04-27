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
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const EPILOGUE_STATUE_GLB_URL = "/3D/statue.glb";

const PREVIEW_TARGET_SIZE = 1.61;

/** WebGL preview of `statue.glb` for the eternal-victory lobby modal. */
export class EpilogueStatuePreview {
  private readonly host: HTMLElement;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.01, 24);
  private readonly renderer: WebGLRenderer;
  private readonly stage = new Group();
  private readonly modelPivot = new Group();
  private readonly camPos = new Vector3(0.42, 0.52, 2.35);
  private readonly camLook = new Vector3(0, 0.28, 0);
  private baseYaw = -0.44;
  private pivotPitch = 0.06;
  private model: Group | null = null;
  private running = false;
  private rafId = 0;
  private time = 0;
  private lastFrameTime = 0;
  private loadStarted = false;
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

    const hemi = new HemisphereLight(0xf2f4ff, 0x2a2220, 1.45);
    this.scene.add(hemi);
    const key = new DirectionalLight(0xfff5e8, 1.85);
    key.position.set(1.6, 1.35, 2.6);
    this.scene.add(key);
    const rim = new DirectionalLight(0xb8c8ff, 0.72);
    rim.position.set(-2.2, 0.85, -2.0);
    this.scene.add(rim);

    this.stage.add(this.modelPivot);
    this.scene.add(this.stage);

    window.addEventListener("resize", this.resizeHandler);
    this.resize();
  }

  show() {
    if (!this.loadStarted) {
      this.loadStarted = true;
      const loader = new GLTFLoader();
      loader.load(
        EPILOGUE_STATUE_GLB_URL,
        (gltf) => {
          if (this.model) return;
          const root = gltf.scene;
          root.updateMatrixWorld(true);
          const box = new Box3().setFromObject(root);
          const size = box.getSize(new Vector3());
          const center = box.getCenter(new Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
          const scale = PREVIEW_TARGET_SIZE / maxDim;
          root.scale.setScalar(scale);
          root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
          /* Lift in frame — bbox center sat low; modal crop was cutting the base. */
          root.position.y += 0.14;

          this.modelPivot.rotation.set(this.pivotPitch, this.baseYaw, 0);
          this.modelPivot.add(root);
          this.model = root;
          this.time = 0;
          this.lastFrameTime = 0;
          this.resize();
          if (!this.running) {
            this.running = true;
            this.rafId = window.requestAnimationFrame(this.tick);
          }
          this.renderFrame();
        },
        undefined,
        (err) => {
          console.error("[EpilogueStatuePreview] Failed to load statue GLB:", err);
        },
      );
      return;
    }

    if (!this.model) return;
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

  private tick = (now: number) => {
    if (!this.running) return;
    const nowSec = now * 0.001;
    const dt =
      this.lastFrameTime > 0
        ? Math.min(0.05, Math.max(0.001, nowSec - this.lastFrameTime))
        : 0.016;
    this.lastFrameTime = nowSec;
    this.time += dt;

    this.modelPivot.rotation.y = this.baseYaw + Math.sin(this.time * 0.5) * 0.1;
    this.modelPivot.rotation.x = this.pivotPitch;
    this.modelPivot.position.y = Math.sin(this.time * 1.6) * 0.018;

    this.renderFrame();
    this.rafId = window.requestAnimationFrame(this.tick);
  };

  private renderFrame() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }

  private disposeObject3D(root: Object3D) {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry?.dispose();
      const mats = child.material;
      if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
      else (mats as Material | undefined)?.dispose?.();
    });
  }
}
