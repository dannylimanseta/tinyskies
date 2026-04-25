import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Scene,
  OrthographicCamera,
  Vector3,
  Vector4,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";

const flareVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const circleFrag = `
uniform float opacity;
uniform vec3 color;
uniform float softness;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  float a = 1.0 - smoothstep(1.0 - softness, 1.0, d);
  gl_FragColor = vec4(color, a * opacity);
}
`;

const hexFrag = `
uniform float opacity;
uniform vec3 color;
varying vec2 vUv;
void main() {
  vec2 c = (vUv - 0.5) * 2.0;
  vec2 ac = abs(c);
  float hex = max(ac.x * 0.866 + ac.y * 0.5, ac.y);
  float a = 1.0 - smoothstep(0.7, 0.9, hex);
  gl_FragColor = vec4(color, a * opacity * 0.5);
}
`;

interface FlareElement {
  mesh: Mesh;
  material: ShaderMaterial;
  offset: number;
  size: number;
  baseColor: number[];
}

export class LensFlare {
  private orthoScene: Scene;
  private orthoCamera: OrthographicCamera;
  private elements: FlareElement[] = [];
  private sunWorldPos = new Vector3(10, 12, 5);
  private geo: PlaneGeometry;

  constructor() {
    this.orthoScene = new Scene();
    this.orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = new PlaneGeometry(1, 1);

    const defs: { frag: string; color: number[]; size: number; offset: number; uniforms?: Record<string, any> }[] = [
      { frag: circleFrag, color: [1.0, 0.95, 0.8], size: 0.45, offset: 0, uniforms: { softness: { value: 0.8 } } }, // Main sun glare, bigger and softer
      { frag: circleFrag, color: [1.0, 0.9, 0.6], size: 0.18, offset: 0.25, uniforms: { softness: { value: 0.7 } } }, // Secondary glare
      { frag: hexFrag, color: [0.8, 0.85, 1.0], size: 0.12, offset: 0.4 }, // Hex artifact 1
      { frag: circleFrag, color: [1.0, 0.85, 0.5], size: 0.08, offset: 0.7, uniforms: { softness: { value: 0.5 } } }, // Small glare
      { frag: hexFrag, color: [0.7, 0.9, 1.0], size: 0.15, offset: 0.85 }, // Hex artifact 2
      { frag: circleFrag, color: [1.0, 0.95, 0.9], size: 0.09, offset: 1.0, uniforms: { softness: { value: 0.8 } } }, // Edge glare
      { frag: hexFrag, color: [0.9, 0.7, 0.8], size: 0.06, offset: 1.2 }, // Extra hex artifact
      { frag: circleFrag, color: [0.6, 0.8, 1.0], size: 0.1, offset: 1.4, uniforms: { softness: { value: 0.6 } } }, // Extra blue glare
    ];

    for (const d of defs) {
      const mat = new ShaderMaterial({
        vertexShader: flareVert,
        fragmentShader: d.frag,
        uniforms: {
          opacity: { value: 0 },
          color: { value: d.color },
          ...d.uniforms,
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(this.geo, mat);
      mesh.visible = false;
      this.orthoScene.add(mesh);
      this.elements.push({ mesh, material: mat, offset: d.offset, size: d.size, baseColor: [...d.color] });
    }
  }

  setColorScale(scale: [number, number, number]) {
    for (const el of this.elements) {
      const c = el.material.uniforms.color.value as number[];
      c[0] = el.baseColor[0] * scale[0];
      c[1] = el.baseColor[1] * scale[1];
      c[2] = el.baseColor[2] * scale[2];
    }
  }

  update(camera: PerspectiveCamera) {
    const projected = this.sunWorldPos.clone().project(camera);
    const aspect = camera.aspect;

    const behindCamera = projected.z > 1;
    const onScreen = Math.abs(projected.x) < 1.4 && Math.abs(projected.y) < 1.4;
    const visible = !behindCamera && onScreen;

    const edgeDist = Math.max(Math.abs(projected.x), Math.abs(projected.y));
    const edgeFade = 1 - Math.max(0, (edgeDist - 0.8) / 0.6);
    const globalOpacity = visible ? Math.max(0, edgeFade) * 0.25 : 0;

    const sunX = projected.x;
    const sunY = projected.y;

    for (const el of this.elements) {
      if (globalOpacity <= 0) {
        el.mesh.visible = false;
        continue;
      }

      const t = el.offset;
      const ex = sunX * (1 - t * 2);
      const ey = sunY * (1 - t * 2);

      el.mesh.position.set(ex, ey, 0);
      el.mesh.scale.set(el.size / aspect, el.size, 1);
      el.mesh.visible = true;
      el.material.uniforms.opacity.value = globalOpacity;
    }
  }

  render(renderer: WebGLRenderer) {
    let anyVisible = false;
    for (const el of this.elements) {
      if (el.mesh.visible) { anyVisible = true; break; }
    }
    if (!anyVisible) return;

    renderer.autoClear = false;
    renderer.render(this.orthoScene, this.orthoCamera);
    renderer.autoClear = true;
  }

  dispose() {
    this.geo.dispose();
    for (const el of this.elements) el.material.dispose();
  }
}
