import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Euler,
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

    const sock = this.getSocket();
    if (sock?.connected) {
      sock.emitPaintballFire();
      /** Projectile + color come from server `paintball:fired` (matches splatter on hit). */
      return;
    }

    const myId = this.getSocketId() ?? "local";
    const color =
      PAINTBALL_COLOR_PALETTE[
        Math.floor(Math.random() * PAINTBALL_COLOR_PALETTE.length)
      ]!;
    this.spawnProjectile({
      shooterId: myId,
      color,
      ox: ray.origin.x,
      oy: ray.origin.y,
      oz: ray.origin.z,
      dx: ray.direction.x,
      dy: ray.direction.y,
      dz: ray.direction.z,
      speed: PAINTBALL_SPEED,
    });
  }

  onPaintballFired(ev: PaintballFiredEvent) {
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
  }) {
    const o = new Vector3(ev.ox, ev.oy, ev.oz);
    const r0 = Math.max(1e-4, o.length());
    const rHat = o.clone().divideScalar(r0);
    let wHat = new Vector3(ev.dx, ev.dy, ev.dz);
    wHat.sub(rHat.clone().multiplyScalar(wHat.dot(rHat)));
    if (wHat.lengthSq() < 1e-8) return;
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

    let splatWorld = this.addSplatterDecal(victimRoot, ev.color, ev.splatSeed);
    if (!splatWorld) {
      victimRoot.updateMatrixWorld(true);
      splatWorld = victimRoot.getWorldPosition(new Vector3());
    }
    this.splashPool.play(this.scene, splatWorld, ev.color, ev.splatSeed);
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
      const posW = hit.point.clone().addScaledVector(nWorld, 0.004);

      const sizesXZ = 0.12 + rnd() * 0.1;
      const depth = 0.42;
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

      const map = this.texture!.clone();
      map.colorSpace = SRGBColorSpace;

      const mat = new MeshBasicMaterial({
        map,
        color: new Color(colorHex),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        alphaTest: 0.08,
        side: DoubleSide,
      });

      const invWorld = _m.copy(victimRoot.matrixWorld).invert();
      decalGeo.applyMatrix4(invWorld);

      const splat = new Mesh(decalGeo, mat);
      splat.renderOrder = 480;
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
        s.mat.opacity = 1 - age / fadeMs;
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
