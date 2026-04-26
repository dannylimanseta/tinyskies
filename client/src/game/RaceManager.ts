import {
  Group,
  Mesh,
  TorusGeometry,
  Vector3,
  Quaternion,
  Matrix4,
  ShaderMaterial,
  DoubleSide,
  AdditiveBlending,
} from "three";
import type { Globe } from "./Globe";
import type { AudioManager } from "../audio/AudioManager";
import type { HUD } from "../ui/HUD";
import { CircularProgressRing } from "../ui/CircularProgressRing";
import { RaceTimerUI } from "../ui/RaceTimerUI";
import {
  cartesianFromSpherical,
  quaternionFromSurfaceNormal,
  moveOnSphere,
  tangentFrame,
} from "./SphericalMath";
import { createPlaneCollectibleDiamondGeometry, holoFrag, holoVert } from "./Rings";

/** Waypoints along path: torus for the first N−1, FINISH banner on the last. */
const RACE_CHECKPOINT_COUNT = 12;
/** Prior size ×1.5 (50% larger than last revision). */
const RACE_RING_RADIUS = 0.54;
const RACE_RING_TUBE = 0.054;
const RACE_COLLECT_RADIUS = 0.68;
const RACE_TIME_LIMIT = 45;
const RACE_TIME_LIMIT_CARPET = 40;
const RACE_BANNER_TRIGGER_RADIUS = 0.6;
const RACE_APPROACH_FILL_SEC = 2;
const RACE_LOW_HOVER = 0.4;
const RACE_LOW_HOVER_CARPET = 0.22;
/** Above this normalized step index (0–1), weave eases to 0 for a straighter run-in to FINISH. */
const RACE_PATH_LAST_STRAIGHT_START = 0.52;
/** Radians; chained per-segment heading offset for S-curves (not one great circle). */
const RACE_PATH_WEAVE_A = 0.95;
const RACE_PATH_WEAVE_B = 0.58;
const RACE_PATH_WEAVE_C = 0.44;
const RACE_PATH_WEAVE_FREQ1 = 3;
const RACE_PATH_WEAVE_FREQ2 = 4;
const RACE_PATH_WEAVE_FREQ3 = 5;

const RACE_BONUS_DIAMOND_COUNT = 3;
const RACE_DIAMOND_SPIN_SPEED = 1.8;
const RACE_DIAMOND_BOB_LIFT = 0.012;
const RACE_DIAMOND_BOB_AMP = 0.017;

const _Y = new Vector3(0, 1, 0);
const _qAlign = new Quaternion();
const _spinQ = new Quaternion();

function makeRaceRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface RaceManagerDeps {
  globe: Globe;
  audioManager: AudioManager;
  hud: HUD;
  hudParent: HTMLElement;
  uiContainer: HTMLElement;
  /** Only plane and carpet can start / run the trial. */
  canRace: () => boolean;
  isCarpet: () => boolean;
  getWorldPos: () => Vector3;
  getQPosition: () => Quaternion;
  getHeading: () => number;
  onWin: () => void;
  /** Same VFX/SFX/boost as a plane world diamond (when that ring holds a bonus gem). */
  onBonusDiamondCollected: (worldPos: Vector3) => void;
  /** Holo shard burst when a checkpoint ring or finish banner is collected. */
  onRingCheckpointBurst: (worldPos: Vector3) => void;
}

/**
 * Plane and Carpet time trial: hold with 3–2–1 in the progress ring, then winding course to a FINISH banner.
 */
export class RaceManager {
  private readonly deps: RaceManagerDeps;
  private state: "idle" | "approaching" | "racing" = "idle";
  private activeBannerIndex = -1;
  private approachProgress = 0;
  private raceTimer = 0;
  private currentRingIndex = 0;
  private time = 0;

  private readonly progressRing: CircularProgressRing;
  private readonly timerUI: RaceTimerUI;
  private readonly trackGroup = new Group();
  private rings: {
    worldPos: Vector3;
    ringGroup: Group;
    holoMat: ShaderMaterial | null;
    bonusDiamond: {
      mesh: Mesh;
      upAxis: Vector3;
      spinAngle: number;
      phaseOffset: number;
    } | null;
    collected: boolean;
  }[] = [];
  private readonly diamondGeo: ReturnType<typeof createPlaneCollectibleDiamondGeometry>;

