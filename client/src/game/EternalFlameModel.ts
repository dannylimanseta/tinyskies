import {
  Box3,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { addRimLightToStandard, addRimLightWithColor } from "./RimLight.js";

export const ETERNAL_FLAME_GLB = "/3D/eternal_flame.glb";

/** Cool blue-cyan eternal flame (reads richer than pale orange wash). */
const EMISSIVE_CORE = new Color(0x3399ff);
const EMISSIVE_RIM = new Color(0x88ddff);
const BASE_TINT = new Color(0x4a88cc);
/** Fresnel edge read for void flame (not tied to the scene day/night rim color). */
const RIM_LIGHT = new Color(0x7ee8ff);
const RIM_INTENSITY = 0.5;
const RIM_POWER = 2.4;

let modelRoot: Object3D | null = null;
let loadPromise: Promise<Object3D> | null = null;

/**
 * Loads the eternal-flame glTF once (shared with EternalFlameUI and world spawns).
 */
export function loadEternalFlameModelOnce(): Promise<Object3D> {
  if (modelRoot) return Promise.resolve(modelRoot);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<Object3D>((resolve) => {
    const loader = new GLTFLoader();
    loader.load(
      ETERNAL_FLAME_GLB,
      (gltf) => {
        modelRoot = gltf.scene;
        resolve(modelRoot);
      },
      undefined,
      () => {
        const g = new Group();
        const geo = new IcosahedronGeometry(0.22, 1);
        const mat = new MeshPhongMaterial({
          color: 0x4488cc,
          emissive: 0x2288ff,
          emissiveIntensity: 1.85,
          flatShading: true,
        });
        g.add(new Mesh(geo, mat));
        modelRoot = g;
        resolve(modelRoot);
      },
    );
  });
  return loadPromise;
}

export function getSharedEternalFlameModelRoot(): Object3D {
  if (!modelRoot) {
    throw new Error("loadEternalFlameModelOnce() not awaited");
  }
  return modelRoot;
}

/**
 * Scales a flame root so its max dimension is `target` (world units).
 * Centers the result like the UI dock/preview.
 */
export function fitEternalFlameModel(root: Object3D, target = 0.42) {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const max = Math.max(size.x, size.y, size.z, 1e-4);
  const s = target / max;
  root.scale.setScalar(s);
  const c = box.getCenter(new Vector3());
  root.position.copy(c.multiplyScalar(-s));
}

/**
 * Strong emissive + standard materials so the flame reads as self-lit in 3D.
 * Call on a **clone** of the template so shared UI template materials stay intact.
 */
export function applyEternalFlameGlow(root: Object3D) {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next: typeof mats = [];
    for (let mi = 0; mi < mats.length; mi++) {
      const mat = mats[mi]!;
      if (mat instanceof MeshBasicMaterial) {
        const c = mat.color.clone().lerp(BASE_TINT, 0.35);
        const rep = new MeshStandardMaterial({
          color: c,
          map: mat.map,
          transparent: mat.transparent,
          opacity: mat.opacity,
          depthWrite: mat.depthWrite,
          side: mat.side,
          emissive: EMISSIVE_CORE.clone(),
          emissiveIntensity: 2.85,
          emissiveMap: mat.map ?? null,
        });
        mat.dispose();
        next.push(rep);
        continue;
      }
      if (mat instanceof MeshStandardMaterial || mat instanceof MeshPhysicalMaterial) {
        mat.color.lerp(BASE_TINT, 0.22);
        mat.emissive.copy(EMISSIVE_CORE);
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 2.65);
        if (!mat.emissiveMap && mat.map) mat.emissiveMap = mat.map;
        next.push(mat);
        continue;
      }
      if (mat instanceof MeshPhongMaterial || mat instanceof MeshLambertMaterial) {
        mat.emissive.copy(EMISSIVE_RIM);
        mat.emissive.multiplyScalar(2.0);
        mat.color.lerp(BASE_TINT, 0.28);
        next.push(mat);
        continue;
      }
      if ("emissive" in mat && (mat as { emissive?: Color }).emissive) {
        const m = mat as MeshPhongMaterial;
        m.emissive.copy(EMISSIVE_CORE);
        const ei = (m as { emissiveIntensity?: number }).emissiveIntensity;
        if (typeof ei === "number") {
          (m as { emissiveIntensity: number }).emissiveIntensity = Math.max(ei, 1.8);
        }
        next.push(mat);
        continue;
      }
      next.push(mat);
    }
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat instanceof MeshStandardMaterial || mat instanceof MeshPhysicalMaterial) {
        addRimLightToStandard(mat, RIM_LIGHT, RIM_INTENSITY, RIM_POWER);
        continue;
      }
      if (mat instanceof MeshPhongMaterial || mat instanceof MeshLambertMaterial) {
        addRimLightWithColor(mat, RIM_LIGHT, RIM_INTENSITY, RIM_POWER);
      }
    }
  });
}
