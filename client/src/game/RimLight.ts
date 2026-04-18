import { MeshPhongMaterial, Color } from "three";

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
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: globalRimColor };
    shader.uniforms.rimIntensity = { value: intensity };
    shader.uniforms.rimPower = { value: power };

    shader.fragmentShader = shader.fragmentShader.replace(
      "uniform vec3 emissive;",
      `uniform vec3 emissive;
uniform vec3 rimColor;
uniform float rimIntensity;
uniform float rimPower;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `vec3 rimViewDir = normalize(vViewPosition);
vec3 rimNormal = normalize(normal);
float rimFresnel = 1.0 - abs(dot(rimViewDir, rimNormal));
vec3 rim = rimColor * rimIntensity * pow(rimFresnel, rimPower);
gl_FragColor.rgb += rim;
#include <dithering_fragment>`,
    );
  };

  mat.needsUpdate = true;
}
