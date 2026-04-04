import {
  Mesh,
  InstancedMesh,
  SphereGeometry,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  MeshPhongMaterial,
  ShaderMaterial,
  BackSide,
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
  float intensity = smoothstep(0.0, 1.0, rim) * pow(rim, 1.5) * 0.2;
  gl_FragColor = vec4(glowColor * intensity, intensity);
}
`;

const TREE_COUNT = 3400;
const ROCK_COUNT = 400;
const COCONUT_CLUSTERS = 180;
const VILLAGE_COUNT = 20;
const HOUSES_PER_VILLAGE = [8, 10, 12, 14, 16];
const CLOUD_COUNT = 30;
const CLOUD_ALTITUDE = 1.0;
const CLOUD_DRIFT_SPEED = 0.03;

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

  constructor(radius: number = 5, seed: number = 42, terrainType: string = "default") {
    this.radius = radius;
    this.seed = seed;
    this.terrainType = terrainType;
    this.createSurface();
    this.createTrees();
    this.createCoconutTrees();
    this.createRocks();
    this.createVillages();
    this.createClouds();
    this.createAtmosphere();
  }

  private createSurface() {
    const geo = new SphereGeometry(this.radius, 512, 512);
    const posAttr = geo.attributes.position;
    const vertexCount = posAttr.count;
    const colors = new Float32Array(vertexCount * 3);

    const noise = createNoise3D(this.seed);
    const patchNoise = createNoise3D(this.seed + 555);
    const params = getTerrainParams(this.terrainType);

    const LAND_HEIGHT = 0.02;
    const OCEAN_DEPTH = 0.01;
    const MOUNTAIN_HEIGHT = 0.22;

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
    const oceanShallow = new Color(0x2a8ca0);
    const oceanDeep = new Color(0x1560a0);

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

        displacement = LAND_HEIGHT + elevation * MOUNTAIN_HEIGHT;
      } else {
        const depth = Math.min(1, (params.threshold - value) * 4);
        color = oceanShallow.clone().lerp(oceanDeep, depth);
        displacement = -OCEAN_DEPTH * depth;
      }

      const newRadius = this.radius + displacement;
      posAttr.setXYZ(i, nx * newRadius, ny * newRadius, nz * newRadius);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));

    const mat = new MeshPhongMaterial({
      vertexColors: true,
      shininess: 8,
      flatShading: true,
    });

    const rimColor = new Color(0xffeebb);
    const rimIntensity = 0.8;
    const rimPower = 8.5;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.oceanTime = this.oceanTime;
      shader.uniforms.rimColor = { value: rimColor };
      shader.uniforms.rimIntensity = { value: rimIntensity };
      shader.uniforms.rimPower = { value: rimPower };

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
  gl_FragColor.rgb += vec3(0.7, 1.0, 1.0) * foam * mix(0.05, 1.0, shallowness);

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
    const MOUNTAIN_HEIGHT = 0.22;

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

      const displacement = LAND_HEIGHT + elevation * MOUNTAIN_HEIGHT;
      const surfaceRadius = this.radius + displacement;

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
    const trunkColor = new Color(0x9B7530);
    const frondColor = new Color(0x1A6B37);
    const frondLight = new Color(0x2D8A4E);
    const coconutColor = new Color(0x5D3A1A);

    const parts: { geo: BufferGeometry; color: Color }[] = [];

    const trunk = new CylinderGeometry(0.06, 0.09, 0.55, 6, 4);
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
    for (let i = 0; i < frondCount; i++) {
      const frond = new ConeGeometry(0.18, 0.45, 5);
      frond.scale(0.8, 1.0, 0.5);
      frond.translate(0, 0.225, 0);
      frond.rotateZ(tilts[i]);
      frond.rotateY((i / frondCount) * Math.PI * 2 + 0.1);
      frond.translate(0, 0.52, 0);
      frond.computeVertexNormals();
      parts.push({ geo: frond, color: i % 2 === 0 ? frondColor : frondLight });
    }

    for (let c = 0; c < 3; c++) {
      const coconut = new SphereGeometry(0.032, 4, 3);
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
    const MOUNTAIN_HEIGHT = 0.22;
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

        const telev = (tv - params.threshold) / (1 - params.threshold);
        const displacement = LAND_HEIGHT + telev * MOUNTAIN_HEIGHT;
        const surfaceRadius = this.radius + displacement;
        const scale = MathUtils.lerp(0.07, 0.12, rand());

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
    const MOUNTAIN_HEIGHT = 0.22;

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

        const relev = (rv - params.threshold) / (1 - params.threshold);
        const displacement = LAND_HEIGHT + relev * MOUNTAIN_HEIGHT;
        const surfaceRadius = this.radius + displacement;

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

          const telev = (tv - params.threshold) / (1 - params.threshold);
          const tDisp = LAND_HEIGHT + telev * MOUNTAIN_HEIGHT;
          const tSurfR = this.radius + tDisp;
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
    const MOUNTAIN_HEIGHT = 0.22;
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

        const displacement = LAND_HEIGHT + elevation * MOUNTAIN_HEIGHT;
        const surfaceRadius = this.radius + displacement;

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

          const treeDisplacement = LAND_HEIGHT + elevation * MOUNTAIN_HEIGHT;
          const treeSurfaceR = this.radius + treeDisplacement;
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

  private createClouds() {
    const rand = seededRandom(77);
    const cloudMat = new ShaderMaterial({
      uniforms: {
        cloudColor: { value: new Color(0xffe8cc) },
        opacity: { value: 0.2 },
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
    const geo = new SphereGeometry(this.radius * 1.45, 48, 48);
    const mat = new ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      uniforms: {
        glowColor: { value: new Color(0xeeddbb) },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    this.atmosphereMesh = new Mesh(geo, mat);
    this.group.add(this.atmosphereMesh);
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
