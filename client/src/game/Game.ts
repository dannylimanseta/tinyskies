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
  Mesh,
  MeshPhongMaterial,
  VSMShadowMap,
  CanvasTexture,
  SRGBColorSpace,
  Quaternion,
  MathUtils,
} from "three";
import { cartesianFromSpherical, tangentFrame } from "./SphericalMath";
import {
  BRAZIER_MOON_PAUSE_MS,
  getVehicleFeatures,
  type BrazierSyncPayload,
  type Vehicle,
  type VehicleGameFeatures,
  type WorldConfig,
} from "@globefly/shared";
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
import { resolveServerUrl } from "../runtime/resolveServerUrl";
import { isMobile } from "../utils/isMobile";
import { StateSync } from "../network/StateSync";
import { RemotePlaneManager } from "./RemotePlane";
import { PaintballSystem } from "./PaintballSystem";
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
import { CarpetPortalSystem } from "./CarpetPortalSystem";
import { Lobby, generateWhimsicalName } from "../ui/Lobby";
import { RemotePlayerNameLabels } from "../ui/RemotePlayerNameLabels";
import { HUD } from "../ui/HUD";
import { mountControlHints, mountCampsiteControlHints } from "../ui/ControlHints";
import { LandmarkHUD } from "../ui/LandmarkHUD";
import { PackageQuestHUD } from "../ui/PackageQuestHUD";
import { FlockFormationHUD } from "../ui/FlockFormationHUD";
import { BirdFlock, BIRD_FLOCK_COUNT, FLOCK_FORMATION_XP } from "./BirdFlock";
import { RainbowArch, RAINBOW_COUNT, RAINBOW_XP } from "./RainbowArch";
import { FloatingLanterns, LANTERN_CLUSTER_COUNT, LANTERN_XP } from "./FloatingLanterns";
import { FireflyCluster, FIREFLY_CLUSTER_COUNT, FIREFLY_XP } from "./FireflyCluster";
import { Volcano, VOLCANO_COUNT, VOLCANO_XP } from "./Volcano";
import { Braziers, BRAZIER_COUNT } from "./Braziers";
import { SkyGremlins, SKY_GREMLIN_XP } from "./SkyGremlins";
import { LandmarkRegistry, LandmarkDetector } from "./Landmarks";
import { PackageQuestManager } from "./PackageQuest";
import { isNpcMale, pickBalloonGreeting, pickPanicLine, pickObservatoryGreeting, pickStonehengeWhisper, pickBrazierWhisper } from "./PackageDialogue";
import { CampsiteMarker } from "./CampsiteMarker";
import { CampsiteScene } from "./CampsiteScene";
import { MoonThreat } from "./MoonThreat";
import { MeteorShower } from "./MeteorShower";
import { TransitionOverlay } from "../ui/TransitionOverlay";
import { CAMPSITE_HOME_ENABLED } from "../config/features";
import { LevelUpCards } from "../ui/LevelUpCards";
import { ProgressionManager, UNLOCK_BRAZIERS_MIN_MAX_LEVEL } from "./ProgressionManager";
import { CarpetLandmarkSelfieQuest, LANDMARK_SELFIE_XP } from "./CarpetLandmarkSelfieQuest";
import { HotspringPhotoUI } from "../ui/HotspringPhotoUI";
import { SkyJellyfish, JELLY_CAPTURE_XP } from "./SkyJellyfish";
import { OceanFish, FISH_CATCH_XP } from "./OceanFish";
import { CircularProgressRing } from "../ui/CircularProgressRing";

/**
 * Distance to balloon for greeting (world units, same space as globe radius ~5).
 * Previously ~0.4 was too small — you could fly visually “past” a balloon and
 * never enter the sphere in one frame. ~1.2 matches a comfortable fly-by.
 */
const _farQ = new Quaternion();
const _moonCollisionScratch = new Vector3();
const _carpetSelfieRefUp = new Vector3(0, 1, 0);
const _carpetSelfiePlayerNormal = new Vector3();
const BALLOON_GREET_DIST = 1.2;
const BALLOON_GREET_EXIT_DIST = 1.75;
/** Seconds before the same balloon can greet again after you leave. */
const BALLOON_GREET_COOLDOWN = 32;

const OBSERVATORY_GREET_DIST = 1.6;
const OBSERVATORY_GREET_EXIT_DIST = 2.2;
const OBSERVATORY_GREET_COOLDOWN = 40;
const STONEHENGE_WHISPER_DIST = 1.8;
const STONEHENGE_WHISPER_EXIT_DIST = 2.4;
const STONEHENGE_WHISPER_COOLDOWN = 45;

const BRAZIER_WHISPER_DIST      = 1.6;
const BRAZIER_WHISPER_EXIT_DIST = 2.2;
const BRAZIER_WHISPER_COOLDOWN  = 60;

/** Max linear gain for night crickets loop (soft; scales with night blend 0–1). */
const CRICKETS_LOOP_MAX_VOL = 0.045;

/** Local vehicle fill light at night: `intensity = nightWeight * this` (was 1.0; lower = less harsh). */
const PLAYER_LIGHT_NIGHT_INTENSITY = 0.38;

const RAIN_LOOP_NAME = "rain_loop";
const RAIN_LOOP_MAX_VOL = 0.18;

const BIRDS_LOOP_NAME = "birds_loop";
const BIRDS_LOOP_MAX_VOL = 0.04;

const RUMBLE_LOOP_NAME = "rumbling_1";
/** Moon rumble at 100% progress (0 at 75%, ramps up to this by impact). */
const RUMBLE_MAX_VOL = 0.42;

/** Boat: ambient ocean waves (looping while flying). */
const OCEAN_WAVES_LOOP_NAME = "ocean_waves_1";
const OCEAN_WAVES_LOOP_VOL = 0.16;

const EXPLOSION_SFX_NAME = "explosion_1";
const EXPLOSION_SFX_VOLUME = 0.48;

/** Next diamond within this window raises pitch (combo). */
const DIAMOND_COMBO_WINDOW_MS = 900;
const DIAMOND_COMBO_MAX_STEPS = 5;
const DIAMOND_COMBO_RATE_PER_STEP = 0.028;
/** Each combo step adds this fraction of diamond XP (e.g. step 5 = +25%). */
const DIAMOND_COMBO_XP_PER_STEP = 0.05;
const DIAMOND_SFX_VOLUME = 0.3;
const PORTAL_INTERACTION_SUPPRESS_SEC = 0.18;
const SELFIE_CAMERA_SFX_VOLUME = 0.55;
const PORTAL_TELEPORT_SFX_VOLUME = 0.5;
const PORTAL_OPEN_SFX_VOLUME = 0.52;

/** Base XP granted per carpet portal teleport (before Wide Portal + Night Owl scaling). */
const PORTAL_TELEPORT_XP = 5;

/** XP source categories used by awardXP() for per-source scaling. */
type XpSource =
  | "diamond"
  | "gremlin"
  | "delivery"
  | "selfie"
  | "portal"
  | "flock"
  | "rainbow"
  | "lantern"
  | "firefly"
  | "volcano"
  | "jellyfish"
  | "fish";

const DIAMOND_SFX_IDS = [
  "diamond_collect_1",
  "diamond_collect_2",
  "diamond_collect_3",
] as const;

const LANTERN_COLLECT_SFX_IDS = [
  "lantern_collect_1",
  "lantern_collect_2",
  "lantern_collect_3",
  "lantern_collect_4",
] as const;
const LANTERN_COLLECT_SFX_VOLUME = 0.38;

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

