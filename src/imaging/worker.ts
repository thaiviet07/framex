/// <reference lib="webworker" />
import * as ops from './ops';
import type { Gray } from './ops';
import { encodeTiff } from './tiff';
import type { Frame, MaskAsset, MaskOpKind } from '../model/types';

export type ResolvedFit = 'bleed' | 'trim';
export interface SourceSpec { assetId: string; fit: ResolvedFit }
export interface MaskSpec extends MaskAsset { resolvedFit: ResolvedFit }
export interface LayerMaskSpec {
  refs: { mask: MaskSpec; op: MaskOpKind }[];
  invert: boolean;
  chokeMm: number;
  blurMm?: number;
  binary?: boolean;
}

export type Job =
  | { type: 'register'; assetId: string; blob: Blob }
  | { type: 'forget'; assetId: string }
  | { type: 'layerMask'; spec: LayerMaskSpec; frame: Frame }
  | { type: 'maskPreview'; mask: MaskSpec; frame: Frame }
  | { type: 'maskPreviewBlob'; mask: MaskSpec; frame: Frame }
  | { type: 'artwork'; src: SourceSpec; frame: Frame }
  | { type: 'cropImage'; src: SourceSpec; frame: Frame }
  | { type: 'holoMaskImage'; spec: LayerMaskSpec; frame: Frame }
  | { type: 'analyze'; spec: LayerMaskSpec; frame: Frame; thinPx: number; safe: { x: number; y: number; w: number; h: number } }
  | { type: 'overlap'; a: LayerMaskSpec; b: LayerMaskSpec; frame: Frame }
  | { type: 'artworkStats'; src: SourceSpec; frame: Frame }
  | { type: 'plate'; spec: LayerMaskSpec; frame: Frame; dpi: number }
  | { type: 'holoPatternPlate'; styleId: string; foilId: string | null; presetFoilBlob: Blob | null; maskSpec: LayerMaskSpec | null; angleDeg: number; spacePct: number; scanlineMm: number; frame: Frame; dpi: number }
  | { type: 'artworkExport'; src: SourceSpec | null; frame: Frame; dpi: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// ---------------- caches ----------------
const blobs = new Map<string, Blob>();
const bitmaps = new Map<string, Promise<ImageBitmap>>();

class LRU<V> {
  private m = new Map<string, { v: V; size: number }>();
  private total = 0;
  constructor(private max: number) {}
  get(k: string) {
    const e = this.m.get(k);
    if (!e) return undefined;
    this.m.delete(k);
    this.m.set(k, e);
    return e.v;
  }
  set(k: string, v: V, size: number) {
    const old = this.m.get(k);
    if (old) { this.total -= old.size; this.m.delete(k); }
    this.m.set(k, { v, size });
    this.total += size;
    for (const [key, e] of this.m) {
      if (this.total <= this.max) break;
      this.m.delete(key);
      this.total -= e.size;
    }
  }
  dropWhere(fn: (k: string) => boolean) {
    for (const [k, e] of this.m) if (fn(k)) { this.m.delete(k); this.total -= e.size; }
  }
}
const rgbaCache = new LRU<Uint8ClampedArray>(260 * 1024 * 1024);
const maskCache = new LRU<Gray>(160 * 1024 * 1024);

function bitmap(id: string): Promise<ImageBitmap> {
  let p = bitmaps.get(id);
  if (!p) {
    const b = blobs.get(id);
    if (!b) return Promise.reject(new Error(`Asset ${id} chưa được đăng ký`));
    p = createImageBitmap(b);
    bitmaps.set(id, p);
  }
  return p;
}

const fkey = (f: Frame) => `${f.w}x${f.h}@${f.trim.x}`;

/** Rasterise a source image into the document frame (cover-fit into bleed or trim box). */
async function rasterize(src: SourceSpec, frame: Frame): Promise<Uint8ClampedArray> {
  const key = `${src.assetId}|${src.fit}|${fkey(frame)}`;
  const hit = rgbaCache.get(key);
  if (hit) return hit;
  const bmp = await bitmap(src.assetId);
  const cv = new OffscreenCanvas(frame.w, frame.h);
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const box = src.fit === 'bleed' ? { x: 0, y: 0, w: frame.w, h: frame.h } : frame.trim;
  const s = Math.max(box.w / bmp.width, box.h / bmp.height);
  const dw = bmp.width * s, dh = bmp.height * s;
  g.drawImage(bmp, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  const data = g.getImageData(0, 0, frame.w, frame.h).data;
  rgbaCache.set(key, data, data.byteLength);
  return data;
}

async function maskAsset(m: MaskSpec, frame: Frame): Promise<Gray> {
  const key = `${JSON.stringify(m)}|${fkey(frame)}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  let g: Gray;
  if (m.mode === 'solid' || !m.sourceId) {
    g = ops.gray(frame.w, frame.h, 255);
  } else if (!blobs.has(m.sourceId)) {
    g = ops.gray(frame.w, frame.h, 0);
  } else {
    const px = await rasterize({ assetId: m.sourceId, fit: m.resolvedFit }, frame);
    const box = m.resolvedFit === 'bleed' ? { x: 0, y: 0, w: frame.w, h: frame.h } : frame.trim;
    g = ops.rgbaToMask(px, frame.w, frame.h, m.mode, m.color, m.tolerance, m.softness, box);
  }
  ops.levels(g, m.levelsLow, m.levelsHigh);
  if (m.threshold !== null && m.threshold !== undefined) ops.threshold(g, m.threshold);
  if (m.chokeMm) ops.morph(g, m.chokeMm * frame.ppmm);
  if (m.featherMm > 0) ops.blur(g, m.featherMm * frame.ppmm);
  if (m.invert) ops.invert(g);
  maskCache.set(key, g, g.data.byteLength);
  return g;
}

async function layerMask(spec: LayerMaskSpec, frame: Frame): Promise<Gray> {
  const key = `L|${JSON.stringify(spec)}|${fkey(frame)}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  let g = ops.gray(frame.w, frame.h);
  for (let i = 0; i < spec.refs.length; i++) {
    const r = spec.refs[i];
    const m = await maskAsset(r.mask, frame);
    // an intersect as first operation intersects with "everything" => the mask itself
    ops.combine(g, m, i === 0 && r.op === 'intersect' ? 'add' : r.op);
  }
  if (spec.chokeMm) g = ops.morph(g, spec.chokeMm * frame.ppmm);
  if (spec.invert) ops.invert(g);
  if (spec.binary) ops.threshold(g, 128);
  if (spec.blurMm && spec.blurMm > 0) ops.blur(g, spec.blurMm * frame.ppmm);
  maskCache.set(key, g, g.data.byteLength);
  return g;
}

function cropRGBA(px: Uint8ClampedArray, frame: Frame): ImageData {
  const { x, y, w, h } = frame.trim;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * frame.w + x) * 4;
    out.set(px.subarray(s, s + w * 4), row * w * 4);
  }
  return new ImageData(out, w, h);
}

