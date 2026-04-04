import {
  Scene,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Clock,
  Color,
  Fog,
  VSMShadowMap,
  CanvasTexture,
  SRGBColorSpace,
} from "three";
import type { Vehicle, WorldConfig } from "@globefly/shared";
import { Globe } from "./Globe";
import { Plane } from "./Plane";
import { Boat } from "./Boat";
import { FlightControls } from "./FlightControls";
import { CameraRig } from "./CameraRig";
import { SocketClient } from "../network/SocketClient";
import { StateSync } from "../network/StateSync";
import { RemotePlaneManager } from "./RemotePlane";
import { SpeedLines } from "./SpeedLines";
import { Contrails } from "./Contrails";
import { WakeTrail } from "./WakeTrail";
import { LensFlare } from "./LensFlare";
import { RingManager } from "./Rings";
import { RingCollectVFX } from "./RingCollectVFX";
import { Lobby } from "../ui/Lobby";
import { HUD } from "../ui/HUD";

export class Game {
  private container: HTMLElement;
  private renderer!: WebGLRenderer;
  private scene!: Scene;
  private clock!: Clock;

  private globe!: Globe;
  /** Local player — plane or boat (same movement / sync shape). */
  private localPlayer!: Plane | Boat;
  private controls!: FlightControls;
  private cameraRig!: CameraRig;
  private remotePlanes!: RemotePlaneManager;
  private speedLines!: SpeedLines;
  private contrails!: Contrails;
  private wakeTrail!: WakeTrail;
  private lensFlare!: LensFlare;
  private ringManager!: RingManager;
  private collectVFX!: RingCollectVFX;

  private socketClient: SocketClient | null = null;
  private stateSync: StateSync | null = null;
  private lobby!: Lobby;
  private hud!: HUD;

  private running = false;
  private worldConfig: WorldConfig | null = null;
  private playerName = "Pilot";
  private playerVehicle: Vehicle = "plane";

  constructor(container: HTMLElement) {
    this.container = container;
  }