const GONG_SFX_VOLUME = 0.55;
/** Max gain for rewind SFX loop; multiplied by scene alpha during moon rewind. */
const REWIND_LOOP_VOLUME = 0.38;

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
  private paintballSystem: PaintballSystem | null = null;
  private speedLines!: SpeedLines;
  private contrails!: Contrails;
  private wakeTrail!: WakeTrail;
  private carpetTrail!: CarpetTrail;
  private carpetWake!: CarpetWake;
  private carpetLeaves!: CarpetLeaves;
  private carpetPortalSystem: CarpetPortalSystem | null = null;
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
  private carpetLandmarkSelfieQuest: CarpetLandmarkSelfieQuest | null = null;
  private carpetSelfiePhotoUI: HotspringPhotoUI | null = null;
  private birdFlocks: BirdFlock[] = [];
  private rainbowArches: RainbowArch[] = [];
  private lanternClusters: FloatingLanterns[] = [];
  private fireflyClusters: FireflyCluster[] = [];
  private volcanoes: Volcano[] = [];
  private braziers: Braziers | null = null;
  private skyGremlins: SkyGremlins | null = null;
  private flockFormationHUD: FlockFormationHUD | null = null;
  private remotePlayerNameLabels!: RemotePlayerNameLabels;
  private balloonInRange: boolean[] = [];
  private balloonGreetCooldown: number[] = [];
  private balloonGreetSalt = 0;
  private balloonPosScratch = new Vector3();
  private gameTime = 0;
  private observatoryInRange: boolean[] = [];
  private observatoryCooldown: number[] = [];
  private observatoryWorldPositions: Vector3[] = [];
  private stonehengeInRange: boolean[] = [];
  private stonehengeCooldown: number[] = [];
  private stonehengeWorldPositions: Vector3[] = [];

  private brazierInRange: boolean[] = [];
  private brazierCooldown: number[] = [];
  private lastBrazierProgress: number[] = [];
  /** Offline-only edge detect for all-five shield (no server). */
  private prevAllFiveBraziers = false;
  /** Only show the moon-resumed banner after a locally-announced brazier pause. */
  private shouldShowBrazierMoonResume = false;
  /** If braziers were locked at join, stash server sync until they unlock mid-run. */
  private pendingBrazierSync: BrazierSyncPayload | null = null;
  private panicDialogueCooldown = 0;
  private localPlayerWorldScratch = new Vector3();

  private gamePhase: "flying" | "campsite" | "transitioning" | "moonImpact" = "flying";
  private moonCinematicStep: "fadeOut1" | "wideShot" | "fadeOut2" | "done" = "done";
  private moonCinematicTimer = 0;
  private returningToMenuAfterMoon = false;
  private campsiteMarker: CampsiteMarker | null = null;
  private campsiteScene: CampsiteScene | null = null;
  private vehicleHintsEl: HTMLElement | null = null;
  private campsiteHintsEl: HTMLElement | null = null;
  private transitionOverlay: TransitionOverlay | null = null;
  private hullColor = 0xff4444;
  private moonThreat: MoonThreat | null = null;
  private meteorShower: MeteorShower | null = null;
  private skyJellyfish: SkyJellyfish | null = null;
  private jellyfishCaptureRing: CircularProgressRing | null = null;
  private oceanFish: OceanFish | null = null;
  private fishCaught = 0;
  private fishCamScratch = new Vector3();
  private selfieProgressCached = 0;
  private vhsOverlay: HTMLDivElement | null = null;
  private vhsGlitchInterval: ReturnType<typeof setInterval> | null = null;
  private progression!: ProgressionManager;
  private levelUpCards!: LevelUpCards;
  /** Count of previously spawned bonus collectibles so we only spawn the delta. */
  private prevDiamondCountBonus = 0;
  private prevExtraRainbows = 0;
  private prevExtraFireflies = 0;
  private prevExtraLanterns = 0;

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
  private portalInteractionSuppressTimer = 0;
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
  /** Set in `start()` via {@link resolveServerUrl}; used by {@link getServerUrl}. */
  private serverUrlCache: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /* ── Public entry point ──────────────────────────────────────────── */

  async start() {
    this.mobile = isMobile();
    this.showLoadingOverlay();

    this.serverUrlCache = await resolveServerUrl();
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
      for (const id of LANTERN_COLLECT_SFX_IDS) {
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
      this.audioManager.loadSFX("shoot_1", "/audio/sfx/shoot_1.mp3");
      for (const id of ["impact_1", "impact_2", "impact_3"] as const) {
        this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
      }
      this.audioManager.loadSFX("camera", "/audio/sfx/camera.mp3");
      this.audioManager.loadSFX("portal_1", "/audio/sfx/portal_1.mp3");
      this.audioManager.loadSFX("portal_open", "/audio/sfx/portal_open.mp3");
      this.audioManager.loadSFX("splash_1", "/audio/sfx/splash_1.mp3");
      this.audioManager.loadSFX("splash_2", "/audio/sfx/splash_2.mp3");
      this.audioManager.loadSFX("fish_catch_1", "/audio/sfx/fish_catch_1.mp3");
      this.audioManager.loadSFX(OCEAN_WAVES_LOOP_NAME, "/audio/sfx/ocean_waves_1.mp3");
    });
    this.playerName = ProgressionManager.loadPlayerName() ?? generateWhimsicalName();
    ProgressionManager.savePlayerName(this.playerName);

    this.initPreview();
    this.previewActive = true;
    requestAnimationFrame(this.previewTick);

    this.removeLoadingOverlay();

    this.mountLobby();
  }

  private mountLobby() {
    this.lobby = new Lobby(this.container, {
      playerName: this.playerName,
      mobile: this.mobile,
      onNameChange: (name) => { this.playerName = name; ProgressionManager.savePlayerName(name); },
      onPlay: (vehicle, options) => {
        if (!ProgressionManager.isVehicleUnlocked(vehicle)) return;
        this.pendingCampsiteAfterIntro =
          CAMPSITE_HOME_ENABLED && (options?.startAtCampsite ?? false);
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
        void this.audioManager.loadSFX(RUMBLE_LOOP_NAME, "/audio/sfx/rumbling_1.mp3").then(() => {
          this.audioManager.startLoop(RUMBLE_LOOP_NAME, 0);
        });
        void this.audioManager.loadSFX(EXPLOSION_SFX_NAME, "/audio/sfx/explosion_1.mp3");
        for (const id of LANTERN_COLLECT_SFX_IDS) {
          void this.audioManager.loadSFX(id, `/audio/sfx/${id}.mp3`);
        }
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
      fontFamily: "'Darumadrop One', 'Inter', system-ui, sans-serif",
    });
    const title = this.loadingEl.querySelector(".loading-title") as HTMLElement;
    Object.assign(title.style, {
      fontSize: "clamp(2.8rem, 11.2vw, 4.2rem)",
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
        <h1 class="loading-title" style="font-family:'Darumadrop One', 'Inter', system-ui, sans-serif;font-size:clamp(2.8rem,11.2vw,4.2rem);font-weight:800;margin:0;
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

    this.moonThreat = new MoonThreat(this.worldConfig?.globeRadius ?? 5);
    this.moonThreat.onShockwaveSpawn = () => {
      this.audioManager.playSFX(EXPLOSION_SFX_NAME, EXPLOSION_SFX_VOLUME);
    };
    this.moonThreat.onApproachPauseEnd = () => {
      if (!this.shouldShowBrazierMoonResume) return;
      this.shouldShowBrazierMoonResume = false;
      this.hud.showBrazierMoonResumed();
    };
    this.moonThreat.addTo(this.scene);

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

    if (CAMPSITE_HOME_ENABLED) {
      this.campsiteMarker = new CampsiteMarker(this.scene, globeRadius, seed, terrainType);
    }

    window.addEventListener("resize", this.onPreviewResize);
  }

  /** One preview frame (shared by the RAF loop and return-to-menu while overlay stays black). */
  private stepPreview(dt: number) {
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
  }

  private previewTick = () => {
    if (!this.previewActive) return;
    requestAnimationFrame(this.previewTick);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.stepPreview(dt);
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

    this.progression = new ProgressionManager(vehicle);
    this.progression.restore();

    const savedColor = this.progression.getSavedVehicleColor();
    const hullColor = savedColor ?? pickRandomVehicleColor(vehicle);
    if (savedColor == null) this.progression.saveVehicleColor(hullColor);
    this.hullColor = hullColor;

    const w2 = this.container.clientWidth;
    const h2 = this.container.clientHeight;
    this.campsiteScene = CAMPSITE_HOME_ENABLED
      ? new CampsiteScene(w2 / h2, this.mobile, this.container)
      : null;
    this.transitionOverlay = new TransitionOverlay(this.container);
    this.levelUpCards = new LevelUpCards();
    this.prevDiamondCountBonus = 0;
    this.prevExtraRainbows = 0;
    this.prevExtraFireflies = 0;
    this.prevExtraLanterns = 0;
    this.portalInteractionSuppressTimer = 0;

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

    this.computeIntroEndTargets(globeRadius);

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
    this.paintballSystem = new PaintballSystem(
      this.scene,
      globeRadius,
      () => this.socketClient?.id,
      () => this.socketClient,
      this.remotePlanes,
      (colorHex?: number) => {
        this.cameraRig.shake(0.038, 0.26);
        this.hud.showPaintballSplatter(colorHex);
      },
      (victimId) => {
        const myId = this.socketClient?.id ?? "local";
        if (victimId === myId && this.localPlayer instanceof Plane) {
          this.localPlayer.triggerPaintballHitWobble();
          return;
        }
        this.remotePlanes.triggerPaintballHitWobble(victimId);
      },
      () => {
        this.audioManager.resumeContextIfNeeded();
        if (this.audioManager.hasSFX("shoot_1")) {
          this.audioManager.playSFX("shoot_1", 0.82);
        }
      },
      (splatSeed, distant) => {
        this.audioManager.resumeContextIfNeeded();
        const n = 1 + ((splatSeed >>> 0) % 3);
        const id = `impact_${n}` as "impact_1" | "impact_2" | "impact_3";
        if (this.audioManager.hasSFX(id)) {
          this.audioManager.playSFX(id, distant ? 0.35 : 0.88);
        }
      },
      this.globe
    );

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

    if (vehicle === "carpet") {
      this.carpetPortalSystem = new CarpetPortalSystem(globeRadius, seed, terrainType, {
        onPortalSpawnStart: () => {
          this.audioManager.resumeContextIfNeeded();
          this.audioManager.playSFX("portal_open", PORTAL_OPEN_SFX_VOLUME);
        },
      });
      this.scene.add(this.carpetPortalSystem.group);
      this.carpetPortalSystem.syncToCarpet(this.localPlayer as Carpet);
    } else {
      this.carpetPortalSystem = null;
    }

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

    this.meteorShower = new MeteorShower(globeRadius, seed, terrainType);
    this.scene.add(this.meteorShower.group);
    this.meteorShower.onImpact = (_impactPos, distanceToPlayer) => {
      const audibility = MathUtils.clamp(1 - distanceToPlayer / 1.6, 0, 1);
      if (audibility > 0.01 && this.audioManager.hasSFX(EXPLOSION_SFX_NAME)) {
        this.audioManager.resumeContextIfNeeded();
        const rate = 0.7 + Math.random() * 0.5;
        this.audioManager.playSFX(EXPLOSION_SFX_NAME, 0.15 + audibility * 0.3, rate);
      }
      if (distanceToPlayer < 0.72) {
        this.cameraRig.shake(0.065, 0.7);
        this.vehicleFlashTimer = Math.max(this.vehicleFlashTimer, 0.4);
      }
    };

    if (this.localPlayer instanceof Carpet) {
      this.skyJellyfish = new SkyJellyfish(globeRadius, seed, spawnSessionSalt, terrainType);
      this.scene.add(this.skyJellyfish.group);
      this.skyJellyfish.onCapture = (_colorIndex) => {
        this.awardXP("jellyfish", JELLY_CAPTURE_XP);
        this.audioManager.resumeContextIfNeeded();
        this.audioManager.playSFX("portal_1", 0.35, 1.3);
        this.vehicleFlashTimer = Math.max(this.vehicleFlashTimer, 0.2);
        this.cameraRig.shake(0.02, 0.15);
      };
    }

      this.ringManager.onCollect = (xp, worldPos, tier) => {
      this.collectVFX.play(worldPos, tier);
      let comboXpMult = 1;
      if (this.vehicleFeatures.collectibleDiamonds) {
        const now = performance.now();
        const state = this.progression.upgrades.state;
        const windowMs = DIAMOND_COMBO_WINDOW_MS * state.comboWindowMs;
        const maxSteps = Math.round(DIAMOND_COMBO_MAX_STEPS * state.comboMaxSteps);
        const ratePerStep = DIAMOND_COMBO_RATE_PER_STEP * state.comboRatePerStep;
        if (now - this.lastDiamondCollectAt > windowMs) {
          this.diamondComboStep = 0;
        } else {
          this.diamondComboStep = Math.min(this.diamondComboStep + 1, maxSteps);
        }
        this.lastDiamondCollectAt = now;
        const rate = 1 + this.diamondComboStep * ratePerStep;
        const pick =
          DIAMOND_SFX_IDS[Math.floor(Math.random() * DIAMOND_SFX_IDS.length)]!;
        this.audioManager.playSFX(pick, DIAMOND_SFX_VOLUME, rate);
        comboXpMult = 1 + this.diamondComboStep * DIAMOND_COMBO_XP_PER_STEP;
      }
      this.vehicleFlashTimer = 0.35;
      this.cameraRig.shake();
      if (this.localPlayer instanceof Plane || this.localPlayer instanceof Carpet) {
        this.localPlayer.speedBoost();
        const boostPick =
          SPEED_BOOST_SFX_IDS[Math.floor(Math.random() * SPEED_BOOST_SFX_IDS.length)]!;
        this.audioManager.playSFX(boostPick, SPEED_BOOST_SFX_VOLUME);
      }
      this.awardXP("diamond", xp * comboXpMult);
    };

    this.progression.onXPChanged = (xp, xpForNext, xpForCurrent, level) => {
      this.hud.setXP(xp, xpForNext, xpForCurrent, level);
    };
    this.progression.onLevelUp = (level) => {
      this.handleLevelUp(level);
    };

    this.hud = new HUD(this.container);
    this.hud.setWorldName(this.worldConfig?.name ?? "Unknown World");
    this.hud.setMuteToggle(() => this.audioManager.toggleMute());
    this.hud.setCampsiteAction(() => {
      if (this.gamePhase === "flying") this.doLanding();
    });
    this.hud.setVehicle(vehicle, {
      showXpProgression: this.vehicleFeatures.xpProgressionUI,
      showFishCounter: this.vehicleFeatures.fishingMiniGame,
    });

    if (this.localPlayer instanceof Boat && this.vehicleFeatures.fishingMiniGame) {
      this.oceanFish = new OceanFish(globeRadius, seed, spawnSessionSalt, terrainType, this.audioManager);
      this.scene.add(this.oceanFish.group);
      this.fishCaught = 0;
      this.hud.setFishCaught(0);
      this.oceanFish.onCatch = () => {
        this.fishCaught += 1;
        this.hud.setFishCaught(this.fishCaught);
        this.awardXP("fish", FISH_CATCH_XP);
        this.audioManager.resumeContextIfNeeded();
        this.cameraRig.shake(0.015, 0.12);
        this.vehicleFlashTimer = Math.max(this.vehicleFlashTimer, 0.15);
      };
      this.oceanFish.setFishingLineResolution(this.container.clientWidth, this.container.clientHeight);
    }
    this.vehicleHintsEl = mountControlHints(this.hud.root, vehicle, !this.mobile);
    this.hud.hideUI();

    this.hud.setXP(
      this.progression.getXP(),
      this.progression.getXPForNextLevel(),
      this.progression.getXPForCurrentLevel(),
      this.progression.getLevel(),
    );
    this.propagateUpgrades();

    this.remotePlayerNameLabels = new RemotePlayerNameLabels(this.hud.root);

    if (this.skyJellyfish) {
      this.jellyfishCaptureRing = new CircularProgressRing(this.hud.root);
    }

    if (vehicle === "plane" && this.paintballSystem) {
      this.skyGremlins = new SkyGremlins(
        this.scene,
        globeRadius,
        seed,
        terrainType,
        this.paintballSystem,
        () => this.socketClient?.id,
        () => {
          this.cameraRig.shake(0.045, 0.25);
        },
        () => {
          this.awardXP("gremlin", SKY_GREMLIN_XP);
          this.cameraRig.shake(0.045, 0.25);
          this.vehicleFlashTimer = 0.14;
        },
      );
    } else {
      this.skyGremlins = null;
    }

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

    this.ensureBraziersSpawned();

    const landmarkRegistry = new LandmarkRegistry();
    landmarkRegistry.registerVillages(this.globe.villageCenters, seed);
    landmarkRegistry.registerLighthouses(this.globe.lighthouseCenters, seed);
    landmarkRegistry.registerWindmills(this.globe.windmillCenters, seed);
    landmarkRegistry.registerObservatories(this.globe.observatoryCenters, seed);
    landmarkRegistry.registerStonehenges(this.globe.stonehengeCenters, seed);
    landmarkRegistry.registerShrines(this.globe.shrineCenters, seed);
    landmarkRegistry.registerHotsprings(this.globe.hotspringCenters, seed);
    landmarkRegistry.registerMushrooms(this.globe.mushroomCenters, seed);
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
        let rate = isNpcMale(npcName)
          ? DIALOGUE_MALE_PLAYBACK_RATE
          : 1;
        const mp = this.moonThreat?.progress ?? 0;
        if (mp >= 0.50) {
          const dread = Math.min(1, (mp - 0.50) / 0.50);
          rate *= 1.0 - dread * 0.25;
        }
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

    const obsN = this.globe.observatoryCenters.length;
    this.observatoryInRange = new Array(obsN).fill(false);
    this.observatoryCooldown = new Array(obsN).fill(0);
    this.observatoryWorldPositions = this.globe.observatoryCenters.map((o) => {
      return o.normal.clone().multiplyScalar(globeRadius + 0.04);
    });

    const shN = this.globe.stonehengeCenters.length;
    this.stonehengeInRange = new Array(shN).fill(false);
    this.stonehengeCooldown = new Array(shN).fill(0);
    this.stonehengeWorldPositions = this.globe.stonehengeCenters.map((o) => {
      return o.normal.clone().multiplyScalar(globeRadius + 0.02);
    });

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

        this.awardXP("delivery", xp);
      };

      this.packageQuest.onProgressChange = (progress) => {
        this.packageQuestHUD.setProgress(progress);
      };
    }

    const hotspringN = this.globe.hotspringCenters.length;
    const shrineN = this.globe.shrineCenters.length;
    const mushroomN = this.globe.mushroomCenters.length;
    const butterflyN = this.globe.butterflyCenters.length;
    if (this.playerVehicle === "carpet" && hotspringN + shrineN + mushroomN + butterflyN > 0) {
      const hsNormals = this.globe.hotspringCenters.map((h) => h.normal.clone().normalize());
      const shrineNormals = this.globe.shrineCenters.map((h) => h.normal.clone().normalize());
      const mushroomNormals = this.globe.mushroomCenters.map((h) => h.normal.clone().normalize());
      const butterflyNormals = this.globe.butterflyCenters.map((h) => h.normal.clone().normalize());
      
      // Pass empty arrays so they are never marked as "completed" from a previous run
      this.carpetSelfiePhotoUI = new HotspringPhotoUI(this.hud.root);
      this.carpetLandmarkSelfieQuest = new CarpetLandmarkSelfieQuest(
        hsNormals,
        new Array(hotspringN).fill(false),
        shrineNormals,
        new Array(shrineN).fill(false),
        mushroomNormals,
        new Array(mushroomN).fill(false),
        butterflyNormals,
        new Array(butterflyN).fill(false),
      );
      this.carpetLandmarkSelfieQuest.onProgressChange = (p) => {
        this.selfieProgressCached = p;
        this.carpetSelfiePhotoUI?.setProgress(p);
      };
      this.carpetLandmarkSelfieQuest.onPhotoTaken = (payload) => {
        this.globe.setLandmarkParticleOpacity(payload.kind, payload.kindIndex, 0.0);
        this.audioManager.resumeContextIfNeeded();
        this.audioManager.playSFX("camera", SELFIE_CAMERA_SFX_VOLUME);
        if (payload.kind === "hotspring") {
          this.carpetSelfiePhotoUI?.showSelfie("/2D/capybara_hotspring.jpg", "Hot spring selfie");
        } else if (payload.kind === "shrine") {
          this.carpetSelfiePhotoUI?.showSelfie("/2D/capybara_shrine.jpg", "Shrine selfie");
        } else if (payload.kind === "mushroom") {
          this.carpetSelfiePhotoUI?.showSelfie("/2D/capybara_mushroom_garden.jpg", "Mushroom garden selfie");
        } else if (payload.kind === "butterfly") {
          this.carpetSelfiePhotoUI?.showSelfie("/2D/capybara_butterfly_garden.jpg", "Butterfly garden selfie");
        }
        this.awardXP("selfie", LANDMARK_SELFIE_XP);
        this.progression.save();
      };
    } else {
      // Not a carpet, or no landmarks: hide all selfie particles
      for (let i = 0; i < hotspringN; i++) this.globe.setLandmarkParticleOpacity("hotspring", i, 0.0);
      for (let i = 0; i < shrineN; i++) this.globe.setLandmarkParticleOpacity("shrine", i, 0.0);
      for (let i = 0; i < mushroomN; i++) this.globe.setLandmarkParticleOpacity("mushroom", i, 0.0);
      for (let i = 0; i < butterflyN; i++) this.globe.setLandmarkParticleOpacity("butterfly", i, 0.0);
    }

    window.addEventListener("resize", this.onResize);

    this.initNetworking(this.worldSlug);

    this.clock.getDelta();
    this.running = true;
    window.addEventListener("keydown", this.onDebugKey);
    this.tick();
  }

  /** Tear down everything created in startGame (globe / moon / renderer stay). */
  private teardownGameplaySession() {
    this.stateSync?.stop();
    this.stateSync = null;
    this.socketClient?.disconnect();
    this.socketClient = null;

    this.controls?.dispose();
    this.touchControls?.dispose();
    this.touchControls = null;
    this.speedLines?.dispose();
    this.contrails?.dispose();
    this.wakeTrail?.dispose();
    this.carpetTrail?.dispose();
    this.carpetWake?.dispose();
    this.carpetLeaves?.dispose();
    if (this.carpetPortalSystem) {
      this.scene.remove(this.carpetPortalSystem.group);
      this.carpetPortalSystem.dispose();
      this.carpetPortalSystem = null;
    }
    this.lensFlare?.dispose();
    this.rainOverlay?.dispose();
    this.ringManager?.dispose();
    this.collectVFX?.dispose();
    this.localPlayer?.dispose();
    this.paintballSystem?.dispose();
    this.paintballSystem = null;
    this.skyGremlins?.dispose();
    this.skyGremlins = null;
    this.meteorShower?.dispose();
    this.meteorShower = null;
    this.skyJellyfish?.dispose();
    this.skyJellyfish = null;
    this.jellyfishCaptureRing?.dispose();
    this.jellyfishCaptureRing = null;
    this.oceanFish?.dispose();
    this.oceanFish = null;
    this.selfieProgressCached = 0;
    this.remotePlanes?.dispose();
    this.landmarkHUD?.dispose();
    this.packageQuest?.dispose();
    this.packageQuest = null;
    this.packageQuestHUD.dispose();
    this.carpetSelfiePhotoUI?.dispose();
    this.carpetSelfiePhotoUI = null;
    this.carpetLandmarkSelfieQuest = null;
    for (const f of this.birdFlocks) f.dispose();
    this.birdFlocks = [];
    for (const r of this.rainbowArches) r.dispose();
    this.rainbowArches = [];
    for (const l of this.lanternClusters) l.dispose();
    this.lanternClusters = [];
    for (const f of this.fireflyClusters) f.dispose();
    this.fireflyClusters = [];
    this.braziers?.dispose();
    this.braziers = null;
    this.pendingBrazierSync = null;
    this.portalInteractionSuppressTimer = 0;
    this.hud.disposeBrazierTracker();
    this.campsiteScene?.dispose();
    this.campsiteScene = null;
    this.flockFormationHUD?.dispose();
    this.flockFormationHUD = null;
    this.remotePlayerNameLabels.dispose();
    this.hud.dispose();

    if (this.playerLight) {
      this.scene.remove(this.playerLight);
      this.playerLight.dispose();
      this.playerLight = null;
    }

    this.audioManager.stopLoop("engine_biplane");
    this.audioManager.stopLoop("engine_carpet");
    this.audioManager.stopLoop(OCEAN_WAVES_LOOP_NAME);
    for (const id of DIALOGUE_LOOP_IDS) {
      this.audioManager.fadeOutLoop(id);
    }
    this.audioManager.setEndTimesWeight(0);
    this.audioManager.setLoopVolume(RUMBLE_LOOP_NAME, 0);

    this.progression?.save();
    this.progression?.upgrades.reset();
    this.levelUpCards?.dispose();

    if (this.vhsGlitchInterval !== null) {
      clearInterval(this.vhsGlitchInterval);
      this.vhsGlitchInterval = null;
    }
    this.vhsOverlay?.remove();
    this.vhsOverlay = null;

    window.removeEventListener("resize", this.onResize);
  }

  private static readonly MOON_CREDITS_FADE_IN_MS = 4000;
  private static readonly MOON_CREDITS_HOLD_MS = 2500;
  private static readonly MOON_CREDITS_FADE_OUT_MS = 4000;

  private static readonly MOON_EPITAPH_LINES = [
    "You tried. You flew. It wasn't enough.",
    "No one could stop it. Not even you.",
    "The moon fell. You couldn't stop it.",
  ] as const;

  private static readonly MOON_EPITAPH_FADE_IN_MS = 2500;
  private static readonly MOON_EPITAPH_HOLD_MS = 2000;
  private static readonly MOON_EPITAPH_FADE_OUT_MS = 2000;
  /** Matches fadeOut1 so other players see us fade out instead of freezing in place. */
  private static readonly MOON_NETWORK_VISIBILITY_FADE_SEC = 0.7;

  /** Epitaph line shown on black before the credits. */
  private async showMoonEpitaphOverlay(): Promise<void> {
    const lines = Game.MOON_EPITAPH_LINES;
    const text = lines[Math.floor(Math.random() * lines.length)]!;

    const el = document.createElement("p");
    el.textContent = text;
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      zIndex: "10000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      margin: "0",
      padding: "0 2rem",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "clamp(1rem, 3vw, 1.4rem)",
      fontWeight: "400",
      fontStyle: "italic",
      color: "rgba(255, 255, 255, 0.75)",
      textAlign: "center",
      lineHeight: "1.6",
      letterSpacing: "0.02em",
      pointerEvents: "none",
      opacity: "0",
      transition: `opacity ${Game.MOON_EPITAPH_FADE_IN_MS}ms ease`,
    });

    this.container.appendChild(el);

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    el.style.opacity = "1";
    await new Promise<void>((resolve) => {
      el.addEventListener("transitionend", () => resolve(), { once: true });
      setTimeout(resolve, Game.MOON_EPITAPH_FADE_IN_MS + 200);
    });

    await new Promise<void>((r) => setTimeout(r, Game.MOON_EPITAPH_HOLD_MS));

    el.style.transition = `opacity ${Game.MOON_EPITAPH_FADE_OUT_MS}ms ease`;
    el.style.opacity = "0";
    await new Promise<void>((resolve) => {
      el.addEventListener("transitionend", () => resolve(), { once: true });
      setTimeout(resolve, Game.MOON_EPITAPH_FADE_OUT_MS + 200);
    });

    el.remove();
  }

  /** Full-screen credits on black after moon ending, before teardown and lobby. */
  private async showMoonCreditsOverlay(): Promise<void> {
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    Object.assign(wrap.style, {
      position: "fixed",
      inset: "0",
      zIndex: "10000",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none",
      opacity: "0",
      transition: `opacity ${Game.MOON_CREDITS_FADE_IN_MS}ms ease`,
    });

    const title = document.createElement("h1");
    title.textContent = "Tiny Skies";
    Object.assign(title.style, {
      fontFamily: "'Darumadrop One', 'Inter', system-ui, sans-serif",
      fontSize: "clamp(3.5rem, 14vw, 8.4rem)",
      fontWeight: "800",
      margin: "0",
      color: "#ffffff",
    });

    const byline = document.createElement("p");
    byline.textContent = "By Danny Limanseta";
    Object.assign(byline.style, {
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "clamp(0.95rem, 2.5vw, 1.2rem)",
      fontWeight: "500",
      margin: "1.25rem 0 0",
      color: "rgba(255, 255, 255, 0.9)",
      letterSpacing: "0.04em",
    });

    wrap.appendChild(title);
    wrap.appendChild(byline);
    this.container.appendChild(wrap);

    if (!this.audioManager.muted) {
      if (!this.audioManager.hasSFX("gong")) {
        await this.audioManager.loadSFX("gong", "/audio/sfx/gong.mp3");
      }
      this.audioManager.resumeContextIfNeeded();
    }

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    wrap.style.opacity = "1";
    if (!this.audioManager.muted) {
      this.audioManager.playSFX("gong", GONG_SFX_VOLUME);
    }

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      wrap.addEventListener("transitionend", done, { once: true });
      setTimeout(done, Game.MOON_CREDITS_FADE_IN_MS + 200);
    });

    await new Promise<void>((r) => setTimeout(r, Game.MOON_CREDITS_HOLD_MS));

    wrap.style.transition = `opacity ${Game.MOON_CREDITS_FADE_OUT_MS}ms ease`;
    wrap.style.opacity = "0";
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      wrap.addEventListener("transitionend", done, { once: true });
      setTimeout(done, Game.MOON_CREDITS_FADE_OUT_MS + 200);
    });

    wrap.remove();
  }

  /** Self-contained rewind render loop — runs independently of this.tick. */
  private async showMoonRewindSequence(): Promise<void> {
    if (!this.transitionOverlay) return;

    const REWIND_SPEED = 9.0;
    const FADE_IN = 1.0;   // seconds to reveal scene
    const HOLD = 0.6;      // seconds of full-visibility rewind
    const FADE_OUT = 2.2;  // seconds to go back to black
    const TOTAL = FADE_IN + HOLD + FADE_OUT;
    const cam = this.moonCinematicCamera ?? this.cameraRig.camera;

    if (!this.audioManager.muted) {
      if (!this.audioManager.hasSFX("rewind")) {
        await this.audioManager.loadSFX("rewind", "/audio/sfx/rewind.mp3");
      }
      this.audioManager.resumeContextIfNeeded();
      this.audioManager.startLoop("rewind", 0);
    }

    // Create VHS overlay (starts invisible — the rAF loop fades it in).
    this.vhsOverlay = this.createVhsOverlay();
    this.vhsOverlay.style.opacity = "0";

    // Run a dedicated rAF loop — does not depend on this.running.
    let prevTime = performance.now();
    let timer = 0;
    await new Promise<void>((resolve) => {
      const loop = () => {
        const now = performance.now();
        const dt = Math.min((now - prevTime) / 1000, 0.05);
        prevTime = now;
        timer += dt;

        // Scene + overlay alpha: 0 → 1 → 1 → 0
        let alpha: number;
        if (timer < FADE_IN) {
          alpha = timer / FADE_IN;
        } else if (timer < FADE_IN + HOLD) {
          alpha = 1;
        } else {
          alpha = 1 - (timer - FADE_IN - HOLD) / FADE_OUT;
        }
        alpha = Math.max(0, Math.min(1, alpha));

        // Rewind physics runs across the whole visible window.
        if (alpha > 0 && this.moonThreat) {
          const rewindProgress = Math.min(1, Math.max(0, timer - FADE_IN / 2) / (HOLD + FADE_IN / 2));
          this.moonThreat.rewindTick(dt, REWIND_SPEED, rewindProgress);
        }

        this.globe.update(dt);
        this.renderer.render(this.scene, cam);

        // Black overlay fades away as alpha rises, comes back as it falls.
        this.transitionOverlay!.setOpacity(1 - alpha);
        if (this.vhsOverlay) this.vhsOverlay.style.opacity = String(alpha);

        if (!this.audioManager.muted && this.audioManager.hasSFX("rewind")) {
          this.audioManager.setLoopGainImmediate("rewind", alpha * REWIND_LOOP_VOLUME);
        }

        if (timer < TOTAL) {
          requestAnimationFrame(loop);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(loop);
    });

    this.audioManager.stopLoop("rewind");

    // Ensure fully black before proceeding.
    this.transitionOverlay.setOpacity(1);

    // Restore CSS transition for any future use, then clean up.
    if (this.vhsGlitchInterval !== null) {
      clearInterval(this.vhsGlitchInterval);
      this.vhsGlitchInterval = null;
    }
    this.vhsOverlay?.remove();
    this.vhsOverlay = null;
  }

  private async returnToMainMenuAfterMoonImpact() {
    if (this.returningToMenuAfterMoon) return;
    this.returningToMenuAfterMoon = true;
    this.running = false;
    window.removeEventListener("keydown", this.onDebugKey);

    await this.showMoonEpitaphOverlay();
    await this.showMoonCreditsOverlay();
    await this.showMoonRewindSequence();

    this.teardownGameplaySession();

    this.dayNightCycle.moonProgress = 0;
    this.moonThreat?.reset();
    this.shouldShowBrazierMoonResume = false;
    this.applyDayNightPreset();
    this.gamePhase = "flying";
    this.moonCinematicStep = "done";
    this.moonCinematicCamera = null;
    this.introActive = false;
    this.vehicleHintsEl = null;
    this.campsiteHintsEl = null;

    this.mountLobby();
    this.previewActive = true;
    window.addEventListener("resize", this.onPreviewResize);
    this.onPreviewResize();
    const previewDt = Math.min(this.clock.getDelta(), 0.05);
    this.stepPreview(previewDt);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    requestAnimationFrame(this.previewTick);

    if (this.transitionOverlay) {
      await this.transitionOverlay.fadeIn();
      this.transitionOverlay.dispose();
      this.transitionOverlay = null;
    }

    this.returningToMenuAfterMoon = false;
  }

  /* ── Networking ──────────────────────────────────────────────────── */

  private worldFullRetries = 0;
  private static readonly MAX_WORLD_FULL_RETRIES = 3;

  /** All-five brazier shield: shared room event or offline-only detection. */
  private applyBrazierMoonShield(remainingMs: number, announce = true) {
    this.braziers?.extinguishAll();
    this.moonThreat?.beginApproachPause(remainingMs);
    if (!announce) return;
    this.shouldShowBrazierMoonResume = true;
    this.hud.showBrazierMoonSlowed();
  }

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

    this.socketClient.onBrazierSync((payload) => {
      if (this.braziers) this.braziers.syncBrazierExpiries(payload.expiries);
      else this.pendingBrazierSync = payload;
    });

    this.socketClient.onBrazierLit((ev) => {
      if (ev.playerId === this.socketClient?.id) return;
      this.braziers?.applyServerBurnState(ev.index, ev.burnEndsAt);
      this.hud.showBrazierRemoteLit(ev.playerName);
    });

    this.socketClient.onBrazierMoonPause((payload) => {
      this.applyBrazierMoonShield(payload.remainingMs, payload.announce !== false);
    });

    this.socketClient.onPaintballFired((ev) => {
      this.paintballSystem?.onPaintballFired(ev);
    });

    this.socketClient.onPaintballHit((ev) => {
      this.paintballSystem?.onPaintballHit(
        ev,
        this.localPlayer instanceof Plane ? this.localPlayer.group : null,
      );
    });

    this.socketClient.joinWorld(slug, this.playerName, this.playerVehicle, this.reservationId);

    this.stateSync = new StateSync(this.socketClient, this.localPlayer);
    this.stateSync.start();

    if (this.playerVehicle === "plane") {
      this.audioManager.startLoop("engine_biplane", 0);
    } else if (this.playerVehicle === "carpet") {
      this.audioManager.startLoop("engine_carpet", 0.06);
    } else if (this.playerVehicle === "boat") {
      this.audioManager.startLoop(OCEAN_WAVES_LOOP_NAME, OCEAN_WAVES_LOOP_VOL);
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

  private static readonly INTRO_DURATION = 5.2;
  /** Tangent-plane heading (rad) for the Home intro camera approach toward the campsite. */
  private static readonly CAMP_INTRO_APPROACH = 0.85;

  /**
   * Sets `introEndPos` / `introEndLookAt` for the lobby→game flythrough.
   * When starting at the campsite (Home), the path ends at the marker; otherwise it chases the vehicle.
   */
  private computeIntroEndTargets(globeRadius: number): void {
    if (this.pendingCampsiteAfterIntro && this.campsiteMarker) {
      const campPos = this.campsiteMarker.worldPosition;
      const frame = tangentFrame(this.campsiteMarker.surfaceQuat);
      const fwd = new Vector3()
        .addScaledVector(frame.north, Math.cos(Game.CAMP_INTRO_APPROACH))
        .addScaledVector(frame.east, Math.sin(Game.CAMP_INTRO_APPROACH))
        .normalize();
      this.introEndPos
        .copy(campPos)
        .addScaledVector(fwd, -this.vehicleFeatures.cameraFollowDistance)
        .addScaledVector(frame.up, this.vehicleFeatures.cameraFollowHeight);
      this.introEndLookAt.copy(campPos).addScaledVector(fwd, 0.5);
      return;
    }
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
  }

  private introDirScratch = new Vector3();
  private introPosScratch = new Vector3();

  /** Smooth great-circle interpolation between unit directions (stable turn rate vs lerp+normalize). */
  private slerpUnitVectors(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
    const dot = MathUtils.clamp(a.dot(b), -1, 1);
    const theta = Math.acos(dot);
    if (theta < 1e-4) {
      return out.copy(a).lerp(b, t).normalize();
    }
    const sinT = Math.sin(theta);
    const w0 = Math.sin((1 - t) * theta) / sinT;
    const w1 = Math.sin(t * theta) / sinT;
    return out.copy(a).multiplyScalar(w0).addScaledVector(b, w1).normalize();
  }

  private tick = () => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.gameTime += dt;
    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    this.dayNightCycle.moonProgress = this.moonThreat?.progress ?? 0;

    if (this.localPlayer instanceof Boat && this.progression) {
      const state = this.progression.upgrades.state;
      const atHighSpeed = this.localPlayer.speedRatio >= 0.8;
      this.ringManager.upgrades.highSpeedMult = atHighSpeed
        ? state.boatHighSpeedDiamondMult
        : 1;
    } else {
      this.ringManager.upgrades.highSpeedMult = 1;
    }

    if (this.introActive) {
      this.skyGremlins?.setSuspended(true);
      this.localPlayer.visibility = 1;
      this.introTimer += dt;
      const raw = Math.min(this.introTimer / Game.INTRO_DURATION, 1);
      // Ease-in-out: avoids the old ease-out spike at t≈0 that made the first part of the zoom feel jerky.
      const t = raw * raw * (3 - 2 * raw);

      this.localPlayer.update(dt, 0, false, false, false, false);

      this.computeIntroEndTargets(globeRadius);

      const startDir = this.introStartPos.clone().normalize();
      const endDir = this.introEndPos.clone().normalize();
      const startDist = this.introStartPos.length();
      const endDist = this.introEndPos.length();

      const dir = this.slerpUnitVectors(startDir, endDir, t, this.introDirScratch);
      const dist = startDist + (endDist - startDist) * t;
      const pos = this.introPosScratch.copy(dir).multiplyScalar(dist);

      const lookAt = new Vector3().lerpVectors(new Vector3(0, 0, 0), this.introEndLookAt, t);
      const worldUp = new Vector3(0, 1, 0);
      const localUp = pos.clone().normalize();
      const up = worldUp.clone().lerp(localUp, t).normalize();
      const rollZ = Math.sin(t * Math.PI) * 0.12;
      this.cameraRig.setPositionAndLookAt(pos, lookAt, rollZ, up);

      this.globe.update(dt);
      this.moonThreat?.update(dt);
      this.remotePlanes.update(dt, this.cameraRig.camera);
      this.applyDayNightPreset();
      this.audioManager.update(dt);
      this.aurora?.update(dt, this.cameraRig.camera);

      this.localPlayer.group.updateMatrixWorld(true);
      this.meteorShower?.update(
        dt,
        this.moonThreat?.progress ?? 0,
        this.localPlayer.qPosition,
        this.localPlayer.heading,
        this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
      );
      this.skyJellyfish?.update(
        dt,
        this.localPlayer.group.matrixWorld,
        this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
        false,
        false,
      );
      this.jellyfishCaptureRing?.setProgress(this.skyJellyfish?.getCaptureProgress() ?? 0);
      this.updateOceanFish(dt, false);
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
        const landingAtCampsite = this.pendingCampsiteAfterIntro;
        if (!landingAtCampsite) {
          this.cameraRig.snapTo(
            this.localPlayer.qPosition,
            this.localPlayer.heading,
            this.localPlayer.altitude,
            globeRadius,
            this.vehicleFeatures.cameraFollowDistance,
            this.vehicleFeatures.cameraFollowHeight,
          );
        }
        this.hud.show();
        if (landingAtCampsite) {
          this.pendingCampsiteAfterIntro = false;
          void this.doLanding();
        }
      }
      return;
    }

    /* ── Campsite phase ────────────────────────────────── */
    if (this.gamePhase === "campsite" && this.campsiteScene) {
      this.skyGremlins?.setSuspended(true);
      this.localPlayer.visibility = 1;
      this.moonThreat?.update(dt);
      this.localPlayer.group.updateMatrixWorld(true);
      this.meteorShower?.update(
        dt,
        this.moonThreat?.progress ?? 0,
        this.localPlayer.qPosition,
        this.localPlayer.heading,
        this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
      );
      this.skyJellyfish?.update(
        dt,
        this.localPlayer.group.matrixWorld,
        this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
        false,
        false,
      );
      this.updateOceanFish(dt, false);
      if (this.moonThreat?.isNearImpact || this.moonThreat?.hasImpacted) {
        this.campsiteScene.exit();
        this.localPlayer.group.visible = true;
        this.startMoonImpactCinematic();
        return;
      }
      const result = this.campsiteScene.update(dt);
      this.applyDayNightPreset();
      this.campsiteScene.updatePreset(this.dayNightCycle.getPreset());
      this.audioManager.update(dt);
      this.renderer.render(this.campsiteScene.scene, this.campsiteScene.camera);
      if (result.takeOff) this.doTakeOff();
      return;
    }
    if (this.gamePhase === "transitioning") {
      this.skyGremlins?.setSuspended(true);
      this.localPlayer.group.updateMatrixWorld(true);
      this.meteorShower?.update(
        dt,
        this.moonThreat?.progress ?? 0,
        this.localPlayer.qPosition,
        this.localPlayer.heading,
        this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
      );
      this.skyJellyfish?.update(
        dt,
        this.localPlayer.group.matrixWorld,
        this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
        false,
        false,
      );
      this.updateOceanFish(dt, false);
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    /* ── Moon impact cinematic phase ────────────────────── */
    if (this.gamePhase === "moonImpact") {
      this.skyGremlins?.setSuspended(true);
      this.moonThreat?.update(dt);
      this.tickMoonImpactCinematic(dt);
      return;
    }

    if (this.portalInteractionSuppressTimer > 0) {
      this.portalInteractionSuppressTimer = Math.max(0, this.portalInteractionSuppressTimer - dt);
    }

    const { turnRate, forward, brake, elevate, descend, paintball, specialAction, interact } =
      this.touchControls ? this.touchControls.getState() : this.controls.getState();
    this.localPlayer.visibility = 1;
    this.localPlayer.update(dt, turnRate, forward, brake, elevate, paintball, descend);

    if (specialAction && this.localPlayer instanceof Carpet && this.carpetPortalSystem) {
      this.carpetPortalSystem.placePortal(this.localPlayer);
    }

    if (this.localPlayer instanceof Carpet && this.carpetPortalSystem) {
      const portalUpdate = this.carpetPortalSystem.update(dt, this.localPlayer);
      if (portalUpdate.didTeleport) {
        this.handleCarpetPortalTeleport();
      }
    }

    if (paintball && this.localPlayer instanceof Plane && this.paintballSystem) {
      this.paintballSystem.tryLocalFire(this.localPlayer);
    }

    const portalInteractionSuppressed = this.portalInteractionSuppressTimer > 0;

    if (this.moonThreat && !this.moonThreat.hasImpacted) {
      this.localPlayer.group.updateMatrixWorld(true);
      const playerPos = _moonCollisionScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld);
      const moonPos = this.moonThreat.worldPosition;
      const moonR = this.moonThreat.worldRadius;
      const buffer = moonR + 0.3;
      const toPlayer = playerPos.clone().sub(moonPos);
      const dist = toPlayer.length();
      if (dist < buffer && dist > 0.001) {
        const push = buffer - dist;
        const pushDir = toPlayer.divideScalar(dist);
        const up = playerPos.clone().normalize();
        const altPush = pushDir.dot(up) * push;
        this.localPlayer.altitude += Math.max(altPush, push * 0.5);
        this.localPlayer.applyMatrix();
      }
    }

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
    if (this.localPlayer instanceof Plane && this.skyGremlins) {
      this.skyGremlins.setSuspended(false);
      this.skyGremlins.update(dt, this.localPlayer, this.moonThreat?.progress ?? 0, this.cameraRig.camera.position);
    } else {
      this.skyGremlins?.setSuspended(true);
    }
    this.paintballSystem?.update(dt, this.cameraRig.camera.position);

    this.localPlayer.group.updateMatrixWorld(true);

    if (this.vehicleFeatures.collectibleDiamonds) {
      this.collectVFX.update(dt);
      if (!portalInteractionSuppressed) {
        this.ringManager.update(dt, this.localPlayer.qPosition, this.localPlayer.altitude);
      }
    }

    if (!portalInteractionSuppressed && this.birdFlocks.length > 0 && this.flockFormationHUD) {
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
        this.awardXP("flock", FLOCK_FORMATION_XP);
        this.vehicleFlashTimer = 0.35;
        this.cameraRig.shake();
      }
    }

    if (!portalInteractionSuppressed && this.rainbowArches.length > 0) {
      const dayW = this.dayNightCycle.getDayWeight();
      for (const arch of this.rainbowArches) {
        const { justCollected } = arch.update(dt, this.localPlayer.qPosition, this.localPlayer.altitude, dayW);
        if (justCollected) {
          this.hud.showRainbowCelebrate();
          this.awardXP("rainbow", RAINBOW_XP);
          this.vehicleFlashTimer = 0.35;
          this.cameraRig.shake();
        }
      }
    }

    if (!portalInteractionSuppressed && this.lanternClusters.length > 0) {
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
          const litCount = cluster.lanternCount;
          const loadedLanternSfx = LANTERN_COLLECT_SFX_IDS.filter((id) =>
            this.audioManager.hasSFX(id),
          );
          if (loadedLanternSfx.length > 0) {
            const lanternSfx =
              loadedLanternSfx[Math.floor(Math.random() * loadedLanternSfx.length)]!;
            this.audioManager.playSFX(lanternSfx, LANTERN_COLLECT_SFX_VOLUME);
          }
          this.hud.showLanternCelebrate(litCount);

          const srvUrl = this.getServerUrl();
          fetch(`${srvUrl}/api/lanterns/add`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ count: litCount, worldSlug: this.worldSlug }),
          })
            .catch(() => {});

          this.awardXP("lantern", LANTERN_XP);
          this.vehicleFlashTimer = 0.35;
          this.cameraRig.shake();
        }
      }
    }

    if (!portalInteractionSuppressed && this.fireflyClusters.length > 0) {
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
          this.awardXP("firefly", FIREFLY_XP);
          this.vehicleFlashTimer = 0.35;
        }
      }
    }

    if (!portalInteractionSuppressed && this.volcanoes.length > 0) {
      for (const volcano of this.volcanoes) {
        const { justCollected } = volcano.update(
          dt,
          this.localPlayer.qPosition,
          this.localPlayer.altitude,
        );
        if (justCollected) {
          this.hud.showVolcanoCelebrate();
          this.awardXP("volcano", VOLCANO_XP);
          this.vehicleFlashTimer = 0.35;
          this.cameraRig.shake();
        }
      }
    }

    if (!portalInteractionSuppressed && this.braziers) {
      const playerWorldPos = new Vector3().setFromMatrixPosition(this.localPlayer.group.matrixWorld);
      const { newlyLitIndices, burnProgress } = this.braziers.update(dt, playerWorldPos);
      if (newlyLitIndices.length > 0) {
        this.hud.showBrazierLit();
        for (const idx of newlyLitIndices) {
          this.socketClient?.emitBrazierIgnite(idx);
        }
      }
      this.hud.updateBrazierStatus(burnProgress);
      this.lastBrazierProgress = burnProgress;
      if (!this.socketClient?.connected) {
        const allFive =
          burnProgress.length >= BRAZIER_COUNT &&
          burnProgress.every((p) => p > 0);
        if (allFive && !this.prevAllFiveBraziers) {
          this.applyBrazierMoonShield(BRAZIER_MOON_PAUSE_MS);
        }
        this.prevAllFiveBraziers = allFive;
      }
    }

    /* ── Campsite landing detection ─────────────────────── */
    this.campsiteMarker?.update(dt);
    if (this.campsiteMarker) {
      if (portalInteractionSuppressed) {
        this.hud.showCampsitePrompt(false);
      } else {
        const nearCamp = this.campsiteMarker.isPlayerNear(
          this.localPlayer.qPosition, this.localPlayer.altitude, globeRadius,
        );
        this.hud.showCampsitePrompt(nearCamp);
        if (nearCamp && interact) {
          this.doLanding();
        }
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
    this.updateOceanFish(dt, !portalInteractionSuppressed);
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

    if (portalInteractionSuppressed) {
      this.landmarkHUD.hide();
    } else {
      this.landmarkDetector.update(this.localPlayer.qPosition);
    }
    const questPlayerPos = new Vector3().setFromMatrixPosition(this.localPlayer.group.matrixWorld);

    /* Moon threat + cinematic before package/balloon dialogue so nothing spawns the same frame impact starts. */
    this.moonThreat?.update(dt);
    if (this.moonThreat) {
      this.cameraRig.setTrauma(this.moonThreat.getShakeTrauma());
      if (this.moonThreat.isNearImpact || this.moonThreat.hasImpacted) {
        this.startMoonImpactCinematic();
      }
    }
    /* String() avoids TS narrowing: startMoonImpactCinematic() can set phase to moonImpact this frame. */
    if (String(this.gamePhase) === "moonImpact") {
      this.tickMoonImpactCinematic(dt);
      return;
    }

    this.meteorShower?.update(
      dt,
      this.moonThreat?.progress ?? 0,
      this.localPlayer.qPosition,
      this.localPlayer.heading,
      questPlayerPos,
    );

    if (this.skyJellyfish) {
      this.localPlayer.group.updateMatrixWorld(true);
      const selfieActive = this.selfieProgressCached > 0;
      this.skyJellyfish.update(
        dt,
        this.localPlayer.group.matrixWorld,
        questPlayerPos,
        !portalInteractionSuppressed,
        selfieActive,
      );
      this.jellyfishCaptureRing?.setProgress(this.skyJellyfish.getCaptureProgress());
    }

    if (!portalInteractionSuppressed && this.packageQuest && this.moonThreat) {
      this.packageQuest.moonProgress = this.moonThreat.progress;
    }
    if (!portalInteractionSuppressed) {
      this.packageQuest?.update(dt, this.localPlayer.qPosition, this.cameraRig.camera, questPlayerPos);
      _carpetSelfiePlayerNormal.copy(_carpetSelfieRefUp).applyQuaternion(this.localPlayer.qPosition).normalize();
      this.carpetLandmarkSelfieQuest?.update(dt, _carpetSelfiePlayerNormal, this.playerVehicle === "carpet");
    }
    (this.localPlayer as any).carrying = this.packageQuest?.isCarrying ?? false;
    if (this.packageQuest?.isCarrying) {
      const dm = this.packageQuest.getDeliverySurfaceDistanceMetres(questPlayerPos);
      if (dm !== null) this.packageQuestHUD.setDeliveryDistanceMetres(dm);
    }
    if (!portalInteractionSuppressed) {
      this.updateBalloonGreetings(dt, questPlayerPos);
      this.updateObservatoryGreetings(dt, questPlayerPos);
      this.updateStonehengeWhispers(dt, questPlayerPos);
      this.updateBrazierWhispers(dt, questPlayerPos);
    }
    this.updateStonehengeFloat();
    this.globe.updateFloatingTrees(this.moonThreat?.progress ?? 0, this.gameTime);

    if (this.playerVehicle === "plane") {
      const engineVol =
        0.095 + (this.localPlayer as Plane).engineSpeedRatio * 0.28;
      this.audioManager.setLoopVolume("engine_biplane", engineVol);
    }

    const moonProg = this.moonThreat?.progress ?? 0;
    if (moonProg >= 0.75) {
      this.panicDialogueCooldown -= dt;
      if (this.panicDialogueCooldown <= 0 && !this.packageQuestHUD.isBubbleShowing) {
        const { npcName, line } = pickPanicLine();
        this.packageQuestHUD.showBubble(npcName, line);
        const urgency = (moonProg - 0.75) / 0.25;
        this.panicDialogueCooldown = 12 - urgency * 8;
      }
    }

    this.applyDayNightPreset();
    this.audioManager.update(dt);
    this.lensFlare?.update(this.cameraRig.camera);
    this.aurora?.update(dt, this.cameraRig.camera);
    this.rainOverlay?.update(dt, this.dayNightCycle.getRainWeight(moonProg), moonProg);

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

  /* ── Debug ──────────────────────────────────────────────────── */

  private onDebugKey = (e: KeyboardEvent) => {
    if (e.key === "q" || e.key === "Q") {
      this.moonThreat?.jumpTo(0.83);
    }
    if (e.key === "r" || e.key === "R") {
      if (!this.braziers) return;
      this.braziers.debugLightAll();
      for (let i = 0; i < BRAZIER_COUNT; i++) {
        this.socketClient?.emitBrazierIgnite(i);
      }
    }
  };

  /* ── Moon impact cinematic ────────────────────────────────────── */

  private moonCinematicCamera: PerspectiveCamera | null = null;
  private vignetteOverlay: HTMLDivElement | null = null;

  private startMoonImpactCinematic() {
    if (this.gamePhase === "moonImpact") return;
    this.meteorShower?.reset();
    this.skyJellyfish?.reset();
    this.gamePhase = "moonImpact";
    this.moonCinematicStep = "fadeOut1";
    this.moonCinematicTimer = 0;
    this.hud.root.style.display = "none";

    // Dismiss any open level-up card overlay so it doesn't block the cutscene.
    this.levelUpCards.dispose();

    this.controls.enabled = false;
    if (this.touchControls) this.touchControls.enabled = false;

    for (const id of DIALOGUE_LOOP_IDS) {
      this.audioManager.fadeOutLoop(id);
    }
    this.audioManager.fadeOutLoop(RUMBLE_LOOP_NAME);
    this.packageQuestHUD.hideBubble();

    // Build a wide-angle camera positioned far from the globe
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.moonCinematicCamera = new PerspectiveCamera(50, aspect, 0.1, 200);
    const globeR = this.worldConfig?.globeRadius ?? 5;
    this.moonCinematicCamera.position.set(globeR * 3.2, globeR * 1.8, globeR * 3.2);
    this.moonCinematicCamera.lookAt(0, globeR * 0.3, 0);

    // Vignette that darkens over the cinematic
    this.vignetteOverlay = document.createElement("div");
    const v = this.vignetteOverlay;
    v.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:5;" +
      "background:radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.0) 100%);" +
      "opacity:0;transition:none;";
    this.container.appendChild(v);

    this.transitionOverlay?.fadeOut(); // fade to black
  }

  private tickMoonImpactCinematic(dt: number) {
    this.moonCinematicTimer += dt;
    if (this.moonCinematicStep === "fadeOut1") {
      this.localPlayer.visibility = Math.max(
        0,
        1 - this.moonCinematicTimer / Game.MOON_NETWORK_VISIBILITY_FADE_SEC,
      );
    } else {
      this.localPlayer.visibility = 0;
    }
    this.globe.update(dt);

    if (this.moonThreat) {
      this.cameraRig.setTrauma(this.moonThreat.getShakeTrauma());
    }

    const cam = this.moonCinematicCamera ?? this.cameraRig.camera;

    switch (this.moonCinematicStep) {
      /* Step 1: Fade to black (0.5s CSS transition) */
      case "fadeOut1":
        if (this.moonCinematicTimer > 0.7) {
          this.moonCinematicStep = "wideShot";
          this.moonCinematicTimer = 0;
          // Hide player, switch to cinematic camera, fade back in
          this.localPlayer.group.visible = false;
          this.transitionOverlay?.fadeIn();
        }
        this.renderer.render(this.scene, this.cameraRig.camera);
        break;

      /* Step 2: Wide-angle shot — shockwave + debris play out */
      case "wideShot": {
        // Slow cinematic camera orbit
        const orbitSpeed = 0.04;
        const globeR = this.worldConfig?.globeRadius ?? 5;
        const angle = this.moonCinematicTimer * orbitSpeed;
        const dist = globeR * 3.8;
        cam.position.set(
          Math.sin(angle) * dist,
          globeR * 1.6 + this.moonCinematicTimer * 0.08,
          Math.cos(angle) * dist,
        );
        cam.lookAt(0, globeR * 0.2, 0);

        // Apply trauma shake to cinematic camera too
        if (this.moonThreat) {
          const trauma = this.moonThreat.getShakeTrauma();
          const amp = trauma * trauma * 0.18;
          const t = this.moonCinematicTimer * 11;
          cam.position.x += Math.sin(t * 23.1 + 1.7) * amp;
          cam.position.y += Math.sin(t * 17.3 + 4.2) * amp;
          cam.position.z += Math.cos(t * 19.7 + 2.9) * amp;
        }

        // Darken the scene progressively via vignette
        if (this.vignetteOverlay) {
          const vt = Math.min(this.moonCinematicTimer / 7.0, 1);
          const edgeDark = 0.3 + vt * 0.7;
          const centerDark = vt * 0.4;
          const clearR = Math.max(5, 30 - vt * 25);
          this.vignetteOverlay.style.background =
            `radial-gradient(ellipse at center, rgba(0,0,0,${centerDark}) ${clearR}%, rgba(0,0,0,${edgeDark}) 100%)`;
          this.vignetteOverlay.style.opacity = "1";
        }

        this.renderer.render(this.scene, cam);

        // After the shockwave + debris play, fade to final black
        if (this.moonCinematicTimer > 5.0) {
          this.moonCinematicStep = "fadeOut2";
          this.moonCinematicTimer = 0;
          this.transitionOverlay?.fadeOut();
        }
        break;
      }

      /* Step 3: Final fade to black — cinematic complete */
      case "fadeOut2":
        if (this.moonThreat) {
          const trauma = this.moonThreat.getShakeTrauma();
          const amp = trauma * trauma * 0.18;
          const t2 = this.moonCinematicTimer * 11;
          cam.position.x += Math.sin(t2 * 23.1 + 1.7) * amp;
          cam.position.y += Math.sin(t2 * 17.3 + 4.2) * amp;
          cam.position.z += Math.cos(t2 * 19.7 + 2.9) * amp;
        }
        this.renderer.render(this.scene, cam);
        if (this.moonCinematicTimer > 1.0) {
          if (this.vignetteOverlay) {
            this.vignetteOverlay.remove();
            this.vignetteOverlay = null;
          }
          void this.returnToMainMenuAfterMoonImpact();
        }
        break;

      case "done":
        break;
    }

    /* fadeOutLoop / stopWhenSilent only advance in update(); flying tick skips this during moonImpact. */
    this.audioManager.update(dt);
  }

  private createVhsOverlay(): HTMLDivElement {
    // Inject keyframe styles once.
    const styleId = "vhs-rewind-style";
    if (!document.getElementById(styleId)) {
      const s = document.createElement("style");
      s.id = styleId;
      s.textContent = `
        @keyframes vhs-scan {
          0%   { background-position: 0 0; }
          100% { background-position: 0 8px; }
        }
        @keyframes vhs-bands {
          0%   { background-position: 0 0; }
          100% { background-position: 0 60px; }
        }
        @keyframes vhs-blink {
          0%,49%  { opacity: 1; }
          50%,100%{ opacity: 0; }
        }
        @keyframes vhs-flicker {
          0%,100%{ opacity: 1; }
          91%    { opacity: 0.88; }
          93%    { opacity: 1; }
          95%    { opacity: 0.82; }
          97%    { opacity: 1; }
        }
      `;
      document.head.appendChild(s);
    }

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "absolute",
      inset: "0",
      zIndex: "6",
      pointerEvents: "none",
      animation: "vhs-flicker 0.18s step-end infinite",
    });

    // Fine horizontal scan lines — kept subtle (≈30% of original opacity).
    const scanLines = document.createElement("div");
    Object.assign(scanLines.style, {
      position: "absolute",
      inset: "0",
      background:
        "repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px)",
      backgroundSize: "100% 4px",
      animation: "vhs-scan 0.06s linear infinite",
    });

    // Wider scrolling tracking bands — subtle.
    const bands = document.createElement("div");
    Object.assign(bands.style, {
      position: "absolute",
      inset: "0",
      background:
        "repeating-linear-gradient(to bottom, transparent 0px, transparent 24px, rgba(255,255,255,0.015) 24px, rgba(255,255,255,0.015) 30px, transparent 30px, transparent 60px)",
      backgroundSize: "100% 60px",
      animation: "vhs-bands 0.12s linear infinite",
    });

    // Horizontal glitch line — JS-driven random positioning.
    const glitchLine = document.createElement("div");
    Object.assign(glitchLine.style, {
      position: "absolute",
      left: "0",
      right: "0",
      height: "3px",
      background: "rgba(255,255,255,0.7)",
      mixBlendMode: "screen",
      opacity: "0",
    });
    this.vhsGlitchInterval = setInterval(() => {
      if (!glitchLine.isConnected) return;
      glitchLine.style.top = `${10 + Math.random() * 80}%`;
      glitchLine.style.height = `${1 + Math.floor(Math.random() * 4)}px`;
      glitchLine.style.opacity = Math.random() > 0.45 ? "0.8" : "0";
    }, 80);

    // ◀◀ RWD indicator — bottom-right, blinking.
    const indicator = document.createElement("div");
    indicator.textContent = "◀◀  RWD";
    Object.assign(indicator.style, {
      position: "absolute",
      bottom: "2.5rem",
      right: "2rem",
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: "clamp(0.75rem, 2vw, 1rem)",
      fontWeight: "700",
      color: "#ffffff",
      letterSpacing: "0.22em",
      textShadow: "0 0 8px rgba(255,255,255,0.9), 0 0 20px rgba(255,200,50,0.6)",
      animation: "vhs-blink 0.5s step-end infinite",
    });

    wrap.appendChild(scanLines);
    wrap.appendChild(bands);
    wrap.appendChild(glitchLine);
    wrap.appendChild(indicator);
    this.container.appendChild(wrap);
    return wrap;
  }

  /* ── Campsite landing / takeoff ─────────────────────────────── */

  private async doLanding() {
    if (!this.transitionOverlay || !this.campsiteScene) return;
    if (this.gamePhase !== "flying") return;

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
      this.dayNightCycle.getPreset(),
    );

    /* Swap control hints to campsite layout */
    if (this.vehicleHintsEl) this.vehicleHintsEl.style.display = "none";
    if (!this.campsiteHintsEl) {
      this.campsiteHintsEl = mountCampsiteControlHints(this.hud.root, !this.mobile);
    } else {
      this.campsiteHintsEl.style.display = "";
    }

    /* Switch to campsite rendering before fade-in so the overlay reveals the camp scene,
       not an empty globe (which read as a second fade to black when zoomed in). */
    this.gamePhase = "campsite";

    await this.transitionOverlay.fadeIn();
  }

  private async doTakeOff() {
    if (!this.transitionOverlay || !this.campsiteScene || !this.campsiteMarker) return;
    this.gamePhase = "transitioning";

    await this.transitionOverlay.fadeOut();

    this.campsiteScene.exit();
    this.localPlayer.group.visible = true;

    /* Restore vehicle control hints */
    if (this.campsiteHintsEl) this.campsiteHintsEl.style.display = "none";
    if (this.vehicleHintsEl) this.vehicleHintsEl.style.display = "";

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

    if (this.localPlayer instanceof Carpet && this.carpetPortalSystem) {
      this.carpetPortalSystem.syncToCarpet(this.localPlayer);
      this.carpetTrail.reset();
      this.carpetWake.reset();
      this.carpetLeaves.reset();
    }

    this.controls.enabled = true;
    if (this.touchControls) this.touchControls.enabled = true;

    await this.transitionOverlay.fadeIn();
    this.gamePhase = "flying";
    if (CAMPSITE_HOME_ENABLED) this.hud.setCampsiteButtonVisible(true);
  }

  private handleCarpetPortalTeleport() {
    if (!(this.localPlayer instanceof Carpet)) return;

    this.audioManager.resumeContextIfNeeded();
    this.audioManager.playSFX("portal_1", PORTAL_TELEPORT_SFX_VOLUME);
    this.awardXP("portal", PORTAL_TELEPORT_XP);

    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    this.portalInteractionSuppressTimer = PORTAL_INTERACTION_SUPPRESS_SEC;
    this.landmarkHUD.hide();
    this.hud.showCampsitePrompt(false);

    this.carpetTrail.reset();
    this.carpetWake.reset();
    this.carpetLeaves.reset();
    this.localPlayer.group.updateMatrixWorld(true);
    this.skyJellyfish?.snapFollowers(this.localPlayer.group.matrixWorld);

    this.cameraRig.snapTo(
      this.localPlayer.qPosition,
      this.localPlayer.heading,
      this.localPlayer.altitude,
      globeRadius,
      this.vehicleFeatures.cameraFollowDistance,
      this.vehicleFeatures.cameraFollowHeight,
    );
    this.stateSync?.flush();
  }

  /* ── Resize ──────────────────────────────────────────────────────── */

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.resize(w / h);
    this.campsiteScene?.resize(w / h);
    this.oceanFish?.setFishingLineResolution(w, h);
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
    this.dayNightCycle.moonProgress = this.moonThreat?.progress ?? 0;
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

    const moonProg = this.moonThreat?.progress ?? 0;
    const rainW = this.dayNightCycle.getRainWeight(moonProg);
    const rainDampen = 1 - rainW;
    this.audioManager.setLoopVolume(RAIN_LOOP_NAME, rainW * RAIN_LOOP_MAX_VOL);
    this.audioManager.setLoopVolume("crickets_loop", nightW * CRICKETS_LOOP_MAX_VOL * rainDampen);
    this.audioManager.setLoopVolume(BIRDS_LOOP_NAME, dayW * BIRDS_LOOP_MAX_VOL * rainDampen);

    let rumbleVol = 0;
    if (moonProg >= 0.75 && !this.moonThreat?.hasImpacted) {
      const t = Math.min(1, (moonProg - 0.75) / 0.25);
      const eased = t * t * (3 - 2 * t);
      rumbleVol = eased * RUMBLE_MAX_VOL;
    }
    this.audioManager.setLoopVolume(RUMBLE_LOOP_NAME, rumbleVol);

    const mw = this.dayNightCycle.getMusicWeights();
    const endTimesBlend = moonProg >= 0.65
      ? Math.min(1, (moonProg - 0.65) / 0.15)
      : 0;
    this.audioManager.setEndTimesWeight(endTimesBlend);
    this.audioManager.setWeights(mw.day, mw.evening, mw.night);
  }

  private playLevelUpSfx() {
    const pick =
      LEVELUP_SFX_IDS[Math.floor(Math.random() * LEVELUP_SFX_IDS.length)]!;
    this.audioManager.playSFX(pick, LEVELUP_SFX_VOLUME, 1, 0.2);
  }

  /** Places braziers in the world once the current vehicle reaches the brazier unlock level. */
  private ensureBraziersSpawned() {
    if (this.braziers) return;
    if (this.progression.getLevel() < UNLOCK_BRAZIERS_MIN_MAX_LEVEL) return;
    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    const seed = this.gameSeed;
    const terrainType = this.gameTerrainType;
    this.braziers = new Braziers(this.scene, globeRadius, seed, terrainType);
    this.hud.initBrazierTracker(BRAZIER_COUNT);
    this.brazierInRange = new Array(BRAZIER_COUNT).fill(false);
    this.brazierCooldown = new Array(BRAZIER_COUNT).fill(0);
    this.lastBrazierProgress = new Array(BRAZIER_COUNT).fill(0);
    this.prevAllFiveBraziers = false;
    if (this.pendingBrazierSync) {
      this.braziers.syncBrazierExpiries(this.pendingBrazierSync.expiries);
      this.pendingBrazierSync = null;
    }
  }

  private handleLevelUp(level: number) {
    this.playLevelUpSfx();
    this.ensureBraziersSpawned();
    this.hud.showLevelUp(level);

    const cards = this.progression.upgrades.drawCards(3);
    if (cards.length === 0) return;

    this.controls.enabled = false;
    if (this.touchControls) this.touchControls.enabled = false;

    setTimeout(() => {
      if (this.gamePhase !== "flying") return;
      this.levelUpCards.show(cards, (id) => {
        this.progression.upgrades.apply(id);
        this.propagateUpgrades();
        this.progression.save();
        this.controls.enabled = true;
        if (this.touchControls) this.touchControls.enabled = true;
      });
    }, 450);
  }

  /**
   * Single XP chokepoint so global modifiers (Night Owl) and per-source
   * modifiers (Wide Portal XP, Selfie XP, Delivery XP) stay consistent.
   *
   * Diamonds already have their per-source multipliers applied inside
   * RingManager (diamondXpMult, frequentFlyer, wake_rider highSpeedMult) so
   * we only add Night Owl on top for "diamond".
   */
  private updateOceanFish(dt: number, allowCapture: boolean) {
    if (!this.oceanFish || !(this.localPlayer instanceof Boat)) return;
    this.cameraRig.camera.getWorldPosition(this.fishCamScratch);
    this.oceanFish.update(
      dt,
      this.localPlayer.qPosition,
      this.localPlayer.group.matrixWorld,
      this.localPlayerWorldScratch.setFromMatrixPosition(this.localPlayer.group.matrixWorld),
      this.fishCamScratch,
      this.localPlayer.heading,
      this.dayNightCycle.getDayWeight(),
      this.dayNightCycle.getNightWeight(),
      allowCapture,
    );
  }

  private awardXP(source: XpSource, base: number) {
    if (base <= 0) return;
    const s = this.progression.upgrades.state;
    let amt = base;
    switch (source) {
      case "delivery":
        amt *= s.deliveryXpMult;
        break;
      case "selfie":
        amt *= s.carpetSelfieXpMult;
        break;
      case "portal":
        amt *= s.carpetPortalXpMult;
        break;
      default:
        break;
    }
    if (s.nightOwlEnabled) {
      amt *= 1 + 0.2 * this.dayNightCycle.getNightWeight();
    }
    const rounded = Math.max(0, Math.round(amt));
    if (rounded <= 0) return;
    this.hud.showXPGain(rounded);
    this.progression.addXP(rounded);
  }

  private propagateUpgrades() {
    const s = this.progression.upgrades.state;

    if (this.localPlayer instanceof Plane) {
      Object.assign(this.localPlayer.upgrades, {
        maxSpeedMult: s.maxSpeedMult,
        boostSpeedMult: s.boostSpeedMult,
        boostDurationMult: s.boostDurationMult,
        altSpeedMult: s.altSpeedMult,
        bankMult: s.bankMult,
        brakeDecelMult: s.brakeDecelMult,
      });
    } else if (this.localPlayer instanceof Carpet) {
      Object.assign(this.localPlayer.upgrades, {
        maxSpeedMult: s.carpetSpeedMult,
        boostSpeedMult: s.carpetBoostSpeedMult,
        boostDurationMult: s.carpetBoostDurationMult,
        bankMult: s.carpetBankMult,
      });
    } else if (this.localPlayer instanceof Boat) {
      Object.assign(this.localPlayer.upgrades, {
        maxSpeedMult: s.boatSpeedMult,
        turnMult: s.boatTurnMult,
        accelMult: s.boatAccelMult,
      });
    }

    this.ringManager.upgrades.diamondXpMult = s.diamondXpMult;
    this.ringManager.upgrades.frequentFlyerEnabled = s.frequentFlyerEnabled;
    this.ringManager.upgrades.magnetMult = s.magnetMult;

    if (this.carpetPortalSystem) {
      this.carpetPortalSystem.upgrades.triggerRadiusMult = s.carpetPortalRadiusMult;
    }

    if (this.paintballSystem) {
      this.paintballSystem.setLocalPaintballMultipliers(
        s.paintballSpeedMult,
        s.paintballRangeMult,
      );
      this.paintballSystem.setLocalDoubleTap(s.paintballDoubleTapEnabled);
      this.socketClient?.emitPaintballSetUpgrades({
        doubleTap: s.paintballDoubleTapEnabled,
        speedMult: s.paintballSpeedMult,
        rangeMult: s.paintballRangeMult,
      });
    }

    this.spawnExtraCollectibles(s);
  }

  private spawnExtraCollectibles(s: import("./UpgradeManager").UpgradeState) {
    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    const seed = this.gameSeed;

    // Diamond Magnet
    const diamondDelta = s.diamondCountBonus - this.prevDiamondCountBonus;
    if (diamondDelta > 0) {
      this.ringManager.spawnBonusDiamonds(diamondDelta);
      this.prevDiamondCountBonus = s.diamondCountBonus;
    }

    // Rainbow Finder
    const rainbowDelta = s.extraRainbows - this.prevExtraRainbows;
    for (let i = 0; i < rainbowDelta; i++) {
      const idx = this.rainbowArches.length;
      const arch = new RainbowArch(this.scene, globeRadius, seed, idx);
      this.rainbowArches.push(arch);
    }
    this.prevExtraRainbows = s.extraRainbows;

    // Firefly Season
    const fireflyDelta = s.extraFireflies - this.prevExtraFireflies;
    for (let i = 0; i < fireflyDelta; i++) {
      const idx = this.fireflyClusters.length;
      const cluster = new FireflyCluster(this.scene, globeRadius, seed, this.gameTerrainType, idx);
      this.fireflyClusters.push(cluster);
    }
    this.prevExtraFireflies = s.extraFireflies;

    // Lantern Festival
    const lanternDelta = s.extraLanterns - this.prevExtraLanterns;
    for (let i = 0; i < lanternDelta; i++) {
      const idx = this.lanternClusters.length;
      const cluster = new FloatingLanterns(this.scene, globeRadius, seed, idx);
      this.lanternClusters.push(cluster);
    }
    this.prevExtraLanterns = s.extraLanterns;
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
            const moonProg = this.moonThreat?.progress ?? 0;
            const isDay = this.dayNightCycle.getDayWeight() > 0.5;
            const { npcName, line } = pickBalloonGreeting(
              this.gameSeed,
              i,
              this.balloonGreetSalt++,
              moonProg,
              isDay,
            );
            this.packageQuestHUD.showBubble(npcName, line);
            this.balloonGreetCooldown[i] = moonProg >= 0.75 ? 10 : BALLOON_GREET_COOLDOWN;
          }
          this.balloonInRange[i] = true;
        }
      } else if (dist > BALLOON_GREET_EXIT_DIST) {
        this.balloonInRange[i] = false;
      }
    }
  }

  private updateObservatoryGreetings(dt: number, playerWorld: Vector3) {
    for (let i = 0; i < this.observatoryCooldown.length; i++) {
      this.observatoryCooldown[i] = Math.max(0, this.observatoryCooldown[i] - dt);
    }
    if (this.packageQuestHUD.isBubbleShowing || this.packageQuestHUD.isWhisperShowing) return;
    for (let i = 0; i < this.observatoryWorldPositions.length; i++) {
      const dist = playerWorld.distanceTo(this.observatoryWorldPositions[i]);
      if (dist < OBSERVATORY_GREET_DIST) {
        if (!this.observatoryInRange[i]) {
          if (this.observatoryCooldown[i] <= 0) {
            const moonProg = this.moonThreat?.progress ?? 0;
            const { npcName, line } = pickObservatoryGreeting(i, moonProg);
            this.packageQuestHUD.showBubble(npcName, line);
            this.observatoryCooldown[i] = moonProg >= 0.75 ? 12 : OBSERVATORY_GREET_COOLDOWN;
          }
          this.observatoryInRange[i] = true;
        }
      } else if (dist > OBSERVATORY_GREET_EXIT_DIST) {
        this.observatoryInRange[i] = false;
      }
    }
  }

  private updateStonehengeWhispers(dt: number, playerWorld: Vector3) {
    for (let i = 0; i < this.stonehengeCooldown.length; i++) {
      this.stonehengeCooldown[i] = Math.max(0, this.stonehengeCooldown[i] - dt);
    }
    if (this.packageQuestHUD.isBubbleShowing || this.packageQuestHUD.isWhisperShowing) return;
    for (let i = 0; i < this.stonehengeWorldPositions.length; i++) {
      const dist = playerWorld.distanceTo(this.stonehengeWorldPositions[i]);
      if (dist < STONEHENGE_WHISPER_DIST) {
        if (!this.stonehengeInRange[i]) {
          if (this.stonehengeCooldown[i] <= 0) {
            const moonProg = this.moonThreat?.progress ?? 0;
            const whisper = pickStonehengeWhisper(moonProg);
            this.packageQuestHUD.showWhisper(whisper);
            this.stonehengeCooldown[i] = moonProg >= 0.75 ? 15 : STONEHENGE_WHISPER_COOLDOWN;
          }
          this.stonehengeInRange[i] = true;
        }
      } else if (dist > STONEHENGE_WHISPER_EXIT_DIST) {
        this.stonehengeInRange[i] = false;
      }
    }
  }

  private updateBrazierWhispers(dt: number, playerWorld: Vector3) {
    if (!this.braziers) return;
    for (let i = 0; i < this.brazierCooldown.length; i++) {
      this.brazierCooldown[i] = Math.max(0, this.brazierCooldown[i]! - dt);
    }
    if (this.packageQuestHUD.isBubbleShowing || this.packageQuestHUD.isWhisperShowing) return;

    const positions = this.braziers.worldPositions;
    const litCount  = this.lastBrazierProgress.filter(p => p > 0).length;

    for (let i = 0; i < positions.length; i++) {
      const dist = playerWorld.distanceTo(positions[i]!);
      if (dist < BRAZIER_WHISPER_DIST) {
        if (!this.brazierInRange[i]) {
          if (this.brazierCooldown[i]! <= 0) {
            const isLit  = (this.lastBrazierProgress[i] ?? 0) > 0;
            const whisper = pickBrazierWhisper(isLit, litCount);
            this.packageQuestHUD.showWhisper(whisper);
            this.brazierCooldown[i] = BRAZIER_WHISPER_COOLDOWN;
          }
          this.brazierInRange[i] = true;
        }
      } else if (dist > BRAZIER_WHISPER_EXIT_DIST) {
        this.brazierInRange[i] = false;
      }
    }
  }

  private updateStonehengeFloat() {
    const moonProg = this.moonThreat?.progress ?? 0;
    // Ease in from 50 % → 65 % moon progress; stay at 1 thereafter.
    const t = Math.max(0, Math.min(1, (moonProg - 0.50) / 0.15));

    for (const group of this.globe.stonehengeGroups) {
      for (const child of group.children) {
        const ud = child.userData;
        if (!ud.isFloating) continue;
        const mesh = child as Mesh;
        if (t <= 0) {
          mesh.position.y = ud.baseY;
          mesh.rotation.x = 0;
          mesh.rotation.z = 0;
        } else {
          const bob = Math.sin(this.gameTime * ud.speed + ud.phase) * ud.amp * 0.35;
          mesh.position.y = ud.baseY + ud.amp * 3.0 * t + bob * t;
          mesh.rotation.x = ud.tiltX * t;
          mesh.rotation.z = ud.tiltZ * t;
        }
      }
    }
  }

  private getServerUrl(): string {
    return this.serverUrlCache ?? "http://localhost:3001";
  }

  /* ── Cleanup ─────────────────────────────────────────────────────── */

  dispose() {
    this.running = false;
    this.previewActive = false;
    this.paintballSystem?.dispose();
    this.paintballSystem = null;
    this.skyGremlins?.dispose();
    this.skyGremlins = null;
    this.meteorShower?.dispose();
    this.meteorShower = null;
    this.skyJellyfish?.dispose();
    this.skyJellyfish = null;
    this.jellyfishCaptureRing?.dispose();
    this.jellyfishCaptureRing = null;
    this.oceanFish?.dispose();
    this.oceanFish = null;
    this.controls?.dispose();
    this.touchControls?.dispose();
    this.speedLines?.dispose();
    this.contrails?.dispose();
    this.wakeTrail?.dispose();
    this.carpetTrail?.dispose();
    this.carpetWake?.dispose();
    this.carpetLeaves?.dispose();
    if (this.carpetPortalSystem) {
      this.scene?.remove(this.carpetPortalSystem.group);
      this.carpetPortalSystem.dispose();
      this.carpetPortalSystem = null;
    }
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
    this.carpetSelfiePhotoUI?.dispose();
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