  private readonly _scratchNext = new Vector3();
  private readonly _ckY = new Vector3();
  private readonly _ckZ = new Vector3();
  private readonly _ckX = new Vector3();
  private readonly _ckZo = new Vector3();
  private readonly _ckToNext = new Vector3();
  private readonly _ckAlt = new Vector3();
  private readonly _ckMat = new Matrix4();

  constructor(deps: RaceManagerDeps) {
    this.deps = deps;
    this.progressRing = new CircularProgressRing(deps.hudParent, { centerIcon: "text" });
    this.timerUI = new RaceTimerUI(deps.uiContainer);
    this.diamondGeo = createPlaneCollectibleDiamondGeometry();
    deps.globe.group.add(this.trackGroup);
  }

  update(dt: number) {
    if (!this.deps.canRace()) {
      if (this.state !== "idle") this.abort();
      return;
    }

    this.time += dt;
    const playerPos = this.deps.getWorldPos();
    const banners = this.deps.globe.getRaceBanners();

    if (this.state === "idle" || this.state === "approaching") {
      let nearest = -1;
      let nearestD = Infinity;
      for (const b of banners) {
        const p = new Vector3();
        b.pivot.getWorldPosition(p);
        const d = playerPos.distanceTo(p);
        if (d < nearestD) {
          nearestD = d;
          nearest = b.index;
        }
      }

      if (this.state === "idle") {
        if (nearestD < RACE_BANNER_TRIGGER_RADIUS && nearest >= 0) {
          this.state = "approaching";
          this.activeBannerIndex = nearest;
          this.approachProgress = 0;
          this.progressRing.setText("3");
          this.progressRing.setProgress(0.001);
        }
      } else {
        if (
          nearestD >= RACE_BANNER_TRIGGER_RADIUS ||
          nearest !== this.activeBannerIndex ||
          this.activeBannerIndex < 0
        ) {
          this.state = "idle";
          this.progressRing.setProgress(0);
          this.progressRing.setVisible(false);
        } else {
          this.approachProgress += dt / RACE_APPROACH_FILL_SEC;
          const p = Math.min(1, this.approachProgress);
          this.progressRing.setProgress(p);
          if (p < 1 / 3) this.progressRing.setText("3");
          else if (p < 2 / 3) this.progressRing.setText("2");
          else this.progressRing.setText("1");
          if (this.approachProgress >= 1) {
            this.startRaceAfterApproach(banners);
          }
        }
      }
      return;
    }

    if (this.state === "racing") {
      this.raceTimer -= dt;
      this.timerUI.setTime(this.raceTimer);

      for (let ri = 0; ri < this.rings.length; ri++) {
        const r = this.rings[ri]!;
        if (r.collected) continue;

        if (r.holoMat) r.holoMat.uniforms.time.value = this.time;

        // Pulse the next target ring so the player can clearly identify it.
        if (ri === this.currentRingIndex && r.holoMat) {
          const pulse = 1 + 0.10 * Math.sin(this.time * 4.5);
          r.ringGroup.scale.setScalar(pulse);
        } else if (r.holoMat) {
          r.ringGroup.scale.setScalar(1);
        }

        if (r.bonusDiamond) {
          const bd = r.bonusDiamond;
          const bob =
            RACE_DIAMOND_BOB_LIFT +
            Math.sin(this.time * 1.5 + bd.phaseOffset) * RACE_DIAMOND_BOB_AMP;
          bd.mesh.position.copy(r.worldPos).addScaledVector(bd.upAxis, bob);
          bd.spinAngle += RACE_DIAMOND_SPIN_SPEED * dt;
          _qAlign.setFromUnitVectors(_Y, bd.upAxis);
          _spinQ.setFromAxisAngle(_Y, bd.spinAngle);
          bd.mesh.quaternion.copy(_qAlign).multiply(_spinQ);
          const mat = bd.mesh.material;
          if (mat instanceof ShaderMaterial) mat.uniforms.time.value = this.time;
        }
      }

      const target = this.rings[this.currentRingIndex];
      if (target && !target.collected) {
        const d = playerPos.distanceTo(target.worldPos);
        if (d < RACE_COLLECT_RADIUS) {
          this.deps.onRingCheckpointBurst(target.worldPos.clone());
          const isFinishBanner = this.currentRingIndex === RACE_CHECKPOINT_COUNT - 1;
          this.deps.audioManager.resumeContextIfNeeded();
          if (isFinishBanner) {
            if (this.deps.audioManager.hasSFX("celebrate_1")) {
              this.deps.audioManager.playSFX("celebrate_1", 0.4);
            }
          } else if (this.deps.audioManager.hasSFX("chime_1")) {
            this.deps.audioManager.playSFX("chime_1", 0.34);
          }
          target.collected = true;
          target.ringGroup.visible = false;
          if (target.bonusDiamond) {
            const w = new Vector3();
            target.bonusDiamond.mesh.getWorldPosition(w);
            this.deps.onBonusDiamondCollected(w);
            target.bonusDiamond.mesh.visible = false;
          }
          this.currentRingIndex++;
          if (this.currentRingIndex >= RACE_CHECKPOINT_COUNT) {
            this.win();
            return;
          }
        }
      }

      if (this.raceTimer <= 0) {
        this.cleanupLose();
      }
    }
  }

