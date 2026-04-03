import {
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  MeshPhongMaterial,
  CircleGeometry,
  DoubleSide,
} from "three";
import { addRimLight } from "./RimLight";

/**
 * Builds a cute low-poly biplane as a Group.
 * All dimensions relative to `s` (scale unit) so it's easy to resize.
 */
export function createBiplane(color: number = 0xff4444): Group {
  const plane = new Group();
  const s = 0.025;

  const bodyMat = new MeshPhongMaterial({ color, flatShading: true, shininess: 40 });
  addRimLight(bodyMat, 0xffeebb, 0.25, 3.5);
  const wingMat = new MeshPhongMaterial({ color: 0xf5e6c8, flatShading: true, shininess: 20 });
  addRimLight(wingMat, 0xffeebb, 0.2, 3.5);
  const darkMat = new MeshPhongMaterial({ color: 0x333333, flatShading: true, shininess: 10 });
  const strutMat = new MeshPhongMaterial({ color: 0x8B6914, flatShading: true, shininess: 20 });

  // --- Fuselage (chunky box with rounded nose) ---
  const fuselage = new Mesh(
    new BoxGeometry(s * 1.6, s * 1.4, s * 6),
    bodyMat,
  );
  fuselage.position.set(0, 0, 0);
  plane.add(fuselage);

  // Rounded nose cap
  const nose = new Mesh(
    new SphereGeometry(s * 0.85, 6, 6),
    bodyMat,
  );
  nose.position.set(0, 0, -s * 3);
  nose.scale.set(0.95, 0.82, 1.0);
  plane.add(nose);

  // Tail taper (smaller box)
  const tailBody = new Mesh(
    new BoxGeometry(s * 1.0, s * 1.0, s * 2.5),
    bodyMat,
  );
  tailBody.position.set(0, s * 0.1, s * 4.0);
  plane.add(tailBody);

  // --- Upper wing ---
  const upperWing = new Mesh(
    new BoxGeometry(s * 8, s * 0.2, s * 2),
    wingMat,
  );
  upperWing.position.set(0, s * 1.5, -s * 0.3);
  plane.add(upperWing);

  // --- Lower wing ---
  const lowerWing = new Mesh(
    new BoxGeometry(s * 7, s * 0.2, s * 1.8),
    wingMat,
  );
  lowerWing.position.set(0, -s * 0.6, -s * 0.1);
  plane.add(lowerWing);

  // --- Wing struts (4 vertical posts connecting upper and lower wings) ---
  const strutGeo = new CylinderGeometry(s * 0.08, s * 0.08, s * 2.0, 4);
  const strutPositions = [
    [-s * 2.5, s * 0.45, -s * 0.2],
    [s * 2.5, s * 0.45, -s * 0.2],
    [-s * 2.5, s * 0.45, s * 0.6],
    [s * 2.5, s * 0.45, s * 0.6],
  ];
  for (const [x, y, z] of strutPositions) {
    const strut = new Mesh(strutGeo, strutMat);
    strut.position.set(x, y, z);
    plane.add(strut);
  }

  // --- Tail fin (vertical stabilizer) ---
  const tailFin = new Mesh(
    new BoxGeometry(s * 0.15, s * 1.6, s * 1.2),
    bodyMat,
  );
  tailFin.position.set(0, s * 1.0, s * 4.8);
  plane.add(tailFin);

  // --- Horizontal tail stabilizer ---
  const hStab = new Mesh(
    new BoxGeometry(s * 3, s * 0.15, s * 1.0),
    wingMat,
  );
  hStab.position.set(0, s * 0.2, s * 4.8);
  plane.add(hStab);

  // --- Propeller disc (spinning look) ---
  const propDisc = new Mesh(
    new CircleGeometry(s * 1.2, 8),
    new MeshPhongMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.4,
      side: DoubleSide,
      flatShading: true,
    }),
  );
  propDisc.position.set(0, 0, -s * 3.85);
  plane.add(propDisc);

  // Propeller hub
  const hub = new Mesh(
    new CylinderGeometry(s * 0.2, s * 0.2, s * 0.3, 6),
    darkMat,
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 0, -s * 3.9);
  plane.add(hub);

  // --- Landing gear (two little cylinders + wheels) ---
  const gearGeo = new CylinderGeometry(s * 0.06, s * 0.06, s * 1.0, 4);
  const wheelGeo = new SphereGeometry(s * 0.2, 5, 5);

  for (const side of [-1, 1]) {
    const leg = new Mesh(gearGeo, strutMat);
    leg.position.set(side * s * 0.8, -s * 1.1, -s * 0.8);
    leg.rotation.z = side * 0.15;
    plane.add(leg);

    const wheel = new Mesh(wheelGeo, darkMat);
    wheel.position.set(side * s * 0.9, -s * 1.6, -s * 0.8);
    plane.add(wheel);
  }

  plane.traverse((child) => {
    child.castShadow = true;
  });

  return plane;
}
