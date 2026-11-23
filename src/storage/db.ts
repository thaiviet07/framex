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

let dbPromise: Promise<IDBDatabase> | null = null;
/** Asset ids known to be stored in IndexedDB (null until first load/save). */
let persistedIds: Set<string> | null = null;

/** Single shared connection (re-opened if the browser closes it). */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECT)) db.createObjectStore(STORE_PROJECT);
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let saveChain: Promise<void> = Promise.resolve();

/**
 * Incremental autosave: writes the (small) workspace JSON every time, but only puts assets that are new
 * and deletes assets that were garbage-collected — image blobs are never rewritten.
 */
export function saveWorkspaceTabs(ws: SavedWorkspace, assetList: Asset[]): Promise<void> {
  saveChain = saveChain.then(() => doSave(ws, assetList));
  return saveChain;
}

async function doSave(ws: SavedWorkspace, assetList: Asset[]): Promise<void> {
  try {
    const db = await openDb();
    if (!persistedIds) {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const keys = await reqResult(tx.objectStore(STORE_ASSETS).getAllKeys());
      persistedIds = new Set(keys as string[]);
    }
    const known = persistedIds;
    const wanted = new Set(assetList.map((a) => a.id));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readwrite');
      tx.objectStore(STORE_PROJECT).put(ws, 'workspace');
      const aStore = tx.objectStore(STORE_ASSETS);
      for (const a of assetList) if (!known.has(a.id)) aStore.put(a);
      for (const id of known) if (!wanted.has(id)) aStore.delete(id);
      tx.oncomplete = () => {
        persistedIds = wanted;
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    persistedIds = null; // resync from the DB on the next attempt
    console.warn('Autosave skipped:', err);
  }
}

/** Ask the browser not to evict our IndexedDB data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
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
    persistedIds = new Set(res?.assets.map((a) => a.id) ?? []);
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
    persistedIds = new Set();
  } catch {
    // ignore
  }
}