async function toBlob(img: ImageData, type = 'image/png', quality = 0.92): Promise<Blob> {
  const cv = new OffscreenCanvas(img.width, img.height);
  cv.getContext('2d')!.putImageData(img, 0, 0);
  return cv.convertToBlob({ type, quality });
}

function rgbOnWhite(px: Uint8ClampedArray, n: number): Uint8Array {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    out[i * 3] = px[i * 4] * a + 255 * (1 - a);
    out[i * 3 + 1] = px[i * 4 + 1] * a + 255 * (1 - a);
    out[i * 3 + 2] = px[i * 4 + 2] * a + 255 * (1 - a);
  }
  return out;
}

function fracInside(g: Gray, t = 128) {
  return ops.coverage(g, t);
}

async function handle(job: Job): Promise<{ result: unknown; transfer?: Transferable[] }> {
  switch (job.type) {
    case 'register':
      blobs.set(job.assetId, job.blob);
      return { result: true };
    case 'forget':
      blobs.delete(job.assetId);
      bitmaps.get(job.assetId)?.then((b) => b.close());
      bitmaps.delete(job.assetId);
      rgbaCache.dropWhere((k) => k.startsWith(job.assetId));
      return { result: true };
    case 'layerMask': {
      const g = await layerMask(job.spec, job.frame);
      const copy = new Uint8Array(g.data);
      return { result: { w: g.w, h: g.h, data: copy }, transfer: [copy.buffer] };
    }
    case 'maskPreview': {
      const g = await maskAsset(job.mask, job.frame);
      const copy = new Uint8Array(g.data);
      return { result: { w: g.w, h: g.h, data: copy }, transfer: [copy.buffer] };
    }
    case 'maskPreviewBlob': {
      const g = await maskAsset(job.mask, job.frame);
      const n = g.w * g.h;
      const rgba = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        const v = g.data[i];
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
      return { result: await toBlob(new ImageData(rgba, g.w, g.h), 'image/webp', 0.9) };
    }
    case 'artwork': {
      const px = await rasterize(job.src, job.frame);
      const copy = new Uint8ClampedArray(px);
      return { result: { w: job.frame.w, h: job.frame.h, data: copy }, transfer: [copy.buffer] };
    }
    case 'cropImage': {
      const px = await rasterize(job.src, job.frame);
      return { result: await toBlob(cropRGBA(px, job.frame), 'image/webp', 0.95) };
    }
    case 'holoMaskImage': {
      const g = await layerMask(job.spec, job.frame);
      const n = g.w * g.h;
      const rgba = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
        rgba[i * 4 + 3] = g.data[i];
      }
      return { result: await toBlob(cropRGBA(rgba, job.frame)) };
    }
    case 'analyze': {
      const g = await layerMask(job.spec, job.frame);
      const cov = fracInside(g);
      const box = ops.bbox(g, 128);
      let thinFrac = 0;
      let thinBox: ops.BBox | null = null;
      if (job.thinPx >= 1 && cov > 0) {
        const thin = ops.thinFeatures(g, job.thinPx);
        thinFrac = fracInside(thin) / Math.max(cov, 1e-9);
        thinBox = ops.bbox(thin, 128);
      }
      // pixels outside the safe zone (but inside the frame)
      const s = job.safe;
      const out = ops.gray(g.w, g.h);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) continue;
        out.data[y * g.w + x] = g.data[y * g.w + x];
      }
      const outsideFrac = fracInside(out);
      return { result: { coverage: cov, bbox: box, thinFrac, thinBox, outsideFrac, outsideBox: ops.bbox(out, 128) } };
    }
    case 'overlap': {
      const a = ops.cloneGray(await layerMask(job.a, job.frame));
      const b = await layerMask(job.b, job.frame);
      ops.combine(a, b, 'intersect');
      return { result: { frac: fracInside(a, 64), bbox: ops.bbox(a, 64) } };
    }
    case 'artworkStats': {
      const px = await rasterize(job.src, job.frame);
      // bleed coverage: fraction of bleed ring that is opaque
      const { w, h, trim } = job.frame;
      let ring = 0, filled = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x >= trim.x && x < trim.x + trim.w && y >= trim.y && y < trim.y + trim.h) continue;
        ring++;
        if (px[(y * w + x) * 4 + 3] > 200) filled++;
      }
      return { result: { bleedFill: ring ? filled / ring : 1 } };
    }
    case 'plate': {
      const g = await layerMask(job.spec, job.frame);
      // plates: tint 0..255 (255 = full ink). TIFF stored MinIsBlack inverted so ink shows black.
      const tint = new Uint8Array(g.data);
      const view = new Uint8Array(tint.length);
      for (let i = 0; i < tint.length; i++) view[i] = 255 - tint[i];
      const tiff = encodeTiff(view, g.w, g.h, 1, job.dpi);
      return { result: { w: g.w, h: g.h, tint, tiff }, transfer: [tint.buffer, tiff.buffer] };
    }
    case 'holoPatternPlate': {
      const { w, h, ppmm } = job.frame;
      const n = w * h;
      const pat = new Uint8Array(n);
      const isVerticalHolo = /regular-holo|tg-holo|reverse-holo|v$/.test(job.styleId);
      const isCrosshatch = /radiant/.test(job.styleId);

      if (isVerticalHolo) {
        // Exact Regular Holo vertical scanlines matching optical.scanlineMm 1:1 with preview & MP4
        const scanPeriod = Math.max(2, Math.round((job.scanlineMm || 0.7) * ppmm));
        const barPeriod = Math.max(24, Math.round(w * 0.14));
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const scan = (x % scanPeriod) < scanPeriod * 0.5 ? 0.28 : 0.94;
            const bx = (x % barPeriod) / barPeriod;
            const bar =
              (bx > 0.14 && bx < 0.24 ? 1.0 : 0.0) +
              (bx > 0.27 && bx < 0.34 ? 0.85 : 0.0);
            const v = Math.min(1, scan * (0.55 + 0.45 * bar));
            pat[row + x] = Math.round(v * 255);
          }
        }
      } else if (isCrosshatch) {
        // Radiant Rare 45° / -45° crosshatch diamond grating
        const step = Math.max(6, Math.round(0.7 * ppmm));
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const d1 = ((x + y) % step) < step * 0.35 ? 1 : 0;
            const d2 = (((x - y) % step) + step) % step < step * 0.35 ? 1 : 0;
            pat[row + x] = Math.round((0.25 + 0.75 * Math.max(d1, d2)) * 255);
          }
        }
      } else if (job.foilId && blobs.has(job.foilId)) {
        const px = await rasterize({ assetId: job.foilId, fit: 'bleed' }, job.frame);
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          pat[i] = Math.round((0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) * (px[o + 3] / 255));
        }
      } else if (job.presetFoilBlob) {
        // Rasterize the actual preset pattern image (e.g. pokeball, masterball, cosmos, trainerbg, geometric, ancient)
        const bmp = await createImageBitmap(job.presetFoilBlob);
        const cv = new OffscreenCanvas(w, h);
        const g = cv.getContext('2d', { willReadFrequently: true })!;
        const s = Math.max(w / bmp.width, h / bmp.height);
        const dw = bmp.width * s, dh = bmp.height * s;
        g.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
        bmp.close();
        const px = g.getImageData(0, 0, w, h).data;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          pat[i] = Math.round((0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) * (px[o + 3] / 255));
        }
      } else {
        // Fallback directional holo diffraction grating matching optical angle & spacing
        const rad = (job.angleDeg * Math.PI) / 180;
        const dx = Math.cos(rad);
        const dy = Math.sin(rad);
        const periodPx = Math.max(8, (job.spacePct / 100) * Math.min(w, h) * 1.4);
        const k = (Math.PI * 2) / periodPx;
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const v = 0.5 + 0.5 * Math.sin((x * dx + y * dy) * k);
            pat[row + x] = Math.round(v * 255);
          }
        }
      }
      if (job.maskSpec && job.maskSpec.refs.length > 0) {
        const m = await layerMask(job.maskSpec, job.frame);
        for (let i = 0; i < n; i++) pat[i] = Math.round((pat[i] * m.data[i]) / 255);
      }
      const view = new Uint8Array(n);
      for (let i = 0; i < n; i++) view[i] = 255 - pat[i];
      const tiff = encodeTiff(view, w, h, 1, job.dpi);
      return { result: { w, h, tint: pat, tiff }, transfer: [pat.buffer, tiff.buffer] };
    }
    case 'artworkExport': {
      const n = job.frame.w * job.frame.h;
      const px = job.src && blobs.has(job.src.assetId) ? await rasterize(job.src, job.frame) : new Uint8ClampedArray(n * 4);
      const rgb = rgbOnWhite(px, n);
      const tiff = encodeTiff(rgb, job.frame.w, job.frame.h, 3, job.dpi);
      const rgbCopy = new Uint8Array(rgb);
      return { result: { w: job.frame.w, h: job.frame.h, rgb: rgbCopy, tiff }, transfer: [rgbCopy.buffer, tiff.buffer] };
    }
  }
}

