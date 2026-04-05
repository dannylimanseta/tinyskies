import {
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  AdditiveBlending,
  Color,
} from "three";

const STAR_COUNT = 3000;
const BRIGHT_STAR_COUNT = 120;
const SPHERE_RADIUS = 80;

const starVert = `
attribute float aSize;
attribute float aBrightness;
varying float vBrightness;
void main() {
  vBrightness = aBrightness;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const starFrag = `
varying float vBrightness;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.4, d);
  float glow = 1.0 - smoothstep(0.2, 1.0, d);
  float a = (core * 0.8 + glow * 0.3) * vBrightness;
  vec3 col = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 1.0, 1.0), core);
  gl_FragColor = vec4(col, a);
}
`;

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class Starfield {
  readonly points: Points;
  private material: ShaderMaterial;

  constructor() {
    const rand = seededRandom(9999);
    const totalStars = STAR_COUNT + BRIGHT_STAR_COUNT;

    const positions = new Float32Array(totalStars * 3);
    const sizes = new Float32Array(totalStars);
    const brightnesses = new Float32Array(totalStars);

    for (let i = 0; i < totalStars; i++) {
      const theta = Math.acos(2 * rand() - 1);
      const phi = 2 * Math.PI * rand();
      const r = SPHERE_RADIUS;

      positions[i * 3] = r * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
      positions[i * 3 + 2] = r * Math.cos(theta);

      const isBright = i >= STAR_COUNT;
      if (isBright) {
        sizes[i] = 1.5 + rand() * 3.0;
        brightnesses[i] = 0.7 + rand() * 0.3;
      } else {
        sizes[i] = 0.3 + rand() * 1.2;
        brightnesses[i] = 0.15 + rand() * 0.45;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
    geo.setAttribute("aBrightness", new Float32BufferAttribute(brightnesses, 1));

    this.material = new ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
