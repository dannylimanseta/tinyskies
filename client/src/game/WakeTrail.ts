/**
 * Two V-shaped foam wake trails behind a boat.
 * Same ribbon-trail technique as Contrails but wider, shorter, and white/aqua tinted.
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

const TRAIL_LENGTH = 90;
const WIDTH = 0.006;

const wakeVert = `
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const wakeFrag = `
varying float vAlpha;
void main() {
  vec3 color = vec3(0.85, 0.95, 1.0) * vAlpha;
  gl_FragColor = vec4(color, 1.0);
}
`;

const _dir = new Vector3();
const _toCamera = new Vector3();
const _cross = new Vector3();
const _fallback = new Vector3(0, 1, 0);

class WakeRibbon {
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
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geometry.setIndex(indices);

    const mat = new ShaderMaterial({
      vertexShader: wakeVert,
      fragmentShader: wakeFrag,
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

      positions[i * 6]     = p.x + _cross.x * w;
      positions[i * 6 + 1] = p.y + _cross.y * w;
      positions[i * 6 + 2] = p.z + _cross.z * w;
      positions[i * 6 + 3] = p.x - _cross.x * w;
      positions[i * 6 + 4] = p.y - _cross.y * w;
      positions[i * 6 + 5] = p.z - _cross.z * w;

      const a = fade * fade * 0.95;
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

export class WakeTrail {
  readonly group = new Group();
  private leftTrail: WakeRibbon;
  private rightTrail: WakeRibbon;

  /** Offsets in local boat space — port and starboard stern quarters. */
  private leftOffset = new Vector3(-0.022, -0.005, 0.075);
  private rightOffset = new Vector3(0.022, -0.005, 0.075);

  constructor() {
    this.leftTrail = new WakeRibbon();
    this.rightTrail = new WakeRibbon();
    this.group.add(this.leftTrail.mesh);
    this.group.add(this.rightTrail.mesh);
  }

  update(boatMatrix: Matrix4, camera: Camera) {
    const leftWorld = this.leftOffset.clone().applyMatrix4(boatMatrix);
    const rightWorld = this.rightOffset.clone().applyMatrix4(boatMatrix);
    const camPos = camera.getWorldPosition(new Vector3());

    this.leftTrail.update(leftWorld, camPos);
    this.rightTrail.update(rightWorld, camPos);
  }

  dispose() {
    this.leftTrail.dispose();
    this.rightTrail.dispose();
  }
}
