import type { CardState } from '../card/HoloCard';
import type { EnvConfig, Frame, Layer, Substrate } from '../model/types';
import { defaultEnvConfig } from '../model/env';
import { foilColor } from '../model/techniques';

const VERT = `
attribute vec2 aPos;
uniform vec4 uTrim;
varying vec2 vUv;
void main() {
  vec2 unit = aPos * 0.5 + 0.5;
  // flip Y so image top = top of card
  vec2 flipped = vec2(unit.x, 1.0 - unit.y);
  vUv = uTrim.xy + flipped * uTrim.zw;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uMask;
uniform sampler2D uArtwork;
uniform sampler2D uEnvMap;
uniform int uHasArtwork;
uniform int uHasEnv;
uniform float uEnvRot;      // radians
uniform float uEnvExp;      // exposure multiplier (0.3..2.5)
uniform float uEnvTemp;     // -1..+1 (cool..warm)
uniform float uEnvElev;     // radians
uniform vec2 uTexel;
uniform vec3 uLight;
uniform vec2 uPointer;
uniform float uGlare;
uniform int uKind;        // 0:hot, 1:cold, 2:spotuv, 3:matte, 4:emboss, 5:deboss, 6:texture, 7:white-ink
uniform float uOpacity;
uniform vec3 uColor;      // foil rgb
uniform int uFoilMode;    // 0:solid, 1:holo, 2:rainbow
uniform float uP1;        // roughness / overprint / gloss / strength / depth / scale / density
uniform float uP2;        // brightness / roughness / raised / 0 / bevel / strength / 0
uniform int uPattern;     // 0:sandpaper, 1:linen, 2:etched, 3:carbon, 4:dots
uniform int uSubstrate;   // 0:white, 1:metallic

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 rainbow(float t) {
  return 0.55 + 0.45 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

vec3 tempTint(vec3 c, float temp) {
  vec3 warm = vec3(1.0 + max(temp, 0.0) * 0.28, 1.0 + max(temp, 0.0) * 0.05, 1.0 - max(temp, 0.0) * 0.26);
  vec3 cool = vec3(1.0 - max(-temp, 0.0) * 0.22, 1.0 + max(-temp, 0.0) * 0.02, 1.0 + max(-temp, 0.0) * 0.30);
  return c * warm * cool;
}

vec3 sampleEnv(vec3 dir) {
  if (uHasEnv == 0) return tempTint(vec3(0.85), uEnvTemp) * uEnvExp;
  vec3 d = normalize(dir);
  float c = cos(uEnvRot);
  float s = sin(uEnvRot);
  vec3 r = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
  float u = fract(atan(r.x, r.z) / 6.2831853 + 0.5);
  float v = clamp(0.5 - asin(clamp(r.y, -1.0, 1.0)) / 3.14159265, 0.02, 0.98);
  vec3 env = texture2D(uEnvMap, vec2(u, v)).rgb;
  return tempTint(env, uEnvTemp) * uEnvExp;
}

vec2 maskGrad(vec2 uv, float spread) {
  vec2 t = uTexel * spread;
  float tl = texture2D(uMask, uv + vec2(-t.x, -t.y)).r;
  float tc = texture2D(uMask, uv + vec2( 0.0, -t.y)).r;
  float tr = texture2D(uMask, uv + vec2( t.x, -t.y)).r;
  float ml = texture2D(uMask, uv + vec2(-t.x,  0.0)).r;
  float mr = texture2D(uMask, uv + vec2( t.x,  0.0)).r;
  float bl = texture2D(uMask, uv + vec2(-t.x,  t.y)).r;
  float bc = texture2D(uMask, uv + vec2( 0.0,  t.y)).r;
  float br = texture2D(uMask, uv + vec2( t.x,  t.y)).r;
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  return vec2(gx, gy);
}

vec3 microNormal(vec2 uv, float scale, int pat) {
  vec2 p = uv * vec2(220.0, 308.0) * scale;
  float gx = 0.0, gy = 0.0;
  if (pat == 0) { // sandpaper
    vec2 cell = floor(p);
    gx = hash(cell) - 0.5;
    gy = hash(cell + 19.37) - 0.5;
  } else if (pat == 1) { // linen
    gx = sin(p.x * 1.4) * 0.55;
    gy = sin(p.y * 1.4) * 0.55;
  } else if (pat == 2) { // etched lines
    float d = sin((p.x + p.y) * 1.2);
    gx = d * 0.6;
    gy = d * 0.6;
  } else if (pat == 3) { // carbon weave
    vec2 f = fract(p * 0.35);
    float checker = mod(floor(p.x * 0.35) + floor(p.y * 0.35), 2.0);
    gx = (checker > 0.5 ? sin(f.x * 6.28318) : sin(f.y * 6.28318)) * 0.5;
    gy = (checker > 0.5 ? 0.15 : -0.15);
  } else { // dots
    vec2 f = fract(p * 0.5) - 0.5;
    float r = length(f);
    float ring = smoothstep(0.35, 0.18, r);
    gx = f.x * ring * 2.2;
    gy = f.y * ring * 2.2;
  }
  return normalize(vec3(gx, gy, 1.0));
}

void main() {
  float m = texture2D(uMask, vUv).r;
  vec3 L = normalize(uLight);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  // 7: White ink underbase (only visually distinct on metallic substrate)
  if (uKind == 7) {
    if (uSubstrate == 0) discard;
    float metalMask = clamp(1.0 - m * uP1, 0.0, 1.0);
    if (metalMask < 0.004) discard;
    float sheen = pow(max(dot(vec3(0.0, 0.0, 1.0), H), 0.0), 10.0);
    float band = 0.5 + 0.5 * sin((vUv.x * 4.0 + vUv.y * 2.0 + uLight.x * 2.5) * 3.14159);
    vec3 envRefl = sampleEnv(normalize(vec3(uLight.x * 0.7 + (vUv.x - 0.5) * 0.6, uLight.y * 0.7 - (vUv.y - 0.5) * 0.6, 0.85)));
    vec3 col = mix(vec3(0.68, 0.72, 0.76), envRefl * 1.15 + vec3(0.25), sheen * 0.55 + band * 0.3);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), metalMask * 0.4 * uOpacity);
    return;
  }

  if (m < 0.004) discard;

  // 0: Hot foil
  if (uKind == 0) {
    float rough = clamp(uP1, 0.04, 1.0);
    float bright = uP2;
    vec2 g = maskGrad(vUv, 1.5);
    vec3 N = normalize(vec3(-g * 0.18, 1.0));
    float specPow = mix(90.0, 8.0, rough);
    float spec = pow(max(dot(N, H), 0.0), specPow);
    float aniso = 0.5 + 0.5 * sin((vUv.x * 5.0 - vUv.y * 3.5 + uLight.x * 3.2 - uLight.y * 2.4) * 3.14159);
    float sweep = pow(aniso, mix(4.0, 1.5, rough));
    vec3 R = normalize(reflect(-V, N) + vec3(uLight.x * 0.65 + (vUv.x - 0.5) * 0.55, uLight.y * 0.65 - (vUv.y - 0.5) * 0.55, 0.0));
    vec3 envRefl = sampleEnv(R);
    vec3 baseCol = uColor;
    if (uFoilMode == 1) {
      baseCol = mix(vec3(0.82, 0.85, 0.9), rainbow(vUv.x * 0.8 + vUv.y * 0.6 + uLight.x * 0.7 - uLight.y * 0.5), 0.65);
    } else if (uFoilMode == 2) {
      baseCol = rainbow(vUv.x * 1.4 - vUv.y * 0.9 + uLight.x * 1.1);
    }
    vec3 col = baseCol * (0.48 + 0.42 * sweep + envRefl * (0.62 - rough * 0.25)) * bright
      + envRefl * spec * (0.95 - rough * 0.45);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), m * uOpacity);
    return;
  }

  // 1: Cold foil (overprinted with artwork color)
  if (uKind == 1) {
    float overprint = uP1;
    float rough = clamp(uP2, 0.05, 1.0);
    vec3 art = uHasArtwork == 1 ? texture2D(uArtwork, vUv).rgb : vec3(0.75);
    vec3 metal = mix(vec3(0.84, 0.86, 0.89), art * 1.15, overprint);
    float spec = pow(max(dot(vec3(0.0, 0.0, 1.0), H), 0.0), mix(64.0, 8.0, rough));
    float band = 0.5 + 0.5 * sin((vUv.x * 4.5 + vUv.y * 2.5 + uLight.x * 2.8) * 3.14159);
    vec3 envRefl = sampleEnv(normalize(vec3(uLight.x * 0.6 + (vUv.x - 0.5) * 0.5, uLight.y * 0.6 - (vUv.y - 0.5) * 0.5, 0.85)));
    vec3 col = metal * (0.55 + 0.35 * band + envRefl * 0.48) + envRefl * spec * 0.75;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), m * uOpacity * 0.88);
    return;
  }

  // 2: Spot UV (clearcoat specular + raised edge highlight)
  if (uKind == 2) {
    float gloss = uP1;
    float raised = uP2 / 100.0;
    vec2 g = maskGrad(vUv, 1.8);
    vec3 N = normalize(vec3(-g * raised * 0.65, 1.0));
    float spec = pow(max(dot(N, H), 0.0), mix(18.0, 96.0, gloss));
    float rim = clamp(dot(N, L) - dot(vec3(0.0, 0.0, 1.0), L), -0.5, 0.8);
    float dist = length(vUv - uPointer);
    float spot = smoothstep(0.65, 0.0, dist) * (0.35 + 0.65 * uGlare);
    vec3 R = normalize(reflect(-V, N) + vec3(uLight.x * 0.75 + (vUv.x - 0.5) * 0.65, uLight.y * 0.75 - (vUv.y - 0.5) * 0.65, 0.0));
    vec3 envRefl = sampleEnv(R);
    float envLum = dot(envRefl, vec3(0.299, 0.587, 0.114));
    float hi = clamp(spec * gloss * 1.1 + spot * gloss * 0.22 + envLum * gloss * 0.38 + max(rim, 0.0) * raised * 0.75, 0.0, 1.0);
    float sh = clamp(-min(rim, 0.0) * raised * 0.55, 0.0, 0.5);
    vec3 hiCol = clamp(mix(vec3(1.0), envRefl * 1.35, 0.55), 0.0, 1.0);
    vec3 col = hi >= sh ? hiCol : vec3(0.0);
    float alpha = max(hi, sh) * m * uOpacity;
    gl_FragColor = vec4(col, alpha);
    return;
  }

  // 3: Matte / Soft-touch varnish
  if (uKind == 3) {
    float strength = uP1;
    float dull = 0.22 * strength;
    gl_FragColor = vec4(vec3(0.14, 0.14, 0.16), m * dull * uOpacity);
    return;
  }

  // 4: Emboss & 5: Deboss (directional bevel lighting from heightmap gradient)
  if (uKind == 4 || uKind == 5) {
    float depth = uP1; // mm (0.05..0.6)
    float dir = (uKind == 4) ? 1.0 : -1.0;
    vec2 g = maskGrad(vUv, 2.0);
    float scale = depth * 6.5;
    vec3 N = normalize(vec3(-g.x * scale * dir, -g.y * scale * dir, 1.0));
    float flatDiff = dot(vec3(0.0, 0.0, 1.0), L);
    float diff = dot(N, L) - flatDiff;
    float spec = pow(max(dot(N, H), 0.0), 36.0) * min(1.0, length(g) * scale * 0.8);
    float lit = (diff * 1.85 + spec * 0.45) * clamp(uEnvExp, 0.5, 1.8);
    // subtle recessed ambient occlusion for deboss
    float ao = (uKind == 5) ? m * depth * 0.32 : 0.0;
    float net = lit - ao;
    vec3 envHi = clamp(mix(vec3(1.0, 0.99, 0.97), sampleEnv(N) * 1.35, 0.45), 0.0, 1.0);
    vec3 col = net >= 0.0 ? envHi : vec3(0.02, 0.02, 0.04);
    float a = clamp(abs(net), 0.0, 0.82) * uOpacity * smoothstep(0.0, 0.05, m + length(g));
    gl_FragColor = vec4(col, a);
    return;
  }

  // 6: Texture micro-normal
  if (uKind == 6) {
    float scale = uP1;
    float strength = uP2;
    vec3 N = microNormal(vUv, scale, uPattern);
    float diff = dot(N, L) - dot(vec3(0.0, 0.0, 1.0), L);
    float spec = pow(max(dot(N, H), 0.0), 28.0);
    float v = (diff * 0.9 + spec * 0.45) * clamp(uEnvExp, 0.5, 1.8);
    vec3 envHi = clamp(mix(vec3(1.0), sampleEnv(N) * 1.3, 0.4), 0.0, 1.0);
    vec3 col = v >= 0.0 ? envHi : vec3(0.0);
    gl_FragColor = vec4(col, clamp(abs(v) * strength * 0.75, 0.0, 0.75) * m * uOpacity);
    return;
  }

  discard;
}
`;

