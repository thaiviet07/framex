import type { Asset, AssetMeta } from './types';
import { uid } from '../core/math';

/**
 * Immutable binary assets (images). Projects reference assets by id, so undo/redo
 * snapshots stay tiny. Object URLs are created lazily and cached.
 */
class AssetStore {
  private map = new Map<string, Asset>();
  private urls = new Map<string, string>();
  private listeners = new Set<() => void>();

  async add(blob: Blob, name: string, id = uid('asset')): Promise<Asset> {
    const bmp = await createImageBitmap(blob);
    const asset: Asset = { id, name, type: blob.type || 'image/png', width: bmp.width, height: bmp.height, blob };
    bmp.close();
    this.map.set(id, asset);
    this.emit();
    return asset;
  }

  async addFromUrl(url: string, name: string, id?: string): Promise<Asset> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Không tải được ${url}`);
    return this.add(await res.blob(), name, id);
  }

  restore(asset: Asset) {
    this.map.set(asset.id, asset);
  }

  get(id: string | null | undefined): Asset | undefined {
    return id ? this.map.get(id) : undefined;
  }

  meta(id: string | null | undefined): AssetMeta | undefined {
    const a = this.get(id);
    if (!a) return undefined;
    const { blob: _b, ...m } = a;
    return m;
  }

  url(id: string | null | undefined): string | null {
    if (!id) return null;
    const cached = this.urls.get(id);
    if (cached) return cached;
    const a = this.map.get(id);
    if (!a) return null;
    const u = URL.createObjectURL(a.blob);
    this.urls.set(id, u);
    return u;
  }

  all(): Asset[] {
    return [...this.map.values()];
  }

  /** drop assets no longer referenced */
  gc(keep: Set<string>) {
    for (const id of [...this.map.keys()]) {
      if (keep.has(id)) continue;
      const u = this.urls.get(id);
      if (u) URL.revokeObjectURL(u);
      this.urls.delete(id);
      this.map.delete(id);
    }
  }

  clear() {
    this.gc(new Set());
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((f) => f());
  }
}

export const assets = new AssetStore();
