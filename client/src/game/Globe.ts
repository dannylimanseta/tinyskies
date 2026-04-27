import {
  Mesh,
  InstancedMesh,
  SphereGeometry,
  PlaneGeometry,
  BoxGeometry,
  Box3,
  CylinderGeometry,
  MeshPhongMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  ShaderMaterial,
  BackSide,
  DoubleSide,
  AdditiveBlending,
  Group,
  Color,
  LatheGeometry,
  Vector2,
  Vector3,
  Matrix4,
  Object3D,
  MathUtils,
  Quaternion,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  BufferGeometry,
  BufferAttribute,
  Points,
  PointsMaterial,
  CanvasTexture,
  FrontSide,
  type Scene,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  MOONSTONE_FLOAT_MS,
  MOONSTONE_LOWER_MS,
  MOONSTONE_RAISE_MS,
  MOONSTONE_RUIN_COUNT,
} from "@globefly/shared";
import { addRimLight, addRimLightToStandard, addRimLightWithColor, globalRimColor } from "./RimLight";
import { MOON_APPROACH_DIR } from "./MoonThreat";
import { createNoise3D, sampleTerrain } from "./SimplexNoise";
import { PROP_TERRAIN_SINK, surfaceAltitudeAt, surfaceDisplacementAt, surfaceDisplacementFromValue } from "./TerrainSurface";
import { getVolcanoPlacementNormal, VOLCANO_COUNT } from "./Volcano";
import { ProgressionManager } from "./ProgressionManager";
import { createPackageQuestBeamGroup } from "./PackageQuest";

