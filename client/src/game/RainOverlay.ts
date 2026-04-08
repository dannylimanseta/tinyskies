import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Scene,
  OrthographicCamera,
  DataTexture,
  FramebufferTexture,
  RepeatWrapping,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  type WebGLRenderer,
} from "three";

/* ── Config ─────────────────────────────────────────────────────────── */

const STREAK_COUNT = 50;
const WIND_ANGLE = 0.35;
const ANGLE_JITTER = 0.09;
const NOISE_SIZE = 256;

/* ── Rain streak shaders ────────────────────────────────────────────── */

const streakVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const streakFrag = `
uniform float opacity;
varying vec2 vUv;
void main() {
  float along = vUv.y;
  float taper = smoothstep(0.0, 0.15, along) * smoothstep(1.0, 0.7, along);
  float across = abs(vUv.x - 0.5) * 2.0;
  float shape = (1.0 - smoothstep(0.0, 1.0, across)) * taper;
  gl_FragColor = vec4(0.75, 0.8, 0.88, shape * opacity);
}
`;

/* ── Glass droplets shader (adapted from Shadertoy) ─────────────────── */

const glassVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const glassFrag = `
uniform sampler2D sceneTex;
uniform sampler2D noiseTex;
uniform vec2 resolution;
uniform float time;
uniform float opacity;

varying vec2 vUv;

void main() {
  vec2 u = vUv;
  vec2 n = texture2D(noiseTex, u * 0.1).rg;

  vec4 original = texture2D(sceneTex, u);
  vec4 f = original;

  for (float r = 4.0; r > 0.0; r -= 1.0) {
    vec2 x = resolution * r * 0.009;
    vec2 nShift = (n - 0.5) * 0.8 / 6.28318;

    vec2 cellCoord = floor(u * x + nShift + 0.25) / x;
    vec4 d = texture2D(noiseTex, cellCoord);

    vec2 p = 6.28318 * u * x + (n - 0.5) * 0.8;
    vec2 s = sin(p);

    float t = (s.x + s.y) * max(0.0, 1.0 - fract(time * (d.b + 0.1) * 0.45 + d.g) * 1.4);

    if (d.r < (5.0 - r) * 0.056 && t > 0.5) {
      vec3 v = normalize(-vec3(cos(p), mix(0.2, 2.0, t - 0.5)));
      f = texture2D(sceneTex, u - v.xy * 0.4);
    }
  }

  gl_FragColor = vec4(mix(original.rgb, f.rgb, opacity), 1.0);
}
`;

/* ── Streak state ───────────────────────────────────────────────────── */

