/**
 * Two golden ribbon trails that stream from the rear corners of the magic carpet.
 * Opacity scales with speed so the trails fade in as the carpet accelerates.
 */
import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Vector3,
  Matrix4,
  Group,
  Camera,
} from "three";

const TRAIL_LENGTH = 35;
const WIDTH = 0.004;

const vert = `
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = `
uniform float uSpeedAlpha;
varying float vAlpha;
void main() {
  vec3 color = vec3(0.95, 0.82, 0.3) * vAlpha * uSpeedAlpha;
  gl_FragColor = vec4(color, 1.0);
}
`;

const _dir = new Vector3();
const _toCamera = new Vector3();
const _cross = new Vector3();
const _fallback = new Vector3(0, 1, 0);

class GoldenRibbon {
  private points: Vector3[] = [];
  private lastCross = new Vector3(0, 1, 0);
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  constructor() {
    const vertCount = TRAIL_LENGTH * 2;
    const posArray = new Float32Array(vertCount * 3);
    const alphaArray = new Float32Array(vertCount);

    this.posAttr = new BufferAttribute(posArray, 3);
    this.alphaAttr = new BufferAttribute(alphaArray, 1);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("alpha", this.alphaAttr);

    const indices: number[] = [];
    for (let i = 0; i < TRAIL_LENGTH - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geometry.setIndex(indices);

    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uSpeedAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
      toneMapped: false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  update(worldPos: Vector3, cameraPos: Vector3) {
    this.points.unshift(worldPos.clone());
    if (this.points.length > TRAIL_LENGTH) {
      this.points.length = TRAIL_LENGTH;
    }

    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const count = this.points.length;

    for (let i = 0; i < TRAIL_LENGTH; i++) {
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

      const prevIdx = Math.max(i - 1, 0);
      const nextIdx = Math.min(i + 1, count - 1);
      _dir.subVectors(this.points[prevIdx], this.points[nextIdx]);

      if (_dir.lengthSq() < 1e-10) {
        _cross.copy(this.lastCross);
      } else {
        _dir.normalize();
        _toCamera.subVectors(cameraPos, p).normalize();
        _cross.crossVectors(_dir, _toCamera);
        if (_cross.lengthSq() < 1e-10) {
          _cross.crossVectors(_dir, _fallback);
        }
        _cross.normalize();
        this.lastCross.copy(_cross);
      }

      const fadeIn = Math.min(1, i / 8);
      const fadeOut = 1 - i / TRAIL_LENGTH;
      const w = WIDTH * fadeOut;

      positions[i * 6]     = p.x + _cross.x * w;
      positions[i * 6 + 1] = p.y + _cross.y * w;
      positions[i * 6 + 2] = p.z + _cross.z * w;
      positions[i * 6 + 3] = p.x - _cross.x * w;
      positions[i * 6 + 4] = p.y - _cross.y * w;
      positions[i * 6 + 5] = p.z - _cross.z * w;

      const a = fadeIn * fadeOut * fadeOut * 1.35;
      alphas[i * 2] = a;
      alphas[i * 2 + 1] = a;
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  reset() {
    this.points.length = 0;
    this.lastCross.set(0, 1, 0);
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

export class CarpetTrail {
  readonly group = new Group();
  private leftTrail: GoldenRibbon;
  private rightTrail: GoldenRibbon;

  /** Offsets in local carpet space — rear left and rear right tassels. */
  private leftOffset = new Vector3(-0.026, -0.015, 0.01);
  private rightOffset = new Vector3(0.026, -0.015, 0.01);

  constructor() {
    this.leftTrail = new GoldenRibbon();
    this.rightTrail = new GoldenRibbon();
    this.group.add(this.leftTrail.mesh);
    this.group.add(this.rightTrail.mesh);
  }

  update(carpetMatrix: Matrix4, camera: Camera, speedRatio: number) {
    const alpha = Math.max(0, Math.min(1, speedRatio * 1.5));
    this.leftTrail.material.uniforms.uSpeedAlpha.value = alpha;
    this.rightTrail.material.uniforms.uSpeedAlpha.value = alpha;

    const leftWorld = this.leftOffset.clone().applyMatrix4(carpetMatrix);
    const rightWorld = this.rightOffset.clone().applyMatrix4(carpetMatrix);
    const camPos = camera.getWorldPosition(new Vector3());

    this.leftTrail.update(leftWorld, camPos);
    this.rightTrail.update(rightWorld, camPos);
  }

  reset() {
    this.leftTrail.reset();
    this.rightTrail.reset();
  }

  dispose() {
    this.leftTrail.dispose();
    this.rightTrail.dispose();
  }
}
