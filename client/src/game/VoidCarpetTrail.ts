/**
 * Wide, flat white glow ribbon on the void “sky” — follows the carpet path on the
 * globe tangent (not camera-facing), additive so it reads as soft light.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

const TRAIL_LENGTH = 52;
/** 35% of original half-width (65% narrower). */
const HALF_WIDTH = 0.042;

const vert = `
attribute float alpha;
attribute float aU;
attribute float aAlong;
varying float vAlpha;
varying float vU;
varying float vAlong;
void main() {
  vAlpha = alpha;
  vU = aU;
  vAlong = aAlong;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = `
uniform float uSpeedAlpha;
varying float vAlpha;
varying float vU;
varying float vAlong;
void main() {
  float t = abs(vU);
  float core = exp(-t * t * 1.1);
  float halo = exp(-t * t * 0.28) * 0.45;
  float a = vAlpha * uSpeedAlpha * (core * 0.9 + halo);
  if (a < 0.012) discard;
  // Bluish (leading) to purple (trailing) along the ribbon, bright at core
  vec3 cBlue = vec3(0.32, 0.62, 0.98);
  vec3 cPurp = vec3(0.58, 0.28, 0.95);
  vec3 grad = mix(cBlue, cPurp, vAlong);
  float edge = 0.78 + 0.22 * core;
  gl_FragColor = vec4(grad * edge, a);
}
`;

const _dir = new Vector3();
const _radial = new Vector3();
const _bit = new Vector3();
const _fallback = new Vector3(0, 0, 1);

class WhiteRibbon {
  private points: Vector3[] = [];
  private lastBit = new Vector3(0, 1, 0);
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private aUAttr: BufferAttribute;
  private aAlongAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  constructor() {
    const vertCount = TRAIL_LENGTH * 2;
    const posArray = new Float32Array(vertCount * 3);
    const alphaArray = new Float32Array(vertCount);
    const aU = new Float32Array(vertCount);
    const aAlong = new Float32Array(vertCount);
    const n1 = TRAIL_LENGTH - 1;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const al = n1 > 0 ? i / n1 : 0.0;
      aU[i * 2] = -1;
      aU[i * 2 + 1] = 1;
      aAlong[i * 2] = al;
      aAlong[i * 2 + 1] = al;
    }

    this.posAttr = new BufferAttribute(posArray, 3);
    this.alphaAttr = new BufferAttribute(alphaArray, 1);
    this.aUAttr = new BufferAttribute(aU, 1);
    this.aAlongAttr = new BufferAttribute(aAlong, 1);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("alpha", this.alphaAttr);
    this.geometry.setAttribute("aU", this.aUAttr);
    this.geometry.setAttribute("aAlong", this.aAlongAttr);

    const indices: number[] = [];
    for (let i = 0; i < TRAIL_LENGTH - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geometry.setIndex(indices);

    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uSpeedAlpha: { value: 0.75 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
  }

  update(worldPos: Vector3) {
    this.points.unshift(worldPos.clone());
    if (this.points.length > TRAIL_LENGTH) {
      this.points.length = TRAIL_LENGTH;
    }

    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const count = this.points.length;
    const halfW = HALF_WIDTH;
    const aAlongBuf = this.aAlongAttr.array as Float32Array;
    const nSeg = TRAIL_LENGTH - 1;

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const along = nSeg > 0 ? i / nSeg : 0;
      aAlongBuf[i * 2] = along;
      aAlongBuf[i * 2 + 1] = along;
      const p = this.points[i];
      if (!p) {
        positions[i * 6] = 0;
        positions[i * 6 + 1] = 0;
        positions[i * 6 + 2] = 0;
        positions[i * 6 + 3] = 0;
        positions[i * 6 + 4] = 0;
        positions[i * 6 + 5] = 0;
        alphas[i * 2] = 0;
        alphas[i * 2 + 1] = 0;
        continue;
      }

      _radial.copy(p).normalize();

      const prevIdx = Math.max(i - 1, 0);
      const nextIdx = Math.min(i + 1, count - 1);
      _dir.subVectors(this.points[prevIdx]!, this.points[nextIdx]!);

      if (count < 2 || _dir.lengthSq() < 1e-10) {
        _bit.set(0, 1, 0).cross(_radial);
        if (_bit.lengthSq() < 1e-8) {
          _bit.set(1, 0, 0).cross(_radial);
        }
        _bit.normalize();
        this.lastBit.copy(_bit);
      } else {
        _dir.normalize();
        _bit.crossVectors(_radial, _dir);
        if (_bit.lengthSq() < 1e-8) {
          _bit.crossVectors(_radial, _fallback);
        }
        _bit.normalize();
        this.lastBit.copy(_bit);
      }

      const fadeIn = Math.min(1, i / 5);
      const fadeOut = 1 - i / TRAIL_LENGTH;
      const w = halfW * fadeOut * (0.85 + 0.15 * fadeIn);

      positions[i * 6] = p.x + _bit.x * w;
      positions[i * 6 + 1] = p.y + _bit.y * w;
      positions[i * 6 + 2] = p.z + _bit.z * w;
      positions[i * 6 + 3] = p.x - _bit.x * w;
      positions[i * 6 + 4] = p.y - _bit.y * w;
      positions[i * 6 + 5] = p.z - _bit.z * w;

      const a = fadeIn * fadeOut * fadeOut * 0.7;
      alphas[i * 2] = a;
      alphas[i * 2 + 1] = a;
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.aAlongAttr.needsUpdate = true;
  }

  reset() {
    this.points.length = 0;
    this.lastBit.set(0, 1, 0);
    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    positions.fill(0);
    alphas.fill(0);
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * One broad ribbon from the carpet’s rear center; reads as a luminous wake in the void.
 */
export class VoidCarpetTrail {
  readonly group = new Group();
  private trail: WhiteRibbon;
  private readonly centerOffset = new Vector3(0, -0.01, -0.06);

  constructor() {
    this.trail = new WhiteRibbon();
    this.group.add(this.trail.mesh);
    this.group.visible = false;
  }

  update(carpetMatrix: Matrix4, _camera: Camera, speedRatio: number) {
    const alpha = Math.max(0.2, Math.min(1, 0.25 + speedRatio * 0.9));
    this.trail.material.uniforms.uSpeedAlpha.value = alpha;
    const world = this.centerOffset.clone().applyMatrix4(carpetMatrix);
    this.trail.update(world);
  }

  reset() {
    this.trail.reset();
  }

  dispose() {
    this.group.removeFromParent();
    this.trail.dispose();
  }
}
