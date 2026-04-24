import {
  Color,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from "three";

const RIM_DITHERING_PATCH = `vec3 rimViewDir = normalize(vViewPosition);
vec3 rimNormal = normalize(normal);
float rimFresnel = 1.0 - abs(dot(rimViewDir, rimNormal));
vec3 rim = rimColor * rimIntensity * pow(rimFresnel, rimPower);
gl_FragColor.rgb += rim;
#include <dithering_fragment>`;

function appendRimToFragmentShader(fragmentShader: string): string {
  return fragmentShader
    .replace(
      "uniform vec3 emissive;",
      `uniform vec3 emissive;
uniform vec3 rimColor;
uniform float rimIntensity;
uniform float rimPower;`,
    )
    .replace("#include <dithering_fragment>", RIM_DITHERING_PATCH);
}

/**
 * Shared Fresnel tint for all `addRimLight` meshes. `Game.applyDayNightPreset` updates
 * this from `SkyPreset.rimColor` so boat, plane, globe props, etc. match time of day.
 */
export const globalRimColor = new Color(0xffeebb);

/**
 * Patches a MeshPhongMaterial to add a bright Fresnel rim glow.
 * Injects a few lines into the fragment shader -- zero extra draw calls.
 * The `color` argument is kept for call-site readability; the shader uses {@link globalRimColor}.
 */
export function addRimLight(
  mat: MeshPhongMaterial,
  _color: Color | number = 0xffffff,
  intensity: number = 0.6,
  power: number = 2.5,
): { value: number } {
  // Share a single uniform object across compile cycles so callers can update
  // `.value` live (e.g. cinematic rim boosting) without re-patching the shader.
  const rimIntensityUniform = { value: intensity };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: globalRimColor };
    shader.uniforms.rimIntensity = rimIntensityUniform;
    shader.uniforms.rimPower = { value: power };
    shader.fragmentShader = appendRimToFragmentShader(shader.fragmentShader);
  };

  mat.needsUpdate = true;
  return rimIntensityUniform;
}

/**
 * Like {@link addRimLight} for Phong/Lambert, but the rim color is a per-material uniform
 * (independent of {@link globalRimColor}).
 */
export function addRimLightWithColor(
  mat: MeshPhongMaterial | MeshLambertMaterial,
  color: Color | number = 0xffffff,
  intensity: number = 0.6,
  power: number = 2.5,
) {
  const rimColor = color instanceof Color ? color : new Color(color);
  const rimColorUniform = { value: rimColor };
  const rimIntensityUniform = { value: intensity };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = rimColorUniform;
    shader.uniforms.rimIntensity = rimIntensityUniform;
    shader.uniforms.rimPower = { value: power };
    shader.fragmentShader = appendRimToFragmentShader(shader.fragmentShader);
  };
  mat.needsUpdate = true;
  return { rimIntensity: rimIntensityUniform, rimColor: rimColorUniform };
}

/**
 * Fresnel rim on MeshStandardMaterial / MeshPhysicalMaterial (same GLSL hook as Phong;
 * used where props are not Phong, e.g. eternal flame after glow pass).
 */
export function addRimLightToStandard(
  mat: MeshStandardMaterial | MeshPhysicalMaterial,
  color: Color | number = 0xffffff,
  intensity: number = 0.6,
  power: number = 2.5,
) {
  const rimColor = color instanceof Color ? color : new Color(color);
  const rimColorUniform = { value: rimColor };
  const rimIntensityUniform = { value: intensity };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = rimColorUniform;
    shader.uniforms.rimIntensity = rimIntensityUniform;
    shader.uniforms.rimPower = { value: power };
    shader.fragmentShader = appendRimToFragmentShader(shader.fragmentShader);
  };
  mat.needsUpdate = true;
  return { rimIntensity: rimIntensityUniform, rimColor: rimColorUniform };
}
