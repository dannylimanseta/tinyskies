/**
 * Low-poly sloop: local +Z forward, +Y up (before globe orientation).
 * Hull + keel + deck, single mast, mainsail + jib, boom.
 */
import {
  Group,
  Mesh,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  MeshPhongMaterial,
  CylinderGeometry,
  DoubleSide,
} from "three";
import { addRimLight } from "./RimLight";

function triangleMesh(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  mat: MeshPhongMaterial,
): Mesh {
  const geo = new BufferGeometry();
  const vertices = new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz]);
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return new Mesh(geo, mat);
}

export function createBoat(hullColor: number = 0x4a6a8a): Group {
  const boat = new Group();
  const s = 0.025;

  const hullMat = new MeshPhongMaterial({ color: hullColor, flatShading: true, shininess: 48 });
  addRimLight(hullMat, 0xffeebb, 0.28, 3.5);
  const stripeMat = new MeshPhongMaterial({ color: 0x2a3d52, flatShading: true, shininess: 40 });
  addRimLight(stripeMat, 0xffeebb, 0.2, 3.5);
  const deckMat = new MeshPhongMaterial({ color: 0xb8956a, flatShading: true, shininess: 38 });
  addRimLight(deckMat, 0xffeebb, 0.22, 3.5);
  const woodMat = new MeshPhongMaterial({ color: 0x6b4e2e, flatShading: true, shininess: 28 });
  addRimLight(woodMat, 0xffddaa, 0.2, 3.5);
  const sailMat = new MeshPhongMaterial({
    color: 0xf5f0e6,
    flatShading: true,
    shininess: 22,
    side: DoubleSide,
  });
  addRimLight(sailMat, 0xffeecc, 0.2, 4);
  const jibMat = new MeshPhongMaterial({
    color: 0xe8e4dc,
    flatShading: true,
    shininess: 20,
    side: DoubleSide,
  });
  addRimLight(jibMat, 0xffeecc, 0.16, 4);

  const deckY = s * 0.38;
  const mastZ = -s * 0.32;
  const mastBotY = deckY + s * 0.12;
  const mastTopY = deckY + s * 2.85;

  // --- Hull: subtle sheer (stern slightly higher) via stacked volumes ---
  const hullMain = new Mesh(new BoxGeometry(s * 2.15, s * 0.46, s * 4.85), hullMat);
  hullMain.position.set(0, s * 0.1, s * 0.12);
  boat.add(hullMain);

  const hullStern = new Mesh(new BoxGeometry(s * 2.05, s * 0.42, s * 0.95), hullMat);
  hullStern.position.set(0, s * 0.14, s * 2.65);
  boat.add(hullStern);

  const bow = new Mesh(new CylinderGeometry(0, s * 0.88, s * 1.35, 6), hullMat);
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, s * 0.08, -s * 2.75);
  boat.add(bow);

  // Waterline accent band
  const stripe = new Mesh(new BoxGeometry(s * 2.22, s * 0.07, s * 5.35), stripeMat);
  stripe.position.set(0, s * 0.02, s * 0.1);
  boat.add(stripe);

  // Keel (fin — reads as sailboat from low angles)
  const keel = new Mesh(new BoxGeometry(s * 0.14, s * 0.32, s * 3.6), hullMat);
  keel.position.set(0, -s * 0.22, s * 0.15);
  boat.add(keel);

  // Deck
  const deck = new Mesh(new BoxGeometry(s * 1.75, s * 0.09, s * 4.1), deckMat);
  deck.position.set(0, deckY, s * 0.12);
  boat.add(deck);

  // Transom
  const transom = new Mesh(new BoxGeometry(s * 1.65, s * 0.35, s * 0.08), deckMat);
  transom.position.set(0, deckY + s * 0.1, s * 2.62);
  boat.add(transom);

  // Mast (tapered)
  const mast = new Mesh(
    new CylinderGeometry(s * 0.045, s * 0.065, mastTopY - mastBotY + s * 0.05, 6),
    woodMat,
  );
  mast.position.set(0, (mastBotY + mastTopY) * 0.5, mastZ);
  boat.add(mast);

  // Mainsail: foot along mast, clew out to starboard
  const mainClewX = s * 1.55;
  const mainClewY = mastBotY + s * 0.95;
  const mainClewZ = s * 0.62;
  const mainsail = triangleMesh(
    0, mastBotY, mastZ,
    0, mastTopY, mastZ,
    mainClewX, mainClewY, mainClewZ,
    sailMat,
  );
  boat.add(mainsail);

  // Jib: foretriangle (tack near stem, head at mast top, clew to port)
  const tackZ = -s * 2.35;
  const tackY = deckY + s * 0.04;
  const jibClewX = -s * 1.15;
  const jibClewY = deckY + s * 0.55;
  const jibClewZ = -s * 1.55;
  const jib = triangleMesh(
    0, tackY, tackZ,
    0, mastTopY, mastZ,
    jibClewX, jibClewY, jibClewZ,
    jibMat,
  );
  boat.add(jib);

  // Boom (mainsail foot)
  const boom = new Mesh(new BoxGeometry(s * 1.58, s * 0.035, s * 0.035), woodMat);
  boom.position.set(s * 0.62, mastBotY + s * 0.06, s * 0.18);
  boom.rotation.z = -0.1;
  boat.add(boom);

  // Bowsprit (short — jib luff line)
  const sprit = new Mesh(new CylinderGeometry(s * 0.025, s * 0.03, s * 0.85, 4), woodMat);
  sprit.rotation.x = Math.PI / 2;
  sprit.position.set(0, deckY + s * 0.06, -s * 2.15);
  boat.add(sprit);

  // Rudder
  const rudder = new Mesh(new BoxGeometry(s * 0.06, s * 0.45, s * 0.22), hullMat);
  rudder.position.set(0, s * 0.02, s * 2.95);
  boat.add(rudder);

  return boat;
}
