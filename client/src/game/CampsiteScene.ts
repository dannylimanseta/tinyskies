import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  SpotLight,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Points,
  MathUtils,
} from "three";
import { getSkyPreset, type SkyPreset } from "./SkyPresets";
import type { Vehicle } from "@globefly/shared";
import { createBiplane } from "./BiplaneMesh";
import { createBoat } from "./BoatMesh";
import { createCarpet } from "./CarpetMesh";
import { PilotAvatar } from "./PilotAvatar";
import { CampsiteControls, type CampsiteControlState } from "./CampsiteControls";
import { addRimLight, globalRimColor } from "./RimLight";

const CAMP_SIZE = 50;
const CAMP_HALF = CAMP_SIZE / 2;
const CAM_HEIGHT = 9.1;
const CAM_BACK = 8.2;
const CAM_LERP = 4;
const GRASS_COUNT = 360000;
const GRASS_CLUSTER_COUNT = 5200;
const FIRE_EXCLUSION_R2 = 0.64;
const BLADE_H = 0.3;

const TREE_RING_INNER = 9;
const TREE_RING_OUTER = 24;
/** Ground Y for teardrop canopies (lower = trees sit closer to turf). */
const CAMPSITE_TREE_BASE_Y = -0.24;
const LEAVES_PER_TREE = 11;
const LEAF_DISC_RADIUS = 0.09;

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
  float h  = vUv.y;             // 0 = base, 1 = tip
  float cx = vUv.x - 0.5;      // centred, -0.5 .. 0.5

  /* Multi-frequency flicker: deforms the silhouette edge */
  float f1   = sin(uTime * 7.0  + h * 5.5 + vUv.x * 3.0) * 0.05;
  float f2   = sin(uTime * 13.0 + h * 9.0 + vUv.x * 5.0) * 0.025;
  float lean = sin(uTime * 2.4) * 0.06 * h;   /* whole flame leans */
  float x    = cx - lean + f1 + f2;

  /* Width: wide at base, tapers to a sharp tip */
  float halfW = 0.42 * pow(max(0.0, 1.0 - h), 0.6);
  float edge  = halfW * 0.45;
  float mask  = 1.0 - smoothstep(halfW - edge, halfW + edge, abs(x));

  /* Fade: pointed at top, soft at base (starts above logs) */
  float tipFade  = 1.0 - smoothstep(0.68, 1.0, h);
  float baseFade = smoothstep(0.0, 0.18, h);

  /* Per-layer alpha low enough that 3 additive layers don't blow out */
  float alpha = mask * tipFade * baseFade * 0.35;

  /* Color: deep red at base → orange mid → warm amber at tip */
  vec3 baseCol = vec3(0.82, 0.10, 0.0);
  vec3 midCol  = vec3(1.0,  0.34, 0.04);
  vec3 tipCol  = vec3(1.0,  0.58, 0.12);

  vec3 col = mix(baseCol, midCol, smoothstep(0.0,  0.5,  h));
  col      = mix(col,     tipCol, smoothstep(0.38, 0.88, h));

  gl_FragColor = vec4(col, alpha);
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

/* ── Campfire glow-halo shaders ──────────────────────────── */

const glowVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Radial warm-orange gradient disc rendered additively on the ground. */
const glowFrag = /* glsl */ `
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;           // 0 at centre, 1 at rim
  float a = (1.0 - smoothstep(0.0, 1.0, d));
  a = pow(a, 1.3) * uIntensity;                 // lower pow = wider spread

  vec3 innerCol = vec3(1.0, 0.50, 0.06);        // vivid orange core
  vec3 outerCol = vec3(0.80, 0.12, 0.01);        // deep ember red rim
  vec3 col = mix(innerCol, outerCol, smoothstep(0.05, 0.68, d));

  gl_FragColor = vec4(col, a);
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
varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;

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

  vNormal = normalize(normalMatrix * normal);

  #ifdef USE_INSTANCING
    vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
    vViewPosition = mvPos.xyz;
    vWorldPos = (instanceMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPos;
  #else
    vec4 mvPos2 = modelViewMatrix * vec4(pos, 1.0);
    vViewPosition = mvPos2.xyz;
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPos2;
  #endif
}
`;