// Coalesce incoming jobs during heavy operations so intermediate slider ticks are superseded in O(1)
const inbox: { ids: number[]; job: Job; sig: string | null }[] = [];
let processing = false;

function jobSignature(job: Job): string | null {
  switch (job.type) {
    case 'maskPreview':
    case 'maskPreviewBlob':
      return `${job.type}:${job.mask.id}:${job.frame.w}x${job.frame.h}`;
    case 'artwork':
    case 'cropImage':
      return `${job.type}:${job.src.assetId}:${job.src.fit}:${job.frame.w}x${job.frame.h}`;
    default:
      return null;
  }
}

async function pumpInbox() {
  if (processing) return;
  processing = true;
  while (inbox.length > 0) {
    const item = inbox.shift()!;
    try {
      const { result, transfer } = await handle(item.job);
      if (item.ids.length === 1) {
        ctx.postMessage({ id: item.ids[0], ok: true, result }, transfer ?? []);
      } else {
        for (const id of item.ids) ctx.postMessage({ id, ok: true, result });
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      for (const id of item.ids) ctx.postMessage({ id, ok: false, error: msg });
    }
  }
  processing = false;
}

ctx.onmessage = (e: MessageEvent<{ id: number; job: Job }>) => {
  const { id, job } = e.data;
  const sig = jobSignature(job);
  if (sig) {
    const existing = inbox.find((x) => x.sig === sig);
    if (existing) {
      existing.job = job;
      if (id) existing.ids.push(id);
      void pumpInbox();
      return;
    }
  }
  inbox.push({ ids: id ? [id] : [], job, sig });
  void pumpInbox();
};
