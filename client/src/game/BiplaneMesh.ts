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
  LatheGeometry,
  Vector2,
  MathUtils,
} from "three";
import { addRimLight } from "./RimLight";

/** Paint splatters (decals) are limited to these meshes — see `PaintballSystem`. */
function markPaintSplatterWing(m: Mesh) {
  m.userData.paintSplatterSurface = true;
}

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
  const metalMat = new MeshPhongMaterial({ color: 0x888888, flatShading: true, shininess: 80 });
  addRimLight(metalMat, 0xffffff, 0.4, 3.0);

  // --- Fuselage: single smooth body ---
  const profile: Vector2[] = [];
  const fLen = 7.8 * s;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = t * fLen;
    let r = 0;
    if (t < 0.15) {
      const t2 = t / 0.15;
      r = MathUtils.lerp(0.75 * s, 0.85 * s, Math.sin(t2 * Math.PI / 2));
    } else if (t < 0.4) {
      r = 0.85 * s;
    } else {
      const t2 = (t - 0.4) / 0.6;
      r = MathUtils.lerp(0.85 * s, 0.15 * s, t2 * t2 * (3 - 2 * t2));
    }
    profile.push(new Vector2(r, y));
  }
  const fuselageGeo = new LatheGeometry(profile, 24);
  fuselageGeo.rotateX(Math.PI / 2);
  fuselageGeo.translate(0, 0, -3.1 * s);
  const fuselage = new Mesh(fuselageGeo, bodyMat);
  plane.add(fuselage);

  // --- Cockpit windshield ---
  const windshield = new Mesh(new SphereGeometry(s * 0.45, 8, 6), glassMat);
  windshield.scale.set(0.7, 0.6, 0.8);
  windshield.position.set(0, s * 0.8, -s * 0.4);
  plane.add(windshield);
  
  // Windshield frame
  const windFrame = new Mesh(new CylinderGeometry(s * 0.46, s * 0.46, s * 0.1, 8), metalMat);
  windFrame.rotation.x = Math.PI / 2;
  windFrame.rotation.z = Math.PI / 2;
  windFrame.position.set(0, s * 0.8, -s * 0.4);
  windFrame.scale.set(0.7, 0.8, 0.6);
  plane.add(windFrame);

  // --- Upper wing: slightly swept, rounded tips ---
  const upperWing = new Mesh(new BoxGeometry(s * 8.5, s * 0.18, s * 1.8), wingMat);
  upperWing.position.set(0, s * 1.4, -s * 0.2);
  markPaintSplatterWing(upperWing);
  plane.add(upperWing);

  for (const side of [-1, 1]) {
    const tip = new Mesh(new CylinderGeometry(s * 0.9, s * 0.9, s * 0.18, 12), wingMat);
    tip.position.set(side * s * 4.25, s * 1.4, -s * 0.2);
    tip.scale.set(1, 1, 1);
    plane.add(tip);
  }

  // --- Lower wing: slightly smaller ---
  const lowerWing = new Mesh(new BoxGeometry(s * 7.0, s * 0.18, s * 1.6), wingMat);
  lowerWing.position.set(0, -s * 0.5, 0);
  markPaintSplatterWing(lowerWing);
  plane.add(lowerWing);

  for (const side of [-1, 1]) {
    const tip = new Mesh(new CylinderGeometry(s * 0.8, s * 0.8, s * 0.18, 12), wingMat);
    tip.position.set(side * s * 3.5, -s * 0.5, 0);
    plane.add(tip);
  }

  // --- Wing struts: angled for character ---
  const strutGeo = new CylinderGeometry(s * 0.07, s * 0.07, s * 1.8, 6);
  const struts: [number, number, number, number][] = [
    [-s * 2.2, s * 0.45, -s * 0.1, -0.08],
    [s * 2.2, s * 0.45, -s * 0.1, 0.08],
    [-s * 2.2, s * 0.45, s * 0.5, -0.08],
    [s * 2.2, s * 0.45, s * 0.5, 0.08],
    // Inner cabane struts
    [-s * 0.8, s * 0.45, -s * 0.1, 0.15],
    [s * 0.8, s * 0.45, -s * 0.1, -0.15],
  ];
  for (const [x, y, z, tilt] of struts) {
    const strut = new Mesh(strutGeo, strutMat);
    strut.position.set(x, y, z);
    strut.rotation.z = tilt;
    plane.add(strut);
  }

  // --- Tail fin: taller, swept shape ---
  const tailFin = new Mesh(new BoxGeometry(s * 0.12, s * 1.8, s * 1.4), bodyMat);
  tailFin.position.set(0, s * 0.8, s * 4.5);
  tailFin.rotation.x = 0.1;
  plane.add(tailFin);

  // Tail fin cap
  const finCap = new Mesh(new SphereGeometry(s * 0.35, 8, 6), bodyMat);
  finCap.scale.set(0.18, 1, 0.8);
  finCap.position.set(0, s * 1.7, s * 4.3);
  plane.add(finCap);

  // --- Horizontal stabilizer: wider, with rounded tips ---
  const hStab = new Mesh(new BoxGeometry(s * 3.2, s * 0.12, s * 1.0), bodyMat);
  hStab.position.set(0, s * 0.15, s * 4.6);
  plane.add(hStab);

  for (const side of [-1, 1]) {
    const stabTip = new Mesh(new CylinderGeometry(s * 0.5, s * 0.5, s * 0.12, 10), bodyMat);
    stabTip.position.set(side * s * 1.6, s * 0.15, s * 4.6);
    plane.add(stabTip);
  }

  // --- Engine cowling ring ---
  const cowling = new Mesh(
    new CylinderGeometry(s * 0.75, s * 0.65, s * 0.4, 12),
    metalMat,
  );
  cowling.rotation.x = Math.PI / 2;
  cowling.position.set(0, 0, -s * 3.3);
  plane.add(cowling);
  
  // Engine cylinders (radial)
  const cylGeo = new CylinderGeometry(s * 0.15, s * 0.15, s * 0.4, 6);
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const cyl = new Mesh(cylGeo, darkMat);
    cyl.position.set(Math.cos(angle) * s * 0.5, Math.sin(angle) * s * 0.5, -s * 3.3);
    cyl.rotation.z = angle + Math.PI / 2;
    plane.add(cyl);
  }

  // --- Propeller assembly ---
  const propellerGroup = new Group();
  propellerGroup.position.set(0, 0, -s * 3.55);
  plane.add(propellerGroup);

  // Propeller disc (motion blur)
  const propDisc = new Mesh(
    new CircleGeometry(s * 1.4, 16),
    new MeshPhongMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.2,
      side: DoubleSide,
      flatShading: true,
    }),
  );
  propellerGroup.add(propDisc);

  // Propeller blades
  const bladeGeo = new BoxGeometry(s * 2.6, s * 0.15, s * 0.05);
  const bladeMat = new MeshPhongMaterial({ color: 0x111111, flatShading: true });
  const blade1 = new Mesh(bladeGeo, bladeMat);
  propellerGroup.add(blade1);
  const blade2 = new Mesh(bladeGeo, bladeMat);
  blade2.rotation.z = Math.PI / 2;
  propellerGroup.add(blade2);

  // Propeller hub
  const hub = new Mesh(
    new SphereGeometry(s * 0.3, 8, 6),
    metalMat,
  );
  hub.scale.set(1, 1, 1.5);
  hub.position.set(0, 0, -s * 0.05);
  propellerGroup.add(hub);

  // --- Landing gear: splayed legs with chunky wheels ---
  const gearGeo = new CylinderGeometry(s * 0.06, s * 0.05, s * 1.0, 6);
  const wheelGeo = new CylinderGeometry(s * 0.25, s * 0.25, s * 0.15, 12);
  const tireGeo = new CylinderGeometry(s * 0.3, s * 0.3, s * 0.1, 12);

  for (const side of [-1, 1]) {
    const leg = new Mesh(gearGeo, strutMat);
    leg.position.set(side * s * 0.7, -s * 1.0, -s * 0.6);
    leg.rotation.z = side * 0.2;
    leg.rotation.x = -0.1;
    plane.add(leg);
    
    // Wheel axle
    const axle = new Mesh(new CylinderGeometry(s * 0.04, s * 0.04, s * 0.3, 6), metalMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(side * s * 0.85, -s * 1.45, -s * 0.7);
    plane.add(axle);

    const wheel = new Mesh(wheelGeo, metalMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * s * 0.95, -s * 1.45, -s * 0.7);
    plane.add(wheel);
    
    const tire = new Mesh(tireGeo, darkMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(side * s * 0.95, -s * 1.45, -s * 0.7);
    plane.add(tire);
  }

  // Tail wheel
  const tailWheel = new Mesh(
    new CylinderGeometry(s * 0.12, s * 0.12, s * 0.08, 8),
    darkMat,
  );
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -s * 0.55, s * 4.2);
  plane.add(tailWheel);
  
  // Tail wheel strut
  const tailStrut = new Mesh(new CylinderGeometry(s * 0.04, s * 0.04, s * 0.4, 4), metalMat);
  tailStrut.position.set(0, -s * 0.35, s * 4.1);
  tailStrut.rotation.x = -0.4;
  plane.add(tailStrut);

  const splatterAnchor = new Group();
  splatterAnchor.name = "splatterAnchor";
  plane.add(splatterAnchor);
  plane.userData.splatterAnchor = splatterAnchor;

  plane.traverse((child) => {
    child.castShadow = true;
  });

  plane.userData.hullMaterial = bodyMat;
  plane.userData.propeller = propellerGroup;
  return plane;
}

