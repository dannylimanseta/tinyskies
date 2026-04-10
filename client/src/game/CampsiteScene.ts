import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  BufferGeometry,
  Points,
} from "three";
import type { SkyPreset } from "./SkyPresets";
import type { Vehicle } from "@globefly/shared";
import { createBiplane } from "./BiplaneMesh";
import { createBoat } from "./BoatMesh";
import { createCarpet } from "./CarpetMesh";
import { PilotAvatar } from "./PilotAvatar";
import { CampsiteControls, type CampsiteControlState } from "./CampsiteControls";

const CAMP_SIZE = 50;
const CAMP_HALF = CAMP_SIZE / 2;
const CAM_HEIGHT = 11;
const CAM_BACK = 9;
const CAM_LERP = 4;
const GRASS_COUNT = 360000;
const BLADE_H = 0.3;

const TREE_RING_INNER = 10;
const TREE_RING_OUTER = 22;

/* ── Flame billboard shaders ─────────────────────────────── */

const flameVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPos.xy += position.xy;
  gl_Position = projectionMatrix * mvPos;
}
`;

const flameFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float d = length(uv - vec2(0.5, 0.3));
  float flicker = sin(uTime * 8.0 + uv.x * 6.0) * 0.05 + sin(uTime * 12.0) * 0.03;
  vec3 core = vec3(1.0, 0.9, 0.3);
  vec3 mid = vec3(1.0, 0.5, 0.05);
  vec3 edge = vec3(0.8, 0.15, 0.0);
  float t = smoothstep(0.0, 0.4, d + flicker);
  vec3 col = mix(core, mid, t);
  col = mix(col, edge, smoothstep(0.3, 0.6, d + flicker));
  float alpha = 1.0 - smoothstep(0.2, 0.55 + flicker, d);
  alpha *= smoothstep(0.95, 0.7, uv.y);
  gl_FragColor = vec4(col * 2.0, alpha);
}
`;

/* ── Ember particle shaders ──────────────────────────────── */

const emberVert = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying float vAlpha;
void main() {
  float t = mod(uTime * 0.5 + aPhase, 1.0);
  vec3 p = position;
  p.y += t * 2.5;
  p.x += sin(t * 6.28 + aPhase * 10.0) * 0.2;
  p.z += cos(t * 6.28 + aPhase * 7.0) * 0.2;
  vAlpha = (1.0 - t) * (1.0 - t);
  vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.0 - t) * 6.0;
  gl_Position = projectionMatrix * mvPos;
}
`;

const emberFrag = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  vec3 col = vec3(1.0, 0.6, 0.1);
  gl_FragColor = vec4(col * 2.0, vAlpha * (1.0 - d) * 0.8);
}
`;

/* ── Grass shaders ───────────────────────────────────────── */

const grassVert = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;

attribute vec3 color;

varying vec3 vColor;
varying float vHeight;
varying float vFaceSun;

void main() {
  vColor = color;

  vec3 pos = position;
  float heightRatio = clamp(pos.y / ${BLADE_H.toFixed(2)}, 0.0, 1.0);
  vHeight = heightRatio;

  #ifdef USE_INSTANCING
    vec3 instPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec3 instPos = vec3(0.0);
  #endif

  float phase = instPos.x * 0.5 + instPos.z * 0.3 + instPos.x * instPos.z * 0.07;
  float bend = heightRatio * heightRatio;

  float wind1 = sin(uTime * 1.2 + phase) * 0.12;
  float wind2 = sin(uTime * 2.5 + phase * 1.8) * 0.06;
  float gust  = sin(uTime * 0.4 + instPos.x * 0.08) * 0.08;
  float windZ = cos(uTime * 1.8 + phase * 0.7) * 0.05;

  pos.x += (wind1 + wind2 + gust) * bend;
  pos.z += windZ * bend;

  vec3 bent = normalize(vec3(
    (wind1 + wind2 + gust) * 2.0 * heightRatio,
    1.0,
    windZ * 2.0 * heightRatio
  ));
  vFaceSun = max(0.0, dot(bent, uSunDir));

  #ifdef USE_INSTANCING
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  #else
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  #endif
}
`;

const grassFrag = /* glsl */ `
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;