  private startRaceAfterApproach(
    banners: readonly { pivot: Group; normal: Vector3; baseAlt: number; index: number }[],
  ) {
    const banner = banners.find((b) => b.index === this.activeBannerIndex);
    if (!banner) {
      this.state = "idle";
      this.progressRing.setProgress(0);
      this.progressRing.setVisible(false);
      return;
    }

    this.deps.globe.setRaceBannersVisible(false, -1);
    this.buildTrack(banner);
    this.state = "racing";
    this.progressRing.setVisible(false);
    this.raceTimer = this.deps.isCarpet() ? RACE_TIME_LIMIT_CARPET : RACE_TIME_LIMIT;
    this.timerUI.setTime(this.raceTimer);
    this.timerUI.show();
    this.deps.hud.setBrazierTrackerRaceHidden(true);
    this.deps.audioManager.resumeContextIfNeeded();
    if (this.deps.audioManager.hasSFX("race_start_1")) {
      this.deps.audioManager.playSFX("race_start_1", 0.32);
    }
    if (this.deps.audioManager.hasSFX("celebrate_1")) {
      this.deps.audioManager.playSFX("celebrate_1", 0.34);
    }
    this.deps.hud.showRaceGoToast();
  }

  private buildTrack(banner: { normal: Vector3; baseAlt: number; index: number }) {
    this.trackGroup.clear();
    this.rings = [];
    this.currentRingIndex = 0;

    const startQ = quaternionFromSurfaceNormal(banner.normal.x, banner.normal.y, banner.normal.z);
    const playerQ = this.deps.getQPosition();
    const heading = this.deps.getHeading();
    const pFrame = tangentFrame(playerQ);
    const forward = new Vector3()
      .addScaledVector(pFrame.north, Math.cos(heading))
      .addScaledVector(pFrame.east, Math.sin(heading))
      .normalize();

    const tangent = forward.clone().projectOnPlane(banner.normal).normalize();
    const sFrame = tangentFrame(startQ);
    const pathHeading = Math.atan2(tangent.dot(sFrame.east), tangent.dot(sFrame.north));

    const bannerHangAlt = banner.baseAlt - this.deps.globe.radius;
    const lowHover = this.deps.isCarpet() ? RACE_LOW_HOVER_CARPET : RACE_LOW_HOVER;

    const stepAngle = (Math.PI * 2) / RACE_CHECKPOINT_COUNT;
    const pathQuats: Quaternion[] = [];
    let qSeg = startQ.clone();
    for (let i = 0; i < RACE_CHECKPOINT_COUNT; i++) {
      const t = i / RACE_CHECKPOINT_COUNT;
      const k = Math.min(
        1,
        Math.max(0, (t - RACE_PATH_LAST_STRAIGHT_START) / (1 - RACE_PATH_LAST_STRAIGHT_START)),
      );
      const smoothK = k * k * (3 - 2 * k);
      const weaveScale = 1 - smoothK;
      const weave =
        weaveScale *
        (RACE_PATH_WEAVE_A * Math.sin(t * Math.PI * 2 * RACE_PATH_WEAVE_FREQ1) +
          RACE_PATH_WEAVE_B * Math.sin(t * Math.PI * 2 * RACE_PATH_WEAVE_FREQ2 + 1.17) +
          RACE_PATH_WEAVE_C * Math.sin(t * Math.PI * 2 * RACE_PATH_WEAVE_FREQ3 + 0.73));
      qSeg = moveOnSphere(qSeg, pathHeading + weave, stepAngle);
      pathQuats.push(qSeg.clone());
    }

    for (let i = 0; i < RACE_CHECKPOINT_COUNT; i++) {
      const q = pathQuats[i]!;
      const up = new Vector3(0, 1, 0).applyQuaternion(q).normalize();
      const surf = this.deps.globe.getSurfaceAltitudeAt(up.x, up.y, up.z);
      const t = (i + 1) / RACE_CHECKPOINT_COUNT;
      const parabola = 4 * (t - 0.5) ** 2;
      const hover = lowHover + (bannerHangAlt - lowHover) * parabola;
      const pos = cartesianFromSpherical(q, surf + hover, this.deps.globe.radius);

      const iNext = (i + 1) % RACE_CHECKPOINT_COUNT;
      const nextQ = pathQuats[iNext]!;
      const nextUp = new Vector3(0, 1, 0).applyQuaternion(nextQ).normalize();
      const nextSurf = this.deps.globe.getSurfaceAltitudeAt(nextUp.x, nextUp.y, nextUp.z);
      const tNext = (iNext + 1) / RACE_CHECKPOINT_COUNT;
      const parNext = 4 * (tNext - 0.5) ** 2;
      const hoverNext = lowHover + (bannerHangAlt - lowHover) * parNext;
      const nextPos = cartesianFromSpherical(nextQ, nextSurf + hoverNext, this.deps.globe.radius);

      const ringGroup = new Group();
      ringGroup.position.copy(pos);
      this.orientCheckpointOnGlobe(ringGroup, pos, nextPos);

      const isFinish = i === RACE_CHECKPOINT_COUNT - 1;

      if (isFinish) {
        const finishMat = this.deps.globe.getRaceFinishBannerMaterial();
        if (finishMat) {
          const decor = new Group();
          this.deps.globe.populateRaceBannerDecorGroup(
            decor,
            finishMat,
            0.75,
            0.18,
            banner.index + 50420,
          );
          ringGroup.add(decor);
        }
        this.trackGroup.add(ringGroup);
        this.rings.push({
          worldPos: pos.clone(),
          ringGroup,
          holoMat: null,
          bonusDiamond: null,
          collected: false,
        });
        continue;
      }

      const phaseOffset = (i * 1.17) % (Math.PI * 2);
      const holoMat = new ShaderMaterial({
        vertexShader: holoVert,
        fragmentShader: holoFrag,
        uniforms: {
          time: { value: 0 },
          phaseOffset: { value: phaseOffset },
          spawnScale: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const torus = new Mesh(new TorusGeometry(RACE_RING_RADIUS, RACE_RING_TUBE, 12, 32), holoMat);
      ringGroup.add(torus);

      this.trackGroup.add(ringGroup);

      this.rings.push({
        worldPos: pos.clone(),
        ringGroup,
        holoMat,
        bonusDiamond: null,
        collected: false,
      });
    }

    const torusOnly = this.rings.filter((r) => r.holoMat != null);
    const nTorus = torusOnly.length;
    const pickN = Math.min(RACE_BONUS_DIAMOND_COUNT, nTorus);
    if (pickN > 0) {
      const rand = makeRaceRng(
        this.deps.globe.getWorldSeed() ^ Math.imul(banner.index, 1009) ^ 0xace1f00d,
      );
      const order = Array.from({ length: nTorus }, (_, j) => j);
      for (let s = order.length - 1; s > 0; s--) {
        const j = Math.floor(rand() * (s + 1));
        [order[s], order[j]] = [order[j]!, order[s]!];
      }
      for (let p = 0; p < pickN; p++) {
        const rec = torusOnly[order[p]!]!;
        const dPhase = (p * 2.31 + banner.index * 0.37) % (Math.PI * 2);
        const dMat = new ShaderMaterial({
          vertexShader: holoVert,
          fragmentShader: holoFrag,
          uniforms: {
            time: { value: 0 },
            phaseOffset: { value: dPhase },
            spawnScale: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        });
        const dMesh = new Mesh(this.diamondGeo, dMat);
        dMesh.position.copy(rec.worldPos);
        this.trackGroup.add(dMesh);
        rec.bonusDiamond = {
          mesh: dMesh,
          upAxis: rec.worldPos.clone().normalize(),
          spinAngle: 0,
          phaseOffset: dPhase,
        };
      }
    }

    const lastRingRec = this.rings[this.rings.length - 2];
    if (lastRingRec && !lastRingRec.bonusDiamond) {
      const dPhase = (banner.index * 0.91 + 2.718) % (Math.PI * 2);
      const dMat = new ShaderMaterial({
        vertexShader: holoVert,
        fragmentShader: holoFrag,
        uniforms: {
          time: { value: 0 },
          phaseOffset: { value: dPhase },
          spawnScale: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const dMesh = new Mesh(this.diamondGeo, dMat);
      dMesh.position.copy(lastRingRec.worldPos);
      this.trackGroup.add(dMesh);
      lastRingRec.bonusDiamond = {
        mesh: dMesh,
        upAxis: lastRingRec.worldPos.clone().normalize(),
        spinAngle: 0,
        phaseOffset: dPhase,
      };
    }
  }

  /**
   * Local +Y = globe radial (up from center); local +Z = travel toward next checkpoint.
   * Torus hole axis is Z so you fly through along the path tangent on the surface.
   */
  private orientCheckpointOnGlobe(group: Group, worldPos: Vector3, nextWorldPos: Vector3) {
    const yAxis = this._ckY.copy(worldPos).normalize();
    this._ckToNext.copy(nextWorldPos).sub(worldPos);
    const zFlat = this._ckZ.copy(this._ckToNext).projectOnPlane(yAxis);
    let zAxis: Vector3;
    if (zFlat.lengthSq() < 1e-10) {
      if (Math.abs(yAxis.y) < 0.85) this._ckAlt.set(0, 1, 0);
      else this._ckAlt.set(1, 0, 0);
      zAxis = this._ckZ.crossVectors(this._ckAlt, yAxis).normalize();
    } else {
      zAxis = zFlat.normalize();
    }
    const xAxis = this._ckX.crossVectors(yAxis, zAxis).normalize();
    const zOrtho = this._ckZo.crossVectors(xAxis, yAxis).normalize();
    this._ckMat.makeBasis(xAxis, yAxis, zOrtho);
    group.quaternion.setFromRotationMatrix(this._ckMat);
  }

  private win() {
    if (this.deps.audioManager.hasSFX("cheer_1")) {
      this.deps.audioManager.resumeContextIfNeeded();
      this.deps.audioManager.playSFX("cheer_1", 0.12);
    }
    this.deps.onWin();
    this.cleanupAfterRace();
  }

  private cleanupLose() {
    this.cleanupAfterRace();
  }

  private cleanupAfterRace() {
    this.state = "idle";
    this.trackGroup.clear();
    this.rings = [];
    this.timerUI.hide();
    this.progressRing.setProgress(0);
    this.progressRing.setVisible(false);
    this.deps.globe.setRaceBannersVisible(true);
    this.deps.hud.setBrazierTrackerRaceHidden(false);
    this.activeBannerIndex = -1;
    this.approachProgress = 0;
  }

  /** Cosmic void, moon impact, vehicle switch, lobby. */
  abort() {
    if (this.state === "idle") return;
    this.cleanupAfterRace();
  }

  dispose() {
    this.abort();
    this.trackGroup.removeFromParent();
    this.progressRing.dispose();
    this.timerUI.dispose();
    this.diamondGeo.dispose();
  }
}
