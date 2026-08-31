import { defaultFilterVert, Filter, GlProgram } from 'pixi.js';

/**
 * One screen-space pass doing the two things Canvas2D has no way to do at all.
 *
 * **Altitude glow.** Four diagonal taps of the bright component, averaged and
 * added back with a cool tint. It is a small genuine glow rather than a full
 * bloom - a real one needs a separate bright-pass and a wide blur, which is
 * several more render targets for an effect this scene barely needs.
 *
 * **Chromatic aberration.** Red and blue sampled either side of green along
 * the radius from the impact, so the separation grows towards the edges the
 * way a lens does.
 *
 * Both are folded into a single pass because both are per-pixel colour work;
 * two filters would mean two full-screen ping-pongs for no visual gain.
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

vec2 clampCoord(vec2 uv) {
    return clamp(uv, uInputClamp.xy, uInputClamp.zw);
}

/** How much of this pixel reads as a highlight. */
float bright(vec3 rgb) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    return smoothstep(0.62, 1.0, lum);
}

void main() {
    vec2 radial = vTextureCoord - uCentre;
    vec2 offset = radial * uAberration * 0.035;

    vec4 centre = texture(uTexture, vTextureCoord);
    vec4 color = centre;
    if (uAberration > 0.0) {
        color.r = texture(uTexture, clampCoord(vTextureCoord + offset)).r;
        color.b = texture(uTexture, clampCoord(vTextureCoord - offset)).b;
    }

    if (uAltitude > 0.0) {
        // Un-premultiply before touching colour, as the core filters do.
        if (color.a > 0.0) color.rgb /= color.a;

        vec2 step = uInputSize.zw * (2.0 + 4.0 * uAltitude);
        float glow = 0.0;
        glow += bright(texture(uTexture, clampCoord(vTextureCoord + vec2( step.x,  step.y))).rgb);
        glow += bright(texture(uTexture, clampCoord(vTextureCoord + vec2(-step.x,  step.y))).rgb);
        glow += bright(texture(uTexture, clampCoord(vTextureCoord + vec2( step.x, -step.y))).rgb);
        glow += bright(texture(uTexture, clampCoord(vTextureCoord + vec2(-step.x, -step.y))).rgb);
        glow *= 0.25 * uAltitude;

        color.rgb += vec3(0.34, 0.44, 0.62) * glow;
        color.rgb *= color.a;
    }

    finalColor = color;
}
`;

export interface AtmosphereUniforms {
  uAberration: number;
  uAltitude: number;
  uCentre: Float32Array;
}

export class AtmosphereFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'atmosphere' }),
      resources: {
        atmosphereUniforms: {
          uAberration: { value: 0, type: 'f32' },
          uAltitude: { value: 0, type: 'f32' },
          uCentre: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
        },
      },
    });
  }

  get uniforms(): AtmosphereUniforms {
    return this.resources.atmosphereUniforms.uniforms as AtmosphereUniforms;
  }
}
