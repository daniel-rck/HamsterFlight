import { defaultFilterVert, Filter, GlProgram } from "pixi.js";

/**
 * The scene's single screen-space pass - the thing Canvas2D has no way to do
 * at all, and so the reason this backend is the default.
 *
 * Three effects share one pass because a second filter would mean a second
 * full-screen render-target ping-pong for no visual gain:
 *
 * **Shockwave.** A ring of radial displacement travelling out from an impact.
 * It runs first, so the two colour effects sample the already-warped image and
 * the whole picture moves together rather than the colours sliding over it.
 *
 * **Altitude glow.** Four diagonal taps of the bright component, averaged and
 * added back with a cool tint. A small genuine glow, not a bloom - a real one
 * needs a separate bright-pass and a wide blur, several more render targets
 * than this scene earns.
 *
 * **Chromatic aberration.** Red and blue sampled either side of green along
 * the radius from the impact, so separation grows toward the edges as a lens
 * does.
 */
const fragment = /* glsl */ `
// Must match the default filter vertex shader, which declares uInputSize at
// the vertex stage's default highp. Without this the program fails to link
// with "Precisions of uniform 'uInputSize' differ between VERTEX and FRAGMENT".
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

uniform float uAberration;
uniform float uAltitude;
uniform vec2 uCentre;

uniform float uWaveProgress;
uniform float uWaveAmplitude;
uniform vec2 uWaveCentre;

/** How far the ring has travelled, in texture coordinates. */
const float WAVE_REACH = 0.9;
/** Thickness of the ring. Wider reads as a swell, narrower as a crack. */
const float WAVE_BAND = 0.11;

vec2 clampCoord(vec2 uv) {
    return clamp(uv, uInputClamp.xy, uInputClamp.zw);
}

/** How much of this pixel reads as a highlight. */
float bright(vec3 rgb) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    return smoothstep(0.62, 1.0, lum);
}

/**
 * Radial push away from the impact, concentrated in a ring that expands and
 * fades. Distance is measured with the aspect corrected so the ring is round
 * on screen rather than round in texture space.
 */
vec2 shockwave(vec2 uv) {
    if (uWaveProgress <= 0.0) return vec2(0.0);

    float aspect = uInputSize.x / max(uInputSize.y, 1.0);
    vec2 delta = uv - uWaveCentre;
    float distance = length(vec2(delta.x * aspect, delta.y));
    if (distance < 1e-5) return vec2(0.0);

    float radius = uWaveProgress * WAVE_REACH;
    float ring = 1.0 - smoothstep(0.0, WAVE_BAND, abs(distance - radius));
    float fade = 1.0 - uWaveProgress;

    return (delta / distance) * ring * fade * uWaveAmplitude;
}

void main() {
    vec2 coord = clampCoord(vTextureCoord + shockwave(vTextureCoord));

    vec4 color = texture(uTexture, coord);
    if (uAberration > 0.0) {
        vec2 offset = (coord - uCentre) * uAberration * 0.035;
        color.r = texture(uTexture, clampCoord(coord + offset)).r;
        color.b = texture(uTexture, clampCoord(coord - offset)).b;
    }

    if (uAltitude > 0.0) {
        // Un-premultiply before touching colour, as the core filters do.
        if (color.a > 0.0) color.rgb /= color.a;

        vec2 step = uInputSize.zw * (2.0 + 4.0 * uAltitude);
        float glow = 0.0;
        glow += bright(texture(uTexture, clampCoord(coord + vec2( step.x,  step.y))).rgb);
        glow += bright(texture(uTexture, clampCoord(coord + vec2(-step.x,  step.y))).rgb);
        glow += bright(texture(uTexture, clampCoord(coord + vec2( step.x, -step.y))).rgb);
        glow += bright(texture(uTexture, clampCoord(coord + vec2(-step.x, -step.y))).rgb);
        glow *= 0.25 * uAltitude;

        color.rgb += vec3(0.34, 0.44, 0.62) * glow;
        color.rgb *= color.a;
    }

    finalColor = color;
}
`;

export interface SceneUniforms {
  uAberration: number;
  uAltitude: number;
  uCentre: Float32Array;
  uWaveProgress: number;
  uWaveAmplitude: number;
  uWaveCentre: Float32Array;
}

export class SceneFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "scene" }),
      resources: {
        sceneUniforms: {
          uAberration: { value: 0, type: "f32" },
          uAltitude: { value: 0, type: "f32" },
          uCentre: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
          uWaveProgress: { value: 0, type: "f32" },
          uWaveAmplitude: { value: 0, type: "f32" },
          uWaveCentre: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
        },
      },
    });
  }

  get uniforms(): SceneUniforms {
    return this.resources.sceneUniforms.uniforms as SceneUniforms;
  }
}
