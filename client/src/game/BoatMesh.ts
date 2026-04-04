/**
 * Simple low-poly fishing boat — local +Z forward, +Y up.
 * Open-top hull (walls + floor) so the deck is visible inside.
 * Boxy hull tapering to a pointed bow, wheelhouse, crates, exhaust pipe.
 * White foam waterline outline for ocean feel.
 */
import {
  Group,
  Mesh,
  BoxGeometry,
  MeshPhongMaterial,
  MeshBasicMaterial,
  CylinderGeometry,
  AdditiveBlending,
} from "three";
import { addRimLight } from "./RimLight";

export function createBoat(hullColor: number = 0xb83c2b): Group {
  const boat = new Group();
  const s = 0.0375;

  const hullMat = new MeshPhongMaterial({ color: hullColor, flatShading: true, shininess: 50 });
  addRimLight(hullMat, 0xffeedd, 0.28, 3.2);

  const deckMat = new MeshPhongMaterial({ color: 0x6b5030, flatShading: true, shininess: 32 });
  addRimLight(deckMat, 0xffeebb, 0.2, 3.5);

  const cabinMat = new MeshPhongMaterial({ color: 0xe2dace, flatShading: true, shininess: 30 });
  addRimLight(cabinMat, 0xffeedd, 0.2, 3.5);

  const metalMat = new MeshPhongMaterial({ color: 0x5a5f62, flatShading: true, shininess: 50 });
  addRimLight(metalMat, 0xddeeff, 0.18, 3);

  const crateMat = new MeshPhongMaterial({ color: 0x8a6e3e, flatShading: true, shininess: 22 });
  addRimLight(crateMat, 0xffddaa, 0.16, 3.5);

  const crateDarkMat = new MeshPhongMaterial({ color: 0x6a5530, flatShading: true, shininess: 22 });
  addRimLight(crateDarkMat, 0xffddaa, 0.14, 3.5);

  const foamMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  const hullW = s * 2.3;
  const hullH = s * 0.68;
  const hullLen = s * 3.6;
  const wallThick = s * 0.15;
  const hullY = s * 0.08;
  const deckY = hullY + s * 0.02;

  // ==================== HULL (open-top walls + bottom) ====================

  // Bottom plate
  const bottom = new Mesh(new BoxGeometry(hullW, wallThick * 0.5, hullLen), hullMat);
  bottom.position.set(0, hullY - hullH * 0.5 + wallThick * 0.25, s * 0.2);
  boat.add(bottom);

  // Port & starboard walls — stop at the front of the main hull box
  for (const side of [-1, 1]) {
    const wall = new Mesh(new BoxGeometry(wallThick, hullH, hullLen), hullMat);
    wall.position.set(side * (hullW * 0.5 - wallThick * 0.5), hullY, s * 0.2);
    boat.add(wall);
  }

  // Bow — two straight angled planks converging to a point
  const bowBackZ = 1.6;   // front edge of main hull (hullLen/2 - main hull offset)
  const bowTipZ = 2.75;
  const bowHalfW = 1.075; // hull wall centre-line (hullW/2 - wallThick/2) in s units
  const bowDz = bowTipZ - bowBackZ;
  const bowPlankLen = Math.sqrt(bowHalfW * bowHalfW + bowDz * bowDz);
  const bowAngle = Math.atan2(bowHalfW, bowDz);

  for (const side of [-1, 1]) {
    const plank = new Mesh(new BoxGeometry(wallThick, hullH, s * bowPlankLen), hullMat);
    plank.position.set(side * s * bowHalfW * 0.5, hullY, -s * (bowBackZ + bowTipZ) * 0.5);
    plank.rotation.y = side * bowAngle;
    boat.add(plank);
  }

  // Bow bottom plate
  const bowBot = new Mesh(new BoxGeometry(s * 1.4, wallThick * 0.5, s * 1.0), hullMat);
  bowBot.position.set(0, hullY - hullH * 0.5 + wallThick * 0.25, -s * 1.85);
  boat.add(bowBot);

  // Bow deck — tapering strips that follow the hull plank angle
  const bowDeckSteps = 6;
  const bowDeckEnd = 2.5;
  const bowDeckStepLen = (bowDeckEnd - bowBackZ) / bowDeckSteps;
  for (let i = 0; i < bowDeckSteps; i++) {
    const zCenter = bowBackZ + bowDeckStepLen * (i + 0.5);
    const t = 1 - (zCenter - bowBackZ) / (bowTipZ - bowBackZ);
    const stripW = Math.max(0.12, bowHalfW * 2 * t - 0.2);
    const strip = new Mesh(
      new BoxGeometry(s * stripW, s * 0.06, s * (bowDeckStepLen + 0.02)),
      deckMat,
    );
    strip.position.set(0, deckY, -s * zCenter);
    boat.add(strip);
  }

  // Stern taper — wall panels (open top like main hull)
  const sternSteps = [
    { w: 2.1, z: 1.85, len: 0.5 },
    { w: 1.8, z: 2.15, len: 0.35 },
  ];
  for (const t of sternSteps) {
    // Bottom
    const sternBot = new Mesh(new BoxGeometry(s * t.w, wallThick * 0.5, s * t.len), hullMat);
    sternBot.position.set(0, hullY - hullH * 0.5 + wallThick * 0.25, s * t.z);
    boat.add(sternBot);
    // Port & starboard walls
    for (const side of [-1, 1]) {
      const sternWall = new Mesh(new BoxGeometry(wallThick, s * 0.60, s * t.len), hullMat);
      sternWall.position.set(side * (s * t.w * 0.5 - wallThick * 0.5), hullY, s * t.z);
      boat.add(sternWall);
    }
  }

  // Stern transom — wall panel (not solid block)
  const transom = new Mesh(new BoxGeometry(s * 1.7, s * 0.58, wallThick), hullMat);
  transom.position.set(0, hullY, s * 2.35);
  boat.add(transom);

  // Stern deck extension so deck is visible in the aft section
  const sternDeck = new Mesh(new BoxGeometry(s * 1.7, s * 0.06, s * 1.2), deckMat);
  sternDeck.position.set(0, deckY, s * 1.8);
  boat.add(sternDeck);

  // ==================== DECK (floor inside the hull) ====================

  const deckLen = hullLen + s * 0.15;
  const deck = new Mesh(new BoxGeometry(hullW - wallThick * 2, s * 0.06, deckLen), deckMat);
  deck.position.set(0, deckY, s * 0.12);
  boat.add(deck);

  // ==================== FOAM WATERLINE ====================

  const foamSide = s * 0.14;
  const foamH = s * 0.14;
  const foamY = -s * 0.18;

  // Port & starboard
  for (const side of [-1, 1]) {
    const strip = new Mesh(new BoxGeometry(foamSide, foamH, s * 3.9), foamMat);
    strip.position.set(side * (hullW * 0.5 + foamSide * 0.3), foamY, s * 0.2);
    boat.add(strip);
  }

  // Bow foam — two angled strips following the hull planks
  for (const side of [-1, 1]) {
    const strip = new Mesh(new BoxGeometry(foamSide, foamH, s * bowPlankLen), foamMat);
    strip.position.set(
      side * (s * bowHalfW * 0.5 + foamSide * 0.4),
      foamY,
      -s * (bowBackZ + bowTipZ) * 0.5,
    );
    strip.rotation.y = side * bowAngle;
    boat.add(strip);
  }

  // Stern foam
  const sternFoam = [
    { w: 2.14, z: 1.85, len: 0.54 },
    { w: 1.84, z: 2.15, len: 0.39 },
  ];
  for (const t of sternFoam) {
    for (const side of [-1, 1]) {
      const strip = new Mesh(new BoxGeometry(foamSide, foamH, s * t.len), foamMat);
      strip.position.set(side * (s * t.w * 0.5 + foamSide * 0.3), foamY, s * t.z);
      boat.add(strip);
    }
  }

  // Transom foam
  const transomFoam = new Mesh(new BoxGeometry(s * 1.8, foamH, foamSide), foamMat);
  transomFoam.position.set(0, foamY, s * 2.4);
  boat.add(transomFoam);

  // Bow tip foam
  const bowTipFoam = new Mesh(new BoxGeometry(s * 0.16, foamH, foamSide), foamMat);
  bowTipFoam.position.set(0, foamY, -s * bowTipZ);
  boat.add(bowTipFoam);

  // ==================== WHEELHOUSE ====================

  const cabin = new Mesh(new BoxGeometry(s * 1.5, s * 0.8, s * 1.3), cabinMat);
  cabin.position.set(0, deckY + s * 0.46, s * 0.3);
  boat.add(cabin);

  const roof = new Mesh(new BoxGeometry(s * 1.6, s * 0.06, s * 1.4), metalMat);
  roof.position.set(0, deckY + s * 0.9, s * 0.3);
  boat.add(roof);

  // ==================== CRATES ====================

  const crate1 = new Mesh(new BoxGeometry(s * 0.55, s * 0.4, s * 0.5), crateMat);
  crate1.position.set(-s * 0.35, deckY + s * 0.24, s * 1.35);
  boat.add(crate1);

  const crate2 = new Mesh(new BoxGeometry(s * 0.5, s * 0.35, s * 0.45), crateDarkMat);
  crate2.position.set(s * 0.32, deckY + s * 0.22, s * 1.4);
  boat.add(crate2);

  const crate3 = new Mesh(new BoxGeometry(s * 0.4, s * 0.28, s * 0.38), crateMat);
  crate3.position.set(-s * 0.3, deckY + s * 0.58, s * 1.3);
  crate3.rotation.y = 0.25;
  boat.add(crate3);

  // ==================== EXHAUST ====================

  const stack = new Mesh(new CylinderGeometry(s * 0.06, s * 0.08, s * 0.4, 6), metalMat);
  stack.position.set(s * 0.35, deckY + s * 1.1, s * 0.8);
  boat.add(stack);

  // ==================== RUDDER ====================

  const rudder = new Mesh(new BoxGeometry(s * 0.06, s * 0.38, s * 0.2), metalMat);
  rudder.position.set(0, s * 0.04, s * 2.0);
  boat.add(rudder);

  boat.traverse((child) => { child.castShadow = true; });
  return boat;
}
