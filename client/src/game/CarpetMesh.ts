/**
 * Low-poly magic carpet — local +Z forward, +Y up.
 * Flat body with curled front edge, gold trim.
 * Vertex-shader cloth wobble driven by a shared time uniform.
 */
import {
  Group,
  Mesh,
  BoxGeometry,
  MeshPhongMaterial,
  type IUniform,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { addRimLight } from "./RimLight";

const WOBBLE_GLSL = /* glsl */ `
  vec3 gp = position + uOffset;
  float dx = sin(gp.x * 60.0 + uTime * 5.0) * 0.4
           + sin(gp.z * 40.0 + uTime * 3.5) * 0.6;
  float edge = smoothstep(0.0, 1.0, length(gp.xz) / 0.06);
  transformed.y += dx * 0.012 * (0.35 + 0.65 * edge);
`;

/** Evaluate wobble displacement on CPU (mirrors the GLSL above). */
export function carpetWobbleY(x: number, z: number, time: number): number {
  const dx = Math.sin(x * 60 + time * 5) * 0.4
           + Math.sin(z * 40 + time * 3.5) * 0.6;
  const len = Math.sqrt(x * x + z * z);
  const edge = Math.min(1, Math.max(0, len / 0.06));
  return dx * 0.012 * (0.35 + 0.65 * edge);
}

function addWobble(mat: MeshPhongMaterial, timeUniform: IUniform<number>, offset: [number, number, number]) {
  const uOffset = { value: offset };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uOffset = uOffset;
    shader.vertexShader = "uniform float uTime;\nuniform vec3 uOffset;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n${WOBBLE_GLSL}`,
    );
  };
}

export function createCarpet(baseColor: number = 0x6b1d6e): Group {
  const carpet = new Group();
  const s = 0.025;

  const timeUniform: IUniform<number> = { value: 0 };
  carpet.userData.timeUniform = timeUniform;

  function makeTrimMat(offset: [number, number, number]) {
    const m = new MeshPhongMaterial({ color: 0xd4a830, flatShading: true, shininess: 60 });
    addRimLight(m, 0xffe888, 0.35, 2.5);
    addWobble(m, timeUniform, offset);
    return m;
  }

  const bodyMat = new MeshPhongMaterial({ color: baseColor, flatShading: true, shininess: 45 });
  addRimLight(bodyMat, 0xeeccff, 0.45, 2.5);
  addWobble(bodyMat, timeUniform, [0, 0, 0]);

  const patternMat = new MeshPhongMaterial({ color: 0x8b2252, flatShading: true, shininess: 40 });
  addRimLight(patternMat, 0xffaacc, 0.35, 2.5);
  addWobble(patternMat, timeUniform, [0, 0.001, 0]);

  // Main body — subdivided for cloth wobble
  const bodyW = s * 2.8;
  const bodyH = s * 0.06;
  const bodyLen = s * 3.6;
  const body = new Mesh(new BoxGeometry(bodyW, bodyH, bodyLen, 10, 1, 14), bodyMat);
  body.position.set(0, 0, 0);
  carpet.add(body);

  // Center pattern — subdivided to match body deformation
  const inner = new Mesh(new BoxGeometry(s * 1.6, bodyH + 0.001, s * 2.0, 6, 1, 8), patternMat);
  inner.position.set(0, 0.001, 0);
  carpet.add(inner);

  // Gold trim — port & starboard edges (named for speed-curl animation)
  const trimThick = s * 0.18;
  for (const side of [-1, 1]) {
    const sx = side * (bodyW * 0.5 - trimThick * 0.3);
    const mat = makeTrimMat([sx, 0.001, 0]);
    const strip = new Mesh(new BoxGeometry(trimThick, bodyH + 0.001, bodyLen + s * 0.1, 1, 1, 12), mat);
    strip.position.set(sx, 0.001, 0);
    strip.name = side < 0 ? "trimLeft" : "trimRight";
    carpet.add(strip);
  }

  // Gold trim — front & back edges
  for (const end of [-1, 1]) {
    const sz = end * (bodyLen * 0.5 - trimThick * 0.3);
    const mat = makeTrimMat([0, 0.001, sz]);
    const strip = new Mesh(new BoxGeometry(bodyW + s * 0.1, bodyH + 0.001, trimThick, 8, 1, 1), mat);
    strip.position.set(0, 0.001, sz);
    carpet.add(strip);
  }

  // Capybara (Passenger)
  const capyGroup = new Group();
  capyGroup.name = "capybara";
  
  const loader = new GLTFLoader();
  loader.load("/3D/capybara.glb", (gltf) => {
    const model = gltf.scene;
    
    // Scale and position the model to fit on the carpet
    model.scale.setScalar(0.05);
    model.position.y = 0.025; // Shift up so it sits on the carpet
    
    // Rotate 90 degrees to the right (from Math.PI)
    model.rotation.y = Math.PI / 2;
    
    model.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Convert to MeshPhongMaterial for rim lighting and flat shading
        const oldMat = mesh.material as any;
        const newMat = new MeshPhongMaterial({
          color: oldMat.color,
          map: oldMat.map,
          flatShading: true,
          shininess: 15,
        });
        addRimLight(newMat, 0xffddaa, 0.35, 2.5);
        mesh.material = newMat;
      }
    });
    
    capyGroup.add(model);
  });

  capyGroup.position.set(0, bodyH * 0.5, -s * 0.4);
  carpet.add(capyGroup);

  carpet.traverse((child) => { child.castShadow = true; });
  carpet.userData.hullMaterial = bodyMat;
  return carpet;
}
