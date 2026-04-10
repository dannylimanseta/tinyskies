import {
  Scene,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Clock,
  Color,
  Fog,
  PointLight,
  Vector3,
  MeshPhongMaterial,
  VSMShadowMap,
  CanvasTexture,
  SRGBColorSpace,
  Quaternion,
} from "three";
import { cartesianFromSpherical, tangentFrame } from "./SphericalMath";
import { getVehicleFeatures, type Vehicle, type VehicleGameFeatures, type WorldConfig } from "@globefly/shared";
import { DayNightCycle } from "./DayNightCycle";
import { AudioManager } from "../audio/AudioManager";
import { Globe } from "./Globe";
import { Plane } from "./Plane";
import { Boat } from "./Boat";
import { Carpet } from "./Carpet";
import { FlightControls } from "./FlightControls";
import { TouchControls } from "./TouchControls";
import { CameraRig } from "./CameraRig";
import { SocketClient } from "../network/SocketClient";
import { isMobile } from "../utils/isMobile";
import { StateSync } from "../network/StateSync";
import { RemotePlaneManager } from "./RemotePlane";
import { SpeedLines } from "./SpeedLines";
import { Contrails } from "./Contrails";
import { WakeTrail } from "./WakeTrail";
import { CarpetTrail } from "./CarpetTrail";
import { CarpetWake } from "./CarpetWake";
import { CarpetLeaves } from "./CarpetLeaves";
import { LensFlare } from "./LensFlare";
import { Starfield } from "./Starfield";
import { Aurora } from "./Aurora";
import { RainOverlay } from "./RainOverlay";
import { RingManager } from "./Rings";
import { RingCollectVFX } from "./RingCollectVFX";
import { pickRandomVehicleColor } from "./vehicleColors";
import { Lobby, generateWhimsicalName } from "../ui/Lobby";
import { RemotePlayerNameLabels } from "../ui/RemotePlayerNameLabels";
import { HUD } from "../ui/HUD";
import { mountControlHints } from "../ui/ControlHints";
import { LandmarkHUD } from "../ui/LandmarkHUD";
import { PackageQuestHUD } from "../ui/PackageQuestHUD";
import { FlockFormationHUD } from "../ui/FlockFormationHUD";
import { BirdFlock, BIRD_FLOCK_COUNT, FLOCK_FORMATION_XP } from "./BirdFlock";
import { RainbowArch, RAINBOW_COUNT, RAINBOW_XP } from "./RainbowArch";
import { FloatingLanterns, LANTERN_CLUSTER_COUNT, LANTERN_XP } from "./FloatingLanterns";
import { FireflyCluster, FIREFLY_CLUSTER_COUNT, FIREFLY_XP } from "./FireflyCluster";
import { Volcano, VOLCANO_COUNT, VOLCANO_XP } from "./Volcano";
import { LandmarkRegistry, LandmarkDetector } from "./Landmarks";
import { PackageQuestManager } from "./PackageQuest";
import { isNpcMale, pickBalloonGreeting } from "./PackageDialogue";
import { CampsiteMarker } from "./CampsiteMarker";
import { CampsiteScene } from "./CampsiteScene";
import { TransitionOverlay } from "../ui/TransitionOverlay";
import { getSkyPreset } from "./SkyPresets";

/**
 * Distance to balloon for greeting (world units, same space as globe radius ~5).
 * Previously ~0.4 was too small — you could fly visually “past” a balloon and
 * never enter the sphere in one frame. ~1.2 matches a comfortable fly-by.
 */
const _farQ = new Quaternion();
const BALLOON_GREET_DIST = 1.2;
const BALLOON_GREET_EXIT_DIST = 1.75;
/** Seconds before the same balloon can greet again after you leave. */
const BALLOON_GREET_COOLDOWN = 32;

/** Max linear gain for night crickets loop (soft; scales with night blend 0–1). */
const CRICKETS_LOOP_MAX_VOL = 0.045;

/** Local vehicle fill light at night: `intensity = nightWeight * this` (was 1.0; lower = less harsh). */
const PLAYER_LIGHT_NIGHT_INTENSITY = 0.38;

const RAIN_LOOP_NAME = "rain_loop";
const RAIN_LOOP_MAX_VOL = 0.18;

const BIRDS_LOOP_NAME = "birds_loop";
const BIRDS_LOOP_MAX_VOL = 0.04;

/** Next diamond within this window raises pitch (combo). */
const DIAMOND_COMBO_WINDOW_MS = 900;
const DIAMOND_COMBO_MAX_STEPS = 5;
const DIAMOND_COMBO_RATE_PER_STEP = 0.028;
const DIAMOND_SFX_VOLUME = 0.3;

const DIAMOND_SFX_IDS = [
  "diamond_collect_1",
  "diamond_collect_2",
  "diamond_collect_3",
] as const;

const SPEED_BOOST_SFX_IDS = [
  "speed_boost_1",
  "speed_boost_2",
  "speed_boost_3",
] as const;
const SPEED_BOOST_SFX_VOLUME = 0.1;

const BOX_COLLECT_SFX_IDS = [
  "box_collect_1",
  "box_collect_2",
  "box_collect_3",
] as const;
const BOX_COLLECT_SFX_VOLUME = 0.52;

const CHEER_SFX_IDS = ["cheer_1", "cheer_2"] as const;
const CHEER_SFX_VOLUME = 0.1;

const DIALOGUE_LOOP_IDS = ["dialogue_1", "dialogue_2", "dialogue_3", "dialogue_4"] as const;
const DIALOGUE_LOOP_VOLUME = 0.28;
/** Lower playback rate reads as a slightly deeper “male” bed under the same asset. */
const DIALOGUE_MALE_PLAYBACK_RATE = 0.88;

const LEVELUP_SFX_IDS = ["levelup_1", "levelup_2", "levelup_3"] as const;
const LEVELUP_SFX_VOLUME = 0.42;

export class Game {
  private container: HTMLElement;
  private renderer!: WebGLRenderer;
  private scene!: Scene;
  private clock!: Clock;

  private globe!: Globe;
  private localPlayer!: Plane | Boat | Carpet;
  private controls!: FlightControls;
  private touchControls: TouchControls | null = null;
  private mobile = false;
  private cameraRig!: CameraRig;
  private remotePlanes!: RemotePlaneManager;
  private speedLines!: SpeedLines;
  private contrails!: Contrails;
  private wakeTrail!: WakeTrail;
  private carpetTrail!: CarpetTrail;
  private carpetWake!: CarpetWake;
  private carpetLeaves!: CarpetLeaves;
  private gameSeed = 42;
  private gameTerrainType = "default";
  private lensFlare: LensFlare | null = null;
  private rainOverlay: RainOverlay | null = null;
  private starfield: Starfield | null = null;
  private aurora: Aurora | null = null;
  private playerLight: PointLight | null = null;
  private ringManager!: RingManager;
  private collectVFX!: RingCollectVFX;

