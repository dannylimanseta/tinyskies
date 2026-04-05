import {
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  OrthographicCamera,
  Scene,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";

const LINE_COUNT = 24;
const SPEED_THRESHOLD = 0.8;
const MAX_SPEED = 1.5;
const BOOST_THRESHOLD = 1.2;

interface Streak {
  angle: number;
  length: number;
  offset: number;
  width: number;
  speed: number;
  life: number;
  maxLife: number;
  active: boolean;
}

const screenVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const screenFrag = `
uniform float opacity;
uniform float life;
varying vec2 vUv;
void main() {
  float taper = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  float halfW = taper * 0.35;
  float d = abs(vUv.y - 0.5);
  float shape = 1.0 - smoothstep(halfW * 0.3, halfW, d);
  float fade = smoothstep(0.0, 0.4, life) * smoothstep(1.0, 0.5, life);
  float a = shape * fade * opacity;
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}
`;

export class SpeedLines {
  readonly group = new Group();
  private streaks: Streak[] = [];
  private meshes: Mesh[] = [];
  private materials: ShaderMaterial[] = [];
  private geo: PlaneGeometry;
  private orthoScene: Scene;
  private orthoCamera: OrthographicCamera;
  private spawnTimer = 0;

  constructor() {
    this.geo = new PlaneGeometry(1, 1);
    this.orthoScene = new Scene();
    this.orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    for (let i = 0; i < LINE_COUNT; i++) {
      const mat = new ShaderMaterial({
        vertexShader: screenVert,
        fragmentShader: screenFrag,
        uniforms: {
          opacity: { value: 0 },
          life: { value: 0 },
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
      this.meshes.push(mesh);
      this.materials.push(mat);
      this.streaks.push({
        angle: 0, length: 0, offset: 0, width: 0,
        speed: 0, life: 0, maxLife: 0, active: false,
      });
    }
  }

  private spawn(idx: number) {
    const s = this.streaks[idx];
    s.angle = Math.random() * Math.PI * 2;
    s.length = 0.35 + Math.random() * 0.49;
    s.width = 0.006 + Math.random() * 0.008;
    s.offset = 0.95 + Math.random() * 0.15;
    s.speed = 0.5 + Math.random() * 0.8;
    s.maxLife = 0.3 + Math.random() * 0.4;
    s.life = 0;
    s.active = true;
  }

  update(dt: number, planeSpeed: number, _camera: PerspectiveCamera) {
    const speedFactor = Math.max(0, (planeSpeed - SPEED_THRESHOLD) / (MAX_SPEED - SPEED_THRESHOLD));

    if (speedFactor > 0) {
      this.spawnTimer += dt;
      const spawnRate = 0.02 + (1 - speedFactor) * 0.08;
      while (this.spawnTimer >= spawnRate) {
        this.spawnTimer -= spawnRate;
        for (let i = 0; i < this.streaks.length; i++) {
          if (!this.streaks[i].active) {
            this.spawn(i);
            break;
          }
        }
      }
    } else {
      this.spawnTimer = 0;
    }

    const globalOpacity = Math.min(1, speedFactor) * 0.35;

    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      const mesh = this.meshes[i];
      const mat = this.materials[i];

      if (!s.active) {
        mesh.visible = false;
        continue;
      }

      s.life += dt * s.speed;
      if (s.life >= s.maxLife) {
        s.active = false;
        mesh.visible = false;
        continue;
      }

      const lifeNorm = s.life / s.maxLife;
      const progress = lifeNorm * 0.15;
      const edgeDist = s.offset - progress;

      const cx = Math.cos(s.angle) * edgeDist;
      const cy = Math.sin(s.angle) * edgeDist;

      mesh.position.set(cx, cy, 0);
      mesh.rotation.z = s.angle + Math.PI;
      const boostMul = planeSpeed > BOOST_THRESHOLD
        ? 1 + 4 * Math.min(1, (planeSpeed - BOOST_THRESHOLD) / (MAX_SPEED - BOOST_THRESHOLD))
        : 1;
      mesh.scale.set(s.length, s.width * boostMul, 1);
      mesh.visible = true;

      mat.uniforms.opacity.value = globalOpacity;
      mat.uniforms.life.value = lifeNorm;
    }
  }

  render(renderer: WebGLRenderer) {
    let anyVisible = false;
    for (const m of this.meshes) {
      if (m.visible) { anyVisible = true; break; }
    }
    if (!anyVisible) return;

    renderer.autoClear = false;
    renderer.render(this.orthoScene, this.orthoCamera);
    renderer.autoClear = true;
  }

  dispose() {
    this.geo.dispose();
    for (const m of this.materials) m.dispose();
  }
}