interface RainStreak {
  x: number;
  y: number;
  speed: number;
  length: number;
  width: number;
  angle: number;
  active: boolean;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function createNoiseTexture(): DataTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  const tex = new DataTexture(data, NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const _size = new Vector2();

/* ── RainOverlay class ──────────────────────────────────────────────── */

export class RainOverlay {
  private streakScene: Scene;
  private glassScene: Scene;
  private orthoCamera: OrthographicCamera;
  private geo: PlaneGeometry;

  private streaks: RainStreak[] = [];
  private streakMeshes: Mesh[] = [];
  private streakMats: ShaderMaterial[] = [];

  private glassMesh: Mesh;
  private glassMat: ShaderMaterial;
  private glassGeo: PlaneGeometry;

  private noiseTex: DataTexture;
  private sceneTex: FramebufferTexture;
  private bufW = 0;
  private bufH = 0;

  private currentWeight = 0;
  private time = 0;

  constructor() {
    this.streakScene = new Scene();
    this.glassScene = new Scene();
    this.orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = new PlaneGeometry(1, 1);

    for (let i = 0; i < STREAK_COUNT; i++) {
      const mat = new ShaderMaterial({
        vertexShader: streakVert,
        fragmentShader: streakFrag,
        uniforms: { opacity: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(this.geo, mat);
      mesh.visible = false;
      this.streakScene.add(mesh);
      this.streakMeshes.push(mesh);
      this.streakMats.push(mat);
      this.streaks.push({
        x: 0, y: 0, speed: 0, length: 0, width: 0,
        angle: 0, active: false,
      });
    }

    this.noiseTex = createNoiseTexture();
    this.sceneTex = new FramebufferTexture(1, 1);
    this.sceneTex.minFilter = LinearFilter;
    this.sceneTex.magFilter = LinearFilter;

    this.glassGeo = new PlaneGeometry(2, 2);
    this.glassMat = new ShaderMaterial({
      vertexShader: glassVert,
      fragmentShader: glassFrag,
      uniforms: {
        sceneTex: { value: this.sceneTex },
        noiseTex: { value: this.noiseTex },
        resolution: { value: new Vector2(1, 1) },
        time: { value: 0 },
        opacity: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.glassMesh = new Mesh(this.glassGeo, this.glassMat);
    this.glassMesh.visible = false;
    this.glassScene.add(this.glassMesh);
  }

  private ensureSize(renderer: WebGLRenderer) {
    renderer.getDrawingBufferSize(_size);
    if (_size.x === this.bufW && _size.y === this.bufH) return;
    this.bufW = _size.x;
    this.bufH = _size.y;
    this.sceneTex.dispose();
    this.sceneTex = new FramebufferTexture(this.bufW, this.bufH);
    this.sceneTex.minFilter = LinearFilter;
    this.sceneTex.magFilter = LinearFilter;
    this.glassMat.uniforms.sceneTex.value = this.sceneTex;
    this.glassMat.uniforms.resolution.value.set(this.bufW, this.bufH);
  }

  private spawnStreak(idx: number) {
    const s = this.streaks[idx];
    s.angle = -WIND_ANGLE + (Math.random() - 0.5) * 2 * ANGLE_JITTER;
    s.length = 0.08 + Math.random() * 0.14;
    s.width = 0.0015 + Math.random() * 0.0015;
    s.speed = 1.8 + Math.random() * 1.4;
    s.x = (Math.random() - 0.5) * 2.6;
    s.y = 1.15 + Math.random() * 0.3;
    s.active = true;
  }

  update(dt: number, rainWeight: number) {
    this.currentWeight = rainWeight;
    if (rainWeight <= 0) {
      for (let i = 0; i < STREAK_COUNT; i++) {
        this.streaks[i].active = false;
        this.streakMeshes[i].visible = false;
      }
      this.glassMesh.visible = false;
      return;
    }

    this.time += dt;
    const intensity = rainWeight;
    const spawnChance = intensity * 0.85;

    for (let i = 0; i < STREAK_COUNT; i++) {
      const s = this.streaks[i];

      if (!s.active) {
        if (Math.random() < spawnChance * dt * 30) {
          this.spawnStreak(i);
        }
        continue;
      }

      const dx = Math.sin(s.angle) * s.speed * dt;
      const dy = -Math.cos(s.angle) * s.speed * dt;
      s.x += dx;
      s.y += dy;

      if (s.y < -1.3) {
        s.active = false;
        this.streakMeshes[i].visible = false;
        continue;
      }

      const mesh = this.streakMeshes[i];
      mesh.position.set(s.x, s.y, 0);
      mesh.rotation.z = s.angle;
      mesh.scale.set(s.width, s.length, 1);
      mesh.visible = true;
      this.streakMats[i].uniforms.opacity.value = intensity * 0.35;
    }

    this.glassMat.uniforms.time.value = this.time;
    this.glassMat.uniforms.opacity.value = intensity;
    this.glassMesh.visible = true;
  }

  render(renderer: WebGLRenderer) {
    if (this.currentWeight <= 0) return;

    this.ensureSize(renderer);

    if (this.glassMesh.visible) {
      renderer.copyFramebufferToTexture(this.sceneTex);
    }

    renderer.autoClear = false;

    if (this.glassMesh.visible) {
      renderer.render(this.glassScene, this.orthoCamera);
    }

    let anyStreakVisible = false;
    for (const m of this.streakMeshes) {
      if (m.visible) { anyStreakVisible = true; break; }
    }
    if (anyStreakVisible) {
      renderer.render(this.streakScene, this.orthoCamera);
    }

    renderer.autoClear = true;
  }

  dispose() {
    this.geo.dispose();
    this.glassGeo.dispose();
    this.glassMat.dispose();
    this.noiseTex.dispose();
    this.sceneTex.dispose();
    for (const m of this.streakMats) m.dispose();
  }
}
