import './styles/app.css';
import { $, $$, el, triggerDownload } from './ui/dom';
import { store } from './model/store';
import { assets } from './model/assets';
import { defaultHoloConfig, defaultSpecs, newMask, normalizeHolo, TECHS } from './model/techniques';
import { defaultEnvConfig, ENV_PRESETS, normalizeEnv, renderEnvCanvas } from './model/env';
import { frameForHeight } from './model/units';
import type { Project, Side } from './model/types';
import { DEFAULT_STYLE, loadEngine, NO_HOLO, STYLES } from './card/styles';
import { HoloCard, type RenderedHoloLayer } from './card/HoloCard';
import { TechRenderer, type LayerDraw } from './render/TechRenderer';
import { renderFlat } from './render/FlatRenderer';
import { imaging } from './imaging/client';
import { PREFLIGHT_HEIGHT, runPreflight, type PreflightIssue } from './preflight/preflight';
import { exportProductionZip } from './export/exporter';
import { generateMockupMp4 } from './export/mockupVideo';
import { clearWorkspace, loadWorkspaceTabs, saveWorkspaceTabs } from './storage/db';
import { packProject, unpackProject } from './storage/projectFile';
import { renderPanel, type PanelCallbacks } from './ui/panels';
import { clamp, debounce, uid } from './core/math';
import { getLang, setLang, t, type Lang } from './i18n/i18n';

const PREVIEW_H = 900;

const card = new HoloCard($('#mount'));
const frontTech = new TechRenderer(card.frontCanvas);
const backTech = new TechRenderer(card.backCanvas);
const flatCanvas = $<HTMLCanvasElement>('#flat-canvas');
const flatWrap = $('#flat-wrap');
const flatBar = $('#flat-bar');
const plateEl = $('#plate');
const stageGuides = $('#stage-guides');
const stageStatus = $('#stage-status');
const stageEl = $('#stage');
const stageEnvBg = $('#stage-env-bg');
const stageViewport = $('#stage-viewport');
const quickHdriSelect = $<HTMLSelectElement>('#quick-hdri');
const zoomResetBtn = $('#zoom-reset');
const hudHintEl = $('#hud-hint');
const docTabsEl = $('#doc-tabs');
const panelBody = $('#panel-body');
const projectNameInput = $<HTMLInputElement>('#project-name');

// ---------------- Multi-Project Photoshop Tabs ----------------
interface TabEntry {
  id: string;
  project: Project;
  preflight: PreflightIssue[];
  zoom: number;
  panX: number;
  panY: number;
}
let projectTabs: TabEntry[] = [];
let activeTabId = '';

// ---------------- Photoshop Tool & Pan/Zoom Camera (3D + Flat) ----------------
type ToolMode = 'tilt' | 'hand' | 'zoom';
const cam = { zoom: 1, x: 0, y: 0, panning: false, spaceDown: false, tool: 'tilt' as ToolMode, startX: 0, startY: 0, origX: 0, origY: 0 };

function renderDocTabs() {
  docTabsEl.innerHTML = '';
  const sideTag = store.ui.side === 'front' ? 'Front' : 'Back';
  for (const tab of projectTabs) {
    const isActive = tab.id === activeTabId;
    const pName = isActive && store.project ? store.project.name : tab.project.name;
    const label = isActive
      ? `${pName}.fxholo @ ${Math.round(cam.zoom * 100)}% (${sideTag} • RGB/8)`
      : `${pName}.fxholo`;
    const tabEl = el(
      'div',
      {
        class: `doc-tab ${isActive ? 'is-active' : ''}`,
        role: 'tab',
        'aria-selected': String(isActive),
        title: label,
        onclick: () => switchTab(tab.id),
      },
      el('span', { class: 'doc-tab__label' }, label),
      el('button', {
        type: 'button',
        class: 'doc-tab__close',
        title: t('top.closeTab'),
        onclick: (e: Event) => {
          e.stopPropagation();
          void closeTab(tab.id);
        },
      }, '×'),
    );
    docTabsEl.append(tabEl);
  }
}

function updateDocTab() {
  renderDocTabs();
}

function setTool(tool: ToolMode) {
  cam.tool = tool;
  $$('[data-tool]').forEach((b) => b.classList.toggle('is-active', (b as HTMLElement).dataset.tool === tool));
  stageEl.classList.toggle('is-pan-ready', tool === 'hand' || cam.spaceDown);
  stageEl.classList.toggle('is-zoom-tool', tool === 'zoom');
}

$$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool((b as HTMLElement).dataset.tool as ToolMode)));
$('#tool-flip').addEventListener('click', () => {
  const next: Side = store.ui.side === 'front' ? 'back' : 'front';
  store.setUI({ side: next });
  card.showSide(next);
});
$('#tool-guides').addEventListener('click', () => store.setUI({ guides: !store.ui.guides }));
$('#tool-fit').addEventListener('click', () => resetCam());