  start() {
    this.lobby = new Lobby(this.container, {
      onCreateWorld: (name, texture) => this.handleCreateWorld(name, texture),
      onJoinWorld: (slug, playerName, vehicle) =>
        this.handleJoinWorld(slug, playerName, vehicle),
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
  ) {
    this.playerName = playerName || "Pilot";
    this.playerVehicle = vehicle;
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

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = VSMShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = this.createSkyGradient();
    this.scene.fog = new Fog(0xa0d8f0, 15, 40);
    this.clock = new Clock();

    // Bright even lighting across the whole globe
    const hemi = new HemisphereLight(0x99ccff, 0x66aa44, 1.4);
    this.scene.add(hemi);
    const ambient = new AmbientLight(0xffffff, 1.0);
    this.scene.add(ambient);
    const sun = new DirectionalLight(0xfff0d0, 3.0);
    sun.position.set(10, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 30;
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.radius = 4;
    sun.shadow.blurSamples = 16;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const fill = new DirectionalLight(0xaabbdd, 1.0);
    fill.position.set(-8, -5, -10);
    this.scene.add(fill);
    const back = new DirectionalLight(0xccddee, 0.8);
    back.position.set(-3, 10, -6);
    this.scene.add(back);

    const seed = this.worldConfig?.seed ?? 42;
    const terrainType = this.worldConfig?.terrainType ?? "default";
    this.globe = new Globe(globeRadius, seed, terrainType);
    this.globe.addTo(this.scene);

    if (this.playerVehicle === "boat") {
      this.localPlayer = new Boat(globeRadius, seed, terrainType);
    } else {
      this.localPlayer = new Plane(globeRadius);
    }
    this.localPlayer.addTo(this.scene);

    this.cameraRig = new CameraRig(w / h);
    this.cameraRig.snapTo(
      this.localPlayer.qPosition,
      this.localPlayer.heading,
      this.localPlayer.altitude,
      globeRadius,
    );

    this.controls = new FlightControls(this.container);

    this.remotePlanes = new RemotePlaneManager(this.scene, globeRadius);

    this.speedLines = new SpeedLines();

    this.contrails = new Contrails();
    this.scene.add(this.contrails.group);

    this.wakeTrail = new WakeTrail();
    this.scene.add(this.wakeTrail.group);

    this.lensFlare = new LensFlare();

    this.ringManager = new RingManager(globeRadius);
    this.scene.add(this.ringManager.group);

    this.collectVFX = new RingCollectVFX();
    this.scene.add(this.collectVFX.group);

    this.ringManager.onCollect = (xp, worldPos, tier) => {
      const rolling =
        this.localPlayer.vehicle === "plane" && this.localPlayer.isRolling;
      const bonusXP = rolling ? xp : 0;
      if (bonusXP > 0) {
        this.ringManager.sessionXP += bonusXP;
        this.ringManager.level = this.ringManager.getLevel();
      }
      this.collectVFX.play(worldPos, tier);
      this.cameraRig.shake();
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

    this.hud = new HUD(this.container);
    this.hud.setWorldName(this.worldConfig?.name ?? "Unknown World");
    this.hud.setVehicle(this.playerVehicle);

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

  private tick = () => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const globeRadius = this.worldConfig?.globeRadius ?? 5;

    const { turnRate, forward, brake, elevate, barrelRoll } = this.controls.getState();
    this.localPlayer.update(dt, turnRate, forward, brake, elevate, barrelRoll);

    const cameraTiltScale = this.localPlayer.vehicle === "boat" ? 0.28 : 1;
    this.cameraRig.update(
      dt,
      this.localPlayer.qPosition,
      this.localPlayer.heading,
      this.localPlayer.altitude,
      globeRadius,
      turnRate,
      this.localPlayer.speedRatio,
      cameraTiltScale,
    );

    // Update globe (cloud drift)
    this.globe.update(dt);

    // Update remote planes
    this.remotePlanes.update(dt);

    // Update rings and collection VFX
    this.ringManager.update(dt, this.localPlayer.qPosition, this.localPlayer.altitude);
    this.collectVFX.update(dt);

    this.localPlayer.group.updateMatrixWorld(true);
    if (this.localPlayer.vehicle === "plane") {
      this.speedLines.update(dt, this.localPlayer.speed, this.cameraRig.camera);
      this.contrails.update(this.localPlayer.group.matrixWorld, this.cameraRig.camera);
    } else {
      this.wakeTrail.update(this.localPlayer.group.matrixWorld, this.cameraRig.camera);
    }

    this.hud.setSpeed(this.localPlayer.speed);
    this.hud.setAltitude(this.localPlayer.altitude);

    this.lensFlare.update(this.cameraRig.camera);

    // Render
    this.renderer.render(this.scene, this.cameraRig.camera);
    if (this.localPlayer.vehicle === "plane") {
      this.speedLines.render(this.renderer);
    }
    this.lensFlare.render(this.renderer);
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.resize(w / h);
  };

  private createSkyGradient(): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0.0, "#0a1e4a");
    gradient.addColorStop(0.1, "#12306e");
    gradient.addColorStop(0.2, "#1c4a90");
    gradient.addColorStop(0.3, "#2866b0");
    gradient.addColorStop(0.4, "#3580cc");
    gradient.addColorStop(0.5, "#4898dc");
    gradient.addColorStop(0.6, "#60b0ea");
    gradient.addColorStop(0.7, "#78c4f2");
    gradient.addColorStop(0.8, "#90d4f8");
    gradient.addColorStop(0.9, "#a8e0fc");
    gradient.addColorStop(1.0, "#c0ecff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 512);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
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
    this.ringManager?.dispose();
    this.collectVFX?.dispose();
    this.localPlayer?.dispose();
    this.globe?.dispose();
    this.renderer?.dispose();
    this.stateSync?.stop();
    this.socketClient?.disconnect();
    window.removeEventListener("resize", this.onResize);
  }
}
