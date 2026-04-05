/**
 * Low-poly magic carpet — local +Z forward, +Y up.
 * Flat body with curled front edge, gold trim, corner tassels.
 */
import {
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  MeshPhongMaterial,
} from "three";
import { addRimLight } from "./RimLight";

export function createCarpet(baseColor: number = 0x6b1d6e): Group {
  const carpet = new Group();
  const s = 0.025;

  const bodyMat = new MeshPhongMaterial({ color: baseColor, flatShading: true, shininess: 45 });
  addRimLight(bodyMat, 0xeeccff, 0.3, 3.0);

  const trimMat = new MeshPhongMaterial({ color: 0xd4a830, flatShading: true, shininess: 60 });
  addRimLight(trimMat, 0xffe888, 0.35, 2.5);

  const patternMat = new MeshPhongMaterial({ color: 0x8b2252, flatShading: true, shininess: 40 });
  addRimLight(patternMat, 0xffaacc, 0.2, 3.0);

  const tasselMat = new MeshPhongMaterial({ color: 0xd4a830, flatShading: true, shininess: 35 });
  addRimLight(tasselMat, 0xffe888, 0.2, 3.0);

  // Main body — flat rectangle, slightly wider than long
  const bodyW = s * 2.8;
  const bodyH = s * 0.06;
  const bodyLen = s * 3.6;
  const body = new Mesh(new BoxGeometry(bodyW, bodyH, bodyLen), bodyMat);
  body.position.set(0, 0, 0);
  carpet.add(body);

  // Center pattern — inner rectangle
  const inner = new Mesh(new BoxGeometry(s * 1.6, bodyH + 0.001, s * 2.0), patternMat);
  inner.position.set(0, 0.001, 0);
  carpet.add(inner);

  // Gold trim — port & starboard edges (named for speed-curl animation)
  const trimThick = s * 0.18;
  for (const side of [-1, 1]) {
    const strip = new Mesh(new BoxGeometry(trimThick, bodyH + 0.001, bodyLen + s * 0.1), trimMat);
    strip.position.set(side * (bodyW * 0.5 - trimThick * 0.3), 0.001, 0);
    strip.name = side < 0 ? "trimLeft" : "trimRight";
    carpet.add(strip);
  }

  // Gold trim — front & back edges
  for (const end of [-1, 1]) {
    const strip = new Mesh(new BoxGeometry(bodyW + s * 0.1, bodyH + 0.001, trimThick), trimMat);
    strip.position.set(0, 0.001, end * (bodyLen * 0.5 - trimThick * 0.3));
    carpet.add(strip);
  }

  // Curled front edge — slight upward tilt at the bow
  const curl = new Mesh(new BoxGeometry(bodyW * 0.85, bodyH, s * 0.4), bodyMat);
  curl.position.set(0, s * 0.12, -bodyLen * 0.5 - s * 0.12);
  curl.rotation.x = -0.35;
  carpet.add(curl);

  // Tassels — 4 small cylinders at the corners
  const tasselR = s * 0.06;
  const tasselH = s * 0.5;
  const corners: [number, number][] = [
    [-bodyW * 0.5, -bodyLen * 0.5],
    [bodyW * 0.5, -bodyLen * 0.5],
    [-bodyW * 0.5, bodyLen * 0.5],
    [bodyW * 0.5, bodyLen * 0.5],
  ];
  corners.forEach(([cx, cz], i) => {
    const tassel = new Mesh(new CylinderGeometry(tasselR, tasselR * 0.4, tasselH, 4), tasselMat);
    tassel.position.set(cx, -tasselH * 0.5, cz);
    tassel.name = `tassel${i}`;
    carpet.add(tassel);
  });

  carpet.traverse((child) => { child.castShadow = true; });
  return carpet;
}