const ATMOSPHERE_VERTEX = `
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT = `
uniform vec3 glowColor;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec3 viewDir = normalize(-vPosition);
  float rim = 1.0 - dot(vNormal, viewDir);
  float inner = smoothstep(0.05, 0.5, rim);
  float outer = 1.0 - smoothstep(0.7, 1.0, rim);
  float intensity = inner * outer * pow(rim, 1.8) * 0.22;
  gl_FragColor = vec4(glowColor * intensity, intensity);
}
`;

const TREE_COUNT = 10000;
const ROCK_COUNT = 400;
const COCONUT_CLUSTERS = 270;
const VILLAGE_COUNT = 20;
const HOUSES_PER_VILLAGE = [8, 10, 12, 14, 16];
const CLOUD_COUNT = 30;
const CLOUD_ALTITUDE = 1.0;
const CLOUD_DRIFT_SPEED = 0.03;
const BALLOON_COUNT = 5;
const BALLOON_ALTITUDE = 0.6;
const WINDMILL_COUNT = 5;
const MOONSTONE_FLOAT_HEIGHT = 0.82;
const MOONSTONE_DUST_COUNT = 56;
const MOONSTONE_DUST_GRAVITY = 4.2;

/** Shared soft round alpha for moonstone dust Points; disposed in Globe.dispose(). */
let moonstoneDustSpriteTexture: CanvasTexture | null = null;

function getMoonstoneDustSpriteTexture(): CanvasTexture {
  if (moonstoneDustSpriteTexture) return moonstoneDustSpriteTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size * 0.5;
  const grd = ctx.createRadialGradient(c, c, 0, c, c, c - 0.5);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.75)");
  grd.addColorStop(0.72, "rgba(255,255,255,0.2)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  moonstoneDustSpriteTexture = tex;
  return tex;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Smallest projection of mesh vertices onto `normal` (world space). AABB corners can lie outside the mesh and skew grounding. */
function minMeshVertexProjectionAlongNormal(root: Object3D, normal: Vector3): number {
  let min = Infinity;
  const v = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i);
      v.applyMatrix4(mesh.matrixWorld);
      const d = v.dot(normal);
      if (d < min) min = d;
    }
  });
  return min;
}

type MoonstoneRuinPhase = "idle" | "raising" | "floating" | "lowering";

interface MoonstoneDustState {
  geometry: BufferGeometry;
  points: Points;
  position: Float32Array;
  velocity: Float32Array;
  life: Float32Array;
}

interface MoonstoneRuinState {
  normal: Vector3;
  tangent: Vector3;
  bitangent: Vector3;
  basePosition: Vector3;
  root: Object3D | null;
  cycleStartAt: number | null;
  restQuaternion: Quaternion;
  dust: MoonstoneDustState | null;
  /** Rim-lit phong materials on the moonstone halves. Collected so the
   * cinematic can boost `rimIntensity` during the combine beat. */
  rimMaterials: MeshPhongMaterial[];
  /** Shared uniform references so the cinematic can drive rim intensity live. */
  rimIntensityUniforms: { value: number }[];
}

/** Baseline rim intensity for the moonstone halves in normal gameplay. */
const MOONSTONE_RIM_INTENSITY_BASE = 0.7;

const BALLOON_SCHEMES: [number, number][] = [
  [0xcc2222, 0xf0d020],
  [0x1e5cb0, 0x5eb8e8],
  [0x228844, 0xd0e830],
  [0xe85520, 0xf5c040],
  [0x8822aa, 0xe868b0],
  [0xcc2255, 0xff8844],
  [0x1199aa, 0x88cc33],
];

export class Globe {
  readonly group = new Group();
  readonly radius: number;
  private seed: number;
  private terrainType: string;
  private surfaceMesh!: Mesh;
  private atmosphereMesh!: Mesh;
  private cloudRing = new Group();
  private cloudDriftAxis = new Vector3(0.2, 1, 0.1).normalize();
  private treeSwayUniforms: { value: number }[] = [];
  private oceanTime = { value: 0 };
  private atmosphereGlowColor: number;
  private atmosphereGlowUniform!: { value: Color };
  private oceanShallowColor: number;
  private oceanDeepColor: number;
  private foamColorValue: Color;
  /** Per vertex: ocean mix 0–1, or -1 for land (for day/night ocean recolor without re-sampling noise). */
  private vertexOceanDepth!: Float32Array;
  private rimColorValue: Color;
  private cloudOpacityValue: number;
  private cloudOpacityUniform!: { value: number };
  readonly villageCenters: { normal: Vector3; houseCount: number }[] = [];
  readonly lighthouseCenters: { normal: Vector3 }[] = [];
  private lighthouseBeams: Mesh[] = [];
  private lighthouseBeamTime = 0;
  /** Drives memorial statue sky-beacon shader pulse (Eternal Victory landmark). */
  private statueBeamTimeU = { value: 0 };
  readonly balloons: { pivot: Group; inner: Group; normal: Vector3; baseAlt: number; phase: number; wobbleAmp: number; wobblePhase: number; wobbleBank: number; }[] = [];
  /** Number of hot-air balloons (for proximity greeting logic). */
  readonly balloonCount = BALLOON_COUNT;
  private balloonTime = 0;
  readonly windmillCenters: { normal: Vector3 }[] = [];
  private windmillBlades: { pivot: Group; speed: number }[] = [];
  readonly observatoryCenters: { normal: Vector3 }[] = [];
  readonly stonehengeCenters: { normal: Vector3 }[] = [];
  readonly stonehengeGroups: Group[] = [];
  readonly shrineCenters: { normal: Vector3 }[] = [];
  readonly hotspringCenters: { normal: Vector3 }[] = [];
  readonly mushroomCenters: { normal: Vector3 }[] = [];
  readonly butterflyCenters: { normal: Vector3 }[] = [];
  /** Single GLB pyramid — one per world, inland lowlands (low elevation + flat), not hills. */
  readonly pyramidCenters: { normal: Vector3 }[] = [];
  /** Victory `statue.glb` — one inland flat site, away from pyramids. */
  readonly statueCenters: { normal: Vector3 }[] = [];
  /** True once the memorial model is in {@link group}. */
  private memorialStatueSpawned = false;
  /** True after we pick a site and start the GLTF load (prevents duplicate loads / centers). */
  private memorialStatueLoadStarted = false;
  /** Floating race start banners carried by balloons. */
  readonly raceBannerCenters: { normal: Vector3 }[] = [];
  private raceBanners: { pivot: Group; inner: Group; normal: Vector3; baseAlt: number; phase: number; }[] = [];
  private raceBannerMat: MeshPhongMaterial | null = null;
  private raceBannerTex: CanvasTexture | null = null;
  /** FINISH procedural banner — single material, back face uses a UV-flipped geometry clone. */
  private raceFinishBannerMat: MeshPhongMaterial | null = null;
  private raceFinishBannerTex: CanvasTexture | null = null;
  /** Buried moonstone ring halves — giant ruin props; two sites, far apart. */
  readonly moonstoneRuinCenters: { normal: Vector3 }[] = [];
  private moonstoneRuins: MoonstoneRuinState[] = [];
  /** While true, `update()` skips per-ruin positioning so the cinematic can author it. */
  private moonstoneCinematicActive = false;
  /** Latches true once both ruins enter floating; resets when both return to idle. */
  private moonstoneUnionConsumed = false;
  /** Persistent post-cutscene state: the completed moonstone ring hovers above the globe. */
  private moonstonePostUnionActive = false;
  private moonstonePostUnionPoint = new Vector3();
  private moonstonePostUnionAxis = new Vector3(0, 1, 0);
  private moonstonePostUnionQuats: Quaternion[] = [];

  private hotspringSteamInstanced: InstancedMesh | null = null;
  private shrineSparkleInstanced: InstancedMesh | null = null;
  private mushroomSporeInstanced: InstancedMesh | null = null;
  private butterflyInstanced: InstancedMesh | null = null;

  setLandmarkParticleOpacity(kind: "hotspring" | "shrine" | "mushroom" | "butterfly", index: number, opacity: number) {
    let instanced: InstancedMesh | null = null;
    let countPerSite = 0;
    
    if (kind === "hotspring") {
      instanced = this.hotspringSteamInstanced;
      countPerSite = 6; // STEAM_PER_SPRING
    } else if (kind === "shrine") {
      instanced = this.shrineSparkleInstanced;
      countPerSite = 40; // SPARKLES_PER_SHRINE
    } else if (kind === "mushroom") {
      instanced = this.mushroomSporeInstanced;
      countPerSite = 45; // SPORES_PER_GROVE
    } else if (kind === "butterfly") {
      instanced = this.butterflyInstanced;
      countPerSite = 25; // BUTTERFLIES_PER_GARDEN
    }
    
    if (!instanced) return;
    
    const opAttr = instanced.geometry.getAttribute("aOpacity") as InstancedBufferAttribute;
    if (!opAttr) return;
    
    const start = index * countPerSite;
    for (let i = 0; i < countPerSite; i++) {
      opAttr.setX(start + i, opacity);
    }
    opAttr.needsUpdate = true;
  }

  /** Shared teardrop geometry for shrine-tree InstancedMeshes (one buffer, many draws). */
  private shrineTeardropGeo: LatheGeometry | null = null;

  /** Floating tree clusters (panic-phase effect). */
  private floatingTreeMesh: InstancedMesh | null = null;   // single mesh → 1 draw call
  private floatingTreeData: {
    normal: Vector3;
    tangentOffset: Vector3;
    baseHeight: number;
    amp: number;
    speed: number;
    phase: number;
    quaternion: Quaternion;   // pre-computed: align Y→normal + random lean
    sizeVar: number;
  }[] = [];
  private readonly floatingTreeDummy   = new Object3D();
  private readonly floatingTreePosScratch = new Vector3();  // avoids per-frame allocation
  private readonly moonstoneEmitScratch = new Vector3();
  private floatingTreesActive          = false;             // skip updates when t=0
  private static readonly FT_CLUSTERS         = 28;   // forest-anchored clusters (impact-biased)
  private static readonly FT_PER_CLUSTER      = 40;   // base trees per forest cluster
  private static readonly FT_IMPACT_CLUSTERS  = 14;   // extra dense clusters right at impact zone
  private static readonly FT_IMPACT_PER       = 70;   // trees per impact cluster

  /** Shared material palette for all observatories (created once, reused across 3 instances). */
  private obsMaterials: {
    stone: MeshPhongMaterial; stoneDk: MeshPhongMaterial; dome: MeshPhongMaterial;
    slit: MeshPhongMaterial; window: MeshPhongMaterial; frame: MeshPhongMaterial;
    door: MeshPhongMaterial; step: MeshPhongMaterial; finder: MeshPhongMaterial;
  } | null = null;

  /** Shared material palette for all stonehenges. */
  private stonehengeMats: {
    sarsen: MeshPhongMaterial; lintel: MeshPhongMaterial; altar: MeshPhongMaterial;
  } | null = null;

  /** Torii / stone / wood + instanced teardrop canopy material for zen shrines. */
  private shrineMaterials: {
    torii: MeshPhongMaterial;
    stone: MeshPhongMaterial;
    wood: MeshPhongMaterial;
    roof: MeshPhongMaterial;
    accent: MeshPhongMaterial;
    tree: MeshPhongMaterial;
  } | null = null;

  private segments: number;

  private sharedGroundGlowMat: ShaderMaterial | null = null;

  private getSharedGroundGlowMat(): ShaderMaterial {
    if (!this.sharedGroundGlowMat) {
      this.sharedGroundGlowMat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          void main() {
            float dist = distance(vUv, vec2(0.5));
            float alpha = smoothstep(0.5, 0.0, dist);
            vec3 color = vec3(1.0, 0.6, 0.1); // Warm orange
            gl_FragColor = vec4(color, alpha * alpha * 0.4);
          }
        `
      });
    }
    return this.sharedGroundGlowMat;
  }

  constructor(radius: number = 5, seed: number = 42, terrainType: string = "default", atmosphereGlow: number = 0xeeddbb, oceanShallow: number = 0x2a8ca0, oceanDeep: number = 0x1560a0, foamColor: number = 0xb3ffff, rimColor: number = 0xffeebb, cloudOpacity: number = 0.2, segments: number = 256) {
    this.radius = radius;
    this.seed = seed;
    this.terrainType = terrainType;
    this.atmosphereGlowColor = atmosphereGlow;
    this.oceanShallowColor = oceanShallow;
    this.oceanDeepColor = oceanDeep;
    this.foamColorValue = new Color(foamColor);
    this.rimColorValue = new Color(rimColor);
    this.cloudOpacityValue = cloudOpacity;
    this.segments = segments;
    this.createSurface();
    this.createTrees();
    this.createCoconutTrees();
    this.createRocks();
    this.createVillages();
    this.createLighthouses();
    this.createWindmills();
    this.createObservatories();
    this.createStonehenges();
    this.createShrines();
    this.createHotsprings();
    this.createMushrooms();
    this.createButterflyGardens();
    this.createPyramid();
    this.createStatue();
    this.createMoonstoneRuins();
    this.createFloatingTreeClusters();
    this.createBalloons();
    this.createRaceBanners();
    this.createClouds();
    this.createAtmosphere();
  }

  private sampleTerrainAt(nx: number, ny: number, nz: number) {
    return sampleTerrain(this.seed, this.terrainType, nx, ny, nz);
  }

  private sampleTerrainForNormal(normal: Vector3) {
    return this.sampleTerrainAt(normal.x, normal.y, normal.z);
  }

  public waterRatioAround(normal: Vector3, sampleDist: number, checks: number): number {
    const tangent = new Vector3(-normal.y, normal.x, 0);
    if (tangent.lengthSq() < 0.001) tangent.set(0, -normal.z, normal.y);
    tangent.normalize();
    const bitangent = new Vector3().crossVectors(normal, tangent).normalize();
    let waterCount = 0;

    for (let c = 0; c < checks; c++) {
      const angle = (c / checks) * Math.PI * 2;
      const cn = normal.clone()
        .addScaledVector(tangent, Math.cos(angle) * sampleDist)
        .addScaledVector(bitangent, Math.sin(angle) * sampleDist)
        .normalize();
      if (!this.sampleTerrainForNormal(cn).isLand) {
        waterCount++;
      }
    }

    return waterCount / checks;
  }

  private createSurface() {
    const geo = new SphereGeometry(this.radius, this.segments, this.segments);
    const posAttr = geo.attributes.position;
    const vertexCount = posAttr.count;
    const colors = new Float32Array(vertexCount * 3);
    const oceanDepth = new Float32Array(vertexCount);

    const patchNoise = createNoise3D(this.seed + 555);

    const landColors = [
      new Color(0x3a7d2a), new Color(0x4a8f3f),
      new Color(0x5a9f4a), new Color(0x5e9a48),
    ];
    const warmPatchColors = [
      new Color(0x8a9a30), // yellow-green
      new Color(0xa89530), // golden
      new Color(0xb08828), // orange-brown
    ];
    const mountainColor = new Color(0xc4b07a);
    const snowColor = new Color(0xe8e8e0);
    const oceanShallow = new Color(this.oceanShallowColor);
    const oceanDeep = new Color(this.oceanDeepColor);

    for (let i = 0; i < vertexCount; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);

      const len = Math.sqrt(x * x + y * y + z * z);
      const nx = x / len;
      const ny = y / len;
      const nz = z / len;

      const terrain = this.sampleTerrainAt(nx, ny, nz);

      let color: Color;
      let displacement = 0;

      if (terrain.isLand) {
        const elevation = terrain.elevation;

        if (elevation > 0.7) {
          color = mountainColor.clone().lerp(snowColor, (elevation - 0.7) / 0.3);
        } else if (elevation > 0.4) {
          color = landColors[3].clone().lerp(mountainColor, (elevation - 0.4) / 0.3);
        } else {
          const t = Math.min(1, elevation * 2.5);
          const idx = Math.floor(t * (landColors.length - 2));
          const frac = t * (landColors.length - 2) - idx;
          color = landColors[idx].clone().lerp(landColors[Math.min(idx + 1, landColors.length - 2)], frac);

          const patch = patchNoise(nx * 4, ny * 4, nz * 4);
          if (patch > 0.2) {
            const patchT = Math.min(1, (patch - 0.2) * 2.5);
            const pIdx = Math.floor(patchT * (warmPatchColors.length - 1));
            const pFrac = patchT * (warmPatchColors.length - 1) - pIdx;
            const warmColor = warmPatchColors[pIdx].clone().lerp(
              warmPatchColors[Math.min(pIdx + 1, warmPatchColors.length - 1)], pFrac,
            );
            color.lerp(warmColor, patchT * 0.6);
          }
        }

        displacement = surfaceDisplacementFromValue(
          this.seed, this.terrainType, nx, ny, nz, terrain.value,
        );
        oceanDepth[i] = -1;
      } else {
        const depth = terrain.waterDepth;
        color = oceanShallow.clone().lerp(oceanDeep, depth);
        oceanDepth[i] = depth;
        displacement = surfaceDisplacementFromValue(
          this.seed, this.terrainType, nx, ny, nz, terrain.value,
        );
      }

      const newRadius = this.radius + displacement;
      posAttr.setXYZ(i, nx * newRadius, ny * newRadius, nz * newRadius);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    this.vertexOceanDepth = oceanDepth;

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geo.setAttribute("oceanDepth", new Float32BufferAttribute(oceanDepth, 1));

    const mat = new MeshPhongMaterial({
      vertexColors: true,
      shininess: 8,
      flatShading: true,
    });

    const rimColor = this.rimColorValue;
    const rimIntensity = 0.8;
    const rimPower = 8.5;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.oceanTime = this.oceanTime;
      shader.uniforms.rimColor = { value: rimColor };
      shader.uniforms.rimIntensity = { value: rimIntensity };
      shader.uniforms.rimPower = { value: rimPower };
      shader.uniforms.foamColor = { value: this.foamColorValue };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "uniform vec3 emissive;",
        `uniform vec3 emissive;
uniform float oceanTime;
uniform vec3 rimColor;
uniform float rimIntensity;
uniform float rimPower;
uniform vec3 foamColor;
varying vec3 vWorldPos;
varying float vOceanDepth;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        "varying vec3 vWorldPos;",
        `varying vec3 vWorldPos;
varying float vOceanDepth;
attribute float oceanDepth;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vOceanDepth = oceanDepth;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `if (vColor.b > vColor.r + vColor.g * 0.5) {
  gl_FragColor.rgb += vec3(0.04, 0.06, 0.10);

  vec3 wp = vWorldPos;
  
  // Coastline contour foam (using distance to land via vOceanDepth)
  if (vOceanDepth > 0.0 && vOceanDepth < 1.0) {
    // Create scrolling contour lines based on depth
    // Reduced frequency from 15.0 to 6.0 for fewer lines
    // Added noise to vOceanDepth to make the lines slightly irregular and wavy
    float noiseOffset = sin(wp.x * 12.0 + wp.z * 8.0 + oceanTime) * 0.03;
    float contour = fract((vOceanDepth + noiseOffset) * 6.0 - oceanTime * 0.8);
    
    // Thicker, softer lines: changed smoothstep bounds from (0.85, 0.95) to (0.7, 0.9)
    float line = smoothstep(0.7, 0.9, contour) * (1.0 - smoothstep(0.9, 1.0, contour));
    
    // Fade out as it gets deeper (fade to 0.0 much earlier)
    float depthFade = 1.0 - smoothstep(0.05, 0.35, vOceanDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, foamColor, line * depthFade * 0.9);
  }

  // Existing open ocean foam
  float w1 = sin(wp.x * 43.0 + wp.y * 27.0 + wp.z * 11.0 + oceanTime * 3.6) * 0.5 + 0.5;
  float w2 = sin(wp.y * 37.0 + wp.z * 53.0 + wp.x * 7.0 - oceanTime * 2.7) * 0.5 + 0.5;
  float w3 = sin(wp.z * 31.0 + wp.x * 19.0 + wp.y * 47.0 + oceanTime * 2.1) * 0.5 + 0.5;
  float w4 = sin(wp.x * 17.0 + wp.z * 29.0 - wp.y * 13.0 + oceanTime * 1.5) * 0.5 + 0.5;
  float w5 = sin(wp.y * 11.0 + wp.x * 59.0 + wp.z * 23.0 - oceanTime * 1.2) * 0.5 + 0.5;
  float w6 = sin(wp.z * 41.0 - wp.y * 7.0 + wp.x * 33.0 + oceanTime * 1.8) * 0.5 + 0.5;
  float w7 = sin(wp.x * 67.0 - wp.z * 43.0 + wp.y * 3.0 - oceanTime * 0.9) * 0.5 + 0.5;
  float foam = w1 * w2 * w4 * w6 + w3 * w5 * w7 * 0.3;
  foam = 1.0 - smoothstep(0.002, 0.015, foam);
  float shallowness = smoothstep(0.1, 0.22, vColor.r);
  gl_FragColor.rgb += foamColor * foam * mix(0.05, 1.0, shallowness);

  float sp1 = sin(wp.x * 40.0 + wp.y * 23.0 + wp.z * 9.0 + oceanTime * 3.5);
  float sp2 = sin(wp.y * 35.0 + wp.z * 29.0 + wp.x * 13.0 - oceanTime * 2.8);
  float sp3 = sin(wp.z * 27.0 + wp.x * 37.0 - wp.y * 17.0 + oceanTime * 4.1);
  float sp4 = sin(wp.x * 71.0 - wp.z * 47.0 + wp.y * 5.0 + oceanTime * 1.9);
  float sp5 = sin(wp.y * 59.0 + wp.x * 11.0 - wp.z * 31.0 - oceanTime * 2.3);
  float sparkleMask = sin(wp.x * 3.1 + wp.z * 4.7 + oceanTime * 0.25) * sin(wp.y * 5.3 - wp.x * 2.9 - oceanTime * 0.18);
  sparkleMask *= sin(wp.z * 2.3 + wp.y * 3.9 + oceanTime * 0.35);
  sparkleMask = smoothstep(0.15, 0.5, sparkleMask);
  float sparkle = sp1 * sp2 * sp3 * sp4 + sp2 * sp3 * sp5 * 0.5;
  float sparkleThresh = mix(0.7, 0.3, shallowness);
  sparkle = smoothstep(sparkleThresh, 0.97, sparkle) * sparkleMask;
  gl_FragColor.rgb += vec3(1.0, 1.0, 1.0) * sparkle * mix(0.6, 1.0, shallowness);
}
vec3 rimViewDir = normalize(vViewPosition);
vec3 rimNormal = normalize(normal);
float rimFresnel = 1.0 - abs(dot(rimViewDir, rimNormal));
vec3 rim = rimColor * rimIntensity * pow(rimFresnel, rimPower);
gl_FragColor.rgb += rim;
#include <dithering_fragment>`,
      );
    };
    mat.needsUpdate = true;
    this.surfaceMesh = new Mesh(geo, mat);
    this.surfaceMesh.receiveShadow = true;
    this.group.add(this.surfaceMesh);
  }

  private createTeardropGeo(height: number, radius: number): LatheGeometry {
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
      
      // Fake AO: Darken the bottom of the tree
      const ao = MathUtils.lerp(0.1, 1.0, Math.min(1, t * 2.0));
      c.multiplyScalar(ao);

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));

    return geo;
  }

  private createTrees() {
    const rand = seededRandom(42 + this.seed);
    const forestNoise = createNoise3D(this.seed + 999);

    const LAND_HEIGHT = 0.02;

    const greenShades = [0x4a9a3a, 0x55a545, 0x48953a, 0x8aaa35, 0xb59a30];
    const matsPerShade = greenShades.length;
    const treesPerShade = Math.ceil(TREE_COUNT / matsPerShade);

    const transforms: { matrix: Matrix4; shade: number }[] = [];
    const dummy = new Object3D();

    let attempts = 0;
    const maxAttempts = TREE_COUNT * 12;

    while (transforms.length < TREE_COUNT && attempts < maxAttempts) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);

      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;

      const elevation = terrain.elevation;
      if (elevation > 0.6) continue;

      const forest = forestNoise(nx * 2.5, ny * 2.5, nz * 2.5);
      if (forest < 0.3) continue;

      const displacement = surfaceDisplacementAt(this.seed, this.terrainType, nx, ny, nz);
      const surfaceRadius = this.radius + displacement - PROP_TERRAIN_SINK;

      const normal = new Vector3(nx, ny, nz);
      const surfacePos = normal.clone().multiplyScalar(surfaceRadius);
      const treeScale = MathUtils.lerp(0.025, 0.06, rand());
      const shade = Math.floor(rand() * matsPerShade);

      const treeH = treeScale * 2.5;
      const treeR = treeScale * 0.7;

      dummy.position.copy(surfacePos).addScaledVector(normal, -treeH * 0.05);
      dummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);
      dummy.scale.set(treeR, treeH, treeR);
      dummy.updateMatrix();

      transforms.push({ matrix: dummy.matrix.clone(), shade });
    }

    const sharedGeo = this.createTeardropGeo(1, 1);

    for (let s = 0; s < matsPerShade; s++) {
      const shadeTransforms = transforms.filter((t) => t.shade === s);
      if (shadeTransforms.length === 0) continue;

      const swayTime = { value: 0 };
      this.treeSwayUniforms.push(swayTime);

      const mat = new MeshPhongMaterial({
        color: greenShades[s],
        vertexColors: true,
        flatShading: true,
      });

      addRimLight(mat, 0xffeeaa, 0.7, 3.0);

      const rimCompile = mat.onBeforeCompile.bind(mat);
      mat.onBeforeCompile = (shader, renderer) => {
        rimCompile(shader, renderer);
        shader.uniforms.swayTime = swayTime;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          `#include <common>
uniform float swayTime;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float swayHeight = position.y;
vec4 worldPos = instanceMatrix * vec4(position, 1.0);
float swayPhase = worldPos.x * 3.0 + worldPos.z * 2.7;
float sway = sin(swayTime * 1.8 + swayPhase) * 0.8 * swayHeight * swayHeight;
float sway2 = cos(swayTime * 1.3 + swayPhase * 0.7) * 0.6 * swayHeight * swayHeight;
transformed.x += sway;
transformed.z += sway2;`,
        );
      };

      const instanced = new InstancedMesh(sharedGeo, mat, shadeTransforms.length);
      instanced.castShadow = true;
      instanced.receiveShadow = false;

      for (let i = 0; i < shadeTransforms.length; i++) {
        instanced.setMatrixAt(i, shadeTransforms[i].matrix);
      }
      instanced.instanceMatrix.needsUpdate = true;

      this.group.add(instanced);
    }
  }

  private createCoconutTreeGeo(): BufferGeometry {
    const trunkColor = new Color(0x6E4F24);
    const frondShadow = new Color(0x1A6B37).multiplyScalar(0.88);
    const frondHighlight = new Color(0x2D8A4E).multiplyScalar(0.88);
    const frondColor = frondShadow.clone().lerp(frondHighlight, 0.43);
    const frondLight = frondShadow.clone().lerp(frondHighlight, 0.57);
    const coconutColor = new Color(0x5D3A1A);

    const parts: { geo: BufferGeometry; color: Color }[] = [];

    const trunk = new CylinderGeometry(0.06, 0.09, 0.55, 8, 4);
    const tPos = trunk.attributes.position;
    for (let i = 0; i < tPos.count; i++) {
      const y = tPos.getY(i);
      const t = y / 0.55 + 0.5;
      tPos.setX(i, tPos.getX(i) + t * t * 0.04);
    }
    trunk.translate(0, 0.275, 0);
    trunk.computeVertexNormals();
    parts.push({ geo: trunk, color: trunkColor });

    const frondCount = 8;
    const tilts = [-0.9, -1.6, -1.0, -1.8, -0.95, -1.7, -1.0, -1.55];
    /** rotateX tilt scale — upper crown ring is stiffer */
    const droopLower = 0.48;
    const droopUpper = 0.2;
    const crownYBase = 0.52;
    const crownYShiftTop = 0.018;
    for (let i = 0; i < frondCount; i++) {
      // X = width, Y = thin (radial / trunk), Z = spine in tangent plane — broad face horizontal on the globe
      const frond = new SphereGeometry(0.205, 18, 14);
      const spineScale = 1.32;
      const widthScale = 0.55;
      frond.scale(widthScale, 0.38, spineScale);
      const fPos = frond.attributes.position;
      const zSpan = 0.205 * spineScale;
      const halfW = 0.205 * widthScale;
      for (let vi = 0; vi < fPos.count; vi++) {
        const x = fPos.getX(vi);
        const y = fPos.getY(vi);
        const z = fPos.getZ(vi);
        const z01 = MathUtils.clamp((z + zSpan * 0.5) / zSpan, 0, 1);
        const tip = Math.pow(z01, 1.75);
        const tipSharp = MathUtils.lerp(1.0, 0.62, tip);
        let nx = x * tipSharp;
        let ny = y * MathUtils.lerp(1.0, 0.55, tip);
        const nz = z;
        const edgeT = Math.min(1, Math.abs(nx) / halfW);
        ny += 0.052 * Math.sin(z01 * Math.PI) * (1 - 0.4 * Math.pow(edgeT, 1.2));
        const w = MathUtils.clamp(nx / halfW, -1, 1);
        ny += 0.085 * w * w * (0.4 + 0.6 * z01);
        const edge = Math.pow(Math.abs(nx), 1.35);
        const fold = edge * (0.032 + 0.03 * z01);
        ny -= fold;
        fPos.setX(vi, nx);
        fPos.setY(vi, ny);
        fPos.setZ(vi, nz);
      }
      frond.computeVertexNormals();
      frond.translate(0, 0, zSpan * 0.5);
      const upperCrown = i < frondCount / 2;
      const baseDroop = -tilts[i] * (upperCrown ? droopUpper : droopLower);
      const yaw = (i / frondCount) * Math.PI * 2 + 0.1;
      // Some fronds: pitch spine toward +Y first, fan, then droop (not same as one rotateX(droop−pitch))
      const spineFacesUp = i % 3 === 0;
      const pitchTowardSky = upperCrown ? 0.24 : 0.34;
      if (spineFacesUp) {
        frond.rotateX(-pitchTowardSky);
        frond.rotateY(yaw);
        frond.rotateX(baseDroop);
      } else {
        frond.rotateX(baseDroop);
        frond.rotateY(yaw);
      }
      frond.translate(
        0,
        crownYBase + (upperCrown ? crownYShiftTop : 0),
        0,
      );
      parts.push({ geo: frond, color: i % 2 === 0 ? frondColor : frondLight });
    }

    for (let c = 0; c < 3; c++) {
      const coconut = new SphereGeometry(0.032, 8, 6);
      const a = (c / 3) * Math.PI * 2 + 0.5;
      coconut.translate(Math.cos(a) * 0.045, 0.5, Math.sin(a) * 0.045);
      parts.push({ geo: coconut, color: coconutColor });
    }

    return this.mergeColoredParts(parts);
  }

  private createCoconutTrees() {
    const rand = seededRandom(300 + this.seed);

    const LAND_HEIGHT = 0.02;
    const MAX_ELEVATION = 0.10;
    const WATER_CHECK_DIST = 0.04;
    const WATER_CHECKS = 6;

    const transforms: Matrix4[] = [];
    const dummy = new Object3D();
    let attempts = 0;
    let clusters = 0;

    while (clusters < COCONUT_CLUSTERS && attempts < COCONUT_CLUSTERS * 20) {
      attempts++;

      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;

      const elevation = terrain.elevation;
      if (elevation > MAX_ELEVATION) continue;

      const centerNormal = new Vector3(nx, ny, nz);
      if (this.waterRatioAround(centerNormal, WATER_CHECK_DIST, WATER_CHECKS) <= 0) continue;

      const clusterCount = 4 + Math.floor(rand() * 5);

      for (let t = 0; t < clusterCount; t++) {
        let treeNormal: Vector3;
        if (t === 0) {
          treeNormal = centerNormal.clone();
        } else {
          const tangent = new Vector3(-ny, nx, 0);
          if (tangent.lengthSq() < 0.001) tangent.set(0, -nz, ny);
          tangent.normalize();
          const bitangent = new Vector3().crossVectors(centerNormal, tangent).normalize();
          const a = rand() * Math.PI * 2;
          const d = 0.006 + rand() * 0.022;
          treeNormal = centerNormal.clone()
            .addScaledVector(tangent, Math.cos(a) * d)
            .addScaledVector(bitangent, Math.sin(a) * d)
            .normalize();
        }

        if (!this.sampleTerrainForNormal(treeNormal).isLand) continue;

        const displacement = surfaceDisplacementAt(
          this.seed,
          this.terrainType,
          treeNormal.x,
          treeNormal.y,
          treeNormal.z,
        );
        const surfaceRadius = this.radius + displacement - PROP_TERRAIN_SINK;
        const scale = MathUtils.lerp(0.09, 0.15, rand());

        dummy.position.copy(treeNormal.clone().multiplyScalar(surfaceRadius));
        dummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), treeNormal);
        dummy.rotateY(rand() * Math.PI * 2);
        dummy.rotateZ((rand() - 0.4) * 0.12);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();

        transforms.push(dummy.matrix.clone());
      }

      clusters++;
    }

    if (transforms.length === 0) return;

    const coconutGeo = this.createCoconutTreeGeo();
    const swayTime = { value: 0 };
    this.treeSwayUniforms.push(swayTime);

    const mat = new MeshPhongMaterial({
      vertexColors: true,
      flatShading: false,
    });
    addRimLight(mat, 0xffeeaa, 0.7, 3.0);

    const rimCompile = mat.onBeforeCompile.bind(mat);
    mat.onBeforeCompile = (shader, renderer) => {
      rimCompile(shader, renderer);
      shader.uniforms.swayTime = swayTime;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>\nuniform float swayTime;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float swayHeight = position.y;
vec4 worldPos = instanceMatrix * vec4(position, 1.0);
float swayPhase = worldPos.x * 3.0 + worldPos.z * 2.7;
float sway = sin(swayTime * 1.2 + swayPhase) * 0.4 * swayHeight * swayHeight;
float sway2 = cos(swayTime * 0.8 + swayPhase * 0.7) * 0.3 * swayHeight * swayHeight;
transformed.x += sway;
transformed.z += sway2;`,
      );
    };

    const instanced = new InstancedMesh(coconutGeo, mat, transforms.length);
    instanced.castShadow = true;
    instanced.receiveShadow = false;

    for (let i = 0; i < transforms.length; i++) {
      instanced.setMatrixAt(i, transforms[i]);
    }
    instanced.instanceMatrix.needsUpdate = true;
    this.group.add(instanced);
  }

  private makeBlockyRock(
    sx: number, sy: number, sz: number,
    chunks: { x: number; y: number; z: number; w: number; h: number; d: number; sides?: number }[],
    baseSides?: number,
  ): BufferGeometry {
    const geos: BufferGeometry[] = [];
    let baseGeo: BufferGeometry;
    if (baseSides) {
      const cyl = new CylinderGeometry(sx / 2, sz / 2, sy, baseSides, 1);
      cyl.translate(0, sy / 2, 0);
      baseGeo = cyl;
    } else {
      baseGeo = new BoxGeometry(sx, sy, sz);
      baseGeo.translate(0, sy / 2, 0);
    }
    geos.push(baseGeo.toNonIndexed());
    baseGeo.dispose();

    for (const c of chunks) {
      let chunkGeo: BufferGeometry;
      if (c.sides) {
        const cyl = new CylinderGeometry(c.w / 2, c.d / 2, c.h, c.sides, 1);
        cyl.translate(c.x, c.y, c.z);
        chunkGeo = cyl;
      } else {
        chunkGeo = new BoxGeometry(c.w, c.h, c.d);
        chunkGeo.translate(c.x, c.y, c.z);
      }
      geos.push(chunkGeo.toNonIndexed());
      chunkGeo.dispose();
    }

    let totalVerts = 0;
    for (const g of geos) totalVerts += g.attributes.position.count;
    const positions = new Float32Array(totalVerts * 3);
    let vOff = 0;

    for (const g of geos) {
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        positions[(vOff + i) * 3] = pos.getX(i);
        positions[(vOff + i) * 3 + 1] = pos.getY(i);
        positions[(vOff + i) * 3 + 2] = pos.getZ(i);
      }
      vOff += pos.count;
      g.dispose();
    }

    for (let i = 0; i < totalVerts; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const h = px * 73.1 + py * 37.9 + pz * 51.3;
      positions[i * 3] += Math.sin(h) * 0.07;
      positions[i * 3 + 1] += Math.sin(h * 1.7) * 0.035;
      positions[i * 3 + 2] += Math.cos(h * 1.3) * 0.07;
    }

    const colors = new Float32Array(totalVerts * 3);
    for (let i = 0; i < totalVerts; i += 3) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      
      // Fake AO: Darken the bottom of the rock
      const ao = MathUtils.lerp(0.15, 1.0, Math.min(1, Math.max(0, py / (sy * 0.7))));
      
      const shade = (0.85 + Math.sin(px * 31.7 + py * 47.3 + pz * 19.1) * 0.15) * ao;
      for (let v = 0; v < 3; v++) {
        colors[(i + v) * 3] = shade;
        colors[(i + v) * 3 + 1] = shade;
        colors[(i + v) * 3 + 2] = shade;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  private createRocks() {
    const rand = seededRandom(500 + this.seed);

    const LAND_HEIGHT = 0.02;

    const ROCK_TYPES = 5;
    const rockGeos: BufferGeometry[] = [
      this.makeBlockyRock(0.9, 0.35, 0.8, [
        { x: 0.7, y: 0.1, z: 0.3, w: 0.3, h: 0.2, d: 0.25, sides: 5 },
      ], 6),
      this.makeBlockyRock(1.0, 0.25, 0.9, [
        { x: 0.15, y: 0.3, z: 0, w: 0.4, h: 0.2, d: 0.4, sides: 5 },
      ], 5),
      this.makeBlockyRock(0.7, 0.4, 0.6, [
        { x: -0.55, y: 0.08, z: -0.35, w: 0.25, h: 0.15, d: 0.2, sides: 6 },
      ], 5),
      this.makeBlockyRock(0.85, 0.3, 0.8, [
        { x: -0.1, y: 0.35, z: 0.08, w: 0.35, h: 0.2, d: 0.3, sides: 5 },
        { x: 0.6, y: 0.07, z: -0.4, w: 0.22, h: 0.14, d: 0.2, sides: 6 },
      ], 6),
      this.makeBlockyRock(0.65, 0.45, 0.6, [
        { x: 0.08, y: 0.48, z: -0.04, w: 0.28, h: 0.18, d: 0.25, sides: 5 },
      ], 6),
    ];

    const rockColors = [0x5a554e, 0x65605a, 0x4e4a44, 0x585350, 0x524e48];
    const transformsByType: Matrix4[][] = Array.from({ length: ROCK_TYPES }, () => []);
    const rockTreeTransforms: Matrix4[] = [];
    const dummy = new Object3D();

    let attempts = 0;
    let clusters = 0;
    const targetClusters = Math.ceil(ROCK_COUNT / 2.5);

    while (clusters < targetClusters && attempts < targetClusters * 10) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;

      const elevation = terrain.elevation;
      if (elevation > 0.7) continue;

      const coastlineChance = elevation < 0.1 ? 0.9 : elevation < 0.25 ? 0.5 : 0.2;
      if (rand() > coastlineChance) continue;

      const centerNormal = new Vector3(nx, ny, nz);
      const rocksInCluster = 3 + Math.floor(rand() * 2);

      for (let r = 0; r < rocksInCluster; r++) {
        let rockNormal: Vector3;
        if (r === 0) {
          rockNormal = centerNormal.clone();
        } else {
          const tangent = new Vector3(-ny, nx, 0).normalize();
          if (tangent.lengthSq() < 0.01) tangent.set(0, 0, 1).cross(centerNormal).normalize();
          const bitangent = new Vector3().crossVectors(centerNormal, tangent).normalize();
          const a = rand() * Math.PI * 2;
          const d = 0.005 + rand() * 0.01;
          rockNormal = centerNormal.clone()
            .addScaledVector(tangent, Math.cos(a) * d)
            .addScaledVector(bitangent, Math.sin(a) * d)
            .normalize();
        }

        const rn = rockNormal;
        if (!this.sampleTerrainForNormal(rn).isLand) continue;

        const displacement = surfaceDisplacementAt(this.seed, this.terrainType, rn.x, rn.y, rn.z);
        const surfaceRadius = this.radius + displacement - PROP_TERRAIN_SINK;

        const scale = MathUtils.lerp(0.045, 0.12, rand());
        const rockType = elevation < 0.1
          ? (rand() < 0.5 ? 3 : 4)
          : Math.floor(rand() * ROCK_TYPES);

        dummy.position.copy(rn.clone().multiplyScalar(surfaceRadius - scale * 0.12));
        dummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), rn);
        dummy.rotateY(rand() * Math.PI * 2);
        const scaleX = scale * MathUtils.lerp(0.8, 1.3, rand());
        const scaleZ = scale * MathUtils.lerp(0.8, 1.3, rand());
        dummy.scale.set(scaleX, scale * 0.6, scaleZ);
        dummy.updateMatrix();

        transformsByType[rockType].push(dummy.matrix.clone());
      }

      if (rand() < 0.5) {
        const treesNear = 1 + Math.floor(rand() * 3);
        for (let tr = 0; tr < treesNear; tr++) {
          const tAngle = rand() * Math.PI * 2;
          const tDist = 0.012 + rand() * 0.015;

          const tangent = new Vector3(-centerNormal.y, centerNormal.x, 0).normalize();
          if (tangent.lengthSq() < 0.01) tangent.set(0, 0, 1).cross(centerNormal).normalize();
          const bitangent = new Vector3().crossVectors(centerNormal, tangent).normalize();

          const treeNormal = centerNormal.clone()
            .addScaledVector(tangent, Math.cos(tAngle) * tDist)
            .addScaledVector(bitangent, Math.sin(tAngle) * tDist)
            .normalize();

          if (!this.sampleTerrainForNormal(treeNormal).isLand) continue;

          const tDisp = surfaceDisplacementAt(
            this.seed,
            this.terrainType,
            treeNormal.x,
            treeNormal.y,
            treeNormal.z,
          );
          const tSurfR = this.radius + tDisp - PROP_TERRAIN_SINK;
          const treeScale = MathUtils.lerp(0.014, 0.025, rand());
          const treeH = treeScale * 2.5;

          dummy.position.copy(treeNormal.clone().multiplyScalar(tSurfR).addScaledVector(treeNormal, -treeH * 0.05));
          dummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), treeNormal);
          dummy.scale.set(treeScale * 0.7, treeH, treeScale * 0.7);
          dummy.updateMatrix();

          rockTreeTransforms.push(dummy.matrix.clone());
        }
      }

      clusters++;
    }

    if (rockTreeTransforms.length > 0) {
      const treeGeo = this.createTeardropGeo(1, 1);
      const swayTime = { value: 0 };
      this.treeSwayUniforms.push(swayTime);

      const treeMat = new MeshPhongMaterial({
        color: 0x3a8a2a,
        vertexColors: true,
        flatShading: true,
      });
      addRimLight(treeMat, 0xffeeaa, 0.7, 3.0);

      const rimCompile = treeMat.onBeforeCompile.bind(treeMat);
      treeMat.onBeforeCompile = (shader, renderer) => {
        rimCompile(shader, renderer);
        shader.uniforms.swayTime = swayTime;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          `#include <common>\nuniform float swayTime;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float swayHeight = position.y;
vec4 worldPos = instanceMatrix * vec4(position, 1.0);
float swayPhase = worldPos.x * 3.0 + worldPos.z * 2.7;
float sway = sin(swayTime * 1.8 + swayPhase) * 0.8 * swayHeight * swayHeight;
float sway2 = cos(swayTime * 1.3 + swayPhase * 0.7) * 0.6 * swayHeight * swayHeight;
transformed.x += sway;
transformed.z += sway2;`,
        );
      };

      const treeInstanced = new InstancedMesh(treeGeo, treeMat, rockTreeTransforms.length);
      treeInstanced.castShadow = true;
      treeInstanced.receiveShadow = false;

      for (let i = 0; i < rockTreeTransforms.length; i++) {
        treeInstanced.setMatrixAt(i, rockTreeTransforms[i]);
      }
      treeInstanced.instanceMatrix.needsUpdate = true;
      this.group.add(treeInstanced);
    }

    for (let t = 0; t < ROCK_TYPES; t++) {
      const tforms = transformsByType[t];
      if (tforms.length === 0) continue;

      const mat = new MeshPhongMaterial({
        color: rockColors[t],
        vertexColors: true,
        flatShading: true,
        shininess: 5,
      });
      addRimLight(mat, 0xffeebb, 0.5, 3.0);

      const instanced = new InstancedMesh(rockGeos[t], mat, tforms.length);
      instanced.castShadow = true;
      instanced.receiveShadow = true;

      for (let i = 0; i < tforms.length; i++) {
        instanced.setMatrixAt(i, tforms[i]);
      }
      instanced.instanceMatrix.needsUpdate = true;
      this.group.add(instanced);
    }
  }

  private mergeColoredParts(
    parts: { geo: BufferGeometry; color: Color; isWindow?: boolean }[],
  ): BufferGeometry {
    let totalVerts = 0;
    let totalIdx = 0;
    for (const p of parts) {
      totalVerts += p.geo.attributes.position.count;
      totalIdx += (p.geo.index ? p.geo.index.count : 0);
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    // We'll use the 'uv' attribute to store a 1.0 flag for windows, 0.0 for everything else
    // so the shader knows which parts should glow at night.
    const uvs = new Float32Array(totalVerts * 2);
    const indices: number[] = [];
    let vOffset = 0;

    for (const { geo, color, isWindow } of parts) {
      const pos = geo.attributes.position;
      const norm = geo.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const idx = (vOffset + i) * 3;
        const uvIdx = (vOffset + i) * 2;
        const y = pos.getY(i);
        
        // Fake AO: Darken the bottom of the house (but don't darken windows)
        const ao = isWindow ? 1.0 : MathUtils.lerp(0.15, 1.0, Math.min(1, Math.max(0, y / 0.5)));

        positions[idx] = pos.getX(i);
        positions[idx + 1] = y;
        positions[idx + 2] = pos.getZ(i);
        normals[idx] = norm.getX(i);
        normals[idx + 1] = norm.getY(i);
        normals[idx + 2] = norm.getZ(i);
        colors[idx] = color.r * ao;
        colors[idx + 1] = color.g * ao;
        colors[idx + 2] = color.b * ao;
        
        uvs[uvIdx] = isWindow ? 1.0 : 0.0;
        uvs[uvIdx + 1] = 0.0;
      }
      if (geo.index) {
        for (let i = 0; i < geo.index.count; i++) {
          indices.push(geo.index.getX(i) + vOffset);
        }
      }
      vOffset += pos.count;
    }

    const merged = new BufferGeometry();
    merged.setAttribute("position", new Float32BufferAttribute(positions, 3));
    merged.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    merged.setAttribute("color", new Float32BufferAttribute(colors, 3));
    merged.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    merged.setIndex(indices);
    for (const { geo } of parts) geo.dispose();
    return merged;
  }

  private createHouseGeo(type: number): BufferGeometry {
    const wallColor = new Color(0xf4f0e8); // Slightly warmer/brighter plaster
    const domeColors = [
      new Color(0x2866b0), // Classic blue
      new Color(0x3478c0), // Lighter blue
      new Color(0x1e5898), // Darker blue
      new Color(0xc04040), // Terracotta red accent
    ];
    const domeColor = domeColors[type % domeColors.length];
    const flatRoofColor = new Color(0xe8e4dc);
    const doorColor = new Color(0x5a4030); // Wood door
    const windowColor = new Color(0xffcc66); // Warm orange-yellowish for lit windows
    const frameColor = new Color(0x8e8984); // Stone window/door frames

    const parts: { geo: BufferGeometry; color: Color; isWindow?: boolean }[] = [];

    // Helper to add framed windows
    const addWindow = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
      const frameThick = 0.04;
      const frameDepth = d * 1.2;
      const frame = new BoxGeometry(w + frameThick * 2, h + frameThick * 2, frameDepth);
      frame.translate(px, py, pz);
      parts.push({ geo: frame, color: frameColor });

      const win = new BoxGeometry(w, h, d * 1.4); // slightly deeper so it sticks out of frame
      win.translate(px, py, pz);
      parts.push({ geo: win, color: windowColor, isWindow: true });
    };

    // Helper to add framed doors
    const addDoor = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
      const frameThick = 0.05;
      const frameDepth = d * 1.2;
      const frame = new BoxGeometry(w + frameThick * 2, h + frameThick, frameDepth);
      frame.translate(px, py + frameThick * 0.5, pz);
      parts.push({ geo: frame, color: frameColor });

      const door = new BoxGeometry(w, h, d * 1.4);
      door.translate(px, py, pz);
      parts.push({ geo: door, color: doorColor });
    };

    if (type === 0) {
      // Square house with dome
      const wall = new BoxGeometry(1, 0.8, 1);
      wall.translate(0, 0.4, 0);
      parts.push({ geo: wall, color: wallColor });

      // Roof trim/cornice
      const cornice = new BoxGeometry(1.08, 0.06, 1.08);
      cornice.translate(0, 0.8, 0);
      parts.push({ geo: cornice, color: flatRoofColor });

      const dome = new SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(0, 0.8, 0);
      parts.push({ geo: dome, color: domeColor });

      // Dome finial
      const finial = new CylinderGeometry(0.02, 0.04, 0.15, 6);
      finial.translate(0, 1.3, 0);
      parts.push({ geo: finial, color: frameColor });

      addDoor(0.22, 0.36, 0.05, 0, 0.18, 0.5);
      addWindow(0.16, 0.22, 0.05, -0.5, 0.45, 0);
      addWindow(0.16, 0.22, 0.05, 0.5, 0.45, 0);

    } else if (type === 1) {
      // L-shaped or stepped house
      const base = new BoxGeometry(1.2, 0.6, 0.9);
      base.translate(0, 0.3, 0);
      parts.push({ geo: base, color: wallColor });

      const roof = new BoxGeometry(1.28, 0.08, 0.98);
      roof.translate(0, 0.64, 0);
      parts.push({ geo: roof, color: flatRoofColor });

      const upper = new BoxGeometry(0.6, 0.45, 0.6);
      upper.translate(0.2, 0.925, 0.05);
      parts.push({ geo: upper, color: wallColor });

      const upperRoof = new BoxGeometry(0.68, 0.06, 0.68);
      upperRoof.translate(0.2, 1.18, 0.05);
      parts.push({ geo: upperRoof, color: flatRoofColor });

      // Small dome on upper roof
      const dome = new SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(0.2, 1.18, 0.05);
      parts.push({ geo: dome, color: domeColor });

      addDoor(0.22, 0.3, 0.05, -0.2, 0.15, 0.45);
      addWindow(0.16, 0.2, 0.05, 0.3, 0.35, 0.45);
      addWindow(0.14, 0.18, 0.05, 0.2, 0.9, 0.35);

    } else if (type === 2) {
      // Tall tower house
      const wall = new BoxGeometry(0.7, 1.1, 0.7);
      wall.translate(0, 0.55, 0);
      parts.push({ geo: wall, color: wallColor });

      const cornice = new BoxGeometry(0.78, 0.06, 0.78);
      cornice.translate(0, 1.1, 0);
      parts.push({ geo: cornice, color: flatRoofColor });

      const dome = new SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(0, 1.1, 0);
      parts.push({ geo: dome, color: domeColor });

      addDoor(0.18, 0.4, 0.05, 0, 0.2, 0.35);
      addWindow(0.14, 0.24, 0.05, 0, 0.75, 0.35);
      addWindow(0.14, 0.24, 0.05, 0, 0.75, -0.35);

    } else {
      // Complex multi-level house
      const base = new BoxGeometry(0.9, 0.5, 0.8);
      base.translate(0, 0.25, 0);
      parts.push({ geo: base, color: wallColor });

      const baseRoof = new BoxGeometry(0.98, 0.06, 0.88);
      baseRoof.translate(0, 0.53, 0);
      parts.push({ geo: baseRoof, color: flatRoofColor });

      const mid = new BoxGeometry(0.55, 0.45, 0.55);
      mid.translate(-0.1, 0.785, 0.05);
      parts.push({ geo: mid, color: wallColor });

      const midRoof = new BoxGeometry(0.63, 0.06, 0.63);
      midRoof.translate(-0.1, 1.04, 0.05);
      parts.push({ geo: midRoof, color: flatRoofColor });

      const top = new BoxGeometry(0.35, 0.35, 0.35);
      top.translate(0.05, 1.245, 0);
      parts.push({ geo: top, color: wallColor });

      const dome = new SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(0.05, 1.42, 0);
      parts.push({ geo: dome, color: domeColor });

      addDoor(0.2, 0.28, 0.05, 0.15, 0.14, 0.4);
      addWindow(0.14, 0.16, 0.05, -0.2, 0.35, 0.4);
      addWindow(0.12, 0.16, 0.05, -0.375, 0.75, 0.05);
    }

    return this.mergeColoredParts(parts);
  }

  private createVillages() {
    const rand = seededRandom(200 + this.seed);

    const LAND_HEIGHT = 0.02;
    const MIN_ELEVATION = 0.08;

    const villageCenters: Vector3[] = [];
    let attempts = 0;

    while (villageCenters.length < VILLAGE_COUNT && attempts < VILLAGE_COUNT * 30) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;

      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > 0.35) continue;

      const tooClose = villageCenters.some((v) => {
        const dot = v.x * nx + v.y * ny + v.z * nz;
        return dot > 0.95;
      });
      if (tooClose) continue;

      villageCenters.push(new Vector3(nx, ny, nz));
    }

    const HOUSE_TYPES = 4;
    const houseGeos = Array.from({ length: HOUSE_TYPES }, (_, i) => this.createHouseGeo(i));
    const transformsByType: Matrix4[][] = Array.from({ length: HOUSE_TYPES }, () => []);
    const gardenTreeTransforms: Matrix4[] = [];
    const allHouseTransforms: Matrix4[] = [];
    const dummy = new Object3D();

    for (const center of villageCenters) {
      const houseCount = HOUSES_PER_VILLAGE[Math.floor(rand() * HOUSES_PER_VILLAGE.length)];
      this.villageCenters.push({ normal: center.clone(), houseCount });

      for (let h = 0; h < houseCount; h++) {
        const angle = rand() * Math.PI * 2;
        const dist = 0.02 + rand() * 0.048;

        const tangent = new Vector3(-center.y, center.x, 0).normalize();
        if (tangent.lengthSq() < 0.01) tangent.set(0, 0, 1).cross(center).normalize();
        const bitangent = new Vector3().crossVectors(center, tangent).normalize();

        const houseNormal = center.clone()
          .addScaledVector(tangent, Math.cos(angle) * dist)
          .addScaledVector(bitangent, Math.sin(angle) * dist)
          .normalize();

        const nx = houseNormal.x;
        const ny = houseNormal.y;
        const nz = houseNormal.z;

        const terrain = this.sampleTerrainAt(nx, ny, nz);
        if (!terrain.isLand) continue;

        const elevation = terrain.elevation;
        if (elevation < MIN_ELEVATION * 0.5) continue;

        const displacement = surfaceDisplacementAt(this.seed, this.terrainType, nx, ny, nz);
        const surfaceRadius = this.radius + displacement - PROP_TERRAIN_SINK;

        const sinkAmount = 0.004;
        const pos = houseNormal.clone().multiplyScalar(surfaceRadius - sinkAmount);
        const scale = MathUtils.lerp(0.065, 0.10, rand());
        const houseType = Math.floor(rand() * HOUSE_TYPES);

        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), houseNormal);
        dummy.rotateY(rand() * Math.PI * 2);
        dummy.scale.set(scale, scale * 0.7, scale);
        dummy.updateMatrix();

        transformsByType[houseType].push(dummy.matrix.clone());
        allHouseTransforms.push(dummy.matrix.clone());

        const treesAround = 2 + Math.floor(rand() * 3);
        for (let tr = 0; tr < treesAround; tr++) {
          const tAngle = rand() * Math.PI * 2;
          const tDist = 0.016 + rand() * 0.02;

          const treeNormal = houseNormal.clone()
            .addScaledVector(new Vector3(-houseNormal.y, houseNormal.x, 0).normalize(), Math.cos(tAngle) * tDist)
            .addScaledVector(new Vector3().crossVectors(houseNormal, new Vector3(-houseNormal.y, houseNormal.x, 0).normalize()).normalize(), Math.sin(tAngle) * tDist)
            .normalize();

          if (!this.sampleTerrainForNormal(treeNormal).isLand) continue;
          const treeDisplacement = surfaceDisplacementAt(
            this.seed,
            this.terrainType,
            treeNormal.x,
            treeNormal.y,
            treeNormal.z,
          );
          const treeSurfaceR = this.radius + treeDisplacement - PROP_TERRAIN_SINK;
          const treeScale = MathUtils.lerp(0.022, 0.04, rand());
          const treeH = treeScale * 2.5;

          dummy.position.copy(treeNormal.clone().multiplyScalar(treeSurfaceR).addScaledVector(treeNormal, -treeH * 0.05));
          dummy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), treeNormal);
          dummy.scale.set(treeScale * 0.7, treeH, treeScale * 0.7);
          dummy.updateMatrix();

          gardenTreeTransforms.push(dummy.matrix.clone());
        }
      }
    }

    const gardenGeo = this.createTeardropGeo(1, 1);
    const gardenShades = [0x3a8a2a, 0x45953a, 0x509a40];

    for (let s = 0; s < gardenShades.length; s++) {
      const count = Math.ceil(gardenTreeTransforms.length / gardenShades.length);
      const start = s * count;
      const end = Math.min(start + count, gardenTreeTransforms.length);
      const slice = gardenTreeTransforms.slice(start, end);
      if (slice.length === 0) continue;

      const swayTime = { value: 0 };
      this.treeSwayUniforms.push(swayTime);

      const mat = new MeshPhongMaterial({
        color: gardenShades[s],
        vertexColors: true,
        flatShading: true,
      });
      addRimLight(mat, 0xffeeaa, 0.7, 3.0);

      const rimCompile = mat.onBeforeCompile.bind(mat);
      mat.onBeforeCompile = (shader, renderer) => {
        rimCompile(shader, renderer);
        shader.uniforms.swayTime = swayTime;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          `#include <common>\nuniform float swayTime;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float swayHeight = position.y;
vec4 worldPos = instanceMatrix * vec4(position, 1.0);
float swayPhase = worldPos.x * 3.0 + worldPos.z * 2.7;
float sway = sin(swayTime * 1.8 + swayPhase) * 0.8 * swayHeight * swayHeight;
float sway2 = cos(swayTime * 1.3 + swayPhase * 0.7) * 0.6 * swayHeight * swayHeight;
transformed.x += sway;
transformed.z += sway2;`,
        );
      };

      const instanced = new InstancedMesh(gardenGeo, mat, slice.length);
      instanced.castShadow = true;
      instanced.receiveShadow = false;

      for (let i = 0; i < slice.length; i++) {
        instanced.setMatrixAt(i, slice[i]);
      }
      instanced.instanceMatrix.needsUpdate = true;
      this.group.add(instanced);
    }

    for (let t = 0; t < HOUSE_TYPES; t++) {
      const tforms = transformsByType[t];
      if (tforms.length === 0) continue;

      const mat = new MeshPhongMaterial({
        vertexColors: true,
        flatShading: true,
        shininess: 15,
      });
      addRimLight(mat, 0xffeebb, 0.6, 3.0);

      // Inject custom shader logic to make windows glow (emissive) based on the UV flag
      const onBeforeCompile = mat.onBeforeCompile.bind(mat);
      mat.onBeforeCompile = (shader, renderer) => {
        onBeforeCompile(shader, renderer);
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          `#include <common>
          varying float vIsWindow;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
          vIsWindow = uv.x;` // We stored 1.0 in uv.x for windows
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <common>",
          `#include <common>
          varying float vIsWindow;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          // If this is a window, add a strong warm emissive glow
          if (vIsWindow > 0.5) {
            totalEmissiveRadiance += vec3(1.0, 0.75, 0.2) * 10.5;
          }`
        );
      };

      const instanced = new InstancedMesh(houseGeos[t], mat, tforms.length);
      instanced.castShadow = true;
      instanced.receiveShadow = true;

      for (let i = 0; i < tforms.length; i++) {
        instanced.setMatrixAt(i, tforms[i]);
      }
      instanced.instanceMatrix.needsUpdate = true;
      this.group.add(instanced);
    }
  }

  private buildWindmill(
    rand: () => number,
    parts: { geo: BufferGeometry; color: Color }[],
    bladeParts: { geo: BufferGeometry; color: Color }[],
    scale: number,
  ) {
    const COL_TOWER = new Color(0xf0ece0);
    const COL_TOWER_BAND = new Color(0xd8d0c0);
    const COL_CAP = new Color(0x4a3828);
    const COL_DOOR = new Color(0x4a3018);
    const COL_DOOR_FRAME = new Color(0x3a2818);
    const COL_WINDOW = new Color(0x7ab8d0);
    const COL_WINDOW_FRAME = new Color(0x5a4030);
    const COL_BALCONY = new Color(0x6b5540);
    const COL_BLADE_SAIL = new Color(0xe0d8c8);
    const COL_BLADE_ARM = new Color(0x7a6a50);
    const COL_TAIL = new Color(0x8a7a60);

    const tH = 0.13 * scale;
    const rBot = 0.032 * scale;
    const rTop = 0.022 * scale;
    const rMid = (rBot + rTop) / 2;

    const towerLower = new CylinderGeometry(rMid, rBot, tH * 0.5, 10);
    towerLower.translate(0, tH * 0.25, 0);
    parts.push({ geo: towerLower, color: COL_TOWER });

    const towerUpper = new CylinderGeometry(rTop, rMid, tH * 0.5, 10);
    towerUpper.translate(0, tH * 0.75, 0);
    parts.push({ geo: towerUpper, color: COL_TOWER });

    const bandGeo = new CylinderGeometry(rMid + 0.002 * scale, rMid + 0.002 * scale, 0.005 * scale, 10);
    bandGeo.translate(0, tH * 0.5, 0);
    parts.push({ geo: bandGeo, color: COL_TOWER_BAND });

    const baseRing = new CylinderGeometry(rBot + 0.003 * scale, rBot + 0.005 * scale, 0.006 * scale, 10);
    baseRing.translate(0, 0.003 * scale, 0);
    parts.push({ geo: baseRing, color: COL_TOWER_BAND });

    const capH = 0.028 * scale;
    const capBase = rTop + 0.004 * scale;
    const capMid = new CylinderGeometry(capBase * 0.6, capBase, capH * 0.6, 8);
    capMid.translate(0, tH + capH * 0.3, 0);
    parts.push({ geo: capMid, color: COL_CAP });
    const capTip = new CylinderGeometry(0.002 * scale, capBase * 0.6, capH * 0.4, 8);
    capTip.translate(0, tH + capH * 0.8, 0);
    parts.push({ geo: capTip, color: COL_CAP });

    const doorW = rBot * 0.55;
    const doorH = tH * 0.22;
    const doorGeo = new BoxGeometry(doorW, doorH, 0.004 * scale);
    doorGeo.translate(0, doorH / 2 + 0.003 * scale, rBot + 0.002 * scale);
    parts.push({ geo: doorGeo, color: COL_DOOR });
    const doorFrame = new BoxGeometry(doorW + 0.004 * scale, doorH + 0.003 * scale, 0.003 * scale);
    doorFrame.translate(0, doorH / 2 + 0.004 * scale, rBot + 0.003 * scale);
    parts.push({ geo: doorFrame, color: COL_DOOR_FRAME });

    const winSize = 0.008 * scale;
    const windowPositions = [
      { y: tH * 0.45, angle: Math.PI * 0.3 },
      { y: tH * 0.45, angle: -Math.PI * 0.3 },
      { y: tH * 0.68, angle: 0 },
    ];
    for (const wp of windowPositions) {
      const wr = MathUtils.lerp(rBot, rTop, wp.y / tH);
      const wx = Math.sin(wp.angle) * (wr + 0.002 * scale);
      const wz = Math.cos(wp.angle) * (wr + 0.002 * scale);
      const winGeo = new BoxGeometry(winSize, winSize, 0.003 * scale);
      winGeo.lookAt(new Vector3(Math.sin(wp.angle), 0, Math.cos(wp.angle)));
      winGeo.translate(wx, wp.y, wz);
      parts.push({ geo: winGeo, color: COL_WINDOW });
      const frameGeo = new BoxGeometry(winSize + 0.004 * scale, winSize + 0.004 * scale, 0.002 * scale);
      frameGeo.lookAt(new Vector3(Math.sin(wp.angle), 0, Math.cos(wp.angle)));
      frameGeo.translate(wx, wp.y, wz);
      parts.push({ geo: frameGeo, color: COL_WINDOW_FRAME });
    }

    const balcR = rTop + 0.008 * scale;
    const balcFloor = new CylinderGeometry(balcR, balcR, 0.003 * scale, 12);
    balcFloor.translate(0, tH - 0.002 * scale, 0);
    parts.push({ geo: balcFloor, color: COL_BALCONY });
    const balcRail = new CylinderGeometry(balcR + 0.001, balcR + 0.001, 0.008 * scale, 12, 1, true);
    balcRail.translate(0, tH + 0.002 * scale, 0);
    parts.push({ geo: balcRail, color: COL_BALCONY });

    const tailLen = 0.03 * scale;
    const tailW = 0.018 * scale;
    const tailGeo = new BoxGeometry(tailW, 0.002 * scale, tailLen);
    tailGeo.translate(0, tH + capH * 0.5, -(rTop + tailLen * 0.5 + 0.004 * scale));
    parts.push({ geo: tailGeo, color: COL_TAIL });
    const tailPost = new BoxGeometry(0.003 * scale, 0.012 * scale, 0.003 * scale);
    tailPost.translate(0, tH + capH * 0.5 - 0.005 * scale, -(rTop + 0.004 * scale));
    parts.push({ geo: tailPost, color: COL_TAIL });

    const hubY = tH + capH * 0.35;
    const hubZ = rTop + 0.006 * scale;
    const bladeLen = 0.10 * scale;

    const hubGeo = new CylinderGeometry(0.006 * scale, 0.006 * scale, 0.008 * scale, 8);
    hubGeo.rotateX(Math.PI / 2);
    bladeParts.push({ geo: hubGeo, color: COL_CAP });

    for (let b = 0; b < 4; b++) {
      const angle = (b / 4) * Math.PI * 2;

      const armGeo = new BoxGeometry(0.003 * scale, bladeLen, 0.003 * scale);
      armGeo.translate(0, bladeLen / 2 + 0.005 * scale, 0);
      armGeo.rotateZ(angle);
      bladeParts.push({ geo: armGeo, color: COL_BLADE_ARM });

      for (let c = 0; c < 3; c++) {
        const ct = (c + 1) / 4;
        const cy = bladeLen * ct + 0.005 * scale;
        const crossGeo = new BoxGeometry(0.002 * scale, 0.002 * scale, 0.016 * scale);
        crossGeo.translate(0.002 * scale, cy, 0);
        crossGeo.rotateZ(angle);
        bladeParts.push({ geo: crossGeo, color: COL_BLADE_ARM });
      }

      const sailH = bladeLen * 0.75;
      const sailW = 0.016 * scale;
      const sailGeo = new BoxGeometry(0.001 * scale, sailH, sailW);
      sailGeo.translate(sailW * 0.3, bladeLen * 0.5 + 0.005 * scale, 0);
      sailGeo.rotateZ(angle);
      bladeParts.push({ geo: sailGeo, color: COL_BLADE_SAIL });
    }

    return { hubY, hubZ };
  }

  private createWindmills() {
    const rand = seededRandom(555 + this.seed);
    const REF_UP = new Vector3(0, 1, 0);

    const CLUSTER_COUNT = 4;
    const WATER_CHECKS = 10;
    const CHECK_DIST = 0.05;
    const MIN_WATER_RATIO = 0.2;
    const MAX_WATER_RATIO = 0.5;
    const MIN_SEP_DOT = 0.94;

    type Candidate = { normal: Vector3; score: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 2000 && candidates.length < 40) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < 0.05 || elevation > 0.2) continue;

      const centerNormal = new Vector3(nx, ny, nz);

      const tooCloseToVillage = this.villageCenters.some(
        (v) => centerNormal.dot(v.normal) > 0.97,
      );
      if (tooCloseToVillage) continue;
      const tooCloseToLighthouse = this.lighthouseCenters.some(
        (v) => centerNormal.dot(v.normal) > 0.97,
      );
      if (tooCloseToLighthouse) continue;

      const waterRatio = this.waterRatioAround(centerNormal, CHECK_DIST, WATER_CHECKS);
      if (waterRatio < MIN_WATER_RATIO || waterRatio > MAX_WATER_RATIO) continue;

      candidates.push({ normal: centerNormal, score: 1 - elevation });
    }

    candidates.sort((a, b) => b.score - a.score);

    const clusterCenters: Vector3[] = [];
    for (const c of candidates) {
      if (clusterCenters.length >= CLUSTER_COUNT) break;
      const tooClose = clusterCenters.some((v) => c.normal.dot(v) > MIN_SEP_DOT);
      if (tooClose) continue;
      clusterCenters.push(c.normal);
    }

    if (clusterCenters.length === 0) return;

    for (const center of clusterCenters) {
      const count = 2 + Math.floor(rand() * 2);
      const tangent = new Vector3(-center.y, center.x, 0);
      if (tangent.lengthSq() < 0.001) tangent.set(0, -center.z, center.y);
      tangent.normalize();
      const bitangent = new Vector3().crossVectors(center, tangent).normalize();

      for (let m = 0; m < count; m++) {
        let normal: Vector3;
        if (m === 0) {
          normal = center.clone();
        } else {
          const a = rand() * Math.PI * 2;
          const d = 0.03 + rand() * 0.02;
          normal = center.clone()
            .addScaledVector(tangent, Math.cos(a) * d)
            .addScaledVector(bitangent, Math.sin(a) * d)
            .normalize();

          if (!this.sampleTerrainForNormal(normal).isLand) continue;
        }

        this.windmillCenters.push({ normal: normal.clone() });

        const displacement = surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z);
        const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;

        const scale = MathUtils.lerp(0.85, 1.15, rand());
        const bodyParts: { geo: BufferGeometry; color: Color }[] = [];
        const bladeParts: { geo: BufferGeometry; color: Color }[] = [];
        const { hubY, hubZ } = this.buildWindmill(rand, bodyParts, bladeParts, scale);

        const windmill = new Group();

        const mergedBody = this.mergeColoredParts(bodyParts);
        const bodyMat = new MeshPhongMaterial({ vertexColors: true, shininess: 12 });
        addRimLight(bodyMat, 0xffeedd, 0.3, 3.0);
        const bodyMesh = new Mesh(mergedBody, bodyMat);
        bodyMesh.castShadow = true;
        windmill.add(bodyMesh);

        const mergedBlades = this.mergeColoredParts(bladeParts);
        const bladeMat = new MeshPhongMaterial({ vertexColors: true, shininess: 8 });
        const bladeMesh = new Mesh(mergedBlades, bladeMat);
        const bladePivot = new Group();
        bladePivot.position.set(0, hubY, hubZ);
        bladePivot.add(bladeMesh);
        windmill.add(bladePivot);

        this.windmillBlades.push({ pivot: bladePivot, speed: 0.4 + rand() * 0.4 });

        windmill.position.copy(normal.clone().multiplyScalar(surfaceR));
        windmill.quaternion.setFromUnitVectors(REF_UP, normal);
        windmill.rotateY(rand() * Math.PI * 2);
        windmill.castShadow = true;
        this.group.add(windmill);
      }
    }
  }

  /* ── Observatories ──────────────────────────────────────────────── */

  private createObservatories() {
    const OBSERVATORY_COUNT = 3;
    const MIN_ELEVATION = 0.22;
    const MAX_ELEVATION = 0.60;
    const MIN_SEPARATION_DOT = 0.90;
    const VOLCANO_EXCLUSION_DOT = 0.97;

    const rand = seededRandom(4321 + this.seed);
    const volcanoNormals = Array.from({ length: VOLCANO_COUNT }, (_unused, index) =>
      getVolcanoPlacementNormal(this.seed, this.terrainType, index),
    );

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 2000 && candidates.length < 40) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      // Keep away from villages, lighthouses, windmills.
      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (volcanoNormals.some((v) => normal.dot(v) > VOLCANO_EXCLUSION_DOT)) continue;

      candidates.push({ normal, elevation });
    }

    // Prefer higher elevations — hilltops.
    candidates.sort((a, b) => b.elevation - a.elevation);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= OBSERVATORY_COUNT) break;
      if (chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT)) continue;
      chosen.push(c.normal);
    }
    if (chosen.length === 0) return;

    const REF_UP = new Vector3(0, 1, 0);

    for (const normal of chosen) {
      this.observatoryCenters.push({ normal: normal.clone() });

      const displacement = surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z);
      // Sink observatories deeper than other props so the foundation fills terrain gaps.
      const OBS_EXTRA_SINK = 0.045;
      const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK - OBS_EXTRA_SINK;

      const observatory = this.buildObservatory(rand);
      observatory.position.copy(normal.clone().multiplyScalar(surfaceR));
      observatory.quaternion.setFromUnitVectors(REF_UP, normal);
      observatory.castShadow = true;
      this.group.add(observatory);
    }
  }

  private createStonehenges() {
    const STONEHENGE_COUNT = 4;
    const MIN_ELEVATION = 0.02;
    const MAX_ELEVATION = 0.30;
    const MIN_SEPARATION_DOT = 0.88;
    // Inland check: sample surrounding points — require very low water ratio.
    const INLAND_CHECKS = 12;
    const INLAND_CHECK_DIST = 0.10;
    const MAX_WATER_RATIO = 0.10;   // at most 1 in 10 surrounding points can be water

    const rand = seededRandom(8888 + this.seed);

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 2000 && candidates.length < 50) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

      // Keep away from all other landmarks.
      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      candidates.push({ normal, elevation });
    }

    // Prefer flatter (lower elevation) terrain — more like the real Salisbury Plain.
    candidates.sort((a, b) => a.elevation - b.elevation);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= STONEHENGE_COUNT) break;
      const tooClose = chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT);
      if (tooClose) continue;
      chosen.push(c.normal);
    }

    if (chosen.length === 0) return;

    const REF_UP = new Vector3(0, 1, 0);

    for (const normal of chosen) {
      this.stonehengeCenters.push({ normal: normal.clone() });

      const displacement = surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z);
      const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;

      const stonehenge = this.buildStonehenge(rand);
      stonehenge.position.copy(normal.clone().multiplyScalar(surfaceR));
      stonehenge.quaternion.setFromUnitVectors(REF_UP, normal);
      stonehenge.rotateY(rand() * Math.PI * 2);
      stonehenge.castShadow = true;
      this.group.add(stonehenge);
      this.stonehengeGroups.push(stonehenge);
    }
  }

  /** Std-dev of normalized land elevation on a small ring — lower = flatter ground. */
  private terrainRingElevationRoughness(
    normal: Vector3,
    ringDist: number,
  ): number {
    const ref = Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const tang = new Vector3().crossVectors(normal, ref).normalize();
    const bitang = new Vector3().crossVectors(normal, tang).normalize();
    const values: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cn = normal.clone()
        .addScaledVector(tang, Math.cos(a) * ringDist)
        .addScaledVector(bitang, Math.sin(a) * ringDist)
        .normalize();
      const sample = this.sampleTerrainForNormal(cn);
      if (!sample.isLand) return 999;
      values.push(sample.elevation);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length);
  }

  private createShrines() {
    const SHRINE_COUNT = 5;
    const MIN_ELEVATION = 0.02;
    const MAX_ELEVATION = 0.28;
    const MIN_SEPARATION_DOT = 0.88;
    const INLAND_CHECKS = 12;
    const INLAND_CHECK_DIST = 0.10;
    const MAX_WATER_RATIO = 0.10;
    const ROUGH_RING_DIST = 0.09;
    const MAX_ROUGHNESS = 0.055;

    const rand = seededRandom(7777 + this.seed);
    const forestNoise = createNoise3D(this.seed + 999);

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 2000 && candidates.length < 60) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const forest = forestNoise(nx * 2.5, ny * 2.5, nz * 2.5);
      if (forest > 0.2) continue; // Ensure it's in open lands, away from dense forests

      const normal = new Vector3(nx, ny, nz);

      if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

      const rough = this.terrainRingElevationRoughness(normal, ROUGH_RING_DIST);
      if (rough > MAX_ROUGHNESS) continue;

      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      candidates.push({ normal, elevation });
    }

    candidates.sort((a, b) => a.elevation - b.elevation);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= SHRINE_COUNT) break;
      if (chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT)) continue;
      chosen.push(c.normal);
    }
    if (chosen.length === 0) return;

    const REF_UP = new Vector3(0, 1, 0);

    const SPARKLES_PER_SHRINE = 40;
    const totalSparkles = chosen.length * SPARKLES_PER_SHRINE;
    let sparkleInstanced: InstancedMesh | null = null;
    let sparkleOffsets: Float32Array | null = null;
    let sparkleCenters: Float32Array | null = null;
    let sparkleUps: Float32Array | null = null;

    if (totalSparkles > 0) {
      const sparkleGeo = new PlaneGeometry(0.02, 0.02);
      sparkleOffsets = new Float32Array(totalSparkles);
      sparkleCenters = new Float32Array(totalSparkles * 3);
      sparkleUps = new Float32Array(totalSparkles * 3);

      const sparkleMat = new ShaderMaterial({
        vertexShader: `
          uniform float oceanTime;
          attribute float aOffset;
          attribute vec3 aCenter;
          attribute vec3 aUp;
          attribute float aOpacity;
          varying vec2 vUv;
          varying float vAlpha;
          void main() {
            vUv = uv;
            float t = fract(oceanTime * 0.2 + aOffset);
            
            float s = 0.2 + sin(t * 3.14159) * 1.5;
            
            vec3 pos = aCenter + aUp * (t * 0.8);
            
            vec3 tangent = normalize(cross(aUp, vec3(0.0, 1.0, 0.0)));
            if (length(tangent) < 0.01) tangent = normalize(cross(aUp, vec3(1.0, 0.0, 0.0)));
            vec3 bitangent = cross(aUp, tangent);
            
            pos += tangent * sin(oceanTime * 1.5 + aOffset * 6.28) * 0.12 * t;
            pos += bitangent * cos(oceanTime * 1.2 + aOffset * 6.28) * 0.12 * t;
            
            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            mvPos.xy += position.xy * s;
            
            gl_Position = projectionMatrix * mvPos;
            
            vAlpha = sin(t * 3.14159) * aOpacity;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying float vAlpha;
          void main() {
            float d = length(vUv - vec2(0.5)) * 2.0;
            float a = (1.0 - smoothstep(0.1, 0.8, d)) * vAlpha;
            vec3 color = vec3(1.0, 0.9, 0.6); // Warm magical gold
            gl_FragColor = vec4(color, a);
          }
        `,
        uniforms: { oceanTime: this.oceanTime },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      sparkleInstanced = new InstancedMesh(sparkleGeo, sparkleMat, totalSparkles);
      sparkleInstanced.frustumCulled = false;
      const dummy = new Matrix4();
      for (let i = 0; i < totalSparkles; i++) sparkleInstanced.setMatrixAt(i, dummy);
      this.group.add(sparkleInstanced);
    }

    for (let shrineIdx = 0; shrineIdx < chosen.length; shrineIdx++) {
      const normal = chosen[shrineIdx]!;
      this.shrineCenters.push({ normal: normal.clone() });

      const displacement = surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z);
      const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;

      const shrine = this.buildShrineGroup(rand);
      shrine.position.copy(normal.clone().multiplyScalar(surfaceR));
      shrine.quaternion.setFromUnitVectors(REF_UP, normal);
      shrine.rotateY(rand() * Math.PI * 2);
      shrine.castShadow = true;
      this.group.add(shrine);
      
      if (sparkleInstanced && sparkleOffsets && sparkleCenters && sparkleUps) {
        const shrinePos = normal.clone().multiplyScalar(surfaceR);
        const tangent = new Vector3(-normal.y, normal.x, 0);
        if (tangent.lengthSq() < 0.001) tangent.set(0, -normal.z, normal.y);
        tangent.normalize();
        const bitangent = new Vector3().crossVectors(normal, tangent).normalize();
        
        for (let j = 0; j < SPARKLES_PER_SHRINE; j++) {
          const idx = shrineIdx * SPARKLES_PER_SHRINE + j;
          sparkleOffsets[idx] = rand();
          
          const angle = rand() * Math.PI * 2;
          const dist = rand() * 0.08; // Spread around the shrine
          const startPos = shrinePos.clone()
            .addScaledVector(tangent, Math.cos(angle) * dist)
            .addScaledVector(bitangent, Math.sin(angle) * dist);
            
          sparkleCenters[idx * 3 + 0] = startPos.x;
          sparkleCenters[idx * 3 + 1] = startPos.y;
          sparkleCenters[idx * 3 + 2] = startPos.z;
          sparkleUps[idx * 3 + 0] = normal.x;
          sparkleUps[idx * 3 + 1] = normal.y;
          sparkleUps[idx * 3 + 2] = normal.z;
        }
      }
    }
    
    if (sparkleInstanced && sparkleOffsets && sparkleCenters && sparkleUps) {
      const opacities = new Float32Array(totalSparkles).fill(1);
      sparkleInstanced.geometry.setAttribute('aOffset', new InstancedBufferAttribute(sparkleOffsets, 1));
      sparkleInstanced.geometry.setAttribute('aCenter', new InstancedBufferAttribute(sparkleCenters, 3));
      sparkleInstanced.geometry.setAttribute('aUp', new InstancedBufferAttribute(sparkleUps, 3));
      sparkleInstanced.geometry.setAttribute('aOpacity', new InstancedBufferAttribute(opacities, 1));
      this.shrineSparkleInstanced = sparkleInstanced;
    }
  }

  /** Inland hot springs (GLB) — 4 per world, away from coastlines and other landmarks. */
  private createHotsprings() {
    const HOTSPRING_COUNT = 4;
    const MIN_ELEVATION = 0.005;
    const MAX_ELEVATION = 0.62;
    const MIN_SEPARATION_DOT = 0.78;
    const INLAND_CHECKS = 8;
    const INLAND_CHECK_DIST = 0.07;
    const MAX_WATER_RATIO = 0.26;
    const ROUGH_RING_DIST = 0.085;
    const MAX_ROUGHNESS = 0.26;

    const rand = seededRandom(16161 + this.seed);

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 8000 && candidates.length < 220) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

      const rough = this.terrainRingElevationRoughness(normal, ROUGH_RING_DIST);
      if (rough > MAX_ROUGHNESS) continue;

      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.shrineCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      candidates.push({ normal, elevation });
    }

    candidates.sort((a, b) => a.elevation - b.elevation);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= HOTSPRING_COUNT) break;
      if (chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT)) continue;
      chosen.push(c.normal);
    }
    if (chosen.length === 0) return;

    const REF_UP = new Vector3(0, 1, 0);
    const spin = seededRandom(20202 + this.seed);

    for (const normal of chosen) {
      this.hotspringCenters.push({ normal: normal.clone() });
    }

    const placements = chosen.map((normal) => {
      const displacement = surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z);
      const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;
      return { normal, surfaceR };
    });

    const STEAM_PER_SPRING = 6;
    const totalSteam = placements.length * STEAM_PER_SPRING;
    if (totalSteam > 0) {
      const steamGeo = new PlaneGeometry(0.12, 0.12);
      const offsets = new Float32Array(totalSteam);
      const centers = new Float32Array(totalSteam * 3);
      const upVectors = new Float32Array(totalSteam * 3);

      for (let i = 0; i < placements.length; i++) {
        const { normal, surfaceR } = placements[i]!;
        const pos = normal.clone().multiplyScalar(surfaceR + 0.02);
        
        for (let j = 0; j < STEAM_PER_SPRING; j++) {
          const idx = i * STEAM_PER_SPRING + j;
          offsets[idx] = j / STEAM_PER_SPRING + (seededRandom(this.seed + idx)() * 0.2);
          centers[idx * 3 + 0] = pos.x;
          centers[idx * 3 + 1] = pos.y;
          centers[idx * 3 + 2] = pos.z;
          upVectors[idx * 3 + 0] = normal.x;
          upVectors[idx * 3 + 1] = normal.y;
          upVectors[idx * 3 + 2] = normal.z;
        }
      }
      
      const opacities = new Float32Array(totalSteam).fill(1);
      steamGeo.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 1));
      steamGeo.setAttribute('aCenter', new InstancedBufferAttribute(centers, 3));
      steamGeo.setAttribute('aUp', new InstancedBufferAttribute(upVectors, 3));
      steamGeo.setAttribute('aOpacity', new InstancedBufferAttribute(opacities, 1));

      const steamMat = new ShaderMaterial({
        vertexShader: `
          uniform float oceanTime;
          attribute float aOffset;
          attribute vec3 aCenter;
          attribute vec3 aUp;
          attribute float aOpacity;
          varying vec2 vUv;
          varying float vAlpha;
          void main() {
            vUv = uv;
            float t = fract(oceanTime * 0.35 + aOffset);
            
            float s = 1.0 + t * 2.5;
            
            vec3 pos = aCenter + aUp * (t * 0.4);
            
            vec3 tangent = normalize(cross(aUp, vec3(0.0, 1.0, 0.0)));
            if (length(tangent) < 0.01) tangent = normalize(cross(aUp, vec3(1.0, 0.0, 0.0)));
            vec3 bitangent = cross(aUp, tangent);
            
            pos += tangent * sin(oceanTime * 1.5 + aOffset * 6.28) * 0.08 * t;
            pos += bitangent * cos(oceanTime * 1.2 + aOffset * 6.28) * 0.08 * t;
            
            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            mvPos.xy += position.xy * s;
            
            gl_Position = projectionMatrix * mvPos;
            
            vAlpha = sin(t * 3.14159) * (1.0 - t) * aOpacity;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying float vAlpha;
          void main() {
            float d = length(vUv - vec2(0.5)) * 2.0;
            float a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha * 0.4;
            gl_FragColor = vec4(0.9, 0.9, 0.9, a);
          }
        `,
        uniforms: { oceanTime: this.oceanTime },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      const steamInstanced = new InstancedMesh(steamGeo, steamMat, totalSteam);
      steamInstanced.frustumCulled = false;
      const dummy = new Matrix4();
      for (let i = 0; i < totalSteam; i++) steamInstanced.setMatrixAt(i, dummy);
      this.group.add(steamInstanced);
      this.hotspringSteamInstanced = steamInstanced;
    }

    const loader = new GLTFLoader();
    loader.load(
      "/3D/hotspring.glb",
      (gltf) => {
      const template = gltf.scene;
      template.updateMatrixWorld(true);
      const box = new Box3().setFromObject(template);
      const size = new Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
      const targetSize = 0.288;
      const uniformScale = targetSize / maxDim;

      for (const { normal, surfaceR } of placements) {
        const model = template.clone(true);
        model.scale.setScalar(uniformScale);
        model.position.copy(normal.clone().multiplyScalar(surfaceR));
        model.quaternion.setFromUnitVectors(REF_UP, normal);
        model.rotateY(spin() * Math.PI * 2);
        model.updateMatrixWorld(true);
        let minAlong = minMeshVertexProjectionAlongNormal(model, normal);
        if (!Number.isFinite(minAlong)) {
          const bb = new Box3().setFromObject(model);
          const corners = [
            new Vector3(bb.min.x, bb.min.y, bb.min.z),
            new Vector3(bb.max.x, bb.min.y, bb.min.z),
            new Vector3(bb.min.x, bb.max.y, bb.min.z),
            new Vector3(bb.max.x, bb.max.y, bb.min.z),
            new Vector3(bb.min.x, bb.min.y, bb.max.z),
            new Vector3(bb.max.x, bb.min.y, bb.max.z),
            new Vector3(bb.min.x, bb.max.y, bb.max.z),
            new Vector3(bb.max.x, bb.max.y, bb.max.z),
          ];
          minAlong = Infinity;
          for (const c of corners) {
            const d = c.dot(normal);
            if (d < minAlong) minAlong = d;
          }
        }
        const lift = surfaceR - minAlong;
        model.position.addScaledVector(normal, lift);

        model.traverse((child) => {
          if ((child as Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.group.add(model);
      }
    },
      undefined,
      (err) => {
        console.error("[Globe] Failed to load /3D/hotspring.glb:", err);
      },
    );
  }

  /** Inland mushroom groves — 4 per world, away from coastlines and other landmarks. */
  private createMushrooms() {
    const MUSHROOM_COUNT = 4;
    const MIN_ELEVATION = 0.05;
    const MAX_ELEVATION = 0.65;
    const MIN_SEPARATION_DOT = 0.78;
    const INLAND_CHECKS = 8;
    const INLAND_CHECK_DIST = 0.07;
    const MAX_WATER_RATIO = 0.26;
    const ROUGH_RING_DIST = 0.085;
    const MAX_ROUGHNESS = 0.26;

    const rand = seededRandom(445566 + this.seed);

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 8000 && candidates.length < 220) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

      const rough = this.terrainRingElevationRoughness(normal, ROUGH_RING_DIST);
      if (rough > MAX_ROUGHNESS) continue;

      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.shrineCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.hotspringCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      candidates.push({ normal, elevation });
    }

    candidates.sort((a, b) => a.elevation - b.elevation);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= MUSHROOM_COUNT) break;
      if (chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT)) continue;
      chosen.push(c.normal);
    }
    if (chosen.length === 0) return;

    const REF_UP = new Vector3(0, 1, 0);

    const stalkGeo = new CylinderGeometry(0.0015, 0.0025, 0.02, 5);
    stalkGeo.translate(0, 0.01, 0);
    const capGeo = new SphereGeometry(0.008, 7, 5);
    capGeo.scale(1, 0.6, 1);
    capGeo.translate(0, 0.02, 0);

    const pastelColors = [0xffb3ba, 0xbaffc9, 0xbae1ff, 0xe6b3ff, 0xffffba, 0xffdfba];
    const stalkMat = new MeshPhongMaterial({ color: 0xddddcc, flatShading: true });
    addRimLight(stalkMat, 0xffffff, 0.3, 2.0);

    const capMats = pastelColors.map(c => {
      const m = new MeshPhongMaterial({ color: c, flatShading: true });
      addRimLight(m, 0xffffff, 0.4, 2.5);
      return m;
    });

    const SPORES_PER_GROVE = 45;
    const STREAMS_PER_GROVE = 3;
    const SPORES_PER_STREAM = SPORES_PER_GROVE / STREAMS_PER_GROVE;
    const totalSpores = chosen.length * SPORES_PER_GROVE;
    let sporeInstanced: InstancedMesh | null = null;
    let sporeOffsets: Float32Array | null = null;
    let sporeCenters: Float32Array | null = null;
    let sporeUps: Float32Array | null = null;
    let sporeColors: Float32Array | null = null;

    if (totalSpores > 0) {
      const sporeGeo = new PlaneGeometry(0.015, 0.015);
      sporeOffsets = new Float32Array(totalSpores);
      sporeCenters = new Float32Array(totalSpores * 3);
      sporeUps = new Float32Array(totalSpores * 3);
      sporeColors = new Float32Array(totalSpores * 3);

      const sporeMat = new ShaderMaterial({
        vertexShader: `
          uniform float oceanTime;
          attribute float aOffset;
          attribute vec3 aCenter;
          attribute vec3 aUp;
          attribute vec3 aColor;
          attribute float aOpacity;
          varying vec2 vUv;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            vUv = uv;
            vColor = aColor;
            float t = fract(oceanTime * 0.15 + aOffset);
            
            float s = 0.5 + t * 1.0;
            
            vec3 pos = aCenter + aUp * (t * 0.7);
            
            vec3 tangent = normalize(cross(aUp, vec3(0.0, 1.0, 0.0)));
            if (length(tangent) < 0.01) tangent = normalize(cross(aUp, vec3(1.0, 0.0, 0.0)));
            vec3 bitangent = cross(aUp, tangent);
            
            float streamPhase = aCenter.x * 10.0 + aCenter.z * 10.0;
            float streamSwayX = sin(oceanTime * 1.2 + streamPhase + t * 4.0) * 0.06 * t;
            float streamSwayY = cos(oceanTime * 0.9 + streamPhase + t * 3.0) * 0.06 * t;
            
            float individualSwayX = sin(oceanTime * 3.0 + aOffset * 6.28) * 0.015 * t;
            float individualSwayY = cos(oceanTime * 2.5 + aOffset * 6.28) * 0.015 * t;
            
            pos += tangent * (streamSwayX + individualSwayX);
            pos += bitangent * (streamSwayY + individualSwayY);
            
            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            mvPos.xy += position.xy * s;
            
            gl_Position = projectionMatrix * mvPos;
            
            float streamAlpha = sin(oceanTime * 0.5 + streamPhase) * 0.5 + 0.5;
            vAlpha = sin(t * 3.14159) * streamAlpha * aOpacity;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float d = length(vUv - vec2(0.5)) * 2.0;
            float a = (1.0 - smoothstep(0.3, 1.0, d)) * vAlpha * 0.85;
            gl_FragColor = vec4(vColor, a);
          }
        `,
        uniforms: { oceanTime: this.oceanTime },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });

      sporeInstanced = new InstancedMesh(sporeGeo, sporeMat, totalSpores);
      sporeInstanced.frustumCulled = false;
      const dummy = new Matrix4();
      for (let i = 0; i < totalSpores; i++) sporeInstanced.setMatrixAt(i, dummy);
      this.group.add(sporeInstanced);
    }

    for (let groveIdx = 0; groveIdx < chosen.length; groveIdx++) {
      const normal = chosen[groveIdx]!;
      this.mushroomCenters.push({ normal: normal.clone() });
      const groveGroup = new Group();
      
      const tangent = new Vector3(-normal.y, normal.x, 0);
      if (tangent.lengthSq() < 0.001) tangent.set(0, -normal.z, normal.y);
      tangent.normalize();
      const bitangent = new Vector3().crossVectors(normal, tangent).normalize();

      // 1. Ring of larger mushrooms
      const numLarge = 6 + Math.floor(rand() * 3);
      for (let i = 0; i < numLarge; i++) {
        const angle = (i / numLarge) * Math.PI * 2 + rand() * 0.5;
        const dist = 0.04 + rand() * 0.005;
        const mNormal = normal.clone()
          .addScaledVector(tangent, Math.cos(angle) * dist)
          .addScaledVector(bitangent, Math.sin(angle) * dist)
          .normalize();

        const displacement = surfaceDisplacementAt(this.seed, this.terrainType, mNormal.x, mNormal.y, mNormal.z);
        const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;
        const mPos = mNormal.clone().multiplyScalar(surfaceR);

        const scale = 2.0 + rand() * 1.2;
        const capColorIdx = Math.floor(rand() * capMats.length);

        const stalk = new Mesh(stalkGeo, stalkMat);
        stalk.scale.setScalar(scale);
        stalk.position.copy(mPos);
        stalk.quaternion.setFromUnitVectors(REF_UP, mNormal);
        stalk.rotateX((rand() - 0.5) * 0.3);
        stalk.rotateZ((rand() - 0.5) * 0.3);
        stalk.rotateY(rand() * Math.PI * 2);
        stalk.castShadow = true;
        stalk.receiveShadow = true;
        groveGroup.add(stalk);

        const cap = new Mesh(capGeo, capMats[capColorIdx]);
        cap.scale.setScalar(scale);
        cap.position.copy(stalk.position);
        cap.quaternion.copy(stalk.quaternion);
        cap.castShadow = true;
        cap.receiveShadow = true;
        groveGroup.add(cap);
      }

      // 2. Scatter of smaller mushrooms
      const numMushrooms = 15 + Math.floor(rand() * 10);
      for (let i = 0; i < numMushrooms; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * 0.035;
        const mNormal = normal.clone()
          .addScaledVector(tangent, Math.cos(angle) * dist)
          .addScaledVector(bitangent, Math.sin(angle) * dist)
          .normalize();

        const displacement = surfaceDisplacementAt(this.seed, this.terrainType, mNormal.x, mNormal.y, mNormal.z);
        const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;
        const mPos = mNormal.clone().multiplyScalar(surfaceR);

        const scale = 0.5 + rand() * 1.2;
        const capColorIdx = Math.floor(rand() * capMats.length);

        const stalk = new Mesh(stalkGeo, stalkMat);
        stalk.scale.setScalar(scale);
        stalk.position.copy(mPos);
        stalk.quaternion.setFromUnitVectors(REF_UP, mNormal);
        stalk.rotateX((rand() - 0.5) * 0.4);
        stalk.rotateZ((rand() - 0.5) * 0.4);
        stalk.rotateY(rand() * Math.PI * 2);
        stalk.castShadow = true;
        stalk.receiveShadow = true;
        groveGroup.add(stalk);

        const cap = new Mesh(capGeo, capMats[capColorIdx]);
        cap.scale.setScalar(scale);
        cap.position.copy(stalk.position);
        cap.quaternion.copy(stalk.quaternion);
        cap.castShadow = true;
        cap.receiveShadow = true;
        groveGroup.add(cap);
      }
      
      // 3. Spores
      if (sporeInstanced && sporeOffsets && sporeCenters && sporeUps && sporeColors) {
        for (let s = 0; s < STREAMS_PER_GROVE; s++) {
          const angle = rand() * Math.PI * 2;
          const dist = rand() * 0.03;
          const streamNormal = normal.clone()
            .addScaledVector(tangent, Math.cos(angle) * dist)
            .addScaledVector(bitangent, Math.sin(angle) * dist)
            .normalize();
            
          const streamPos = streamNormal.clone().multiplyScalar(this.radius + surfaceDisplacementAt(this.seed, this.terrainType, streamNormal.x, streamNormal.y, streamNormal.z));
          
          for (let j = 0; j < SPORES_PER_STREAM; j++) {
            const idx = groveIdx * SPORES_PER_GROVE + s * SPORES_PER_STREAM + j;
            sporeOffsets[idx] = rand();
            sporeCenters[idx * 3 + 0] = streamPos.x;
            sporeCenters[idx * 3 + 1] = streamPos.y;
            sporeCenters[idx * 3 + 2] = streamPos.z;
            sporeUps[idx * 3 + 0] = streamNormal.x;
            sporeUps[idx * 3 + 1] = streamNormal.y;
            sporeUps[idx * 3 + 2] = streamNormal.z;
            
            const colorHex = pastelColors[Math.floor(rand() * pastelColors.length)]!;
            sporeColors[idx * 3 + 0] = ((colorHex >> 16) & 255) / 255;
            sporeColors[idx * 3 + 1] = ((colorHex >> 8) & 255) / 255;
            sporeColors[idx * 3 + 2] = (colorHex & 255) / 255;
          }
        }
      }

      this.group.add(groveGroup);
    }
    
    if (sporeInstanced && sporeOffsets && sporeCenters && sporeUps && sporeColors) {
      const opacities = new Float32Array(totalSpores).fill(1);
      sporeInstanced.geometry.setAttribute('aOffset', new InstancedBufferAttribute(sporeOffsets, 1));
      sporeInstanced.geometry.setAttribute('aCenter', new InstancedBufferAttribute(sporeCenters, 3));
      sporeInstanced.geometry.setAttribute('aUp', new InstancedBufferAttribute(sporeUps, 3));
      sporeInstanced.geometry.setAttribute('aColor', new InstancedBufferAttribute(sporeColors, 3));
      sporeInstanced.geometry.setAttribute('aOpacity', new InstancedBufferAttribute(opacities, 1));
      this.mushroomSporeInstanced = sporeInstanced;
    }
  }

  private createButterflyGardens() {
    const GARDEN_COUNT = 4;
    const MIN_ELEVATION = 0.005;
    const MAX_ELEVATION = 0.62;
    const MIN_SEPARATION_DOT = 0.78;
    const INLAND_CHECKS = 8;
    const INLAND_CHECK_DIST = 0.07;
    const MAX_WATER_RATIO = 0.26;
    const ROUGH_RING_DIST = 0.085;
    const MAX_ROUGHNESS = 0.26;

    const rand = seededRandom(223344 + this.seed);

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 8000 && candidates.length < 220) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

      const rough = this.terrainRingElevationRoughness(normal, ROUGH_RING_DIST);
      if (rough > MAX_ROUGHNESS) continue;

      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.shrineCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.hotspringCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.mushroomCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      candidates.push({ normal, elevation });
    }

    candidates.sort((a, b) => a.elevation - b.elevation);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= GARDEN_COUNT) break;
      if (chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT)) continue;
      chosen.push(c.normal);
    }
    if (chosen.length === 0) return;

    const REF_UP = new Vector3(0, 1, 0);

    const stalkGeo = new CylinderGeometry(0.001, 0.0015, 0.015, 5);
    stalkGeo.translate(0, 0.0075, 0);
    const petalGeo = new SphereGeometry(0.004, 5, 4);
    petalGeo.scale(1, 0.2, 1.5);
    petalGeo.translate(0, 0, 0.004);
    const centerGeo = new SphereGeometry(0.003, 5, 4);

    const flowerColors = [0xff66a3, 0x66a3ff, 0xffcc66, 0xb366ff, 0xff9966, 0xffffff];
    const stalkMat = new MeshPhongMaterial({ color: 0x44aa44, flatShading: true });
    addRimLight(stalkMat, 0xffffff, 0.3, 2.0);
    const centerMat = new MeshPhongMaterial({ color: 0xffdd44, flatShading: true });

    const petalMats = flowerColors.map(c => {
      const m = new MeshPhongMaterial({ color: c, flatShading: true });
      addRimLight(m, 0xffffff, 0.4, 2.5);
      return m;
    });

    const BUTTERFLIES_PER_GARDEN = 25;
    const totalButterflies = chosen.length * BUTTERFLIES_PER_GARDEN;
    let butterflyInstanced: InstancedMesh | null = null;
    let butterflyOffsets: Float32Array | null = null;
    let butterflyCenters: Float32Array | null = null;
    let butterflyUps: Float32Array | null = null;
    let butterflyColors: Float32Array | null = null;

    if (totalButterflies > 0) {
      const butterflyGeo = new PlaneGeometry(0.015, 0.015);
      butterflyOffsets = new Float32Array(totalButterflies);
      butterflyCenters = new Float32Array(totalButterflies * 3);
      butterflyUps = new Float32Array(totalButterflies * 3);
      butterflyColors = new Float32Array(totalButterflies * 3);

      const butterflyMat = new ShaderMaterial({
        vertexShader: `
          uniform float oceanTime;
          attribute float aOffset;
          attribute vec3 aCenter;
          attribute vec3 aUp;
          attribute vec3 aColor;
          attribute float aOpacity;
          varying vec2 vUv;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            vUv = uv;
            vColor = aColor;
            
            // Fast flapping based on time and offset
            float flapSpeed = 30.0 + fract(aOffset * 10.0) * 10.0;
            float flap = abs(cos(oceanTime * flapSpeed + aOffset * 100.0));
            
            // More chaotic wandering
            float t = oceanTime * (0.4 + fract(aOffset * 21.0) * 0.4) + aOffset * 6.28;
            
            vec3 tangent = normalize(cross(aUp, vec3(0.0, 1.0, 0.0)));
            if (length(tangent) < 0.01) tangent = normalize(cross(aUp, vec3(1.0, 0.0, 0.0)));
            vec3 bitangent = cross(aUp, tangent);
            
            // Orbit radius and height variation with darting
            float rX = (0.03 + fract(aOffset * 34.0) * 0.04) * sin(t * 1.31) * cos(t * 0.73);
            float rZ = (0.03 + fract(aOffset * 56.0) * 0.04) * cos(t * 1.17) * sin(t * 0.89);
            float dart = sin(oceanTime * 5.0 + aOffset * 10.0) * 0.005;
            float h = 0.015 + fract(aOffset * 78.0) * 0.02 + sin(t * 2.23) * 0.015 + cos(t * 0.5) * 0.01 + dart;
            
            vec3 pos = aCenter + aUp * h;
            pos += tangent * rX * 1.5;
            pos += bitangent * rZ * 1.5;
            
            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            
            // Add a slight tilt to the butterfly based on its movement direction and flap
            float tilt = sin(t * 1.31) * 0.3 + flap * 0.15;
            float s = sin(tilt);
            float c = cos(tilt);
            
            // Rotate the quad in view space
            float rx = position.x * c - position.y * s;
            float ry = position.x * s + position.y * c;
            
            // Apply flapping scale on X axis in view space (always faces camera but flaps)
            mvPos.x += rx * (0.2 + flap * 0.8);
            mvPos.y += ry;
            
            gl_Position = projectionMatrix * mvPos;
            
            vAlpha = aOpacity;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            // Simple butterfly shape (two triangles/wings)
            float d = length(vUv - vec2(0.5));
            float wing = smoothstep(0.5, 0.3, d);
            // Cut out the middle slightly
            float centerCut = smoothstep(0.0, 0.1, abs(vUv.x - 0.5));
            float a = wing * centerCut * vAlpha;
            
            // Darker edges
            vec3 color = mix(vColor * 0.4, vColor, smoothstep(0.4, 0.2, d));
            gl_FragColor = vec4(color, a);
          }
        `,
        uniforms: { oceanTime: this.oceanTime },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });

      butterflyInstanced = new InstancedMesh(butterflyGeo, butterflyMat, totalButterflies);
      butterflyInstanced.frustumCulled = false;
      const dummy = new Matrix4();
      for (let i = 0; i < totalButterflies; i++) butterflyInstanced.setMatrixAt(i, dummy);
      this.group.add(butterflyInstanced);
    }

    const butterflyPalette = [0xffaa00, 0x4488ff, 0xff44aa, 0xffff44, 0xaa44ff];

    for (let gardenIdx = 0; gardenIdx < chosen.length; gardenIdx++) {
      const normal = chosen[gardenIdx]!;
      this.butterflyCenters.push({ normal: normal.clone() });
      const gardenGroup = new Group();
      
      const tangent = new Vector3(-normal.y, normal.x, 0);
      if (tangent.lengthSq() < 0.001) tangent.set(0, -normal.z, normal.y);
      tangent.normalize();
      const bitangent = new Vector3().crossVectors(normal, tangent).normalize();

      // Flowers
      const numFlowers = 36 + Math.floor(rand() * 16);
      for (let i = 0; i < numFlowers; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * 0.055;
        const fNormal = normal.clone()
          .addScaledVector(tangent, Math.cos(angle) * dist)
          .addScaledVector(bitangent, Math.sin(angle) * dist)
          .normalize();

        const displacement = surfaceDisplacementAt(this.seed, this.terrainType, fNormal.x, fNormal.y, fNormal.z);
        const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;
        const fPos = fNormal.clone().multiplyScalar(surfaceR);

        const scale = 0.6 + rand() * 0.8;
        const colorIdx = Math.floor(rand() * petalMats.length);

        const flower = new Group();
        flower.position.copy(fPos);
        flower.quaternion.setFromUnitVectors(REF_UP, fNormal);
        flower.rotateX((rand() - 0.5) * 0.3);
        flower.rotateZ((rand() - 0.5) * 0.3);
        flower.rotateY(rand() * Math.PI * 2);
        flower.scale.setScalar(scale);

        const stalk = new Mesh(stalkGeo, stalkMat);
        stalk.castShadow = true;
        stalk.receiveShadow = true;
        flower.add(stalk);

        const center = new Mesh(centerGeo, centerMat);
        center.position.y = 0.015;
        flower.add(center);

        for (let p = 0; p < 5; p++) {
          const petal = new Mesh(petalGeo, petalMats[colorIdx]);
          petal.position.y = 0.015;
          petal.rotation.y = (p / 5) * Math.PI * 2;
          petal.rotation.x = 0.2; // Slight tilt outward
          flower.add(petal);
        }

        gardenGroup.add(flower);
      }
      
      // Butterflies
      if (butterflyInstanced && butterflyOffsets && butterflyCenters && butterflyUps && butterflyColors) {
        for (let j = 0; j < BUTTERFLIES_PER_GARDEN; j++) {
          const idx = gardenIdx * BUTTERFLIES_PER_GARDEN + j;
          butterflyOffsets[idx] = rand();
          
          // Center of this garden
          const centerPos = normal.clone().multiplyScalar(this.radius + surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z));
          
          butterflyCenters[idx * 3 + 0] = centerPos.x;
          butterflyCenters[idx * 3 + 1] = centerPos.y;
          butterflyCenters[idx * 3 + 2] = centerPos.z;
          butterflyUps[idx * 3 + 0] = normal.x;
          butterflyUps[idx * 3 + 1] = normal.y;
          butterflyUps[idx * 3 + 2] = normal.z;
          
          const colorHex = butterflyPalette[Math.floor(rand() * butterflyPalette.length)]!;
          butterflyColors[idx * 3 + 0] = ((colorHex >> 16) & 255) / 255;
          butterflyColors[idx * 3 + 1] = ((colorHex >> 8) & 255) / 255;
          butterflyColors[idx * 3 + 2] = (colorHex & 255) / 255;
        }
      }

      this.group.add(gardenGroup);
    }
    
    if (butterflyInstanced && butterflyOffsets && butterflyCenters && butterflyUps && butterflyColors) {
      const opacities = new Float32Array(totalButterflies).fill(1);
      butterflyInstanced.geometry.setAttribute('aOffset', new InstancedBufferAttribute(butterflyOffsets, 1));
      butterflyInstanced.geometry.setAttribute('aCenter', new InstancedBufferAttribute(butterflyCenters, 3));
      butterflyInstanced.geometry.setAttribute('aUp', new InstancedBufferAttribute(butterflyUps, 3));
      butterflyInstanced.geometry.setAttribute('aColor', new InstancedBufferAttribute(butterflyColors, 3));
      butterflyInstanced.geometry.setAttribute('aOpacity', new InstancedBufferAttribute(opacities, 1));
      this.butterflyInstanced = butterflyInstanced;
    }
  }

  /** Inland `pyramid.glb` — exactly one in lowlands (low terrain elevation, not hills); flat, away from coasts. */
  private createPyramid() {
    /** Same idea as {@link createStonehenges} — exclude upland / hill terrain. */
    const MIN_ELEVATION = 0.02;
    const MAX_ELEVATION = 0.32;
    const INLAND_CHECKS = 8;
    const INLAND_CHECK_DIST = 0.07;
    const MAX_WATER_RATIO = 0.26;
    const ROUGH_RING_DIST = 0.085;
    const MAX_ROUGHNESS = 0.26;

    const rand = seededRandom(939191 + this.seed);

    type Pooled = { normal: Vector3; elevation: number; rough: number };
    const pool: Pooled[] = [];
    let attempts = 0;

    while (attempts < 12000 && pool.length < 400) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

      const rough = this.terrainRingElevationRoughness(normal, ROUGH_RING_DIST);
      if (rough > MAX_ROUGHNESS) continue;

      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.shrineCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.hotspringCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.mushroomCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.butterflyCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      pool.push({ normal, elevation, rough });
    }

    if (pool.length === 0) return;

    // Prefer the lowest, flattest lowland. Pick 2 well-separated sites.
    pool.sort((a, b) => a.elevation - b.elevation || a.rough - b.rough);

    const chosen: Vector3[] = [];
    const MIN_SEPARATION_DOT = 0.80; // ~37° apart — ensures pyramids are far apart
    for (const candidate of pool) {
      if (chosen.some((c) => c.dot(candidate.normal) > MIN_SEPARATION_DOT)) continue;
      chosen.push(candidate.normal.clone());
      if (chosen.length >= 2) break;
    }

    const spin = seededRandom(484848 + this.seed);
    const REF_UP = new Vector3(0, 1, 0);

    for (const normal of chosen) {
      this.pyramidCenters.push({ normal: normal.clone() });
    }

    const loader = new GLTFLoader();
    loader.load(
      "/3D/pyramid.glb",
      (gltf) => {
        const template = gltf.scene;
        template.updateMatrixWorld(true);
        const box = new Box3().setFromObject(template);
        const size = new Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
        const targetSize = 0.36;
        const uniformScale = targetSize / maxDim;

        for (const normal of chosen) {
          const displacement = surfaceDisplacementAt(
            this.seed,
            this.terrainType,
            normal.x,
            normal.y,
            normal.z,
          );
          const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;

          const model = template.clone(true);
          model.scale.setScalar(uniformScale);
          model.position.copy(normal.clone().multiplyScalar(surfaceR));
          model.quaternion.setFromUnitVectors(REF_UP, normal);
          model.rotateY(spin() * Math.PI * 2);
          model.updateMatrixWorld(true);
          let minAlong = minMeshVertexProjectionAlongNormal(model, normal);
          if (!Number.isFinite(minAlong)) {
            const bb = new Box3().setFromObject(model);
            const corners = [
              new Vector3(bb.min.x, bb.min.y, bb.min.z),
              new Vector3(bb.max.x, bb.min.y, bb.min.z),
              new Vector3(bb.min.x, bb.max.y, bb.min.z),
              new Vector3(bb.max.x, bb.max.y, bb.min.z),
              new Vector3(bb.min.x, bb.min.y, bb.max.z),
              new Vector3(bb.max.x, bb.min.y, bb.max.z),
              new Vector3(bb.min.x, bb.max.y, bb.max.z),
              new Vector3(bb.max.x, bb.max.y, bb.max.z),
            ];
            minAlong = Infinity;
            for (const c of corners) {
              const d = c.dot(normal);
              if (d < minAlong) minAlong = d;
            }
          }
          const lift = surfaceR - minAlong;
          model.position.addScaledVector(normal, lift);

          model.traverse((child) => {
            if ((child as Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.applyRimLightToPyramid(model);
          this.group.add(model);
        }
      },
      undefined,
      (err) => {
        console.error("[Globe] Failed to load /3D/pyramid.glb:", err);
      },
    );
  }

  /**
   * Eternal-victory memorial: call after {@link ProgressionManager} may have gained
   * `moonFrozenByEternalFlames` since this globe was constructed (menu preview builds the
   * globe once; winning in-session left the old globe without a statue until reload).
   */
  syncMemorialStatueWithProgression() {
    this.createStatue();
  }

  /** Inland `statue.glb` — one flat lowland, separated from pyramids and other landmarks. */
  private createStatue() {
    if (!ProgressionManager.loadPlayerWorldState().moonFrozenByEternalFlames) return;
    if (this.memorialStatueSpawned || this.memorialStatueLoadStarted) return;

    const MIN_ELEVATION = 0.02;
    const MAX_ELEVATION = 0.32;
    const INLAND_CHECKS = 8;
    const INLAND_CHECK_DIST = 0.07;
    const MAX_WATER_RATIO = 0.26;
    const ROUGH_RING_DIST = 0.09;
    /** Prefer flat sites; relax caps so a site always exists and stays discoverable. */
    const ROUGHNESS_CAPS = [0.14, 0.22, 0.3] as const;
    /** Stay clearly off the pyramid sites (pyramids use 0.80 separation). */
    const MIN_AWAY_FROM_PYRAMID_DOT = 0.78;

    const rand = seededRandom(626262 + this.seed);

    type Pooled = { normal: Vector3; elevation: number; rough: number };
    const pool: Pooled[] = [];

    for (const roughCap of ROUGHNESS_CAPS) {
      pool.length = 0;
      let attempts = 0;
      while (attempts < 12000 && pool.length < 400) {
        attempts++;
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(theta);

        const terrain = this.sampleTerrainAt(nx, ny, nz);
        if (!terrain.isLand) continue;
        const elevation = terrain.elevation;
        if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

        const normal = new Vector3(nx, ny, nz);

        if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

        const rough = this.terrainRingElevationRoughness(normal, ROUGH_RING_DIST);
        if (rough > roughCap) continue;

        if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.shrineCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.hotspringCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.mushroomCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.butterflyCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
        if (this.pyramidCenters.some((v) => normal.dot(v.normal) > MIN_AWAY_FROM_PYRAMID_DOT)) continue;

        pool.push({ normal, elevation, rough });
      }
      if (pool.length > 0) break;
    }

    if (pool.length === 0) return;

    /* Prefer the flattest lowland pockets; tie-break toward lower elevation (plains). */
    pool.sort((a, b) => a.rough - b.rough || a.elevation - b.elevation);
    const siteNormal = pool[0]!.normal.clone();

    this.memorialStatueLoadStarted = true;
    this.statueCenters.push({ normal: siteNormal.clone() });

    const spin = seededRandom(919191 + this.seed);
    const REF_UP = new Vector3(0, 1, 0);

    const loader = new GLTFLoader();
    loader.load(
      "/3D/statue.glb",
      (gltf) => {
        const template = gltf.scene;
        template.updateMatrixWorld(true);
        const box = new Box3().setFromObject(template);
        const size = new Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
        const targetSize = 0.42;
        const uniformScale = targetSize / maxDim;

        const normal = siteNormal;
        const displacement = surfaceDisplacementAt(
          this.seed,
          this.terrainType,
          normal.x,
          normal.y,
          normal.z,
        );
        const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;

        const model = template.clone(true);
        model.scale.setScalar(uniformScale);
        model.position.copy(normal.clone().multiplyScalar(surfaceR));
        model.quaternion.setFromUnitVectors(REF_UP, normal);
        model.rotateY(spin() * Math.PI * 2);
        model.updateMatrixWorld(true);
        let minAlong = minMeshVertexProjectionAlongNormal(model, normal);
        if (!Number.isFinite(minAlong)) {
          const bb = new Box3().setFromObject(model);
          const corners = [
            new Vector3(bb.min.x, bb.min.y, bb.min.z),
            new Vector3(bb.max.x, bb.min.y, bb.min.z),
            new Vector3(bb.min.x, bb.max.y, bb.min.z),
            new Vector3(bb.max.x, bb.max.y, bb.min.z),
            new Vector3(bb.min.x, bb.min.y, bb.max.z),
            new Vector3(bb.max.x, bb.min.y, bb.max.z),
            new Vector3(bb.min.x, bb.max.y, bb.max.z),
            new Vector3(bb.max.x, bb.max.y, bb.max.z),
          ];
          minAlong = Infinity;
          for (const c of corners) {
            const d = c.dot(normal);
            if (d < minAlong) minAlong = d;
          }
        }
        const lift = surfaceR - minAlong;
        model.position.addScaledVector(normal, lift);

        model.traverse((child) => {
          if ((child as Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.applyRimLightToPyramid(model);

        /* World AABB → model-local highest Y (local +Y is surface “up” after grounding). */
        model.updateMatrixWorld(true);
        const worldB = new Box3().setFromObject(model);
        const invWorld = new Matrix4().copy(model.matrixWorld).invert();
        const corner = new Vector3();
        let localTopY = -Infinity;
        for (let ix = 0; ix <= 1; ix++) {
          for (let iy = 0; iy <= 1; iy++) {
            for (let iz = 0; iz <= 1; iz++) {
              corner.set(
                ix ? worldB.max.x : worldB.min.x,
                iy ? worldB.max.y : worldB.min.y,
                iz ? worldB.max.z : worldB.min.z,
              );
              corner.applyMatrix4(invWorld);
              if (corner.y > localTopY) localTopY = corner.y;
            }
          }
        }
        const beaconAnchorY = localTopY - 1.2;

        /* Same crossed planes + shader as package delivery destination beam (`0x88ccff`). */
        const memorialBeam = createPackageQuestBeamGroup(0x88ccff, {
          timeUniform: this.statueBeamTimeU,
          height: Math.max(this.radius * 0.42, 2.0),
          width: 0.11,
        });
        memorialBeam.position.set(0, beaconAnchorY, 0);
        memorialBeam.renderOrder = 1;
        model.add(memorialBeam);

        this.group.add(model);
        this.memorialStatueSpawned = true;
      },
      undefined,
      (err) => {
        this.memorialStatueLoadStarted = false;
        if (this.statueCenters.length > 0) this.statueCenters.pop();
        console.error("[Globe] Failed to load /3D/statue.glb:", err);
      },
    );
  }

  /** Fresnel rim on `pyramid.glb` meshes — matches {@link globalRimColor} / day–night. */
  private applyRimLightToPyramid(root: Object3D) {
    const RIM_I = 0.52;
    const RIM_P = 2.75;
    root.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || m.userData.globePyramidRim) continue;
        m.userData.globePyramidRim = true;
        if (m instanceof MeshPhongMaterial) {
          addRimLight(m, globalRimColor, RIM_I, RIM_P);
        } else if (m instanceof MeshLambertMaterial) {
          addRimLightWithColor(m, globalRimColor, RIM_I, RIM_P);
        } else if (m instanceof MeshStandardMaterial || m instanceof MeshPhysicalMaterial) {
          addRimLightToStandard(m, globalRimColor, RIM_I, RIM_P);
        }
      }
    });
  }

  /**
   * Two giant buried halves of the moonstone ring at inland sites (left / right GLB),
   * grounded on terrain and sunk along the surface normal for a ruin look.
   */
  private createMoonstoneRuins() {
    const RUIN_COUNT = MOONSTONE_RUIN_COUNT;
    const MIN_ELEVATION = 0.06;
    const MAX_ELEVATION = 0.7;
    const MIN_SEPARATION_DOT = 0.84;
    const INLAND_CHECKS = 8;
    const INLAND_CHECK_DIST = 0.07;
    const MAX_WATER_RATIO = 0.26;
    const ROUGH_RING_DIST = 0.085;
    const MAX_ROUGHNESS = 0.26;
    /** World units: max dimension after scale (~half of the original giant ruin size). */
    const TARGET_MAX_DIM = 0.875;
    /** Fraction of {@link TARGET_MAX_DIM} buried below nominal ground after grounding. */
    const BURY_DEPTH_RATIO = 0.44;
    /** Tilt the carved face toward the zenith (rad); primary = along surface tangent, secondary = diagonal. */
    const TILT_ORNATE_TOWARD_SKY = 0.36;
    const TILT_DIAGONAL = 0.14;

    const rand = seededRandom(771133 + this.seed);

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 8000 && candidates.length < 220) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      if (this.waterRatioAround(normal, INLAND_CHECK_DIST, INLAND_CHECKS) > MAX_WATER_RATIO) continue;

      const rough = this.terrainRingElevationRoughness(normal, ROUGH_RING_DIST);
      if (rough > MAX_ROUGHNESS) continue;

      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.shrineCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.hotspringCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.mushroomCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.butterflyCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.pyramidCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.statueCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      candidates.push({ normal, elevation });
    }

    candidates.sort((a, b) => a.elevation - b.elevation);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= RUIN_COUNT) break;
      if (chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT)) continue;
      chosen.push(c.normal);
    }
    if (chosen.length === 0) return;

    const placements = chosen.map((normal) => {
      const displacement = surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z);
      const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;
      return { normal, surfaceR };
    });
    for (const { normal, surfaceR } of placements) {
      this.moonstoneRuinCenters.push({ normal: normal.clone() });
      this.moonstoneRuins.push({
        normal: normal.clone(),
        tangent: new Vector3(),
        bitangent: new Vector3(),
        basePosition: normal.clone().multiplyScalar(surfaceR),
        root: null,
        cycleStartAt: null,
        restQuaternion: new Quaternion(),
        dust: null,
        rimMaterials: [],
        rimIntensityUniforms: [],
      });
    }

    const REF_UP = new Vector3(0, 1, 0);
    const spin = seededRandom(991122 + this.seed);

    const placeModel = (gltf: { scene: Object3D }, index: number) => {
      const state = this.moonstoneRuins[index];
      const placement = placements[index];
      if (!state || !placement) return;
      const { normal, surfaceR } = placement;
      const template = gltf.scene;
      template.updateMatrixWorld(true);
      const box = new Box3().setFromObject(template);
      const size = new Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
      const uniformScale = TARGET_MAX_DIM / maxDim;

      const model = template.clone(true);
      model.scale.setScalar(uniformScale);
      model.position.copy(normal.clone().multiplyScalar(surfaceR));
      model.quaternion.setFromUnitVectors(REF_UP, normal);
      model.rotateY(spin() * Math.PI * 2 + index * 2.17);
      // Surface tangent basis: tip the half-ring so the relief side reads toward the sky (radial outward).
      const tangent = new Vector3(-normal.y, normal.x, 0);
      if (tangent.lengthSq() < 1e-6) tangent.set(0, -normal.z, normal.y);
      tangent.normalize();
      const bitangent = new Vector3().crossVectors(normal, tangent).normalize();
      model.rotateOnWorldAxis(tangent, TILT_ORNATE_TOWARD_SKY);
      model.rotateOnWorldAxis(bitangent, TILT_DIAGONAL * (index === 0 ? 1 : -1));
      model.updateMatrixWorld(true);
      let minAlong = minMeshVertexProjectionAlongNormal(model, normal);
      if (!Number.isFinite(minAlong)) {
        const bb = new Box3().setFromObject(model);
        const corners = [
          new Vector3(bb.min.x, bb.min.y, bb.min.z),
          new Vector3(bb.max.x, bb.min.y, bb.min.z),
          new Vector3(bb.min.x, bb.max.y, bb.min.z),
          new Vector3(bb.max.x, bb.max.y, bb.min.z),
          new Vector3(bb.min.x, bb.min.y, bb.max.z),
          new Vector3(bb.max.x, bb.min.y, bb.max.z),
          new Vector3(bb.min.x, bb.max.y, bb.max.z),
          new Vector3(bb.max.x, bb.max.y, bb.max.z),
        ];
        minAlong = Infinity;
        for (const c of corners) {
          const d = c.dot(normal);
          if (d < minAlong) minAlong = d;
        }
      }
      const lift = surfaceR - minAlong;
      model.position.addScaledVector(normal, lift);
      model.position.addScaledVector(normal, -BURY_DEPTH_RATIO * TARGET_MAX_DIM);

      model.traverse((child) => {
        if (!(child as Mesh).isMesh) return;
        const mesh = child as Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        /* Convert GLB's PBR material to MeshPhongMaterial with a Fresnel rim glow.
           Matches the style used by Carpet/Boat/Plane props so the moonstone
           halves read crisply against the sky during the union cinematic and
           pick up ambient warm tinting during the day. */
        const oldMat = mesh.material as { color?: Color; map?: unknown };
        const newMat = new MeshPhongMaterial({
          color: oldMat.color ?? new Color(0xffffff),
          map: (oldMat.map as MeshPhongMaterial["map"]) ?? null,
          flatShading: false,
          shininess: 28,
        });
        const rimU = addRimLight(newMat, 0xfff1c0, MOONSTONE_RIM_INTENSITY_BASE, 2.6);
        mesh.material = newMat;
        state.rimMaterials.push(newMat);
        state.rimIntensityUniforms.push(rimU);
      });
      state.basePosition.copy(model.position);
      state.tangent.copy(tangent);
      state.bitangent.copy(bitangent);
      state.restQuaternion.copy(model.quaternion);
      state.root = model;
      const liftAlpha = this.getMoonstoneLiftAlpha(state.cycleStartAt);
      model.position.copy(state.basePosition).addScaledVector(normal, liftAlpha * MOONSTONE_FLOAT_HEIGHT);
      this.group.add(model);
      this.initMoonstoneDust(state);
    };

    const loader = new GLTFLoader();
    const leftUrl = "/3D/moonstone_left.glb";
    const rightUrl = "/3D/moonstone_right.glb";

    loader.load(
      leftUrl,
      (gltf) => {
        placeModel(gltf, 0);
        if (placements.length < 2) return;
        loader.load(
          rightUrl,
          (gltf2) => {
            placeModel(gltf2, 1);
          },
          undefined,
          (err) => {
            console.error("[Globe] Failed to load", rightUrl, err);
          },
        );
      },
      undefined,
      (err) => {
        console.error("[Globe] Failed to load", leftUrl, err);
      },
    );
  }

  private getMoonstonePhase(cycleStartAt: number | null, now = Date.now()): MoonstoneRuinPhase {
    if (cycleStartAt == null) return "idle";
    const elapsed = now - cycleStartAt;
    if (elapsed < 0) return "raising";
    if (elapsed < MOONSTONE_RAISE_MS) return "raising";
    if (elapsed < MOONSTONE_RAISE_MS + MOONSTONE_FLOAT_MS) return "floating";
    if (elapsed < MOONSTONE_RAISE_MS + MOONSTONE_FLOAT_MS + MOONSTONE_LOWER_MS) return "lowering";
    return "idle";
  }

  private getMoonstoneLiftAlpha(cycleStartAt: number | null, now = Date.now()): number {
    const phase = this.getMoonstonePhase(cycleStartAt, now);
    if (phase === "idle") return 0;
    if (phase === "floating") return 1;
    if (cycleStartAt == null) return 0;
    if (phase === "raising") {
      const t = MathUtils.clamp((now - cycleStartAt) / MOONSTONE_RAISE_MS, 0, 1);
      return t * t * (3 - 2 * t);
    }
    const lowerStart = cycleStartAt + MOONSTONE_RAISE_MS + MOONSTONE_FLOAT_MS;
    const t = MathUtils.clamp((now - lowerStart) / MOONSTONE_LOWER_MS, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    return 1 - smooth;
  }

  startMoonstoneRuinCycle(index: number, cycleStartAt: number) {
    const state = this.moonstoneRuins[index];
    if (!state) return;
    state.cycleStartAt = cycleStartAt;
  }

  /**
   * Returns true the first frame both moonstones are in `floating` simultaneously.
   * Re-arms only when both have returned to `idle`, so a single pair-lift triggers
   * at most one cinematic.
   */
  consumeMoonstoneUnionTrigger(now = Date.now()): boolean {
    if (this.moonstonePostUnionActive) return false;
    if (this.moonstoneRuins.length < 2) return false;
    const a = this.moonstoneRuins[0]!;
    const b = this.moonstoneRuins[1]!;
    const phaseA = this.getMoonstonePhase(a.cycleStartAt, now);
    const phaseB = this.getMoonstonePhase(b.cycleStartAt, now);
    const bothFloating = phaseA === "floating" && phaseB === "floating";
    if (bothFloating && !this.moonstoneUnionConsumed) {
      this.moonstoneUnionConsumed = true;
      return true;
    }
    if (phaseA === "idle" && phaseB === "idle") {
      this.moonstoneUnionConsumed = false;
    }
    return false;
  }

  /** When true, the normal per-frame moonstone transform/dust update is skipped. */
  setMoonstoneCinematicActive(active: boolean) {
    this.moonstoneCinematicActive = active;
  }

  /** True once the moonstone halves have permanently fused into the floating ring. */
  isMoonstonePostUnionActive(): boolean {
    return this.moonstonePostUnionActive;
  }

  /** Number of placed moonstone ruin halves (typically 2). */
  getMoonstoneCount(): number {
    return this.moonstoneRuins.length;
  }

  getMoonstoneRoot(i: number): Object3D | null {
    return this.moonstoneRuins[i]?.root ?? null;
  }

  /** Writes the moonstone's surface anchor (world) into `target`. */
  readMoonstoneBasePosition(i: number, target: Vector3): boolean {
    const s = this.moonstoneRuins[i];
    if (!s) return false;
    target.copy(s.basePosition);
    return true;
  }

  /** Writes the moonstone's surface normal into `target`. */
  readMoonstoneNormal(i: number, target: Vector3): boolean {
    const s = this.moonstoneRuins[i];
    if (!s) return false;
    target.copy(s.normal);
    return true;
  }

  /** Writes the moonstone's at-rest (buried) quaternion into `target`. */
  readMoonstoneRestQuaternion(i: number, target: Quaternion): boolean {
    const s = this.moonstoneRuins[i];
    if (!s) return false;
    target.copy(s.restQuaternion);
    return true;
  }

  /** Current world position of the moonstone root (or basePosition if not loaded). */
  readMoonstoneCurrentPosition(i: number, target: Vector3): boolean {
    const s = this.moonstoneRuins[i];
    if (!s) return false;
    target.copy(s.root?.position ?? s.basePosition);
    return true;
  }

  /**
   * Sets the rim light intensity for every moonstone half. Pass 0 (or the
   * baseline) to restore normal-gameplay rim. The cinematic uses a higher
   * value during the combine beat so the completed ring is crowned with a
   * warm Fresnel glow.
   */
  setMoonstoneRimIntensity(intensity: number) {
    for (const s of this.moonstoneRuins) {
      for (const u of s.rimIntensityUniforms) u.value = intensity;
    }
  }

  /** Baseline rim intensity used outside the cinematic. */
  getMoonstoneRimIntensityBase(): number {
    return MOONSTONE_RIM_INTENSITY_BASE;
  }

  /**
   * Locks the moonstones into their post-cutscene hovering ring state. This
   * disables future activations/triggers and lets normal `update()` keep the
   * completed ring gently floating above the world.
   */
  activateMoonstonePostUnion(point: Vector3, axis: Vector3, quats: readonly Quaternion[]) {
    this.moonstonePostUnionActive = true;
    this.moonstoneUnionConsumed = true;
    this.moonstonePostUnionPoint.copy(point);
    this.moonstonePostUnionAxis.copy(axis).normalize();
    this.moonstonePostUnionQuats = quats.map((q) => q.clone());
    for (let i = 0; i < this.moonstoneRuins.length; i++) {
      const s = this.moonstoneRuins[i]!;
      s.cycleStartAt = null;
      if (s.root) {
        s.root.position.copy(this.moonstonePostUnionPoint);
        const q = this.moonstonePostUnionQuats[i];
        if (q) s.root.quaternion.copy(q);
      }
    }
  }

  /** Hard reset of a moonstone cycle (used when ending the union cinematic). */
  resetMoonstoneCycle(i: number) {
    const s = this.moonstoneRuins[i];
    if (!s) return;
    s.cycleStartAt = null;
    if (s.root) {
      s.root.position.copy(s.basePosition);
      s.root.quaternion.copy(s.restQuaternion);
    }
  }

  findNearestActivatableMoonstone(playerWorldPos: Vector3, maxDistance: number, now = Date.now()): number {
    if (this.moonstonePostUnionActive) return -1;
    let bestIndex = -1;
    let bestDist = maxDistance;
    for (let i = 0; i < this.moonstoneRuins.length; i++) {
      const state = this.moonstoneRuins[i]!;
      if (this.getMoonstonePhase(state.cycleStartAt, now) !== "idle") continue;
      const d = playerWorldPos.distanceTo(state.basePosition);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  getNearbyMoonstoneRaiseProgress(playerWorldPos: Vector3, maxDistance: number, now = Date.now()): number {
    if (this.moonstonePostUnionActive) return 0;
    let bestDist = maxDistance;
    let progress = 0;
    for (const state of this.moonstoneRuins) {
      if (this.getMoonstonePhase(state.cycleStartAt, now) !== "raising") continue;
      const pos = state.root?.position ?? state.basePosition;
      const d = playerWorldPos.distanceTo(pos);
      if (d >= bestDist) continue;
      bestDist = d;
      progress = MathUtils.clamp((now - (state.cycleStartAt ?? now)) / MOONSTONE_RAISE_MS, 0, 1);
    }
    return progress;
  }

  getMoonstoneShakeTrauma(playerWorldPos: Vector3, maxDistance = 1.58, now = Date.now()): number {
    if (this.moonstonePostUnionActive) return 0;
    let trauma = 0;
    for (const state of this.moonstoneRuins) {
      if (this.getMoonstonePhase(state.cycleStartAt, now) !== "raising") continue;
      const pos = state.root?.position ?? state.basePosition;
      const dist = playerWorldPos.distanceTo(pos);
      if (dist >= maxDistance) continue;
      const distW = 1 - dist / maxDistance;
      const raiseW = MathUtils.clamp((now - (state.cycleStartAt ?? now)) / MOONSTONE_RAISE_MS, 0, 1);
      trauma = Math.max(trauma, distW * (0.16 + 0.38 * raiseW));
    }
    return trauma;
  }

  private initMoonstoneDust(state: MoonstoneRuinState) {
    const n = MOONSTONE_DUST_COUNT;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const life = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      life[i] = 0;
      pos[i * 3 + 0] = 1e4;
      pos[i * 3 + 1] = 1e4;
      pos[i * 3 + 2] = 1e4;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(pos, 3));
    const mat = new PointsMaterial({
      map: getMoonstoneDustSpriteTexture(),
      color: 0x4a4543,
      size: 0.024,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new Points(geometry, mat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    this.group.add(points);
    state.dust = { geometry, points, position: pos, velocity: vel, life };
  }

  private updateMoonstoneDust(state: MoonstoneRuinState, dt: number, now: number) {
    const dust = state.dust;
    const root = state.root;
    const nrm = state.normal;
    const tan = state.tangent;
    const bit = state.bitangent;
    if (!dust || !root) return;

    const phase = this.getMoonstonePhase(state.cycleStartAt, now);
    const liftAlpha = this.getMoonstoneLiftAlpha(state.cycleStartAt, now);
    const pos = dust.position;
    const vel = dust.velocity;
    const life = dust.life;
    const n = MOONSTONE_DUST_COUNT;
    const g = MOONSTONE_DUST_GRAVITY;

    root.updateMatrixWorld(true);
    root.getWorldPosition(this.moonstoneEmitScratch);
    this.moonstoneEmitScratch.addScaledVector(nrm, -0.11);
    const emit = this.moonstoneEmitScratch;

    let spawnBudget =
      phase === "raising" ? Math.min(14, Math.max(1, Math.floor(dt * 95 + Math.random() * 2))) : 0;

    for (let i = 0; i < n; i++) {
      if (life[i] > 0) {
        life[i] -= dt * 0.5;
        vel[i * 3 + 0] += -nrm.x * g * dt;
        vel[i * 3 + 1] += -nrm.y * g * dt;
        vel[i * 3 + 2] += -nrm.z * g * dt;
        const drag = Math.exp(-2.2 * dt);
        vel[i * 3 + 0] *= drag;
        vel[i * 3 + 1] *= drag;
        vel[i * 3 + 2] *= drag;
        pos[i * 3 + 0] += vel[i * 3 + 0] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (life[i] <= 0) {
          pos[i * 3 + 0] = 1e4;
          pos[i * 3 + 1] = 1e4;
          pos[i * 3 + 2] = 1e4;
        }
      } else if (spawnBudget > 0) {
        spawnBudget--;
        life[i] = 0.55 + Math.random() * 0.55;
        const spread = 0.07 + liftAlpha * 0.05;
        const ox = (Math.random() - 0.5) * spread;
        const oy = (Math.random() - 0.5) * spread;
        pos[i * 3 + 0] = emit.x + tan.x * ox + bit.x * oy;
        pos[i * 3 + 1] = emit.y + tan.y * ox + bit.y * oy;
        pos[i * 3 + 2] = emit.z + tan.z * ox + bit.z * oy;
        const s1 = (Math.random() - 0.5) * 0.55;
        const s2 = (Math.random() - 0.5) * 0.55;
        const down = 0.45 + Math.random() * 0.35;
        vel[i * 3 + 0] = tan.x * s1 + bit.x * s2 - nrm.x * down;
        vel[i * 3 + 1] = tan.y * s1 + bit.y * s2 - nrm.y * down;
        vel[i * 3 + 2] = tan.z * s1 + bit.z * s2 - nrm.z * down;
      }
    }
    dust.geometry.attributes.position!.needsUpdate = true;
  }

  private ensureShrineMaterials() {
    if (this.shrineMaterials) return;
    const torii = new MeshPhongMaterial({ color: 0xc42828, flatShading: true });
    addRimLight(torii, 0xff8866, 0.42, 2.65);
    const stone = new MeshPhongMaterial({ color: 0x8e8984, flatShading: true });
    addRimLight(stone, 0xe8e0d8, 0.36, 2.75);
    const wood = new MeshPhongMaterial({ color: 0x3d2c1f, flatShading: true });
    addRimLight(wood, 0xffccaa, 0.32, 2.85);
    const roof = new MeshPhongMaterial({ color: 0x2a3b32, flatShading: true });
    addRimLight(roof, 0x668877, 0.35, 2.8);
    const accent = new MeshPhongMaterial({ color: 0xd4af37, flatShading: true });
    addRimLight(accent, 0xffeebb, 0.5, 3.0);
    const tree = new MeshPhongMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
    addRimLight(tree, 0xffeeaa, 0.55, 3.0);
    this.shrineMaterials = { torii, stone, wood, roof, accent, tree };
  }

  private getShrineTreeSharedGeo(): LatheGeometry {
    if (!this.shrineTeardropGeo) {
      this.shrineTeardropGeo = this.createTeardropGeo(1, 1);
    }
    return this.shrineTeardropGeo;
  }

  /** Zen-style shrine: red torii, stone plinth, small wooden hall, instanced teardrop trees. */
  private buildShrineGroup(rand: () => number): Group {
    this.ensureShrineMaterials();
    const m = this.shrineMaterials!;
    const S = 1.175; // Reduced by 50% from 2.35
    const g = new Group();

    const toriiParts: BufferGeometry[] = [];
    const stoneParts: BufferGeometry[] = [];
    const woodParts: BufferGeometry[] = [];
    const roofParts: BufferGeometry[] = [];
    const accentParts: BufferGeometry[] = [];

    // 1. Stone Base & Path
    const platW = 0.22 * S;
    const platD = 0.26 * S;
    const platH = 0.015 * S;
    const plat = new BoxGeometry(platW, platH, platD);
    plat.translate(0, platH * 0.5, -0.02 * S);
    stoneParts.push(plat);

    const pathW = 0.06 * S;
    const pathD = 0.18 * S;
    const path = new BoxGeometry(pathW, platH * 0.8, pathD);
    path.translate(0, platH * 0.4, 0.12 * S);
    stoneParts.push(path);

    // 2. Torii Gate (Red)
    const toriiZ = 0.14 * S;
    const postH = 0.11 * S;
    const postR = 0.007 * S;
    const toriiSpan = 0.045 * S;

    const postGeo = new CylinderGeometry(postR * 0.8, postR, postH, 8);
    postGeo.translate(0, platH + postH * 0.5, 0);

    const postL = postGeo.clone();
    postL.translate(-toriiSpan, 0, toriiZ);
    postL.rotateZ(-0.04);
    toriiParts.push(postL);

    const postR_geo = postGeo.clone();
    postR_geo.translate(toriiSpan, 0, toriiZ);
    postR_geo.rotateZ(0.04);
    toriiParts.push(postR_geo);

    const kasagiW = toriiSpan * 2 + 0.04 * S;
    const kasagiH = 0.012 * S;
    const kasagiD = 0.012 * S;
    const kasagiY = platH + postH;
    const kasagi = new BoxGeometry(kasagiW, kasagiH, kasagiD);
    kasagi.translate(0, kasagiY, toriiZ);
    toriiParts.push(kasagi);

    const kasagiTop = new BoxGeometry(kasagiW * 1.05, kasagiH * 0.4, kasagiD * 0.8);
    kasagiTop.translate(0, kasagiY + kasagiH * 0.7, toriiZ);
    toriiParts.push(kasagiTop);

    const nukiW = toriiSpan * 2 + 0.02 * S;
    const nukiH = 0.008 * S;
    const nukiY = platH + postH * 0.75;
    const nuki = new BoxGeometry(nukiW, nukiH, kasagiD * 0.8);
    nuki.translate(0, nukiY, toriiZ);
    toriiParts.push(nuki);

    const gakuzuka = new BoxGeometry(0.006 * S, kasagiY - nukiY, 0.008 * S);
    gakuzuka.translate(0, (kasagiY + nukiY) * 0.5, toriiZ);
    toriiParts.push(gakuzuka);

    // 3. Stone Lanterns (Toro)
    const buildLantern = (lx: number, lz: number) => {
      const base = new BoxGeometry(0.018 * S, 0.01 * S, 0.018 * S);
      base.translate(lx, platH + 0.005 * S, lz);
      stoneParts.push(base);

      const stem = new CylinderGeometry(0.005 * S, 0.006 * S, 0.03 * S, 6);
      stem.translate(lx, platH + 0.02 * S, lz);
      stoneParts.push(stem);

      const house = new BoxGeometry(0.014 * S, 0.014 * S, 0.014 * S);
      house.translate(lx, platH + 0.042 * S, lz);
      stoneParts.push(house);

      const lRoof = new CylinderGeometry(0, 0.022 * S, 0.012 * S, 4);
      lRoof.rotateY(Math.PI / 4);
      lRoof.translate(lx, platH + 0.055 * S, lz);
      stoneParts.push(lRoof);

      const jewel = new SphereGeometry(0.004 * S, 4, 4);
      jewel.translate(lx, platH + 0.063 * S, lz);
      stoneParts.push(jewel);
    };
    buildLantern(-0.05 * S, 0.18 * S);
    buildLantern(0.05 * S, 0.18 * S);

    // 4. Main Hall (Honden)
    const hallZ = -0.04 * S;
    const deckW = 0.14 * S;
    const deckD = 0.12 * S;
    const deckH = 0.008 * S;
    const deckY = platH + 0.015 * S;

    const deck = new BoxGeometry(deckW, deckH, deckD);
    deck.translate(0, deckY, hallZ);
    woodParts.push(deck);

    const stairW = 0.04 * S;
    for (let i = 0; i < 3; i++) {
      const st = new BoxGeometry(stairW, 0.005 * S, 0.01 * S);
      st.translate(0, platH + 0.0025 * S + i * 0.005 * S, hallZ + deckD/2 + 0.01 * S - i * 0.008 * S);
      woodParts.push(st);
    }

    const wallW = 0.10 * S;
    const wallD = 0.08 * S;
    const wallH = 0.055 * S;
    const wallY = deckY + deckH * 0.5 + wallH * 0.5;
    const walls = new BoxGeometry(wallW, wallH, wallD);
    walls.translate(0, wallY, hallZ);
    woodParts.push(walls);

    const pillarR = 0.004 * S;
    const pillarH = wallH + deckH;
    const px = wallW * 0.5 + 0.002 * S;
    const pz = wallD * 0.5 + 0.002 * S;
    const pY = deckY + pillarH * 0.5 - deckH * 0.5;
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const pil = new CylinderGeometry(pillarR, pillarR, pillarH, 6);
        pil.translate(dx * px, pY, hallZ + dz * pz);
        woodParts.push(pil);
      }
    }

    const roofW = 0.15 * S;
    const roofSlopeL = 0.075 * S;
    const roofThick = 0.012 * S;
    const roofAngle = 0.6;
    const roofYBase = wallY + wallH * 0.5 - 0.005 * S;

    const roofFront = new BoxGeometry(roofW, roofThick, roofSlopeL);
    roofFront.translate(0, 0, roofSlopeL * 0.5);
    roofFront.rotateX(roofAngle);
    roofFront.translate(0, roofYBase, hallZ);
    roofParts.push(roofFront);

    const roofBack = new BoxGeometry(roofW, roofThick, roofSlopeL);
    roofBack.translate(0, 0, -roofSlopeL * 0.5);
    roofBack.rotateX(-roofAngle);
    roofBack.translate(0, roofYBase, hallZ);
    roofParts.push(roofBack);

    const ridgeY = roofYBase + Math.sin(roofAngle) * roofSlopeL * 0.5 + 0.005 * S;
    const ridge = new CylinderGeometry(0.006 * S, 0.006 * S, roofW * 0.95, 6);
    ridge.rotateZ(Math.PI / 2);
    ridge.translate(0, ridgeY, hallZ);
    accentParts.push(ridge);

    const chigiL = 0.05 * S;
    const chigiW = 0.004 * S;
    const chigiD = 0.006 * S;
    for (const side of [-1, 1]) {
      const cx = side * (roofW * 0.4);
      const chigi1 = new BoxGeometry(chigiW, chigiL, chigiD);
      chigi1.translate(0, chigiL * 0.2, 0);
      chigi1.rotateX(0.7);
      chigi1.translate(cx, ridgeY - 0.005 * S, hallZ);
      woodParts.push(chigi1);

      const chigi2 = new BoxGeometry(chigiW, chigiL, chigiD);
      chigi2.translate(0, chigiL * 0.2, 0);
      chigi2.rotateX(-0.7);
      chigi2.translate(cx, ridgeY - 0.005 * S, hallZ);
      woodParts.push(chigi2);
    }

    const kCount = 5;
    for (let i = 0; i < kCount; i++) {
      const kx = -roofW * 0.3 + (i / (kCount - 1)) * roofW * 0.6;
      const kat = new CylinderGeometry(0.005 * S, 0.005 * S, 0.025 * S, 8);
      kat.rotateX(Math.PI / 2);
      kat.translate(kx, ridgeY + 0.004 * S, hallZ);
      accentParts.push(kat);
    }

    const mergeBucket = (parts: BufferGeometry[], mat: MeshPhongMaterial) => {
      if (parts.length === 0) return;
      const merged = mergeGeometries(parts, false);
      if (merged) {
        const mesh = new Mesh(merged, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      for (const p of parts) p.dispose();
    };

    mergeBucket(toriiParts, m.torii);
    mergeBucket(stoneParts, m.stone);
    mergeBucket(woodParts, m.wood);
    mergeBucket(roofParts, m.roof);
    mergeBucket(accentParts, m.accent);

    // Soft warm glow on the ground
    const glowSize = platW * 3.5;
    const glowGeo = new PlaneGeometry(glowSize, glowSize);
    const glowMesh = new Mesh(glowGeo, this.getSharedGroundGlowMat());
    glowMesh.rotation.x = -Math.PI / 2;
    glowMesh.position.set(0, 0.001, hallZ + 0.02 * S);
    g.add(glowMesh);

    const TREE_N = 14;
    const trees = new InstancedMesh(this.getShrineTreeSharedGeo(), m.tree, TREE_N);
    trees.castShadow = true;
    trees.receiveShadow = false;
    const dummy = new Object3D();
    const greenShades = [0x4a9a3a, 0x55a545, 0x48953a, 0x8aaa35, 0xb59a30];
    const shadeColors = greenShades.map((h) => new Color(h));

    for (let i = 0; i < TREE_N; i++) {
      const angle = -Math.PI * 0.8 + (i / (TREE_N - 1)) * Math.PI * 1.6;
      const r = 0.12 * S + rand() * 0.04 * S;
      const x = Math.sin(angle) * r;
      const z = hallZ + Math.cos(angle) * r * 0.8;

      const sc = (0.012 + rand() * 0.010) * S;
      dummy.position.set(x, platH, z);
      dummy.scale.set(sc, sc * 2.45, sc);
      dummy.rotation.y = rand() * Math.PI * 2;
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);

      const color = shadeColors[Math.floor(rand() * shadeColors.length)]!;
      trees.setColorAt(i, color);
    }
    trees.instanceMatrix.needsUpdate = true;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    g.add(trees);

    return g;
  }

  // ── Floating tree clusters (panic phase) — single InstancedMesh → 1 draw call ───

  private createFloatingTreeClusters() {
    const rand        = seededRandom(888 + this.seed);
    const forestNoise = createNoise3D(this.seed + 999);
    const shades      = [0x4a9a3a, 0x55a545, 0x48953a, 0x8aaa35, 0xb59a30];
    const shadeColors = shades.map((h) => new Color(h));
    const C           = Globe.FT_CLUSTERS;
    const T           = Globe.FT_PER_CLUSTER;
    const IC          = Globe.FT_IMPACT_CLUSTERS;
    const IT          = Globe.FT_IMPACT_PER;
    const Y_UP        = new Vector3(0, 1, 0);
    const colors: Color[] = [];  // parallel to floatingTreeData, set as instance colours later

    // ── Impact tangent frame (shared by fallback & impact clusters) ──
    const impactRef   = Math.abs(MOON_APPROACH_DIR.y) < 0.9
      ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const impactTang1 = new Vector3().crossVectors(MOON_APPROACH_DIR, impactRef).normalize();
    const impactTang2 = new Vector3().crossVectors(MOON_APPROACH_DIR, impactTang1).normalize();

    // ── Helper: push tree entries for one cluster ─────────────────────
    const buildCluster = (
      clusterNormal: Vector3,
      count: number,
      rng: () => number,
      spreadRange: [number, number],
      heightMax: number,
    ) => {
      const ref   = Math.abs(clusterNormal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      const tang1 = new Vector3().crossVectors(clusterNormal, ref).normalize();
      const tang2 = new Vector3().crossVectors(clusterNormal, tang1).normalize();
      const spread = spreadRange[0] + rng() * (spreadRange[1] - spreadRange[0]);
      for (let i = 0; i < count; i++) {
        const angle = rng() * Math.PI * 2;
        const r     = Math.sqrt(rng()) * spread;
        const tangentOffset = new Vector3()
          .addScaledVector(tang1, Math.cos(angle) * r)
          .addScaledVector(tang2, Math.sin(angle) * r);
        const u          = rng();
        const baseHeight = 0.05 + u * u * heightMax;
        const leanDir    = rng() * Math.PI * 2;
        const leanAngle  = 0.12 + rng() * 0.55;
        const leanAxis   = new Vector3(Math.cos(leanDir), 0, Math.sin(leanDir));
        const qBase      = new Quaternion().setFromUnitVectors(Y_UP, clusterNormal);
        const qLean      = new Quaternion().setFromAxisAngle(leanAxis, leanAngle);
        colors.push(shadeColors[Math.floor(rng() * shadeColors.length)].clone());
        this.floatingTreeData.push({
          normal: clusterNormal,
          tangentOffset,
          baseHeight,
          amp:       0.022 + rng() * 0.042,
          speed:     0.40  + rng() * 0.65,
          phase:     rng() * Math.PI * 2,
          quaternion: new Quaternion().multiplyQuaternions(qBase, qLean),
          sizeVar:    0.026 + rng() * 0.030,
        });
      }
    };

    // ── Find cluster centres anchored to existing forest patches,
    //    biased toward the moon-impact hemisphere. ──────────────────────
    const candidates: { normal: Vector3; score: number }[] = [];
    for (let s = 0; s < 2000; s++) {
      const theta = rand() * Math.PI * 2;
      const phi   = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.sin(phi) * Math.sin(theta);
      const nz = Math.cos(phi);
      const n  = new Vector3(nx, ny, nz);

      // Must be on land.
      if (!this.sampleTerrainAt(nx, ny, nz).isLand) continue;

      // Forest density check.
      const fv = forestNoise(nx * 2.5, ny * 2.5, nz * 2.5);
      if (fv < 0.30) continue;

      // Bias toward the impact hemisphere but allow coverage across the whole globe.
      const impactDot    = Math.max(0, n.dot(MOON_APPROACH_DIR));
      const impactWeight = 0.25 + Math.pow(impactDot, 1.5) * 0.75;
      candidates.push({ normal: n.normalize(), score: fv * impactWeight });
    }

    // Sort highest score first; greedily pick well-separated centres.
    candidates.sort((a, b) => b.score - a.score);
    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= C) break;
      if (chosen.every((v) => v.dot(c.normal) < 0.90)) chosen.push(c.normal);
    }
    // Fallback: fill any gap with random points on the impact hemisphere.
    const fbRand = seededRandom(889 + this.seed);
    while (chosen.length < C) {
      const spread = fbRand() * 0.7;
      const angle  = fbRand() * Math.PI * 2;
      chosen.push(MOON_APPROACH_DIR.clone()
        .addScaledVector(impactTang1, Math.cos(angle) * spread)
        .addScaledVector(impactTang2, Math.sin(angle) * spread)
        .normalize());
    }
    for (const n of chosen) {
      const impactProx = Math.max(0, n.dot(MOON_APPROACH_DIR));
      const count = Math.round(T * (0.5 + impactProx * 0.8));
      buildCluster(n, count, rand, [0.20, 0.48], 0.50);
    }

    // ── Dense impact-zone clusters ─────────────────────────────────────
    const icRand = seededRandom(890 + this.seed);
    for (let c = 0; c < IC; c++) {
      const coneSpread = icRand() * 0.70;
      const coneAngle  = icRand() * Math.PI * 2;
      const n = MOON_APPROACH_DIR.clone()
        .addScaledVector(impactTang1, Math.cos(coneAngle) * Math.sin(coneSpread))
        .addScaledVector(impactTang2, Math.sin(coneAngle) * Math.sin(coneSpread))
        .normalize();
      buildCluster(n, IT, icRand, [0.15, 0.37], 0.45);
    }

    // ── Single InstancedMesh for all trees — 1 draw call ──────────────
    const total = this.floatingTreeData.length;
    const geo   = this.createTeardropGeo(1, 1);
    const mat   = new MeshPhongMaterial({ color: 0xffffff, flatShading: true });
    addRimLight(mat, 0xffeeaa, 0.7, 3.0);

    const mesh = new InstancedMesh(geo, mat, total);
    mesh.castShadow    = true;
    mesh.frustumCulled = false;
    const hiddenDummy = new Object3D();
    hiddenDummy.scale.set(0, 0, 0);
    hiddenDummy.updateMatrix();
    for (let i = 0; i < total; i++) {
      mesh.setMatrixAt(i, hiddenDummy.matrix);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.floatingTreeMesh = mesh;
  }

  /** Animate floating tree clusters. 1 draw call, zero allocations per frame. */
  updateFloatingTrees(moonProgress: number, time: number) {
    const mesh = this.floatingTreeMesh;
    if (!mesh) return;

    const t = Math.max(0, Math.min(1, (moonProgress - 0.75) / 0.15));

    // When transitioning to inactive: zero all matrices once, then skip every frame.
    if (t <= 0) {
      if (this.floatingTreesActive) {
        this.floatingTreesActive = false;
        const dummy = this.floatingTreeDummy;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, dummy.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    this.floatingTreesActive = true;
    const dummy   = this.floatingTreeDummy;
    const scratch = this.floatingTreePosScratch;
    const data    = this.floatingTreeData;

    for (let i = 0; i < mesh.count; i++) {
      const d   = data[i];
      const bob = Math.sin(time * d.speed + d.phase) * d.amp * t;
      scratch.copy(d.normal).multiplyScalar(this.radius + d.baseHeight * t + bob).add(d.tangentOffset);
      dummy.position.copy(scratch);
      dummy.quaternion.copy(d.quaternion);
      dummy.scale.set(d.sizeVar * 0.7, d.sizeVar * 2.5 * t, d.sizeVar * 0.7);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Low-poly Stonehenge: outer sarsen ring, inner horseshoe trilithons, altar, heel stone.
   *
   *  Standing stones are kept as individual Mesh objects so Game.ts can animate their
   *  Y-position and tilt when the moon enters the dread/panic phase. Each such mesh
   *  carries `userData` with float parameters:
   *    { isFloating, baseY, amp, speed, phase, baseTiltX, baseTiltZ, tiltX, tiltZ }
   *
   *  Fallen/ground stones are merged into a single static mesh per material.
   */
  private buildStonehenge(rand: () => number): Group {
    if (!this.stonehengeMats) {
      this.stonehengeMats = {
        sarsen: new MeshPhongMaterial({ color: 0x9a9080 }),
        lintel: new MeshPhongMaterial({ color: 0xb0a898 }),
        altar:  new MeshPhongMaterial({ color: 0x706860 }),
      };
      const sh = this.stonehengeMats;
      addRimLight(sh.sarsen, 0xffe8d0, 0.42, 2.8);
      addRimLight(sh.lintel, 0xfff0dd, 0.4, 2.75);
      addRimLight(sh.altar, 0xd8d0c4, 0.35, 2.85);
    }
    const m = this.stonehengeMats;

    // Fallen / ground-level geometry is merged for efficiency.
    const staticBuckets: Record<keyof typeof m, BufferGeometry[]> = {
      sarsen: [], lintel: [], altar: [],
    };

    const S = 2.2;

    const R_OUT      = 0.095 * S;
    const R_IN       = 0.056 * S;
    const OUTER_H    = 0.040 * S;
    const OUTER_W    = 0.012 * S;
    const OUTER_D    = 0.010 * S;
    const INNER_H    = 0.054 * S;
    const INNER_W    = 0.014 * S;
    const INNER_D    = 0.012 * S;
    const LINTEL_H   = 0.009 * S;
    const LINTEL_D   = 0.011 * S;
    const HALF_GAP   = 0.009 * S;

    const OUTER_CHORD    = 2 * R_OUT * Math.sin(Math.PI / 10) * 1.08;
    const INNER_LINTEL_W = INNER_W * 2 + HALF_GAP * 2 + 0.004 * S;

    // ── Pre-compute wear randomness ──
    const outerFallen  = Array.from({ length: 10 }, () => rand() < 0.28);
    const outerYaw     = Array.from({ length: 10 }, () => (rand() - 0.5) * 0.35);
    const skipLintel   = Array.from({ length: 10 }, () => rand() < 0.10);
    const innerFallenTri  = Math.floor(rand() * 5);
    const innerHasFallen  = rand() < 0.45;
    const innerFallenSign = rand() < 0.5 ? -1 : 1;

    // ── Helper: attach float userData to a standing mesh ──
    const tagFloat = (mesh: Mesh, baseY: number) => {
      mesh.userData.isFloating = rand() > 0.35;   // ~65% of stones float, rest stay grounded
      mesh.userData.baseY      = baseY;
      mesh.userData.amp        = (0.016 + rand() * 0.022) * S;
      mesh.userData.speed      = 0.55 + rand() * 0.55;
      mesh.userData.phase      = rand() * Math.PI * 2;
      mesh.userData.tiltX      = (rand() - 0.5) * 1.2;
      mesh.userData.tiltZ      = (rand() - 0.5) * 1.2;
    };

    const g = new Group();

    // ── 1. Outer sarsen ring — 10 uprights ──
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const px = Math.sin(a) * R_OUT;
      const pz = Math.cos(a) * R_OUT;
      if (outerFallen[i]) {
        const geo = new BoxGeometry(OUTER_W, OUTER_H, OUTER_D);
        geo.translate(0, OUTER_H / 2, 0);
        geo.rotateX(Math.PI / 2);
        geo.translate(0, OUTER_D / 2, 0);
        geo.rotateY(a + outerYaw[i]);
        geo.translate(px, 0, pz);
        staticBuckets.sarsen.push(geo);
      } else {
        const geo = new BoxGeometry(OUTER_W, OUTER_H, OUTER_D);
        const mesh = new Mesh(geo, m.sarsen);
        mesh.position.set(px, OUTER_H / 2, pz);
        tagFloat(mesh, OUTER_H / 2);
        g.add(mesh);
      }
    }

    // ── 2. Outer lintels ──
    for (let i = 0; i < 10; i++) {
      const j = (i + 1) % 10;
      if (outerFallen[i] || outerFallen[j] || skipLintel[i]) continue;
      const midA = ((i + 0.5) / 10) * Math.PI * 2;
      const baseY = OUTER_H + LINTEL_H / 2;
      const geo = new BoxGeometry(OUTER_CHORD, LINTEL_H, LINTEL_D);
      const mesh = new Mesh(geo, m.lintel);
      mesh.rotation.y = midA;
      mesh.position.set(Math.sin(midA) * R_OUT, baseY, Math.cos(midA) * R_OUT);
      tagFloat(mesh, baseY);
      g.add(mesh);
    }

    // ── 3. Inner horseshoe — 5 trilithons ──
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.8 + (i / 4) * Math.PI * 1.6;
      const rx = Math.sin(a) * R_IN;
      const rz = Math.cos(a) * R_IN;
      const tx = Math.cos(a);
      const tz = -Math.sin(a);

      const thisFallen = innerHasFallen && i === innerFallenTri;

      for (const sign of [-1, 1] as const) {
        const px = rx + tx * sign * HALF_GAP;
        const pz = rz + tz * sign * HALF_GAP;
        if (thisFallen && sign === innerFallenSign) {
          const geo = new BoxGeometry(INNER_W, INNER_H, INNER_D);
          geo.translate(0, INNER_H / 2, 0);
          geo.rotateX(Math.PI / 2);
          geo.translate(0, INNER_D / 2, 0);
          geo.rotateY(a + Math.PI);
          geo.translate(px, 0, pz);
          staticBuckets.sarsen.push(geo);
        } else {
          const geo = new BoxGeometry(INNER_W, INNER_H, INNER_D);
          const mesh = new Mesh(geo, m.sarsen);
          mesh.position.set(px, INNER_H / 2, pz);
          tagFloat(mesh, INNER_H / 2);
          g.add(mesh);
        }
      }

      if (!thisFallen) {
        const baseY = INNER_H + LINTEL_H / 2;
        const geo = new BoxGeometry(INNER_LINTEL_W, LINTEL_H, LINTEL_D);
        const mesh = new Mesh(geo, m.lintel);
        mesh.rotation.y = a;
        mesh.position.set(rx, baseY, rz);
        tagFloat(mesh, baseY);
        g.add(mesh);
      }
    }

    // ── 4. Central altar stone — flat slab (floats gently) ──
    {
      const baseY = 0.0025 * S;
      const geo = new BoxGeometry(0.022 * S, 0.005 * S, 0.013 * S);
      const mesh = new Mesh(geo, m.altar);
      mesh.position.set(0, baseY, 0);
      tagFloat(mesh, baseY);
      g.add(mesh);
    }

    // ── 5. Heel stone (floats + leans more dramatically) ──
    {
      const baseY = OUTER_H * 0.43;
      const geo = new CylinderGeometry(0.005 * S, 0.008 * S, OUTER_H * 0.85, 5);
      const mesh = new Mesh(geo, m.altar);
      mesh.rotation.z = 0.13;
      mesh.position.set(0, baseY, R_OUT + 0.032 * S);
      tagFloat(mesh, baseY);
      g.add(mesh);
    }

    // ── Merge static (fallen/ground) geometry ──
    for (const key of Object.keys(staticBuckets) as (keyof typeof m)[]) {
      const geos = staticBuckets[key];
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      if (merged) g.add(new Mesh(merged, m[key]));
      for (const geo of geos) geo.dispose();
    }

    return g;
  }

  /**
   * Low-poly observatory: wide 1-storey stone building, short cylindrical
   * drum, and a large hemisphere dome with a prominent dark-grey slit
   * running from the base of the dome up and over the top.
   */
  private buildObservatory(rand: () => number): Group {
    // Lazily create shared materials (9 objects reused across all 3 observatories).
    if (!this.obsMaterials) {
      this.obsMaterials = {
        stone:   new MeshPhongMaterial({ color: 0xd0c8b8 }),
        stoneDk: new MeshPhongMaterial({ color: 0xa89880 }),
        dome:    new MeshPhongMaterial({ color: 0xb0b8c4 }),
        slit:    new MeshPhongMaterial({ color: 0x333340 }),
        window:  new MeshPhongMaterial({ color: 0x5a90b8 }),
        frame:   new MeshPhongMaterial({ color: 0x555555 }),
        door:    new MeshPhongMaterial({ color: 0x5a4030 }),
        step:    new MeshPhongMaterial({ color: 0xb8b0a0 }),
        finder:  new MeshPhongMaterial({ color: 0x777777 }),
      };
      const om = this.obsMaterials;
      // Cool moonlight rim — matches night-sky props; slit kept subtle so it stays dark.
      addRimLight(om.stone, 0xc8d8f0, 0.42, 2.65);
      addRimLight(om.stoneDk, 0xb8c8e0, 0.38, 2.7);
      addRimLight(om.dome, 0xd0e0f8, 0.48, 2.4);
      addRimLight(om.slit, 0x8899aa, 0.22, 3.2);
      addRimLight(om.window, 0x88c8f8, 0.45, 2.5);
      addRimLight(om.frame, 0xccd0dd, 0.35, 2.8);
      addRimLight(om.door, 0xffccb8, 0.32, 2.75);
      addRimLight(om.step, 0xd8d0c8, 0.36, 2.65);
      addRimLight(om.finder, 0xccd0dd, 0.38, 2.7);
    }
    const m = this.obsMaterials;

    // Accumulate geometries by material key, merge at the end into one mesh each.
    const buckets: Record<keyof typeof m, BufferGeometry[]> = {
      stone: [], stoneDk: [], dome: [], slit: [], window: [],
      frame: [], door: [], step: [], finder: [],
    };
    const add = (geo: BufferGeometry, key: keyof typeof m) => buckets[key].push(geo);

    const S = 2.5;

    // ── Buried foundation — extends below terrain contact (y < 0) ──
    // Wider and taller than the upper base so it fills gaps on slopes.
    const foundW = 0.115 * S, foundD = 0.095 * S, foundH = 0.05 * S;
    const foundGeo = new BoxGeometry(foundW, foundH, foundD);
    foundGeo.translate(0, -foundH / 2, 0);          // sits below y = 0
    add(foundGeo, "stone");

    // Cornice trim at the top of the foundation (just above grade)
    const corniceGeo = new BoxGeometry(foundW + 0.005 * S, 0.004 * S, foundD + 0.005 * S);
    corniceGeo.translate(0, 0.002 * S, 0);
    add(corniceGeo, "stoneDk");

    // ── Wide 1-storey base ──
    const baseW = 0.12 * S, baseD = 0.10 * S, baseH = 0.03 * S;
    const baseGeo = new BoxGeometry(baseW, baseH, baseD);
    baseGeo.translate(0, baseH / 2, 0);
    add(baseGeo, "stone");

    // Corner pillars (buttresses)
    const pillarW = 0.018 * S;
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const pillar = new BoxGeometry(pillarW, baseH + 0.004 * S, pillarW);
        pillar.translate(dx * (baseW / 2), baseH / 2, dz * (baseD / 2));
        add(pillar, "stoneDk");
      }
    }

    // Stairs at the entrance
    const stairW = 0.03 * S;
    for (let i = 0; i < 3; i++) {
      const step = new BoxGeometry(stairW, 0.004 * S, 0.008 * S);
      step.translate(0, 0.002 * S + i * 0.004 * S, baseD / 2 + 0.015 * S - i * 0.006 * S);
      add(step, "step");
    }

    // Flat roof slab
    const roofGeo = new BoxGeometry(baseW + 0.01 * S, 0.003 * S, baseD + 0.01 * S);
    roofGeo.translate(0, baseH + 0.0015 * S, 0);
    add(roofGeo, "stoneDk");

    // Balcony railing
    const railH = 0.008 * S;
    const railT = 0.002 * S;
    for (const dz of [-1, 1]) {
      const rail = new BoxGeometry(baseW + 0.01 * S, railH, railT);
      rail.translate(0, baseH + 0.003 * S + railH / 2, dz * (baseD / 2 + 0.004 * S));
      add(rail, "frame");
    }
    for (const dx of [-1, 1]) {
      const rail = new BoxGeometry(railT, railH, baseD + 0.01 * S);
      rail.translate(dx * (baseW / 2 + 0.004 * S), baseH + 0.003 * S + railH / 2, 0);
      add(rail, "frame");
    }

    // Door
    const doorW = 0.018 * S, doorH = 0.022 * S;
    const doorGeo = new BoxGeometry(doorW, doorH, 0.004 * S);
    doorGeo.translate(0, doorH / 2 + 0.012 * S, baseD / 2 + 0.001 * S);
    add(doorGeo, "door");
    
    // Door frame
    const dFrameGeo = new BoxGeometry(doorW + 0.004 * S, doorH + 0.002 * S, 0.002 * S);
    dFrameGeo.translate(0, doorH / 2 + 0.013 * S, baseD / 2 + 0.002 * S);
    add(dFrameGeo, "frame");

    // Windows — 2 per long side (4 windows + 4 frames)
    const winSize = 0.012 * S;
    for (const side of [-1, 1]) {
      for (const xOff of [-0.035 * S, 0.035 * S]) {
        const winGeo = new BoxGeometry(winSize, winSize, 0.003 * S);
        winGeo.translate(xOff, baseH * 0.55, (baseD / 2 + 0.001 * S) * side);
        add(winGeo, "window");
        const frameGeo = new BoxGeometry(winSize + 0.004 * S, winSize + 0.004 * S, 0.002 * S);
        frameGeo.translate(xOff, baseH * 0.55, (baseD / 2 + 0.002 * S) * side);
        add(frameGeo, "frame");
      }
    }

    // ── Short cylindrical drum ──
    const drumR = 0.045 * S, drumH = 0.015 * S, drumY = baseH + 0.003 * S;
    const drumGeo = new CylinderGeometry(drumR, drumR + 0.002 * S, drumH, 24);
    drumGeo.translate(0, drumY + drumH / 2, 0);
    add(drumGeo, "stone");

    // Decorative band at drum top
    const bandGeo = new CylinderGeometry(drumR + 0.003 * S, drumR + 0.003 * S, 0.003 * S, 24);
    bandGeo.translate(0, drumY + drumH, 0);
    add(bandGeo, "stoneDk");

    // ── Large hemisphere dome ──
    const domeR = drumR + 0.001 * S;
    const domeY = drumY + drumH + 0.001 * S;
    const profilePoints: Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const angle = (i / 16) * Math.PI * 0.5;
      profilePoints.push(new Vector2(Math.cos(angle) * domeR, Math.sin(angle) * domeR));
    }
    const domeGeo = new LatheGeometry(profilePoints, 24);
    domeGeo.translate(0, domeY, 0);
    add(domeGeo, "dome");

    // ── Dark grey stripe across the dome surface — 16 segments merged into 1 ──
    const slitAngle = rand() * Math.PI * 2;
    const stripeW = 0.01 * S;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI, a1 = ((i + 1) / 16) * Math.PI;
      const y0 = domeY + Math.sin(a0) * domeR, y1 = domeY + Math.sin(a1) * domeR;
      const r0 = Math.cos(a0) * (domeR + 0.001 * S), r1 = Math.cos(a1) * (domeR + 0.001 * S);
      const segH = Math.sqrt((y1 - y0) ** 2 + (r1 - r0) ** 2);
      const segGeo = new BoxGeometry(stripeW, segH, 0.003 * S);
      segGeo.rotateX(Math.atan2(r1 - r0, y1 - y0));
      segGeo.translate(0, (y0 + y1) / 2, (r0 + r1) / 2);
      segGeo.rotateY(slitAngle);
      add(segGeo, "slit");
    }

    // ── Telescope tube ──
    const scopeR = 0.007 * S;
    const scopeGeo = new CylinderGeometry(scopeR, scopeR * 0.85, domeR * 1.2, 12);
    scopeGeo.rotateX(-(Math.PI * 0.30));
    scopeGeo.translate(0, domeY + domeR * 0.42, domeR * 0.22);
    scopeGeo.rotateY(slitAngle);
    add(scopeGeo, "finder");

    // Telescope dew shield (merged into slit bucket — same dark colour)
    const shieldGeo = new CylinderGeometry(scopeR * 1.3, scopeR * 1.1, 0.012 * S, 12);
    shieldGeo.rotateX(-(Math.PI * 0.30));
    shieldGeo.translate(0, domeY + domeR * 0.68, domeR * 0.40);
    shieldGeo.rotateY(slitAngle);
    add(shieldGeo, "slit");
    
    // Telescope counterweight / mount detail
    const mountGeo = new BoxGeometry(0.01 * S, 0.015 * S, 0.01 * S);
    mountGeo.translate(0, domeY + domeR * 0.25, domeR * 0.1);
    mountGeo.rotateY(slitAngle);
    add(mountGeo, "frame");

    // ── Secondary small dome (Transit room) ──
    const secW = 0.035 * S;
    const secGeo = new BoxGeometry(secW, 0.02 * S, secW);
    secGeo.translate(-baseW * 0.35, baseH + 0.01 * S, -baseD * 0.35);
    add(secGeo, "stone");
    
    const secDome = new SphereGeometry(secW * 0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    secDome.translate(-baseW * 0.35, baseH + 0.02 * S, -baseD * 0.35);
    add(secDome, "dome");
    
    const secSlit = new BoxGeometry(0.004 * S, secW * 0.5, 0.004 * S);
    secSlit.translate(-baseW * 0.35, baseH + 0.025 * S, -baseD * 0.35 + secW * 0.2);
    add(secSlit, "slit");

    // ── Small chimney / vent ──
    const ventGeo = new CylinderGeometry(0.003 * S, 0.004 * S, 0.015 * S, 6);
    ventGeo.translate(baseW * 0.35, baseH + 0.0075 * S, baseD * 0.35);
    add(ventGeo, "stoneDk");

    // ── Merge each bucket into a single Mesh ──
    const g = new Group();
    for (const key of Object.keys(buckets) as (keyof typeof m)[]) {
      const geos = buckets[key];
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      if (merged) g.add(new Mesh(merged, m[key]));
      // Source geometries consumed — dispose them.
      for (const geo of geos) geo.dispose();
    }
    
    // Soft warm glow on the ground
    const glowSize = baseW * 3.5;
    const glowGeo = new PlaneGeometry(glowSize, glowSize);
    const glowMesh = new Mesh(glowGeo, this.getSharedGroundGlowMat());
    glowMesh.rotation.x = -Math.PI / 2;
    glowMesh.position.set(0, 0.001, 0);
    g.add(glowMesh);

    return g;
  }

  private createBalloonMesh(primary: number, secondary: number): Group {
    const S = 0.084;
    const profile = [
      new Vector2(S * 0.28, S * -1.15),
      new Vector2(S * 0.22, S * -1.00),
      new Vector2(S * 0.30, S * -0.80),
      new Vector2(S * 0.50, S * -0.45),
      new Vector2(S * 0.75, S * -0.05),
      new Vector2(S * 0.95, S *  0.35),
      new Vector2(S * 1.05, S *  0.65),
      new Vector2(S * 1.08, S *  0.90),
      new Vector2(S * 1.02, S *  1.10),
      new Vector2(S * 0.88, S *  1.25),
      new Vector2(S * 0.65, S *  1.38),
      new Vector2(S * 0.38, S *  1.48),
      new Vector2(S * 0.12, S *  1.54),
      new Vector2(S * 0.00, S *  1.56),
    ];

    const GORE_COUNT = 12;
    const LATHE_SEGS = 36;

    const throatY = profile[0].y;
    const throatR = profile[0].x;
    const basketTopY = throatY - S * 0.35;
    const basketBotY = throatY - S * 0.65;
    const basketR = S * 0.18;
    const basketColor = new Color(0x8b6914);
    const rimColor = new Color(0x6b4e10);
    const ropeColor = new Color(0x554422);

    const balloon = new Group();
    const colA = new Color(primary);
    const colB = new Color(secondary);
    const skirtColor = new Color(primary);

    const parts: { geo: BufferGeometry; color: Color }[] = [];

    const envGeo = new LatheGeometry(profile, LATHE_SEGS);
    const envPos = envGeo.attributes.position;
    const envColArr = new Float32Array(envPos.count * 3);
    for (let v = 0; v < envPos.count; v++) {
      let a = Math.atan2(envPos.getZ(v), envPos.getX(v));
      if (a < 0) a += Math.PI * 2;
      const gore = Math.floor((a / (Math.PI * 2)) * GORE_COUNT);
      const c = gore % 2 === 0 ? colA : colB;
      envColArr[v * 3] = c.r;
      envColArr[v * 3 + 1] = c.g;
      envColArr[v * 3 + 2] = c.b;
    }
    envGeo.setAttribute("color", new Float32BufferAttribute(envColArr, 3));
    envGeo.computeVertexNormals();

    const skirtGeo = new CylinderGeometry(throatR * 0.85, throatR * 1.05, S * 0.12, 12, 1, true);
    skirtGeo.translate(0, throatY - S * 0.06, 0);
    parts.push({ geo: skirtGeo, color: skirtColor });

    const bodyGeo = new CylinderGeometry(basketR, basketR * 0.9, basketBotY - basketTopY, 8);
    bodyGeo.translate(0, (basketTopY + basketBotY) / 2, 0);
    parts.push({ geo: bodyGeo, color: basketColor });

    const rimGeo = new CylinderGeometry(basketR + S * 0.01, basketR + S * 0.01, S * 0.02, 12);
    rimGeo.translate(0, basketTopY, 0);
    parts.push({ geo: rimGeo, color: rimColor });

    const baseGeo = new CylinderGeometry(basketR * 0.9, basketR * 0.9, S * 0.015, 12);
    baseGeo.translate(0, basketBotY, 0);
    parts.push({ geo: baseGeo, color: rimColor });

    const dummy = new Object3D();
    const REF_UP = new Vector3(0, 1, 0);
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      const topX = Math.cos(a) * throatR * 0.9;
      const topZ = Math.sin(a) * throatR * 0.9;
      const botX = Math.cos(a) * basketR * 0.85;
      const botZ = Math.sin(a) * basketR * 0.85;
      const dx = botX - topX;
      const dy = basketTopY - throatY;
      const dz = botZ - topZ;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ropeGeo = new CylinderGeometry(0.001, 0.001, len, 3);
      dummy.position.set(
        (topX + botX) / 2,
        (throatY + basketTopY) / 2,
        (topZ + botZ) / 2,
      );
      dummy.quaternion.setFromUnitVectors(REF_UP, new Vector3(dx, dy, dz).normalize());
      dummy.updateMatrix();
      ropeGeo.applyMatrix4(dummy.matrix);
      parts.push({ geo: ropeGeo, color: ropeColor });
    }

    const mergedGeo = this.mergeColoredParts(parts);

    const totalVerts = envPos.count + mergedGeo.attributes.position.count;
    const finalPos = new Float32Array(totalVerts * 3);
    const finalNorm = new Float32Array(totalVerts * 3);
    const finalCol = new Float32Array(totalVerts * 3);
    const finalIdx: number[] = [];

    const ep = envGeo.attributes.position;
    const en = envGeo.attributes.normal;
    const ec = envGeo.attributes.color;
    for (let v = 0; v < ep.count; v++) {
      const i3 = v * 3;
      finalPos[i3] = ep.getX(v);
      finalPos[i3 + 1] = ep.getY(v);
      finalPos[i3 + 2] = ep.getZ(v);
      finalNorm[i3] = en.getX(v);
      finalNorm[i3 + 1] = en.getY(v);
      finalNorm[i3 + 2] = en.getZ(v);
      finalCol[i3] = ec.getX(v);
      finalCol[i3 + 1] = ec.getY(v);
      finalCol[i3 + 2] = ec.getZ(v);
    }
    if (envGeo.index) {
      for (let j = 0; j < envGeo.index.count; j++) {
        finalIdx.push(envGeo.index.getX(j));
      }
    }

    const mp = mergedGeo.attributes.position;
    const mn = mergedGeo.attributes.normal;
    const mc = mergedGeo.attributes.color;
    const off = ep.count;
    for (let v = 0; v < mp.count; v++) {
      const i3 = (off + v) * 3;
      finalPos[i3] = mp.getX(v);
      finalPos[i3 + 1] = mp.getY(v);
      finalPos[i3 + 2] = mp.getZ(v);
      finalNorm[i3] = mn.getX(v);
      finalNorm[i3 + 1] = mn.getY(v);
      finalNorm[i3 + 2] = mn.getZ(v);
      finalCol[i3] = mc.getX(v);
      finalCol[i3 + 1] = mc.getY(v);
      finalCol[i3 + 2] = mc.getZ(v);
    }
    if (mergedGeo.index) {
      for (let j = 0; j < mergedGeo.index.count; j++) {
        finalIdx.push(mergedGeo.index.getX(j) + off);
      }
    }

    const fullGeo = new BufferGeometry();
    fullGeo.setAttribute("position", new Float32BufferAttribute(finalPos, 3));
    fullGeo.setAttribute("normal", new Float32BufferAttribute(finalNorm, 3));
    fullGeo.setAttribute("color", new Float32BufferAttribute(finalCol, 3));
    fullGeo.setIndex(finalIdx);
    envGeo.dispose();
    mergedGeo.dispose();

    const mat = new MeshPhongMaterial({ vertexColors: true, shininess: 15 });
    addRimLight(mat, 0xffeedd, 0.3, 3.0);
    const mesh = new Mesh(fullGeo, mat);
    mesh.castShadow = true;
    mesh.userData.paintSplatterSurface = true;
    balloon.add(mesh);

    const burnerGeo = new SphereGeometry(S * 0.05, 6, 4);
    burnerGeo.translate(0, throatY + S * 0.02, 0);
    balloon.add(new Mesh(burnerGeo, new MeshPhongMaterial({
      color: 0xff8800,
      emissive: 0xff5500,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.5,
    })));

    return balloon;
  }

  /**
   * Same layout as race start markers: two balloons + double-sided banner (readable from both sides).
   * Used for the procedural finish line in {@link RaceManager}.
   */
  populateRaceBannerDecorGroup(
    bannerGroup: Group,
    mat: MeshPhongMaterial,
    width: number,
    height: number,
    salt: number,
  ): void {
    const rand = seededRandom(887766 + this.seed + Math.imul(salt, 131));
    const halfW = width * 0.5;
    const [p1, s1] = BALLOON_SCHEMES[Math.floor(rand() * BALLOON_SCHEMES.length)]!;
    const leftBalloon = this.createBalloonMesh(p1, s1);
    leftBalloon.position.set(-halfW, 0, 0);
    bannerGroup.add(leftBalloon);

    const [p2, s2] = BALLOON_SCHEMES[Math.floor(rand() * BALLOON_SCHEMES.length)]!;
    const rightBalloon = this.createBalloonMesh(p2, s2);
    rightBalloon.position.set(halfW, 0, 0);
    bannerGroup.add(rightBalloon);

    const geo = new PlaneGeometry(width, height, 16, 2);
    this.addDoubleSidedRaceBannerPlanes(bannerGroup, mat, geo, -0.11);
  }

  /** Front + back planes so checker/text read correctly from either viewing direction. */
  private drawRaceBannerLabelCanvas(ctx: CanvasRenderingContext2D, label: string) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = "#000000";
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 2; y++) {
        if ((x + y) % 2 === 0) {
          ctx.fillRect(x * 64, y * 64, 64, 64);
        }
      }
    }
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#000000";
    ctx.strokeText(label, 256, 64);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, 256, 64);
  }

  /**
   * Three.js ≥ r160 samples the map via `vMapUv` (not `vUv`).
   * We patch `#include <map_fragment>` to flip vMapUv.x on back faces so "START" / "FINISH"
   * read correctly from both sides with a single DoubleSide mesh — no geometry tricks needed.
   */
  private applyRaceBannerFabricSway(mat: MeshPhongMaterial) {
    mat.side = DoubleSide;
    const base = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      base?.(shader, renderer);
      shader.uniforms.oceanTime = this.oceanTime;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nuniform float oceanTime;'
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float swayMask = cos(position.x * 6.28318);
        transformed.z += sin(oceanTime * 4.0 + position.x * 12.0) * 0.04 * swayMask;
        transformed.y += sin(oceanTime * 5.0 + position.x * 15.0) * 0.01 * swayMask;
        `
      );
      // Flip the texture horizontally on the back face so text is readable from both sides.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 _bannerUv = vMapUv;
          if (!gl_FrontFacing) _bannerUv.x = 1.0 - _bannerUv.x;
          vec4 sampledDiffuseColor = texture2D( map, _bannerUv );
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferOETF( sampledDiffuseColor );
          #endif
          diffuseColor *= sampledDiffuseColor;
        #endif`
      );
    };
  }

  /** Single DoubleSide mesh; the sway+UV-flip shader handles both faces automatically. */
  private addDoubleSidedRaceBannerPlanes(
    parent: Group,
    mat: MeshPhongMaterial,
    geo: PlaneGeometry,
    y: number,
  ) {
    const mesh = new Mesh(geo, mat);
    mesh.position.set(0, y, 0);
    mesh.castShadow = true;
    parent.add(mesh);
  }

  private createBalloons() {
    const rand = seededRandom(999 + this.seed);
    const REF_UP = new Vector3(0, 1, 0);

    for (let i = 0; i < BALLOON_COUNT; i++) {
      const [primary, secondary] = BALLOON_SCHEMES[i % BALLOON_SCHEMES.length]!;
      const balloon = this.createBalloonMesh(primary, secondary);

      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const normal = new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ).normalize();

      const baseAlt = this.radius + BALLOON_ALTITUDE + (rand() - 0.5) * 0.3;
      const scale = MathUtils.lerp(0.8, 1.2, rand());
      balloon.scale.setScalar(scale);

      const pivot = new Group();
      pivot.position.copy(normal.clone().multiplyScalar(baseAlt));
      pivot.quaternion.setFromUnitVectors(REF_UP, normal);
      pivot.add(balloon);

      this.group.add(pivot);
      this.balloons.push({
        pivot,
        inner: balloon,
        normal: normal.clone(),
        baseAlt,
        phase: rand() * Math.PI * 2,
        wobbleAmp: 0,
        wobblePhase: 0,
        wobbleBank: 0,
      });
    }
  }

  private createRaceBanners() {
    const RACE_BANNER_COUNT = 3;
    const MIN_ELEVATION = 0.05;
    const MAX_ELEVATION = 0.5;
    const MIN_SEPARATION_DOT = 0.85;

    const rand = seededRandom(112233 + this.seed);
    const REF_UP = new Vector3(0, 1, 0);

    type Candidate = { normal: Vector3; elevation: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 5000 && candidates.length < 100) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.observatoryCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.stonehengeCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.shrineCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.hotspringCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.mushroomCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.butterflyCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.pyramidCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.statueCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

      candidates.push({ normal, elevation });
    }

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= RACE_BANNER_COUNT) break;
      if (chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT)) continue;
      chosen.push(c.normal);
    }

    if (chosen.length === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    this.drawRaceBannerLabelCanvas(ctx, "START");
    const sharedTex = new CanvasTexture(canvas);
    const sharedMat = new MeshPhongMaterial({ map: sharedTex, side: DoubleSide });
    addRimLight(sharedMat, 0xffeedd, 0.3, 3.0);
    this.applyRaceBannerFabricSway(sharedMat);

    this.raceBannerTex = sharedTex;
    this.raceBannerMat = sharedMat;

    const finishCanvas = document.createElement("canvas");
    finishCanvas.width = 512;
    finishCanvas.height = 128;
    const fctx = finishCanvas.getContext("2d")!;
    this.drawRaceBannerLabelCanvas(fctx, "FINISH");
    const finishTex = new CanvasTexture(finishCanvas);
    const finishMat = new MeshPhongMaterial({ map: finishTex, side: DoubleSide });
    addRimLight(finishMat, 0xffeedd, 0.3, 3.0);
    this.applyRaceBannerFabricSway(finishMat);
    this.raceFinishBannerTex = finishTex;
    this.raceFinishBannerMat = finishMat;

    for (const normal of chosen) {
      this.raceBannerCenters.push({ normal: normal.clone() });

      const bannerGroup = new Group();

      const [p1, s1] = BALLOON_SCHEMES[Math.floor(rand() * BALLOON_SCHEMES.length)]!;
      const leftBalloon = this.createBalloonMesh(p1, s1);
      leftBalloon.position.set(-0.25, 0, 0);
      bannerGroup.add(leftBalloon);

      const [p2, s2] = BALLOON_SCHEMES[Math.floor(rand() * BALLOON_SCHEMES.length)]!;
      const rightBalloon = this.createBalloonMesh(p2, s2);
      rightBalloon.position.set(0.25, 0, 0);
      bannerGroup.add(rightBalloon);

      const bannerGeo = new PlaneGeometry(0.5, 0.12, 16, 2);
      this.addDoubleSidedRaceBannerPlanes(bannerGroup, sharedMat, bannerGeo, -0.11);

      const baseAlt = this.radius + BALLOON_ALTITUDE + (rand() - 0.5) * 0.2;
      const spin = rand() * Math.PI * 2;

      const pivot = new Group();
      pivot.position.copy(normal.clone().multiplyScalar(baseAlt));
      pivot.quaternion.setFromUnitVectors(REF_UP, normal);
      pivot.rotateY(spin);
      pivot.add(bannerGroup);

      this.group.add(pivot);
      this.raceBanners.push({
        pivot,
        inner: bannerGroup,
        normal: normal.clone(),
        baseAlt,
        phase: rand() * Math.PI * 2,
      });
    }
  }

  private createClouds() {
    const rand = seededRandom(77);
    this.cloudOpacityUniform = { value: this.cloudOpacityValue };
    const cloudMat = new ShaderMaterial({
      uniforms: {
        cloudColor: { value: new Color(0xffe8cc) },
        opacity: this.cloudOpacityUniform,
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 cloudColor;
        uniform float opacity;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec3 vLocalPos;
        void main() {
          vec3 viewDir = normalize(-vViewPosition);
          // Soften edges to camera
          float rim = abs(dot(vNormal, viewDir));
          // Fade the bottom of the puffs to create a cohesive flat cloud base
          // vLocalPos.y goes from -1 to 1.
          float upFactor = smoothstep(-0.8, 0.2, vLocalPos.y);
          
          float soft = rim * rim * (0.3 + 0.7 * upFactor);
          gl_FragColor = vec4(cloudColor * soft, opacity * soft);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const puffGeo = new SphereGeometry(1, 16, 12);
    const cloudAlt = this.radius + CLOUD_ALTITUDE;

    const cloudSizes = [
      { puffs: [2, 3], baseScale: 0.12, spread: 0.2, weight: 0.3 },
      { puffs: [4, 6], baseScale: 0.22, spread: 0.45, weight: 0.4 },
      { puffs: [7, 10], baseScale: 0.3, spread: 0.7, weight: 0.2 },
      { puffs: [10, 14], baseScale: 0.35, spread: 0.9, weight: 0.1 },
    ];

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cloud = new Group();

      const r = rand();
      let cumWeight = 0;
      let sizeType = cloudSizes[0];
      for (const cs of cloudSizes) {
        cumWeight += cs.weight;
        if (r < cumWeight) { sizeType = cs; break; }
      }

      const puffCount = sizeType.puffs[0] + Math.floor(rand() * (sizeType.puffs[1] - sizeType.puffs[0] + 1));
      const spread = sizeType.spread;

      for (let p = 0; p < puffCount; p++) {
        const puff = new Mesh(puffGeo, cloudMat);
        
        // First puff is the core, others scatter around it
        const isCenter = p === 0;
        const distRatio = isCenter ? 0 : Math.pow(rand(), 0.6); // 0 to 1, biased toward center
        const dist = distRatio * spread;
        const angle = rand() * Math.PI * 2;
        
        const baseRadius = sizeType.baseScale * MathUtils.lerp(0.9, 1.1, rand());
        
        // Puffs get smaller the further they are from the center
        const sizeFalloff = 1.0 - (distRatio * 0.6); 
        
        const sx = baseRadius * sizeFalloff * MathUtils.lerp(1.2, 2.0, rand());
        // Y scale (height) shrinks even more at the edges to create a domed top
        const sy = baseRadius * sizeFalloff * sizeFalloff * MathUtils.lerp(1.0, 1.8, rand());
        const sz = baseRadius * sizeFalloff * MathUtils.lerp(1.2, 2.0, rand());
        
        puff.scale.set(sx, sy, sz);
        
        // Align the bottoms to create a flatter cumulus cloud base
        // Sphere ranges from -1 to +1, so the bottom is at -sy.
        // We set Y position to +sy so the bottom is roughly at Y=0.
        const bottomAlign = sy * 0.8;
        const jitterY = (rand() - 0.5) * sy * 0.3;

        puff.position.set(
          Math.cos(angle) * dist,
          bottomAlign + jitterY,
          Math.sin(angle) * dist * 0.7,
        );
        puff.castShadow = true;
        cloud.add(puff);
      }

      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const normal = new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ).normalize();

      const altVariation = cloudAlt + (rand() - 0.5) * 0.3;
      cloud.position.copy(normal).multiplyScalar(altVariation);
      cloud.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);

      this.cloudRing.add(cloud);
    }

    this.group.add(this.cloudRing);
  }

  private createAtmosphere() {
    const geo = new SphereGeometry(this.radius * 1.55, 48, 48);
    this.atmosphereGlowUniform = { value: new Color(this.atmosphereGlowColor) };
    const mat = new ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      uniforms: {
        glowColor: this.atmosphereGlowUniform,
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    this.atmosphereMesh = new Mesh(geo, mat);
    this.group.add(this.atmosphereMesh);
  }

  setAtmosphereGlow(color: number) {
    this.atmosphereGlowUniform.value.set(color);
  }

  setCloudOpacity(opacity: number) {
    this.cloudOpacityUniform.value = opacity;
  }

  setRimColor(color: number) {
    this.rimColorValue.set(color);
  }

  /** Updates ocean vertex colors and foam from the blended day/night preset (call each frame with preset). */
  setOceanColors(shallow: number, deep: number, foam: number) {
    if (
      this.oceanShallowColor === shallow &&
      this.oceanDeepColor === deep &&
      this.foamColorValue.getHex() === foam
    ) {
      return;
    }

    this.oceanShallowColor = shallow;
    this.oceanDeepColor = deep;
    this.foamColorValue.set(foam);

    const geo = this.surfaceMesh.geometry as BufferGeometry;
    const colorAttr = geo.attributes.color as Float32BufferAttribute;
    const colors = colorAttr.array as Float32Array;
    const vertexCount = colors.length / 3;

    const cShallow = new Color(shallow);
    const cDeep = new Color(deep);
    const sr = cShallow.r;
    const sg = cShallow.g;
    const sb = cShallow.b;
    const dr = cDeep.r;
    const dg = cDeep.g;
    const db = cDeep.b;
    const od = this.vertexOceanDepth;

    for (let i = 0; i < vertexCount; i++) {
      const t = od[i];
      if (t < 0) continue;
      const j = i * 3;
      const u = 1 - t;
      colors[j] = sr * u + dr * t;
      colors[j + 1] = sg * u + dg * t;
      colors[j + 2] = sb * u + db * t;
    }

    colorAttr.needsUpdate = true;
  }

  private createLighthouses() {
    const LIGHTHOUSE_COUNT = 3;
    const WATER_CHECKS = 12;
    const CHECK_DIST = 0.06;
    const MIN_WATER_RATIO = 0.55;
    const MIN_SEPARATION_DOT = 0.92;

    const rand = seededRandom(777 + this.seed);

    type Candidate = { normal: Vector3; waterRatio: number };
    const candidates: Candidate[] = [];
    let attempts = 0;

    while (attempts < 2000 && candidates.length < 60) {
      attempts++;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const terrain = this.sampleTerrainAt(nx, ny, nz);
      if (!terrain.isLand) continue;
      const elevation = terrain.elevation;
      if (elevation > 0.15) continue;

      const centerNormal = new Vector3(nx, ny, nz);
      const waterRatio = this.waterRatioAround(centerNormal, CHECK_DIST, WATER_CHECKS);
      if (waterRatio < MIN_WATER_RATIO) continue;

      const tooCloseToVillage = this.villageCenters.some(
        (v) => centerNormal.dot(v.normal) > 0.98,
      );
      if (tooCloseToVillage) continue;

      candidates.push({ normal: centerNormal, waterRatio });
    }

    candidates.sort((a, b) => b.waterRatio - a.waterRatio);

    const chosen: Vector3[] = [];
    for (const c of candidates) {
      if (chosen.length >= LIGHTHOUSE_COUNT) break;
      const tooClose = chosen.some((v) => c.normal.dot(v) > MIN_SEPARATION_DOT);
      if (tooClose) continue;
      chosen.push(c.normal);
    }

    if (chosen.length === 0) return;

    const REF_UP = new Vector3(0, 1, 0);

    for (const normal of chosen) {
      this.lighthouseCenters.push({ normal: normal.clone() });

      const displacement = surfaceDisplacementAt(this.seed, this.terrainType, normal.x, normal.y, normal.z);
      const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;

      const lighthouse = new Group();

      const towerH = 0.18;
      const towerRBot = 0.021;
      const towerRTop = 0.015;
      
      // Base platform
      const baseH = 0.015;
      const baseR = towerRBot + 0.01;
      const baseGeo = new CylinderGeometry(baseR, baseR + 0.005, baseH, 12);
      baseGeo.translate(0, baseH / 2, 0);
      const stoneMat = new MeshPhongMaterial({ color: 0x8e8984, flatShading: true });
      addRimLight(stoneMat, 0xe8e0d8, 0.36, 2.75);
      lighthouse.add(new Mesh(baseGeo, stoneMat));

      const towerGeo = new CylinderGeometry(towerRTop, towerRBot, towerH, 16);
      towerGeo.translate(0, towerH / 2, 0);
      const towerMat = new MeshPhongMaterial({ color: 0xf5f0e8, flatShading: true });
      addRimLight(towerMat, 0xffffff, 0.4, 2.5);
      lighthouse.add(new Mesh(towerGeo, towerMat));

      // Door
      const doorW = 0.012;
      const doorH = 0.018;
      const doorGeo = new BoxGeometry(doorW, doorH, 0.005);
      doorGeo.translate(0, doorH / 2 + baseH, towerRBot);
      const doorMat = new MeshPhongMaterial({ color: 0x5a4030, flatShading: true });
      lighthouse.add(new Mesh(doorGeo, doorMat));

      // Windows going up the tower
      const winSize = 0.006;
      const winGeo = new BoxGeometry(winSize, winSize * 1.5, 0.005);
      const winMat = new MeshPhongMaterial({ color: 0x1a2530, flatShading: true });
      for (let i = 1; i <= 3; i++) {
        const wy = baseH + (towerH / 4) * i;
        const wr = MathUtils.lerp(towerRBot, towerRTop, wy / towerH);
        const win = new Mesh(winGeo, winMat);
        win.position.set(0, wy, wr);
        lighthouse.add(win);
      }

      // Red stripes
      const stripeMat = new MeshPhongMaterial({ color: 0xcc3333, flatShading: true });
      addRimLight(stripeMat, 0xff8866, 0.4, 2.5);
      
      const stripeH = 0.025;
      const stripeY = towerH * 0.55;
      const stripeR = MathUtils.lerp(towerRBot, towerRTop, 0.55) + 0.001;
      const stripeGeo = new CylinderGeometry(stripeR, stripeR + 0.001, stripeH, 16);
      stripeGeo.translate(0, stripeY, 0);
      lighthouse.add(new Mesh(stripeGeo, stripeMat));

      const stripe2Y = towerH * 0.3;
      const stripe2R = MathUtils.lerp(towerRBot, towerRTop, 0.3) + 0.001;
      const stripe2Geo = new CylinderGeometry(stripe2R, stripe2R + 0.001, stripeH, 16);
      stripe2Geo.translate(0, stripe2Y, 0);
      lighthouse.add(new Mesh(stripe2Geo, stripeMat));

      // Lantern room
      const lanternY = towerH;
      const lanternR = towerRTop + 0.006;
      const lanternH = 0.025;
      
      // Walkway / Gallery deck
      const deckGeo = new CylinderGeometry(lanternR + 0.004, lanternR + 0.002, 0.004, 16);
      deckGeo.translate(0, lanternY, 0);
      const metalMat = new MeshPhongMaterial({ color: 0x333333, flatShading: true });
      lighthouse.add(new Mesh(deckGeo, metalMat));
      
      // Railing
      const railGeo = new CylinderGeometry(lanternR + 0.003, lanternR + 0.003, 0.008, 16, 1, true);
      railGeo.translate(0, lanternY + 0.004, 0);
      const railMat = new MeshPhongMaterial({ color: 0x222222, wireframe: true });
      lighthouse.add(new Mesh(railGeo, railMat));

      // Glass lantern housing
      const lanternGeo = new CylinderGeometry(lanternR, lanternR, lanternH, 12);
      lanternGeo.translate(0, lanternY + lanternH / 2, 0);
      const lanternMat = new MeshPhongMaterial({ color: 0xfff8dd, emissive: 0xffdd44, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 });
      lighthouse.add(new Mesh(lanternGeo, lanternMat));
      
      // Soft warm glow around the lantern (billboard-like sprite)
      const glowSize = lanternR * 12.0;
      const glowGeo = new PlaneGeometry(glowSize, glowSize);
      const glowMat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            // Billboard to camera
            vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            mvPosition.xy += position.xy;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          void main() {
            float dist = distance(vUv, vec2(0.5));
            float alpha = smoothstep(0.5, 0.0, dist);
            // Warm orange-yellow glow
            vec3 color = vec3(1.0, 0.7, 0.2);
            // Quadratic falloff for softer edge
            gl_FragColor = vec4(color, alpha * alpha * 0.6);
          }
        `
      });
      const glowMesh = new Mesh(glowGeo, glowMat);
      glowMesh.position.set(0, lanternY + lanternH / 2, 0);
      lighthouse.add(glowMesh);
      
      // Soft warm glow on the ground (baked light decal)
      const groundGlowSize = baseR * 8.0;
      const groundGlowGeo = new PlaneGeometry(groundGlowSize, groundGlowSize);
      const groundGlowMesh = new Mesh(groundGlowGeo, this.getSharedGroundGlowMat());
      groundGlowMesh.rotation.x = -Math.PI / 2;
      groundGlowMesh.position.set(0, 0.001, 0); // Just above ground
      lighthouse.add(groundGlowMesh);
      
      // Lantern struts
      const strutGeo = new CylinderGeometry(0.001, 0.001, lanternH, 4);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const strut = new Mesh(strutGeo, metalMat);
        strut.position.set(Math.cos(angle) * lanternR, lanternY + lanternH / 2, Math.sin(angle) * lanternR);
        lighthouse.add(strut);
      }

      // Roof (Cupola)
      const roofMat = new MeshPhongMaterial({ color: 0xcc3333, flatShading: true }); // Red roof
      addRimLight(roofMat, 0xff8866, 0.4, 2.5);
      
      const roofGeo = new CylinderGeometry(0.002, lanternR + 0.003, 0.016, 16);
      roofGeo.translate(0, lanternY + lanternH + 0.008, 0);
      lighthouse.add(new Mesh(roofGeo, roofMat));
      
      // Roof ball / vent
      const ballGeo = new SphereGeometry(0.004, 8, 8);
      ballGeo.translate(0, lanternY + lanternH + 0.018, 0);
      lighthouse.add(new Mesh(ballGeo, metalMat));

      // Light beams
      const beamLen = 0.8;
      const beamSpread = 0.1;
      const beamGeo = new CylinderGeometry(beamSpread, 0.002, beamLen, 12, 1, true);
      beamGeo.rotateZ(-Math.PI / 2);
      beamGeo.translate(beamLen / 2, 0, 0);

      const beamMat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          beamColorNear: { value: new Color(0xffee44) },
          beamColorFar: { value: new Color(0xff6600) },
        },
        vertexShader: `
          varying float vLen;
          varying vec3 vNorm;
          varying vec3 vViewDir;
          void main() {
            vLen = uv.y;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewDir = -mvPos.xyz;
            vNorm = normalMatrix * normal;
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform vec3 beamColorNear;
          uniform vec3 beamColorFar;
          varying float vLen;
          varying vec3 vNorm;
          varying vec3 vViewDir;
          void main() {
            float lengthFade = 1.0 - vLen * vLen;
            vec3 N = normalize(vNorm);
            vec3 V = normalize(vViewDir);
            float facing = abs(dot(N, V));
            float edgeFade = smoothstep(0.0, 0.4, facing);
            float alpha = edgeFade * lengthFade * 0.4;
            vec3 col = mix(beamColorNear, beamColorFar, vLen);
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });

      const beam = new Mesh(beamGeo, beamMat);
      beam.position.y = lanternY + lanternH / 2;
      lighthouse.add(beam);
      this.lighthouseBeams.push(beam);

      lighthouse.position.copy(normal.clone().multiplyScalar(surfaceR));
      lighthouse.quaternion.setFromUnitVectors(REF_UP, normal);
      lighthouse.castShadow = true;

      this.group.add(lighthouse);
    }
  }

  update(dt: number) {
    const q = new Quaternion().setFromAxisAngle(
      this.cloudDriftAxis,
      CLOUD_DRIFT_SPEED * dt,
    );
    this.cloudRing.quaternion.premultiply(q);

    for (const u of this.treeSwayUniforms) {
      u.value += dt;
    }
    this.oceanTime.value += dt;
    this.lighthouseBeamTime += dt;
    this.statueBeamTimeU.value += dt;

    const beamAngle = this.lighthouseBeamTime * 0.8;
    for (const beam of this.lighthouseBeams) {
      beam.rotation.y = beamAngle;
    }

    for (const w of this.windmillBlades) {
      w.pivot.rotation.z += dt * w.speed;
    }

    const now = Date.now();
    if (!this.moonstoneCinematicActive) {
      if (this.moonstonePostUnionActive) {
        const t = now * 0.001;
        const hover = Math.sin(t * 0.7) * 0.02;
        const sharedSpin = new Quaternion().setFromAxisAngle(this.moonstonePostUnionAxis, t * 0.16);
        for (let mi = 0; mi < this.moonstoneRuins.length; mi++) {
          const state = this.moonstoneRuins[mi]!;
          const root = state.root;
          if (!root) continue;
          root.position.copy(this.moonstonePostUnionPoint).addScaledVector(this.moonstonePostUnionAxis, hover);
          const baseQ = this.moonstonePostUnionQuats[mi];
          if (baseQ) {
            root.quaternion.copy(baseQ);
            root.quaternion.premultiply(sharedSpin);
          }
        }
      } else {
        for (let mi = 0; mi < this.moonstoneRuins.length; mi++) {
          const state = this.moonstoneRuins[mi]!;
          const root = state.root;
          if (!root) continue;
          const phase = this.getMoonstonePhase(state.cycleStartAt, now);
          if (phase === "idle") state.cycleStartAt = null;
          const liftAlpha = this.getMoonstoneLiftAlpha(state.cycleStartAt, now);
          const nrm = state.normal;
          root.position.copy(state.basePosition).addScaledVector(nrm, liftAlpha * MOONSTONE_FLOAT_HEIGHT);

          let wobble = 0;
          if (phase === "raising") {
            wobble = 0.2 + 0.8 * liftAlpha;
          } else if (phase === "floating") {
            wobble = 0.1;
          }
          const t = now * 0.001;
          const posAmp = 0.012 * wobble;
          const rotAmp = 0.032 * wobble;
          const k = mi * 2.31 + this.seed * 0.01;
          root.position.addScaledVector(state.tangent, Math.sin(t * 19.2 + k) * posAmp);
          root.position.addScaledVector(state.bitangent, Math.cos(t * 16.7 + k * 1.3) * posAmp);
          root.quaternion.copy(state.restQuaternion);
          root.rotateOnWorldAxis(state.tangent, Math.sin(t * 21.4 + k) * rotAmp);
          root.rotateOnWorldAxis(state.bitangent, Math.cos(t * 18.9 + k * 0.9) * rotAmp);

          this.updateMoonstoneDust(state, dt, now);
        }
      }
    }

    this.balloonTime += dt;
    for (const b of this.balloons) {
      const bob = Math.sin(this.balloonTime * 0.5 + b.phase) * 0.04;
      const alt = b.baseAlt + bob;
      b.pivot.position.copy(b.normal).multiplyScalar(alt);
      b.inner.rotation.y += dt * 0.05;
      
      if (b.wobbleAmp > 0.002) {
        b.wobblePhase += dt * 15;
        b.wobbleBank = Math.sin(b.wobblePhase) * b.wobbleAmp;
        b.wobbleAmp *= Math.exp(-3.5 * dt);
      } else {
        b.wobbleAmp = 0;
        b.wobbleBank = 0;
      }
      b.inner.rotation.z = b.wobbleBank;
    }

    for (const b of this.raceBanners) {
      if (!b.pivot.visible) continue;
      const bob = Math.sin(this.balloonTime * 1.2 + b.phase) * 0.06;
      const alt = b.baseAlt + bob;
      b.pivot.position.copy(b.normal).multiplyScalar(alt);

      const tiltZ = Math.sin(this.balloonTime * 0.8 + b.phase * 1.5) * 0.08;
      const tiltX = Math.cos(this.balloonTime * 0.6 + b.phase * 0.8) * 0.04;
      b.inner.rotation.set(tiltX, 0, tiltZ);
    }
  }

  /** Surface altitude at unit normal (same units as player `altitude`). */
  getSurfaceAltitudeAt(nx: number, ny: number, nz: number): number {
    return surfaceAltitudeAt(this.seed, this.terrainType, nx, ny, nz);
  }

  /** Single material for the FINISH banner; {@link addDoubleSidedRaceBannerPlanes} handles both faces. */
  getRaceFinishBannerMaterial(): MeshPhongMaterial | null {
    return this.raceFinishBannerMat;
  }

  getWorldSeed(): number {
    return this.seed;
  }

  getRaceBanners(): readonly { pivot: Group; normal: Vector3; baseAlt: number; index: number }[] {
    return this.raceBanners.map((b, index) => ({
      pivot: b.pivot,
      normal: b.normal,
      baseAlt: b.baseAlt,
      index,
    }));
  }

  /** When `visible` is false, only the banner at `exceptIndex` stays visible (if in range). */
  setRaceBannersVisible(visible: boolean, exceptIndex = -1) {
    for (let i = 0; i < this.raceBanners.length; i++) {
      this.raceBanners[i]!.pivot.visible = visible ? true : i === exceptIndex;
    }
  }

  hitBalloon(index: number) {
    const b = this.balloons[index];
    if (!b) return;
    b.wobbleAmp = 0.35;
    b.wobblePhase = 0;
  }

  /** World-space point near the basket (for distance checks). */
  getBalloonWorldPosition(index: number, target: Vector3): boolean {
    const b = this.balloons[index];
    if (!b) return false;
    b.pivot.getWorldPosition(target);
    target.addScaledVector(b.normal, -0.08);
    return true;
  }

  addTo(scene: Scene) {
    scene.add(this.group);
  }

  dispose() {
    this.surfaceMesh.geometry.dispose();
    (this.surfaceMesh.material as MeshPhongMaterial).dispose();
    this.atmosphereMesh.geometry.dispose();
    (this.atmosphereMesh.material as ShaderMaterial).dispose();
    for (const state of this.moonstoneRuins) {
      const dust = state.dust;
      if (!dust) continue;
      dust.geometry.dispose();
      const mat = dust.points.material as PointsMaterial;
      mat.map = null;
      mat.dispose();
    }
    moonstoneDustSpriteTexture?.dispose();
    moonstoneDustSpriteTexture = null;
    this.raceBannerTex?.dispose();
    this.raceBannerMat?.dispose();
    this.raceFinishBannerTex?.dispose();
    this.raceFinishBannerMat?.dispose();
  }
}