  private socketClient: SocketClient | null = null;
  private stateSync: StateSync | null = null;
  private lobby!: Lobby;
  private hud!: HUD;
  private landmarkHUD!: LandmarkHUD;
  private landmarkDetector!: LandmarkDetector;
  private packageQuest: PackageQuestManager | null = null;
  private packageQuestHUD!: PackageQuestHUD;
  private birdFlocks: BirdFlock[] = [];
  private rainbowArches: RainbowArch[] = [];
  private lanternClusters: FloatingLanterns[] = [];
  private fireflyClusters: FireflyCluster[] = [];
  private volcanoes: Volcano[] = [];
  private flockFormationHUD: FlockFormationHUD | null = null;
  private remotePlayerNameLabels!: RemotePlayerNameLabels;
  private balloonInRange: boolean[] = [];
  private balloonGreetCooldown: number[] = [];
  private balloonGreetSalt = 0;
  private balloonPosScratch = new Vector3();
  private localPlayerWorldScratch = new Vector3();

  private gamePhase: "flying" | "campsite" | "transitioning" = "flying";
  private campsiteMarker: CampsiteMarker | null = null;
  private campsiteScene: CampsiteScene | null = null;
  private transitionOverlay: TransitionOverlay | null = null;
  private hullColor = 0xff4444;

  private running = false;
  private worldConfig: WorldConfig | null = null;
  private worldSlug = "";
  private playerName = "Pilot";
  private playerVehicle: Vehicle = "plane";
  private dayNightCycle!: DayNightCycle;
  private audioManager = new AudioManager();
  private vehicleFeatures!: VehicleGameFeatures;

  private introActive = false;
  private pendingCampsiteAfterIntro = false;
  private introTimer = 0;
  private vehicleFlashTimer = 0;
  private lastDiamondCollectAt = 0;
  private diamondComboStep = 0;
  private introStartPos = new Vector3();
  private introEndPos = new Vector3();
  private introEndLookAt = new Vector3();

  private hemiLight!: HemisphereLight;
  private ambientLight!: AmbientLight;
  private sunLight!: DirectionalLight;
  private sun2Light!: DirectionalLight;
  private fillLight!: DirectionalLight;
  private fill2Light!: DirectionalLight;
  private backLight!: DirectionalLight;
  private skyCanvas!: HTMLCanvasElement;
  private skyTexture!: CanvasTexture;

  private previewCamera!: PerspectiveCamera;
  private previewActive = false;
  private previewAngle = 0;
  private loadingEl: HTMLDivElement | null = null;
  private reservationId?: string;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /* ── Public entry point ──────────────────────────────────────────── */

  async start() {
    this.mobile = isMobile();
    this.showLoadingOverlay();

    const serverUrl = this.getServerUrl();

    try {
      const joinRes = await fetch(`${serverUrl}/api/worlds/auto-join`, {
        method: "POST",
      });
      if (!joinRes.ok) throw new Error("Failed to auto-join world");
      const data = await joinRes.json();
      this.worldSlug = data.slug;
      this.reservationId = data.reservationId;
      this.worldConfig = data;
    } catch (err) {
      console.error("Server error:", err);
      this.showLoadingError();
      return;
    }

    this.dayNightCycle = new DayNightCycle(this.worldConfig?.seed ?? 42);
    this.audioManager.init().then(() => {
      this.audioManager.loadSFX("engine_biplane", "/audio/sfx/engine_biplane.mp3");
      this.audioManager.loadSFX("engine_carpet", "/audio/sfx/carpet_1.mp3");
      this.audioManager.loadSFX("crickets_loop", "/audio/sfx/crickets_loop.mp3");
      for (const id of DIAMOND_SFX_IDS) {
        this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
      }
      for (const id of SPEED_BOOST_SFX_IDS) {
        this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
      }
      for (const id of BOX_COLLECT_SFX_IDS) {
        this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
      }
      for (const id of CHEER_SFX_IDS) {
        this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
      }
      for (const id of DIALOGUE_LOOP_IDS) {
        this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
      }
      for (const id of LEVELUP_SFX_IDS) {
        this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
      }
    });
    this.playerName = generateWhimsicalName();

    this.initPreview();
    this.previewActive = true;
    requestAnimationFrame(this.previewTick);

    this.removeLoadingOverlay();

    this.lobby = new Lobby(this.container, {
      playerName: this.playerName,
      mobile: this.mobile,
      onNameChange: (name) => { this.playerName = name; },
      onPlay: (vehicle, options) => {
        this.pendingCampsiteAfterIntro = options?.startAtCampsite ?? false;
        this.playerVehicle = vehicle;
        this.audioManager.startMusic();
        void this.audioManager.loadSFX("crickets_loop", "/audio/sfx/crickets_loop.mp3").then(() => {
          this.audioManager.startLoop("crickets_loop", 0);
        });
        void this.audioManager.loadSFX(RAIN_LOOP_NAME, "/audio/sfx/rain_1.mp3").then(() => {
          this.audioManager.startLoop(RAIN_LOOP_NAME, 0);
        });
        void this.audioManager.loadSFX(BIRDS_LOOP_NAME, "/audio/sfx/birds_chirp_1.mp3").then(() => {
          this.audioManager.startLoop(BIRDS_LOOP_NAME, 0);
        });
        this.lobby.fadeOut(() => {
          this.lobby.dispose();
          this.startGame(vehicle);
        });
      },
    });
    this.lobby.show();
  }

  /* ── Loading overlay ─────────────────────────────────────────────── */

  private showLoadingOverlay() {
    this.loadingEl = document.createElement("div");
    this.loadingEl.id = "loading-overlay";
    this.loadingEl.innerHTML = `
      <h1 class="loading-title">Tiny Skies</h1>
    `;
    Object.assign(this.loadingEl.style, {
      position: "fixed",
      inset: "0",
      zIndex: "200",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#000",
      fontFamily: "'Inter', system-ui, sans-serif",
    });
    const title = this.loadingEl.querySelector(".loading-title") as HTMLElement;
    Object.assign(title.style, {
      fontSize: "clamp(2rem, 8vw, 3rem)",
      fontWeight: "800",
      margin: "0",
      background: "linear-gradient(135deg, #4488ff 0%, #44ddff 100%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      animation: "loading-pulse 1.5s ease-in-out infinite",
    });

    if (!document.getElementById("loading-styles")) {
      const s = document.createElement("style");
      s.id = "loading-styles";
      s.textContent = `
        @keyframes loading-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `;
      document.head.appendChild(s);
    }

    this.container.appendChild(this.loadingEl);
  }

  private showLoadingError() {
    if (!this.loadingEl) return;
    this.loadingEl.innerHTML = `
      <div style="text-align:center;padding:0 24px;">
        <h1 class="loading-title" style="font-size:clamp(2rem,8vw,3rem);font-weight:800;margin:0;
          background:linear-gradient(135deg,#4488ff,#44ddff);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;
          background-clip:text;animation:none;">Tiny Skies</h1>
        <p style="color:rgba(180,200,255,0.5);margin:16px 0 20px;font-size:0.9rem;">
          Could not connect to server
        </p>
        <button id="btn-retry" style="padding:14px 32px;min-height:48px;border:none;border-radius:8px;
          background:linear-gradient(135deg,#3366dd,#2288ee);color:white;
          font-weight:600;font-size:0.9rem;cursor:pointer;font-family:inherit;">
          Retry
        </button>
      </div>
    `;
    this.loadingEl.querySelector("#btn-retry")!.addEventListener("click", () => {
      this.removeLoadingOverlay();
      this.start();
    });
  }

