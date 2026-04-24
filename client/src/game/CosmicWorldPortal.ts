import {
  AdditiveBlending,
  Camera,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  TextureLoader,
  Texture,
} from "three";
import { CARPET_HOVER_HEIGHT } from "./Carpet";
import { isLand } from "./SimplexNoise";
import { cartesianFromSpherical, moveOnSphere, tangentFrame } from "./SphericalMath";
import { surfaceAltitudeAt } from "./TerrainSurface";

/** Matches {@link CarpetPortalSystem} base torus/inner size; this portal is a bit larger. */
const BASE_PORTAL_RADIUS = 0.15;
const BASE_TUBE_RADIUS = 0.022;

/** Slightly larger than the player-placed carpet portal. */
export const COSMIC_WORLD_PORTAL_SCALE = 1.3;

const R = BASE_PORTAL_RADIUS * COSMIC_WORLD_PORTAL_SCALE;
const T = BASE_TUBE_RADIUS * COSMIC_WORLD_PORTAL_SCALE;

/** Extra altitude above surface + {@link CARPET_HOVER_HEIGHT} so the rim always floats above the terrain. */
const PORTAL_CLEARANCE_ABOVE_HOVER = 0.22;

function seededUnit(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

/** Shared dark-blue radial halo (outer atmosphere). ~4× portal disc diameter. */
let portalHaloTex: CanvasTexture | null = null;
function getPortalHaloTexture(): CanvasTexture {
  if (portalHaloTex) return portalHaloTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.0, "rgba(8,8,8,0.18)");
  grad.addColorStop(0.2, "rgba(16,16,16,0.22)");
  grad.addColorStop(0.5, "rgba(12,12,12,0.15)");
  grad.addColorStop(0.78, "rgba(6,6,6,0.08)");
  grad.addColorStop(1.0, "rgba(0,0,0,0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  portalHaloTex = tex;
  return tex;
}

let riftTex: Texture | null = null;
function getRiftTexture() {
  if (!riftTex) {
    riftTex = new TextureLoader().load("/2D/rift.png");
    riftTex.colorSpace = SRGBColorSpace;
  }
  return riftTex;
}

class CosmicWorldPortalVisual {
  readonly group = new Group();
  private readonly scaledGroup = new Group();
  private readonly inner: Mesh;
  private readonly innerMat: MeshBasicMaterial;
  private readonly halo: Sprite;
  private readonly haloMat: SpriteMaterial;
  private readonly timePhase: number;

  constructor(timePhase: number) {
    this.timePhase = timePhase;
    this.scaledGroup.scale.set(0.65, 1.25, 1.0);
    this.group.add(this.scaledGroup);

    this.haloMat = new SpriteMaterial({
      map: getPortalHaloTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.halo = new Sprite(this.haloMat);
    this.halo.renderOrder = -1;
    const portalDiameter = 2.0 * R * 1.25 * 1.25;
    this.halo.scale.setScalar(portalDiameter * 4.0);
    this.scaledGroup.add(this.halo);

    this.innerMat = new MeshBasicMaterial({
      map: getRiftTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false, // Prevents the transparent parts from writing to the depth buffer and blocking background objects like the aurora
      depthTest: true,
      blending: NormalBlending,
      side: DoubleSide,
    });
    this.innerMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      // Keep a reference so we can update it in update()
      this.innerMat.userData.shader = shader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;`
      );
      // We distort the local vertex position before it gets transformed
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // A gentle, smooth swaying effect based on UV coordinates and time
        float swayAmt = 0.025;
        transformed.x += sin(uv.y * 4.0 + uTime * 1.2) * swayAmt;
        transformed.y += cos(uv.x * 4.0 + uTime * 1.5) * swayAmt;`
      );
    };

    // Use a PlaneGeometry with many segments so the vertex displacement creates a smooth wave
    // instead of just moving the 4 corners of a flat quad.
    this.inner = new Mesh(new PlaneGeometry(1, 1, 16, 16), this.innerMat);
    this.inner.renderOrder = 0;
    this.inner.scale.setScalar(portalDiameter * 1.5); // Make it large enough
    this.scaledGroup.add(this.inner);
  }

  applyPose(worldPosition: Vector3) {
    this.group.position.copy(worldPosition);
    this.group.matrixWorldNeedsUpdate = true;
  }

  update(time: number, camera: Camera, opacity: number) {
    this.haloMat.opacity = 0.45 * opacity;
    this.innerMat.color.setScalar(1.0);
    this.innerMat.opacity = opacity;

    if (this.innerMat.userData.shader) {
      this.innerMat.userData.shader.uniforms.uTime.value = time + this.timePhase;
    }

    // Face the camera directly like a Sprite would
    this.inner.quaternion.copy(camera.quaternion);
    
    // Group orientation doesn't need to match camera since we orient the inner mesh directly,
    // but the halo Sprite handles itself automatically.
  }

  dispose() {
    this.innerMat.dispose();
    this.inner.geometry.dispose();
    this.haloMat.dispose();
  }
}

function pickWorldPose(
  globeRadius: number,
  worldSeed: number,
  terrainType: string,
  rand: () => number,
  /** Bias the starting heading to a 120°-wide sector so portals spread across the globe. */
  sectorAngle = 0,
): { qPosition: Quaternion; heading: number; altitude: number } {
  for (let k = 0; k < 500; k++) {
    const q = new Quaternion();
    // Restrict start heading to ±60° of the sector centre so each portal lives in its own third.
    const h0 = sectorAngle + (rand() - 0.5) * ((Math.PI * 2) / 3);
    const a0 = 0.35 + rand() * 2.2;
    const q1 = moveOnSphere(q, h0, a0);
    const h1 = rand() * Math.PI * 2;
    const a1 = rand() * 1.4;
    const finalQ = moveOnSphere(q1, h1, a1);
    const frame = tangentFrame(finalQ);
    const surfN = new Vector3(frame.up.x, frame.up.y, frame.up.z);
    if (!isLand(worldSeed, terrainType, surfN.x, surfN.y, surfN.z)) continue;

    const minAlt =
      surfaceAltitudeAt(worldSeed, terrainType, frame.up.x, frame.up.y, frame.up.z) + CARPET_HOVER_HEIGHT;
    const altitude = minAlt + PORTAL_CLEARANCE_ABOVE_HOVER;
    const heading = rand() * Math.PI * 2;
    return { qPosition: finalQ, heading, altitude };
  }
  const fallbackQ = moveOnSphere(new Quaternion(), 0, 0.4);
  const fb = tangentFrame(fallbackQ);
  const minAlt =
    surfaceAltitudeAt(worldSeed, terrainType, fb.up.x, fb.up.y, fb.up.z) + CARPET_HOVER_HEIGHT;
  return {
    qPosition: fallbackQ,
    heading: 0,
    altitude: minAlt + PORTAL_CLEARANCE_ABOVE_HOVER,
  };
}

/**
 * One fixed “cosmic” portal in the world for carpet / capy runs (room for more logic later).
 */
export class CosmicWorldPortal {
  readonly group = new Group();
  readonly worldPosition = new Vector3();
  private time = 0;
  private readonly visual: CosmicWorldPortalVisual;

  constructor(
    globeRadius: number,
    seed: number,
    terrainType: string,
    index: number,
  ) {
    const rand = seededUnit(seed + 19023841 + index * 9999);
    const sectorAngle = (index / 3) * Math.PI * 2;
    const { qPosition, heading, altitude } = pickWorldPose(
      globeRadius,
      seed + index * 100,
      terrainType,
      rand,
      sectorAngle,
    );
    this.worldPosition.copy(cartesianFromSpherical(qPosition, altitude, globeRadius));

    this.visual = new CosmicWorldPortalVisual(seed * 0.0012 + index * 10);
    this.visual.applyPose(this.worldPosition);
    this.group.add(this.visual.group);
  }

  update(dt: number, camera: Camera, opacity: number) {
    this.time += dt;
    this.visual.update(this.time, camera, opacity);
  }

  dispose() {
    this.visual.dispose();
    this.group.clear();
  }
}