const KIND_ID: Record<Layer['kind'], number> = {
  'foil-hot': 0,
  'foil-cold': 1,
  'spot-uv': 2,
  'varnish-matte': 3,
  emboss: 4,
  deboss: 5,
  texture: 6,
  'white-ink': 7,
};

const PATTERN_ID: Record<string, number> = { sandpaper: 0, linen: 1, etched: 2, carbon: 3, dots: 4 };

export interface LayerDraw {
  layer: Layer;
  mask: Uint8Array;
  w: number;
  h: number;
}

export class TechRenderer {
  private gl: WebGLRenderingContext | null;
  private prog: WebGLProgram | null = null;
  private buf: WebGLBuffer | null = null;
  private artworkTex: WebGLTexture | null = null;
  private hasArtwork = false;
  private envTex: WebGLTexture | null = null;
  private hasEnv = false;
  private envCfg: EnvConfig = defaultEnvConfig();
  private maskTex = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private draws: LayerDraw[] = [];
  private frame: Frame | null = null;
  private substrate: Substrate = 'white';
  private u: Record<string, WebGLUniformLocation | null> = {};
  private aPos = -1;
  /** true while the canvas holds a cleared (empty) frame — lets us skip redundant clears */
  private blank = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: false });
    this.gl = gl;
    if (!gl) return;
    this.init(gl);
  }

  private init(gl: WebGLRenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link error');
    this.prog = p;

    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const names = [
      'uTrim', 'uMask', 'uArtwork', 'uEnvMap', 'uHasArtwork', 'uHasEnv',
      'uEnvRot', 'uEnvExp', 'uEnvTemp', 'uEnvElev',
      'uTexel', 'uLight', 'uPointer', 'uGlare',
      'uKind', 'uOpacity', 'uColor', 'uFoilMode', 'uP1', 'uP2', 'uPattern', 'uSubstrate',
    ];
    for (const n of names) this.u[n] = gl.getUniformLocation(p, n);
    this.aPos = gl.getAttribLocation(p, 'aPos');

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private makeTex(gl: WebGLRenderingContext): WebGLTexture {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  setArtwork(data: Uint8ClampedArray | null, w: number, h: number) {
    const gl = this.gl;
    if (!gl) return;
    if (!data) {
      this.hasArtwork = false;
      return;
    }
    if (!this.artworkTex) this.artworkTex = this.makeTex(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.artworkTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this.hasArtwork = true;
  }

  setEnvMap(source: HTMLCanvasElement | HTMLImageElement | null) {
    const gl = this.gl;
    if (!gl) return;
    if (!source) {
      this.hasEnv = false;
      return;
    }
    if (!this.envTex) this.envTex = this.makeTex(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.envTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.hasEnv = true;
  }

  setEnvParams(cfg: EnvConfig) {
    this.envCfg = cfg;
  }

  setLayers(draws: LayerDraw[], frame: Frame, substrate: Substrate) {
    this.draws = draws;
    this.frame = frame;
    this.substrate = substrate;
    const gl = this.gl;
    if (!gl) return;

    const keep = new Set(draws.map((d) => d.layer.id));
    for (const [id, entry] of this.maskTex) {
      if (!keep.has(id)) {
        gl.deleteTexture(entry.tex);
        this.maskTex.delete(id);
      }
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const d of draws) {
      let entry = this.maskTex.get(d.layer.id);
      if (!entry) {
        entry = { tex: this.makeTex(gl), w: d.w, h: d.h };
        this.maskTex.set(d.layer.id, entry);
      }
      entry.w = d.w;
      entry.h = d.h;
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, d.w, d.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, d.mask);
    }
  }

  resize(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(width * dpr));
    const h = Math.max(2, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(state: CardState, mirrorX = false) {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    const empty = !this.draws.length || !this.frame;
    // Nothing to draw and already cleared: skip the GL work entirely (the compositor keeps the last frame).
    if (empty && this.blank) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.blank = empty;
    if (empty || !this.frame) return;

    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = this.aPos;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const { w, h, trim } = this.frame;
    gl.uniform4f(this.u.uTrim, trim.x / w, trim.y / h, trim.w / w, trim.h / h);

    // Compute light direction from card tilt + pointer + HDRI elevation/rotation
    const rxRad = (state.rx * Math.PI) / 180;
    const ryRad = (state.ry * Math.PI) / 180;
    const envRotRad = (this.envCfg.rotation * Math.PI) / 180;
    const envElevRad = (this.envCfg.elevation * Math.PI) / 180;
    const lx = (mirrorX ? -1 : 1) * (Math.sin(rxRad) * 1.45 + ((state.px - 50) / 50) * 0.7) + Math.sin(envRotRad) * 0.35;
    const ly = -Math.sin(ryRad) * 1.45 + ((state.py - 50) / 50) * 0.7 - Math.sin(envElevRad) * 0.55;
    gl.uniform3f(this.u.uLight, lx, ly, 1.0);
    gl.uniform2f(this.u.uPointer, state.px / 100, state.py / 100);
    gl.uniform1f(this.u.uGlare, state.o);
    gl.uniform1i(this.u.uSubstrate, this.substrate === 'metallic' ? 1 : 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.artworkTex);
    gl.uniform1i(this.u.uArtwork, 1);
    gl.uniform1i(this.u.uHasArtwork, this.hasArtwork ? 1 : 0);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.envTex);
    gl.uniform1i(this.u.uEnvMap, 2);
    gl.uniform1i(this.u.uHasEnv, this.hasEnv ? 1 : 0);
    gl.uniform1f(this.u.uEnvRot, envRotRad);
    gl.uniform1f(this.u.uEnvExp, this.envCfg.exposure);
    gl.uniform1f(this.u.uEnvTemp, this.envCfg.temperature / 100);
    gl.uniform1f(this.u.uEnvElev, envElevRad);

    for (const d of this.draws) {
      const l = d.layer;
      if (!l.visible) continue;
      const tex = this.maskTex.get(l.id);
      if (!tex) continue;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      gl.uniform1i(this.u.uMask, 0);
      gl.uniform2f(this.u.uTexel, 1 / tex.w, 1 / tex.h);
      gl.uniform1i(this.u.uKind, KIND_ID[l.kind]);
      gl.uniform1f(this.u.uOpacity, l.opacity);

      let p1 = 0, p2 = 0, foilMode = 0, pat = 0;
      let rgb: [number, number, number] = [1, 1, 1];
      if (l.kind === 'foil-hot') {
        const fc = foilColor(l.params.color);
        rgb = fc.rgb;
        foilMode = fc.value === 'holo' ? 1 : fc.value === 'rainbow' ? 2 : 0;
        p1 = Number(l.params.roughness ?? 0.25);
        p2 = Number(l.params.brightness ?? 1);
      } else if (l.kind === 'foil-cold') {
        p1 = Number(l.params.overprint ?? 0.85);
        p2 = Number(l.params.roughness ?? 0.3);
      } else if (l.kind === 'spot-uv') {
        p1 = Number(l.params.gloss ?? 0.8);
        p2 = Number(l.params.raised ?? 20);
      } else if (l.kind === 'varnish-matte') {
        p1 = Number(l.params.strength ?? 0.6);
      } else if (l.kind === 'emboss' || l.kind === 'deboss') {
        p1 = Number(l.params.depth ?? 0.25);
        p2 = Number(l.params.bevelMm ?? 0.35);
      } else if (l.kind === 'texture') {
        pat = PATTERN_ID[String(l.params.pattern ?? 'sandpaper')] ?? 0;
        p1 = Number(l.params.scale ?? 1);
        p2 = Number(l.params.strength ?? 0.6);
      } else if (l.kind === 'white-ink') {
        p1 = Number(l.params.density ?? 1);
      }

      gl.uniform3f(this.u.uColor, rgb[0], rgb[1], rgb[2]);
      gl.uniform1i(this.u.uFoilMode, foilMode);
      gl.uniform1f(this.u.uP1, p1);
      gl.uniform1f(this.u.uP2, p2);
      gl.uniform1i(this.u.uPattern, pat);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}
