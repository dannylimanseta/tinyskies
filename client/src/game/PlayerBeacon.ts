/**
 * A soft vertical beam of light above a player, visible from afar.
 * Billboard quad that always faces the camera, fades at both ends.
 */
import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  AdditiveBlending,
  DoubleSide,
  Color,
  Camera,
  Vector3,
  Matrix4,
  Quaternion,
} from "three";

const BEAM_HEIGHT = 3.0;
const BEAM_WIDTH = 0.04;

const beaconVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const beaconFrag = `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float yFade = vUv.y * (1.0 - vUv.y) * 4.0;
  yFade = pow(yFade, 0.6);
  float xFade = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 2.0);
  float a = yFade * xFade * uAlpha * 0.35;
  gl_FragColor = vec4(uColor, a);
}
`;

const _camPos = new Vector3();
const _beamPos = new Vector3();
const _toCamera = new Vector3();
const _surfaceUp = new Vector3();
const _right = new Vector3();
const _forward = new Vector3();
const _mat = new Matrix4();

export class PlayerBeacon {
  readonly mesh: Mesh;
  private material: ShaderMaterial;

  constructor(color: number = 0xffffff) {
    const geom = new PlaneGeometry(BEAM_WIDTH, BEAM_HEIGHT, 1, 16);
    geom.translate(0, BEAM_HEIGHT * 0.5, 0);

    const col = new Color(color);
    this.material = new ShaderMaterial({
      vertexShader: beaconVert,
      fragmentShader: beaconFrag,
      uniforms: {
        uColor: { value: [col.r, col.g, col.b] },
        uAlpha: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });

    this.mesh = new Mesh(geom, this.material);
    this.mesh.frustumCulled = false;
  }

  setColor(hex: number) {
    const col = new Color(hex);
    this.material.uniforms.uColor.value = [col.r, col.g, col.b];
  }

  /** Multiplies beam intensity (0 = off), for remote player moon-cutscene fade. */
  setOpacityMultiplier(opacity: number) {
    this.material.uniforms.uAlpha.value = Math.max(0, Math.min(1, opacity));
  }

  /** Orient beam along surface normal, billboard around it to face camera. */
  update(camera: Camera) {
    camera.getWorldPosition(_camPos);
    _beamPos.copy(this.mesh.position);

    _surfaceUp.copy(_beamPos).normalize();

    _toCamera.subVectors(_camPos, _beamPos);
    _right.crossVectors(_surfaceUp, _toCamera);
    if (_right.lengthSq() < 1e-10) _right.set(1, 0, 0);
    _right.normalize();

    _forward.crossVectors(_right, _surfaceUp).normalize();

    _mat.makeBasis(_right, _surfaceUp, _forward);
    this.mesh.quaternion.setFromRotationMatrix(_mat);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
