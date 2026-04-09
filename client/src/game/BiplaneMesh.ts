import {
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  MeshPhongMaterial,
  CircleGeometry,
  DoubleSide,
  ConeGeometry,
} from "three";
import { addRimLight } from "./RimLight";

export function createBiplane(color: number = 0xff4444): Group {
  const plane = new Group();
  const s = 0.025;

  const bodyMat = new MeshPhongMaterial({ color, flatShading: true, shininess: 50 });
  addRimLight(bodyMat, 0xffeebb, 0.25, 3.5);
  const accentMat = new MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 30 });
  const wingMat = new MeshPhongMaterial({ color: 0xf0e0c0, flatShading: true, shininess: 25 });
  addRimLight(wingMat, 0xffeebb, 0.2, 3.5);
  const darkMat = new MeshPhongMaterial({ color: 0x2a2a2a, flatShading: true, shininess: 60 });
  const strutMat = new MeshPhongMaterial({ color: 0x8B6914, flatShading: true, shininess: 20 });
  const glassMat = new MeshPhongMaterial({ color: 0x88ccee, flatShading: true, shininess: 90, transparent: true, opacity: 0.6 });

  // --- Fuselage: rounded chunky body ---
  const fuselage = new Mesh(new SphereGeometry(s * 1.0, 8, 6), bodyMat);
  fuselage.scale.set(0.8, 0.7, 1.8);
  plane.add(fuselage);

  // Nose cone: elongated sphere for a cartoon snout
  const nose = new Mesh(new SphereGeometry(s * 0.7, 7, 5), bodyMat);
  nose.scale.set(0.7, 0.65, 1.3);
  nose.position.set(0, 0, -s * 2.4);
  plane.add(nose);

  // White belly stripe
  const belly = new Mesh(new SphereGeometry(s * 0.85, 8, 5), accentMat);
  belly.scale.set(0.65, 0.35, 1.6);
  belly.position.set(0, -s * 0.35, 0);
  plane.add(belly);

  // --- Cockpit windshield ---
  const windshield = new Mesh(new SphereGeometry(s * 0.45, 6, 4), glassMat);
  windshield.scale.set(0.7, 0.6, 0.8);
  windshield.position.set(0, s * 0.55, -s * 0.4);
  plane.add(windshield);

  // --- Tail section: tapered cone ---
  const tail = new Mesh(new ConeGeometry(s * 0.6, s * 3.5, 6), bodyMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, s * 0.05, s * 3.2);
  tail.scale.set(0.7, 0.6, 1);
  plane.add(tail);

  // --- Upper wing: slightly swept, rounded tips ---
  const upperWing = new Mesh(new BoxGeometry(s * 8.5, s * 0.18, s * 1.8), bodyMat);
  upperWing.position.set(0, s * 1.4, -s * 0.2);
  plane.add(upperWing);

  for (const side of [-1, 1]) {
    const tip = new Mesh(new BoxGeometry(s * 0.4, s * 0.18, s * 1.8), bodyMat);
    tip.position.set(side * s * 4.45, s * 1.4, -s * 0.2);
    plane.add(tip);
  }

  // --- Lower wing: slightly smaller ---
  const lowerWing = new Mesh(new BoxGeometry(s * 7.0, s * 0.18, s * 1.6), bodyMat);
  lowerWing.position.set(0, -s * 0.5, 0);
  plane.add(lowerWing);

  for (const side of [-1, 1]) {
    const tip = new Mesh(new BoxGeometry(s * 0.35, s * 0.18, s * 1.6), bodyMat);
    tip.position.set(side * s * 3.68, -s * 0.5, 0);
    plane.add(tip);
  }

  // --- Wing struts: angled for character ---
  const strutGeo = new CylinderGeometry(s * 0.07, s * 0.07, s * 1.8, 4);
  const struts: [number, number, number, number][] = [
    [-s * 2.2, s * 0.45, -s * 0.1, -0.08],
    [s * 2.2, s * 0.45, -s * 0.1, 0.08],
    [-s * 2.2, s * 0.45, s * 0.5, -0.08],
    [s * 2.2, s * 0.45, s * 0.5, 0.08],
  ];
  for (const [x, y, z, tilt] of struts) {
    const strut = new Mesh(strutGeo, strutMat);
    strut.position.set(x, y, z);
    strut.rotation.z = tilt;
    plane.add(strut);
  }

  // --- Tail fin: taller, swept shape ---
  const tailFin = new Mesh(new BoxGeometry(s * 0.12, s * 1.8, s * 1.4), bodyMat);
  tailFin.position.set(0, s * 1.0, s * 4.5);
  tailFin.rotation.x = 0.1;
  plane.add(tailFin);

  // Tail fin cap
  const finCap = new Mesh(new SphereGeometry(s * 0.35, 5, 4), bodyMat);
  finCap.scale.set(0.18, 1, 0.8);
  finCap.position.set(0, s * 1.9, s * 4.3);
  plane.add(finCap);

  // --- Horizontal stabilizer: wider, with rounded tips ---
  const hStab = new Mesh(new BoxGeometry(s * 3.2, s * 0.12, s * 1.0), bodyMat);
  hStab.position.set(0, s * 0.15, s * 4.6);
  plane.add(hStab);

  for (const side of [-1, 1]) {
    const stabTip = new Mesh(new SphereGeometry(s * 0.25, 5, 4), bodyMat);
    stabTip.scale.set(1, 0.15, 0.7);
    stabTip.position.set(side * s * 1.6, s * 0.15, s * 4.6);
    plane.add(stabTip);
  }

  // --- Engine cowling ring ---
  const cowling = new Mesh(
    new CylinderGeometry(s * 0.75, s * 0.65, s * 0.4, 8),
    darkMat,
  );
  cowling.rotation.x = Math.PI / 2;
  cowling.position.set(0, 0, -s * 3.3);
  plane.add(cowling);

  // --- Propeller disc ---
  const propDisc = new Mesh(
    new CircleGeometry(s * 1.1, 8),
    new MeshPhongMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      flatShading: true,
    }),
  );
  propDisc.position.set(0, 0, -s * 3.55);
  plane.add(propDisc);

  // Propeller hub
  const hub = new Mesh(
    new CylinderGeometry(s * 0.18, s * 0.18, s * 0.5, 6),
    darkMat,
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 0, -s * 3.7);
  plane.add(hub);

  // --- Landing gear: splayed legs with chunky wheels ---
  const gearGeo = new CylinderGeometry(s * 0.06, s * 0.05, s * 1.0, 4);
  const wheelGeo = new CylinderGeometry(s * 0.2, s * 0.2, s * 0.12, 8);

  for (const side of [-1, 1]) {
    const leg = new Mesh(gearGeo, strutMat);
    leg.position.set(side * s * 0.7, -s * 1.0, -s * 0.6);
    leg.rotation.z = side * 0.2;
    leg.rotation.x = -0.1;
    plane.add(leg);

    const wheel = new Mesh(wheelGeo, darkMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(side * s * 0.85, -s * 1.45, -s * 0.7);
    plane.add(wheel);
  }

  // Tail wheel
  const tailWheel = new Mesh(
    new CylinderGeometry(s * 0.1, s * 0.1, s * 0.08, 6),
    darkMat,
  );
  tailWheel.rotation.x = Math.PI / 2;
  tailWheel.position.set(0, -s * 0.55, s * 4.2);
  plane.add(tailWheel);

  plane.traverse((child) => {
    child.castShadow = true;
  });

  plane.userData.hullMaterial = bodyMat;
  return plane;
}