  private removeLoadingOverlay() {
    this.loadingEl?.remove();
    this.loadingEl = null;
    document.getElementById("loading-styles")?.remove();
  }

  /* ── Phase 1: Preview (globe + orbiting camera) ──────────────────── */

  private initPreview() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1 : 2));
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = VSMShadowMap;
    this.container.appendChild(this.renderer.domElement);

    if (this.mobile) {
      this.container.style.webkitUserSelect = "none";
      this.container.style.userSelect = "none";
      this.container.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    this.scene = new Scene();
    const preset = this.dayNightCycle.getPreset();
    this.scene.background = this.createSkyGradient(preset.skyGradient);
    const fogScale = this.mobile ? 0.7 : 1;
    this.scene.fog = new Fog(preset.fogColor, preset.fogNear * fogScale, preset.fogFar * fogScale);
    this.clock = new Clock();

    this.hemiLight = new HemisphereLight(preset.hemiSkyColor, preset.hemiGroundColor, preset.hemiIntensity);
    this.scene.add(this.hemiLight);
    this.ambientLight = new AmbientLight(preset.ambientColor, preset.ambientIntensity);
    this.scene.add(this.ambientLight);
    this.sunLight = new DirectionalLight(preset.sunColor, preset.sunIntensity);
    this.sunLight.position.set(10, 12, 5);
    this.sunLight.castShadow = true;
    const shadowRes = this.mobile ? 1024 : 2048;
    this.sunLight.shadow.mapSize.width = shadowRes;
    this.sunLight.shadow.mapSize.height = shadowRes;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 30;
    this.sunLight.shadow.camera.left = -10;
    this.sunLight.shadow.camera.right = 10;
    this.sunLight.shadow.camera.top = 10;
    this.sunLight.shadow.camera.bottom = -10;
    this.sunLight.shadow.radius = 4;
    this.sunLight.shadow.blurSamples = 16;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.fillLight = new DirectionalLight(preset.fillColor, preset.fillIntensity);
    this.fillLight.position.set(-8, -5, -10);
    this.scene.add(this.fillLight);
    this.backLight = new DirectionalLight(preset.backColor, preset.backIntensity);
    this.backLight.position.set(-3, 10, -6);
    this.scene.add(this.backLight);

    this.sun2Light = new DirectionalLight(preset.sun2Color, preset.sun2Intensity);
    this.sun2Light.position.set(-10, -12, -5);
    this.scene.add(this.sun2Light);
    this.fill2Light = new DirectionalLight(preset.fill2Color, preset.fill2Intensity);
    this.fill2Light.position.set(8, -8, -10);
    this.scene.add(this.fill2Light);

    const seed = this.worldConfig?.seed ?? 42;
    const terrainType = this.worldConfig?.terrainType ?? "default";
    this.gameSeed = seed;
    this.gameTerrainType = terrainType;
    this.globe = new Globe(
      this.worldConfig?.globeRadius ?? 5, seed, terrainType,
      preset.atmosphereGlow, preset.oceanShallow, preset.oceanDeep,
      preset.oceanFoam, preset.rimColor, preset.cloudOpacity,
      this.mobile ? 128 : 256,
    );
    this.globe.addTo(this.scene);

    this.starfield = new Starfield();
    this.starfield.group.visible = preset.stars;
    this.scene.add(this.starfield.group);

    this.aurora = new Aurora();
    this.aurora.group.visible = preset.aurora;
    this.scene.add(this.aurora.group);

    this.previewCamera = new PerspectiveCamera(60, w / h, 0.1, 100);
    this.previewAngle = 0;

    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    for (let vi = 0; vi < VOLCANO_COUNT; vi++) {
      this.volcanoes.push(new Volcano(this.scene, globeRadius, seed, terrainType, vi));
    }

    this.campsiteMarker = new CampsiteMarker(this.scene, globeRadius, seed, terrainType);

    window.addEventListener("resize", this.onPreviewResize);
  }

  private previewTick = () => {
    if (!this.previewActive) return;
    requestAnimationFrame(this.previewTick);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.previewAngle += 0.05 * dt;

    const radius = this.mobile ? 17 : 12;
    const tiltY = Math.sin(-0.26) * radius;
    const tiltXZ = Math.cos(-0.26) * radius;
    this.previewCamera.position.set(
      Math.sin(this.previewAngle) * tiltXZ,
      tiltY,
      Math.cos(this.previewAngle) * tiltXZ,
    );
    this.previewCamera.lookAt(0, 0, 0);

    this.globe.update(dt);
    for (const v of this.volcanoes) v.update(dt, _farQ, 999);
    this.campsiteMarker?.update(dt);
    this.applyDayNightPreset();
    this.audioManager.update(dt);
    this.aurora?.update(dt, this.previewCamera);
    this.renderer.render(this.scene, this.previewCamera);
  };

  private onPreviewResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.previewCamera.aspect = w / h;
    this.previewCamera.updateProjectionMatrix();
  };

  /* ── Phase 2: Start game (player, camera, VFX, HUD, networking) ── */

  private startGame(vehicle: Vehicle) {
    this.previewActive = false;
    window.removeEventListener("resize", this.onPreviewResize);

    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    const seed = this.gameSeed;
    const terrainType = this.gameTerrainType;
    const preset = this.dayNightCycle.getPreset();
    this.playerVehicle = vehicle;
    this.vehicleFeatures = getVehicleFeatures(vehicle);

    const spawnSessionSalt =
      (Date.now() ^ ((Math.random() * 0xffffffff) | 0) ^ (seed * 7919)) >>> 0;
    const hullColor = pickRandomVehicleColor(vehicle);
    this.hullColor = hullColor;

    const w2 = this.container.clientWidth;
    const h2 = this.container.clientHeight;
    this.campsiteScene = new CampsiteScene(w2 / h2, this.mobile, this.container);
    this.transitionOverlay = new TransitionOverlay(this.container);

    if (vehicle === "boat") {
      this.localPlayer = new Boat(globeRadius, seed, terrainType, hullColor, spawnSessionSalt);
    } else if (vehicle === "carpet") {
      this.localPlayer = new Carpet(globeRadius, seed, terrainType, spawnSessionSalt, hullColor);
    } else {
      this.localPlayer = new Plane(globeRadius, seed + spawnSessionSalt, hullColor, seed, terrainType);
    }
    this.localPlayer.addTo(this.scene);

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.cameraRig = new CameraRig(w / h);

    const playerWorldPos = cartesianFromSpherical(
      this.localPlayer.qPosition,
      this.localPlayer.altitude,
      globeRadius,
    );
    const frame = tangentFrame(this.localPlayer.qPosition);
    const fwd = new Vector3()
      .addScaledVector(frame.north, Math.cos(this.localPlayer.heading))
      .addScaledVector(frame.east, Math.sin(this.localPlayer.heading))
      .normalize();

    this.introEndPos
      .copy(playerWorldPos)
      .addScaledVector(fwd, -this.vehicleFeatures.cameraFollowDistance)
      .addScaledVector(frame.up, this.vehicleFeatures.cameraFollowHeight);
    this.introEndLookAt.copy(playerWorldPos).addScaledVector(fwd, 0.5);

    this.introStartPos.copy(this.previewCamera.position);

    this.cameraRig.setPositionAndLookAt(this.introStartPos, new Vector3(0, 0, 0), 0, new Vector3(0, 1, 0));
    this.introActive = true;
    this.introTimer = 0;

    if (this.mobile) {
      this.touchControls = new TouchControls(this.container);
      this.touchControls.setVehicle(vehicle);
      this.controls = new FlightControls(this.container);
      this.controls.enabled = false;
    } else {
      this.controls = new FlightControls(this.container);
    }

    this.remotePlanes = new RemotePlaneManager(this.scene, globeRadius);

    this.speedLines = new SpeedLines();

    this.contrails = new Contrails();
    this.contrails.group.visible = this.vehicleFeatures.contrails;
    this.scene.add(this.contrails.group);

    this.wakeTrail = new WakeTrail();
    this.wakeTrail.group.visible = this.vehicleFeatures.wakeTrail;
    this.scene.add(this.wakeTrail.group);

    this.carpetTrail = new CarpetTrail();
    this.carpetTrail.group.visible = this.vehicleFeatures.carpetTrail;
    this.scene.add(this.carpetTrail.group);

    this.carpetWake = new CarpetWake();
    this.carpetWake.group.visible = this.vehicleFeatures.carpetTrail;
    this.scene.add(this.carpetWake.group);

    this.carpetLeaves = new CarpetLeaves();
    this.carpetLeaves.group.visible = this.vehicleFeatures.carpetTrail;
    this.scene.add(this.carpetLeaves.group);

    this.lensFlare = new LensFlare();
    this.lensFlare.setColorScale(preset.flareColorScale);

    this.rainOverlay = new RainOverlay();

    /* Softer warm fill than 0xffaa55; wider range so falloff on the mesh is gentler. */
    this.playerLight = new PointLight(0xeec4a8, 0, 6.5, 1.25);
    this.scene.add(this.playerLight);

    const ringMode = vehicle === "boat" ? "boat" : vehicle === "carpet" ? "carpet" : "plane";
    this.ringManager = new RingManager(globeRadius, { mode: ringMode, seed, terrainType });
    this.ringManager.setConsumerActive(this.vehicleFeatures.collectibleDiamonds);
    this.scene.add(this.ringManager.group);

    this.collectVFX = new RingCollectVFX();
    this.scene.add(this.collectVFX.group);

    this.ringManager.onCollect = (xp, worldPos, tier) => {
      const rolling = this.vehicleFeatures.barrelRollBonus && this.localPlayer.isRolling;
      const bonusXP = rolling ? xp : 0;
      if (bonusXP > 0) {
        this.ringManager.sessionXP += bonusXP;
        this.ringManager.level = this.ringManager.getLevel();
      }
      this.collectVFX.play(worldPos, tier);
      if (this.vehicleFeatures.collectibleDiamonds) {
        const now = performance.now();
        if (now - this.lastDiamondCollectAt > DIAMOND_COMBO_WINDOW_MS) {
          this.diamondComboStep = 0;
        } else {
          this.diamondComboStep = Math.min(this.diamondComboStep + 1, DIAMOND_COMBO_MAX_STEPS);
        }
        this.lastDiamondCollectAt = now;
        const rate = 1 + this.diamondComboStep * DIAMOND_COMBO_RATE_PER_STEP;
        const pick =
          DIAMOND_SFX_IDS[Math.floor(Math.random() * DIAMOND_SFX_IDS.length)]!;
        this.audioManager.playSFX(pick, DIAMOND_SFX_VOLUME, rate);
      }
      this.vehicleFlashTimer = 0.35;
      this.cameraRig.shake();
      if (this.localPlayer instanceof Plane) {
        this.localPlayer.speedBoost();
        const boostPick =
          SPEED_BOOST_SFX_IDS[Math.floor(Math.random() * SPEED_BOOST_SFX_IDS.length)]!;
        this.audioManager.playSFX(boostPick, SPEED_BOOST_SFX_VOLUME);
      }
      this.hud.showXPGain(xp + bonusXP, rolling);
      this.hud.setXP(
        this.ringManager.getXP(),
        this.ringManager.getXPForNextLevel(),
        this.ringManager.getXPForCurrentLevel(),
        this.ringManager.getLevel(),
      );
    };
    this.ringManager.onLevelUp = (level) => {
      this.playLevelUpSfx();
      this.hud.showLevelUp(level);
    };

    this.hud = new HUD(this.container);
    this.hud.setWorldName(this.worldConfig?.name ?? "Unknown World");
    this.hud.setMuteToggle(() => this.audioManager.toggleMute());
    this.hud.setCampsiteAction(() => {
      if (this.gamePhase === "flying") this.doLanding();
    });
    this.hud.setVehicle(vehicle, {
      showXpProgression: this.vehicleFeatures.xpProgressionUI,
    });
    mountControlHints(this.hud.root, vehicle, !this.mobile);
    this.hud.hideUI();
    this.remotePlayerNameLabels = new RemotePlayerNameLabels(this.hud.root);

    this.flockFormationHUD = new FlockFormationHUD(this.hud.root);
    for (let fi = 0; fi < BIRD_FLOCK_COUNT; fi++) {
      this.birdFlocks.push(new BirdFlock(this.scene, globeRadius, seed, fi));
    }

    for (let ri = 0; ri < RAINBOW_COUNT; ri++) {
      this.rainbowArches.push(new RainbowArch(this.scene, globeRadius, seed, ri));
    }

    for (let li = 0; li < LANTERN_CLUSTER_COUNT; li++) {
      this.lanternClusters.push(new FloatingLanterns(this.scene, globeRadius, seed, li));
    }

    for (let fi = 0; fi < FIREFLY_CLUSTER_COUNT; fi++) {
      this.fireflyClusters.push(new FireflyCluster(this.scene, globeRadius, seed, terrainType, fi));
    }

    const landmarkRegistry = new LandmarkRegistry();
    landmarkRegistry.registerVillages(this.globe.villageCenters, seed);
    landmarkRegistry.registerLighthouses(this.globe.lighthouseCenters, seed);
    landmarkRegistry.registerWindmills(this.globe.windmillCenters, seed);
    this.landmarkDetector = new LandmarkDetector(landmarkRegistry);
    this.landmarkHUD = new LandmarkHUD(this.hud.root);
    this.hud.registerLandmarkHUD(this.landmarkHUD);
    this.landmarkDetector.onEnter = (lm) => this.landmarkHUD.show(lm.name, lm.type);
    this.landmarkDetector.onExit = () => this.landmarkHUD.hide();

    this.packageQuestHUD = new PackageQuestHUD(this.hud.root);
    this.packageQuestHUD.onVisibilityChange = (visible, npcName) => {
      this.hud.setBubbleVisible(visible);
      if (visible && npcName) {
        for (const id of DIALOGUE_LOOP_IDS) {
          this.audioManager.fadeOutLoop(id);
        }
        const id =
          DIALOGUE_LOOP_IDS[Math.floor(Math.random() * DIALOGUE_LOOP_IDS.length)]!;
        const rate = isNpcMale(npcName)
          ? DIALOGUE_MALE_PLAYBACK_RATE
          : 1;
        this.audioManager.startLoop(id, 0, rate);
        this.audioManager.setLoopVolume(id, DIALOGUE_LOOP_VOLUME);
      } else if (!visible) {
        for (const id of DIALOGUE_LOOP_IDS) {
          this.audioManager.fadeOutLoop(id);
        }
      }
    };

    const balloonN = this.globe.balloonCount;
    this.balloonInRange = new Array(balloonN).fill(false);
    this.balloonGreetCooldown = new Array(balloonN).fill(0);

    if (this.vehicleFeatures.packageQuests) {
      this.packageQuest = new PackageQuestManager(
        this.scene, globeRadius, landmarkRegistry, seed, terrainType,
      );

      this.packageQuest.onPickup = (_originName, destName, npcName, dialogue) => {
        const boxPick =
          BOX_COLLECT_SFX_IDS[Math.floor(Math.random() * BOX_COLLECT_SFX_IDS.length)]!;
        this.audioManager.playSFX(boxPick, BOX_COLLECT_SFX_VOLUME);
        this.packageQuestHUD.showBubble(npcName, dialogue);
        this.packageQuestHUD.showDeliveryTarget(destName);
        const pos = new Vector3().setFromMatrixPosition(this.localPlayer.group.matrixWorld);
        const dm = this.packageQuest!.getDeliverySurfaceDistanceMetres(pos);
        if (dm !== null) this.packageQuestHUD.setDeliveryDistanceMetres(dm);
      };

      this.packageQuest.onDelivered = (_destName, npcName, dialogue, xp) => {
        const cheerPick =
          CHEER_SFX_IDS[Math.floor(Math.random() * CHEER_SFX_IDS.length)]!;
        this.audioManager.playSFX(cheerPick, CHEER_SFX_VOLUME);
        this.packageQuestHUD.showBubble(npcName, dialogue);
        this.packageQuestHUD.hideDeliveryTarget();

        const prevLevel = this.ringManager.level;
        this.ringManager.sessionXP += xp;
        this.ringManager.level = this.ringManager.getLevel();
        this.hud.showXPGain(xp);
        this.hud.setXP(
          this.ringManager.getXP(),
          this.ringManager.getXPForNextLevel(),
          this.ringManager.getXPForCurrentLevel(),
          this.ringManager.getLevel(),
        );
        if (this.ringManager.level > prevLevel) {
          this.playLevelUpSfx();
          this.hud.showLevelUp(this.ringManager.level);
        }
      };

      this.packageQuest.onProgressChange = (progress) => {
        this.packageQuestHUD.setProgress(progress);
      };
    }

    window.addEventListener("resize", this.onResize);

    this.initNetworking(this.worldSlug);

    this.clock.getDelta();
    this.running = true;
    this.tick();
  }

  /* ── Networking ──────────────────────────────────────────────────── */

  private worldFullRetries = 0;
  private static readonly MAX_WORLD_FULL_RETRIES = 3;

  private initNetworking(slug: string) {
    const serverUrl = this.getServerUrl();
    this.socketClient = new SocketClient(serverUrl);

    this.socketClient.onPlayerJoined((player) => {
      this.remotePlanes.addPlayer(player);
      this.hud.setPlayerCount(this.remotePlanes.count + 1);
    });

    this.socketClient.onPlayerLeft((playerId) => {
      this.remotePlanes.removePlayer(playerId);
      this.hud.setPlayerCount(this.remotePlanes.count + 1);
    });

    this.socketClient.onPlayerUpdate((player) => {
      this.remotePlanes.updatePlayer(player);
    });

    this.socketClient.onWorldState((players) => {
      for (const p of players) {
        this.remotePlanes.addPlayer(p);
      }
      this.hud.setPlayerCount(this.remotePlanes.count + 1);
    });

    this.socketClient.onWorldFull(() => {
      this.handleWorldFull();
    });

    this.socketClient.joinWorld(slug, this.playerName, this.playerVehicle, this.reservationId);

    this.stateSync = new StateSync(this.socketClient, this.localPlayer);
    this.stateSync.start();

    if (this.playerVehicle === "plane") {
      this.audioManager.startLoop("engine_biplane", 0);
    } else if (this.playerVehicle === "carpet") {
      this.audioManager.startLoop("engine_carpet", 0.06);
    }
  }

  private async handleWorldFull() {
    this.worldFullRetries++;
    if (this.worldFullRetries > Game.MAX_WORLD_FULL_RETRIES) {
      console.error("Max world:full retries exceeded");
      return;
    }

    console.log(`World full, retrying auto-join (attempt ${this.worldFullRetries})...`);

    this.socketClient?.disconnect();
    this.stateSync?.stop();

    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      padding: "16px 28px",
      borderRadius: "12px",
      background: "rgba(0, 0, 0, 0.7)",
      backdropFilter: this.mobile ? "none" : "blur(12px)",
      color: "white",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: this.mobile ? "0.85rem" : "0.95rem",
      zIndex: "300",
    });
    toast.textContent = "Finding a new world...";
    this.container.appendChild(toast);

    try {
      const serverUrl = this.getServerUrl();
      const joinRes = await fetch(`${serverUrl}/api/worlds/auto-join`, {
        method: "POST",
      });
      if (!joinRes.ok) throw new Error("Failed to auto-join");
      const data = await joinRes.json();

      this.worldSlug = data.slug;
      this.reservationId = data.reservationId;
      this.worldConfig = data;

      this.hud.setWorldName(data.name ?? "Unknown World");

      this.initNetworking(this.worldSlug);
    } catch (err) {
      console.error("Retry auto-join failed:", err);
    } finally {
      toast.remove();
    }
  }

  /* ── Main game loop ──────────────────────────────────────────────── */

  private static readonly INTRO_DURATION = 4.5;

  private tick = () => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const globeRadius = this.worldConfig?.globeRadius ?? 5;

    if (this.introActive) {
      this.introTimer += dt;
      const raw = Math.min(this.introTimer / Game.INTRO_DURATION, 1);
      const t = 1 - Math.pow(1 - raw, 3);

      this.localPlayer.update(dt, 0, false, false, false, false);

      const playerWorldPos = cartesianFromSpherical(
        this.localPlayer.qPosition,
        this.localPlayer.altitude,
        globeRadius,
      );
      const frame = tangentFrame(this.localPlayer.qPosition);
      const fwd = new Vector3()
        .addScaledVector(frame.north, Math.cos(this.localPlayer.heading))
        .addScaledVector(frame.east, Math.sin(this.localPlayer.heading))
        .normalize();
      this.introEndPos
        .copy(playerWorldPos)
        .addScaledVector(fwd, -this.vehicleFeatures.cameraFollowDistance)
        .addScaledVector(frame.up, this.vehicleFeatures.cameraFollowHeight);
      this.introEndLookAt.copy(playerWorldPos).addScaledVector(fwd, 0.5);

      const startDir = this.introStartPos.clone().normalize();
      const endDir = this.introEndPos.clone().normalize();
      const startDist = this.introStartPos.length();
      const endDist = this.introEndPos.length();

      const dir = startDir.clone().lerp(endDir, t).normalize();
      const dist = startDist + (endDist - startDist) * t;
      const pos = dir.multiplyScalar(dist);

      const lookAt = new Vector3().lerpVectors(new Vector3(0, 0, 0), this.introEndLookAt, t);
      const worldUp = new Vector3(0, 1, 0);
      const localUp = pos.clone().normalize();
      const up = worldUp.clone().lerp(localUp, t).normalize();
      const rollZ = Math.sin(t * Math.PI) * 0.3;
      this.cameraRig.setPositionAndLookAt(pos, lookAt, rollZ, up);

      this.globe.update(dt);
      this.remotePlanes.update(dt, this.cameraRig.camera);
      this.applyDayNightPreset();
      this.audioManager.update(dt);
      this.aurora?.update(dt, this.cameraRig.camera);

      this.localPlayer.group.updateMatrixWorld(true);
      if (this.playerLight) {
        this.playerLight.position.setFromMatrixPosition(this.localPlayer.group.matrixWorld);
        const up = this.playerLight.position.clone().normalize();
        this.playerLight.position.addScaledVector(up, 0.15);
      }

      this.remotePlayerNameLabels.update(
        this.remotePlanes,
        this.cameraRig.camera,
        this.renderer.domElement,
        this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
      );

      this.renderer.render(this.scene, this.cameraRig.camera);

      if (raw >= 1) {
        this.introActive = false;
        this.cameraRig.snapTo(
          this.localPlayer.qPosition,
          this.localPlayer.heading,
          this.localPlayer.altitude,
          globeRadius,
          this.vehicleFeatures.cameraFollowDistance,
          this.vehicleFeatures.cameraFollowHeight,
        );
        this.hud.show();
        if (this.pendingCampsiteAfterIntro) {
          this.pendingCampsiteAfterIntro = false;
          void this.doLanding();
        }
      }
      return;
    }

    /* ── Campsite phase ────────────────────────────────── */
    if (this.gamePhase === "campsite" && this.campsiteScene) {
      const result = this.campsiteScene.update(dt);
      this.applyDayNightPreset();
      /* Campsite: lock to day preset while tuning colors (globe still uses full cycle). */
      this.campsiteScene.updatePreset(getSkyPreset("day"));
      this.audioManager.update(dt);
      this.renderer.render(this.campsiteScene.scene, this.campsiteScene.camera);
      if (result.takeOff) this.doTakeOff();
      return;
    }
    if (this.gamePhase === "transitioning") {
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    const { turnRate, forward, brake, elevate, descend, barrelRoll, interact } =
      this.touchControls ? this.touchControls.getState() : this.controls.getState();
    this.localPlayer.update(dt, turnRate, forward, brake, elevate, barrelRoll, descend);

    this.cameraRig.update(
      dt,
      this.localPlayer.qPosition,
      this.localPlayer.heading,
      this.localPlayer.altitude,
      globeRadius,
      turnRate,
      this.localPlayer.speedRatio,
      this.vehicleFeatures.cameraTiltScale,
      this.vehicleFeatures.cameraFollowDistance,
      this.vehicleFeatures.cameraFollowHeight,
      this.vehicleFeatures.cameraSpeedZoom,
      this.vehicleFeatures.cameraFovBoost,
    );

    this.globe.update(dt);

    this.remotePlanes.update(dt, this.cameraRig.camera);

    this.localPlayer.group.updateMatrixWorld(true);

    if (this.vehicleFeatures.collectibleDiamonds) {
      this.ringManager.update(dt, this.localPlayer.qPosition, this.localPlayer.altitude);
      this.collectVFX.update(dt);
    }

    if (this.birdFlocks.length > 0 && this.flockFormationHUD) {
      let bestProgress = 0;
      let anyCompleted = false;
      for (const flock of this.birdFlocks) {
        const { progress, justCompleted } = flock.update(
          dt,
          this.localPlayer.qPosition,
          this.localPlayer.altitude,
          this.localPlayer.heading,
        );
        bestProgress = Math.max(bestProgress, progress);
        if (justCompleted) anyCompleted = true;
      }
      this.flockFormationHUD.setProgress(bestProgress);
      if (anyCompleted) {
        this.hud.showFlockFormationCelebrate();
        this.ringManager.applyBonusXP(FLOCK_FORMATION_XP);
        this.hud.showXPGain(FLOCK_FORMATION_XP);
        this.hud.setXP(
          this.ringManager.getXP(),
          this.ringManager.getXPForNextLevel(),
          this.ringManager.getXPForCurrentLevel(),
          this.ringManager.getLevel(),
        );
        this.vehicleFlashTimer = 0.35;
        this.cameraRig.shake();
      }
    }

    if (this.rainbowArches.length > 0) {
      const dayW = this.dayNightCycle.getDayWeight();
      for (const arch of this.rainbowArches) {
        const { justCollected } = arch.update(dt, this.localPlayer.qPosition, this.localPlayer.altitude, dayW);
        if (justCollected) {
          this.hud.showRainbowCelebrate();
          this.ringManager.applyBonusXP(RAINBOW_XP);
          this.hud.showXPGain(RAINBOW_XP);
          this.hud.setXP(
            this.ringManager.getXP(),
            this.ringManager.getXPForNextLevel(),
            this.ringManager.getXPForCurrentLevel(),
            this.ringManager.getLevel(),
          );
          this.vehicleFlashTimer = 0.35;
          this.cameraRig.shake();
        }
      }
    }

    if (this.lanternClusters.length > 0) {
      const nightW = this.dayNightCycle.getNightWeight();
      for (let li = 0; li < this.lanternClusters.length; li++) {
        const cluster = this.lanternClusters[li]!;
        const { justCollected } = cluster.update(
          dt,
          this.localPlayer.qPosition,
          this.localPlayer.altitude,
          nightW,
          li,
          this.worldConfig?.seed ?? 42,
        );
        if (justCollected) {
          this.hud.showLanternCelebrate();
          this.ringManager.applyBonusXP(LANTERN_XP);
          this.hud.showXPGain(LANTERN_XP);
          this.hud.setXP(
            this.ringManager.getXP(),
            this.ringManager.getXPForNextLevel(),
            this.ringManager.getXPForCurrentLevel(),
            this.ringManager.getLevel(),
          );
          this.vehicleFlashTimer = 0.35;
          this.cameraRig.shake();
        }
      }
    }

    if (this.fireflyClusters.length > 0) {
      const nightW = this.dayNightCycle.getNightWeight();
      for (let fi = 0; fi < this.fireflyClusters.length; fi++) {
        const cluster = this.fireflyClusters[fi]!;
        const { justCollected } = cluster.update(
          dt,
          this.localPlayer.qPosition,
          this.localPlayer.altitude,
          nightW,
          fi,
        );
        if (justCollected) {
          this.hud.showFireflyCelebrate();
          this.ringManager.applyBonusXP(FIREFLY_XP);
          this.hud.showXPGain(FIREFLY_XP);
          this.hud.setXP(
            this.ringManager.getXP(),
            this.ringManager.getXPForNextLevel(),
            this.ringManager.getXPForCurrentLevel(),
            this.ringManager.getLevel(),
          );
          this.vehicleFlashTimer = 0.35;
        }
      }
    }

    if (this.volcanoes.length > 0) {
      for (const volcano of this.volcanoes) {
        const { justCollected } = volcano.update(
          dt,
          this.localPlayer.qPosition,
          this.localPlayer.altitude,
        );
        if (justCollected) {
          this.hud.showVolcanoCelebrate();
          this.ringManager.applyBonusXP(VOLCANO_XP);
          this.hud.showXPGain(VOLCANO_XP);
          this.hud.setXP(
            this.ringManager.getXP(),
            this.ringManager.getXPForNextLevel(),
            this.ringManager.getXPForCurrentLevel(),
            this.ringManager.getLevel(),
          );
          this.vehicleFlashTimer = 0.35;
          this.cameraRig.shake();
        }
      }
    }

    /* ── Campsite landing detection ─────────────────────── */
    this.campsiteMarker?.update(dt);
    if (this.campsiteMarker) {
      const nearCamp = this.campsiteMarker.isPlayerNear(
        this.localPlayer.qPosition, this.localPlayer.altitude, globeRadius,
      );
      this.hud.showCampsitePrompt(nearCamp);
      if (nearCamp && interact) {
        this.doLanding();
      }
    }

    if (this.vehicleFlashTimer > 0) {
      this.vehicleFlashTimer -= dt;
      const intensity = Math.max(0, this.vehicleFlashTimer / 0.35);
      const emissiveVal = intensity * intensity;
      this.localPlayer.group.traverse((child) => {
        const mat = (child as any).material;
        if (mat instanceof MeshPhongMaterial) {
          mat.emissive.setRGB(emissiveVal * 0.4, emissiveVal * 1.0, emissiveVal * 0.8);
        }
      });
    }

    if (this.playerLight) {
      this.playerLight.position.setFromMatrixPosition(this.localPlayer.group.matrixWorld);
      const up = this.playerLight.position.clone().normalize();
      this.playerLight.position.addScaledVector(up, 0.15);
    }
    if (this.vehicleFeatures.speedLines) {
      this.speedLines.update(dt, this.localPlayer.speed, this.cameraRig.camera);
    }
    if (this.vehicleFeatures.contrails) {
      this.contrails.update(this.localPlayer.group.matrixWorld, this.cameraRig.camera);
    }
    if (this.vehicleFeatures.wakeTrail) {
      this.wakeTrail.update(this.localPlayer.group.matrixWorld, this.cameraRig.camera);
    }
    if (this.vehicleFeatures.carpetTrail) {
      this.carpetTrail.update(
        this.localPlayer.group.matrixWorld,
        this.cameraRig.camera,
        this.localPlayer.speedRatio,
      );
      this.carpetWake.update(
        dt,
        this.localPlayer.qPosition,
        this.localPlayer.heading,
        globeRadius,
        this.localPlayer.speed,
        elevate,
        this.gameSeed,
        this.gameTerrainType,
        this.cameraRig.camera,
      );
      this.carpetLeaves.update(
        dt,
        this.localPlayer.qPosition,
        this.localPlayer.heading,
        globeRadius,
        this.localPlayer.speed,
        this.localPlayer.altitude,
        this.gameSeed,
        this.gameTerrainType,
      );
    }

    this.landmarkDetector.update(this.localPlayer.qPosition);
    const questPlayerPos = new Vector3().setFromMatrixPosition(this.localPlayer.group.matrixWorld);
    this.packageQuest?.update(dt, this.localPlayer.qPosition, this.cameraRig.camera, questPlayerPos);
    (this.localPlayer as any).carrying = this.packageQuest?.isCarrying ?? false;
    if (this.packageQuest?.isCarrying) {
      const dm = this.packageQuest.getDeliverySurfaceDistanceMetres(questPlayerPos);
      if (dm !== null) this.packageQuestHUD.setDeliveryDistanceMetres(dm);
    }
    this.updateBalloonGreetings(dt, questPlayerPos);

    if (this.playerVehicle === "plane") {
      const engineVol =
        0.08 + (this.localPlayer as Plane).engineSpeedRatio * 0.25;
      this.audioManager.setLoopVolume("engine_biplane", engineVol);
    }

    this.applyDayNightPreset();
    this.audioManager.update(dt);
    this.lensFlare?.update(this.cameraRig.camera);
    this.aurora?.update(dt, this.cameraRig.camera);
    this.rainOverlay?.update(dt, this.dayNightCycle.getRainWeight());

    this.remotePlayerNameLabels.update(
      this.remotePlanes,
      this.cameraRig.camera,
      this.renderer.domElement,
      this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
    );

    this.renderer.render(this.scene, this.cameraRig.camera);
    if (this.vehicleFeatures.speedLines) {
      this.speedLines.render(this.renderer);
    }
    this.lensFlare?.render(this.renderer);
    this.rainOverlay?.render(this.renderer);
  };

  /* ── Campsite landing / takeoff ─────────────────────────────── */

  private async doLanding() {
    if (!this.transitionOverlay || !this.campsiteScene) return;
    this.gamePhase = "transitioning";
    this.hud.showCampsitePrompt(false);
    this.hud.setCampsiteButtonVisible(false);
    this.controls.enabled = false;
    if (this.touchControls) this.touchControls.enabled = false;

    await this.transitionOverlay.fadeOut();

    this.localPlayer.group.visible = false;
    this.campsiteScene.enter(
      this.playerVehicle,
      this.hullColor,
      getSkyPreset("day"),
    );

    await this.transitionOverlay.fadeIn();
    this.gamePhase = "campsite";
  }

  private async doTakeOff() {
    if (!this.transitionOverlay || !this.campsiteScene || !this.campsiteMarker) return;
    this.gamePhase = "transitioning";

    await this.transitionOverlay.fadeOut();

    this.campsiteScene.exit();
    this.localPlayer.group.visible = true;

    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    this.localPlayer.qPosition.copy(this.campsiteMarker.surfaceQuat);
    this.localPlayer.altitude = 0.4;
    this.localPlayer.heading = 0;

    this.cameraRig.snapTo(
      this.localPlayer.qPosition,
      this.localPlayer.heading,
      this.localPlayer.altitude,
      globeRadius,
      this.vehicleFeatures.cameraFollowDistance,
      this.vehicleFeatures.cameraFollowHeight,
    );

    this.controls.enabled = true;
    if (this.touchControls) this.touchControls.enabled = true;

    await this.transitionOverlay.fadeIn();
    this.gamePhase = "flying";
    this.hud.setCampsiteButtonVisible(true);
  }

  /* ── Resize ──────────────────────────────────────────────────────── */

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.resize(w / h);
    this.campsiteScene?.resize(w / h);
  };

  /* ── Helpers ─────────────────────────────────────────────────────── */

  private createSkyGradient(stops: { stop: number; color: string }[]): CanvasTexture {
    this.skyCanvas = document.createElement("canvas");
    this.skyCanvas.width = 512;
    this.skyCanvas.height = 512;
    this.paintRadialSky(stops);
    this.skyTexture = new CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = SRGBColorSpace;
    return this.skyTexture;
  }

  private updateSkyGradient(stops: { stop: number; color: string }[]) {
    if (!this.skyCanvas) return;
    this.paintRadialSky(stops);
    this.skyTexture.needsUpdate = true;
  }

  private paintRadialSky(stops: { stop: number; color: string }[]) {
    const S = 512;
    const ctx = this.skyCanvas.getContext("2d")!;
    const cx = S / 2;
    const cy = S;
    const outerR = Math.sqrt(cx * cx + cy * cy);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
    for (const s of stops) {
      gradient.addColorStop(1.0 - s.stop, s.color);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, S, S);
  }

  private applyDayNightPreset() {
    const p = this.dayNightCycle.getPreset();
    const fogScale = this.mobile ? 0.7 : 1;

    this.updateSkyGradient(p.skyGradient);

    const fog = this.scene.fog as Fog;
    fog.color.set(p.fogColor);
    fog.near = p.fogNear * fogScale;
    fog.far = p.fogFar * fogScale;

    this.hemiLight.color.set(p.hemiSkyColor);
    this.hemiLight.groundColor.set(p.hemiGroundColor);
    this.hemiLight.intensity = p.hemiIntensity;

    this.ambientLight.color.set(p.ambientColor);
    this.ambientLight.intensity = p.ambientIntensity;

    this.sunLight.color.set(p.sunColor);
    this.sunLight.intensity = p.sunIntensity;
    this.sun2Light.color.set(p.sun2Color);
    this.sun2Light.intensity = p.sun2Intensity;

    this.fillLight.color.set(p.fillColor);
    this.fillLight.intensity = p.fillIntensity;
    this.fill2Light.color.set(p.fill2Color);
    this.fill2Light.intensity = p.fill2Intensity;

    this.backLight.color.set(p.backColor);
    this.backLight.intensity = p.backIntensity;

    this.globe.setAtmosphereGlow(p.atmosphereGlow);
    this.globe.setCloudOpacity(p.cloudOpacity);
    this.globe.setRimColor(p.rimColor);
    this.globe.setOceanColors(p.oceanShallow, p.oceanDeep, p.oceanFoam);

    const nightW = this.dayNightCycle.getNightWeight();
    const dayW = this.dayNightCycle.getDayWeight();

    if (this.starfield) {
      this.starfield.group.visible = nightW > 0.01;
      this.starfield.setOpacity(nightW);
    }
    if (this.aurora) {
      this.aurora.group.visible = nightW > 0.01;
      this.aurora.setOpacity(nightW);
    }
    if (this.playerLight) {
      this.playerLight.intensity = nightW * PLAYER_LIGHT_NIGHT_INTENSITY;
    }
    if (this.lensFlare) this.lensFlare.setColorScale([
      p.flareColorScale[0] * dayW,
      p.flareColorScale[1] * dayW,
      p.flareColorScale[2] * dayW,
    ]);

    const rainW = this.dayNightCycle.getRainWeight();
    const rainDampen = 1 - rainW;
    this.audioManager.setLoopVolume(RAIN_LOOP_NAME, rainW * RAIN_LOOP_MAX_VOL);
    this.audioManager.setLoopVolume("crickets_loop", nightW * CRICKETS_LOOP_MAX_VOL * rainDampen);
    this.audioManager.setLoopVolume(BIRDS_LOOP_NAME, dayW * BIRDS_LOOP_MAX_VOL * rainDampen);

    const mw = this.dayNightCycle.getMusicWeights();
    this.audioManager.setWeights(mw.day, mw.evening, mw.night);
  }

  private playLevelUpSfx() {
    const pick =
      LEVELUP_SFX_IDS[Math.floor(Math.random() * LEVELUP_SFX_IDS.length)]!;
    this.audioManager.playSFX(pick, LEVELUP_SFX_VOLUME, 1, 0.2);
  }

  private updateBalloonGreetings(dt: number, playerWorld: Vector3) {
    for (let i = 0; i < this.balloonGreetCooldown.length; i++) {
      this.balloonGreetCooldown[i] = Math.max(0, this.balloonGreetCooldown[i] - dt);
    }
    if (this.packageQuestHUD.isBubbleShowing) return;
    for (let i = 0; i < this.globe.balloonCount; i++) {
      if (!this.globe.getBalloonWorldPosition(i, this.balloonPosScratch)) continue;
      const dist = playerWorld.distanceTo(this.balloonPosScratch);
      if (dist < BALLOON_GREET_DIST) {
        if (!this.balloonInRange[i]) {
          if (this.balloonGreetCooldown[i] <= 0) {
            const { npcName, line } = pickBalloonGreeting(
              this.gameSeed,
              i,
              this.balloonGreetSalt++,
            );
            this.packageQuestHUD.showBubble(npcName, line);
            this.balloonGreetCooldown[i] = BALLOON_GREET_COOLDOWN;
          }
          this.balloonInRange[i] = true;
        }
      } else if (dist > BALLOON_GREET_EXIT_DIST) {
        this.balloonInRange[i] = false;
      }
    }
  }

  private getServerUrl(): string {
    return (
      (import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3001"
    );
  }

  /* ── Cleanup ─────────────────────────────────────────────────────── */

  dispose() {
    this.running = false;
    this.previewActive = false;
    this.controls?.dispose();
    this.touchControls?.dispose();
    this.speedLines?.dispose();
    this.contrails?.dispose();
    this.wakeTrail?.dispose();
    this.lensFlare?.dispose();
    this.rainOverlay?.dispose();
    this.starfield?.dispose();
    this.aurora?.dispose();
    this.ringManager?.dispose();
    this.collectVFX?.dispose();
    this.localPlayer?.dispose();
    this.globe?.dispose();
    this.renderer?.dispose();
    this.landmarkHUD?.dispose();
    this.packageQuest?.dispose();
    this.packageQuestHUD.dispose();
    for (const f of this.birdFlocks) f.dispose();
    this.birdFlocks = [];
    for (const r of this.rainbowArches) r.dispose();
    this.rainbowArches = [];
    for (const l of this.lanternClusters) l.dispose();
    this.lanternClusters = [];
    for (const f of this.fireflyClusters) f.dispose();
    this.fireflyClusters = [];
    for (const v of this.volcanoes) v.dispose();
    this.volcanoes = [];
    this.campsiteMarker?.dispose();
    this.campsiteScene?.dispose();
    this.transitionOverlay?.dispose();
    this.flockFormationHUD?.dispose();
    this.remotePlayerNameLabels.dispose();
    this.stateSync?.stop();
    this.socketClient?.disconnect();
    this.audioManager.dispose();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("resize", this.onPreviewResize);
    this.removeLoadingOverlay();
  }
}
