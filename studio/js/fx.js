// fx.js — optional post-processing "finishing pass" for the papercraft game.
//
// Goal: make the flat Paper-Mario look read as a *premium handmade diorama*
// without drifting toward realism. Everything here is tuned soft + clean.
//
// Presets (cumulative):
//   off      — bypass the composer, plain renderer.render (true baseline)
//   minimal  — gentle tonemap + pastel grade + gradient sky (cohesion only)
//   diorama  — minimal + tilt-shift depth-of-field + restrained bloom
//   full     — diorama + soft ambient occlusion (GTAO)  [SSAO gated here]
//
// Robust by design: if the composer or any pass fails to build, FX falls back
// to plain render so the game (and the smoke check) never breaks — same ethos
// as the audio degrading to silence.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const PRESETS = ['off', 'minimal', 'diorama', 'full'];

// ---- gradient sky (replaces the flat single-colour fill) -------------------
// A soft vertical ramp: cooler/lighter up top → warm horizon near the band the
// scene sits in. Killing the flat fill is the single biggest "not-a-webpage" win.
const col = h => new THREE.Color(typeof h === 'string' && h[0] !== '#' ? '#' + h : h);
function gradientSkyTex(skyHex, groundHex) {
  const sky = col(skyHex), grd = col(groundHex);
  // top = sky lifted a touch cooler+brighter; horizon = sky warmed toward ground.
  const top = sky.clone().lerp(new THREE.Color('#ffffff'), 0.10);
  const horizon = sky.clone().lerp(grd, 0.22).lerp(new THREE.Color('#fff4e6'), 0.10);
  const h = 256, cv = document.createElement('canvas');
  cv.width = 8; cv.height = h;
  const x = cv.getContext('2d'), g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, '#' + top.getHexString());
  g.addColorStop(0.62, '#' + sky.getHexString());
  g.addColorStop(1.0, '#' + horizon.getHexString());
  x.fillStyle = g; x.fillRect(0, 0, 8, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- tilt-shift depth-of-field (screen-space vertical band) ----------------
// Keeps a horizontal focus band crisp, melts everything above/below it. This is
// the "miniature diorama" cue. Single-pass separable-ish blur, masked by |y-focus|.
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 800) },
    uFocus: { value: 0.46 },   // screen-Y of the sharp band (0 bottom .. 1 top)
    uBand: { value: 0.20 },    // half-height of fully-sharp band
    uFeather: { value: 0.50 }, // how far the blur ramps in past the band
    uAmount: { value: 0.7 },   // global multiplier (0 = no blur)
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uTexel;
    uniform float uFocus, uBand, uFeather, uAmount;
    void main(){
      float d = abs(vUv.y - uFocus);
      float blur = clamp((d - uBand) / max(uFeather, 1e-4), 0.0, 1.0);
      blur = blur * blur * uAmount;            // ease-in so the band edge is gentle
      if(blur < 0.002){ gl_FragColor = texture2D(tDiffuse, vUv); return; }
      // 13-tap pseudo-gaussian (separable taps summed) scaled by blur radius.
      float r = blur * 6.0;
      vec3 col = vec3(0.0); float wsum = 0.0;
      for(int i=-3;i<=3;i++){
        float fi = float(i);
        float w = exp(-0.5 * fi * fi / 2.25);
        col += texture2D(tDiffuse, vUv + vec2(uTexel.x * fi * r, 0.0)).rgb * w;
        col += texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y * fi * r)).rgb * w;
        wsum += 2.0 * w;
      }
      gl_FragColor = vec4(col / wsum, 1.0);
    }`,
};

// ---- final grade: exposure → soft tonemap → pastel grade → sRGB ------------
// Reinhard-Jodie tonemap (preserves hue/saturation far better than ACES — right
// call for pastels). Then a calm warm-highlight / cool-shadow split, a touch of
// saturation + shadow lift for that airy paper feel. This pass is ALWAYS last
// and writes sRGB straight to screen.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.06 },// slight overall brighten (airy, not moody)
    uSat: { value: 1.06 },     // gentle saturation
    uLift: { value: 0.010 },   // tiny floor lift → soft, never milky
    uWarm: { value: 0.5 },     // warmth as a *hue* shift, luminance-preserved
    uVignette: { value: 0.05 },// barely-there edge settle (0 = none)
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse;
    uniform float uExposure, uSat, uLift, uWarm, uVignette;
    float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c *= uExposure;
      // soft highlight knee — only tames hot spots (>~0.9), midtones pass through
      // unchanged so the frame does NOT darken. (No global Reinhard.)
      c = c / (1.0 + 0.16 * max(c - 0.9, 0.0));
      // airy floor lift
      c = c * (1.0 - uLift) + uLift;
      float l = luma(c);
      // saturation
      c = mix(vec3(l), c, uSat);
      // warmth as a hue shift that PRESERVES luminance (warm without dimming):
      // tint slightly warm, then renormalise back to the original luma.
      vec3 warmed = c * vec3(1.0, 0.975, 0.94);
      warmed *= l / max(luma(warmed), 1e-4);
      c = mix(c, warmed, uWarm);
      // whisper-soft vignette (no tint, no crush)
      float v = smoothstep(0.55, 1.0, distance(vUv, vec2(0.5)));
      c *= 1.0 - uVignette * v;
      c = clamp(c, 0.0, 1.0);
      // linear → sRGB
      c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export const FX = (() => {
  let renderer, scene, camera, composer;
  let renderPass, gtaoPass, tiltPass, bloomPass, gradePass;
  let skyTex = null, flatSky = null;
  let preset = 'off', ok = false, w = 1280, h = 800;

  function init(opts) {
    renderer = opts.renderer; scene = opts.scene; camera = opts.camera;
    flatSky = scene.background;                         // remember the flat fill
    try { skyTex = gradientSkyTex(opts.skyColor, opts.groundColor); } catch (e) { skyTex = null; }
    try {
      renderer.toneMapping = THREE.NoToneMapping;       // grade pass owns tonemapping
      composer = new EffectComposer(renderer);
      renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      // GTAO (full only) is inserted lazily after the render pass — see ensureGtao().
      bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.26, 0.6, 0.86);
      tiltPass = new ShaderPass(TiltShiftShader);
      gradePass = new ShaderPass(GradeShader);
      composer.addPass(bloomPass);
      composer.addPass(tiltPass);
      composer.addPass(gradePass);
      ok = true;
      setPreset('off');
    } catch (e) {
      console.warn('[fx] composer init failed, plain render:', e);
      ok = false;
    }
    return ok;
  }

  // GTAO is loaded lazily the first time 'full' is requested (keeps the base
  // import graph small and tolerant of a missing addon).
  let gtaoTried = false;
  async function ensureGtao() {
    if (gtaoTried || !ok) return;
    gtaoTried = true;
    try {
      const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
      gtaoPass = new GTAOPass(scene, camera, w, h);
      gtaoPass.output = GTAOPass.OUTPUT.Default;
      // gentle: small radius + low blend so it only deepens the paper seams.
      // NOTE: transparent billboards (Shen/NPCs/pickups) are treated as solid
      // occluders by screen-space AO → dark halos. Taming blend keeps that subtle;
      // a real fix needs a depth-prepass that excludes the alpha-cut cutouts.
      if (gtaoPass.updateGtaoMaterial) {
        gtaoPass.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1.0, thickness: 1.0,
          scale: 1.0, samples: 16, screenSpaceRadius: false });
      }
      gtaoPass.blendIntensity = 0.5;
      // insert right after the render pass
      composer.insertPass(gtaoPass, 1);
      gtaoPass.enabled = (preset === 'full');
      gtaoPass.setSize(w, h);
    } catch (e) {
      console.warn('[fx] GTAO unavailable, full == diorama+:', e);
      gtaoPass = null;
    }
  }

  function setPreset(name) {
    if (!PRESETS.includes(name)) name = 'off';
    preset = name;
    const on = name !== 'off';
    // sky: gradient for any non-off preset, flat fill for off
    scene.background = (on && skyTex) ? skyTex : flatSky;
    if (!ok) return preset;
    const diorama = (name === 'diorama' || name === 'full');
    if (bloomPass) bloomPass.enabled = diorama;
    if (tiltPass) tiltPass.enabled = diorama;
    if (gradePass) gradePass.enabled = on;
    if (name === 'full') ensureGtao();
    if (gtaoPass) gtaoPass.enabled = (name === 'full');
    return preset;
  }

  function setSize(width, height) {
    w = width; h = height;
    if (!ok) return;
    composer.setSize(w, h);
    if (bloomPass) bloomPass.setSize(w, h);
    if (gtaoPass) gtaoPass.setSize(w, h);
    if (tiltPass) tiltPass.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  function render() {
    if (!ok || preset === 'off') { renderer.render(scene, camera); return; }
    composer.render();
  }

  return {
    init, setPreset, setSize, render,
    get preset() { return preset; },
    get ready() { return ok; },
    presets: PRESETS.slice(),
  };
})();
