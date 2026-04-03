import { MeshPhongMaterial, Color } from "three";

/**
 * Patches a MeshPhongMaterial to add a bright Fresnel rim glow.
 * Injects a few lines into the fragment shader -- zero extra draw calls.
 */
export function addRimLight(
  mat: MeshPhongMaterial,
  color: Color | number = 0xffffff,
  intensity: number = 0.6,
  power: number = 2.5,
) {
  const rimColor = color instanceof Color ? color : new Color(color);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
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
