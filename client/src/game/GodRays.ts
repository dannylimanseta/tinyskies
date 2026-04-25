import {
  AdditiveBlending,
  Camera,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

const vert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = `
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  // Center UV at (0,0)
  vec2 uv = vUv * 2.0 - 1.0;
  float dist = length(uv);

  // Don't render past the billboard radius
  if (dist > 1.0) discard;

  // Polar angle, slowly rotates over time
  float angle = atan(uv.y, uv.x) / (2.0 * 3.14159265);
  float animAngle = angle + uTime * 0.018;

  // Two noise layers at different angular frequencies create distinct spaced rays
  float n1 = noise2(vec2(animAngle * 14.0, dist * 2.5 + uTime * 0.06));
  float n2 = noise2(vec2(animAngle * 9.0 + 0.37, dist * 3.5 - uTime * 0.05));

  // Sharp rays with high pow
  float rays = pow(max(0.0, n1 * n2), 2.2) * 10.0;

  // Brighter near center, fades to 0 toward the outer edge
  float radialFade = pow(1.0 - smoothstep(0.0, 1.0, dist), 2.0);

  // Hide the hard center point (the visible "source")
  float centerFade = smoothstep(0.0, 0.08, dist);

  float a = rays * radialFade * centerFade * uIntensity;

  gl_FragColor = vec4(uColor * a, a);
}
`;

const _toSun = new Vector3();
const _camForward = new Vector3();

export class GodRays {
  readonly group = new Group();
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly colorUniform = { value: new Color() };
  private readonly intensityUniform = { value: 0.0 };

  constructor() {
    // Large quad billboard — we'll scale it in update() based on distance to sun
    const geo = new PlaneGeometry(1, 1);

    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTime: { value: 0 },
        uColor: this.colorUniform,
        uIntensity: this.intensityUniform,
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false, // Always draw on top — pure additive so it never looks wrong
    });

    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999; // Draw after everything else

    this.group.add(this.mesh);
  }

  update(time: number, camera: Camera, sunPos: Vector3, color: number, sunIntensity: number) {
    this.material.uniforms.uTime.value = time;
    this.colorUniform.value.set(color);

    // Check if sun is in front of camera — fade out when behind
    camera.getWorldDirection(_camForward);
    _toSun.copy(sunPos).sub(camera.position).normalize();
    const sunDot = _toSun.dot(_camForward);

    // Smoothly fade in as sun enters the front hemisphere
    const facingFactor = Math.max(0, sunDot); // 0 when behind, 1 when directly in front
    this.intensityUniform.value = sunIntensity * 0.28 * facingFactor;

    // Place the billboard at the sun position, facing the camera
    this.group.position.copy(sunPos);
    this.group.quaternion.copy(camera.quaternion);

    // Scale it big enough to cover a nice area of sky around the sun
    const distToSun = camera.position.distanceTo(sunPos);
    const scale = distToSun * 1.4; // Cover a wide cone of sky
    this.mesh.scale.setScalar(scale);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
