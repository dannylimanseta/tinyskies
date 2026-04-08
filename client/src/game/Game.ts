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
import { RingManager } from "./Rings";
import { RingCollectVFX } from "./RingCollectVFX";
import { Lobby, generateWhimsicalName } from "../ui/Lobby";
import { HUD } from "../ui/HUD";
import { LandmarkHUD } from "../ui/LandmarkHUD";
import { PackageQuestHUD } from "../ui/PackageQuestHUD";
import { LandmarkRegistry, LandmarkDetector } from "./Landmarks";
import { PackageQuestManager } from "./PackageQuest";

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
  private packageQuestHUD: PackageQuestHUD | null = null;

  private running = false;
  private worldConfig: WorldConfig | null = null;
  private worldSlug = "";
  private playerName = "Pilot";
  private playerVehicle: Vehicle = "plane";
  private dayNightCycle!: DayNightCycle;
  private audioManager = new AudioManager();
  private vehicleFeatures!: VehicleGameFeatures;

  private introActive = false;
  private introTimer = 0;
  private vehicleFlashTimer = 0;
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
      onPlay: (vehicle) => {
        this.playerVehicle = vehicle;
        this.audioManager.startMusic();
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

    if (vehicle === "boat") {
      this.localPlayer = new Boat(globeRadius, seed, terrainType);
    } else if (vehicle === "carpet") {
      this.localPlayer = new Carpet(globeRadius, seed, terrainType);
    } else {
      this.localPlayer = new Plane(globeRadius);
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

    this.playerLight = new PointLight(0xffaa55, 0, 4.0, 1.5);
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
      this.cameraRig.shake();
      if (this.localPlayer instanceof Plane) {
        this.localPlayer.speedBoost();
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
      this.hud.showLevelUp(level);
    };

    this.collectVFX.onAbsorb = () => {
      this.vehicleFlashTimer = 0.35;
    };

    this.hud = new HUD(this.container);
    this.hud.setWorldName(this.worldConfig?.name ?? "Unknown World");
    this.hud.setMuteToggle(() => this.audioManager.toggleMute());
    this.hud.setVehicle(vehicle, {
      showXpProgression: this.vehicleFeatures.xpProgressionUI,
    });
    this.hud.hideUI();

    const landmarkRegistry = new LandmarkRegistry();
    landmarkRegistry.registerVillages(this.globe.villageCenters, seed);
    landmarkRegistry.registerLighthouses(this.globe.lighthouseCenters, seed);
    landmarkRegistry.registerWindmills(this.globe.windmillCenters, seed);
    this.landmarkDetector = new LandmarkDetector(landmarkRegistry);
    this.landmarkHUD = new LandmarkHUD(this.hud.root);
    this.hud.registerLandmarkHUD(this.landmarkHUD);
    this.landmarkDetector.onEnter = (lm) => this.landmarkHUD.show(lm.name, lm.type);
    this.landmarkDetector.onExit = () => this.landmarkHUD.hide();

    if (this.vehicleFeatures.packageQuests) {
      this.packageQuest = new PackageQuestManager(
        this.scene, globeRadius, landmarkRegistry, seed, terrainType,
      );
      this.packageQuestHUD = new PackageQuestHUD(this.hud.root);
      this.packageQuestHUD.onVisibilityChange = (visible) => {
        this.hud.setBubbleVisible(visible);
      };

      this.packageQuest.onPickup = (_originName, destName, npcName, dialogue) => {
        this.packageQuestHUD!.showBubble(npcName, dialogue);
        this.packageQuestHUD!.showDeliveryTarget(destName);
      };

      this.packageQuest.onDelivered = (_destName, npcName, dialogue, xp) => {
        this.packageQuestHUD!.showBubble(npcName, dialogue);
        this.packageQuestHUD!.hideDeliveryTarget();

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
          this.hud.showLevelUp(this.ringManager.level);
        }
      };

      this.packageQuest.onProgressChange = (progress) => {
        this.packageQuestHUD!.setProgress(progress);
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
      }
      return;
    }

    const { turnRate, forward, brake, elevate, barrelRoll } =
      this.touchControls ? this.touchControls.getState() : this.controls.getState();
    this.localPlayer.update(dt, turnRate, forward, brake, elevate, barrelRoll);

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
      const playerPos = new Vector3().setFromMatrixPosition(this.localPlayer.group.matrixWorld);
      this.collectVFX.update(dt, playerPos);
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

    if (this.playerVehicle === "plane") {
      const engineVol = 0.08 + this.localPlayer.speedRatio * 0.25;
      this.audioManager.setLoopVolume("engine_biplane", engineVol);
    }

    this.applyDayNightPreset();
    this.audioManager.update(dt);
    this.lensFlare?.update(this.cameraRig.camera);
    this.aurora?.update(dt, this.cameraRig.camera);

    this.renderer.render(this.scene, this.cameraRig.camera);
    if (this.vehicleFeatures.speedLines) {
      this.speedLines.render(this.renderer);
    }
    this.lensFlare?.render(this.renderer);
  };

  /* ── Resize ──────────────────────────────────────────────────────── */

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.resize(w / h);
  };

  /* ── Helpers ─────────────────────────────────────────────────────── */

  private createSkyGradient(stops: { stop: number; color: string }[]): CanvasTexture {
    this.skyCanvas = document.createElement("canvas");
    this.skyCanvas.width = 2;
    this.skyCanvas.height = 512;
    const ctx = this.skyCanvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    for (const s of stops) {
      gradient.addColorStop(s.stop, s.color);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 512);
    this.skyTexture = new CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = SRGBColorSpace;
    return this.skyTexture;
  }

  private updateSkyGradient(stops: { stop: number; color: string }[]) {
    if (!this.skyCanvas) return;
    const ctx = this.skyCanvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    for (const s of stops) gradient.addColorStop(s.stop, s.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 512);
    this.skyTexture.needsUpdate = true;
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

    const nightW = this.dayNightCycle.getNightWeight();
    const dayW = this.dayNightCycle.getDayWeight();

    if (this.starfield) this.starfield.group.visible = nightW > 0.01;
    if (this.aurora) this.aurora.group.visible = nightW > 0.01;
    if (this.playerLight) this.playerLight.intensity = nightW * 0.8;
    if (this.lensFlare) this.lensFlare.setColorScale([
      p.flareColorScale[0] * dayW,
      p.flareColorScale[1] * dayW,
      p.flareColorScale[2] * dayW,
    ]);

    const mw = this.dayNightCycle.getMusicWeights();
    this.audioManager.setWeights(mw.day, mw.evening, mw.night);
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
    this.starfield?.dispose();
    this.aurora?.dispose();
    this.ringManager?.dispose();
    this.collectVFX?.dispose();
    this.localPlayer?.dispose();
    this.globe?.dispose();
    this.renderer?.dispose();
    this.landmarkHUD?.dispose();
    this.packageQuest?.dispose();
    this.packageQuestHUD?.dispose();
    this.stateSync?.stop();
    this.socketClient?.disconnect();
    this.audioManager.dispose();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("resize", this.onPreviewResize);
    this.removeLoadingOverlay();
  }
}
