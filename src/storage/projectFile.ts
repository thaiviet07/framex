import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Asset, AssetMeta, Project } from '../model/types';

interface Manifest {
  project: Project;
  assets: AssetMeta[];
}

export async function packProject(project: Project, assetList: Asset[]): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const metas: AssetMeta[] = [];
  for (const a of assetList) {
    const buf = new Uint8Array(await a.blob.arrayBuffer());
    files[`assets/${a.id}`] = buf;
    metas.push({ id: a.id, name: a.name, type: a.type, width: a.width, height: a.height });
  }
  const manifest: Manifest = { project, assets: metas };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/octet-stream' });
}

export async function unpackProject(file: Blob): Promise<{ project: Project; assets: Asset[] }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(buf);
  const raw = files['manifest.json'];
  if (!raw) throw new Error('File .fxholo không hợp lệ (thiếu manifest.json)');
  const manifest = JSON.parse(strFromU8(raw)) as Manifest;
  const restored: Asset[] = [];
  for (const m of manifest.assets) {
    const data = files[`assets/${m.id}`];
    if (!data) continue;
    restored.push({ ...m, blob: new Blob([data.buffer as ArrayBuffer], { type: m.type }) });
  }
  return { project: manifest.project, assets: restored };
}
