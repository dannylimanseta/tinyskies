import {
  AdditiveBlending,
  Box3,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
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

export class MoonThreat {
  readonly group = new Group();
  private elapsed = 0;
  private loaded = false;
  private baseScale = 1;
  private impacted = false;

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

  /* ── Rim light ────────────────────────────────────────────── */

  private applyRimLight(root: Group) {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const mat = child.material;

      if (mat instanceof MeshStandardMaterial) {
        mat.color.multiplyScalar(0.35);
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.rimIntensity = { value: 0.55 };
          shader.uniforms.rimPower = { value: 2.5 };
          shader.fragmentShader = shader.fragmentShader.replace(
            "uniform float opacity;",
            `uniform float opacity;\nuniform float rimIntensity;\nuniform float rimPower;`,
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            `vec3 rimViewDir = normalize(vViewPosition);
vec3 rimN = normalize(normal);
float rimF = 1.0 - abs(dot(rimViewDir, rimN));
gl_FragColor.rgb += vec3(0.7, 0.75, 0.9) * rimIntensity * pow(rimF, rimPower);
#include <dithering_fragment>`,
          );
        };
        mat.needsUpdate = true;
      } else if (mat instanceof MeshPhongMaterial) {
        mat.color.multiplyScalar(0.35);
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.rimIntensity = { value: 0.55 };
          shader.uniforms.rimPower = { value: 2.5 };
          shader.fragmentShader = shader.fragmentShader.replace(
            "uniform vec3 emissive;",
            `uniform vec3 emissive;\nuniform float rimIntensity;\nuniform float rimPower;`,
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            `vec3 rimViewDir = normalize(vViewPosition);
vec3 rimN = normalize(normal);
float rimF = 1.0 - abs(dot(rimViewDir, rimN));
gl_FragColor.rgb += vec3(0.7, 0.75, 0.9) * rimIntensity * pow(rimF, rimPower);
#include <dithering_fragment>`,
          );
        };
        mat.needsUpdate = true;
      }
    });
  }

  addTo(scene: Scene) {
    scene.add(this.group);
  }

  /* ── Per-frame update ───────────────────────────────────── */

  update(dt: number) {
    if (this.impacted) {
      // Moon keeps ploughing through the globe
      this.group.position.addScaledVector(
        _negApproach,
        POST_IMPACT_SPEED * dt,
      );
      if (this.loaded) {
        this.group.rotation.y += MOON_ROTATION_SPEED * dt;
      }
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
  }

  dispose() {
    this.reset();
    this.group.parent?.remove(this.group);
  }
}

/* ── Module-level scratch vectors (avoid per-frame allocs) ── */
const _negApproach = MOON_APPROACH_DIR.clone().negate();
const _zAxis = new Vector3(0, 0, 1);
