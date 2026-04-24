import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Vector3,
  Color,
} from "three";

const trailVert = `
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const trailFrag = `
uniform vec3 color;
varying float vAlpha;
void main() {
  // Premultiplied alpha with additive blending
  gl_FragColor = vec4(color * vAlpha, vAlpha);
}
`;

const _dir = new Vector3();
const _toCamera = new Vector3();
const _cross = new Vector3();
const _fallback = new Vector3(0, 1, 0);

export class Trail {
  private points: Vector3[] = [];
  private lastCross = new Vector3(0, 1, 0);
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly mesh: Mesh;
  private length: number;
  private width: number;

  constructor(length = 72, width = 0.005, colorHex = 0xffffff) {
    this.length = length;
    this.width = width;

    const vertCount = length * 2;
    const posArray = new Float32Array(vertCount * 3);
    const alphaArray = new Float32Array(vertCount);

    this.posAttr = new BufferAttribute(posArray, 3);
    this.alphaAttr = new BufferAttribute(alphaArray, 1);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("alpha", this.alphaAttr);

    const indices: number[] = [];
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    this.geometry.setIndex(indices);

    const mat = new ShaderMaterial({
      vertexShader: trailVert,
      fragmentShader: trailFrag,
      uniforms: {
        color: { value: new Color(colorHex) },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
      toneMapped: false,
    });

    this.mesh = new Mesh(this.geometry, mat);
    this.mesh.frustumCulled = false;
  }

  /**
   * @param widthScale — multiplies ribbon width (e.g. taper 1→0 over projectile lifetime).
   */
  update(worldPos: Vector3, cameraPos: Vector3, widthScale = 1) {
    this.points.unshift(worldPos.clone());
    if (this.points.length > this.length) {
      this.points.length = this.length;
    }

    const positions = this.posAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const count = this.points.length;

    if (count < 2) {
      positions.fill(0);
      alphas.fill(0);
      this.posAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      return;
    }

    for (let i = 0; i < this.length; i++) {
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
      _dir.subVectors(this.points[prevIdx]!, this.points[nextIdx]!);

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

      const fade = 1 - i / this.length;
      const w = this.width * fade * widthScale;

      positions[i * 6] = p.x + _cross.x * w;
      positions[i * 6 + 1] = p.y + _cross.y * w;
      positions[i * 6 + 2] = p.z + _cross.z * w;
      positions[i * 6 + 3] = p.x - _cross.x * w;
      positions[i * 6 + 4] = p.y - _cross.y * w;
      positions[i * 6 + 5] = p.z - _cross.z * w;

      const a = fade * fade * 0.2;
      alphas[i * 2] = a;
      alphas[i * 2 + 1] = a;
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}