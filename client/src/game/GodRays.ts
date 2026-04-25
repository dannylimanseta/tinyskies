import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

const vert = `
varying vec2 vUv;
varying vec3 vLocalPos;
void main() {
  vUv = uv;
  vLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = `
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;

varying vec2 vUv;
varying vec3 vLocalPos;

// 3D noise for rich volumetric feel
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  // Normalize local pos to get consistent ray angles regardless of cone width
  float radius = length(vLocalPos.xz) + 0.001;
  vec3 p = vec3(vLocalPos.x / radius * 2.0, vUv.y * 1.5, vLocalPos.z / radius * 2.0);
  
  // Rotate the rays slowly over time
  float c = cos(uTime * 0.05);
  float s = sin(uTime * 0.05);
  p.xz = vec2(p.x * c - p.z * s, p.x * s + p.z * c);
  
  float n1 = noise(p * 3.0);
  float n2 = noise(p * 6.0 + vec3(0.0, uTime * 0.2, 0.0));
  
  // Combine to create sharp light shafts
  float rays = pow(n1 * n2, 1.5) * 4.0;
  
  // Fade out at the top (near sun) to avoid hard edges, and bottom (terminating in ground)
  float fadeY = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  
  float a = rays * fadeY * uIntensity;
  
  gl_FragColor = vec4(uColor * a, a);
}
`;

export class GodRays {
  readonly group = new Group();
  private mesh: Mesh;
  private material: ShaderMaterial;
  private colorUniform = { value: new Color() };
  private intensityUniform = { value: 1.0 };
  
  constructor() {
    // Open-ended cone: radiusTop=0.5, radiusBottom=8.0, height=18.0
    const geo = new CylinderGeometry(0.5, 8.0, 18.0, 32, 1, true);
    // Offset geometry so origin is at the top tip (Y = 9)
    geo.translate(0, -9.0, 0);
    
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
      side: DoubleSide,
    });
    
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // Always render when sun is active
    this.mesh.renderOrder = 1; // Render after opaque globe, before UI/some effects
    
    // Default rotation so that -Y points forward when using group.lookAt
    this.mesh.rotation.x = -Math.PI / 2;
    
    this.group.add(this.mesh);
  }
  
  update(time: number, sunPos: Vector3, globeCenter: Vector3, color: number, sunIntensity: number) {
    this.material.uniforms.uTime.value = time;
    this.colorUniform.value.set(color);
    
    // Modulate intensity: if sun is weak (night/evening), rays disappear
    this.intensityUniform.value = sunIntensity * 0.18; // Base dampening
    
    this.group.position.copy(sunPos);
    
    // Point the group at the globe center.
    // By default, lookAt points the local +Z axis toward the target.
    // We rotated the mesh above so its local -Y (the wide bottom of the cone) 
    // now faces along the group's +Z axis.
    this.group.up.set(0, 1, 0);
    this.group.lookAt(globeCenter);
  }
  
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