varying vec3 vColor;
varying float vHeight;
varying float vFaceSun;

void main() {
  float ao = 0.6 + 0.4 * vHeight;

  vec3 ambient = uAmbientColor * uAmbientIntensity;
  vec3 sun = uSunColor * uSunIntensity * vFaceSun;
  vec3 lighting = ambient + sun * 0.5;
  lighting = clamp(lighting, 0.08, 1.2);

  vec3 col = vColor * ao * lighting;

  float alpha = smoothstep(0.0, 0.35, vHeight);
  gl_FragColor = vec4(col, alpha);
}
`;

export class CampsiteScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private avatar: PilotAvatar;
  private controls: CampsiteControls;
  private vehicleClone: Group | null = null;

  private fireLight: PointLight;
  private hemiLight: HemisphereLight;
  private ambientLight: AmbientLight;
  private sunLight: DirectionalLight;

  private flameMat: ShaderMaterial;
  private emberMat: ShaderMaterial;
  private grassWindTime = { value: 0 };
  private time = 0;

  private camTarget = new Vector3();
  private camPos = new Vector3(0, CAM_HEIGHT, CAM_BACK);

  private skyCanvas: HTMLCanvasElement;
  private skyTexture: CanvasTexture;

  private groundGeo: PlaneGeometry;
  private groundAlphaMap: CanvasTexture;
  private grassShaderMat: ShaderMaterial | null = null;

  constructor(
    aspect: number,
    mobile: boolean,
    container: HTMLElement,
  ) {
    this.camera = new PerspectiveCamera(55, aspect, 0.1, 100);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(0, 0.5, 0);

    this.controls = new CampsiteControls(container, mobile);
    this.controls.enabled = false;

    this.avatar = new PilotAvatar();
    this.avatar.setPosition(0, 1);
    this.scene.add(this.avatar.group);

    /* ── Ground (circular fade via alphaMap) ──────────── */
    this.groundGeo = new PlaneGeometry(CAMP_SIZE, CAMP_SIZE, 48, 48);
    this.groundGeo.rotateX(-Math.PI / 2);
    this.displaceGround();
    this.colorGround();
    this.groundAlphaMap = createRadialAlphaMap();
    const groundMat = new MeshPhongMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      alphaMap: this.groundAlphaMap,
      depthWrite: false,
    });
    const ground = new Mesh(this.groundGeo, groundMat);
    ground.renderOrder = -1;
    this.scene.add(ground);

    /* ── Sitting log ─────────────────────────────────── */
    this.addSittingLog();

    /* ── Trees (teardrop — matches globe style) ──────── */
    this.addTrees();

    /* ── Instanced wind grass ────────────────────────── */
    this.addInstancedGrass();

    /* ── Sky ─────────────────────────────────────────── */
    this.skyCanvas = document.createElement("canvas");
    this.skyCanvas.width = 256;
    this.skyCanvas.height = 256;
    this.skyTexture = new CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = SRGBColorSpace;
    this.scene.background = this.skyTexture;

    /* ── Lighting ────────────────────────────────────── */
    this.hemiLight = new HemisphereLight(0x80ccdd, 0x337755, 0.6);
    this.scene.add(this.hemiLight);

    this.ambientLight = new AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambientLight);

    this.sunLight = new DirectionalLight(0xfff4e6, 1.0);
    this.sunLight.position.set(5, 10, 3);
    this.scene.add(this.sunLight);

    /* ── Campfire ────────────────────────────────────── */
    const fireGroup = buildCampfire();
    this.scene.add(fireGroup);

    this.fireLight = new PointLight(0xff6622, 2.5, 15);
    this.fireLight.position.set(0, 0.6, 0);
    this.scene.add(this.fireLight);

    /* ── Flame billboards ────────────────────────────── */
    this.flameMat = new ShaderMaterial({
      vertexShader: flameVert,
      fragmentShader: flameFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const flameGeo = new PlaneGeometry(0.5 + i * 0.1, 0.9 + i * 0.1);
      const flame = new Mesh(flameGeo, this.flameMat);
      flame.position.set(0, 0.55, 0);
      flame.rotation.y = (i / 3) * Math.PI;
      this.scene.add(flame);
    }

    /* ── Ember particles ─────────────────────────────── */
    const EMBER_COUNT = 20;
    const emberGeo = new BufferGeometry();
    const positions = new Float32Array(EMBER_COUNT * 3);
    const phases = new Float32Array(EMBER_COUNT);
    for (let i = 0; i < EMBER_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 1] = 0.3 + Math.random() * 0.3;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      phases[i] = Math.random();
    }
    emberGeo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    emberGeo.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));

    this.emberMat = new ShaderMaterial({
      vertexShader: emberVert,
      fragmentShader: emberFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const emberPoints = new Points(emberGeo, this.emberMat);
    emberPoints.frustumCulled = false;
    this.scene.add(emberPoints);
  }

  /* ── Scene lifecycle ───────────────────────────────────── */

  enter(
    vehicle: Vehicle,
    hullColor: number,
    preset: SkyPreset,
  ) {
    if (this.vehicleClone) {
      this.scene.remove(this.vehicleClone);
    }

    if (vehicle === "boat") {
      this.vehicleClone = createBoat(hullColor);
    } else if (vehicle === "carpet") {
      this.vehicleClone = createCarpet(hullColor);
    } else {
      this.vehicleClone = createBiplane(hullColor);
    }

    this.vehicleClone.scale.setScalar(vehicle === "carpet" ? 15.0 : 21.0);
    this.vehicleClone.position.set(4.5, vehicle === "carpet" ? 0.3 : 0.6, -2.0);
    this.vehicleClone.rotation.y = -0.4;
    this.scene.add(this.vehicleClone);

    this.avatar.setPosition(0, 1);
    this.updateSky(preset);
    this.updateLighting(preset);
    this.controls.enabled = true;
    this.time = 0;
  }

  exit() {
    this.controls.enabled = false;
  }

  update(dt: number): { takeOff: boolean } {
    this.time += dt;
    this.flameMat.uniforms.uTime.value = this.time;
    this.emberMat.uniforms.uTime.value = this.time;
    this.grassWindTime.value = this.time;

    this.fireLight.intensity = 2.5 + Math.sin(this.time * 5) * 0.5 + Math.sin(this.time * 8.3) * 0.3;

    const state = this.controls.getState();
    this.avatar.update(dt, state.moveX, state.moveZ, TREE_RING_INNER * 2);

    const ap = this.avatar.group.position;
    this.camTarget.set(ap.x, 0.5, ap.z);
    const desiredCam = new Vector3(
      ap.x,
      CAM_HEIGHT,
      ap.z + CAM_BACK,
    );
    this.camPos.lerp(desiredCam, CAM_LERP * dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    return { takeOff: state.takeOff };
  }

  updatePreset(preset: SkyPreset) {
    this.updateSky(preset);
    this.updateLighting(preset);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.avatar.dispose();
    this.controls.dispose();
    this.flameMat.dispose();
    this.emberMat.dispose();
    this.grassShaderMat?.dispose();
    this.groundGeo.dispose();
    this.groundAlphaMap.dispose();
    this.scene.traverse((child) => {
      if (child instanceof Mesh || child instanceof InstancedMesh) {
        child.geometry?.dispose();
        const mat = child.material;
        if (mat && "dispose" in mat) (mat as MeshPhongMaterial).dispose();
      }
    });
  }

  /* ── Internal ──────────────────────────────────────────── */

  private colorGround() {
    const posAttr = this.groundGeo.getAttribute("position");
    const count = posAttr.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const dist = Math.sqrt(x * x + z * z);
      const radial = dist / CAMP_HALF;
      const noise = Math.sin(x * 2.3 + z * 1.7) * 0.03
        + Math.cos(x * 1.1 - z * 3.1) * 0.02
        + Math.sin(x * 4.5 - z * 0.7) * 0.015;
      const rim = Math.max(0, (radial - 0.5) / 0.5);
      const campfireBlend = Math.max(0, 1 - dist / 1.5);

      let r = 0.28 + noise;
      let g = 0.52 + noise * 1.5;
      let b = 0.18 + noise * 0.5;

      r = r * (1 - rim * 0.3) * (1 - campfireBlend * 0.25);
      g = g * (1 - rim * 0.2) * (1 - campfireBlend * 0.2);
      b = b * (1 - rim * 0.3) * (1 - campfireBlend * 0.2);

      const pathBlend = Math.max(0, 1 - Math.abs(z - 0.6) / 0.6)
        * Math.max(0, 1 - Math.abs(x + 1.8) / 1.8);
      r += pathBlend * 0.08;
      g -= pathBlend * 0.04;
      b -= pathBlend * 0.02;

      colors[i * 3] = Math.max(0, Math.min(1, r));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, g));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, b));
    }
    this.groundGeo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  }

  private displaceGround() {
    const posAttr = this.groundGeo.getAttribute("position");
    const count = posAttr.count;
    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const dist = Math.sqrt(x * x + z * z);
      const noise = Math.sin(x * 0.5 + z * 0.4) * 0.12
        + Math.cos(x * 1.1 - z * 0.6) * 0.08
        + Math.sin(x * 0.2 + z * 0.9) * 0.06;
      const centerFlat = Math.max(0, 1 - dist / 4.0);
      const edgeDip = Math.max(0, (dist - CAMP_HALF * 0.7) / (CAMP_HALF * 0.3)) * -0.5;
      const y = noise * (1 - centerFlat) + edgeDip;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;
    this.groundGeo.computeVertexNormals();
  }

  private addInstancedGrass() {
    const BLADE_W = 0.14;
    const SEGS_Y = 8;
    const bladeGeo = new PlaneGeometry(BLADE_W, BLADE_H, 1, SEGS_Y);
    bladeGeo.translate(0, BLADE_H / 2, 0);

    const posAttr = bladeGeo.getAttribute("position");
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const t = y / BLADE_H;
      const roundedTaper = Math.cos(t * Math.PI * 0.5);
      posAttr.setX(i, posAttr.getX(i) * Math.max(0.05, roundedTaper));
    }
    posAttr.needsUpdate = true;
    bladeGeo.computeVertexNormals();

    const bladeColors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const t = y / BLADE_H;
      const tipBlend = Math.max(0, Math.min(1, (t - 0.5) / 0.3));
      bladeColors[i * 3] = 0.52 + tipBlend * 0.15;
      bladeColors[i * 3 + 1] = 0.78 + tipBlend * 0.14;
      bladeColors[i * 3 + 2] = 0.34 + tipBlend * 0.12;
    }
    bladeGeo.setAttribute("color", new Float32BufferAttribute(bladeColors, 3));

    this.grassShaderMat = new ShaderMaterial({
      vertexShader: grassVert,
      fragmentShader: grassFrag,
      uniforms: {
        uTime: this.grassWindTime,
        uSunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
        uSunColor: { value: new Vector3(1.0, 0.96, 0.9) },
        uSunIntensity: { value: 1.0 },
        uAmbientColor: { value: new Vector3(1.0, 1.0, 1.0) },
        uAmbientIntensity: { value: 0.3 },
      },
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    });

    const grassMesh = new InstancedMesh(bladeGeo, this.grassShaderMat, GRASS_COUNT);
    const dummy = new Object3D();
    let placed = 0;

    while (placed < GRASS_COUNT) {
      const angle = Math.random() * Math.PI * 2;
      const maxR = CAMP_HALF - 1.0;
      const r = Math.sqrt(Math.random()) * maxR;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      if (x * x + z * z < 0.64) continue;

      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(
        0.8 + Math.random() * 0.7,
        0.6 + Math.random() * 0.8,
        1,
      );
      dummy.updateMatrix();
      grassMesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    grassMesh.frustumCulled = false;
    this.scene.add(grassMesh);
  }

  private addSittingLog() {
    const logMat = new MeshPhongMaterial({ color: 0x5c3a1e, flatShading: true });
    const logGeo = new CylinderGeometry(0.22, 0.18, 1.8, 6);
    const log = new Mesh(logGeo, logMat);
    log.position.set(-2.2, 0.18, 0.8);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = 0.5;
    this.scene.add(log);

    const stumpGeo = new CylinderGeometry(0.24, 0.26, 0.4, 6);
    const stump1 = new Mesh(stumpGeo, logMat);
    stump1.position.set(-2.9, 0.2, 0.7);
    this.scene.add(stump1);

    const stump2 = new Mesh(stumpGeo, logMat);
    stump2.position.set(-1.5, 0.2, 0.9);
    this.scene.add(stump2);
  }

  private addTrees() {
    const treeGeo = createTeardropGeo(1, 1);
    const trunkGeo = new CylinderGeometry(0.06, 0.09, 1, 5);
    const trunkMat = new MeshPhongMaterial({ color: 0x6b4226, flatShading: true });
    const leafShades = [0x4a9a3a, 0x55a545, 0x48953a, 0x3a8a2a, 0x2d6b1e];

    const TREE_COUNT = 65;
    const placed: { x: number; z: number }[] = [];
    const MIN_SPACING = 2.0;
    let attempts = 0;

    while (placed.length < TREE_COUNT && attempts < 2000) {
      attempts++;
      const angle = Math.random() * Math.PI * 2;
      const r = TREE_RING_INNER + Math.random() * (TREE_RING_OUTER - TREE_RING_INNER);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      let tooClose = false;
      for (const p of placed) {
        const dx = x - p.x;
        const dz = z - p.z;
        if (dx * dx + dz * dz < MIN_SPACING * MIN_SPACING) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      placed.push({ x, z });

      const scale = 1.2 + Math.random() * 1.0;
      const trunkH = scale * 1.1;

      const trunk = new Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, trunkH * 0.45, z);
      trunk.scale.set(scale * 0.7, trunkH, scale * 0.7);
      this.scene.add(trunk);

      const shade = leafShades[Math.floor(Math.random() * leafShades.length)]!;
      const leafMat = new MeshPhongMaterial({
        color: shade,
        vertexColors: true,
        flatShading: true,
      });

      const canopy = new Mesh(treeGeo, leafMat);
      canopy.position.set(x, trunkH * 0.65, z);
      const canopyScale = scale * 0.8;
      canopy.scale.set(canopyScale, scale * 2.0, canopyScale);
      canopy.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(canopy);
    }
  }

  private updateSky(preset: SkyPreset) {
    const ctx = this.skyCanvas.getContext("2d")!;
    const S = 256;
    const gradient = ctx.createLinearGradient(0, 0, 0, S);
    const stops = preset.skyGradient;
    for (const s of stops) {
      gradient.addColorStop(1.0 - s.stop, s.color);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, S, S);
    this.skyTexture.needsUpdate = true;
  }

  private updateLighting(preset: SkyPreset) {
    this.hemiLight.color.set(preset.hemiSkyColor);
    this.hemiLight.groundColor.set(preset.hemiGroundColor);
    this.hemiLight.intensity = preset.hemiIntensity;

    this.ambientLight.color.set(preset.ambientColor);
    this.ambientLight.intensity = preset.ambientIntensity;

    this.sunLight.color.set(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;

    if (this.grassShaderMat) {
      const u = this.grassShaderMat.uniforms;
      const sc = new Color(preset.sunColor);
      u.uSunColor.value.set(sc.r, sc.g, sc.b);
      u.uSunIntensity.value = preset.sunIntensity;
      const ac = new Color(preset.ambientColor);
      u.uAmbientColor.value.set(ac.r, ac.g, ac.b);
      u.uAmbientIntensity.value = preset.ambientIntensity;
    }
  }
}

/* ── Campfire builder (level 0) ──────────────────────────── */

function buildCampfire(): Group {
  const group = new Group();

  const logMat = new MeshPhongMaterial({ color: 0x3a2210, flatShading: true });
  const charredMat = new MeshPhongMaterial({ color: 0x1a1008, flatShading: true });
  const logGeo = new CylinderGeometry(0.06, 0.05, 0.7, 5);

  for (let i = 0; i < 5; i++) {
    const log = new Mesh(logGeo, i < 3 ? charredMat : logMat);
    const angle = (i / 5) * Math.PI * 2;
    log.position.set(
      Math.cos(angle) * 0.18,
      0.12,
      Math.sin(angle) * 0.18,
    );
    log.rotation.z = Math.PI / 2 + (i * 0.2 - 0.4);
    log.rotation.y = angle + 0.3;
    group.add(log);
  }

  const stoneGeo = new SphereGeometry(0.1, 5, 3);
  const stoneColors = [0x707070, 0x5a5a5a, 0x686868, 0x606060];
  for (let i = 0; i < 10; i++) {
    const stoneMat = new MeshPhongMaterial({
      color: stoneColors[i % stoneColors.length]!,
      flatShading: true,
    });
    const stone = new Mesh(stoneGeo, stoneMat);
    const angle = (i / 10) * Math.PI * 2;
    const r = 0.38 + (Math.random() - 0.5) * 0.08;
    stone.position.set(
      Math.cos(angle) * r,
      0.04 + Math.random() * 0.02,
      Math.sin(angle) * r,
    );
    stone.scale.set(
      0.7 + Math.random() * 0.5,
      0.5 + Math.random() * 0.3,
      0.7 + Math.random() * 0.5,
    );
    stone.rotation.y = Math.random() * Math.PI;
    group.add(stone);
  }

  const pebbleGeo = new SphereGeometry(0.035, 4, 3);
  const pebbleMat = new MeshPhongMaterial({ color: 0x555555, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const pebble = new Mesh(pebbleGeo, pebbleMat);
    const angle = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 0.5;
    pebble.position.set(Math.cos(angle) * r, 0.015, Math.sin(angle) * r);
    pebble.scale.setScalar(0.5 + Math.random() * 1.0);
    group.add(pebble);
  }

  return group;
}

/* ── Teardrop tree geometry (matches globe trees) ────────── */

function createTeardropGeo(height: number, radius: number): LatheGeometry {
  const segments = 10;
  const points: Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * height;
    const r = radius * Math.pow(Math.sin(t * Math.PI), 0.35) * Math.pow(1 - t, 0.5);
    points.push(new Vector2(r, y));
  }
  const geo = new LatheGeometry(points, 6);

  const bottomColor = new Color(0.3, 0.55, 0.2);
  const topColor = new Color(0.7, 0.92, 0.6);
  const posAttr = geo.attributes.position;
  const count = posAttr.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const y = posAttr.getY(i);
    const t = Math.max(0, Math.min(1, y / height));
    const c = bottomColor.clone().lerp(topColor, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geo;
}

/* ── Radial alpha map for circular ground fade ───────────── */

function createRadialAlphaMap(): CanvasTexture {
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const cx = S / 2;
  const gradient = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  gradient.addColorStop(0.0, "#ffffff");
  gradient.addColorStop(0.75, "#ffffff");
  gradient.addColorStop(0.87, "#888888");
  gradient.addColorStop(0.94, "#222222");
  gradient.addColorStop(1.0, "#000000");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, S, S);
  return new CanvasTexture(canvas);
}
