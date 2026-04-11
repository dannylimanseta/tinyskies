import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MOON_CYCLE_DURATION = 300; // 5 minutes (testing)
const MOON_START_DISTANCE = 35;
const MOON_END_DISTANCE = 7;
const MOON_ROTATION_SPEED = 0.08;
const MOON_SCALE_START = 0.6;
const MOON_SCALE_END = 1.0;

/** Direction from globe centre toward the moon's starting position (normalised). */
const MOON_APPROACH_DIR = new Vector3(0.4, 0.75, 0.53).normalize();

const POST_IMPACT_SPEED = 0.3;

/* ── Impact cinematic timing ────────────────────────────── */
const IMPACT_SHOCKWAVE_DUR = 10.0;
const IMPACT_DEBRIS_DUR = 11.0;
const NEAR_IMPACT_THRESHOLD = 0.995;
const DEBRIS_COUNT = 350;
const CAMERA_ROCK_COUNT = 3;
const WAVE_COUNT = 3;
const WAVE_STAGGER = 1.8; // seconds between each wave

const EMBER_COUNT = 1500;
const EMBER_LIFE_MIN = 0.8;
const EMBER_LIFE_MAX = 2.5;
const EMBER_DRIFT_SPEED = 3.5;
const EMBER_SPREAD = 1.2;

interface Ember {
  life: number;
  maxLife: number;
  pos: Vector3;
  vel: Vector3;
}

export class MoonThreat {
  readonly group = new Group();
  private elapsed = 0;
  private loaded = false;
  private baseScale = 1;
  private impacted = false;

  /* ── Molten effect shader refs ──────────────────────────── */
  private moltenShaders: { uniforms: Record<string, { value: number }> }[] = [];

  /* ── Fire particles ─────────────────────────────────────── */
  private embers: Ember[] = [];
  private emberPoints: Points | null = null;
  private emberMat: ShaderMaterial | null = null;
  private emberPositions: Float32Array | null = null;
  private emberAlphas: Float32Array | null = null;
  private emberSizes: Float32Array | null = null;

  /* ── Impact VFX objects ─────────────────────────────────── */
  private shockwaveWaves: Mesh[] = [];
  private debrisMesh: InstancedMesh | null = null;
  private debrisVelocities: Vector3[] = [];
  private impactTime = 0;

  get progress() {
    return Math.min(this.elapsed / MOON_CYCLE_DURATION, 1);
  }

  /** True once progress >= 1 and the cinematic should begin. */
  get hasImpacted() {
    return this.impacted;
  }

  /** True when the moon is about to hit — time to start the cutscene. */
  get isNearImpact() {
    return !this.impacted && this.progress >= NEAR_IMPACT_THRESHOLD;
  }

  /** Seconds since impact moment (for cinematic sequencing in Game). */
  get timeSinceImpact() {
    return this.impactTime;
  }

  /** Debug: skip to just before impact so the cinematic plays naturally. */
  forceImpact() {
    if (this.impacted) return;
    this.elapsed = MOON_CYCLE_DURATION * 0.995;
  }

  /** Debug: jump to a specific progress (0–1). */
  jumpTo(pct: number) {
    if (this.impacted) return;
    this.elapsed = MOON_CYCLE_DURATION * Math.min(pct, 0.999);
  }

  constructor(private globeRadius: number) {
    const loader = new GLTFLoader();
    loader.load("/3D/moon.glb", (gltf) => {
      const model = gltf.scene;

      const box = new Box3().setFromObject(model);
      const size = new Vector3();
      box.getSize(size);
      const rawDiameter = Math.max(size.x, size.y, size.z);

      this.baseScale = rawDiameter > 0 ? this.globeRadius / rawDiameter : 1;
      model.scale.setScalar(this.baseScale * MOON_SCALE_START);

      const centre = new Vector3();
      box.getCenter(centre).multiplyScalar(this.baseScale * MOON_SCALE_START);
      model.position.sub(centre);

      this.applyRimLight(model);

      this.group.add(model);
      this.loaded = true;
    });

    this.group.position.copy(MOON_APPROACH_DIR.clone().multiplyScalar(MOON_START_DISTANCE));
  }

  /* ── Rim light + molten cracks ─────────────────────────────── */

  private applyRimLight(root: Group) {
    const moltenUniforms = `
uniform float rimIntensity;
uniform float rimPower;
uniform float uMolten;
`;

    const moltenFunctions = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.1; a *= 0.5; }
  return v;
}
`;

    const moltenEffect = /* glsl */ `
