import {
  AdditiveBlending,
  BufferGeometry,
  Camera,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Points,
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

/** How many void-entry portals to place in the overworld; keep Game spawn loop in sync. */
export const COSMIC_VOID_PORTAL_COUNT = 2;

/** Reject a candidate that is too close to any already-placed portal (radians, surface angle). */
const MIN_VOID_PORTAL_ANGULAR_SEP = 1.2;
const MAX_DIR_DOT = Math.cos(MIN_VOID_PORTAL_ANGULAR_SEP);

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
  grad.addColorStop(0.0, "rgba(120, 160, 255, 0.9)");
  grad.addColorStop(0.2, "rgba(80, 120, 255, 0.6)");
  grad.addColorStop(0.5, "rgba(40, 70, 200, 0.2)");
  grad.addColorStop(0.78, "rgba(15, 30, 120, 0.05)");
  grad.addColorStop(1.0, "rgba(0, 0, 0, 0.0)");
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
  private readonly stars: Points;
  private readonly starsMat: ShaderMaterial;
  private readonly timePhase: number;

  constructor(timePhase: number) {
    this.timePhase = timePhase;
    this.scaledGroup.scale.set(0.65, 1.25, 1.0);
    this.group.add(this.scaledGroup);

    this.haloMat = new SpriteMaterial({
      map: getPortalHaloTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
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

    // Sparkling stars
    const starCount = 80;
    const starGeo = new BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starPhase = new Float32Array(starCount);
    const starSize = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      let r = Math.random();
      let theta = Math.random() * Math.PI * 2;
      r = Math.sqrt(r) * (portalDiameter * 0.7); // Spread across the rift
      starPos[i * 3 + 0] = Math.cos(theta) * r;
      starPos[i * 3 + 1] = Math.sin(theta) * r;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 0.1 + 0.05; // Slightly in front
      starPhase[i] = Math.random() * Math.PI * 2;
      starSize[i] = 0.5 + Math.random() * 1.5;
    }
    starGeo.setAttribute("position", new Float32BufferAttribute(starPos, 3));
    starGeo.setAttribute("aPhase", new Float32BufferAttribute(starPhase, 1));
    starGeo.setAttribute("aSize", new Float32BufferAttribute(starSize, 1));

    this.starsMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
      },
      vertexShader: `
        uniform float uTime;
        attribute float aPhase;
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = (10.0 * aSize) * (1.0 / -mvPosition.z);
          float twinkle = sin(uTime * 3.5 + aPhase);
          vAlpha = 0.2 + 0.8 * twinkle;
          vAlpha = max(0.0, vAlpha);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;
          // Soft glowing dot
          float core = exp(-dist * dist * 35.0);
          float halo = exp(-dist * dist * 10.0) * 0.5;
          float alpha = (core + halo) * vAlpha * uOpacity;
          gl_FragColor = vec4(vec3(0.9, 0.95, 1.0), alpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });

    this.stars = new Points(starGeo, this.starsMat);
    this.stars.renderOrder = 1;
    this.scaledGroup.add(this.stars);
  }

  applyPose(worldPosition: Vector3) {
    this.group.position.copy(worldPosition);
    this.group.matrixWorldNeedsUpdate = true;
  }

  update(time: number, camera: Camera, opacity: number) {
    this.haloMat.opacity = 0.85 * opacity;
    this.innerMat.color.setScalar(1.0);
    this.innerMat.opacity = opacity;

    if (this.innerMat.userData.shader) {
      this.innerMat.userData.shader.uniforms.uTime.value = time + this.timePhase;
    }

    this.starsMat.uniforms.uTime.value = time + this.timePhase;
    this.starsMat.uniforms.uOpacity.value = opacity;

    // Keep the portal standing upright relative to the planet surface, while facing the camera.
    // This stops the tall oval shape from banking/rolling when the player's camera banks.
    const p = this.group.position;
    const radUp = p.clone().normalize();
    this.group.up.copy(radUp);
    
    // We want the front (+Z face) of the PlaneGeometry to point AT the camera.
    // lookAt makes the -Z axis point AT the target.
    // So we look at a point directly behind the portal (away from the camera).
    const toCam = camera.position.clone().sub(p);
    const lookTarget = p.clone().sub(toCam);
    this.group.lookAt(lookTarget);
    
    // Ensure the inner mesh doesn't have any leftover rotation from previous frame
    this.inner.quaternion.identity();
  }

  dispose() {
    this.innerMat.dispose();
    this.inner.geometry.dispose();
    this.haloMat.dispose();
    this.starsMat.dispose();
    this.stars.geometry.dispose();
  }
}

function pickWorldPose(
  globeRadius: number,
  worldSeed: number,
  terrainType: string,
  rand: () => number,
  /** Sector centre so N portals are evenly spaced in azimuth. */
  sectorAngle: number,
  portalCount: number,
  /** Unit directions of portals already placed; new portal must sit ≥ {@link MIN_VOID_PORTAL_ANGULAR_SEP} from each. */
  existingUnitDirs: Vector3[],
): { qPosition: Quaternion; heading: number; altitude: number } {
  for (let k = 0; k < 500; k++) {
    const q = new Quaternion();
    // Sector width: `2π / portalCount` so each has its own wedge; 2 → opposite hemispheres.
    const h0 = sectorAngle + (rand() - 0.5) * ((Math.PI * 2) / Math.max(1, portalCount));
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
    if (existingUnitDirs.length > 0) {
      const wDir = cartesianFromSpherical(finalQ, altitude, globeRadius)
        .clone()
        .normalize();
      let tooClose = false;
      for (const d of existingUnitDirs) {
        if (d.dot(wDir) > MAX_DIR_DOT) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
    }
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
    /** Unit directions of portals already placed; updated when this instance registers its direction. */
    existingUnitDirs: Vector3[],
  ) {
    const rand = seededUnit(seed + 19023841 + index * 9999);
    const sectorAngle = (index / COSMIC_VOID_PORTAL_COUNT) * Math.PI * 2;
    const { qPosition, heading, altitude } = pickWorldPose(
      globeRadius,
      seed + index * 100,
      terrainType,
      rand,
      sectorAngle,
      COSMIC_VOID_PORTAL_COUNT,
      existingUnitDirs,
    );
    this.worldPosition.copy(cartesianFromSpherical(qPosition, altitude, globeRadius));
    existingUnitDirs.push(this.worldPosition.clone().normalize());

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
