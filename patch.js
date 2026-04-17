const fs = require('fs');

const file = 'client/src/game/MeteorShower.ts';
let code = fs.readFileSync(file, 'utf-8');

code = code.replace(
  'RingGeometry,\n  SphereGeometry,',
  'RingGeometry,\n  ShaderMaterial,\n  SphereGeometry,'
);

const noiseGLSL = `
float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0,0.0,0.0)), f.x),
        mix(hash3(i + vec3(0.0,1.0,0.0)), hash3(i + vec3(1.0,1.0,0.0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0.0,0.0,1.0)), hash3(i + vec3(1.0,0.0,1.0)), f.x),
        mix(hash3(i + vec3(0.0,1.0,1.0)), hash3(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}
`;

const shaders = `
const noiseGLSL = \`${noiseGLSL}\`;

const trailVert = \`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
const trailFrag = \`
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
\${noiseGLSL}
void main() {
  float fade = 1.0 - vUv.y;
  float n = noise3(vec3(vUv.x * 12.0, vUv.y * 6.0 - uTime * 15.0, uTime * 2.0));
  float core = smoothstep(0.2, 0.8, fade) * smoothstep(0.1, 0.9, n);
  vec3 col = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.9, 0.3), core);
  float alpha = smoothstep(0.0, 0.3, fade) * n * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
\`;

const flashVert = \`
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
const flashFrag = \`
uniform float uProgress;
uniform float uTime;
varying vec3 vPos;
\${noiseGLSL}
void main() {
  float n = noise3(normalize(vPos) * 6.0 + uTime * 5.0);
  float erode = smoothstep(uProgress - 0.2, uProgress + 0.1, n);
  vec3 col = mix(vec3(0.8, 0.1, 0.0), vec3(1.0, 0.8, 0.2), erode);
  float alpha = erode * (1.0 - uProgress);
  gl_FragColor = vec4(col, alpha);
}
\`;

const shockwaveVert = \`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
const shockwaveFrag = \`
varying vec2 vUv;
uniform float uOpacity;
uniform float uInnerR;
uniform float uOuterR;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float ringMid = (uInnerR + uOuterR) * 0.5;
  float ringW = (uOuterR - uInnerR) * 0.5;
  float ring = 1.0 - smoothstep(0.0, ringW, abs(d - ringMid));
  vec3 col = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.8, 0.3), smoothstep(uInnerR, uOuterR, d));
  gl_FragColor = vec4(col, ring * uOpacity);
}
\`;

type MeteorState = {
`;

code = code.replace('type MeteorState = {', shaders);

code = code.replace('trailMat: MeshBasicMaterial;', 'trailMat: ShaderMaterial;');
code = code.replace('shockwaveMat: MeshBasicMaterial;', 'shockwaveMat: ShaderMaterial;');
code = code.replace('flashMat: MeshBasicMaterial;', 'flashMat: ShaderMaterial;');

code = code.replace('const _refForward = new Vector3(0, 1, 0);', 'const _trailForward = new Vector3(0, -1, 0);');

code = code.replace(
  `    const trailMat = new MeshBasicMaterial({
      color: 0xff9c42,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });`,
  `    const trailMat = new ShaderMaterial({
      vertexShader: trailVert,
      fragmentShader: trailFrag,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });`
);

code = code.replace(
  `new ConeGeometry(METEOR_TRAIL_RADIUS, METEOR_TRAIL_LENGTH, 10, 1, false)`,
  `new ConeGeometry(METEOR_TRAIL_RADIUS, METEOR_TRAIL_LENGTH, 16, 4, true)`
);

code = code.replace(
  `    const shockwaveMat = new MeshBasicMaterial({
      color: 0xff9f57,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });`,
  `    const shockwaveMat = new ShaderMaterial({
      vertexShader: shockwaveVert,
      fragmentShader: shockwaveFrag,
      uniforms: {
        uOpacity: { value: 0 },
        uInnerR: { value: 0 },
        uOuterR: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });`
);

code = code.replace(
  `    const flashMat = new MeshBasicMaterial({
      color: 0xffe0a3,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });`,
  `    const flashMat = new ShaderMaterial({
      vertexShader: flashVert,
      fragmentShader: flashFrag,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });`
);

code = code.replace(
  `const flash = new Mesh(new SphereGeometry(0.16, 10, 8), flashMat);`,
  `const flash = new Mesh(new SphereGeometry(0.16, 16, 12), flashMat);`
);

code = code.replace(
  `    meteor.shockwaveMat.opacity = 0;
    meteor.flashMat.opacity = 0;`,
  `    meteor.shockwaveMat.uniforms.uOpacity.value = 0;
    meteor.flashMat.uniforms.uProgress.value = 1;`
);

code = code.replace(
  `meteor.trail.quaternion.setFromUnitVectors(_refForward, meteor.dir);
        meteor.trail.scale.setScalar(1);
        meteor.trailMat.opacity = MathUtils.lerp(0.28, 0.42, 1 - rawT);`,
  `meteor.trail.quaternion.setFromUnitVectors(_trailForward, meteor.dir);
        meteor.trail.scale.setScalar(1);
        meteor.trailMat.uniforms.uTime.value = this.time;
        meteor.trailMat.uniforms.uOpacity.value = MathUtils.lerp(0.4, 0.95, 1 - rawT);`
);

code = code.replace(
  `meteor.flashMat.opacity = (1 - flashT) * 0.8;`,
  `meteor.flashMat.uniforms.uTime.value = this.time;
      meteor.flashMat.uniforms.uProgress.value = flashT;`
);

code = code.replace(
  `meteor.shockwaveMat.opacity = (1 - waveT * waveT) * 0.72;`,
  `meteor.shockwaveMat.uniforms.uInnerR.value = Math.max(0, waveT - 0.2);
      meteor.shockwaveMat.uniforms.uOuterR.value = waveT;
      meteor.shockwaveMat.uniforms.uOpacity.value = (1 - waveT * waveT) * 0.85;`
);

fs.writeFileSync(file, code);