const grassFrag = /* glsl */ `
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;
uniform vec3 uHemiSkyColor;
uniform vec3 uHemiGroundColor;
uniform float uHemiIntensity;
uniform float uCampHalf;
uniform vec3 uRimColor;
uniform float uRimIntensity;
uniform float uRimPower;

varying vec3 vColor;
varying float vHeight;
varying float vFaceSun;
varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;

void main() {
  float ao = 1.0;

  float skyMix = clamp(vHeight * 0.62 + 0.18, 0.0, 1.0);
  vec3 hemi = mix(uHemiGroundColor, uHemiSkyColor, skyMix) * uHemiIntensity;

  vec3 ambient = uAmbientColor * uAmbientIntensity;
  vec3 sun = uSunColor * uSunIntensity * vFaceSun;
  vec3 lighting = ambient * 0.55 + hemi * 0.42 + sun * 0.52;
  lighting = clamp(lighting, 0.06, 1.35);

  vec3 col = vColor * ao * lighting;

  vec3 rimViewDir = normalize(vViewPosition);
  vec3 rimN = normalize(vNormal);
  float rimFresnel = 1.0 - abs(dot(rimViewDir, rimN));
  col += uRimColor * uRimIntensity * pow(rimFresnel, uRimPower);

  float alpha = smoothstep(0.0, 0.55, vHeight);
  float radial = length(vWorldPos.xz) / max(uCampHalf, 0.001);
  float edgeFade = 1.0 - smoothstep(0.68, 0.98, radial);
  alpha *= edgeFade;
  alpha *= 0.1;
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
  private fireSpots: SpotLight[] = [];
  private hemiLight: HemisphereLight;
  private ambientLight: AmbientLight;
  private sunLight: DirectionalLight;
  /** Key / fill / rim rig aligned with main globe preview (`Game.initPreview`). */
  private fillLight: DirectionalLight;
  private backLight: DirectionalLight;
  private sun2Light: DirectionalLight;
  private fill2Light: DirectionalLight;

  private groundMat: MeshLambertMaterial;

  private readonly lightingColorA = new Color();
  private readonly lightingColorB = new Color();

  private flameMat: ShaderMaterial;
  private emberMat: ShaderMaterial;
  private glowMat: ShaderMaterial;
  private grassWindTime = { value: 0 };
  /** Shared clock for campsite canopy sway (vertex shader). */
  private treeSwayTime = { value: 0 };
  private time = 0;

  private camTarget = new Vector3();
  private camPos = new Vector3(0, CAM_HEIGHT, CAM_BACK);

  private skyCanvas: HTMLCanvasElement;
  private skyTexture: CanvasTexture;

  private groundGeo: PlaneGeometry;
  private groundMesh: Mesh;
  private groundAlphaMap: CanvasTexture;
  private grassShaderMat: ShaderMaterial | null = null;

  private mobile: boolean;

  private rimMaterialsDone = new WeakSet<MeshPhongMaterial>();

  constructor(
    aspect: number,
    mobile: boolean,
    container: HTMLElement,
  ) {
    this.mobile = mobile;
    this.camera = new PerspectiveCamera(55, aspect, 0.1, 100);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(0, 0.4, 0);

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
    this.groundMat = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      alphaMap: this.groundAlphaMap,
      depthWrite: false,
      /* Yellow–green turf tint; vertex colors add variation. Tuned in `updateLighting`. */
      color: 0x92b882,
    });
    this.patchGroundFlattenLighting();
    this.groundMesh = new Mesh(this.groundGeo, this.groundMat);
    this.groundMesh.renderOrder = -1;
    this.scene.add(this.groundMesh);

    /* ── Sitting log ─────────────────────────────────── */
    this.addSittingLog();

    /* ── Tent (left of campfire, door faces camera / +Z) ── */
    const tentGroup = buildTent();
    tentGroup.position.set(-4.0, 0, -2.2);
    tentGroup.rotation.y = Math.PI * 0.58;
    this.scene.add(tentGroup);

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

    /* ── Lighting (three-point + hemisphere, matches globe rig) ── */
    this.hemiLight = new HemisphereLight(0x80ccdd, 0x337755, 0.6);
    this.scene.add(this.hemiLight);

    this.ambientLight = new AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambientLight);

    this.sunLight = new DirectionalLight(0xfff4e6, 1.0);
    this.sunLight.position.set(5, 10, 3);
    this.sunLight.castShadow = true;
    {
      const shadowRes = mobile ? 1024 : 2048;
      this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
      this.sunLight.shadow.camera.near = 0.5;
      this.sunLight.shadow.camera.far = 90;
      const span = CAMP_HALF + 8;
      this.sunLight.shadow.camera.left = -span;
      this.sunLight.shadow.camera.right = span;
      this.sunLight.shadow.camera.top = span;
      this.sunLight.shadow.camera.bottom = -span;
      this.sunLight.shadow.bias = -0.00045;
      this.sunLight.shadow.normalBias = 0.028;
      this.sunLight.shadow.radius = 2.2;
    }
    this.scene.add(this.sunLight);

    this.fillLight = new DirectionalLight(0x90bbcc, 0.5);
    this.fillLight.position.set(-8, -5, -10);
    this.scene.add(this.fillLight);

    this.backLight = new DirectionalLight(0xaaddee, 0.4);
    this.backLight.position.set(-3, 10, -6);
    this.scene.add(this.backLight);

    this.sun2Light = new DirectionalLight(0xfff0d0, 0.4);
    this.sun2Light.position.set(-10, -12, -5);
    this.scene.add(this.sun2Light);

    this.fill2Light = new DirectionalLight(0x90bbcc, 0.35);
    this.fill2Light.position.set(8, -8, -10);
    this.scene.add(this.fill2Light);

    this.scene.fog = new Fog(0x60ccde, 15, 40);

    /* ── Campfire ────────────────────────────────────── */
    const fireGroup = buildCampfire();
    this.scene.add(fireGroup);

    this.fireLight = new PointLight(0xff6622, 3.5, 20);
    this.fireLight.position.set(0, 0.55, 0);
    this.scene.add(this.fireLight);

    /* ── Radial fire shadow spots ────────────────────── */
    // 4 low-angle SpotLights aimed outward from the fire create long radial
    // shadows on the ground (PointLight cube shadows are unreliable in Three.js).
    if (!mobile) {
      const SPOT_N = 4;
      for (let i = 0; i < SPOT_N; i++) {
        const a = (i / SPOT_N) * Math.PI * 2;
        const spot = new SpotLight(0xff6622, 4.0, 22, Math.PI / 3, 0.5, 1.5);
        spot.position.set(0, 3, 0);
        spot.target.position.set(Math.cos(a) * 8, 0, Math.sin(a) * 8);
        spot.castShadow = true;
        spot.shadow.mapSize.set(1024, 1024);
        spot.shadow.camera.near = 0.5;
        spot.shadow.camera.far = 22;
        spot.shadow.bias = -0.0005;
        spot.shadow.normalBias = 0.02;
        spot.shadow.radius = 4;
        this.scene.add(spot);
        this.scene.add(spot.target);
        this.fireSpots.push(spot);
      }
    }

    /* ── Campfire glow halo (additive radial disc on ground) ─ */
    const glowGeo = new PlaneGeometry(11, 11);
    glowGeo.rotateX(-Math.PI / 2);
    this.glowMat = new ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      uniforms: { uIntensity: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const glowMesh = new Mesh(glowGeo, this.glowMat);
    glowMesh.position.set(0, 0.02, 0);
    glowMesh.renderOrder = 1;
    this.scene.add(glowMesh);

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

    this.configureShadowMeshes();

    this.applyRimToCampsiteMeshes();
    this.updateLighting(getSkyPreset("day"));
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
    this.treeSwayTime.value = this.time;

    const firePulse = Math.sin(this.time * 5.0) * 0.55 + Math.sin(this.time * 8.3) * 0.30;
    this.fireLight.intensity = 3.5 + firePulse;
    for (const spot of this.fireSpots) spot.intensity = 4.0 + firePulse * 0.6;
    const pulseN = firePulse / 0.85;
    this.glowMat.uniforms.uIntensity.value = 0.68 + pulseN * 0.16;

    if (this.vehicleClone && this.vehicleClone.userData.propeller) {
      this.vehicleClone.userData.propeller.rotation.z -= 15 * dt;
    }

    const state = this.controls.getState();
    this.avatar.update(dt, state.moveX, state.moveZ, TREE_RING_INNER * 2, state.jump);

    const ap = this.avatar.group.position;
    this.camTarget.set(ap.x, 0.42, ap.z);
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
    this.scene.fog = null;
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
      const noise = Math.sin(x * 2.3 + z * 1.7) * 0.025
        + Math.cos(x * 1.1 - z * 3.1) * 0.018
        + Math.sin(x * 4.5 - z * 0.7) * 0.012;
      const rim = Math.max(0, (radial - 0.5) / 0.5);
      const campfireBlend = Math.max(0, 1 - dist / 1.5);

      /* Warm yellow–green turf (slightly higher R vs pure green). */
      let r = 0.23 + noise * 0.48;
      let g = 0.54 + noise * 0.86;
      let b = 0.13 + noise * 0.33;

      r *= 1 - rim * 0.14;
      g *= 1 - rim * 0.1;
      b *= 1 - rim * 0.14;
      r *= 1 - campfireBlend * 0.14;
      g *= 1 - campfireBlend * 0.12;
      b *= 1 - campfireBlend * 0.14;

      const pathBlend = Math.max(0, 1 - Math.abs(z - 0.6) / 0.6)
        * Math.max(0, 1 - Math.abs(x + 1.8) / 1.8);
      r += pathBlend * 0.012;
      g -= pathBlend * 0.01;
      b += pathBlend * 0.006;

      const darken = 0.99;
      colors[i * 3] = Math.max(0, Math.min(1, r * darken));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, g * darken));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, b * darken));
    }
    this.groundGeo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  }

  /**
   * Lambert is already matte (no specular). This further damps directional contrast by
   * blending the lit output toward the vertex albedo so the pad doesn’t blow out pale.
   */
  private patchGroundFlattenLighting() {
    const mat = this.groundMat;
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `vec3 _alb = diffuseColor.rgb;
#ifdef USE_COLOR
  _alb *= vColor;
