import {
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Vector3,
  type Camera,
} from "three";

const NUM_CURTAINS = 10;
const RING_RADIUS = 7;
const RING_HEIGHT = 9;
const CURTAIN_HEIGHT = 7;
const CURTAIN_WIDTH = 6;
const SEGMENTS_X = 64;
const SEGMENTS_Y = 24;

const auroraVert = `
uniform float uTime;
varying vec2 vUv;
varying float vWave;
varying float vHeight;

void main() {
  vUv = uv;
  vHeight = uv.y;

  vec3 pos = position;

  float wave1 = sin(pos.x * 0.6 + uTime * 0.3) * 0.4;
  float wave2 = sin(pos.x * 1.2 + uTime * 0.2 + 1.5) * 0.2;
  float wave3 = sin(pos.x * 0.3 + uTime * 0.15 + 3.0) * 0.6;
  float ripple = sin(pos.x * 3.0 + pos.y * 0.4 + uTime * 0.8) * 0.05;

  pos.z += (wave1 + wave2 + wave3 + ripple) * (0.3 + uv.y * 0.7);

  float sway = sin(pos.x * 0.25 + uTime * 0.1) * 0.3;
  pos.y += sway * uv.y;

  vWave = (wave1 + wave2) * 0.8;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const auroraFrag = `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
varying vec2 vUv;
varying float vWave;
varying float vHeight;

void main() {
  float curtainX = sin(vUv.x * 12.0 + uTime * 0.5) * 0.5 + 0.5;
  curtainX = pow(curtainX, 2.0);
  float curtainX2 = sin(vUv.x * 8.0 - uTime * 0.3 + 2.0) * 0.5 + 0.5;
  curtainX2 = pow(curtainX2, 3.0);
  float curtain = max(curtainX * 0.8, curtainX2 * 0.5);

  float shimmer = sin(vUv.x * 30.0 + vUv.y * 8.0 + uTime * 2.0) * 0.5 + 0.5;
  shimmer = shimmer * 0.2 + 0.8;

  float bottomFade = smoothstep(0.0, 0.2, vHeight);
  float topFade = 1.0 - smoothstep(0.5, 1.0, vHeight);
  float vertFade = bottomFade * topFade;

  float edgeFade = smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));

  float t = vUv.y + vWave * 0.3;
  vec3 col;
  if (t < 0.4) {
    col = mix(uColor1, uColor2, t / 0.4);
  } else {
    col = mix(uColor2, uColor3, (t - 0.4) / 0.6);
  }

  col += vec3(0.1, 0.15, 0.1) * shimmer * curtain;

  float a = curtain * vertFade * edgeFade * shimmer * uAlpha;
  a *= 0.55;

  gl_FragColor = vec4(col, a);
}
`;

interface CurtainDef {
  color1: [number, number, number];
  color2: [number, number, number];
  color3: [number, number, number];
  alpha: number;
  tilt: number;
  heightOffset: number;
}

const PALETTE: CurtainDef[] = [
  { color1: [0.1, 0.9, 0.3], color2: [0.1, 0.7, 0.6], color3: [0.3, 0.3, 0.9], alpha: 1.0, tilt: 0.1, heightOffset: 0 },
  { color1: [0.15, 0.8, 0.4], color2: [0.2, 0.5, 0.8], color3: [0.6, 0.2, 0.7], alpha: 0.8, tilt: 0.15, heightOffset: 0.5 },
  { color1: [0.2, 0.6, 0.9], color2: [0.4, 0.3, 0.8], color3: [0.7, 0.15, 0.5], alpha: 0.6, tilt: -0.08, heightOffset: -0.3 },
  { color1: [0.05, 0.95, 0.35], color2: [0.1, 0.85, 0.55], color3: [0.15, 0.5, 0.75], alpha: 0.7, tilt: 0.2, heightOffset: 0.8 },
  { color1: [0.3, 0.4, 0.9], color2: [0.5, 0.2, 0.8], color3: [0.8, 0.1, 0.4], alpha: 0.5, tilt: -0.12, heightOffset: 0.2 },
];

export class Aurora {
  readonly group: Group;
  private materials: ShaderMaterial[] = [];
  private timeUniforms: { value: number }[] = [];
  private alphaUniforms: { value: number }[] = [];
  private baseAlphas: number[] = [];
  private meshes: Mesh[] = [];
  private _camPos = new Vector3();
  private _radialUp = new Vector3();

  constructor() {
    this.group = new Group();

    for (let i = 0; i < NUM_CURTAINS; i++) {
      const cfg = PALETTE[i % PALETTE.length];
      const angle = (i / NUM_CURTAINS) * Math.PI * 2;

      const geo = new PlaneGeometry(CURTAIN_WIDTH, CURTAIN_HEIGHT, SEGMENTS_X, SEGMENTS_Y);

      const timeUniform = { value: i * 7.3 };
      this.timeUniforms.push(timeUniform);
      const alphaUniform = { value: cfg.alpha };
      this.alphaUniforms.push(alphaUniform);
      this.baseAlphas.push(cfg.alpha);

      const mat = new ShaderMaterial({
        vertexShader: auroraVert,
        fragmentShader: auroraFrag,
        uniforms: {
          uTime: timeUniform,
          uAlpha: alphaUniform,
          uColor1: { value: cfg.color1 },
          uColor2: { value: cfg.color2 },
          uColor3: { value: cfg.color3 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      this.materials.push(mat);

      const mesh = new Mesh(geo, mat);

      mesh.position.set(
        RING_RADIUS * Math.cos(angle),
        RING_HEIGHT + cfg.heightOffset,
        RING_RADIUS * Math.sin(angle),
      );

      mesh.frustumCulled = false;
      mesh.renderOrder = 999;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  update(dt: number, camera: Camera) {
    for (const u of this.timeUniforms) {
      u.value += dt;
    }

    camera.getWorldPosition(this._camPos);

    for (const mesh of this.meshes) {
      this._radialUp.copy(mesh.position).normalize();
      mesh.up.copy(this._radialUp);
      mesh.lookAt(this._camPos);
    }
  }

  setOpacity(weight: number) {
    for (let i = 0; i < this.alphaUniforms.length; i++) {
      this.alphaUniforms[i].value = this.baseAlphas[i] * weight;
    }
  }

  dispose() {
    this.group.traverse((child) => {
      if ((child as any).geometry) (child as any).geometry.dispose();
    });
    for (const mat of this.materials) mat.dispose();
  }
}
