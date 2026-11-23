import type { Job, LayerMaskSpec, MaskSpec, SourceSpec } from './worker';
import type { Frame, HoloLayer, Layer, MaskAsset, Project, Side } from '../model/types';
import { assets } from '../model/assets';
import { resolveFit } from '../model/units';

export interface GrayResult { w: number; h: number; data: Uint8Array }

/** Promise wrapper around the imaging worker; registers assets lazily. */
class ImagingClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private registered = new Set<string>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
  }

  private call<T>(job: Job): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, job });
    });
  }

  private ensure(ids: (string | null | undefined)[]) {
    for (const id of ids) {
      if (!id || this.registered.has(id)) continue;
      const a = assets.get(id);
      if (!a) continue;
      this.registered.add(id);
      this.worker.postMessage({ id: 0, job: { type: 'register', assetId: id, blob: a.blob } satisfies Job });
    }
  }

  forget(id: string) {
    if (!this.registered.delete(id)) return;
    void this.call({ type: 'forget', assetId: id });
  }

  // ---------- spec builders ----------
  maskSpec(p: Project, m: MaskAsset): MaskSpec {
    const meta = assets.meta(m.sourceId);
    const resolvedFit = meta ? resolveFit(m.fit, meta.width, meta.height, p.specs) : 'bleed';
    return { ...m, resolvedFit };
  }

  layerSpec(p: Project, l: Layer, extra: Partial<LayerMaskSpec> = {}): LayerMaskSpec {
    const refs = l.masks
      .map((r) => {
        const m = p.masks.find((x) => x.id === r.maskId);
        return m ? { mask: this.maskSpec(p, m), op: r.op } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    return { refs, invert: l.invert, chokeMm: l.chokeMm, ...extra };
  }

  sourceSpec(p: Project, side: Side): SourceSpec | null {
    const sd = p.sides[side];
    const meta = assets.meta(sd.artworkId);
    if (!meta || !sd.artworkId) return null;
    return { assetId: sd.artworkId, fit: resolveFit(sd.fit, meta.width, meta.height, p.specs) };
  }

  private idsOf(spec: LayerMaskSpec) {
    return spec.refs.map((r) => r.mask.sourceId);
  }

  // ---------- jobs ----------
  layerMask(spec: LayerMaskSpec, frame: Frame) {
    this.ensure(this.idsOf(spec));
    return this.call<GrayResult>({ type: 'layerMask', spec, frame });
  }

  maskPreview(mask: MaskSpec, frame: Frame) {
    this.ensure([mask.sourceId]);
    return this.call<GrayResult>({ type: 'maskPreview', mask, frame });
  }

  maskPreviewBlob(mask: MaskSpec, frame: Frame) {
    this.ensure([mask.sourceId]);
    return this.call<Blob>({ type: 'maskPreviewBlob', mask, frame });
  }

  artwork(src: SourceSpec, frame: Frame) {
    this.ensure([src.assetId]);
    return this.call<{ w: number; h: number; data: Uint8ClampedArray }>({ type: 'artwork', src, frame });
  }

  cropImage(src: SourceSpec, frame: Frame) {
    this.ensure([src.assetId]);
    return this.call<Blob>({ type: 'cropImage', src, frame });
  }

  holoMaskSpec(p: Project, hl: HoloLayer): LayerMaskSpec {
    const refs = hl.masks
      .map((r) => {
        const m = p.masks.find((x) => x.id === r.maskId);
        return m ? { mask: this.maskSpec(p, m), op: r.op } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    return {
      refs,
      invert: hl.masking.invert,
      chokeMm: hl.masking.chokeMm,
      blurMm: hl.masking.featherMm,
    };
  }

  holoMaskImage(spec: LayerMaskSpec, frame: Frame) {
    this.ensure(this.idsOf(spec));
    return this.call<Blob>({ type: 'holoMaskImage', spec, frame });
  }

  analyze(spec: LayerMaskSpec, frame: Frame, thinPx: number, safe: Frame['trim']) {
    this.ensure(this.idsOf(spec));
    return this.call<{
      coverage: number;
      bbox: Frame['trim'] | null;
      thinFrac: number;
      thinBox: Frame['trim'] | null;
      outsideFrac: number;
      outsideBox: Frame['trim'] | null;
    }>({ type: 'analyze', spec, frame, thinPx, safe });
  }

  overlap(a: LayerMaskSpec, b: LayerMaskSpec, frame: Frame) {
    this.ensure([...this.idsOf(a), ...this.idsOf(b)]);
    return this.call<{ frac: number; bbox: Frame['trim'] | null }>({ type: 'overlap', a, b, frame });
  }

  artworkStats(src: SourceSpec, frame: Frame) {
    this.ensure([src.assetId]);
    return this.call<{ bleedFill: number }>({ type: 'artworkStats', src, frame });
  }

  plate(spec: LayerMaskSpec, frame: Frame, dpi: number) {
    this.ensure(this.idsOf(spec));
    return this.call<{ w: number; h: number; tint: Uint8Array; tiff: Uint8Array }>({ type: 'plate', spec, frame, dpi });
  }

  holoPatternPlate(
    styleId: string,
    foilId: string | null,
    presetFoilBlob: Blob | null,
    maskSpec: LayerMaskSpec | null,
    angleDeg: number,
    spacePct: number,
    scanlineMm: number,
    frame: Frame,
    dpi: number,
  ) {
    const validFoilId = foilId && assets.get(foilId) ? foilId : null;
    this.ensure([validFoilId, ...(maskSpec ? this.idsOf(maskSpec) : [])]);
    return this.call<{ w: number; h: number; tint: Uint8Array; tiff: Uint8Array }>({
      type: 'holoPatternPlate',
      styleId,
      foilId: validFoilId,
      presetFoilBlob,
      maskSpec,
      angleDeg,
      spacePct,
      scanlineMm,
      frame,
      dpi,
    });
  }

  artworkExport(src: SourceSpec | null, frame: Frame, dpi: number) {
    if (src) this.ensure([src.assetId]);
    return this.call<{ w: number; h: number; rgb: Uint8Array; tiff: Uint8Array }>({ type: 'artworkExport', src, frame, dpi });
  }
}

export const imaging = new ImagingClient();
