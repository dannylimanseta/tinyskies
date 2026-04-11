import {
  Mesh,
  InstancedMesh,
  SphereGeometry,
  BoxGeometry,
  CylinderGeometry,
  MeshPhongMaterial,
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
  BufferGeometry,
  type Scene,
} from "three";
import { addRimLight } from "./RimLight";
import { createNoise3D, terrainNoise, isLand } from "./SimplexNoise";
import { getTerrainParams } from "./TerrainPresets";
import { PROP_TERRAIN_SINK, surfaceDisplacementAt, surfaceDisplacementFromValue } from "./TerrainSurface";

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

const TREE_COUNT = 5100;
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

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

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
  private balloons: { pivot: Group; inner: Group; normal: Vector3; baseAlt: number; phase: number }[] = [];
  /** Number of hot-air balloons (for proximity greeting logic). */
  readonly balloonCount = BALLOON_COUNT;
  private balloonTime = 0;
  readonly windmillCenters: { normal: Vector3 }[] = [];
  private windmillBlades: { pivot: Group; speed: number }[] = [];
  readonly observatoryCenters: { normal: Vector3 }[] = [];

  private segments: number;

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
    this.createBalloons();
    this.createClouds();
    this.createAtmosphere();
  }

  private createSurface() {
    const geo = new SphereGeometry(this.radius, this.segments, this.segments);
    const posAttr = geo.attributes.position;
    const vertexCount = posAttr.count;
    const colors = new Float32Array(vertexCount * 3);
    const oceanDepth = new Float32Array(vertexCount);

    const noise = createNoise3D(this.seed);
    const patchNoise = createNoise3D(this.seed + 555);
    const params = getTerrainParams(this.terrainType);

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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );

      let color: Color;
      let displacement = 0;

      if (value > params.threshold) {
        const elevation = (value - params.threshold) / (1 - params.threshold);

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
          this.seed, this.terrainType, nx, ny, nz, value,
        );
        oceanDepth[i] = -1;
      } else {
        const depth = Math.min(1, (params.threshold - value) * 4);
        color = oceanShallow.clone().lerp(oceanDeep, depth);
        oceanDepth[i] = depth;
        displacement = surfaceDisplacementFromValue(
          this.seed, this.terrainType, nx, ny, nz, value,
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
varying vec3 vWorldPos;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `if (vColor.b > vColor.r + vColor.g * 0.5) {
  gl_FragColor.rgb += vec3(0.04, 0.06, 0.10);

  vec3 wp = vWorldPos;
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
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));

    return geo;
  }

  private createTrees() {
    const rand = seededRandom(42 + this.seed);
    const noise = createNoise3D(this.seed);
    const forestNoise = createNoise3D(this.seed + 999);
    const params = getTerrainParams(this.terrainType);

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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;

      const elevation = (value - params.threshold) / (1 - params.threshold);
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
    const noise = createNoise3D(this.seed);
    const params = getTerrainParams(this.terrainType);

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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;

      const elevation = (value - params.threshold) / (1 - params.threshold);
      if (elevation > MAX_ELEVATION) continue;

      const centerNormal = new Vector3(nx, ny, nz);
      let hasNearbyWater = false;

      for (let c = 0; c < WATER_CHECKS; c++) {
        const checkAngle = (c / WATER_CHECKS) * Math.PI * 2;
        const tangent = new Vector3(-ny, nx, 0);
        if (tangent.lengthSq() < 0.001) tangent.set(0, -nz, ny);
        tangent.normalize();
        const bitangent = new Vector3().crossVectors(centerNormal, tangent).normalize();

        const cn = centerNormal.clone()
          .addScaledVector(tangent, Math.cos(checkAngle) * WATER_CHECK_DIST)
          .addScaledVector(bitangent, Math.sin(checkAngle) * WATER_CHECK_DIST)
          .normalize();

        const cv = terrainNoise(
          noise, cn.x, cn.y, cn.z,
          params.octaves, params.lacunarity, params.persistence, params.scale,
        );
        if (cv <= params.threshold) {
          hasNearbyWater = true;
          break;
        }
      }

      if (!hasNearbyWater) continue;

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

        const tv = terrainNoise(
          noise, treeNormal.x, treeNormal.y, treeNormal.z,
          params.octaves, params.lacunarity, params.persistence, params.scale,
        );
        if (tv <= params.threshold) continue;

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
      const shade = 0.85 + Math.sin(px * 31.7 + py * 47.3 + pz * 19.1) * 0.15;
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
    const noise = createNoise3D(this.seed);
    const params = getTerrainParams(this.terrainType);

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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;

      const elevation = (value - params.threshold) / (1 - params.threshold);
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
        const rv = terrainNoise(
          noise, rn.x, rn.y, rn.z,
          params.octaves, params.lacunarity, params.persistence, params.scale,
        );
        if (rv <= params.threshold) continue;

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

          const tv = terrainNoise(
            noise, treeNormal.x, treeNormal.y, treeNormal.z,
            params.octaves, params.lacunarity, params.persistence, params.scale,
          );
          if (tv <= params.threshold) continue;

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
    parts: { geo: BufferGeometry; color: Color }[],
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
    const indices: number[] = [];
    let vOffset = 0;

    for (const { geo, color } of parts) {
      const pos = geo.attributes.position;
      const norm = geo.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const idx = (vOffset + i) * 3;
        positions[idx] = pos.getX(i);
        positions[idx + 1] = pos.getY(i);
        positions[idx + 2] = pos.getZ(i);
        normals[idx] = norm.getX(i);
        normals[idx + 1] = norm.getY(i);
        normals[idx + 2] = norm.getZ(i);
        colors[idx] = color.r;
        colors[idx + 1] = color.g;
        colors[idx + 2] = color.b;
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
    merged.setIndex(indices);
    for (const { geo } of parts) geo.dispose();
    return merged;
  }

  private createHouseGeo(type: number): BufferGeometry {
    const wallColor = new Color(0xf0ece4);
    const domeColors = [new Color(0x2866b0), new Color(0x3478c0), new Color(0x1e5898), new Color(0x4088c8)];
    const domeColor = domeColors[type % domeColors.length];
    const flatRoofColor = new Color(0xe8e4dc);
    const doorColor = new Color(0x4a7ab5);
    const windowColor = new Color(0x5090c0);

    const parts: { geo: BufferGeometry; color: Color }[] = [];

    if (type === 0) {
      const wall = new BoxGeometry(1, 0.8, 1);
      wall.translate(0, 0.4, 0);
      parts.push({ geo: wall, color: wallColor });

      const dome = new SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(0, 0.8, 0);
      parts.push({ geo: dome, color: domeColor });

      const door = new BoxGeometry(0.22, 0.36, 0.05);
      door.translate(0, 0.18, 0.525);
      parts.push({ geo: door, color: doorColor });

      const winL = new BoxGeometry(0.05, 0.16, 0.16);
      winL.translate(-0.525, 0.5, 0);
      parts.push({ geo: winL, color: windowColor });
      const winR = new BoxGeometry(0.05, 0.16, 0.16);
      winR.translate(0.525, 0.5, 0);
      parts.push({ geo: winR, color: windowColor });
    } else if (type === 1) {
      const base = new BoxGeometry(1.2, 0.6, 0.9);
      base.translate(0, 0.3, 0);
      parts.push({ geo: base, color: wallColor });

      const roof = new BoxGeometry(1.3, 0.08, 1.0);
      roof.translate(0, 0.64, 0);
      parts.push({ geo: roof, color: flatRoofColor });

      const upper = new BoxGeometry(0.6, 0.45, 0.5);
      upper.translate(0.2, 0.925, 0);
      parts.push({ geo: upper, color: wallColor });

      const upperRoof = new BoxGeometry(0.7, 0.06, 0.6);
      upperRoof.translate(0.2, 1.18, 0);
      parts.push({ geo: upperRoof, color: flatRoofColor });

      const door = new BoxGeometry(0.22, 0.3, 0.05);
      door.translate(-0.2, 0.15, 0.475);
      parts.push({ geo: door, color: doorColor });

      const win1 = new BoxGeometry(0.14, 0.14, 0.05);
      win1.translate(0.25, 0.4, 0.475);
      parts.push({ geo: win1, color: windowColor });
      const win2 = new BoxGeometry(0.14, 0.14, 0.05);
      win2.translate(0.2, 0.85, 0.275);
      parts.push({ geo: win2, color: windowColor });
    } else if (type === 2) {
      const wall = new BoxGeometry(0.7, 1.0, 0.7);
      wall.translate(0, 0.5, 0);
      parts.push({ geo: wall, color: wallColor });

      const dome = new SphereGeometry(0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(0, 1.0, 0);
      parts.push({ geo: dome, color: domeColor });

      const door = new BoxGeometry(0.18, 0.4, 0.05);
      door.translate(0, 0.2, 0.375);
      parts.push({ geo: door, color: doorColor });

      const winF = new BoxGeometry(0.12, 0.2, 0.05);
      winF.translate(0, 0.7, 0.375);
      parts.push({ geo: winF, color: windowColor });
      const winB = new BoxGeometry(0.12, 0.2, 0.05);
      winB.translate(0, 0.7, -0.375);
      parts.push({ geo: winB, color: windowColor });
    } else {
      const base = new BoxGeometry(0.9, 0.5, 0.8);
      base.translate(0, 0.25, 0);
      parts.push({ geo: base, color: wallColor });

      const baseRoof = new BoxGeometry(1.0, 0.06, 0.9);
      baseRoof.translate(0, 0.53, 0);
      parts.push({ geo: baseRoof, color: flatRoofColor });

      const mid = new BoxGeometry(0.55, 0.45, 0.55);
      mid.translate(-0.1, 0.785, 0.05);
      parts.push({ geo: mid, color: wallColor });

      const midRoof = new BoxGeometry(0.65, 0.06, 0.65);
      midRoof.translate(-0.1, 1.04, 0.05);
      parts.push({ geo: midRoof, color: flatRoofColor });

      const top = new BoxGeometry(0.35, 0.35, 0.35);
      top.translate(0.05, 1.245, 0);
      parts.push({ geo: top, color: wallColor });

      const dome = new SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(0.05, 1.42, 0);
      parts.push({ geo: dome, color: domeColor });

      const door = new BoxGeometry(0.2, 0.28, 0.05);
      door.translate(0.15, 0.14, 0.425);
      parts.push({ geo: door, color: doorColor });

      const win1 = new BoxGeometry(0.12, 0.12, 0.05);
      win1.translate(-0.2, 0.35, 0.425);
      parts.push({ geo: win1, color: windowColor });
      const win2 = new BoxGeometry(0.05, 0.12, 0.12);
      win2.translate(-0.375, 0.7, 0.05);
      parts.push({ geo: win2, color: windowColor });
    }

    return this.mergeColoredParts(parts);
  }

  private createVillages() {
    const rand = seededRandom(200 + this.seed);
    const noise = createNoise3D(this.seed);
    const params = getTerrainParams(this.terrainType);

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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;

      const elevation = (value - params.threshold) / (1 - params.threshold);
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

        const value = terrainNoise(
          noise, nx, ny, nz,
          params.octaves, params.lacunarity, params.persistence, params.scale,
        );
        if (value <= params.threshold) continue;

        const elevation = (value - params.threshold) / (1 - params.threshold);
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

        const treesAround = 2 + Math.floor(rand() * 3);
        for (let tr = 0; tr < treesAround; tr++) {
          const tAngle = rand() * Math.PI * 2;
          const tDist = 0.016 + rand() * 0.02;

          const treeNormal = houseNormal.clone()
            .addScaledVector(new Vector3(-houseNormal.y, houseNormal.x, 0).normalize(), Math.cos(tAngle) * tDist)
            .addScaledVector(new Vector3().crossVectors(houseNormal, new Vector3(-houseNormal.y, houseNormal.x, 0).normalize()).normalize(), Math.sin(tAngle) * tDist)
            .normalize();

          const tv = terrainNoise(
            noise, treeNormal.x, treeNormal.y, treeNormal.z,
            params.octaves, params.lacunarity, params.persistence, params.scale,
          );
          if (tv <= params.threshold) continue;
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
    const noise = createNoise3D(this.seed);
    const params = getTerrainParams(this.terrainType);
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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;
      const elevation = (value - params.threshold) / (1 - params.threshold);
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

      const tangent = new Vector3(-ny, nx, 0);
      if (tangent.lengthSq() < 0.001) tangent.set(0, -nz, ny);
      tangent.normalize();
      const bitangent = new Vector3().crossVectors(centerNormal, tangent).normalize();
      let waterCount = 0;

      for (let c = 0; c < WATER_CHECKS; c++) {
        const angle = (c / WATER_CHECKS) * Math.PI * 2;
        const cn = centerNormal.clone()
          .addScaledVector(tangent, Math.cos(angle) * CHECK_DIST)
          .addScaledVector(bitangent, Math.sin(angle) * CHECK_DIST)
          .normalize();
        const cv = terrainNoise(
          noise, cn.x, cn.y, cn.z,
          params.octaves, params.lacunarity, params.persistence, params.scale,
        );
        if (cv <= params.threshold) waterCount++;
      }

      const waterRatio = waterCount / WATER_CHECKS;
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

          const v = terrainNoise(
            noise, normal.x, normal.y, normal.z,
            params.octaves, params.lacunarity, params.persistence, params.scale,
          );
          if (v <= params.threshold) continue;
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

    const rand = seededRandom(4321 + this.seed);
    const noise = createNoise3D(this.seed);
    const params = getTerrainParams(this.terrainType);

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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;
      const elevation = (value - params.threshold) / (1 - params.threshold);
      if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) continue;

      const normal = new Vector3(nx, ny, nz);

      // Keep away from villages, lighthouses, windmills.
      if (this.villageCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.lighthouseCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;
      if (this.windmillCenters.some((v) => normal.dot(v.normal) > 0.97)) continue;

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
      const surfaceR = this.radius + displacement - PROP_TERRAIN_SINK;

      const observatory = this.buildObservatory(rand);
      observatory.position.copy(normal.clone().multiplyScalar(surfaceR));
      observatory.quaternion.setFromUnitVectors(REF_UP, normal);
      observatory.castShadow = true;
      this.group.add(observatory);
    }
  }

  /**
   * Low-poly observatory: wide 1-storey stone building, short cylindrical
   * drum, and a large hemisphere dome with a prominent dark-grey slit
   * running from the base of the dome up and over the top.
   */
  private buildObservatory(rand: () => number): Group {
    const g = new Group();

    const S = 2.5; // global scale-up factor

    // ── Colour palette ──
    const COL_STONE    = new Color(0xd0c8b8);
    const COL_STONE_DK = new Color(0xa89880);
    const COL_DOME     = new Color(0xb0b8c4);
    const COL_SLIT     = new Color(0x333340);
    const COL_WINDOW   = new Color(0x5a90b8);
    const COL_FRAME    = new Color(0x555555);
    const COL_DOOR     = new Color(0x5a4030);
    const COL_STEP     = new Color(0xb8b0a0);
    const COL_FINDER   = new Color(0x777777);

    // ── Wide 1-storey base ──
    const baseW = 0.10 * S;
    const baseD = 0.08 * S;
    const baseH = 0.025 * S;
    const baseGeo = new BoxGeometry(baseW, baseH, baseD);
    baseGeo.translate(0, baseH / 2, 0);
    g.add(new Mesh(baseGeo, new MeshPhongMaterial({ color: COL_STONE })));

    // Stone plinth
    const plinthGeo = new BoxGeometry(baseW + 0.01 * S, 0.004 * S, baseD + 0.01 * S);
    plinthGeo.translate(0, 0.002 * S, 0);
    g.add(new Mesh(plinthGeo, new MeshPhongMaterial({ color: COL_STEP })));

    // Flat roof slab
    const roofGeo = new BoxGeometry(baseW + 0.005 * S, 0.003 * S, baseD + 0.005 * S);
    roofGeo.translate(0, baseH + 0.0015 * S, 0);
    g.add(new Mesh(roofGeo, new MeshPhongMaterial({ color: COL_STONE_DK })));

    // Door
    const doorW = 0.016 * S;
    const doorH = 0.018 * S;
    const doorGeo = new BoxGeometry(doorW, doorH, 0.003 * S);
    doorGeo.translate(0, doorH / 2 + 0.001 * S, baseD / 2 + 0.001 * S);
    g.add(new Mesh(doorGeo, new MeshPhongMaterial({ color: COL_DOOR })));

    // Windows — 2 per long side
    const winSize = 0.009 * S;
    for (const side of [-1, 1]) {
      for (const xOff of [-0.028 * S, 0.028 * S]) {
        const winGeo = new BoxGeometry(winSize, winSize, 0.003 * S);
        winGeo.translate(xOff, baseH * 0.52, (baseD / 2 + 0.001 * S) * side);
        g.add(new Mesh(winGeo, new MeshPhongMaterial({ color: COL_WINDOW })));
        const frameGeo = new BoxGeometry(winSize + 0.003 * S, winSize + 0.003 * S, 0.002 * S);
        frameGeo.translate(xOff, baseH * 0.52, (baseD / 2 + 0.0015 * S) * side);
        g.add(new Mesh(frameGeo, new MeshPhongMaterial({ color: COL_FRAME })));
      }
    }

    // ── Short cylindrical drum (sits on the roof) ──
    const drumR = 0.04 * S;
    const drumH = 0.012 * S;
    const drumY = baseH + 0.003 * S;
    const drumGeo = new CylinderGeometry(drumR, drumR + 0.002 * S, drumH, 16);
    drumGeo.translate(0, drumY + drumH / 2, 0);
    g.add(new Mesh(drumGeo, new MeshPhongMaterial({ color: COL_STONE })));

    // Decorative band at drum top
    const bandGeo = new CylinderGeometry(drumR + 0.003 * S, drumR + 0.003 * S, 0.003 * S, 16);
    bandGeo.translate(0, drumY + drumH, 0);
    g.add(new Mesh(bandGeo, new MeshPhongMaterial({ color: COL_STONE_DK })));

    // ── Large hemisphere dome ──
    const domeR = drumR + 0.001 * S;
    const domeY = drumY + drumH + 0.001 * S;
    const DOME_SEGS = 14;
    const profilePoints: Vector2[] = [];
    for (let i = 0; i <= DOME_SEGS; i++) {
      const t = i / DOME_SEGS;
      const angle = t * Math.PI * 0.5;
      profilePoints.push(new Vector2(Math.cos(angle) * domeR, Math.sin(angle) * domeR));
    }
    const domeGeo = new LatheGeometry(profilePoints, 20);
    domeGeo.translate(0, domeY, 0);
    g.add(new Mesh(domeGeo, new MeshPhongMaterial({ color: COL_DOME })));

    // ── Dome slit — dark grey strip from base through the apex ──
    // Two narrow boxes form a cross-section through the dome centre.
    const slitAngle = rand() * Math.PI * 2;
    const slitW = 0.008 * S;

    // Vertical slit panel (front half, base to apex)
    const slitVH = domeR * 1.02;
    const slitVGeo = new BoxGeometry(slitW, slitVH, 0.003 * S);
    slitVGeo.translate(0, domeY + slitVH * 0.5, domeR * 0.3);
    slitVGeo.rotateY(slitAngle);
    g.add(new Mesh(slitVGeo, new MeshPhongMaterial({ color: COL_SLIT })));

    // Horizontal slit panel (extends radially outward from dome center)
    const slitHLen = domeR * 0.85;
    const slitHGeo = new BoxGeometry(slitW, 0.003 * S, slitHLen);
    slitHGeo.translate(0, domeY + domeR * 0.92, slitHLen * 0.35);
    slitHGeo.rotateY(slitAngle);
    g.add(new Mesh(slitHGeo, new MeshPhongMaterial({ color: COL_SLIT })));

    // ── Finder scope on dome exterior ──
    const finderLen = 0.02 * S;
    const finderR = 0.003 * S;
    const finderAngle = slitAngle + 0.35;
    const finderGeo = new CylinderGeometry(finderR, finderR * 0.7, finderLen, 6);
    finderGeo.rotateZ(-Math.PI / 4);
    finderGeo.translate(
      Math.cos(finderAngle) * (domeR * 0.55),
      domeY + domeR * 0.62,
      Math.sin(finderAngle) * (domeR * 0.55),
    );
    g.add(new Mesh(finderGeo, new MeshPhongMaterial({ color: COL_FINDER })));

    // ── Small chimney / vent on the base wing ──
    const ventGeo = new CylinderGeometry(0.003 * S, 0.004 * S, 0.01 * S, 6);
    ventGeo.translate(baseW * 0.32, baseH + 0.005 * S, -baseD * 0.28);
    g.add(new Mesh(ventGeo, new MeshPhongMaterial({ color: COL_STONE_DK })));

    return g;
  }

  private createBalloons() {
    const rand = seededRandom(999 + this.seed);
    const REF_UP = new Vector3(0, 1, 0);

    const SCHEMES: [number, number][] = [
      [0xcc2222, 0xf0d020],
      [0x1e5cb0, 0x5eb8e8],
      [0x228844, 0xd0e830],
      [0xe85520, 0xf5c040],
      [0x8822aa, 0xe868b0],
      [0xcc2255, 0xff8844],
      [0x1199aa, 0x88cc33],
    ];

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

    for (let i = 0; i < BALLOON_COUNT; i++) {
      const balloon = new Group();
      const [primary, secondary] = SCHEMES[i % SCHEMES.length];
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
        void main() {
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
        void main() {
          vec3 viewDir = normalize(-vViewPosition);
          float rim = abs(dot(vNormal, viewDir));
          float soft = rim * rim * rim;
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
        const scale = sizeType.baseScale * MathUtils.lerp(0.6, 1.4, rand());
        puff.scale.set(
          scale * MathUtils.lerp(1.5, 2.8, rand()),
          scale * MathUtils.lerp(0.5, 1.0, rand()),
          scale * MathUtils.lerp(1.2, 2.2, rand()),
        );
        const angle = rand() * Math.PI * 2;
        const dist = rand() * spread;
        puff.position.set(
          Math.cos(angle) * dist,
          (rand() - 0.5) * spread * 0.15,
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
    const noise = createNoise3D(this.seed);
    const params = getTerrainParams(this.terrainType);

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

      const value = terrainNoise(
        noise, nx, ny, nz,
        params.octaves, params.lacunarity, params.persistence, params.scale,
      );
      if (value <= params.threshold) continue;
      const elevation = (value - params.threshold) / (1 - params.threshold);
      if (elevation > 0.15) continue;

      const centerNormal = new Vector3(nx, ny, nz);
      let waterCount = 0;
      const tangent = new Vector3(-ny, nx, 0);
      if (tangent.lengthSq() < 0.001) tangent.set(0, -nz, ny);
      tangent.normalize();
      const bitangent = new Vector3().crossVectors(centerNormal, tangent).normalize();

      for (let c = 0; c < WATER_CHECKS; c++) {
        const angle = (c / WATER_CHECKS) * Math.PI * 2;
        const cn = centerNormal.clone()
          .addScaledVector(tangent, Math.cos(angle) * CHECK_DIST)
          .addScaledVector(bitangent, Math.sin(angle) * CHECK_DIST)
          .normalize();
        const cv = terrainNoise(
          noise, cn.x, cn.y, cn.z,
          params.octaves, params.lacunarity, params.persistence, params.scale,
        );
        if (cv <= params.threshold) waterCount++;
      }

      const waterRatio = waterCount / WATER_CHECKS;
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
      const towerGeo = new CylinderGeometry(towerRTop, towerRBot, towerH, 8);
      towerGeo.translate(0, towerH / 2, 0);
      const towerMat = new MeshPhongMaterial({ color: 0xf5f0e8 });
      lighthouse.add(new Mesh(towerGeo, towerMat));

      const stripeH = 0.025;
      const stripeY = towerH * 0.55;
      const stripeR = MathUtils.lerp(towerRBot, towerRTop, 0.55) + 0.001;
      const stripeGeo = new CylinderGeometry(stripeR, stripeR + 0.001, stripeH, 8);
      stripeGeo.translate(0, stripeY, 0);
      lighthouse.add(new Mesh(stripeGeo, new MeshPhongMaterial({ color: 0xcc3333 })));

      const stripe2Y = towerH * 0.3;
      const stripe2R = MathUtils.lerp(towerRBot, towerRTop, 0.3) + 0.001;
      const stripe2Geo = new CylinderGeometry(stripe2R, stripe2R + 0.001, stripeH, 8);
      stripe2Geo.translate(0, stripe2Y, 0);
      lighthouse.add(new Mesh(stripe2Geo, new MeshPhongMaterial({ color: 0xcc3333 })));

      const lanternY = towerH;
      const lanternR = towerRTop + 0.006;
      const lanternH = 0.025;
      const lanternGeo = new CylinderGeometry(lanternR, lanternR, lanternH, 8);
      lanternGeo.translate(0, lanternY + lanternH / 2, 0);
      const lanternMat = new MeshPhongMaterial({ color: 0xfff8dd, emissive: 0xffdd44, emissiveIntensity: 0.6 });
      lighthouse.add(new Mesh(lanternGeo, lanternMat));

      const roofGeo = new CylinderGeometry(0.002, lanternR + 0.003, 0.016, 8);
      roofGeo.translate(0, lanternY + lanternH + 0.008, 0);
      lighthouse.add(new Mesh(roofGeo, new MeshPhongMaterial({ color: 0x444444 })));

      const railGeo = new CylinderGeometry(lanternR + 0.004, lanternR + 0.004, 0.004, 12);
      railGeo.translate(0, lanternY, 0);
      lighthouse.add(new Mesh(railGeo, new MeshPhongMaterial({ color: 0x333333 })));

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

    const beamAngle = this.lighthouseBeamTime * 0.8;
    for (const beam of this.lighthouseBeams) {
      beam.rotation.y = beamAngle;
    }

    for (const w of this.windmillBlades) {
      w.pivot.rotation.z += dt * w.speed;
    }

    this.balloonTime += dt;
    for (const b of this.balloons) {
      const bob = Math.sin(this.balloonTime * 0.5 + b.phase) * 0.04;
      const alt = b.baseAlt + bob;
      b.pivot.position.copy(b.normal).multiplyScalar(alt);
      b.inner.rotation.y += dt * 0.05;
    }
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
  }
}