function applyCam() {
  stageViewport.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.zoom})`;
  zoomResetBtn.textContent = `${Math.round(cam.zoom * 100)}%`;
  updateDocTab();
}

function resetCam() {
  cam.zoom = 1;
  cam.x = 0;
  cam.y = 0;
  applyCam();
}

function zoomBy(factor: number, clientX?: number, clientY?: number) {
  const prev = cam.zoom;
  const next = clamp(prev * factor, 0.35, 4);
  if (Math.abs(next - prev) < 0.0001) return;
  if (clientX !== undefined && clientY !== undefined) {
    const r = stageEl.getBoundingClientRect();
    const cx = clientX - (r.left + r.width / 2);
    const cy = clientY - (r.top + r.height / 2);
    const ratio = next / prev;
    cam.x = cx - (cx - cam.x) * ratio;
    cam.y = cy - (cy - cam.y) * ratio;
  }
  cam.zoom = next;
  applyCam();
}

stageEl.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0018);
    zoomBy(factor, e.clientX, e.clientY);
  },
  { passive: false },
);

stageEl.addEventListener('contextmenu', (e) => e.preventDefault());

// Prevent card click lightbox when Hand/Zoom tool or Space-pan is active
stageEl.addEventListener(
  'click',
  (e) => {
    if (cam.tool !== 'tilt' || cam.spaceDown) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  { capture: true },
);

stageEl.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.button === 0 && cam.tool === 'zoom' && !cam.spaceDown) {
    e.preventDefault();
    e.stopPropagation();
    zoomBy(e.altKey ? 1 / 1.25 : 1.25, e.clientX, e.clientY);
    return;
  }
  const isPanTrigger = e.button === 1 || e.button === 2 || (e.button === 0 && (cam.spaceDown || cam.tool === 'hand'));
  if (!isPanTrigger) return;
  e.preventDefault();
  e.stopPropagation();
  cam.panning = true;
  cam.startX = e.clientX;
  cam.startY = e.clientY;
  cam.origX = cam.x;
  cam.origY = cam.y;
  stageEl.classList.add('is-panning');
  stageEl.setPointerCapture(e.pointerId);
});

stageEl.addEventListener('pointermove', (e: PointerEvent) => {
  if (!cam.panning) return;
  cam.x = cam.origX + (e.clientX - cam.startX);
  cam.y = cam.origY + (e.clientY - cam.startY);
  applyCam();
});

const endPan = (e: PointerEvent) => {
  if (!cam.panning) return;
  cam.panning = false;
  stageEl.classList.remove('is-panning');
  try { stageEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
};
stageEl.addEventListener('pointerup', endPan);
stageEl.addEventListener('pointercancel', endPan);

$('#zoom-in').addEventListener('click', () => zoomBy(1.2));
$('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
zoomResetBtn.addEventListener('click', resetCam);

// Runtime caches
const sideDraws: Record<Side, LayerDraw[]> = { front: [], back: [] };
const sideArt: Record<Side, { data: Uint8ClampedArray; w: number; h: number } | null> = { front: null, back: null };
const maskThumbs = new Map<string, string>();
let preflightIssues: PreflightIssue[] = [];
let exportState = { busy: false, pct: 0, label: '' };
const holoMaskCache = new Map<string, { key: string; url: string }>();
let lastArtKey = '';
let lastTechKey = '';
let lastThumbKey = '';
let layerOverlayBlobUrl: string | null = null;
let layerOverlayData: { side: Side; mask: Uint8Array; w: number; h: number } | null = null;
let layerOverlaySeq = 0;
let frontCropUrl: string | null = null;
let backCropUrl: string | null = null;
let syncSeq = 0;

// Wire HoloCard render callbacks
card.onZoom = (z) => document.body.classList.toggle('is-zoomed', z);
card.onLayout = () => {
  const w = card.frontCanvas.clientWidth || 360;
  const h = card.frontCanvas.clientHeight || 504;
  frontTech.resize(w, h);
  backTech.resize(w, h);
};
card.onRender = (s) => {
  frontTech.render(s, false);
  backTech.render(s, true);
};
$('#veil').addEventListener('click', () => card.deactivate());

// ---------------- Theme ----------------
const media = window.matchMedia('(prefers-color-scheme: dark)');
const metaTheme = $<HTMLMetaElement>('#theme-color');
const THEME_COLOR = { light: '#E0E0E0', dark: '#262626' };

function applyTheme() {
  const mode = store.ui.theme;
  const scheme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
  document.documentElement.dataset.scheme = scheme;
  metaTheme.content = THEME_COLOR[scheme];
  $$('.theme button').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.theme === mode)));
  if (store.project && store.ui.view === 'flat') drawFlat();
}
$$('.theme button').forEach((b) =>
  b.addEventListener('click', () => {
    store.setUI({ theme: (b as HTMLElement).dataset.theme as 'light' | 'dark' | 'system' });
    applyTheme();
  }),
);
media.addEventListener('change', () => { if (store.ui.theme === 'system') applyTheme(); });

// ---------------- Topbar & Tabs ----------------
projectNameInput.addEventListener('change', () => {
  const v = projectNameInput.value.trim() || 'FramigosX Card';
  store.update((d) => { d.name = v; });
});

$$('[data-side]').forEach((b) =>
  b.addEventListener('click', () => {
    const side = (b as HTMLElement).dataset.side as Side;
    store.setUI({ side, highlight: null });
    card.showSide(side);
  }),
);

$$('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    store.setUI({ view: (b as HTMLElement).dataset.view as 'holo' | 'flat' });
  }),
);

$<HTMLInputElement>('#toggle-guides').addEventListener('change', (e) => {
  store.setUI({ guides: (e.target as HTMLInputElement).checked });
});

$<HTMLInputElement>('#toggle-auto').addEventListener('change', (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  store.setUI({ auto: enabled });
  card.setAuto({ enabled, amp: 13, freq: 0.35 });
});

quickHdriSelect.addEventListener('change', () => {
  const val = quickHdriSelect.value;
  if (val === '__custom__') {
    store.setUI({ tab: 'env' });
    return;
  }
  const pr = ENV_PRESETS.find((x) => x.id === val);
  if (!pr) return;
  store.update((d) => {
    d.env = normalizeEnv(d.env);
    d.env.preset = pr.id;
    d.env.customAssetId = null;
    d.env.exposure = pr.defaultExposure ?? 1;
    d.env.temperature = pr.defaultTemp ?? 0;
  });
});

$('#btn-undo').addEventListener('click', () => store.undo());
$('#btn-redo').addEventListener('click', () => store.redo());
$('#btn-new-proj').addEventListener('click', () => void createNewTab());
$('#doc-tab-new').addEventListener('click', () => void createNewTab());
$('#doc-tab-dup').addEventListener('click', () => duplicateActiveTab());
$('#btn-save-proj').addEventListener('click', () => void saveProjectFile());
$('#btn-open-proj').addEventListener('click', () => $<HTMLInputElement>('#input-open-proj').click());
$<HTMLInputElement>('#input-open-proj').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    const { project, assets: list } = await unpackProject(f);
    project.holo = normalizeHolo(project.holo, DEFAULT_STYLE);
    project.env = normalizeEnv(project.env);
    // Restore imported assets alongside existing tabs' assets
    list.forEach((a) => assets.restore(a));
    saveCurrentTabSnapshot();
    const newTab: TabEntry = { id: uid('tab'), project, preflight: [], zoom: 1, panX: 0, panY: 0 };
    projectTabs.push(newTab);
    activateTab(newTab.id);
    persist();
  } catch (err) {
    alert(`Cannot open project file: ${(err as Error).message}`);
  }
});

$$('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    store.setUI({ tab: (b as HTMLElement).dataset.tab as any });
  }),
);

// Prevent browser drop navigation
['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => e.preventDefault()));

// ---------------- Bilingual VI / EN ----------------
function applyLangUI() {
  const lang = getLang();
  $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.lang === lang)));
  $('[data-side="front"]').textContent = t('side.front');
  $('[data-side="back"]').textContent = t('side.back');
  $('[data-view="holo"]').textContent = t('view.holo');
  $('[data-view="flat"]').textContent = t('view.flat');
  $('#toggle-guides').nextElementSibling!.textContent = t('top.guides');
  $('#toggle-auto').nextElementSibling!.textContent = t('top.auto');
  $('#btn-new-proj').textContent = t('top.new');
  $('#btn-new-proj').setAttribute('title', t('top.newProjTitle'));
  $('#doc-tab-new').setAttribute('title', t('top.newProjTitle'));
  $('#doc-tab-dup').setAttribute('title', t('top.dup'));
  $('#btn-open-proj').textContent = t('top.open');
  $('#btn-open-proj').setAttribute('title', t('top.importTitle'));
  $('#btn-save-proj').textContent = t('top.save');
  $('#btn-save-proj').setAttribute('title', t('top.saveTitle'));
  $('#btn-undo').setAttribute('title', t('top.undo'));
  $('#btn-redo').setAttribute('title', t('top.redo'));
  projectNameInput.setAttribute('aria-label', t('top.projectName'));
  hudHintEl.textContent = t('hud.hint');
  $$('[data-tab]').forEach((b) => {
    const k = (b as HTMLElement).dataset.tab!;
    b.textContent = t(`tab.${k}`);
  });
  // Populate quick HDRI environment selector
  const isVi = lang === 'vi';
  quickHdriSelect.innerHTML = '';
  for (const pr of ENV_PRESETS) {
    quickHdriSelect.append(el('option', { value: pr.id }, `☀ ${isVi ? pr.labelVi : pr.labelEn}`));
  }
  quickHdriSelect.append(el('option', { value: '__custom__' }, isVi ? '🖼 HDRI Tùy chỉnh...' : '🖼 Custom HDRI...'));
  if (store.project) {
    const env = normalizeEnv(store.project.env);
    quickHdriSelect.value = env.customAssetId ? '__custom__' : env.preset;
  }
}

$$('[data-lang]').forEach((b) =>
  b.addEventListener('click', () => {
    const lang = (b as HTMLElement).dataset.lang as Lang;
    setLang(lang);
    applyLangUI();
    store.setUI({ lang });
  }),
);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'Space' && !cam.spaceDown) {
    e.preventDefault();
    cam.spaceDown = true;
    stageEl.classList.add('is-pan-ready');
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  } else if (e.key.toLowerCase() === 'g') {
    store.setUI({ guides: !store.ui.guides });
  } else if (e.key.toLowerCase() === 'f') {
    const next: Side = store.ui.side === 'front' ? 'back' : 'front';
    store.setUI({ side: next });
    card.showSide(next);
  } else if (e.key.toLowerCase() === 'v') {
    setTool('tilt');
  } else if (e.key.toLowerCase() === 'h') {
    setTool('hand');
  } else if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey) {
    setTool('zoom');
  } else if (e.key === '0') {
    resetCam();
  } else if (e.key === '=' || e.key === '+') {
    zoomBy(1.15);
  } else if (e.key === '-') {
    zoomBy(1 / 1.15);
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    cam.spaceDown = false;
    stageEl.classList.toggle('is-pan-ready', cam.tool === 'hand');
  }
});

// ---------------- Default Project & Tab Operations ----------------
async function createDefaultProject(customName?: string): Promise<Project> {
  const [front, back, maskImg, foilImg] = await Promise.all([
    assets.addFromUrl('img/card.webp', 'card.webp'),
    assets.addFromUrl('img/card_back.webp', 'card_back.webp'),
    assets.addFromUrl('img/card_mask.webp', 'card_mask.webp'),
    assets.addFromUrl('img/card_foil.webp', 'card_foil.webp'),
  ]);
  const defaultMask = newMask({ name: 'Default Card Mask', sourceId: maskImg.id, mode: 'luminance' });
  const backAutoMask = newMask({ name: 'Back Artwork Mask', sourceId: back.id, mode: 'luminance', levelsLow: 60, levelsHigh: 220 });
  return {
    version: 2,
    name: customName ?? 'FramigosX Card',
    specs: defaultSpecs(),
    sides: {
      front: { artworkId: front.id, fit: 'auto' },
      back: { artworkId: back.id, fit: 'auto' },
    },
    holo: defaultHoloConfig(DEFAULT_STYLE, defaultMask.id, foilImg.id),
    env: defaultEnvConfig(),
    masks: [defaultMask, backAutoMask],
    layers: [],
  };
}

function saveCurrentTabSnapshot() {
  const cur = projectTabs.find((x) => x.id === activeTabId);
  if (!cur || !store.project) return;
  cur.project = JSON.parse(JSON.stringify(store.project));
  cur.preflight = preflightIssues;
  cur.zoom = cam.zoom;
  cur.panX = cam.x;
  cur.panY = cam.y;
}

function activateTab(id: string) {
  const target = projectTabs.find((x) => x.id === id);
  if (!target) return;
  activeTabId = target.id;
  lastArtKey = '';
  lastTechKey = '';
  lastThumbKey = '';
  lastEnvMapKey = '';
  preflightIssues = target.preflight;
  cam.zoom = target.zoom;
  cam.x = target.panX;
  cam.y = target.panY;
  applyCam();
  store.setUI({ selectedLayerId: null, soloLayerId: null, selectedHoloLayerId: null, soloHoloLayerId: null, selectedMaskId: null, highlight: null });
  store.init(JSON.parse(JSON.stringify(target.project)));
  renderDocTabs();
}

function switchTab(id: string) {
  if (id === activeTabId) return;
  saveCurrentTabSnapshot();
  activateTab(id);
  persist();
}

async function createNewTab() {
  saveCurrentTabSnapshot();
  const num = projectTabs.length + 1;
  const proj = await createDefaultProject(`FramigosX Card ${num}`);
  const tab: TabEntry = { id: uid('tab'), project: proj, preflight: [], zoom: 1, panX: 0, panY: 0 };
  projectTabs.push(tab);
  activateTab(tab.id);
  persist();
}

function duplicateActiveTab() {
  saveCurrentTabSnapshot();
  const cur = projectTabs.find((x) => x.id === activeTabId);
  if (!cur) return;
  const copy: Project = JSON.parse(JSON.stringify(cur.project));
  copy.name = `${copy.name} Copy`;
  const tab: TabEntry = { id: uid('tab'), project: copy, preflight: [], zoom: 1, panX: 0, panY: 0 };
  const idx = projectTabs.indexOf(cur);
  projectTabs.splice(idx + 1, 0, tab);
  activateTab(tab.id);
  persist();
}

async function closeTab(id: string) {
  const idx = projectTabs.findIndex((x) => x.id === id);
  if (idx < 0) return;
  if (projectTabs.length === 1) {
    const fresh = await createDefaultProject('FramigosX Card');
    projectTabs = [{ id: uid('tab'), project: fresh, preflight: [], zoom: 1, panX: 0, panY: 0 }];
    activateTab(projectTabs[0].id);
    persist();
    return;
  }
  projectTabs.splice(idx, 1);
  if (id === activeTabId) {
    const next = projectTabs[Math.min(idx, projectTabs.length - 1)];
    activateTab(next.id);
  } else {
    renderDocTabs();
  }
  persist();
}

// ---------------- HDRI Environment Sync ----------------
let lastEnvMapKey = '';
let lastEnvBgUrl = '';

async function syncEnv(p: Project) {
  const env = normalizeEnv(p.env);
  frontTech.setEnvParams(env);
  backTech.setEnvParams(env);
  quickHdriSelect.value = env.customAssetId ? '__custom__' : env.preset;

  const mapKey = env.customAssetId ? `custom:${env.customAssetId}` : `preset:${env.preset}`;
  if (mapKey !== lastEnvMapKey) {
    lastEnvMapKey = mapKey;
    if (env.customAssetId) {
      const url = assets.url(env.customAssetId);
      if (url) {
        lastEnvBgUrl = url;
        const img = await new Promise<HTMLImageElement | null>((resolve) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => resolve(null);
          im.src = url;
        });
        if (img && lastEnvMapKey === mapKey) {
          frontTech.setEnvMap(img);
          backTech.setEnvMap(img);
          card.requestRender();
        }
      }
    } else {
      const cv = renderEnvCanvas(env.preset, 512, 256);
      frontTech.setEnvMap(cv);
      backTech.setEnvMap(cv);
      lastEnvBgUrl = cv.toDataURL('image/jpeg', 0.85);
    }
  }

  const showBg = env.showBackdrop && store.ui.view === 'holo';
  stageEnvBg.hidden = !showBg;
  if (showBg) {
    stageEnvBg.style.backgroundImage = lastEnvBgUrl ? `url("${lastEnvBgUrl}")` : 'none';
    stageEnvBg.style.backgroundPosition = `${((env.rotation / 360) * 100).toFixed(1)}% 50%`;
    const hueWarm =
      env.temperature > 0
        ? `sepia(${(env.temperature * 0.0025).toFixed(2)})`
        : env.temperature < 0
          ? `hue-rotate(${(env.temperature * 0.25).toFixed(1)}deg)`
          : '';
    stageEnvBg.style.filter = `blur(${env.backdropBlur}px) brightness(${(env.backdropDim * env.exposure).toFixed(2)}) ${hueWarm}`;
  }
  card.requestRender();
}

// ---------------- Sync Pipeline ----------------
async function syncProject(p: Project) {
  const seq = ++syncSeq;
  void syncEnv(p);
  const s = p.specs;
  const frame = frameForHeight(s, PREVIEW_H);

  // Update physical CSS aspect & corner radius
  const aspect = s.widthMm / s.heightMm;
  document.documentElement.style.setProperty('--card-aspect', String(aspect));
  const radius = s.cornerMm > 0 ? `${((s.cornerMm / s.widthMm) * 100).toFixed(2)}% / ${((s.cornerMm / s.heightMm) * 100).toFixed(2)}%` : '0px';
  document.documentElement.style.setProperty('--card-radius', radius);
  stageGuides.style.setProperty('--safe-inset', `${((s.safeMm / s.heightMm) * 100).toFixed(2)}% ${((s.safeMm / s.widthMm) * 100).toFixed(2)}%`);
  card.updateLayout();

  // Multi-Holo Layers: load active CSS engine + compute each visible Holo layer's independent mask
  card.setHoloInteraction(p.holo.interaction);
  const soloHoloId = store.ui.soloHoloLayerId;
  const visHoloLayers = p.holo.enabled
    ? p.holo.layers.filter((hl) => (soloHoloId ? hl.id === soloHoloId : hl.visible))
    : [];

  const activeEngine = visHoloLayers.length
    ? (STYLES.find((x) => x.id === visHoloLayers[visHoloLayers.length - 1].styleId)?.engine ?? 'css')
    : 'css';
  await loadEngine(activeEngine, $('#engine-anchor'));
  if (seq !== syncSeq) return;
  card.setEngine(activeEngine);

  const holoFrame = frameForHeight(s, 512);
  const frameKey = `${s.widthMm}x${s.heightMm}x${s.bleedMm}`;

  const renderedHolos: RenderedHoloLayer[] = await Promise.all(
    visHoloLayers.map(async (hl) => {
      const style = STYLES.find((x) => x.id === hl.styleId) ?? NO_HOLO;
      let maskUrl: string | null = null;
      const spec = imaging.holoMaskSpec(p, hl);
      if (spec.refs.length > 0 && hl.masking.scope !== 'none') {
        const mKey = `${frameKey}|${JSON.stringify(spec)}`;
        const cached = holoMaskCache.get(hl.id);
        if (cached && cached.key === mKey) {
          maskUrl = cached.url;
        } else {
          const blob = await imaging.holoMaskImage(spec, holoFrame);
          const url = URL.createObjectURL(blob);
          if (cached) URL.revokeObjectURL(cached.url);
          holoMaskCache.set(hl.id, { key: mKey, url });
          maskUrl = url;
        }
      }
      return {
        id: hl.id,
        engine: style.engine,
        attrs: style.attrs,
        foilUrl: assets.url(hl.foilId),
        maskUrl,
        optical: hl.optical,
        masking: hl.masking,
      };
    }),
  );
  if (seq !== syncSeq) return;
  const activeHoloIds = new Set(visHoloLayers.map((x) => x.id));
  for (const [id, entry] of holoMaskCache) {
    if (!activeHoloIds.has(id)) {
      URL.revokeObjectURL(entry.url);
      holoMaskCache.delete(id);
    }
  }
  card.setHoloLayers(renderedHolos, s.widthMm);

  // Artwork: ONLY re-crop/upload when artwork or physical frame actually changed!
  const artKey = `${frameKey}|${JSON.stringify(p.sides)}`;
  if (artKey !== lastArtKey) {
    lastArtKey = artKey;
    for (const side of ['front', 'back'] as Side[]) {
      const src = imaging.sourceSpec(p, side);
      if (!src) {
        sideArt[side] = null;
        (side === 'front' ? frontTech : backTech).setArtwork(null, 1, 1);
        if (side === 'front') card.setImages({ front: null });
        else card.setImages({ back: null });
        continue;
      }
      const [art, cropped] = await Promise.all([imaging.artwork(src, frame), imaging.cropImage(src, frame)]);
      if (seq !== syncSeq) return;
      sideArt[side] = art;
      (side === 'front' ? frontTech : backTech).setArtwork(art.data, art.w, art.h);
      const url = URL.createObjectURL(cropped);
      if (side === 'front') {
        if (frontCropUrl) URL.revokeObjectURL(frontCropUrl);
        frontCropUrl = url;
        card.setImages({ front: url });
      } else {
        if (backCropUrl) URL.revokeObjectURL(backCropUrl);
        backCropUrl = url;
        card.setImages({ back: url });
      }
    }
  }

  // WebGL printing technique layers: ONLY recompute when layers/masks/specs/solo changed!
  const soloId = store.ui.soloLayerId;
  const techKey = `${frameKey}|${s.substrate}|${soloId ?? ''}|${JSON.stringify(p.layers)}|${JSON.stringify(p.masks)}`;
  if (techKey !== lastTechKey) {
    lastTechKey = techKey;
    for (const side of ['front', 'back'] as Side[]) {
      const layers = p.layers.filter((l) => {
        if (l.side !== side || !l.masks.length) return false;
        return soloId ? l.id === soloId : l.visible;
      });
      const results = await Promise.all(
        layers.map(async (layer) => {
          const isRelief = layer.kind === 'emboss' || layer.kind === 'deboss';
          const spec = imaging.layerSpec(p, layer, {
            blurMm: isRelief ? Number(layer.params.bevelMm ?? 0.3) * 0.45 : layer.kind === 'spot-uv' ? 0.1 : 0,
          });
          const mask = await imaging.layerMask(spec, frame);
          return { layer, mask: mask.data, w: mask.w, h: mask.h } satisfies LayerDraw;
        }),
      );
      if (seq !== syncSeq) return;
      sideDraws[side] = results;
      (side === 'front' ? frontTech : backTech).setLayers(results, frame, s.substrate);
    }
  }

  // Mask library thumbnails: ONLY recompute when masks/specs changed!
  const thumbKey = `${frameKey}|${JSON.stringify(p.masks)}`;
  if (thumbKey !== lastThumbKey) {
    lastThumbKey = thumbKey;
    const thumbFrame = frameForHeight(s, 120);
    await Promise.all(
      p.masks.map(async (m) => {
        const g = await imaging.maskPreview(imaging.maskSpec(p, m), thumbFrame);
        if (seq !== syncSeq) return;
        const cv = document.createElement('canvas');
        cv.width = g.w;
        cv.height = g.h;
        const ctx = cv.getContext('2d')!;
        const img = ctx.createImageData(g.w, g.h);
        for (let i = 0; i < g.data.length; i++) {
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g.data[i];
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        maskThumbs.set(m.id, cv.toDataURL('image/png'));
      }),
    );
    if (seq !== syncSeq) return;
    if (store.ui.tab === 'masks') renderPanel(panelBody, p, store.ui, panelCallbacks);
  }

  card.requestRender();
  void syncLayerMaskOverlay();
  if (store.ui.view === 'flat') drawFlat();
  updateStatus();
}

async function syncLayerMaskOverlay() {
  const seq = ++layerOverlaySeq;
  const p = store.project;
  const ui = store.ui;
  if (!p || !ui.layerMaskOverlay) {
    layerOverlayData = null;
    card.setLayerMaskOverlay('front', null);
    card.setLayerMaskOverlay('back', null);
    if (ui.view === 'flat' && p) drawFlat();
    return;
  }

  const sideLayers = p.layers.filter((l) => l.side === ui.side);
  const sel = sideLayers.find((l) => l.id === ui.selectedLayerId) ?? sideLayers[sideLayers.length - 1] ?? null;
  if (!sel || !sel.masks.length) {
    layerOverlayData = null;
    card.setLayerMaskOverlay('front', null);
    card.setLayerMaskOverlay('back', null);
    if (ui.view === 'flat') drawFlat();
    return;
  }

  const frame = frameForHeight(p.specs, PREVIEW_H);
  const spec = imaging.layerSpec(p, sel);
  const [blob, maskRes] = await Promise.all([
    imaging.holoMaskImage(spec, frame),
    imaging.layerMask(spec, frame),
  ]);
  if (seq !== layerOverlaySeq) return;

  if (layerOverlayBlobUrl) URL.revokeObjectURL(layerOverlayBlobUrl);
  layerOverlayBlobUrl = URL.createObjectURL(blob);
  layerOverlayData = { side: ui.side, mask: maskRes.data, w: maskRes.w, h: maskRes.h };

  card.setLayerMaskOverlay(ui.side === 'front' ? 'back' : 'front', null);
  card.setLayerMaskOverlay(ui.side, layerOverlayBlobUrl);
  if (ui.view === 'flat') drawFlat();
}

function drawFlat() {
  const p = store.project;
  const ui = store.ui;
  const frame = frameForHeight(p.specs, PREVIEW_H);
  const side = ui.side;
  const hidden = new Set(ui.hiddenPlates);
  const hl = ui.highlight && ui.highlight.side === side ? ui.highlight : null;

  renderFlat(flatCanvas, {
    frame,
    specs: p.specs,
    artwork: sideArt[side],
    draws: sideDraws[side],
    hiddenPlates: hidden,
    showArtwork: ui.showArtworkInFlat,
    showGuides: ui.guides || true,
    highlight: hl ? { x: hl.x * (PREVIEW_H / PREFLIGHT_HEIGHT), y: hl.y * (PREVIEW_H / PREFLIGHT_HEIGHT), w: hl.w * (PREVIEW_H / PREFLIGHT_HEIGHT), h: hl.h * (PREVIEW_H / PREFLIGHT_HEIGHT) } : null,
    layerMaskOverlay: ui.layerMaskOverlay && layerOverlayData && layerOverlayData.side === side ? layerOverlayData : null,
  });

  // Separation legend chips
  flatBar.innerHTML = '';
  flatBar.append(
    el(
      'button',
      {
        type: 'button',
        class: `plate-chip ${ui.showArtworkInFlat ? '' : 'is-off'}`,
        onclick: () => store.setUI({ showArtworkInFlat: !ui.showArtworkInFlat }),
      },
      el('span', { class: 'swatch', style: { background: '#888' } }),
      'Artwork',
    ),
  );
  for (const d of sideDraws[side]) {
    const off = hidden.has(d.layer.id);
    flatBar.append(
      el(
        'button',
        {
          type: 'button',
          class: `plate-chip ${off ? 'is-off' : ''}`,
          onclick: () => {
            const next = new Set(ui.hiddenPlates);
            if (next.has(d.layer.id)) next.delete(d.layer.id);
            else next.add(d.layer.id);
            store.setUI({ hiddenPlates: [...next] });
          },
        },
        el('span', { class: 'swatch', style: { background: TECHS[d.layer.kind].view } }),
        `${d.layer.name} (${TECHS[d.layer.kind].spot(d.layer)})`,
      ),
    );
  }
}

function updateStatus() {
  const s = store.project.specs;
  const count = store.project.layers.filter((l) => l.visible && l.masks.length > 0).length;
  stageStatus.textContent = `${store.ui.side === 'front' ? t('side.front') : t('side.back')} • ${s.widthMm}×${s.heightMm} mm (Bleed ${s.bleedMm} mm, R${s.cornerMm} mm) • ${s.dpi}/${s.plateDpi} DPI • ${count} plate`;
  updateDocTab();
}

function collectAssetIds(p: Project, out: Set<string>) {
  if (p.sides.front.artworkId) out.add(p.sides.front.artworkId);
  if (p.sides.back.artworkId) out.add(p.sides.back.artworkId);
  if (p.env?.customAssetId) out.add(p.env.customAssetId);
  p.holo.layers.forEach((hl) => { if (hl.foilId) out.add(hl.foilId); });
  p.masks.forEach((m) => { if (m.sourceId) out.add(m.sourceId); });
}

// ---------------- Autosave (All Open Project Tabs) ----------------
const persist = debounce(() => {
  saveCurrentTabSnapshot();
  const keep = new Set<string>();
  for (const tab of projectTabs) collectAssetIds(tab.project, keep);
  assets.gc(keep);
  void saveWorkspaceTabs(
    { activeId: activeTabId, tabs: projectTabs.map((t) => ({ id: t.id, project: t.project })) },
    assets.all(),
  );
}, 600);

// ---------------- Mockup Capture ----------------
async function captureMockupBlob(): Promise<Blob | null> {
  try {
    const p = store.project;
    const frame = frameForHeight(p.specs, 900);
    const tw = frame.trim.w;
    const th = frame.trim.h;
    const gap = 36;
    const pad = 44;
    const cv = document.createElement('canvas');
    cv.width = tw * 2 + gap + pad * 2;
    cv.height = th + pad * 2 + 28;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#1f2326';
    ctx.fillRect(0, 0, cv.width, cv.height);

    const drawSide = (side: Side, x: number) => {
      const art = sideArt[side];
      if (art) {
        const tmp = document.createElement('canvas');
        tmp.width = art.w;
        tmp.height = art.h;
        tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(art.data), art.w, art.h), 0, 0);
        ctx.drawImage(tmp, frame.trim.x, frame.trim.y, tw, th, x, pad, tw, th);
      }
      const glCanvas = side === 'front' ? card.frontCanvas : card.backCanvas;
      ctx.drawImage(glCanvas, x, pad, tw, th);
      ctx.fillStyle = '#d4d8dc';
      ctx.font = '500 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(side === 'front' ? 'FRONT' : 'BACK', x + tw / 2, pad + th + 24);
    };

    drawSide('front', pad);
    drawSide('back', pad + tw + gap);
    return await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}

async function captureMockupVideo(onPct?: (pct: number) => void): Promise<{ blob: Blob; ext: 'mp4' | 'webm' } | null> {
  try {
    const p = store.project;
    const frame = frameForHeight(p.specs, PREVIEW_H);
    const visHolos = p.holo.enabled ? p.holo.layers.filter((hl) => hl.visible) : [];
    const holoLayers = await Promise.all(
      visHolos.map(async (layer) => {
        const spec = imaging.holoMaskSpec(p, layer);
        const mask = spec.refs.length > 0 && layer.masking.scope !== 'none'
          ? await imaging.layerMask(spec, frame)
          : null;
        let foilImg: HTMLImageElement | null = null;
        const foilUrl = assets.url(layer.foilId);
        if (foilUrl) {
          foilImg = await new Promise<HTMLImageElement | null>((resolve) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = foilUrl;
          });
        }
        return { layer, mask, foilImg };
      }),
    );

    return await generateMockupMp4({
      project: p,
      frame,
      sideArt,
      frontTech,
      backTech,
      frontCanvas: card.frontCanvas,
      backCanvas: card.backCanvas,
      holoLayers,
      restoreState: card.state,
      onProgress: onPct,
    });
  } catch (err) {
    console.warn('3D Full HD MP4 mockup failed:', err);
    return null;
  }
}

async function saveProjectFile() {
  const ids = new Set<string>();
  collectAssetIds(store.project, ids);
  const used = assets.all().filter((a) => ids.has(a.id));
  const blob = await packProject(store.project, used);
  const slug = store.project.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'project';
  triggerDownload(blob, `${slug}.fxholo`);
}

// ---------------- Panel Callbacks ----------------
const panelCallbacks: PanelCallbacks = {
  async onUploadFile(file, target, holoLayerId) {
    const asset = await assets.add(file, file.name);
    if (target === 'front') store.update((d) => { d.sides.front.artworkId = asset.id; });
    else if (target === 'back') store.update((d) => { d.sides.back.artworkId = asset.id; });
    else if (target === 'holoFoil') {
      store.update((d) => {
        const hl = d.holo.layers.find((x) => x.id === holoLayerId) ?? d.holo.layers[0];
        if (hl) hl.foilId = asset.id;
      });
    } else if (target === 'holoMask') {
      const m = newMask({ name: file.name.replace(/\.[^.]+$/, ''), sourceId: asset.id, mode: 'luminance' });
      store.update((d) => {
        d.masks.push(m);
        const hl = d.holo.layers.find((x) => x.id === holoLayerId) ?? d.holo.layers[0];
        if (hl) hl.masks.push({ maskId: m.id, op: 'add' });
      });
    } else if (target === 'newMask') {
      const m = newMask({ name: file.name.replace(/\.[^.]+$/, ''), sourceId: asset.id, mode: 'luminance' });
      store.update((d) => { d.masks.push(m); });
      store.setUI({ selectedMaskId: m.id });
    } else if (target === 'envMap') {
      store.update((d) => {
        d.env = normalizeEnv(d.env);
        d.env.customAssetId = asset.id;
        d.env.showBackdrop = true;
      });
    }
  },
  async onResetDefaults() {
    const fresh = await createDefaultProject(store.project.name);
    const cur = projectTabs.find((x) => x.id === activeTabId);
    if (cur) { cur.project = fresh; cur.preflight = []; }
    preflightIssues = [];
    store.init(fresh);
    persist();
  },
  async onRunPreflight() {
    preflightIssues = await runPreflight(store.project);
    renderPanel(panelBody, store.project, store.ui, panelCallbacks);
  },
  async onExportZip(opts) {
    if (exportState.busy) return;
    exportState = { busy: true, pct: 2, label: 'Preparing export...' };
    renderPanel(panelBody, store.project, store.ui, panelCallbacks);
    try {
      const mockupBlob = opts.mockup ? await captureMockupBlob() : null;
      const mockupVideo = opts.mockup
        ? await captureMockupVideo((pct) => {
            exportState = { busy: true, pct: Math.round(pct * 0.35), label: `Encoding 1080p MP4 (${pct}%)...` };
            renderPanel(panelBody, store.project, store.ui, panelCallbacks);
          })
        : null;
      const { blob, filename } = await exportProductionZip(store.project, {
        ...opts,
        preflight: preflightIssues,
        mockupBlob,
        mockupVideo,
        onProgress: (pct, label) => {
          const mapped = opts.mockup ? 35 + Math.round(pct * 0.65) : pct;
          exportState = { busy: pct < 100, pct: mapped, label };
          renderPanel(panelBody, store.project, store.ui, panelCallbacks);
        },
      });
      triggerDownload(blob, filename);
    } catch (err) {
      exportState = { busy: false, pct: 0, label: `Error: ${(err as Error).message}` };
      renderPanel(panelBody, store.project, store.ui, panelCallbacks);
    }
  },
  async onExportVideo() {
    if (exportState.busy) return;
    exportState = { busy: true, pct: 2, label: 'Encoding 1080p MP4 (10s, 2 loops)...' };
    renderPanel(panelBody, store.project, store.ui, panelCallbacks);
    try {
      const vid = await captureMockupVideo((pct) => {
        exportState = { busy: pct < 100, pct, label: `Encoding 1080p MP4 (${pct}%)...` };
        renderPanel(panelBody, store.project, store.ui, panelCallbacks);
      });
      if (!vid) throw new Error('Failed to encode 1080p video');
      const slug = store.project.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'card';
      exportState = { busy: false, pct: 100, label: `Full HD 1080p ${vid.ext.toUpperCase()} ready!` };
      renderPanel(panelBody, store.project, store.ui, panelCallbacks);
      triggerDownload(vid.blob, `FXH_${slug}_3d_1080p.${vid.ext}`);
    } catch (err) {
      exportState = { busy: false, pct: 0, label: `Error: ${(err as Error).message}` };
      renderPanel(panelBody, store.project, store.ui, panelCallbacks);
    }
  },
  onSaveProject: saveProjectFile,
  onOpenProject: () => $<HTMLInputElement>('#input-open-proj').click(),
  getPreflight: () => preflightIssues,
  getMaskThumb: (id) => maskThumbs.get(id) ?? null,
  getExportState: () => exportState,
};

// ---------------- Store Subscription ----------------
let lastSoloId: string | null = null;
let lastSoloHoloId: string | null = null;

store.subscribe((p, ui, changed) => {
  projectNameInput.value = p.name;
  ($<HTMLButtonElement>('#btn-undo')).disabled = !store.canUndo();
  ($<HTMLButtonElement>('#btn-redo')).disabled = !store.canRedo();
  $$('[data-side]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.side === ui.side)));
  $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.view === ui.view)));
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String((b as HTMLElement).dataset.tab === ui.tab)));
  $<HTMLInputElement>('#toggle-guides').checked = ui.guides;
  $<HTMLInputElement>('#toggle-auto').checked = ui.auto;

  plateEl.hidden = ui.view !== 'holo';
  flatWrap.hidden = ui.view !== 'flat';
  stageGuides.hidden = !ui.guides;

  // Keep active sliders/number inputs alive during drag/type (transient = true)
  if (!changed.transient || changed.ui) {
    renderPanel(panelBody, p, ui, panelCallbacks);
  }

  const soloChanged = ui.soloLayerId !== lastSoloId || ui.soloHoloLayerId !== lastSoloHoloId;
  lastSoloId = ui.soloLayerId;
  lastSoloHoloId = ui.soloHoloLayerId;

  if (changed.project || soloChanged) {
    void syncProject(p);
    if (changed.project) persist();
  } else {
    void syncEnv(p);
    void syncLayerMaskOverlay();
    if (ui.view === 'flat') drawFlat();
  }
  updateStatus();
});

// ---------------- Bootstrap ----------------
async function boot() {
  applyLangUI();
  applyTheme();
  const autoOn = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  store.ui.auto = autoOn;
  card.setAuto({ enabled: autoOn, amp: 13, freq: 0.35 });

  const saved = await loadWorkspaceTabs();
  if (saved && saved.workspace.tabs.length > 0) {
    saved.assets.forEach((a) => assets.restore(a));
    projectTabs = saved.workspace.tabs.map((st) => ({
      id: st.id,
      project: { ...st.project, holo: normalizeHolo(st.project.holo, DEFAULT_STYLE), env: normalizeEnv(st.project.env) },
      preflight: [],
      zoom: 1,
      panX: 0,
      panY: 0,
    }));
    const startId = projectTabs.some((x) => x.id === saved.workspace.activeId) ? saved.workspace.activeId : projectTabs[0].id;
    activateTab(startId);
  } else {
    const def = await createDefaultProject('FramigosX Card');
    projectTabs = [{ id: uid('tab'), project: def, preflight: [], zoom: 1, panX: 0, panY: 0 }];
    activateTab(projectTabs[0].id);
  }
  void clearWorkspace;
}

void boot();
