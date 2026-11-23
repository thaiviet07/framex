import type { Layer, MaskAsset, Project, Side } from './types';
import { getLang, type Lang } from '../i18n/i18n';

export type ViewMode = 'holo' | 'flat';

export interface UIState {
  side: Side;
  view: ViewMode;
  selectedLayerId: string | null;
  soloLayerId: string | null;
  layerMaskOverlay: boolean;
  selectedHoloLayerId: string | null;
  soloHoloLayerId: string | null;
  selectedMaskId: string | null;
  tab: 'artwork' | 'holo' | 'layers' | 'masks' | 'env' | 'specs' | 'preflight' | 'export';
  guides: boolean;
  auto: boolean;
  theme: 'light' | 'dark' | 'system';
  lang: Lang;
  /** plates hidden in flat separation view */
  hiddenPlates: string[];
  showArtworkInFlat: boolean;
  highlight: { side: Side; x: number; y: number; w: number; h: number } | null;
}

type Listener = (p: Project, ui: UIState, changed: { project: boolean; ui: boolean; transient: boolean }) => void;

const HISTORY_LIMIT = 120;

/**
 * Central store. Project mutations go through `update()` which records an undo
 * snapshot (unless `transient`), UI state goes through `setUI()` (no history).
 */
class Store {
  project!: Project;
  ui: UIState = {
    side: 'front',
    view: 'holo',
    selectedLayerId: null,
    soloLayerId: null,
    layerMaskOverlay: false,
    selectedHoloLayerId: null,
    soloHoloLayerId: null,
    selectedMaskId: null,
    tab: 'artwork',
    guides: false,
    auto: true,
    theme: 'system',
    lang: getLang(),
    hiddenPlates: [],
    showArtworkInFlat: true,
    highlight: null,
  };
  private past: string[] = [];
  private future: string[] = [];
  private pendingSnapshot: string | null = null;
  private listeners = new Set<Listener>();
  private scheduled = false;
  private changed = { project: false, ui: false, transient: true };

  init(p: Project) {
    this.project = p;
    this.past = [];
    this.future = [];
    this.pendingSnapshot = null;
    this.queue(true, true, false);
  }

  /** replace project but keep it undoable */
  replace(p: Project) {
    this.commitPending();
    this.past.push(JSON.stringify(this.project));
    this.future = [];
    this.project = p;
    this.queue(true, false, false);
  }

  /**
   * Mutate the project. `transient` updates (slider drags) keep one snapshot
   * from the start of the gesture; call `commit()` when the gesture ends.
   */
  update(fn: (p: Project) => void, opts: { transient?: boolean } = {}) {
    if (opts.transient) {
      // Snapshot only once at the start of a gesture — not on every slider tick.
      if (this.pendingSnapshot === null) this.pendingSnapshot = JSON.stringify(this.project);
    } else {
      this.commitPending();
      this.past.push(JSON.stringify(this.project));
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    fn(this.project);
    this.queue(true, false, !!opts.transient);
  }

  commit() {
    this.commitPending();
  }

  private commitPending() {
    if (this.pendingSnapshot !== null) {
      this.past.push(this.pendingSnapshot);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
      this.pendingSnapshot = null;
    }
  }

  canUndo() {
    return this.past.length > 0 || this.pendingSnapshot !== null;
  }
  canRedo() {
    return this.future.length > 0;
  }

  undo() {
    this.commitPending();
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.fixSelection();
    this.queue(true, true, false);
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.fixSelection();
    this.queue(true, true, false);
  }

  setUI(patch: Partial<UIState>) {
    Object.assign(this.ui, patch);
    this.queue(false, true, false);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- helpers ----------
  layer(id: string | null): Layer | undefined {
    return this.project.layers.find((l) => l.id === id);
  }
  mask(id: string | null): MaskAsset | undefined {
    return this.project.masks.find((m) => m.id === id);
  }
  layersFor(side: Side): Layer[] {
    return this.project.layers.filter((l) => l.side === side);
  }

  private fixSelection() {
    if (this.ui.selectedLayerId && !this.layer(this.ui.selectedLayerId)) this.ui.selectedLayerId = null;
    if (this.ui.soloLayerId && !this.layer(this.ui.soloLayerId)) this.ui.soloLayerId = null;
    if (this.ui.selectedHoloLayerId && !this.project.holo.layers.some((x) => x.id === this.ui.selectedHoloLayerId)) {
      this.ui.selectedHoloLayerId = null;
    }
    if (this.ui.soloHoloLayerId && !this.project.holo.layers.some((x) => x.id === this.ui.soloHoloLayerId)) {
      this.ui.soloHoloLayerId = null;
    }
    if (this.ui.selectedMaskId && !this.mask(this.ui.selectedMaskId)) this.ui.selectedMaskId = null;
  }

  private queue(project: boolean, ui: boolean, transient: boolean) {
    this.changed.project ||= project;
    this.changed.ui ||= ui;
    if (!transient) this.changed.transient = false;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const c = this.changed;
      this.changed = { project: false, ui: false, transient: true };
      this.listeners.forEach((l) => l(this.project, this.ui, c));
    });
  }
}

export const store = new Store();
