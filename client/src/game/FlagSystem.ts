import type {
  FlagCaptureEndEvent,
  FlagCaptureStartEvent,
  FlagCollectedEvent,
  FlagDroppedEvent,
  FlagSpawnedEvent,
  FlagStolenEvent,
  FlagSyncEvent,
} from "@globefly/shared";
import { FLAG_CAPTURE_DURATION_MS } from "@globefly/shared";
import {
  BoxGeometry,
  Camera,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhongMaterial,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { CircularProgressRing } from "../ui/CircularProgressRing";
import type { HUD } from "../ui/HUD";
import type { RemotePlaneManager } from "./RemotePlane";

const FLAG_BOB_SPEED = 2.2;
const FLAG_OFFSET_LOCAL_Y = 0.38;
const RING_ANCHOR_Y = 0.32;

/**
 * Client visuals + HUD for the multiplayer hot-flag (server-authoritative).
 */
export class FlagSystem {
  private scene: Scene;
  private hud: HUD;
  private getLocalPlayerId: () => string;
  private getLocalPlayerGroup: () => Group | null;
  private remotePlanes: RemotePlaneManager;

  private readonly flagRoot = new Group();
  private bobTime = Math.random() * Math.PI * 2;
  private readonly carrierLight: PointLight;

  private mode: "none" | "free" | "held" = "none";
  private holderId: string | null = null;

  private readonly freeBasePos = new Vector3();

  private captureRing: CircularProgressRing | null = null;
  private captureStartMs: number | null = null;
  private readonly challengersAgainstMe = new Set<string>();

  private readonly scratchWorld = new Vector3();

  constructor(deps: {
    scene: Scene;
    hud: HUD;
    getLocalPlayerId: () => string;
    getLocalPlayerGroup: () => Group | null;
    remotePlanes: RemotePlaneManager;
  }) {
    this.scene = deps.scene;
    this.hud = deps.hud;
    this.getLocalPlayerId = deps.getLocalPlayerId;
    this.getLocalPlayerGroup = deps.getLocalPlayerGroup;
    this.remotePlanes = deps.remotePlanes;

    const pole = new Mesh(
      new CylinderGeometry(0.015, 0.018, 0.28, 8),
      new MeshPhongMaterial({ color: 0xcf9a2e }),
    );
    pole.position.y = 0.02;
    const ball = new Mesh(
      new SphereGeometry(0.09, 12, 10),
      new MeshPhongMaterial({
        color: 0xf7c948,
        emissive: 0x442200,
        emissiveIntensity: 0.35,
      }),
    );
    ball.position.y = 0.16;
    const cloth = new Mesh(
      new BoxGeometry(0.15, 0.1, 0.02),
      new MeshPhongMaterial({ color: 0xe8a428 }),
    );
    cloth.position.set(0.07, 0.22, 0);
    this.flagRoot.add(pole, ball, cloth);

    this.carrierLight = new PointLight(0xffcc66, 0.55, 4.5, 1.2);
    this.carrierLight.position.y = 0.22;
    this.flagRoot.add(this.carrierLight);

    this.flagRoot.visible = false;
    this.scene.add(this.flagRoot);
  }

  private localId() {
    return this.getLocalPlayerId();
  }

  private clearAllRemoteFlagDecor() {
    this.remotePlanes.forEachRemote(({ id }) => {
      this.remotePlanes.setPlayerCarryingFlag(id, false);
    });
  }

  private detachFlagFromParents() {
    if (this.flagRoot.parent) this.flagRoot.parent.remove(this.flagRoot);
    this.scene.add(this.flagRoot);
    this.flagRoot.position.set(0, 0, 0);
    this.flagRoot.rotation.set(0, 0, 0);
  }

  private applyFreeAt(world: Vector3) {
    this.clearAllRemoteFlagDecor();
    this.detachFlagFromParents();
    this.freeBasePos.copy(world);
    this.flagRoot.position.copy(world);
    this.flagRoot.visible = true;
    this.carrierLight.intensity = 0.85;
    this.mode = "free";
    this.holderId = null;
  }

  private applyHeld() {
    if (!this.holderId) return;
    this.clearAllRemoteFlagDecor();
    this.detachFlagFromParents();
    if (this.holderId === this.localId()) {
      const g = this.getLocalPlayerGroup();
      if (g) {
        g.add(this.flagRoot);
        this.flagRoot.position.set(0, FLAG_OFFSET_LOCAL_Y, 0);
        this.flagRoot.visible = true;
        this.carrierLight.intensity = 0.65;
      }
    } else {
      this.flagRoot.visible = false;
      this.carrierLight.intensity = 0;
      this.remotePlanes.setPlayerCarryingFlag(this.holderId, true);
    }
    this.mode = "held";
  }

  private clearCaptureUi() {
    this.challengersAgainstMe.clear();
    this.hud.showFlagCarrierWarning(false);
    this.hideCaptureRing();
  }

  private ensureCaptureRing() {
    if (!this.captureRing) {
      this.captureRing = new CircularProgressRing(this.hud.getHudRoot(), { centerIcon: "text" });
      this.captureRing.setText("⚑");
    }
  }

  private hideCaptureRing() {
    this.captureStartMs = null;
    if (this.captureRing) {
      this.captureRing.setProgress(0);
      this.captureRing.setVisible(false);
    }
  }

  onFlagSpawned(ev: FlagSpawnedEvent) {
    this.holderId = null;
    this.clearCaptureUi();
    this.scratchWorld.set(ev.x, ev.y, ev.z);
    this.applyFreeAt(this.scratchWorld);
    this.hud.showFlagAnnounce("A flag appeared in the world!", 3500);
  }

  onFlagCollected(ev: FlagCollectedEvent) {
    this.holderId = ev.holderId;
    this.clearCaptureUi();
    const you = ev.holderId === this.localId();
    this.hud.showFlagAnnounce(
      you ? "You grabbed the flag!" : `${ev.holderName} grabbed the flag!`,
    );
    this.applyHeld();
  }

  onFlagCaptureStart(ev: FlagCaptureStartEvent) {
    if (this.holderId === this.localId() && ev.challengerId !== this.localId()) {
      this.challengersAgainstMe.add(ev.challengerId);
      this.hud.showFlagCarrierWarning(true);
    }
    if (ev.challengerId === this.localId()) {
      this.ensureCaptureRing();
      this.captureStartMs = ev.startMs;
      this.captureRing!.setVisible(true);
      this.captureRing!.setProgress(0.02);
    }
  }

  onFlagCaptureEnd(ev: FlagCaptureEndEvent) {
    this.challengersAgainstMe.delete(ev.challengerId);
    if (this.challengersAgainstMe.size === 0) {
      this.hud.showFlagCarrierWarning(false);
    }
    if (ev.challengerId === this.localId()) {
      this.hideCaptureRing();
    }
  }

  onFlagStolen(ev: FlagStolenEvent) {
    this.holderId = ev.newHolderId;
    this.clearCaptureUi();
    const youNow = ev.newHolderId === this.localId();
    this.hud.showFlagAnnounce(
      youNow ? "You stole the flag!" : `${ev.newHolderName} stole the flag!`,
    );
    this.applyHeld();
  }

  onFlagDropped(ev: FlagDroppedEvent) {
    this.holderId = null;
    this.clearCaptureUi();
    this.scratchWorld.set(ev.x, ev.y, ev.z);
    this.applyFreeAt(this.scratchWorld);
    this.hud.showFlagAnnounce("The flag was dropped!", 3200);
  }

  onFlagCleared() {
    this.holderId = null;
    this.mode = "none";
    this.clearCaptureUi();
    this.flagRoot.visible = false;
    this.clearAllRemoteFlagDecor();
    this.detachFlagFromParents();
  }

  onFlagSync(ev: FlagSyncEvent) {
    if (ev.free === true && ev.x != null && ev.y != null && ev.z != null) {
      this.clearCaptureUi();
      this.scratchWorld.set(ev.x, ev.y, ev.z);
      this.applyFreeAt(this.scratchWorld);
      return;
    }
    if (ev.holderId) {
      this.holderId = ev.holderId;
      this.clearCaptureUi();
      this.applyHeld();
      return;
    }
    this.onFlagCleared();
  }

  update(dt: number, camera: Camera, rendererDomElement: HTMLElement) {
    const lid = this.localId();

    if (this.mode === "free" && this.flagRoot.visible) {
      this.bobTime += dt * FLAG_BOB_SPEED;
      const bob = Math.sin(this.bobTime) * 0.045;
      this.flagRoot.position.set(this.freeBasePos.x, this.freeBasePos.y + bob, this.freeBasePos.z);
    } else if (this.mode === "held" && this.holderId === lid && this.flagRoot.visible) {
      this.bobTime += dt * FLAG_BOB_SPEED;
      const bob = Math.sin(this.bobTime) * 0.022;
      this.flagRoot.position.set(0, FLAG_OFFSET_LOCAL_Y + bob, 0);
    }

    if (this.captureStartMs != null && this.captureRing && this.holderId) {
      const g =
        this.holderId === lid
          ? this.getLocalPlayerGroup()
          : this.remotePlanes.getPlaneGroup(this.holderId);
      if (g) {
        this.scratchWorld.set(0, RING_ANCHOR_Y, 0);
        g.localToWorld(this.scratchWorld);
        this.scratchWorld.project(camera);
        const w = rendererDomElement.clientWidth;
        const h = rendererDomElement.clientHeight;
        const x = (this.scratchWorld.x * 0.5 + 0.5) * w;
        const y = (-this.scratchWorld.y * 0.5 + 0.5) * h;
        const el = this.captureRing.element;
        el.style.position = "fixed";
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.transform = "translate(-50%, -50%)";
        el.style.zIndex = "20";
      }
      const elapsed = Date.now() - this.captureStartMs;
      const p = Math.min(1, elapsed / FLAG_CAPTURE_DURATION_MS);
      this.captureRing.setProgress(p);
    }
  }

  dispose() {
    this.hideCaptureRing();
    this.captureRing?.dispose();
    this.captureRing = null;
    if (this.flagRoot.parent) this.flagRoot.parent.remove(this.flagRoot);
    this.flagRoot.traverse((child) => {
      const m = child as Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat.dispose();
      }
    });
  }
}
