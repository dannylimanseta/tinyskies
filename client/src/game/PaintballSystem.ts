import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Euler,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  ShaderMaterial,
  type Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  Color,
  type Mesh as MeshT,
} from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import {
  PAINTBALL_COLOR_PALETTE,
  PAINTBALL_COOLDOWN_MS,
  PAINTBALL_RANGE_FACTOR,
  PAINTBALL_SPEED,
  SPLATTER_LIFETIME_SEC,
  type PaintballFiredEvent,
  type PaintballHitEvent,
} from "@globefly/shared";
import { paintballRayFromPlaneState } from "./SphericalMath";
import type { Plane } from "./Plane";
import type { RemotePlaneManager } from "./RemotePlane";
import { PaintballSplashPool } from "./PaintballSplash";
import { seededRandom } from "./SphericalMath";

/** Wing decals: a touch softer than raw palette, but richer than the old heavy pastel wash. */
function decalTintColor(paletteHex: number): Color {
  const c = new Color(paletteHex);
  c.lerp(new Color(0xffffff), 0.08);
  c.offsetHSL(0, 0.06, -0.05);
  return c;
}

const PBALL_VERT = `
varying vec3 vN;
varying vec3 vV;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const PBALL_FRAG = `
uniform vec3 uBase;
uniform vec3 uRim;
uniform float uRimPow;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float rim = pow(1.0 - max(dot(N, V), 0.0), uRimPow);
  vec3 col = mix(uBase, uRim, rim * 0.96);
  col *= 1.06;
  gl_FragColor = vec4(col, uOpacity);
}
`;

function createPaintballMaterial(colorHex: number): ShaderMaterial {
  const base = new Color(colorHex);
  const rim = base.clone().lerp(new Color(0xffffff), 0.52);
  return new ShaderMaterial({
    uniforms: {
      uBase: { value: base },
      uRim: { value: rim },
      uRimPow: { value: 2.05 },
      uOpacity: { value: 1 },
    },
    vertexShader: PBALL_VERT,
    fragmentShader: PBALL_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

type Projectile = {
  shooterId: string;
  /** Sphere radius at muzzle (|origin|). */
  r0: number;
  /** Unit radial from world origin through muzzle. */
  rHat: Vector3;
  /** Unit tangent along great-circle flight. */
  wHat: Vector3;
  traveled: number;
  mesh: MeshT;
  mat: ShaderMaterial;
  maxRange: number;
  speed: number;
};

type SplatterFade = {
  mesh: MeshT;
  mat: MeshBasicMaterial;
  start: number;
};

/** Strip triangles whose average vertex normal faces away from `upDir` (the hit surface normal). */
function stripBackFaces(geo: BufferGeometry, upDir: Vector3): BufferGeometry {
  const pos = geo.attributes.position as BufferAttribute;
  const norm = geo.attributes.normal as BufferAttribute;
  const uv = geo.attributes.uv as BufferAttribute | undefined;
  if (!pos || !norm) return geo;

  const triCount = pos.count / 3;
  const keepTris: number[] = [];
  const avg = new Vector3();

  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    avg.set(0, 0, 0);
    for (let v = 0; v < 3; v++) {
      avg.x += norm.getX(i + v);
      avg.y += norm.getY(i + v);
      avg.z += norm.getZ(i + v);
    }
    if (avg.dot(upDir) > 0) keepTris.push(t);
  }

  if (keepTris.length === triCount) return geo;

  const vertCount = keepTris.length * 3;
  const newPos = new Float32Array(vertCount * 3);
  const newNorm = new Float32Array(vertCount * 3);
  const newUv = uv ? new Float32Array(vertCount * 2) : undefined;

  for (let k = 0; k < keepTris.length; k++) {
    const src = keepTris[k]! * 3;
    const dst = k * 3;
    for (let v = 0; v < 3; v++) {
      const si = src + v;
      const di = dst + v;
      newPos[di * 3] = pos.getX(si);
      newPos[di * 3 + 1] = pos.getY(si);
      newPos[di * 3 + 2] = pos.getZ(si);
      newNorm[di * 3] = norm.getX(si);
      newNorm[di * 3 + 1] = norm.getY(si);
      newNorm[di * 3 + 2] = norm.getZ(si);
      if (uv && newUv) {
        newUv[di * 2] = uv.getX(si);
        newUv[di * 2 + 1] = uv.getY(si);
      }
    }
  }

  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(newPos, 3));
  out.setAttribute("normal", new BufferAttribute(newNorm, 3));
  if (newUv) out.setAttribute("uv", new BufferAttribute(newUv, 2));
  geo.dispose();
  return out;
}

/** Raycaster / traverse only check each node's own `visible`; parents can hide a subtree (e.g. remote carry package). */
function isVisibleInHierarchy(obj: Object3D): boolean {
  let o: Object3D | null = obj;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

function collectDecalTargetMeshes(root: Object3D): MeshT[] {
  const out: MeshT[] = [];
  root.traverse((obj) => {
    const m = obj as MeshT;
    if (!m.isMesh || !m.geometry) return;
    if ((m.userData as { paintSplatterSurface?: boolean }).paintSplatterSurface !== true) return;
    if (!isVisibleInHierarchy(m)) return;
    const g = m.geometry as BufferGeometry;
    if (!g.attributes?.position || g.attributes.position.count < 3) return;
    out.push(m);
  });
  return out;
}

/**
 * Paintball projectiles, local cooldown, splatter decals, socket hooks.
 */
export class PaintballSystem {
  private projectiles: Projectile[] = [];
  private splatters: SplatterFade[] = [];
  private lastLocalFire = 0;
  private texture: Texture | null = null;
  private textureLoaded = false;
  private readonly splashPool = new PaintballSplashPool();

  constructor(
    private readonly scene: Scene,
    private globeRadius: number,
    private getSocketId: () => string | undefined,
    /** Null when offline / menu — projectiles still work solo. */
    private getSocket: () => import("../network/SocketClient").SocketClient | null,
    private remotePlanes: RemotePlaneManager,
    private onLocalPlayerPaintballHit?: () => void,
    private onPaintballVictimWobble?: (victimId: string) => void,
    /** One-shot when a projectile actually spawns (local + remote). */
    private onPaintballShoot?: () => void,
    /** One-shot when a paintball hits a plane. `distant` = true when our shot hit someone else. */
    private onPaintballImpact?: (splatSeed: number, distant: boolean) => void,
  ) {
    const loader = new TextureLoader();
    loader.load(
      "/2D/splatter_1.png",
      (t) => {
        t.colorSpace = SRGBColorSpace;
        t.premultiplyAlpha = false;
        this.texture = t;
        this.textureLoaded = true;
      },
      undefined,
      () => {
        this.textureLoaded = true;
      },
    );
  }

  setGlobeRadius(r: number) {
    this.globeRadius = r;
  }

  /** One frame: local player pressed fire (plane only). */
  tryLocalFire(plane: Plane) {
    const now = performance.now();
    if (now - this.lastLocalFire < PAINTBALL_COOLDOWN_MS) return;
    this.lastLocalFire = now;

    const ray = paintballRayFromPlaneState(
      plane.qPosition,
      plane.heading,
      plane.pitch,
      plane.altitude,
      this.globeRadius,
    );

    const myId = this.getSocketId() ?? "local";
    const color =
      PAINTBALL_COLOR_PALETTE[
        Math.floor(Math.random() * PAINTBALL_COLOR_PALETTE.length)
      ]!;

    const shot = {
      shooterId: myId,
      color,
      ox: ray.origin.x,
      oy: ray.origin.y,
      oz: ray.origin.z,
      dx: ray.direction.x,
      dy: ray.direction.y,
      dz: ray.direction.z,
      speed: PAINTBALL_SPEED,
    };

    const sock = this.getSocket();
    if (sock?.connected) {
      sock.emitPaintballFire();
      /** Optimistic spawn so the shot appears even if `paintball:fired` is slow or lost (prod WS / CDN). */
      if (this.spawnProjectile(shot)) this.onPaintballShoot?.();
      return;
    }

    if (this.spawnProjectile(shot)) this.onPaintballShoot?.();
  }

  onPaintballFired(ev: PaintballFiredEvent) {
    const myId = this.getSocketId();
    if (myId && ev.shooterId === myId) {
      /** Local player already has an optimistic projectile from `tryLocalFire`. */
      return;
    }
    this.spawnProjectile(ev);
  }

  private spawnProjectile(ev: {
    shooterId: string;
    color: number;
    ox: number;
    oy: number;
    oz: number;
    dx: number;
    dy: number;
    dz: number;
    speed: number;
  }): boolean {
    const o = new Vector3(ev.ox, ev.oy, ev.oz);
    const r0 = Math.max(1e-4, o.length());
    const rHat = o.clone().divideScalar(r0);
    let wHat = new Vector3(ev.dx, ev.dy, ev.dz);
    wHat.sub(rHat.clone().multiplyScalar(wHat.dot(rHat)));
    if (wHat.lengthSq() < 1e-8) return false;
    wHat.normalize();

    const maxRange = this.globeRadius * PAINTBALL_RANGE_FACTOR;
    const geo = new SphereGeometry(0.055, 10, 10);
    const mat = createPaintballMaterial(ev.color);
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(o);
    this.scene.add(mesh);
    this.projectiles.push({
      shooterId: ev.shooterId,
      r0,
      rHat,
      wHat,
      traveled: 0,
      mesh,
      mat,
      maxRange,
      speed: ev.speed,
    });
    return true;
  }

  onPaintballHit(ev: PaintballHitEvent, localPlaneGroup: Group | null) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.shooterId === ev.shooterId) {
        this.disposeProjectile(p, i);
        break;
      }
    }

    const myId = this.getSocketId();
    const victimRoot =
      ev.victimId === myId
        ? localPlaneGroup
        : this.remotePlanes.getPlaneGroup(ev.victimId);

    if (!victimRoot) return;

    if (ev.victimId === myId) {
      this.onLocalPlayerPaintballHit?.();
    }
    this.onPaintballVictimWobble?.(ev.victimId);

    let splatWorld = this.addSplatterDecal(victimRoot, ev.color, ev.splatSeed);
    if (!splatWorld) {
      victimRoot.updateMatrixWorld(true);
      splatWorld = victimRoot.getWorldPosition(new Vector3());
    }
    this.splashPool.play(
      this.scene,
      splatWorld,
      decalTintColor(ev.color).getHex(),
      ev.splatSeed,
    );
    if (ev.victimId === myId) {
      this.onPaintballImpact?.(ev.splatSeed, false);
    } else if (ev.shooterId === myId) {
      this.onPaintballImpact?.(ev.splatSeed, true);
    }
  }

  /**
   * Projects splatter onto actual biplane mesh via Raycaster + DecalGeometry,
   * then bakes into victim group's local space so it follows the aircraft.
   */
  private addSplatterDecal(
    victimRoot: Group,
    colorHex: number,
    splatSeed: number,
  ): Vector3 | null {
    if (!this.textureLoaded || !this.texture) return null;

    const meshes = collectDecalTargetMeshes(victimRoot);
    if (meshes.length === 0) return null;

    const rnd = seededRandom(splatSeed >>> 0);
    victimRoot.updateMatrixWorld(true);

    const _m = new Matrix4();
    const _n = new Vector3();
    const _o = new Vector3();

    for (let attempt = 0; attempt < 8; attempt++) {
      const mesh = meshes[Math.floor(rnd() * meshes.length)]!;
      mesh.updateMatrixWorld(true);

      const box = new Box3().setFromObject(mesh);
      if (!box.isEmpty()) {
        const c = box.getCenter(new Vector3());
        const size = box.getSize(new Vector3());
        _o.copy(c).add(
          new Vector3(
            (rnd() - 0.5) * size.x * 0.85,
            (rnd() - 0.5) * size.y * 0.85,
            (rnd() - 0.5) * size.z * 0.85,
          ),
        );
      } else {
        mesh.getWorldPosition(_o);
      }

      _n.copy(_o).normalize();
      const rayDir = _n.clone().negate();
      const origin = _o.clone().addScaledVector(_n, 1.5);

      const raycaster = new Raycaster(origin, rayDir);
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length === 0) continue;

      const hit = hits[0]!;
      const hitMesh = hit.object as MeshT;
      const nWorld = hit.face!.normal.clone().transformDirection(hitMesh.matrixWorld).normalize();
      const zBias = 0.005 + rnd() * 0.014;
      const posW = hit.point.clone().addScaledVector(nWorld, zBias);

      const sizesXZ = 0.12 + rnd() * 0.1;
      const depth = 0.34 + rnd() * 0.16;
      const orientHelper = new Object3D();
      orientHelper.position.copy(posW);
      orientHelper.lookAt(posW.clone().add(nWorld));
      const orientation = new Euler().setFromQuaternion(orientHelper.quaternion, "XYZ");

      let decalGeo: DecalGeometry;
      try {
        decalGeo = new DecalGeometry(
          hitMesh,
          posW,
          orientation,
          new Vector3(sizesXZ, sizesXZ, depth),
        );
      } catch {
        continue;
      }

      if (!decalGeo.attributes.position || decalGeo.attributes.position.count < 3) {
        decalGeo.dispose();
        continue;
      }

      const filteredGeo = stripBackFaces(decalGeo, nWorld);
      if (!filteredGeo.attributes.position || filteredGeo.attributes.position.count < 3) {
        filteredGeo.dispose();
        continue;
      }

      const map = this.texture!.clone();
      map.colorSpace = SRGBColorSpace;

      const splatterIndex = this.splatters.length;
      const po = 6 + (splatterIndex % 20);
      const mat = new MeshBasicMaterial({
        map,
        color: decalTintColor(colorHex),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -po,
        polygonOffsetUnits: -po,
        alphaTest: 0.04,
        side: FrontSide,
      });

      const invWorld = _m.copy(victimRoot.matrixWorld).invert();
      filteredGeo.applyMatrix4(invWorld);

      const splat = new Mesh(filteredGeo, mat);
      splat.renderOrder = 470 + (splatterIndex % 60);
      victimRoot.add(splat);

      this.splatters.push({
        mesh: splat,
        mat,
        start: performance.now(),
      });
      return posW.clone();
    }
    return null;
  }

  private disposeProjectile(p: Projectile, index: number) {
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mat.dispose();
    this.projectiles.splice(index, 1);
  }

  update(dt: number) {
    const now = performance.now();
    const fadeMs = SPLATTER_LIFETIME_SEC * 1000;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      const step = p.speed * dt;
      p.traveled += step;
      const theta = p.traveled / p.r0;
      const r = p.r0;
      p.mesh.position
        .copy(p.rHat)
        .multiplyScalar(r * Math.cos(theta))
        .addScaledVector(p.wHat, r * Math.sin(theta));

      const tr = p.traveled / p.maxRange;
      const fade = Math.max(0, 1 - Math.pow(Math.min(1, tr), 1.15));
      p.mat.uniforms.uOpacity!.value = fade;

      if (p.traveled >= p.maxRange || fade <= 0.02) {
        this.disposeProjectile(p, i);
      }
    }

    this.splashPool.update(this.scene, dt);

    for (let i = this.splatters.length - 1; i >= 0; i--) {
      const s = this.splatters[i]!;
      const age = now - s.start;
      if (age >= fadeMs) {
        s.mesh.parent?.remove(s.mesh);
        s.mesh.geometry.dispose();
        const m = s.mat;
        m.map?.dispose?.();
        m.dispose();
        this.splatters.splice(i, 1);
      } else {
        const t = age / fadeMs;
        // Smooth ease — lingers near full opacity, then eases out over a long hold.
        s.mat.opacity = 1 - t * t * (3 - 2 * t);
      }
    }
  }

  dispose() {
    this.splashPool.dispose();
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mat.dispose();
    }
    this.projectiles.length = 0;
    for (const s of this.splatters) {
      s.mesh.parent?.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mat.map?.dispose?.();
      s.mat.dispose();
    }
    this.splatters.length = 0;
  }
}