#endif
gl_FragColor.rgb = mix(_alb, gl_FragColor.rgb, 0.68);
#include <dithering_fragment>`,
      );
    };
    mat.needsUpdate = true;
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
    const TIP_START = 0.58;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const t = y / BLADE_H;
      let width: number;
      if (t <= TIP_START) {
        width = Math.cos(t * Math.PI * 0.5);
      } else {
        const u = (t - TIP_START) / (1 - TIP_START);
        const wBase = Math.cos(TIP_START * Math.PI * 0.5);
        width = wBase * Math.cos(u * Math.PI * 0.5);
      }
      posAttr.setX(i, posAttr.getX(i) * Math.max(0.04, width));
    }
    posAttr.needsUpdate = true;
    bladeGeo.computeVertexNormals();

    const bladeColors = new Float32Array(posAttr.count * 3);
    /* Darker than before; hue aligned with `colorGround()` mid turf (~0.23 / 0.54 / 0.13). */
    const br = 0.27;
    const bg = 0.5;
    const bb = 0.12;
    for (let i = 0; i < posAttr.count; i++) {
      bladeColors[i * 3] = br;
      bladeColors[i * 3 + 1] = bg;
      bladeColors[i * 3 + 2] = bb;
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
        uHemiSkyColor: { value: new Vector3(0.5, 0.8, 0.86) },
        uHemiGroundColor: { value: new Vector3(0.4, 0.66, 0.27) },
        uHemiIntensity: { value: 1.25 },
        uCampHalf: { value: CAMP_HALF },
        uRimColor: { value: globalRimColor },
        uRimIntensity: { value: 0.28 },
        uRimPower: { value: 3.0 },
      },
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    });

    const grassMesh = new InstancedMesh(bladeGeo, this.grassShaderMat, GRASS_COUNT);
    const dummy = new Object3D();

    const maxR = CAMP_HALF - 1.0;
    const maxR2 = maxR * maxR;

    const clusters: { cx: number; cz: number; rad: number }[] = [];
    let clusterAttempts = 0;
    while (clusters.length < GRASS_CLUSTER_COUNT && clusterAttempts < 120000) {
      clusterAttempts++;
      const angle = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * maxR;
      const cx = Math.cos(angle) * rr;
      const cz = Math.sin(angle) * rr;
      const d2 = cx * cx + cz * cz;
      if (d2 < FIRE_EXCLUSION_R2) continue;
      const dist = Math.sqrt(d2);
      const radial = dist / CAMP_HALF;
      const clusterEdgeFade = 1.0 - Math.max(0, Math.min(1, (radial - 0.62) / 0.34));
      if (Math.random() > 0.15 + clusterEdgeFade * 0.85) continue;
      clusters.push({
        cx,
        cz,
        rad: 0.18 + Math.random() * 0.42,
      });
    }
    while (clusters.length < GRASS_CLUSTER_COUNT) {
      const angle = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * maxR;
      const cx = Math.cos(angle) * rr;
      const cz = Math.sin(angle) * rr;
      if (cx * cx + cz * cz < FIRE_EXCLUSION_R2) continue;
      clusters.push({
        cx,
        cz,
        rad: 0.18 + Math.random() * 0.42,
      });
    }

    const n = clusters.length;
    const basePer = Math.floor(GRASS_COUNT / n);
    const extra = GRASS_COUNT % n;

    let placed = 0;
    for (let ci = 0; ci < n; ci++) {
      const c = clusters[ci]!;
      const count = basePer + (ci < extra ? 1 : 0);
      for (let k = 0; k < count; k++) {
        let x = c.cx;
        let z = c.cz;
        for (let attempt = 0; attempt < 14; attempt++) {
          const a = Math.random() * Math.PI * 2;
          const rr = c.rad * Math.sqrt(Math.random());
          x = c.cx + Math.cos(a) * rr;
          z = c.cz + Math.sin(a) * rr;
          const d2 = x * x + z * z;
          if (d2 >= FIRE_EXCLUSION_R2 && d2 <= maxR2) break;
        }

        const dx = x - c.cx;
        const dz = z - c.cz;
        const distInCluster = Math.sqrt(dx * dx + dz * dz);
        const edgeT = Math.min(1, distInCluster / Math.max(0.001, c.rad));
        const clusterShrink = 1.0 - 0.58 * Math.pow(edgeT, 1.2);

        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        const sx = (0.8 + Math.random() * 0.7) * clusterShrink;
        const sy = (0.6 + Math.random() * 0.8) * clusterShrink;
        dummy.scale.set(sx, sy, 1);
        dummy.updateMatrix();
        grassMesh.setMatrixAt(placed, dummy.matrix);
        placed++;
      }
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

  /**
   * Ring of teardrop canopies only (no trunks) — **not** shared with the globe.
   * Sway is applied in `attachCampsiteTreeSway` after rim compile.
   */
  private addTrees() {
    const treeGeo = createTeardropGeo(1, 1);
    const leafShades = [0x449a3e, 0x4fa84a, 0x429038, 0x368a32, 0x2a7020];

    const TREE_COUNT = 175;
    const placed: {
      x: number;
      z: number;
      rotY: number;
      scale: number;
      canopyScale: number;
    }[] = [];
    const MIN_SPACING = 1.38;
    let attempts = 0;

    while (placed.length < TREE_COUNT && attempts < 9000) {
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

      const scale = (1.2 + Math.random() * 1.0) * 0.7;
      const canopyScale = scale * 0.8;
      const rotY = Math.random() * Math.PI * 2;
      placed.push({ x, z, rotY, scale, canopyScale });

      const shade = leafShades[Math.floor(Math.random() * leafShades.length)]!;
      const leafMat = new MeshPhongMaterial({
        color: shade,
        vertexColors: true,
        flatShading: true,
      });
      leafMat.userData.campsiteTreeSway = true;

      const canopy = new Mesh(treeGeo, leafMat);
      canopy.position.set(x, CAMPSITE_TREE_BASE_Y, z);
      canopy.scale.set(canopyScale, scale * 2.0, canopyScale);
      canopy.rotation.y = rotY;
      this.scene.add(canopy);
    }

    /* Surface leaf discs (instanced): use MeshBasicMaterial so Three r172 batching/instancing applies;
       vertical fade via onBeforeCompile (custom ShaderMaterial broke instance transforms). */
    const leafDiscGeo = new CircleGeometry(LEAF_DISC_RADIUS, 7);
    const leafDiscMat = new MeshBasicMaterial({
      color: 0xaef0a4,
      transparent: true,
      opacity: 0.05,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    leafDiscMat.onBeforeCompile = (shader) => {
      shader.uniforms.uLeafRadius = { value: LEAF_DISC_RADIUS };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nvarying float vLeafY;\n",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLeafY = position.y;\n",
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        "#include <common>\nvarying float vLeafY;\nuniform float uLeafRadius;\n",
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        /^(\t*)vec4 diffuseColor = vec4\( diffuse, opacity \);/m,
        `$1vec4 diffuseColor = vec4( diffuse, opacity );
$1float ny = (vLeafY + uLeafRadius) / (2.0 * uLeafRadius);
$1diffuseColor.a *= (1.0 - smoothstep(0.06, 1.0, ny));`,
      );
    };

    const nInst = placed.length * LEAVES_PER_TREE;
    const leafInst = new InstancedMesh(leafDiscGeo, leafDiscMat, nInst);
    leafInst.frustumCulled = false;
    leafInst.castShadow = false;
    leafInst.receiveShadow = false;

    const base = new Object3D();
    const dummy = new Object3D();
    const matWorld = new Matrix4();
    const lp = new Vector3();
    const ln = new Vector3();
    let ii = 0;
    for (const p of placed) {
      const sy = p.scale * 2.0;
      base.position.set(p.x, CAMPSITE_TREE_BASE_Y, p.z);
      base.rotation.set(0, p.rotY, 0);
      base.scale.set(p.canopyScale, sy, p.canopyScale);
      base.updateMatrix();

      for (let k = 0; k < LEAVES_PER_TREE; k++) {
        sampleTeardropSurfaceLocal(lp, ln, Math.random);
        dummy.position.copy(lp);
        dummy.position.addScaledVector(ln, 0.028);
        /* Circle lies in XY with +Z normal; align +Z to analytic surface normal */
        dummy.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), ln);
        dummy.rotateZ((Math.random() - 0.5) * 1.4);
        const s = 0.62 + Math.random() * 0.55;
        dummy.scale.set(s, s * 1.12, 1);
        dummy.updateMatrix();
        matWorld.multiplyMatrices(base.matrix, dummy.matrix);
        leafInst.setMatrixAt(ii++, matWorld);
      }
    }
    leafInst.instanceMatrix.needsUpdate = true;
    this.scene.add(leafInst);
  }

  /** Gentle wind sway on Phong canopies; must run after `addRimLight` on the same material. */
  private attachCampsiteTreeSway(mat: MeshPhongMaterial) {
    const rimCompile = mat.onBeforeCompile!.bind(mat);
    mat.onBeforeCompile = (shader, renderer) => {
      rimCompile(shader, renderer);
      if (shader.vertexShader.includes("campsite_tree_sway")) return;
      shader.uniforms.swayTime = this.treeSwayTime;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
uniform float swayTime;
// campsite_tree_sway`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float swayHeight = position.y;
vec4 wp = modelMatrix * vec4(position, 1.0);
float swayPhase = wp.x * 2.4 + wp.z * 2.1;
float sway = sin(swayTime * 1.25 + swayPhase) * 0.088 * swayHeight * swayHeight;
float sway2 = cos(swayTime * 0.9 + swayPhase * 0.72) * 0.07 * swayHeight * swayHeight;
transformed.x += sway;
transformed.z += sway2;`,
      );
    };
    mat.needsUpdate = true;
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
    this.ambientLight.intensity = preset.ambientIntensity * 0.88;

    this.sunLight.color.set(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;

    this.fillLight.color.set(preset.fillColor);
    this.fillLight.intensity = preset.fillIntensity;

    this.backLight.color.set(preset.backColor);
    this.backLight.intensity = preset.backIntensity;

    this.sun2Light.color.set(preset.sun2Color);
    this.sun2Light.intensity = preset.sun2Intensity;

    this.fill2Light.color.set(preset.fill2Color);
    this.fill2Light.intensity = preset.fill2Intensity;

    globalRimColor.set(preset.rimColor);

    const sunT = MathUtils.clamp((preset.sunIntensity - 1.0) / 2.5, 0, 1);
    /* Warm yellow–green turf multiply. */
    this.lightingColorA.set(0x5c7a50);
    this.lightingColorB.set(0x96d090);
    this.groundMat.color.copy(this.lightingColorA).lerp(this.lightingColorB, sunT);

    /* Emissive: anchor to a yellow–green, then let hemisphere nudge. */
    this.lightingColorA.set(0x5cb058);
    this.lightingColorB.set(preset.hemiGroundColor);
    const emissiveAmp = MathUtils.clamp(
      0.042 + preset.sunIntensity * 0.03,
      0.034,
      0.115,
    );
    this.groundMat.emissive
      .copy(this.lightingColorA)
      .lerp(this.lightingColorB, 0.45)
      .multiplyScalar(emissiveAmp);

    const fog = this.scene.fog;
    if (fog instanceof Fog) {
      fog.color.set(preset.fogColor);
      fog.near = preset.fogNear;
      fog.far = preset.fogFar;
    }

    if (this.grassShaderMat) {
      const u = this.grassShaderMat.uniforms;
      this.lightingColorA.set(preset.sunColor);
      u.uSunColor.value.set(
        this.lightingColorA.r,
        this.lightingColorA.g,
        this.lightingColorA.b,
      );
      u.uSunIntensity.value = preset.sunIntensity;
      this.lightingColorA.set(preset.ambientColor);
      u.uAmbientColor.value.set(
        this.lightingColorA.r,
        this.lightingColorA.g,
        this.lightingColorA.b,
      );
      u.uAmbientIntensity.value = preset.ambientIntensity;
      this.lightingColorA.set(preset.hemiSkyColor);
      this.lightingColorB.set(preset.hemiGroundColor);
      u.uHemiSkyColor.value.set(
        this.lightingColorA.r,
        this.lightingColorA.g,
        this.lightingColorA.b,
      );
      u.uHemiGroundColor.value.set(
        this.lightingColorB.r,
        this.lightingColorB.g,
        this.lightingColorB.b,
      );
      u.uHemiIntensity.value = preset.hemiIntensity;
      u.uSunDir.value.copy(this.sunLight.position).normalize();
    }
  }

  /**
   * Primary directional casts VSM shadows (see `Game` renderer). Phong meshes cast; ground (Lambert) receives.
   * Grass uses `ShaderMaterial` and does not cast. On mobile, `Game` may disable `shadowMap` entirely.
   */
  private configureShadowMeshes() {
    this.groundMesh.receiveShadow = true;
    this.scene.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshPhongMaterial) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /**
   * Fresnel rim on campsite Phong materials (trees, campfire, avatar — not the ground plane).
   * Skips the parked vehicle subtree — those meshes already use `addRimLight` in their builders.
   */
  private applyRimToCampsiteMeshes() {
    const underVehicle = (o: Object3D): boolean => {
      const v = this.vehicleClone;
      if (!v) return false;
      let p: Object3D | null = o;
      while (p) {
        if (p === v) return true;
        p = p.parent;
      }
      return false;
    };

    this.scene.traverse((obj) => {
      if (underVehicle(obj)) return;
      if (!(obj instanceof Mesh) && !(obj instanceof InstancedMesh)) return;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!(mat instanceof MeshPhongMaterial)) continue;
        if (this.rimMaterialsDone.has(mat)) continue;
        this.rimMaterialsDone.add(mat);
        addRimLight(mat, globalRimColor, 0.48, 3.0);
        if (mat.userData.campsiteTreeSway) {
          this.attachCampsiteTreeSway(mat);
        }
      }
    });
  }
}

/* ── Stylised A-frame tent (hand-built vertices, no gaps) ── */

function buildTent(): Group {
  const tent = new Group();

  const halfLen = 1.0;
  const peakY = 1.25;
  const baseHZ = 0.92;

  /*
   *  Vertex layout (looking from +X toward −X):
   *
   *         peak (y=peakY, z=0)
   *        / \
   *       /   \
   *      /     \
   *     BL-----BR   (y=0, z=±baseHZ)
   *
   *  Front = +X end, Back = −X end.
   *  Ridge runs along X at y=peakY, z=0.
   */

  /* ── Roof + back wall as one watertight mesh ─────────────── */
  const verts = new Float32Array([
    /* Left roof (2 tris): BL_back → BL_front → peak_front, BL_back → peak_front → peak_back */
    -halfLen, 0, -baseHZ,   halfLen, 0, -baseHZ,   halfLen, peakY, 0,
    -halfLen, 0, -baseHZ,   halfLen, peakY, 0,     -halfLen, peakY, 0,
    /* Right roof (2 tris) */
     halfLen, 0,  baseHZ,  -halfLen, 0,  baseHZ,  -halfLen, peakY, 0,
     halfLen, 0,  baseHZ,  -halfLen, peakY, 0,      halfLen, peakY, 0,
    /* Back wall triangle (closed) */
    -halfLen, 0, -baseHZ,  -halfLen, peakY, 0,     -halfLen, 0, baseHZ,
  ]);
  const roofGeo = new BufferGeometry();
  roofGeo.setAttribute("position", new BufferAttribute(verts, 3));
  roofGeo.computeVertexNormals();

  const canvasMat = new MeshPhongMaterial({
    color: 0xe8d5b8,
    flatShading: true,
    side: DoubleSide,
  });
  tent.add(new Mesh(roofGeo, canvasMat));

  /* ── Ridge pole ────────────────────────────────────────── */
  const poleLen = halfLen * 2 + 0.3;
  const poleGeo = new CylinderGeometry(0.028, 0.028, poleLen, 4);
  const woodMat = new MeshPhongMaterial({ color: 0x6b4c30, flatShading: true });
  const pole = new Mesh(poleGeo, woodMat);
  pole.rotation.z = Math.PI / 2;
  pole.position.y = peakY + 0.02;
  tent.add(pole);

  /* ── Support sticks (X-frame at each end) ──────────────── */
  const stickLen = peakY + 0.35;
  const stickGeo = new CylinderGeometry(0.02, 0.016, stickLen, 4);
  for (const xSign of [-1, 1] as const) {
    for (const zLean of [-0.22, 0.22]) {
      const stick = new Mesh(stickGeo, woodMat);
      stick.position.set(xSign * halfLen, stickLen * 0.42, 0);
      stick.rotation.x = zLean;
      stick.rotation.z = xSign * zLean * 0.35;
      tent.add(stick);
    }
  }

  /* ── Ground blanket spilling out the front ─────────────── */
  const blanketGeo = new BoxGeometry(1.2, 0.018, baseHZ * 1.25);
  const blanketMat = new MeshPhongMaterial({ color: 0x7a9cc6, flatShading: true });
  const blanket = new Mesh(blanketGeo, blanketMat);
  blanket.position.set(halfLen * 0.45, 0.009, 0);
  tent.add(blanket);

  return tent;
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

/** Same profile as `LatheGeometry` points for surface sampling. */
function teardropProfileRadius(t: number, radius: number): number {
  return radius * Math.pow(Math.sin(t * Math.PI), 0.35) * Math.pow(1 - t, 0.5);
}

function teardropProfileRadiusDeriv(t: number, radius: number): number {
  const h = 1e-4;
  const t0 = Math.max(0, t - h);
  const t1 = Math.min(1, t + h);
  return (
    (teardropProfileRadius(t1, radius) - teardropProfileRadius(t0, radius)) /
    (t1 - t0 + 1e-12)
  );
}

/**
 * Surface of revolution P(t,θ) = (r(t)cos θ, y(t), r(t)sin θ), y = t on unit teardrop.
 * Outward normal ∝ (y′ cos θ, −r′, y′ sin θ) from ∂P/∂t × ∂P/∂θ with y′ = 1.
 */
function sampleTeardropSurfaceLocal(
  outPos: Vector3,
  outNormal: Vector3,
  rnd: () => number,
): void {
  const t = 0.12 + rnd() * 0.76;
  const y = t;
  const r = teardropProfileRadius(t, 1);
  const theta = rnd() * Math.PI * 2;
  const inward = 0.93;
  outPos.set(r * Math.cos(theta) * inward, y, r * Math.sin(theta) * inward);

  const drDt = teardropProfileRadiusDeriv(t, 1);
  const dyDt = 1.0;
  let nx = dyDt * Math.cos(theta);
  let ny = -drDt;
  let nz = dyDt * Math.sin(theta);
  outNormal.set(nx, ny, nz);
  if (outNormal.lengthSq() < 1e-10) {
    outNormal.set(Math.cos(theta), 0.35, Math.sin(theta)).normalize();
  } else {
    outNormal.normalize();
  }
}

function createTeardropGeo(height: number, radius: number): LatheGeometry {
  const segments = 10;
  const points: Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * height;
    const r = teardropProfileRadius(t, radius);
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