vec3 rimViewDir = normalize(vViewPosition);
vec3 rimN = normalize(normal);
float rimF = 1.0 - abs(dot(rimViewDir, rimN));

vec3 rimCoolCol = vec3(0.7, 0.75, 0.9);
vec3 rimHotCol  = vec3(1.0, 0.45, 0.05);
vec3 rimCol = mix(rimCoolCol, rimHotCol, uMolten);
float rimP = mix(rimPower, 1.5, uMolten);
float rimI = mix(rimIntensity, 1.8, uMolten);
gl_FragColor.rgb += rimCol * rimI * pow(rimF, rimP);

if (uMolten > 0.01) {
  vec3 wp = vWorldPos;
  float n1 = fbm3(wp * 3.0);
  float n2 = fbm3(wp * 6.0 + 5.0);
  float crack = smoothstep(0.42, 0.48, n1) * smoothstep(0.52, 0.48, n1);
  crack += smoothstep(0.38, 0.44, n2) * smoothstep(0.56, 0.44, n2) * 0.6;
  crack = clamp(crack, 0.0, 1.0);
  vec3 lavaCore = vec3(1.0, 0.85, 0.2);
  vec3 lavaEdge = vec3(1.0, 0.25, 0.0);
  vec3 lavaCol = mix(lavaEdge, lavaCore, crack);
  float glow = crack * uMolten;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, lavaCol, glow * 0.9);
  gl_FragColor.rgb += lavaEdge * glow * 0.4;
}
#include <dithering_fragment>`;

    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const mat = child.material;

      const patchShader = (shader: {
        uniforms: Record<string, { value: number }>;
        fragmentShader: string;
        vertexShader: string;
      }, uniformAnchor: string) => {
        shader.uniforms.rimIntensity = { value: 0.55 };
        shader.uniforms.rimPower = { value: 2.5 };
        shader.uniforms.uMolten = { value: 0 };
        this.moltenShaders.push(shader);

        shader.fragmentShader = shader.fragmentShader.replace(
          uniformAnchor,
          uniformAnchor + "\n" + moltenUniforms,
        );

        shader.vertexShader = shader.vertexShader.replace(
          "void main() {",
          "varying vec3 vWorldPos;\nvoid main() {",
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;",
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          "void main() {",
          "varying vec3 vWorldPos;\n" + moltenFunctions + "\nvoid main() {",
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          moltenEffect,
        );
      };

      if (mat instanceof MeshStandardMaterial) {
        mat.color.multiplyScalar(0.35);
        mat.onBeforeCompile = (shader) => patchShader(shader, "uniform float opacity;");
        mat.needsUpdate = true;
      } else if (mat instanceof MeshPhongMaterial) {
        mat.color.multiplyScalar(0.35);
        mat.onBeforeCompile = (shader) => patchShader(shader, "uniform vec3 emissive;");
        mat.needsUpdate = true;
      }
    });
  }

  addTo(scene: Scene) {
    scene.add(this.group);
  }

  /* ── Fire particle setup ─────────────────────────────────── */

  private initEmbers() {
    const positions = new Float32Array(EMBER_COUNT * 3);
    const alphas = new Float32Array(EMBER_COUNT);
    const sizes = new Float32Array(EMBER_COUNT);
    this.emberPositions = positions;
    this.emberAlphas = alphas;
    this.emberSizes = sizes;

    for (let i = 0; i < EMBER_COUNT; i++) {
      this.embers.push({ life: 0, maxLife: 1, pos: new Vector3(), vel: new Vector3() });
      alphas[i] = 0;
      sizes[i] = 0;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setAttribute("alpha", new BufferAttribute(alphas, 1));
    geo.setAttribute("size", new BufferAttribute(sizes, 1));

    this.emberMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        varying float vAlpha;
        varying float vSize;
        void main() {
          vAlpha = alpha;
          vSize = size;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (600.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vSize;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float sharp = step(0.0, 0.3 - vSize);
          float soft = 1.0 - smoothstep(0.0, 1.0, d);
          float hard = 1.0 - smoothstep(0.0, 0.35, d);
          float disc = mix(soft, hard, sharp);
          vec3 hotCol = vec3(1.0, 0.9, 0.5);
          vec3 warmCol = vec3(1.0, 0.5, 0.05);
          vec3 col = mix(warmCol, hotCol, disc * (1.0 - sharp * 0.3));
          gl_FragColor = vec4(col, disc * vAlpha);
        }
      `,
    });

    this.emberPoints = new Points(geo, this.emberMat);
    this.emberPoints.frustumCulled = false;
    this.emberPoints.visible = false;
  }

  private spawnEmber(idx: number, moonWorldPos: Vector3, moonRadius: number) {
    const e = this.embers[idx]!;
    e.maxLife = EMBER_LIFE_MIN + Math.random() * (EMBER_LIFE_MAX - EMBER_LIFE_MIN);
    e.life = e.maxLife;

    let surfaceDir: Vector3;
    for (;;) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - 2 * Math.random());
      surfaceDir = new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      );
      if (surfaceDir.dot(MOON_APPROACH_DIR) < -0.5) break;
    }
    e.pos.copy(moonWorldPos).addScaledVector(surfaceDir, moonRadius * (1.0 + Math.random() * 0.03));

    const backward = MOON_APPROACH_DIR.clone().multiplyScalar(
      EMBER_DRIFT_SPEED * (0.6 + Math.random() * 0.6),
    );
    const radialOut = surfaceDir.clone().multiplyScalar(
      EMBER_DRIFT_SPEED * (0.15 + Math.random() * 0.2),
    );
    const tangent = surfaceDir.clone().cross(MOON_APPROACH_DIR);
    if (tangent.lengthSq() > 0.001) tangent.normalize();
    else tangent.set(1, 0, 0);
    const lateral = tangent.multiplyScalar((Math.random() - 0.5) * EMBER_SPREAD);

    e.vel.copy(backward).add(radialOut).add(lateral);
  }

  private updateEmbers(dt: number, molten: number) {
    if (!this.emberPoints) {
      this.initEmbers();
      this.group.parent?.add(this.emberPoints!);
    }

    this.emberPoints!.visible = molten > 0.01;
    if (molten <= 0.01) return;

    const moonWorldPos = this.group.position;
    const currentScale = this.loaded && this.group.children[0]
      ? this.group.children[0].scale.x
      : this.baseScale * MOON_SCALE_START;
    const scaleFactor = this.baseScale > 0 ? currentScale / this.baseScale : 1;
    const moonRadius = this.globeRadius * scaleFactor * 0.5;

    const spawnRate = molten * 0.85;

    for (let i = 0; i < EMBER_COUNT; i++) {
      const e = this.embers[i]!;

      if (e.life <= 0) {
        if (Math.random() < spawnRate * dt * 40) {
          this.spawnEmber(i, moonWorldPos, moonRadius);
        } else {
          this.emberAlphas![i] = 0;
          this.emberSizes![i] = 0;
          continue;
        }
      }

      e.life -= dt;

      const toParticle = _emberScratch.copy(e.pos).sub(moonWorldPos);
      const dist = toParticle.length();
      if (dist > 0.001) {
        toParticle.divideScalar(dist);
        const pushStrength = Math.max(0, moonRadius * 1.1 - dist) * 6.0;
        if (pushStrength > 0) {
          e.vel.addScaledVector(toParticle, pushStrength * dt);
        }
      }

      e.pos.addScaledVector(e.vel, dt);

      const frac = Math.max(0, e.life / e.maxLife);
      this.emberAlphas![i] = frac * molten;
      const r = Math.random();
      const baseSize = r < 0.6 ? 0.08 + r * 0.25 : 0.35 + r * 0.5;
      this.emberSizes![i] = baseSize * frac * molten;

      this.emberPositions![i * 3] = e.pos.x;
      this.emberPositions![i * 3 + 1] = e.pos.y;
      this.emberPositions![i * 3 + 2] = e.pos.z;
    }

    const geo = this.emberPoints!.geometry;
    geo.attributes.position!.needsUpdate = true;
    (geo.attributes.alpha as BufferAttribute).needsUpdate = true;
    (geo.attributes.size as BufferAttribute).needsUpdate = true;
  }

  /* ── Per-frame update ───────────────────────────────────── */

  update(dt: number) {
    if (this.impacted) {
      this.group.position.addScaledVector(
        _negApproach,
        POST_IMPACT_SPEED * dt,
      );
      if (this.loaded) {
        this.group.rotation.y += MOON_ROTATION_SPEED * dt;
      }
      this.updateEmbers(dt, 1.0);
      this.updateImpactVFX(dt);
      return;
    }

    this.elapsed += dt;
    const t = this.progress;

    const dist = MOON_START_DISTANCE + (MOON_END_DISTANCE - MOON_START_DISTANCE) * t;
    this.group.position.copy(MOON_APPROACH_DIR).multiplyScalar(dist);

    if (this.loaded) {
      this.group.rotation.y += MOON_ROTATION_SPEED * dt;
      const s = this.baseScale * (MOON_SCALE_START + (MOON_SCALE_END - MOON_SCALE_START) * t);
      const model = this.group.children[0];
      if (model) model.scale.setScalar(s);
    }

    const molten = t < 0.75 ? 0 : Math.min(1, (t - 0.75) / 0.20);
    for (const sh of this.moltenShaders) {
      sh.uniforms.uMolten!.value = molten;
    }
    this.updateEmbers(dt, molten);

    if (t >= 1.0 && !this.impacted) {
      this.triggerImpact();
    }
  }

  getShakeTrauma(): number {
    if (this.impacted) {
      const t = this.impactTime;
      if (t < 0.3) return 1.0;
      if (t < 2.0) return 0.85;
      if (t < 11.0) return 0.6;
      return Math.max(0, 0.5 - (t - 11.0) * 0.12);
    }
    const t = this.progress;
    if (t >= 1.0) return 0.5;
    if (t < 0.8) return 0;
    const r = (t - 0.8) / 0.2;
    return r * r * 0.35;
  }

  /* ── Impact trigger ─────────────────────────────────────── */

  private triggerImpact() {
    this.impacted = true;
    this.impactTime = 0;
    this.spawnShockwave();
    this.spawnDebris();
  }

  private spawnShockwave() {
    const parent = this.group.parent;
    if (!parent) return;

    const impactPos = MOON_APPROACH_DIR.clone().multiplyScalar(this.globeRadius + 0.2);
    const q = new Quaternion().setFromUnitVectors(_zAxis, MOON_APPROACH_DIR);

    const geo = new PlaneGeometry(2, 2, 1, 1);

    for (let w = 0; w < WAVE_COUNT; w++) {
      const mat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uOpacity: { value: 0.0 },
          uInnerR: { value: 0.0 },
          uOuterR: { value: 0.01 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uOpacity;
          uniform float uInnerR;
          uniform float uOuterR;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float ringMid = (uInnerR + uOuterR) * 0.5;
            float ringW = (uOuterR - uInnerR) * 0.5;
            float ring = 1.0 - smoothstep(0.0, ringW, abs(d - ringMid));
            vec3 col = mix(vec3(1.0, 0.6, 0.15), vec3(1.0, 0.35, 0.05), smoothstep(uInnerR, uOuterR, d));
            gl_FragColor = vec4(col, ring * uOpacity);
          }
        `,
      });

      const wave = new Mesh(geo, mat);
      wave.position.copy(impactPos);
      wave.quaternion.copy(q);
      wave.scale.setScalar(0.01);
      wave.visible = false;
      parent.add(wave);
      this.shockwaveWaves.push(wave);
    }
  }

  private spawnDebris() {
    const totalCount = DEBRIS_COUNT + CAMERA_ROCK_COUNT;
    const geo = new DodecahedronGeometry(0.3, 0);
    const mat = new MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.9,
      emissive: 0x331100,
      emissiveIntensity: 0.4,
    });
    this.debrisMesh = new InstancedMesh(geo, mat, totalCount);

    const dummy = new Object3D();
    this.debrisVelocities = [];
    const impactPoint = MOON_APPROACH_DIR.clone().multiplyScalar(this.globeRadius + 0.5);

    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.2) * Math.PI * 0.6;
      const speed = 0.4 + Math.random() * 1.8;

      this.debrisVelocities.push(
        new Vector3(
          Math.cos(angle) * Math.cos(elev) * speed,
          Math.sin(elev) * speed + 0.4,
          Math.sin(angle) * Math.cos(elev) * speed,
        ),
      );

      const sx = 0.15 + Math.random() * 0.55;
      const sy = 0.12 + Math.random() * 0.4;
      const sz = 0.15 + Math.random() * 0.5;
      dummy.position.copy(impactPoint);
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(i, dummy.matrix);
    }

    // Rocks aimed at the cinematic camera for dramatic near-misses
    const cameraPos = new Vector3(
      this.globeRadius * 3.2,
      this.globeRadius * 1.8,
      this.globeRadius * 3.2,
    );
    const toCam = cameraPos.sub(impactPoint).normalize();

    for (let i = 0; i < CAMERA_ROCK_COUNT; i++) {
      const spread = 0.18;
      const dir = toCam
        .clone()
        .add(
          new Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
          ),
        )
        .normalize();
      const speed = 0.8 + Math.random() * 0.6;

      this.debrisVelocities.push(dir.clone().multiplyScalar(speed));

      const rockSize = 0.8 + Math.random() * 0.8;
      dummy.position.copy(impactPoint);
      dummy.scale.set(
        rockSize,
        rockSize * (0.5 + Math.random() * 0.5),
        rockSize * (0.6 + Math.random() * 0.4),
      );
      dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(DEBRIS_COUNT + i, dummy.matrix);
    }

    this.debrisMesh.instanceMatrix.needsUpdate = true;
    this.group.parent?.add(this.debrisMesh);
  }

  /* ── Animate impact VFX ─────────────────────────────────── */

  private updateImpactVFX(dt: number) {
    this.impactTime += dt;

    for (let w = 0; w < this.shockwaveWaves.length; w++) {
      const wave = this.shockwaveWaves[w]!;
      const waveTime = this.impactTime - w * WAVE_STAGGER;
      if (waveTime < 0) { wave.visible = false; continue; }

      wave.visible = true;
      const speedMul = 1.0 + w * 0.4; // later waves expand faster
      const dur = IMPACT_SHOCKWAVE_DUR / speedMul;
      const t = Math.min(waveTime / dur, 1);
      const maxRadius = this.globeRadius * 5;
      const radius = t * maxRadius;
      wave.scale.setScalar(radius || 0.01);

      const mat = wave.material as ShaderMaterial;
      const baseWidth = 0.28 - w * 0.08; // first wave much thicker
      const ringWidth = baseWidth + t * 0.06;
      mat.uniforms.uInnerR!.value = Math.max(0, 1.0 - ringWidth);
      mat.uniforms.uOuterR!.value = 1.0;
      const baseOpacity = 0.85 - w * 0.2;
      mat.uniforms.uOpacity!.value = baseOpacity * (1 - t * t);
    }

    if (this.debrisMesh) {
      const totalCount = DEBRIS_COUNT + CAMERA_ROCK_COUNT;
      const dummy = new Object3D();
      for (let i = 0; i < totalCount; i++) {
        this.debrisMesh.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

        const vel = this.debrisVelocities[i]!;
        dummy.position.addScaledVector(vel, dt);

        const gravity = i >= DEBRIS_COUNT ? 0.03 : 0.15;
        vel.y -= gravity * dt;

        dummy.rotation.x += dt * (0.25 + (i % 3) * 0.15);
        dummy.rotation.z += dt * (0.15 + (i % 4) * 0.08);

        dummy.updateMatrix();
        this.debrisMesh.setMatrixAt(i, dummy.matrix);
      }
      this.debrisMesh.instanceMatrix.needsUpdate = true;

      if (this.impactTime > IMPACT_DEBRIS_DUR) {
        const fade = Math.max(0, 1 - (this.impactTime - IMPACT_DEBRIS_DUR) / 1.0);
        (this.debrisMesh.material as MeshStandardMaterial).opacity = fade;
        (this.debrisMesh.material as MeshStandardMaterial).transparent = true;
      }
    }
  }

  reset() {
    this.elapsed = 0;
    this.impacted = false;
    this.impactTime = 0;
    this.group.position.copy(MOON_APPROACH_DIR).multiplyScalar(MOON_START_DISTANCE);
    this.group.rotation.y = 0;
    for (const w of this.shockwaveWaves) {
      w.parent?.remove(w);
      (w.material as ShaderMaterial).dispose();
      w.geometry.dispose();
    }
    this.shockwaveWaves = [];
    if (this.debrisMesh) {
      this.debrisMesh.parent?.remove(this.debrisMesh);
      this.debrisMesh = null;
    }
    if (this.emberPoints) {
      this.emberPoints.parent?.remove(this.emberPoints);
      this.emberPoints.geometry.dispose();
      this.emberMat?.dispose();
      this.emberPoints = null;
      this.emberMat = null;
    }
  }

  dispose() {
    this.reset();
    this.group.parent?.remove(this.group);
  }
}

/* ── Module-level scratch vectors (avoid per-frame allocs) ── */
const _negApproach = MOON_APPROACH_DIR.clone().negate();
const _zAxis = new Vector3(0, 0, 1);
const _emberScratch = new Vector3();
