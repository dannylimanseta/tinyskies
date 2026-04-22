import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  PointsMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { moveOnSphere, quaternionFromSurfaceNormal, seededRandom } from "./SphericalMath";
import type { Globe } from "./Globe";

const SPOUT_COUNT = 3;
const SPOUT_HEIGHT = 1.1;
const SPOUT_RADIUS_TOP = 0.175;
const SPOUT_RADIUS_BOT = 0.04;
const SPLASH_COUNT = 1500;
const SPLASH_LIFE = 0.6;

type Splash = {
  alive: boolean;
  age: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
};

function makeSplashTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(200,240,255,0.9)");
  g.addColorStop(0.5, "rgba(120,190,230,0.4)");
  g.addColorStop(1, "rgba(80,150,200,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class WaterSpouts {
  public readonly group = new Group();
  private spouts: {
    mesh: Mesh;
    q: Quaternion;
    heading: number;
    speed: number;
  }[] = [];
  private timeU = { value: 0 };
  private disposed = false;

  private splashPool: Splash[] = [];
  private splashGeo: BufferGeometry;
  private splashMat: PointsMaterial;
  private splashPosArray: Float32Array;
  private splashAlphaArray: Float32Array;
  private splashEmitAccum = 0;

  constructor(
    private readonly globe: Globe,
    private readonly seed: number,
  ) {
    const geo = new CylinderGeometry(SPOUT_RADIUS_TOP, SPOUT_RADIUS_BOT, SPOUT_HEIGHT, 24, 12, true);
    geo.translate(0, SPOUT_HEIGHT / 2, 0); // pivot at bottom

    const mat = new MeshBasicMaterial({
      color: 0xddffff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
    });
    mat.defines = { USE_UV: "" };

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.timeU;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
        uniform float time;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        
        // Twisting
        float twist = uv.y * 6.0 + time * 0.5;
        float s = sin(twist);
        float c = cos(twist);
        mat2 rot = mat2(c, -s, s, c);
        transformed.xz = rot * transformed.xz;
        
        // Swaying
        float swayX = sin(time * 2.1 + uv.y * 3.5) * 0.2 * uv.y;
        float swayZ = cos(time * 1.8 + uv.y * 4.2) * 0.2 * uv.y;
        transformed.x += swayX;
        transformed.z += swayZ;
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
        uniform float time;
        
        // Simple 2D noise
        vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
        float snoise(vec2 v){
          const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                   -0.577350269189626, 0.024390243902439);
          vec2 i  = floor(v + dot(v, C.yy) );
          vec2 x0 = v -   i + dot(i, C.xx);
          vec2 i1;
          i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod(i, 289.0);
          vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
            + i.x + vec3(0.0, i1.x, 1.0 ));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
          m = m*m ;
          m = m*m ;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
          vec3 g;
          g.x  = a0.x  * x0.x  + h.x  * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        
        // scrolling UVs
        vec2 suv = vUv;
        suv.x += time * 1.0; // spin speed
        suv.y -= time * 1.5; // updraft speed
        
        float n = snoise(suv * vec2(12.0, 4.0)) * 0.5 + 0.5;
        float n2 = snoise(suv * vec2(24.0, 8.0) - vec2(time * 0.5, time)) * 0.5 + 0.5;
        float combined = n * 0.7 + n2 * 0.3;
        
        // fade top and bottom
        float yFade = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
        
        // edge fade (fresnel-ish using uv.x)
        float edge = sin(vUv.x * 3.14159);
        edge = pow(edge, 0.6);
        
        // gradient: bottom white -> top cyan
        vec3 colorBot = vec3(1.0, 1.0, 1.0);
        vec3 colorTop = vec3(0.0, 0.8, 1.0);
        diffuseColor.rgb = mix(colorBot, colorTop, vUv.y);
        
        diffuseColor.a *= combined * yFade * edge * 1.8;
        `,
      );
    };

    const rnd = seededRandom(this.seed + 999);
    for (let i = 0; i < SPOUT_COUNT; i++) {
      let q = new Quaternion();
      let found = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const theta = rnd() * Math.PI * 2;
        const phi = Math.acos(2 * rnd() - 1);
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.sin(phi) * Math.sin(theta);
        const nz = Math.cos(phi);
        q = quaternionFromSurfaceNormal(nx, ny, nz);
        const normal = new Vector3(nx, ny, nz);

        if (this.globe.waterRatioAround(normal, 0.1, 8) > 0.8) {
          found = true;
          break;
        }
      }
      if (!found) continue;

      const mesh = new Mesh(geo, mat);
      mesh.quaternion.copy(q);
      const pos = new Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(this.globe.radius);
      mesh.position.copy(pos);

      this.group.add(mesh);
      this.spouts.push({
        mesh,
        q,
        heading: rnd() * Math.PI * 2,
        speed: 0.2 + rnd() * 0.2, // world units/sec
      });
    }

    // Splash particles
    for (let i = 0; i < SPLASH_COUNT; i++) {
      this.splashPool.push({ alive: false, age: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.splashPosArray = new Float32Array(SPLASH_COUNT * 3);
    this.splashAlphaArray = new Float32Array(SPLASH_COUNT);
    this.splashGeo = new BufferGeometry();
    this.splashGeo.setAttribute("position", new BufferAttribute(this.splashPosArray, 3));
    this.splashGeo.setAttribute("alpha", new BufferAttribute(this.splashAlphaArray, 1));

    this.splashMat = new PointsMaterial({
      map: makeSplashTexture(),
      color: 0xddffff,
      size: 0.04,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.splashMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
        attribute float alpha;
        varying float vAlpha;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vAlpha = alpha;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
        varying float vAlpha;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.a *= vAlpha;`
      );
    };

    const points = new Points(this.splashGeo, this.splashMat);
    points.frustumCulled = false;
    points.renderOrder = 100;
    this.group.add(points);
  }

  private emitSplash(origin: Vector3, radial: Vector3, count: number) {
    let emitted = 0;
    for (let i = 0; i < SPLASH_COUNT && emitted < count; i++) {
      const p = this.splashPool[i]!;
      if (!p.alive) {
        p.alive = true;
        p.age = 0;
        
        const angle = Math.random() * Math.PI * 2;
        const rad = Math.random() * SPOUT_RADIUS_BOT * 1.5;
        
        let ox = (Math.random() - 0.5);
        let oy = (Math.random() - 0.5);
        let oz = (Math.random() - 0.5);
        const offset = new Vector3(ox, oy, oz);
        offset.addScaledVector(radial, -offset.dot(radial));
        offset.normalize().multiplyScalar(rad);
        
        p.px = origin.x + offset.x;
        p.py = origin.y + offset.y;
        p.pz = origin.z + offset.z;
        
        const swirl = new Vector3().crossVectors(radial, offset).normalize();
        
        const upSpeed = 0.8 + Math.random() * 0.8;
        const swirlSpeed = 1.0 + Math.random() * 1.0;
        const outSpeed = 0.5 + Math.random() * 0.5;
        
        p.vx = radial.x * upSpeed + swirl.x * swirlSpeed + offset.x * outSpeed;
        p.vy = radial.y * upSpeed + swirl.y * swirlSpeed + offset.y * outSpeed;
        p.vz = radial.z * upSpeed + swirl.z * swirlSpeed + offset.z * outSpeed;
        
        emitted++;
      }
    }
  }

  private updateSplash(dt: number) {
    const pos = this.splashPosArray;
    const alphas = this.splashAlphaArray;
    
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const p = this.splashPool[i]!;
      if (!p.alive) {
        pos[i * 3] = 0;
        pos[i * 3 + 1] = 0;
        pos[i * 3 + 2] = 0;
        alphas[i] = 0;
        continue;
      }
      p.age += dt;
      if (p.age >= SPLASH_LIFE) {
        p.alive = false;
        pos[i * 3] = 0;
        pos[i * 3 + 1] = 0;
        pos[i * 3 + 2] = 0;
        alphas[i] = 0;
        continue;
      }
      
      // Gravity / inward pull
      p.vx -= p.px * 0.8 * dt;
      p.vy -= p.py * 0.8 * dt;
      p.vz -= p.pz * 0.8 * dt;
      
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      
      pos[i * 3] = p.px;
      pos[i * 3 + 1] = p.py;
      pos[i * 3 + 2] = p.pz;
      
      alphas[i] = 1.0 - (p.age / SPLASH_LIFE);
    }
    
    this.splashGeo.attributes.position!.needsUpdate = true;
    this.splashGeo.attributes.alpha!.needsUpdate = true;
  }

  update(dt: number) {
    if (this.disposed) return;
    this.timeU.value += dt;

    this.splashEmitAccum += dt;
    const emitCount = Math.floor(this.splashEmitAccum * 150); // 150 particles per second per spout
    if (emitCount > 0) {
      this.splashEmitAccum -= emitCount / 150;
    }

    // Slowly wander on the ocean
    for (const spout of this.spouts) {
      // Randomly adjust heading
      spout.heading += (Math.random() - 0.5) * dt * 0.5;
      
      // Move
      spout.q.copy(moveOnSphere(spout.q, spout.heading, (spout.speed * dt) / this.globe.radius));
      
      const normal = new Vector3(0, 1, 0).applyQuaternion(spout.q);
      
      // Bounce off land
      if (this.globe.waterRatioAround(normal, 0.05, 4) < 0.5) {
        spout.heading += Math.PI * dt * 2.0; // steer away smoothly
      }

      spout.mesh.quaternion.copy(spout.q);
      const pos = normal.clone().multiplyScalar(this.globe.radius);
      spout.mesh.position.copy(pos);

      if (emitCount > 0) {
        this.emitSplash(pos, normal, emitCount);
      }
    }

    this.updateSplash(dt);
  }

  public checkCollision(playerPos: Vector3, radius: number): boolean {
    if (this.disposed) return false;
    const pDir = playerPos.clone().normalize();
    for (const spout of this.spouts) {
      const sDir = new Vector3(0, 1, 0).applyQuaternion(spout.q);
      // Approximate surface distance ignoring altitude
      const dist = pDir.distanceTo(sDir) * this.globe.radius;
      if (dist < radius) {
        return true;
      }
    }
    return false;
  }

  public getClosestDistance(playerPos: Vector3): number {
    if (this.disposed || this.spouts.length === 0) return Infinity;
    const pDir = playerPos.clone().normalize();
    let minDist = Infinity;
    for (const spout of this.spouts) {
      const sDir = new Vector3(0, 1, 0).applyQuaternion(spout.q);
      const dist = pDir.distanceTo(sDir) * this.globe.radius;
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  }

  dispose() {
    this.disposed = true;
    for (const spout of this.spouts) {
      spout.mesh.geometry.dispose();
      (spout.mesh.material as MeshBasicMaterial).dispose();
    }
  }
}
