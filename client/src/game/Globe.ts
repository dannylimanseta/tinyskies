import {
  Mesh,
  InstancedMesh,
  SphereGeometry,
  BoxGeometry,
  ConeGeometry,
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
        const dist = 0.014 + rand() * 0.034;

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
        const scale = MathUtils.lerp(0.047, 0.074, rand());
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
          const tDist = 0.011 + rand() * 0.014;

          const treeNormal = houseNormal.clone()
            .addScaledVector(new Vector3(-houseNormal.y, houseNormal.x, 0).normalize(), Math.cos(tAngle) * tDist)
            .addScaledVector(new Vector3().crossVectors(houseNormal, new Vector3(-houseNormal.y, houseNormal.x, 0).normalize()).normalize(), Math.sin(tAngle) * tDist)
            .normalize();

          const treeDisplacement = LAND_HEIGHT + elevation * MOUNTAIN_HEIGHT;
          const treeSurfaceR = this.radius + treeDisplacement;
          const treeScale = MathUtils.lerp(0.016, 0.030, rand());
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

      const mat = new MeshPhongMaterial({
        color: gardenShades[s],
        vertexColors: true,
        flatShading: true,
      });
      addRimLight(mat, 0xffeeaa, 0.7, 3.0);

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
        opacity: { value: 0.3 },
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

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cloud = new Group();

      // 3-5 puffs per cloud cluster
      const puffCount = 3 + Math.floor(rand() * 3);
      for (let p = 0; p < puffCount; p++) {
        const puff = new Mesh(puffGeo, cloudMat);
        const scale = MathUtils.lerp(0.18, 0.35, rand());
        puff.scale.set(
          scale * MathUtils.lerp(1.5, 2.8, rand()),
          scale * MathUtils.lerp(0.6, 1.2, rand()),
          scale * MathUtils.lerp(1.2, 2.2, rand()),
        );
        puff.position.set(
          (rand() - 0.5) * 0.5,
          (rand() - 0.5) * 0.1,
          (rand() - 0.5) * 0.35,
        );
        puff.castShadow = true;
        cloud.add(puff);
      }

      // Place on sphere at cloud altitude
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const pos = new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      );
      const normal = pos.clone().normalize();

      cloud.position.copy(normal).multiplyScalar(cloudAlt);
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
