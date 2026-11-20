/**
 * Pure image operations on 8‑bit single channel buffers. Runs inside the worker
 * (and is unit-friendly). Everything is O(w·h) or O(w·h·r) with small r.
 */
export interface Gray {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export const gray = (w: number, h: number, fill = 0): Gray => {
  const data = new Uint8ClampedArray(w * h);
  if (fill) data.fill(fill);
  return { w, h, data };
};

export const cloneGray = (g: Gray): Gray => ({ w: g.w, h: g.h, data: new Uint8ClampedArray(g.data) });

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Convert RGBA pixels to a mask according to the mask mode. */
export function rgbaToMask(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  mode: 'luminance' | 'alpha' | 'color',
  color = '#ffffff',
  tolerance = 20,
  softness = 10,
  sampleBox: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w, h },
): Gray {
  const out = gray(w, h);
  const d = out.data;
  const n = w * h;
  if (mode === 'alpha') {
    for (let i = 0; i < n; i++) d[i] = px[i * 4 + 3];
    return out;
  }
  if (mode === 'color') {
    const [cr, cg, cb] = hexToRgb(color);
    const tol = (tolerance / 100) * 441.7;
    const soft = Math.max(1, (softness / 100) * 441.7);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const dr = px[o] - cr, dg = px[o + 1] - cg, db = px[o + 2] - cb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      const v = dist <= tol ? 1 : Math.max(0, 1 - (dist - tol) / soft);
      d[i] = v * px[o + 3];
    }
    return out;
  }
  // luminance: detect true image alpha ONLY inside sampleBox (ignore transparent bleed ring)
  let translucent = 0;
  const x0 = Math.max(0, sampleBox.x);
  const y0 = Math.max(0, sampleBox.y);
  const x1 = Math.min(w, sampleBox.x + sampleBox.w);
  const y1 = Math.min(h, sampleBox.y + sampleBox.h);
  const boxArea = Math.max(1, (x1 - x0) * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) {
      if (px[(row + x) * 4 + 3] < 250) translucent++;
    }
  }
  const hasAlpha = translucent > boxArea * 0.005;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (hasAlpha) d[i] = px[o + 3];
    else d[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) * (px[o + 3] / 255);
  }
  return out;
}

export function invert(g: Gray): Gray {
  const d = g.data;
  for (let i = 0; i < d.length; i++) d[i] = 255 - d[i];
  return g;
}

export function levels(g: Gray, lo: number, hi: number): Gray {
  if (lo <= 0 && hi >= 255) return g;
  const span = Math.max(1, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = ((i - lo) / span) * 255;
  const d = g.data;
  for (let i = 0; i < d.length; i++) d[i] = lut[d[i]];
  return g;
}

export function threshold(g: Gray, t: number): Gray {
  const d = g.data;
  for (let i = 0; i < d.length; i++) d[i] = d[i] >= t ? 255 : 0;
  return g;
}

/** one horizontal + vertical running-sum box blur pass */
function boxPass(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      const add = src[row + Math.min(w - 1, x + r + 1)];
      const sub = src[row + Math.max(0, x - r)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      acc += add - sub;
    }
  }
}

/** approximate gaussian blur (3 box passes), radius in px */
export function blur(g: Gray, radius: number): Gray {
  const r = Math.round(radius / 1.73);
  if (r < 1) return g;
  const a = g.data;
  const b = new Uint8ClampedArray(a.length);
  boxPass(a, b, g.w, g.h, r);
  boxPass(b, a, g.w, g.h, r);
  boxPass(a, b, g.w, g.h, r);
  g.data = b;
  return g;
}

/** separable max (dilate, r>0) or min (erode, r<0) with a square window */
export function morph(g: Gray, r: number): Gray {
  const rad = Math.round(Math.abs(r));
  if (rad < 1) return g;
  const isMax = r > 0;
  const { w, h } = g;
  const src = g.data;
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const pass = (read: (i: number) => number, write: (i: number, v: number) => void, len: number, lines: number) => {
    // van Herk / Gil-Werman: O(n) regardless of radius
    const win = 2 * rad + 1;
    const pad = len + 2 * rad;
    const buf = new Uint8ClampedArray(pad);
    const left = new Uint8ClampedArray(pad);
    const right = new Uint8ClampedArray(pad);
    const edge = isMax ? 0 : 255;
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < pad; i++) {
        const k = i - rad;
        buf[i] = k < 0 || k >= len ? edge : read(line * len + k);
      }
      for (let i = 0; i < pad; i++) {
        left[i] = i % win === 0 ? buf[i] : isMax ? Math.max(left[i - 1], buf[i]) : Math.min(left[i - 1], buf[i]);
      }
      for (let i = pad - 1; i >= 0; i--) {
        right[i] = i === pad - 1 || (i + 1) % win === 0 ? buf[i] : isMax ? Math.max(right[i + 1], buf[i]) : Math.min(right[i + 1], buf[i]);
      }
      for (let k = 0; k < len; k++) {
        const a = right[k];
        const b = left[k + 2 * rad];
        write(line * len + k, isMax ? Math.max(a, b) : Math.min(a, b));
      }
    }
  };
  // horizontal
  pass((i) => src[i], (i, v) => (tmp[i] = v), w, h);
  // vertical: index transposed
  pass(
    (i) => {
      const x = Math.floor(i / h), y = i % h;
      return tmp[y * w + x];
    },
    (i, v) => {
      const x = Math.floor(i / h), y = i % h;
      out[y * w + x] = v;
    },
    h,
    w,
  );
  g.data = out;
  return g;
}

export function combine(a: Gray, b: Gray, op: 'add' | 'subtract' | 'intersect' | 'xor'): Gray {
  const x = a.data, y = b.data;
  for (let i = 0; i < x.length; i++) {
    const p = x[i] / 255, q = y[i] / 255;
    let v: number;
    switch (op) {
      case 'add': v = p + q - p * q; break;
      case 'subtract': v = p * (1 - q); break;
      case 'intersect': v = p * q; break;
      case 'xor': v = p + q - 2 * p * q; break;
    }
    x[i] = v * 255;
  }
  return a;
}

export function multiplyScalar(g: Gray, k: number): Gray {
  if (k >= 1) return g;
  const d = g.data;
  for (let i = 0; i < d.length; i++) d[i] = d[i] * k;
  return g;
}

export interface BBox { x: number; y: number; w: number; h: number }

export function bbox(g: Gray, t = 8): BBox | null {
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  const d = g.data;
  for (let y = 0; y < g.h; y++) {
    const row = y * g.w;
    for (let x = 0; x < g.w; x++) {
      if (d[row + x] >= t) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function coverage(g: Gray, t = 128): number {
  let n = 0;
  const d = g.data;
  for (let i = 0; i < d.length; i++) if (d[i] >= t) n++;
  return n / d.length;
}

/** Morphological opening; returns pixels removed (features thinner than 2r). */
export function thinFeatures(g: Gray, r: number): Gray {
  const bin = threshold(cloneGray(g), 128);
  const opened = morph(morph(cloneGray(bin), -r), r);
  const out = gray(g.w, g.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = bin.data[i] > 0 && opened.data[i] === 0 ? 255 : 0;
  return out;
}
