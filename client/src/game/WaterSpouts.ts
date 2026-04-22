import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Quaternion,
  Vector3,
} from "three";
import { moveOnSphere, quaternionFromSurfaceNormal, seededRandom } from "./SphericalMath";
import type { Globe } from "./Globe";

const SPOUT_COUNT = 8;
const SPOUT_HEIGHT = 2.2;
const SPOUT_RADIUS_TOP = 0.35;
const SPOUT_RADIUS_BOT = 0.08;

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

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.timeU;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
        uniform float time;
        varying vec2 vUv2;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vUv2 = uv;
        
        // Twisting
        float twist = uv.y * 6.0 + time * 1.5;
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
        varying vec2 vUv2;
        
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
        vec2 suv = vUv2;
        suv.x += time * 3.0; // fast spin
        suv.y -= time * 2.5; // fast updraft
        
        float n = snoise(suv * vec2(12.0, 4.0)) * 0.5 + 0.5;
        float n2 = snoise(suv * vec2(24.0, 8.0) - vec2(time * 0.5, time)) * 0.5 + 0.5;
        float combined = n * 0.7 + n2 * 0.3;
        
        // fade top and bottom
        float yFade = smoothstep(0.0, 0.1, vUv2.y) * smoothstep(1.0, 0.6, vUv2.y);
        
        // edge fade (fresnel-ish using uv.x)
        float edge = sin(vUv2.x * 3.14159);
        edge = pow(edge, 0.6);
        
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
        speed: 0.05 + rnd() * 0.05, // rad/sec
      });
    }
  }

  update(dt: number) {
    if (this.disposed) return;
    this.timeU.value += dt;

    // Slowly wander on the ocean
    for (const spout of this.spouts) {
      // Randomly adjust heading
      spout.heading += (Math.random() - 0.5) * dt * 0.5;
      
      // Move
      spout.q.copy(moveOnSphere(spout.q, spout.heading, (spout.speed * dt) / this.globe.radius));
      
      const normal = new Vector3(0, 1, 0).applyQuaternion(spout.q);
      
      // Bounce off land
      if (this.globe.waterRatioAround(normal, 0.05, 4) < 0.5) {
        spout.heading += Math.PI; // turn around
        spout.q.copy(moveOnSphere(spout.q, spout.heading, (spout.speed * dt * 2) / this.globe.radius));
      }

      spout.mesh.quaternion.copy(spout.q);
      spout.mesh.position.copy(normal.multiplyScalar(this.globe.radius));
    }
  }

  dispose() {
    this.disposed = true;
    for (const spout of this.spouts) {
      spout.mesh.geometry.dispose();
      (spout.mesh.material as MeshBasicMaterial).dispose();
    }
  }
}
