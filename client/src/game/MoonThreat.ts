import { Box3, Group, Mesh, MeshPhongMaterial, MeshStandardMaterial, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MOON_CYCLE_DURATION = 300; // 5 minutes (testing)
const MOON_START_DISTANCE = 35;
const MOON_END_DISTANCE = 7;
const MOON_ROTATION_SPEED = 0.08;
const MOON_SCALE_START = 0.6;   // starts at 60% of target size
const MOON_SCALE_END = 1.0;     // reaches full size at impact

export class MoonThreat {
  readonly group = new Group();
  private elapsed = 0;
  private loaded = false;
  private baseScale = 1;

  /** Normalised progress 0-1 (exposed so Game can read it for shake, etc.) */
  get progress() {
    return Math.min(this.elapsed / MOON_CYCLE_DURATION, 1);
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

    this.group.position.set(0, MOON_START_DISTANCE, 0);
  }

  private applyRimLight(root: Group) {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const mat = child.material;

      if (mat instanceof MeshStandardMaterial) {
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.rimIntensity = { value: 0.55 };
          shader.uniforms.rimPower = { value: 2.5 };

          shader.fragmentShader = shader.fragmentShader.replace(
            "uniform float opacity;",
            `uniform float opacity;
uniform float rimIntensity;
uniform float rimPower;`,
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
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.rimIntensity = { value: 0.55 };
          shader.uniforms.rimPower = { value: 2.5 };

          shader.fragmentShader = shader.fragmentShader.replace(
            "uniform vec3 emissive;",
            `uniform vec3 emissive;
uniform float rimIntensity;
uniform float rimPower;`,
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

  update(dt: number) {
    this.elapsed += dt;
    const t = this.progress;

    const dist = MOON_START_DISTANCE + (MOON_END_DISTANCE - MOON_START_DISTANCE) * t;
    this.group.position.set(0, dist, 0);

    if (this.loaded) {
      this.group.rotation.y += MOON_ROTATION_SPEED * dt;

      const s = this.baseScale * (MOON_SCALE_START + (MOON_SCALE_END - MOON_SCALE_START) * t);
      const model = this.group.children[0];
      if (model) model.scale.setScalar(s);
    }
  }

  /**
   * Returns the shake trauma level for the current progress (0 = none, 1 = max).
   * Starts gentle past 60%, ramps hard in the final moments.
   */
  getShakeTrauma(): number {
    const t = this.progress;
    if (t >= 1.0) return 0.5;   // impact — strong but not overwhelming
    if (t < 0.8) return 0;      // no shake until the last 20% of the cycle
    const r = (t - 0.8) / 0.2;  // 0→1 over the final 20%
    return r * r * 0.35;         // gentle ramp to 0.35 max before impact
  }

  reset() {
    this.elapsed = 0;
    this.group.position.set(0, MOON_START_DISTANCE, 0);
    this.group.rotation.y = 0;
  }

  dispose() {
    this.group.parent?.remove(this.group);
  }
}
