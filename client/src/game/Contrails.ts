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

/** Max ribbon segments per wing (~40% shorter than original for a tighter trail). */
const TRAIL_LENGTH = 72;
const WIDTH = 0.005;

const trailVert = `
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const trailFrag = `
varying float vAlpha;
void main() {
  // Additive glow with a very subtle icy blue tint
  vec3 color = vec3(0.9, 0.95, 1.0) * vAlpha;
  gl_FragColor = vec4(color, 1.0);
}
`;

const _dir = new Vector3();
const _toCamera = new Vector3();
const _cross = new Vector3();
const _fallback = new Vector3(0, 1, 0);

class Trail {
  private points: Vector3[] = [];
  private lastCross = new Vector3(0, 1, 0);
  private posAttr: BufferAttribute;
  private alphaAttr: BufferAttribute;
  private geometry: BufferGeometry;
  readonly mesh: Mesh;

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
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    this.geometry.setIndex(indices);

    const mat = new ShaderMaterial({
      vertexShader: trailVert,
      fragmentShader: trailFrag,
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

      const fade = 1 - i / TRAIL_LENGTH;
      const w = WIDTH * fade;

      positions[i * 6] = p.x + _cross.x * w;
      positions[i * 6 + 1] = p.y + _cross.y * w;
      positions[i * 6 + 2] = p.z + _cross.z * w;
      positions[i * 6 + 3] = p.x - _cross.x * w;
      positions[i * 6 + 4] = p.y - _cross.y * w;
      positions[i * 6 + 5] = p.z - _cross.z * w;

      const a = fade * fade * 0.55;
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

export class Contrails {
  readonly group = new Group();
  private leftTrail: Trail;
  private rightTrail: Trail;

  private leftOffset = new Vector3(-0.111, 0.035, -0.005);
  private rightOffset = new Vector3(0.111, 0.035, -0.005);

  constructor() {
    this.leftTrail = new Trail();
    this.rightTrail = new Trail();
    this.group.add(this.leftTrail.mesh);
    this.group.add(this.rightTrail.mesh);
  }

  update(planeMatrix: Matrix4, camera: Camera) {
    const leftWorld = this.leftOffset.clone().applyMatrix4(planeMatrix);
    const rightWorld = this.rightOffset.clone().applyMatrix4(planeMatrix);

    const camPos = camera.getWorldPosition(new Vector3());

    this.leftTrail.update(leftWorld, camPos);
    this.rightTrail.update(rightWorld, camPos);
  }

  dispose() {
    this.leftTrail.dispose();
    this.rightTrail.dispose();
  }
}
