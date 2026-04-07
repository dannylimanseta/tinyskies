import {
  Scene,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
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
import { getVehicleFeatures, type Vehicle, type VehicleGameFeatures, type WorldConfig, type TimeOfDay } from "@globefly/shared";
import { getSkyPreset, type SkyPreset } from "./SkyPresets";
import { Globe } from "./Globe";
import { Plane } from "./Plane";
import { Boat } from "./Boat";
import { Carpet } from "./Carpet";
import { FlightControls } from "./FlightControls";
import { CameraRig } from "./CameraRig";
import { SocketClient } from "../network/SocketClient";
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
import { Lobby } from "../ui/Lobby";
import { HUD } from "../ui/HUD";
import { LandmarkHUD } from "../ui/LandmarkHUD";
import { LandmarkRegistry, LandmarkDetector } from "./Landmarks";

export class Game {
  private container: HTMLElement;
  private renderer!: WebGLRenderer;
  private scene!: Scene;
  private clock!: Clock;

  private globe!: Globe;
  private localPlayer!: Plane | Boat | Carpet;
  private controls!: FlightControls;
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

  private running = false;
  private worldConfig: WorldConfig | null = null;
  private playerName = "Pilot";
  private playerVehicle: Vehicle = "plane";
  private timeOfDay: TimeOfDay = "day";
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

  constructor(container: HTMLElement) {
    this.container = container;
  }

  start() {
    this.lobby = new Lobby(this.container, {
      onCreateWorld: (name, texture) => this.handleCreateWorld(name, texture),
      onJoinWorld: (slug, playerName, vehicle, timeOfDay) =>
        this.handleJoinWorld(slug, playerName, vehicle, timeOfDay),
    });
    this.lobby.show();
  }

  private async handleCreateWorld(name: string, texture: string) {
    const serverUrl = this.getServerUrl();
    try {
      const res = await fetch(`${serverUrl}/api/worlds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, texture, createdBy: this.playerName }),
      });
      const world: WorldConfig = await res.json();
      this.lobby.showShareUrl(world.slug);
    } catch (err) {
      console.error("Failed to create world:", err);
      this.lobby.showError("Failed to create world. Is the server running?");
    }
  }

  private async handleJoinWorld(
    slug: string,
    playerName: string,
    vehicle: Vehicle = "plane",
    timeOfDay: TimeOfDay = "day",
  ) {
    this.playerName = playerName || "Pilot";
    this.playerVehicle = vehicle;
    this.timeOfDay = timeOfDay;
    const serverUrl = this.getServerUrl();

    try {
      const res = await fetch(`${serverUrl}/api/worlds/${slug}`);
      if (!res.ok) throw new Error("World not found");
      this.worldConfig = await res.json();
    } catch (err) {
      console.error("Failed to fetch world:", err);
      this.lobby.showError("World not found. Check the URL and try again.");
      return;
    }

    this.lobby.hide();
    this.initScene();
    this.initNetworking(slug);
    this.running = true;
    this.tick();
  }

  private initScene() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const globeRadius = this.worldConfig?.globeRadius ?? 5;
    this.vehicleFeatures = getVehicleFeatures(this.playerVehicle);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = VSMShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    const preset = getSkyPreset(this.timeOfDay);
    this.scene.background = this.createSkyGradient(preset.skyGradient);
    this.scene.fog = new Fog(preset.fogColor, preset.fogNear, preset.fogFar);
    this.clock = new Clock();

    this.hemiLight = new HemisphereLight(preset.hemiSkyColor, preset.hemiGroundColor, preset.hemiIntensity);
    this.scene.add(this.hemiLight);
    this.ambientLight = new AmbientLight(preset.ambientColor, preset.ambientIntensity);
    this.scene.add(this.ambientLight);
    this.sunLight = new DirectionalLight(preset.sunColor, preset.sunIntensity);
    this.sunLight.position.set(10, 12, 5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
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
    this.globe = new Globe(globeRadius, seed, terrainType, preset.atmosphereGlow, preset.oceanShallow, preset.oceanDeep, preset.oceanFoam, preset.rimColor, preset.cloudOpacity);
    this.globe.addTo(this.scene);

    if (this.playerVehicle === "boat") {
      this.localPlayer = new Boat(globeRadius, seed, terrainType);
    } else if (this.playerVehicle === "carpet") {
      this.localPlayer = new Carpet(globeRadius, seed, terrainType);
    } else {
      this.localPlayer = new Plane(globeRadius);
    }
    this.localPlayer.addTo(this.scene);

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

    const surfaceNormal = playerWorldPos.clone().normalize();
    this.introStartPos.copy(surfaceNormal).multiplyScalar(14);

    this.cameraRig.setPositionAndLookAt(this.introStartPos, new Vector3(0, 0, 0));
    this.introActive = true;
    this.introTimer = 0;

    this.controls = new FlightControls(this.container);

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

    if (this.timeOfDay === "day") {
      this.lensFlare = new LensFlare();
      this.lensFlare.setColorScale(preset.flareColorScale);
    }

    if (preset.stars) {
      this.starfield = new Starfield();
      this.scene.add(this.starfield.group);

      this.playerLight = new PointLight(0xffaa55, 0.8, 4.0, 1.5);
      this.scene.add(this.playerLight);
    }

    if (preset.aurora) {
      this.aurora = new Aurora();
      this.scene.add(this.aurora.group);
    }

    const ringMode = this.playerVehicle === "boat"
      ? "boat"
      : this.playerVehicle === "carpet"
        ? "carpet"
        : "plane";
    this.ringManager = new RingManager(globeRadius, {
      mode: ringMode,
      seed,
      terrainType,
    });
    this.ringManager.setConsumerActive(this.vehicleFeatures.collectibleDiamonds);
    this.scene.add(this.ringManager.group);

    this.collectVFX = new RingCollectVFX();
    this.scene.add(this.collectVFX.group);

    this.ringManager.onCollect = (xp, worldPos, tier) => {
      const rolling =
        this.vehicleFeatures.barrelRollBonus && this.localPlayer.isRolling;
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
    this.hud.setVehicle(this.playerVehicle, {
      showXpProgression: this.vehicleFeatures.xpProgressionUI,
    });
    this.hud.hideUI();

    const landmarkRegistry = new LandmarkRegistry();
    landmarkRegistry.registerVillages(this.globe.villageCenters, seed);
    this.landmarkDetector = new LandmarkDetector(landmarkRegistry);
    this.landmarkHUD = new LandmarkHUD(this.hud.root);
    this.landmarkDetector.onEnter = (lm) => this.landmarkHUD.show(lm.name, lm.type);
    this.landmarkDetector.onExit = () => this.landmarkHUD.hide();

    window.addEventListener("resize", this.onResize);
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

    this.socketClient.joinWorld(slug, this.playerName, this.playerVehicle);

    this.stateSync = new StateSync(this.socketClient, this.localPlayer);
    this.stateSync.start();
  }

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

      const pos = new Vector3().lerpVectors(this.introStartPos, this.introEndPos, t);
      const lookAt = new Vector3().lerpVectors(new Vector3(0, 0, 0), this.introEndLookAt, t);
      const rollZ = 0.5 * (1 - t);
      this.cameraRig.setPositionAndLookAt(pos, lookAt, rollZ);

      this.globe.update(dt);
      this.remotePlanes.update(dt, this.cameraRig.camera);
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

    const { turnRate, forward, brake, elevate, barrelRoll } = this.controls.getState();
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

    // Update globe (cloud drift)
    this.globe.update(dt);

    // Update remote planes
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

    this.hud.setSpeed(this.localPlayer.speed);
    this.hud.setAltitude(this.localPlayer.altitude);

    this.landmarkDetector.update(this.localPlayer.qPosition);

    this.lensFlare?.update(this.cameraRig.camera);
    this.aurora?.update(dt, this.cameraRig.camera);

    // Render
    this.renderer.render(this.scene, this.cameraRig.camera);
    if (this.vehicleFeatures.speedLines) {
      this.speedLines.render(this.renderer);
    }
    this.lensFlare?.render(this.renderer);
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.resize(w / h);
  };

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

  private getServerUrl(): string {
    return (
      (import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3001"
    );
  }

  dispose() {
    this.running = false;
    this.controls?.dispose();
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
    this.stateSync?.stop();
    this.socketClient?.disconnect();
    window.removeEventListener("resize", this.onResize);
  }
}