/** Single-wing NPC monoplane — derived from createBiplane() but without the lower wing and struts. */
export function createMonoplane(color: number = 0x4488ff): Group {
  const plane = new Group();
  const s = 0.025;

  const bodyMat = new MeshPhongMaterial({ color, flatShading: true, shininess: 50 });
  addRimLight(bodyMat, 0xffeebb, 0.25, 3.5);
  const wingMat = new MeshPhongMaterial({ color: 0xf0e0c0, flatShading: true, shininess: 25 });
  addRimLight(wingMat, 0xffeebb, 0.2, 3.5);
  const darkMat = new MeshPhongMaterial({ color: 0x2a2a2a, flatShading: true, shininess: 60 });
  const glassMat = new MeshPhongMaterial({ color: 0x88ccee, flatShading: true, shininess: 90, transparent: true, opacity: 0.6 });
  const metalMat = new MeshPhongMaterial({ color: 0x888888, flatShading: true, shininess: 80 });
  addRimLight(metalMat, 0xffffff, 0.4, 3.0);

  // Fuselage
  const profile: Vector2[] = [];
  const fLen = 7.8 * s;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = t * fLen;
    let r = 0;
    if (t < 0.15) {
      r = MathUtils.lerp(0.75 * s, 0.85 * s, Math.sin((t / 0.15) * Math.PI / 2));
    } else if (t < 0.4) {
      r = 0.85 * s;
    } else {
      const t2 = (t - 0.4) / 0.6;
      r = MathUtils.lerp(0.85 * s, 0.15 * s, t2 * t2 * (3 - 2 * t2));
    }
    profile.push(new Vector2(r, y));
  }
  const fuselageGeo = new LatheGeometry(profile, 24);
  fuselageGeo.rotateX(Math.PI / 2);
  fuselageGeo.translate(0, 0, -3.1 * s);
  plane.add(new Mesh(fuselageGeo, bodyMat));

  // Cockpit
  const windshield = new Mesh(new SphereGeometry(s * 0.45, 8, 6), glassMat);
  windshield.scale.set(0.7, 0.6, 0.8);
  windshield.position.set(0, s * 0.8, -s * 0.4);
  plane.add(windshield);

  // Mid-fuselage single wing (wider than lower biplane wing)
  const wing = new Mesh(new BoxGeometry(s * 9.0, s * 0.18, s * 2.0), wingMat);
  wing.position.set(0, 0, -s * 0.3);
  wing.userData.paintSplatterSurface = true;
  plane.add(wing);
  for (const side of [-1, 1]) {
    const tip = new Mesh(new CylinderGeometry(s * 1.0, s * 1.0, s * 0.18, 12), wingMat);
    tip.position.set(side * s * 4.5, 0, -s * 0.3);
    tip.userData.paintSplatterSurface = true;
    plane.add(tip);
  }

  // Tail fin
  const tailFin = new Mesh(new BoxGeometry(s * 0.12, s * 1.8, s * 1.4), bodyMat);
  tailFin.position.set(0, s * 0.8, s * 4.5);
  tailFin.rotation.x = 0.1;
  plane.add(tailFin);

  // Horizontal stabilizer
  const hStab = new Mesh(new BoxGeometry(s * 3.2, s * 0.12, s * 1.0), bodyMat);
  hStab.position.set(0, s * 0.15, s * 4.6);
  plane.add(hStab);
  for (const side of [-1, 1]) {
    const tip = new Mesh(new CylinderGeometry(s * 0.5, s * 0.5, s * 0.12, 10), bodyMat);
    tip.position.set(side * s * 1.6, s * 0.15, s * 4.6);
    plane.add(tip);
  }

  // Engine cowling
  const cowling = new Mesh(new CylinderGeometry(s * 0.75, s * 0.65, s * 0.4, 12), metalMat);
  cowling.rotation.x = Math.PI / 2;
  cowling.position.set(0, 0, -s * 3.3);
  plane.add(cowling);

  // Propeller
  const propellerGroup = new Group();
  propellerGroup.position.set(0, 0, -s * 3.55);
  plane.add(propellerGroup);
  const propDisc = new Mesh(
    new CircleGeometry(s * 1.4, 16),
    new MeshPhongMaterial({ color: 0x222222, transparent: true, opacity: 0.2, side: DoubleSide }),
  );
  propellerGroup.add(propDisc);
  const bladeGeo = new BoxGeometry(s * 2.6, s * 0.15, s * 0.05);
  const bladeMat = new MeshPhongMaterial({ color: 0x111111, flatShading: true });
  propellerGroup.add(new Mesh(bladeGeo, bladeMat));
  const blade2 = new Mesh(bladeGeo, bladeMat);
  blade2.rotation.z = Math.PI / 2;
  propellerGroup.add(blade2);
  const hub = new Mesh(new SphereGeometry(s * 0.3, 8, 6), metalMat);
  hub.scale.set(1, 1, 1.5);
  hub.position.set(0, 0, -s * 0.05);
  propellerGroup.add(hub);

  // Landing gear
  const gearGeo = new CylinderGeometry(s * 0.06, s * 0.05, s * 1.0, 6);
  const wheelGeo = new CylinderGeometry(s * 0.25, s * 0.25, s * 0.15, 12);
  const tireGeo = new CylinderGeometry(s * 0.3, s * 0.3, s * 0.1, 12);
  const strutMat = new MeshPhongMaterial({ color: 0x8B6914, flatShading: true, shininess: 20 });
  for (const side of [-1, 1]) {
    const leg = new Mesh(gearGeo, strutMat);
    leg.position.set(side * s * 0.7, -s * 1.0, -s * 0.3);
    leg.rotation.z = side * 0.2;
    plane.add(leg);
    const wheel = new Mesh(wheelGeo, metalMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * s * 0.95, -s * 1.45, -s * 0.4);
    plane.add(wheel);
    const tire = new Mesh(tireGeo, darkMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(side * s * 0.95, -s * 1.45, -s * 0.4);
    plane.add(tire);
  }

  const splatterAnchor = new Group();
  splatterAnchor.name = "splatterAnchor";
  plane.add(splatterAnchor);
  plane.userData.splatterAnchor = splatterAnchor;

  plane.traverse((child) => { child.castShadow = true; });

  plane.userData.hullMaterial = bodyMat;
  plane.userData.propeller = propellerGroup;
  return plane;
}
