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
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PointLight,
  Scene,
  Vector3,
} from "three";
import { CircularProgressRing } from "../ui/CircularProgressRing";
import type { HUD } from "../ui/HUD";
import { createPackageQuestBeamGroup } from "./PackageQuest";
import type { RemotePlaneManager } from "./RemotePlane";

const FLAG_BOB_SPEED = 2.2;
const FLAG_OFFSET_LOCAL_Y = 0.32;
/** Tall pickup beam (same shader as package quest); must read from orbit. */
const FLAG_FREE_BEAM_HEIGHT = 2.5;
const FLAG_FREE_BEAM_WIDTH = 0.06;
const FLAG_BEAM_GOLD = 0xf7c948;
const _BEAM_REF_Y = new Vector3(0, 1, 0);

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
  /** Container for the pole, cloth, and light. */
  private readonly flagVisuals = new Group();
  private readonly freeBeam: Group;
  private readonly beamTime = { value: 0 };
  private bobTime = Math.random() * Math.PI * 2;
  private readonly carrierLight: PointLight;
  private readonly sparkles: Group;

  private mode: "none" | "free" | "held" = "none";
  private holderId: string | null = null;
  private suppressed = false;

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

    this.freeBeam = createPackageQuestBeamGroup(FLAG_BEAM_GOLD, {
      timeUniform: this.beamTime,
      height: FLAG_FREE_BEAM_HEIGHT,
      width: FLAG_FREE_BEAM_WIDTH,
    });
    this.freeBeam.visible = false;
    this.flagRoot.add(this.freeBeam);
    this.flagRoot.add(this.flagVisuals);

    const pole = new Mesh(
      new CylinderGeometry(0.0035, 0.0035, 0.15, 8),
      new MeshPhongMaterial({
        color: 0xcf9a2e,
        emissive: 0xcf9a2e,
        emissiveIntensity: 0.3,
      }),
    );
    pole.position.y = 0.075;
    const clothGeo = new BoxGeometry(0.08, 0.05, 0.005, 10, 4, 1);
    const clothMat = new MeshPhongMaterial({
      color: 0xe8a428,
      emissive: 0xe8a428,
      emissiveIntensity: 0.4,
      flatShading: true,
    });
    clothMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.beamTime;
      shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float edge = smoothstep(-0.04, 0.04, position.x);
         float wave = sin(position.x * 40.0 - uTime * 8.0) * 0.6
                    + sin(position.y * 30.0 - uTime * 5.0) * 0.4;
         transformed.z += wave * 0.025 * edge;
        `
      );
    };
    const cloth = new Mesh(clothGeo, clothMat);
    cloth.position.set(0.0425, 0.12, 0);
    this.flagVisuals.add(pole, cloth);

    this.carrierLight = new PointLight(0xffcc66, 0.55, 4.5, 1.2);
    this.carrierLight.position.y = 0.12;
    this.flagVisuals.add(this.carrierLight);

    const sparkles = new Group();
    const sparkleGeo = new BoxGeometry(0.015, 0.015, 0.015);
    const sparkleMat = new MeshBasicMaterial({ color: 0xffe666 });
    for (let i = 0; i < 5; i++) {
      const sp = new Mesh(sparkleGeo, sparkleMat);
      sp.userData.phase = Math.random() * Math.PI * 2;
      sp.userData.speed = 1.5 + Math.random() * 2.0;
      sp.userData.radius = 0.05 + Math.random() * 0.05;
      sp.userData.yBase = 0.05 + Math.random() * 0.1;
      sparkles.add(sp);
    }
    this.flagVisuals.add(sparkles);
    this.sparkles = sparkles;
    this.flagVisuals.rotation.order = "ZYX";

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

  private hideSuppressedVisuals() {
    this.flagRoot.visible = false;
    this.freeBeam.visible = false;
    this.clearAllRemoteFlagDecor();
    this.detachFlagFromParents();
  }

  setSuppressed(suppressed: boolean) {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.clearCaptureUi();
    if (suppressed) {
      this.hideSuppressedVisuals();
      return;
    }
    if (this.mode === "free") {
      this.applyFreeAt(this.freeBasePos);
    } else if (this.mode === "held") {
      this.applyHeld();
    } else {
      this.hideSuppressedVisuals();
    }
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
    this.mode = "free";
    this.holderId = null;
    if (this.suppressed) {
      this.hideSuppressedVisuals();
      return;
    }
    this.flagRoot.position.copy(world);
    this.flagRoot.visible = true;
    this.freeBeam.visible = true;
    this.flagVisuals.position.y = 1.15;
    this.alignFreeBeamToRadial();
    this.carrierLight.intensity = 1.15;
  }

  /** Orients the entire flag root along globe outward normal so it reads “upright” on the surface. */
  private alignFreeBeamToRadial() {
    this.scratchWorld.copy(this.flagRoot.position).normalize();
    if (this.scratchWorld.lengthSq() < 1e-8) return;
    this.flagRoot.quaternion.setFromUnitVectors(_BEAM_REF_Y, this.scratchWorld);
  }

  private applyHeld() {
    if (!this.holderId) return;
    this.clearAllRemoteFlagDecor();
    this.detachFlagFromParents();
    this.mode = "held";
    if (this.suppressed) {
      this.hideSuppressedVisuals();
      return;
    }
    this.freeBeam.visible = false;
    if (this.holderId === this.localId()) {
      const g = this.getLocalPlayerGroup();
      if (g) {
        g.add(this.flagRoot);
        this.flagRoot.position.set(0, FLAG_OFFSET_LOCAL_Y, 0);
        this.flagRoot.visible = true;
        this.flagRoot.quaternion.identity();
        this.flagVisuals.position.y = 0;
        this.carrierLight.intensity = 0.65;
      }
    } else {
      this.flagRoot.visible = false;
      this.carrierLight.intensity = 0;
      this.remotePlanes.setPlayerCarryingFlag(this.holderId, true);
    }
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
    if (!this.suppressed) {
      this.hud.showFlagAnnounce("A flag has spawned in the world!", 4000);
    }
  }

  onFlagCollected(ev: FlagCollectedEvent) {
    this.holderId = ev.holderId;
    this.clearCaptureUi();
    const you = ev.holderId === this.localId();
    if (!this.suppressed) {
      this.hud.showFlagAnnounce(
        you ? "You picked up the flag!" : `${ev.holderName} picked up the flag!`,
        4000,
      );
    }
    this.applyHeld();
  }

  onFlagCaptureStart(ev: FlagCaptureStartEvent) {
    if (this.suppressed) return;
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
    if (this.suppressed) return;
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
    const lid = this.localId();
    const youThief = ev.newHolderId === lid;
    const youVictim = ev.previousHolderId === lid;
    let msg: string;
    if (youThief) {
      msg = `You stole the flag from ${ev.previousHolderName}!`;
    } else if (youVictim) {
      msg = `${ev.newHolderName} stole the flag from you!`;
    } else {
      msg = `${ev.newHolderName} stole the flag from ${ev.previousHolderName}!`;
    }
    if (!this.suppressed) {
      this.hud.showFlagAnnounce(msg, 4500);
    }
    this.applyHeld();
  }

  onFlagDropped(ev: FlagDroppedEvent) {
    this.holderId = null;
    this.clearCaptureUi();
    this.scratchWorld.set(ev.x, ev.y, ev.z);
    this.applyFreeAt(this.scratchWorld);
    const you = ev.droppedById === this.localId();
    if (!this.suppressed) {
      this.hud.showFlagAnnounce(
        you ? "You dropped the flag!" : `${ev.droppedByName} dropped the flag!`,
        4000,
      );
    }
  }

  onFlagCleared() {
    this.holderId = null;
    this.mode = "none";
    this.clearCaptureUi();
    this.flagRoot.visible = false;
    this.freeBeam.visible = false;
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

  update(dt: number) {
    const lid = this.localId();

    if (this.mode === "free" && this.flagRoot.visible) {
      this.beamTime.value += dt * 0.35;
      this.bobTime += dt * FLAG_BOB_SPEED;
      const bob = Math.sin(this.bobTime) * 0.15;
      this.flagVisuals.position.y = 1.15 + bob;
      this.flagVisuals.rotation.z = 0.25; // Tilt slightly
      this.flagVisuals.rotation.y -= dt * 1.5; // Spin constantly
    } else if (this.mode === "held" && this.holderId === lid && this.flagRoot.visible) {
      this.beamTime.value += dt * 0.35;
      this.bobTime += dt * FLAG_BOB_SPEED;
      const bob = Math.sin(this.bobTime) * 0.022;
      this.flagVisuals.position.y = bob;
      this.flagVisuals.rotation.z = 0;
      this.flagVisuals.rotation.y = 0;
    }

    if (this.flagRoot.visible) {
      const t = this.bobTime;
      for (let i = 0; i < this.sparkles.children.length; i++) {
        const sp = this.sparkles.children[i];
        const p = sp.userData.phase + t * sp.userData.speed;
        const r = sp.userData.radius;
        sp.position.set(
          Math.cos(p) * r,
          sp.userData.yBase + Math.sin(t * 2 + sp.userData.phase) * 0.03,
          Math.sin(p) * r
        );
        const s = 0.5 + 0.5 * Math.sin(p * 3);
        sp.scale.setScalar(Math.max(0.01, s));
        sp.rotation.x += dt * 2;
        sp.rotation.y += dt * 3;
      }
    }

    if (this.captureStartMs != null && this.captureRing && this.holderId) {
      const el = this.captureRing.element;
      el.style.position = "fixed";
      el.style.left = "50vw";
      el.style.top = "50vh";
      el.style.transform = "translate(-50%, -50%)";
      el.style.zIndex = "20";
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
