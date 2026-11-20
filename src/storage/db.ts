import type { Asset, Project } from '../model/types';

const DB_NAME = 'framigosx-holo-studio';
const DB_VER = 1;
const STORE_PROJECT = 'project';
const STORE_ASSETS = 'assets';

export interface SavedTab {
  id: string;
  project: Project;
}

export interface SavedWorkspace {
  activeId: string;
  tabs: SavedTab[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECT)) db.createObjectStore(STORE_PROJECT);
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWorkspaceTabs(ws: SavedWorkspace, assetList: Asset[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readwrite');
      tx.objectStore(STORE_PROJECT).put(ws, 'workspace');
      const aStore = tx.objectStore(STORE_ASSETS);
      aStore.clear();
      for (const a of assetList) aStore.put(a);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Autosave skipped:', err);
  }
}

export async function loadWorkspaceTabs(): Promise<{ workspace: SavedWorkspace; assets: Asset[] } | null> {
  try {
    const db = await openDb();
    const res = await new Promise<{ workspace: SavedWorkspace; assets: Asset[] } | null>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readonly');
      const wsReq = tx.objectStore(STORE_PROJECT).get('workspace');
      const legacyReq = tx.objectStore(STORE_PROJECT).get('current');
      const aReq = tx.objectStore(STORE_ASSETS).getAll();
      tx.oncomplete = () => {
        const assetList = (aReq.result as Asset[]) ?? [];
        if (wsReq.result && Array.isArray((wsReq.result as SavedWorkspace).tabs) && (wsReq.result as SavedWorkspace).tabs.length > 0) {
          resolve({ workspace: wsReq.result as SavedWorkspace, assets: assetList });
        } else if (legacyReq.result) {
          const p = legacyReq.result as Project;
          resolve({ workspace: { activeId: 'tab_1', tabs: [{ id: 'tab_1', project: p }] }, assets: assetList });
        } else {
          resolve(null);
        }
      };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export async function clearWorkspace(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readwrite');
      tx.objectStore(STORE_PROJECT).clear();
      tx.objectStore(STORE_ASSETS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}
