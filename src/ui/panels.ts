import { el } from './dom';
import { icon } from './icons';
import { store, type UIState } from '../model/store';
import { assets } from '../model/assets';
import { CARD_PRESETS, fmtUnit, fromUnit, toUnit } from '../model/units';
import { defaultHoloConfig, defaultHoloOptical, newHoloLayer, newLayer, newMask, TECH_ORDER, TECHS } from '../model/techniques';
import { defaultEnvConfig, ENV_PRESETS, normalizeEnv } from '../model/env';
import { DEFAULT_STYLE, ENGINES, STYLES } from '../card/styles';
import { getLang, t } from '../i18n/i18n';
import { uid } from '../core/math';
import type {
  Fit,
  HoloAutoPattern,
  HoloBlendMode,
  HoloInteractionMode,
  HoloLayer,
  HoloMaskScope,
  Layer,
  MaskAsset,
  MaskMode,
  MaskOpKind,
  Project,
  TechKind,
  Unit,
} from '../model/types';
import type { PreflightIssue } from '../preflight/preflight';

export interface PanelCallbacks {
  onUploadFile: (file: File, target: 'front' | 'back' | 'holoMask' | 'holoFoil' | 'newMask' | 'envMap', holoLayerId?: string) => Promise<void>;
  onResetDefaults: () => Promise<void>;
  onRunPreflight: () => Promise<void>;
  onExportZip: (opts: { pdf: boolean; tiffs: boolean; holoPattern: boolean; dieline: boolean; mockup: boolean; video: boolean; specSheet: boolean }) => Promise<void>;
  onExportVideo: () => Promise<void>;
  onSaveProject: () => Promise<void>;
  onOpenProject: () => void;
  getPreflight: () => PreflightIssue[];
  getMaskThumb: (id: string) => string | null;
  getExportState: () => { busy: boolean; pct: number; label: string; downloadUrl?: string; downloadName?: string; downloadSize?: number };
}

const exportChecks = { pdf: true, tiffs: true, holoPattern: true, dieline: true, mockup: true, video: false, specSheet: true };

export function renderPanel(container: HTMLElement, p: Project, ui: UIState, cb: PanelCallbacks) {
  const scroll = container.scrollTop;
  container.innerHTML = '';
  switch (ui.tab) {
    case 'artwork':
      renderArtworkTab(container, p, cb);
      break;
    case 'holo':
      renderHoloTab(container, p, ui, cb);
      break;
    case 'layers':
      renderLayersTab(container, p, ui, cb);
      break;
    case 'masks':
      renderMasksTab(container, p, ui, cb);
      break;
    case 'env':
      renderEnvTab(container, p, cb);
      break;
    case 'specs':
      renderSpecsTab(container, p);
      break;
    case 'preflight':
      renderPreflightTab(container, cb);
      break;
    case 'export':
      renderExportTab(container, p, cb);
      break;
  }
  container.scrollTop = scroll;
}

// ============================================================
// 1. ARTWORK TAB
// ============================================================
function renderArtworkTab(root: HTMLElement, p: Project, cb: PanelCallbacks) {
  const makeSlot = (
    label: string,
    thumb: string | null,
    target: 'front' | 'back' | 'holoMask' | 'holoFoil',
    removable: boolean,
    onClear?: () => void,
  ) => {
    const input = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/*',
      hidden: true,
      onchange: () => {
        if (input.files?.[0]) void cb.onUploadFile(input.files[0], target);
        input.value = '';
      },
    });
    const slot = el(
      'div',
      {
        class: 'slot',
        'data-empty': !thumb,
        ondragover: (e: DragEvent) => { e.preventDefault(); slot.classList.add('is-over'); },
        ondragleave: () => slot.classList.remove('is-over'),
        ondrop: (e: DragEvent) => {
          e.preventDefault();
          slot.classList.remove('is-over');
          const f = e.dataTransfer?.files?.[0];
          if (f) void cb.onUploadFile(f, target);
        },
      },
      el('button', { class: 'slot__drop', type: 'button', onclick: () => input.click() }, el('img', { src: thumb ?? '', alt: label, draggable: false })),
      removable && thumb ? el('button', { class: 'slot__clear', type: 'button', title: t('layers.del'), onclick: () => onClear?.() }, '×') : null,
      el('span', { class: 'slot__name' }, label),
      input,
    );
    return slot;
  };

  const primaryHolo = p.holo.layers[0];
  const firstMaskId = primaryHolo?.masks[0]?.maskId ?? null;
  const holoMaskAsset = p.masks.find((m) => m.id === firstMaskId);
  const holoMaskThumb = holoMaskAsset?.sourceId ? assets.url(holoMaskAsset.sourceId) : null;

  root.append(
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('art.slotsTitle')),
      el(
        'div',
        { class: 'slots' },
        makeSlot('Front', assets.url(p.sides.front.artworkId), 'front', false),
        makeSlot('Back', assets.url(p.sides.back.artworkId), 'back', false),
        makeSlot('Holo Mask', holoMaskThumb, 'holoMask', true, () =>
          store.update((d) => { if (d.holo.layers[0]) d.holo.layers[0].masks = []; }),
        ),
        makeSlot('Holo Foil', assets.url(primaryHolo?.foilId), 'holoFoil', true, () =>
          store.update((d) => { if (d.holo.layers[0]) d.holo.layers[0].foilId = null; }),
        ),
      ),
      el(
        'div',
        { class: 'row row--between row--spaced' },
        el('a', { class: 'text-btn', href: 'Card_Reference.zip', download: 'Card_Reference.zip' }, t('art.downloadRef')),
        el('button', { class: 'text-btn', type: 'button', onclick: () => void cb.onResetDefaults() }, t('art.resetDefault')),
      ),
    ),
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('art.fitTitle')),
      el(
        'div',
        { class: 'grid-2' },
        fitSelect(t('art.fitFront'), p.sides.front.fit, (v) => store.update((d) => { d.sides.front.fit = v; })),
        fitSelect(t('art.fitBack'), p.sides.back.fit, (v) => store.update((d) => { d.sides.back.fit = v; })),
      ),
    ),
    el(
      'section',
      { class: 'sec' },
      el(
        'h2',
        { class: 'sec__title' },
        t('art.holoSection'),
        el(
          'label',
          { style: { fontWeight: '400', textTransform: 'none', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' } },
          el('input', {
            type: 'checkbox',
            checked: p.holo.enabled,
            onchange: (e: Event) => store.update((d) => { d.holo.enabled = (e.target as HTMLInputElement).checked; }),
          }),
          t('art.enableHolo'),
        ),
      ),
      holoStyleSelect(primaryHolo?.styleId ?? DEFAULT_STYLE, !p.holo.enabled, (v) =>
        store.update((d) => { if (d.holo.layers[0]) d.holo.layers[0].styleId = v; }),
      ),
      el(
        'div',
        { class: 'row row--between row--spaced' },
        el('span', { class: 'list-item__meta' }, `${p.holo.layers.length} holo · ${p.holo.interaction.mode}`),
        el('button', {
          class: 'text-btn',
          type: 'button',
          onclick: () => store.setUI({ tab: 'holo' }),
        }, t('art.openHoloDeep')),
      ),
    ),
  );
}

function fitSelect(label: string, value: Fit, onChange: (v: Fit) => void) {
  return el(
    'div',
    { class: 'field' },
    el('div', { class: 'field__head' }, label),
    el(
      'select',
      { class: 'select-native', onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as Fit) },
      el('option', { value: 'auto', selected: value === 'auto' }, t('art.fitAuto')),
      el('option', { value: 'bleed', selected: value === 'bleed' }, t('art.fitBleed')),
      el('option', { value: 'trim', selected: value === 'trim' }, t('art.fitTrim')),
    ),
  );
}

function holoStyleSelect(styleId: string, disabled: boolean, onChange: (v: string) => void) {
  const sel = el('select', {
    class: 'select-native',
    disabled,
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
  });
  for (const key of Object.keys(ENGINES) as ('css' | '151')[]) {
    const grp = el('optgroup', { label: ENGINES[key].label });
    STYLES.filter((s) => s.engine === key).forEach((s) => {
      grp.append(el('option', { value: s.id, selected: styleId === s.id }, s.label));
    });
    sel.append(grp);
  }
  return sel;
}

// ============================================================
// 2. MULTI-HOLO LAYERS & DEEP HOLO STUDIO TAB
// ============================================================
let draggedHoloId: string | null = null;

function renderHoloTab(root: HTMLElement, p: Project, ui: UIState, cb: PanelCallbacks) {
  const h = p.holo;
  const hLayers = h.layers;
  const selected = hLayers.find((l) => l.id === ui.selectedHoloLayerId) ?? hLayers[hLayers.length - 1] ?? null;

  const addHoloLayer = () => {
    const nextIdx = hLayers.length + 1;
    const defaultMask = p.masks[0]?.id ?? null;
    const layer = newHoloLayer('css:regular-holo', defaultMask, null, `Holo ${nextIdx}`);
    store.update((d) => { d.holo.layers.push(layer); });
    store.setUI({ selectedHoloLayerId: layer.id });
  };

  const duplicateHolo = (l: HoloLayer) => {
    const copy: HoloLayer = {
      ...JSON.parse(JSON.stringify(l)),
      id: uid('holo'),
      name: `${l.name} Copy`,
      locked: false,
    };
    store.update((d) => {
      const idx = d.holo.layers.findIndex((x) => x.id === l.id);
      d.holo.layers.splice(idx + 1, 0, copy);
    });
    store.setUI({ selectedHoloLayerId: copy.id });
  };

  const reorderHolo = (srcId: string, targetId: string, placeAbove: boolean) => {
    if (srcId === targetId) return;
    store.update((d) => {
      const from = d.holo.layers.findIndex((x) => x.id === srcId);
      if (from < 0) return;
      const [moved] = d.holo.layers.splice(from, 1);
      const to = d.holo.layers.findIndex((x) => x.id === targetId);
      if (to < 0) { d.holo.layers.push(moved); return; }
      d.holo.layers.splice(placeAbove ? to + 1 : to, 0, moved);
    });
  };

  const moveHolo = (idx: number, delta: number) => {
    store.update((d) => {
      const target = idx + delta;
      if (target < 0 || target >= d.holo.layers.length) return;
      const [item] = d.holo.layers.splice(idx, 1);
      d.holo.layers.splice(target, 0, item);
    });
  };

  // Multi-Holo Layer Stack (Photoshop style)
  const stackSec = el('section', { class: 'sec' });
  stackSec.append(
    el(
      'div',
      { class: 'row row--between', style: { marginBottom: '8px' } },
      el('button', { class: 'btn btn--primary', type: 'button', onclick: addHoloLayer }, t('holo.addLayer')),
      el(
        'label',
        { style: { fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' } },
        el('input', {
          type: 'checkbox',
          checked: h.enabled,
          onchange: (e: Event) => store.update((d) => { d.holo.enabled = (e.target as HTMLInputElement).checked; }),
        }),
        t('art.enableHolo'),
      ),
    ),
    el(
      'div',
      { class: 'ps-head' },
      el('strong', {}, `${t('holo.stackTitle')} (${hLayers.length})`),
      ui.soloHoloLayerId ? el('span', { class: 'solo-tag' }, 'Solo') : null,
    ),
  );

  const stack = el('div', { class: 'ps-stack' });
  const reversed = [...hLayers].reverse();
  reversed.forEach((l) => {
    const stObj = STYLES.find((s) => s.id === l.styleId);
    const firstMaskId = l.masks[0]?.maskId ?? null;
    const maskThumb = firstMaskId ? cb.getMaskThumb(firstMaskId) : null;
    const isSolo = ui.soloHoloLayerId === l.id;
    const isVis = ui.soloHoloLayerId ? isSolo : l.visible;

    const nameEl = el(
      'span',
      {
        class: 'ps-layer__name',
        title: t('layers.dblRename'),
        ondblclick: (e: Event) => {
          e.stopPropagation();
          if (l.locked) return;
          const inp = el('input', {
            class: 'ps-layer__name-input',
            type: 'text',
            value: l.name,
            onblur: () => {
              const v = inp.value.trim() || 'Holo';
              store.update((d) => { const x = d.holo.layers.find((i) => i.id === l.id); if (x) x.name = v; });
            },
            onkeydown: (ke: KeyboardEvent) => {
              if (ke.key === 'Enter') inp.blur();
              if (ke.key === 'Escape') { inp.value = l.name; inp.blur(); }
            },
          });
          nameEl.replaceWith(inp);
          inp.focus();
          inp.select();
        },
      },
      l.name,
    );

    const row = el(
      'div',
      {
        class: `ps-layer ${selected?.id === l.id ? 'is-selected' : ''} ${l.locked ? 'is-locked' : ''}`,
        draggable: true,
        onclick: () => store.setUI({ selectedHoloLayerId: l.id }),
        ondragstart: (e: DragEvent) => { draggedHoloId = l.id; e.dataTransfer?.setData('text/plain', l.id); },
        ondragend: () => { draggedHoloId = null; },
        ondragover: (e: DragEvent) => {
          if (!draggedHoloId || draggedHoloId === l.id) return;
          e.preventDefault();
          const rect = row.getBoundingClientRect();
          const top = e.clientY < rect.top + rect.height / 2;
          row.classList.toggle('drag-over-top', top);
          row.classList.toggle('drag-over-bottom', !top);
        },
        ondragleave: () => row.classList.remove('drag-over-top', 'drag-over-bottom'),
        ondrop: (e: DragEvent) => {
          e.preventDefault();
          const top = row.classList.contains('drag-over-top');
          row.classList.remove('drag-over-top', 'drag-over-bottom');
          if (draggedHoloId) reorderHolo(draggedHoloId, l.id, top);
          draggedHoloId = null;
        },
      },
      el('button', {
        type: 'button',
        class: `ps-eye ${isVis ? '' : 'is-off'}`,
        title: t('layers.vis'),
        onclick: (e: Event) => {
          e.stopPropagation();
          if (ui.soloHoloLayerId) store.setUI({ soloHoloLayerId: null });
          store.update((d) => { const x = d.holo.layers.find((i) => i.id === l.id); if (x) x.visible = !x.visible; });
        },
      }, icon(isVis ? 'eye' : 'eye-off', 14)),
      el(
        'div',
        { class: 'ps-layer__thumbs' },
        el('div', {
          class: 'ps-layer__swatch',
          style: { background: 'linear-gradient(135deg,#f80e35,#eedf10,#21e985,#0dbde9,#c929f1)' },
          title: stObj?.label ?? l.styleId,
        }),
        l.masks.length > 0 ? el('span', { class: 'ps-layer__link' }, icon('link', 12)) : null,
        l.masks.length > 0 ? el('img', { class: 'ps-layer__mask', src: maskThumb ?? '', alt: '' }) : null,
      ),
      el(
        'div',
        { class: 'ps-layer__info' },
        nameEl,
        el('span', { class: 'ps-layer__sub' }, `${stObj?.label ?? l.styleId} · ${l.masks.length}M${l.masking.invert ? ' (Inv)' : ''}`),
      ),
      el(
        'div',
        { class: 'ps-layer__acts' },
        el('button', {
          type: 'button',
          class: `ps-solo ${isSolo ? 'is-on' : ''}`,
          title: t('layers.solo'),
          onclick: (e: Event) => {
            e.stopPropagation();
            store.setUI({ soloHoloLayerId: isSolo ? null : l.id });
          },
        }, 'S'),
        el('button', {
          type: 'button',
          title: t('layers.lock'),
          onclick: (e: Event) => {
            e.stopPropagation();
            store.update((d) => { const x = d.holo.layers.find((i) => i.id === l.id); if (x) x.locked = !x.locked; });
          },
        }, icon(l.locked ? 'lock' : 'unlock', 14)),
      ),
    );
    stack.append(row);
  });

  const selIdx = selected ? hLayers.findIndex((x) => x.id === selected.id) : -1;
  const foot = el(
    'div',
    { class: 'ps-foot' },
    el(
      'div',
      { class: 'ps-foot__group' },
      el('button', { type: 'button', disabled: !selected, title: t('layers.dup'), onclick: () => { if (selected) duplicateHolo(selected); } }, icon('copy', 14)),
      el('button', { type: 'button', disabled: !selected, title: 'Move up', onclick: () => { if (selIdx >= 0) moveHolo(selIdx, 1); } }, icon('arrow-up', 14)),
      el('button', { type: 'button', disabled: !selected, title: 'Move down', onclick: () => { if (selIdx >= 0) moveHolo(selIdx, -1); } }, icon('arrow-down', 14)),
    ),
    el('button', {
      type: 'button',
      class: 'ps-foot__del',
      disabled: !selected || selected.locked || hLayers.length <= 1,
      title: t('layers.del'),
      onclick: () => {
        if (!selected || selected.locked || hLayers.length <= 1) return;
        store.update((d) => { d.holo.layers = d.holo.layers.filter((i) => i.id !== selected.id); });
      },
    }, icon('trash', 14), t('layers.del')),
  );
  stackSec.append(stack, foot);
  root.append(stackSec);

  // Selected Holo Layer Inspector (Optics + Masking)
  if (selected) {
    const l = selected;
    const opt = l.optical;
    const msk = l.masking;
    const defOpt = defaultHoloOptical();

    const mutL = (fn: (x: HoloLayer) => void, transient = false) => {
      if (l.locked) return;
      store.update((d) => {
        const target = d.holo.layers.find((x) => x.id === l.id);
        if (target) fn(target);
      }, { transient });
    };

    const foilInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/*',
      hidden: true,
      onchange: () => {
        if (foilInput.files?.[0]) void cb.onUploadFile(foilInput.files[0], 'holoFoil', l.id);
        foilInput.value = '';
      },
    });

    const s1 = el('section', { class: 'sec' });
    s1.append(
      el(
        'h2',
        { class: 'sec__title' },
        `${t('holo.sec1')} — ${l.name}`,
        el('button', {
          class: 'text-btn',
          type: 'button',
          disabled: l.locked,
          onclick: () => mutL((x) => { x.optical = defaultHoloOptical(); }),
        }, t('holo.reset')),
      ),
      foilInput,
      el(
        'div',
        { class: 'field' },
        el('div', { class: 'field__head' }, t('holo.preset')),
        holoStyleSelect(l.styleId, !h.enabled || l.locked, (v) => mutL((x) => { x.styleId = v; })),
      ),
      el(
        'div',
        { class: 'row row--between', style: { marginBottom: '10px' } },
        el('span', { class: 'list-item__meta' }, l.foilId ? `Foil: ${assets.meta(l.foilId)?.name ?? 'custom'}` : t('holo.foilTex')),
        el(
          'div',
          { style: { display: 'flex', gap: '6px' } },
          el('button', { class: 'text-btn', type: 'button', disabled: l.locked, onclick: () => foilInput.click() }, '+ Foil'),
          l.foilId ? el('button', { class: 'text-btn', type: 'button', disabled: l.locked, onclick: () => mutL((x) => { x.foilId = null; }) }, '×') : null,
        ),
      ),
      rangeField({ label: t('holo.shine'), val: opt.shineIntensity, def: defOpt.shineIntensity, min: 0, max: 2, step: 0.05, displayScale: 100, unit: '%', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.shineIntensity = v; }, tr) }),
      rangeField({ label: t('holo.glare'), val: opt.glareIntensity, def: defOpt.glareIntensity, min: 0, max: 2, step: 0.05, displayScale: 100, unit: '%', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.glareIntensity = v; }, tr) }),
      rangeField({ label: t('holo.angle'), val: opt.angle, def: defOpt.angle, min: 0, max: 360, step: 1, unit: '°', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.angle = v; }, tr) }),
      rangeField({ label: t('holo.space'), val: opt.space, def: defOpt.space, min: 1, max: 15, step: 0.5, unit: '%', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.space = v; }, tr) }),
      rangeField({ label: t('holo.scanline'), val: opt.scanlineMm, def: defOpt.scanlineMm, min: 0.2, max: 2.5, step: 0.05, unit: 'mm', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.scanlineMm = v; }, tr) }),
      rangeField({ label: t('holo.glitter'), val: opt.glitterSize, def: defOpt.glitterSize, min: 10, max: 100, step: 1, unit: '%', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.glitterSize = v; }, tr) }),
      rangeField({ label: t('holo.hue'), val: opt.hue, def: defOpt.hue, min: -180, max: 180, step: 1, unit: '°', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.hue = v; }, tr) }),
      rangeField({ label: t('holo.sat'), val: opt.saturation, def: defOpt.saturation, min: 0, max: 2.5, step: 0.05, displayScale: 100, unit: '%', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.saturation = v; }, tr) }),
      rangeField({ label: t('holo.bright'), val: opt.brightness, def: defOpt.brightness, min: 0.4, max: 2, step: 0.05, displayScale: 100, unit: '%', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.brightness = v; }, tr) }),
      rangeField({ label: t('holo.contrast'), val: opt.contrast, def: defOpt.contrast, min: 0.5, max: 2, step: 0.05, displayScale: 100, unit: '%', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.optical.contrast = v; }, tr) }),
      el(
        'div',
        { class: 'field' },
        el('div', { class: 'field__head' }, t('holo.blend')),
        el(
          'select',
          {
            class: 'select-native',
            disabled: l.locked,
            onchange: (e: Event) => mutL((x) => { x.optical.blendMode = (e.target as HTMLSelectElement).value as HoloBlendMode; }),
          },
          el('option', { value: 'auto', selected: opt.blendMode === 'auto' }, 'Auto (color-dodge)'),
          el('option', { value: 'color-dodge', selected: opt.blendMode === 'color-dodge' }, 'Color Dodge'),
          el('option', { value: 'screen', selected: opt.blendMode === 'screen' }, 'Screen'),
          el('option', { value: 'overlay', selected: opt.blendMode === 'overlay' }, 'Overlay'),
          el('option', { value: 'hard-light', selected: opt.blendMode === 'hard-light' }, 'Hard Light'),
          el('option', { value: 'soft-light', selected: opt.blendMode === 'soft-light' }, 'Soft Light'),
          el('option', { value: 'lighten', selected: opt.blendMode === 'lighten' }, 'Lighten'),
          el('option', { value: 'plus-lighter', selected: opt.blendMode === 'plus-lighter' }, 'Plus Lighter'),
        ),
      ),
    );
    root.append(s1);

    // Masking for THIS Holo layer
    const maskFileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/*',
      hidden: true,
      onchange: () => {
        if (maskFileInput.files?.[0]) void cb.onUploadFile(maskFileInput.files[0], 'holoMask', l.id);
        maskFileInput.value = '';
      },
    });

    const s3 = el('section', { class: 'sec' });
    s3.append(
      el('h2', { class: 'sec__title' }, `${t('holo.sec3')} — ${l.name}`),
      maskFileInput,
      el(
        'div',
        { class: 'field' },
        el('div', { class: 'field__head' }, t('holo.scope')),
        el(
          'select',
          {
            class: 'select-native',
            disabled: l.locked,
            onchange: (e: Event) => mutL((x) => { x.masking.scope = (e.target as HTMLSelectElement).value as HoloMaskScope; }),
          },
          el('option', { value: 'shine', selected: msk.scope === 'shine' }, t('holo.scope.shine')),
          el('option', { value: 'shine-glare', selected: msk.scope === 'shine-glare' }, t('holo.scope.sg')),
          el('option', { value: 'all', selected: msk.scope === 'all' }, t('holo.scope.all')),
          el('option', { value: 'none', selected: msk.scope === 'none' }, t('holo.scope.none')),
        ),
      ),
      rangeField({ label: t('holo.choke'), val: msk.chokeMm, def: 0, min: -1, max: 1, step: 0.05, unit: 'mm', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.masking.chokeMm = v; }, tr) }),
      rangeField({ label: t('holo.feather'), val: msk.featherMm, def: 0, min: 0, max: 2, step: 0.05, unit: 'mm', disabled: l.locked, onChange: (v, tr) => mutL((x) => { x.masking.featherMm = v; }, tr) }),
      el(
        'label',
        { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
        el('input', { type: 'checkbox', checked: msk.invert, disabled: l.locked, onchange: (e: Event) => mutL((x) => { x.masking.invert = (e.target as HTMLInputElement).checked; }) }),
        t('holo.invertMask'),
      ),
      el(
        'label',
        { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
        el('input', { type: 'checkbox', checked: msk.previewOverlay, onchange: (e: Event) => mutL((x) => { x.masking.previewOverlay = (e.target as HTMLInputElement).checked; }) }),
        t('holo.previewMask'),
      ),
      el(
        'label',
        { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
        el('input', { type: 'checkbox', checked: msk.exportAsPlate, disabled: l.locked, onchange: (e: Event) => mutL((x) => { x.masking.exportAsPlate = (e.target as HTMLInputElement).checked; }) }),
        t('holo.exportPlate'),
      ),
      el(
        'div',
        { class: 'row', style: { marginTop: '8px' } },
        el('button', { class: 'btn', type: 'button', disabled: l.locked, onclick: () => maskFileInput.click() }, t('holo.uploadMask')),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          disabled: l.locked,
          onclick: () => {
            const m = newMask({ name: `${l.name} Auto`, sourceId: p.sides.front.artworkId, mode: 'luminance' });
            store.update((d) => {
              d.masks.push(m);
              const target = d.holo.layers.find((x) => x.id === l.id);
              if (target) target.masks.push({ maskId: m.id, op: 'add' });
            });
          },
        }, t('holo.fromFront')),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          disabled: l.locked,
          onclick: () => {
            if (!p.masks.length) return;
            mutL((x) => { x.masks.push({ maskId: p.masks[0].id, op: 'add' }); });
          },
        }, t('holo.assignMask')),
      ),
    );

    if (!l.masks.length) {
      s3.append(el('div', { class: 'list-item__meta', style: { marginTop: '6px' } }, t('holo.noMasks')));
    } else {
      const stackWrap = el('div', { style: { marginTop: '8px' } });
      l.masks.forEach((ref, idx) => {
        stackWrap.append(
          el(
            'div',
            { class: 'mask-ref-row' },
            el(
              'select',
              { class: 'select-native', disabled: l.locked, onchange: (e: Event) => mutL((x) => { x.masks[idx].op = (e.target as HTMLSelectElement).value as MaskOpKind; }) },
              el('option', { value: 'add', selected: ref.op === 'add' }, 'Union (+)'),
              el('option', { value: 'subtract', selected: ref.op === 'subtract' }, 'Subtract (−)'),
              el('option', { value: 'intersect', selected: ref.op === 'intersect' }, 'Intersect (∩)'),
              el('option', { value: 'xor', selected: ref.op === 'xor' }, 'XOR (⊕)'),
            ),
            el(
              'select',
              { class: 'select-native', disabled: l.locked, onchange: (e: Event) => mutL((x) => { x.masks[idx].maskId = (e.target as HTMLSelectElement).value; }) },
              ...p.masks.map((m) => el('option', { value: m.id, selected: m.id === ref.maskId }, m.name)),
            ),
            el('button', {
              class: 'icon-btn mask-ref-del',
              type: 'button',
              disabled: l.locked,
              title: t('layers.del'),
              onclick: () => mutL((x) => { x.masks.splice(idx, 1); }),
            }, icon('close', 14)),
          ),
        );
      });
      s3.append(stackWrap);
    }
    root.append(s3);
  }

  // Global Interaction & Physics (shared across all Holo layers)
  const inter = h.interaction;
  const defH = defaultHoloConfig(DEFAULT_STYLE, null, null);
  const mutInter = (fn: (i: typeof inter) => void, transient = false) =>
    store.update((d) => fn(d.holo.interaction), { transient });

  const s2 = el('section', { class: 'sec' });
  s2.append(
    el(
      'h2',
      { class: 'sec__title' },
      t('holo.sec2'),
      el('button', {
        class: 'text-btn',
        type: 'button',
        onclick: () => store.update((d) => { d.holo.interaction = { ...defH.interaction }; }),
      }, t('holo.reset')),
    ),
    el(
      'div',
      { class: 'grid-2' },
      el(
        'div',
        { class: 'field' },
        el('div', { class: 'field__head' }, t('holo.mode')),
        el(
          'select',
          { class: 'select-native', onchange: (e: Event) => mutInter((i) => { i.mode = (e.target as HTMLSelectElement).value as HoloInteractionMode; }) },
          el('option', { value: 'pointer-auto', selected: inter.mode === 'pointer-auto' }, t('holo.mode.pa')),
          el('option', { value: 'pointer', selected: inter.mode === 'pointer' }, t('holo.mode.p')),
          el('option', { value: 'auto', selected: inter.mode === 'auto' }, t('holo.mode.a')),
          el('option', { value: 'manual', selected: inter.mode === 'manual' }, t('holo.mode.m')),
        ),
      ),
      el(
        'div',
        { class: 'field' },
        el('div', { class: 'field__head' }, t('holo.pattern')),
        el(
          'select',
          {
            class: 'select-native',
            disabled: inter.mode === 'pointer' || inter.mode === 'manual',
            onchange: (e: Event) => mutInter((i) => { i.autoPattern = (e.target as HTMLSelectElement).value as HoloAutoPattern; }),
          },
          el('option', { value: 'orbit', selected: inter.autoPattern === 'orbit' }, t('holo.pat.orbit')),
          el('option', { value: 'figure8', selected: inter.autoPattern === 'figure8' }, t('holo.pat.fig8')),
          el('option', { value: 'sweep-x', selected: inter.autoPattern === 'sweep-x' }, t('holo.pat.sx')),
          el('option', { value: 'sweep-y', selected: inter.autoPattern === 'sweep-y' }, t('holo.pat.sy')),
        ),
      ),
    ),
  );

  if (inter.mode === 'manual') {
    s2.append(
      rangeField({ label: t('holo.manX'), val: inter.manualX, def: defH.interaction.manualX, min: -35, max: 35, step: 0.5, unit: '°', onChange: (v, tr) => mutInter((i) => { i.manualX = v; }, tr) }),
      rangeField({ label: t('holo.manY'), val: inter.manualY, def: defH.interaction.manualY, min: -35, max: 35, step: 0.5, unit: '°', onChange: (v, tr) => mutInter((i) => { i.manualY = v; }, tr) }),
      rangeField({ label: t('holo.lightX'), val: inter.manualLightX, def: defH.interaction.manualLightX, min: 0, max: 100, step: 1, unit: '%', onChange: (v, tr) => mutInter((i) => { i.manualLightX = v; }, tr) }),
      rangeField({ label: t('holo.lightY'), val: inter.manualLightY, def: defH.interaction.manualLightY, min: 0, max: 100, step: 1, unit: '%', onChange: (v, tr) => mutInter((i) => { i.manualLightY = v; }, tr) }),
    );
  } else {
    s2.append(
      rangeField({ label: t('holo.amp'), val: inter.amp, def: defH.interaction.amp, min: 3, max: 30, step: 0.5, unit: '°', onChange: (v, tr) => mutInter((i) => { i.amp = v; }, tr) }),
      rangeField({ label: t('holo.freq'), val: inter.freq, def: defH.interaction.freq, min: 0.05, max: 1.5, step: 0.05, unit: 'Hz', onChange: (v, tr) => mutInter((i) => { i.freq = v; }, tr) }),
      rangeField({ label: t('holo.sens'), val: inter.sensitivity, def: defH.interaction.sensitivity, min: 0.3, max: 2.5, step: 0.05, unit: '×', onChange: (v, tr) => mutInter((i) => { i.sensitivity = v; }, tr) }),
      rangeField({ label: t('holo.parallax'), val: inter.parallax, def: defH.interaction.parallax, min: 0, max: 2, step: 0.05, displayScale: 100, unit: '%', onChange: (v, tr) => mutInter((i) => { i.parallax = v; }, tr) }),
      rangeField({ label: t('holo.stiff'), val: inter.stiffness, def: defH.interaction.stiffness, min: 0.02, max: 0.3, step: 0.005, onChange: (v, tr) => mutInter((i) => { i.stiffness = v; }, tr) }),
      rangeField({ label: t('holo.damp'), val: inter.damping, def: defH.interaction.damping, min: 0.1, max: 0.8, step: 0.01, onChange: (v, tr) => mutInter((i) => { i.damping = v; }, tr) }),
      rangeField({ label: t('holo.restGlow'), val: inter.restingGlow, def: defH.interaction.restingGlow, min: 0, max: 1, step: 0.05, displayScale: 100, unit: '%', onChange: (v, tr) => mutInter((i) => { i.restingGlow = v; }, tr) }),
      el(
        'label',
        { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
        el('input', { type: 'checkbox', checked: inter.invertTilt, onchange: (e: Event) => mutInter((i) => { i.invertTilt = (e.target as HTMLInputElement).checked; }) }),
        t('holo.invertTilt'),
      ),
    );
  }
  root.append(s2);
}

// ============================================================
// 3. PHOTOSHOP-STYLE LAYERS TAB
// ============================================================
let draggedLayerId: string | null = null;

function renderLayersTab(root: HTMLElement, p: Project, ui: UIState, cb: PanelCallbacks) {
  const sideLabel = ui.side === 'back' ? t('side.back') : t('side.front');
  const sideLayers = p.layers.filter((l) => l.side === ui.side);
  const selected = sideLayers.find((l) => l.id === ui.selectedLayerId) ?? sideLayers[sideLayers.length - 1] ?? null;

  const addTech = (kind: TechKind) => {
    const defaultMask = p.masks[0]?.id ?? null;
    const layer = newLayer(kind, ui.side, defaultMask);
    store.update((d) => { d.layers.push(layer); });
    store.setUI({ selectedLayerId: layer.id });
  };

  const duplicateLayer = (l: Layer) => {
    const copy: Layer = {
      ...JSON.parse(JSON.stringify(l)),
      id: uid('layer'),
      name: `${l.name} Copy`,
      locked: false,
    };
    store.update((d) => {
      const idx = d.layers.findIndex((x) => x.id === l.id);
      d.layers.splice(idx + 1, 0, copy);
    });
    store.setUI({ selectedLayerId: copy.id });
  };

  const reorderLayer = (srcId: string, targetId: string, placeAbove: boolean) => {
    if (srcId === targetId) return;
    store.update((d) => {
      const from = d.layers.findIndex((x) => x.id === srcId);
      if (from < 0) return;
      const [moved] = d.layers.splice(from, 1);
      const to = d.layers.findIndex((x) => x.id === targetId);
      if (to < 0) { d.layers.push(moved); return; }
      // Because the visual list is reversed (topmost = highest index in d.layers),
      // placing visually ABOVE target means inserting at to + 1.
      d.layers.splice(placeAbove ? to + 1 : to, 0, moved);
    });
  };

  // Add technique quick grid
  root.append(
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, `${t('layers.addTitle')} (${sideLabel})`),
      el(
        'div',
        { class: 'tech-grid' },
        ...TECH_ORDER.map((kind) => {
          const def = TECHS[kind];
          return el(
            'button',
            { class: 'tech-add', type: 'button', title: def.description, onclick: () => addTech(kind) },
            el('span', { class: 'swatch', style: { background: def.view } }),
            `+ ${def.short}`,
          );
        }),
      ),
    ),
  );

  // Photoshop-style Layer Stack
  const stackSec = el('section', { class: 'sec' });
  stackSec.append(
    el(
      'div',
      { class: 'ps-head' },
      el('strong', {}, `${t('layers.stackTitle')} (${sideLayers.length})`),
      ui.soloLayerId ? el('span', { class: 'solo-tag' }, 'Solo') : null,
    ),
  );

  const stack = el('div', { class: 'ps-stack' });
  if (!sideLayers.length) {
    stack.append(el('div', { class: 'list-item__meta', style: { padding: '12px 10px' } }, t('layers.empty')));
  } else {
    const reversed = [...sideLayers].reverse();
    reversed.forEach((l) => {
      const def = TECHS[l.kind];
      const firstMaskId = l.masks[0]?.maskId ?? null;
      const maskThumb = firstMaskId ? cb.getMaskThumb(firstMaskId) : null;
      const isSolo = ui.soloLayerId === l.id;
      const isVisEffective = ui.soloLayerId ? isSolo : l.visible;

      const nameEl = el(
        'span',
        {
          class: 'ps-layer__name',
          title: t('layers.dblRename'),
          ondblclick: (e: Event) => {
            e.stopPropagation();
            if (l.locked) return;
            const inp = el('input', {
              class: 'ps-layer__name-input',
              type: 'text',
              value: l.name,
              onblur: () => {
                const v = inp.value.trim() || def.short;
                store.update((d) => { const x = d.layers.find((i) => i.id === l.id); if (x) x.name = v; });
              },
              onkeydown: (ke: KeyboardEvent) => {
                if (ke.key === 'Enter') inp.blur();
                if (ke.key === 'Escape') { inp.value = l.name; inp.blur(); }
              },
            });
            nameEl.replaceWith(inp);
            inp.focus();
            inp.select();
          },
        },
        l.name,
      );

      const row = el(
        'div',
        {
          class: `ps-layer ${selected?.id === l.id ? 'is-selected' : ''} ${l.locked ? 'is-locked' : ''}`,
          draggable: true,
          onclick: () => store.setUI({ selectedLayerId: l.id }),
          ondragstart: (e: DragEvent) => {
            draggedLayerId = l.id;
            e.dataTransfer?.setData('text/plain', l.id);
          },
          ondragend: () => { draggedLayerId = null; },
          ondragover: (e: DragEvent) => {
            if (!draggedLayerId || draggedLayerId === l.id) return;
            e.preventDefault();
            const rect = row.getBoundingClientRect();
            const top = e.clientY < rect.top + rect.height / 2;
            row.classList.toggle('drag-over-top', top);
            row.classList.toggle('drag-over-bottom', !top);
          },
          ondragleave: () => {
            row.classList.remove('drag-over-top', 'drag-over-bottom');
          },
          ondrop: (e: DragEvent) => {
            e.preventDefault();
            const top = row.classList.contains('drag-over-top');
            row.classList.remove('drag-over-top', 'drag-over-bottom');
            if (draggedLayerId) reorderLayer(draggedLayerId, l.id, top);
            draggedLayerId = null;
          },
        },
        el('button', {
          type: 'button',
          class: `ps-eye ${isVisEffective ? '' : 'is-off'}`,
          title: t('layers.vis'),
          onclick: (e: Event) => {
            e.stopPropagation();
            if (ui.soloLayerId) store.setUI({ soloLayerId: null });
            store.update((d) => { const x = d.layers.find((i) => i.id === l.id); if (x) x.visible = !x.visible; });
          },
        }, icon(isVisEffective ? 'eye' : 'eye-off', 14)),
        el(
          'div',
          { class: 'ps-layer__thumbs' },
          el('div', { class: 'ps-layer__swatch', style: { background: def.view }, title: def.spot(l) }),
          l.masks.length > 0 ? el('span', { class: 'ps-layer__link' }, icon('link', 12)) : null,
          l.masks.length > 0 ? el('img', { class: 'ps-layer__mask', src: maskThumb ?? '', alt: '' }) : null,
        ),
        el(
          'div',
          { class: 'ps-layer__info' },
          nameEl,
          el('span', { class: 'ps-layer__sub' }, `${def.spot(l)} · ${Math.round(l.opacity * 100)}% · ${l.masks.length}M`),
        ),
        el(
          'div',
          { class: 'ps-layer__acts' },
          el('button', {
            type: 'button',
            class: `ps-solo ${isSolo ? 'is-on' : ''}`,
            title: t('layers.solo'),
            onclick: (e: Event) => {
              e.stopPropagation();
              store.setUI({ soloLayerId: isSolo ? null : l.id });
            },
          }, 'S'),
          el('button', {
            type: 'button',
            title: t('layers.lock'),
            onclick: (e: Event) => {
              e.stopPropagation();
              store.update((d) => { const x = d.layers.find((i) => i.id === l.id); if (x) x.locked = !x.locked; });
            },
          }, icon(l.locked ? 'lock' : 'unlock', 14)),
        ),
      );
      stack.append(row);
    });
  }

  // Layer stack bottom bar
  const selIdx = selected ? p.layers.findIndex((x) => x.id === selected.id) : -1;
  const foot = el(
    'div',
    { class: 'ps-foot' },
    el(
      'div',
      { class: 'ps-foot__group' },
      el('button', {
        type: 'button',
        disabled: !selected,
        title: t('layers.dup'),
        onclick: () => { if (selected) duplicateLayer(selected); },
      }, icon('copy', 14)),
      el('button', {
        type: 'button',
        disabled: !selected,
        title: 'Move up',
        onclick: () => { if (selIdx >= 0) moveLayer(selIdx, 1); },
      }, icon('arrow-up', 14)),
      el('button', {
        type: 'button',
        disabled: !selected,
        title: 'Move down',
        onclick: () => { if (selIdx >= 0) moveLayer(selIdx, -1); },
      }, icon('arrow-down', 14)),
    ),
    el('button', {
      type: 'button',
      class: 'ps-foot__del',
      disabled: !selected || selected.locked,
      title: t('layers.del'),
      onclick: () => {
        if (!selected || selected.locked) return;
        store.update((d) => { d.layers = d.layers.filter((i) => i.id !== selected.id); });
      },
    }, icon('trash', 14), t('layers.del')),
  );

  stackSec.append(stack, foot);
  root.append(stackSec);

  if (selected) renderLayerInspector(root, p, selected, ui);
}

function moveLayer(idx: number, delta: number) {
  store.update((d) => {
    const target = idx + delta;
    if (target < 0 || target >= d.layers.length) return;
    const [item] = d.layers.splice(idx, 1);
    d.layers.splice(target, 0, item);
  });
}

function renderLayerInspector(root: HTMLElement, p: Project, l: Layer, ui: UIState) {
  const def = TECHS[l.kind];
  const mut = (fn: (x: Layer) => void, transient = false) => {
    if (l.locked) return;
    store.update((d) => {
      const target = d.layers.find((x) => x.id === l.id);
      if (target) fn(target);
    }, { transient });
  };

  const sec = el('section', { class: 'sec' });
  sec.append(el('h2', { class: 'sec__title' }, `${t('layers.props')}: ${def.short}`));
  if (l.locked) sec.append(el('div', { class: 'issue issue--warn', style: { marginBottom: '10px', cursor: 'default' } }, t('layers.lockedHint')));
  sec.append(
    el(
      'div',
      { class: 'field' },
      el('div', { class: 'field__head' }, t('layers.plateName')),
      el('input', {
        class: 'input',
        type: 'text',
        value: l.name,
        disabled: l.locked,
        onchange: (e: Event) => mut((x) => { x.name = (e.target as HTMLInputElement).value || def.short; }),
      }),
    ),
    rangeField({ label: t('layers.opacity'), val: l.opacity, def: 1, min: 0, max: 1, step: 0.01, displayScale: 100, unit: '%', disabled: l.locked, onChange: (v, tr) => mut((x) => { x.opacity = v; }, tr) }),
    rangeField({ label: t('layers.trapping'), val: l.chokeMm, def: 0, min: -1, max: 1, step: 0.05, unit: 'mm', disabled: l.locked, onChange: (v, tr) => mut((x) => { x.chokeMm = v; }, tr) }),
    el(
      'label',
      { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
      el('input', {
        type: 'checkbox',
        checked: l.invert,
        disabled: l.locked,
        onchange: (e: Event) => mut((x) => { x.invert = (e.target as HTMLInputElement).checked; }),
      }),
      t('layers.invert'),
    ),
    el(
      'label',
      { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
      el('input', {
        type: 'checkbox',
        checked: ui.layerMaskOverlay,
        onchange: (e: Event) => store.setUI({ layerMaskOverlay: (e.target as HTMLInputElement).checked }),
      }),
      t('layers.maskOverlay'),
    ),
  );

  for (const pd of def.params) {
    const cur = l.params[pd.key] ?? def.defaults[pd.key];
    if (pd.type === 'select' && pd.options) {
      sec.append(
        el(
          'div',
          { class: 'field' },
          el('div', { class: 'field__head' }, pd.label),
          el(
            'select',
            {
              class: 'select-native',
              disabled: l.locked,
              onchange: (e: Event) => mut((x) => { x.params[pd.key] = (e.target as HTMLSelectElement).value; }),
            },
            ...pd.options.map((o) => el('option', { value: o.value, selected: String(cur) === o.value }, o.label)),
          ),
        ),
      );
    } else if (pd.type === 'range') {
      sec.append(
        rangeField({
          label: pd.label,
          val: Number(cur),
          def: Number(def.defaults[pd.key]),
          min: pd.min ?? 0,
          max: pd.max ?? 1,
          step: pd.step ?? 0.01,
          unit: pd.unit ?? '',
          disabled: l.locked,
          onChange: (v, tr) => mut((x) => { x.params[pd.key] = v; }, tr),
        }),
      );
    }
  }

  // Multi-mask boolean stack
  const maskSec = el('div', { style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--rule)' } });
  maskSec.append(
    el(
      'div',
      { class: 'sec__title' },
      t('layers.maskStack'),
      el('button', {
        class: 'text-btn',
        type: 'button',
        disabled: l.locked,
        onclick: () => {
          if (!p.masks.length || l.locked) return;
          mut((x) => { x.masks.push({ maskId: p.masks[0].id, op: 'add' }); });
        },
      }, t('layers.addMask')),
    ),
  );

  if (!l.masks.length) {
    maskSec.append(el('div', { class: 'list-item__meta' }, t('layers.noMask')));
  } else {
    l.masks.forEach((ref, idx) => {
      maskSec.append(
        el(
          'div',
          { class: 'mask-ref-row' },
          el(
            'select',
            {
              class: 'select-native',
              disabled: l.locked,
              onchange: (e: Event) => mut((x) => { x.masks[idx].op = (e.target as HTMLSelectElement).value as MaskOpKind; }),
            },
            el('option', { value: 'add', selected: ref.op === 'add' }, 'Union (+)'),
            el('option', { value: 'subtract', selected: ref.op === 'subtract' }, 'Subtract (−)'),
            el('option', { value: 'intersect', selected: ref.op === 'intersect' }, 'Intersect (∩)'),
            el('option', { value: 'xor', selected: ref.op === 'xor' }, 'XOR (⊕)'),
          ),
          el(
            'select',
            {
              class: 'select-native',
              disabled: l.locked,
              onchange: (e: Event) => mut((x) => { x.masks[idx].maskId = (e.target as HTMLSelectElement).value; }),
            },
            ...p.masks.map((m) => el('option', { value: m.id, selected: m.id === ref.maskId }, m.name)),
          ),
          el('button', {
            class: 'icon-btn mask-ref-del',
            type: 'button',
            disabled: l.locked,
            title: t('layers.del'),
            onclick: () => mut((x) => { x.masks.splice(idx, 1); }),
          }, icon('close', 14)),
        ),
      );
    });
  }

  sec.append(maskSec);
  root.append(sec);
}

// ============================================================
// 4. MASKS TAB
// ============================================================
function renderMasksTab(root: HTMLElement, p: Project, ui: UIState, cb: PanelCallbacks) {
  const fileInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/*',
    hidden: true,
    onchange: () => {
      if (fileInput.files?.[0]) void cb.onUploadFile(fileInput.files[0], 'newMask');
      fileInput.value = '';
    },
  });

  root.append(
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('masks.createTitle')),
      fileInput,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => fileInput.click() }, t('masks.upload')),
        el('button', {
          class: 'btn',
          type: 'button',
          onclick: () => {
            const artId = p.sides[ui.side].artworkId;
            const m = newMask({ name: `Auto (${ui.side === 'back' ? 'Back' : 'Front'})`, sourceId: artId, mode: 'luminance' });
            store.update((d) => { d.masks.push(m); });
            store.setUI({ selectedMaskId: m.id });
          },
        }, t('masks.fromArt')),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: () => {
            const m = newMask({ name: 'Full Solid', sourceId: null, mode: 'solid' });
            store.update((d) => { d.masks.push(m); });
            store.setUI({ selectedMaskId: m.id });
          },
        }, t('masks.solid')),
      ),
    ),
  );

  const selected = p.masks.find((m) => m.id === ui.selectedMaskId) ?? p.masks[0] ?? null;
  const list = el('div', { class: 'list' });
  p.masks.forEach((m) => {
    const thumb = cb.getMaskThumb(m.id) ?? (m.sourceId ? assets.url(m.sourceId) : null);
    list.append(
      el(
        'div',
        {
          class: `list-item ${selected?.id === m.id ? 'is-selected' : ''}`,
          onclick: () => store.setUI({ selectedMaskId: m.id }),
        },
        el('img', { class: 'mask-thumb', src: thumb ?? '', alt: '' }),
        el('span', { class: 'list-item__title' }, m.name),
        el('span', { class: 'list-item__meta' }, m.mode),
        el('button', {
          type: 'button',
          title: t('layers.del'),
          onclick: (e: Event) => {
            e.stopPropagation();
            store.update((d) => {
              d.masks = d.masks.filter((x) => x.id !== m.id);
              d.holo.layers.forEach((hl) => { hl.masks = hl.masks.filter((r) => r.maskId !== m.id); });
              d.layers.forEach((l) => { l.masks = l.masks.filter((r) => r.maskId !== m.id); });
            });
          },
        }, '×'),
      ),
    );
  });

  root.append(el('section', { class: 'sec' }, el('h2', { class: 'sec__title' }, `${t('masks.libTitle')} (${p.masks.length})`), list));
  if (selected) renderMaskInspector(root, selected);
}

function renderMaskInspector(root: HTMLElement, m: MaskAsset) {
  const mut = (fn: (x: MaskAsset) => void, transient = false) =>
    store.update((d) => {
      const target = d.masks.find((x) => x.id === m.id);
      if (target) fn(target);
    }, { transient });

  const sec = el('section', { class: 'sec' });
  sec.append(
    el('h2', { class: 'sec__title' }, `${t('masks.editTitle')}: ${m.name}`),
    el(
      'div',
      { class: 'field' },
      el('div', { class: 'field__head' }, t('masks.name')),
      el('input', {
        class: 'input',
        type: 'text',
        value: m.name,
        onchange: (e: Event) => mut((x) => { x.name = (e.target as HTMLInputElement).value || 'Mask'; }),
      }),
    ),
    el(
      'div',
      { class: 'grid-2' },
      el(
        'div',
        { class: 'field' },
        el('div', { class: 'field__head' }, t('masks.mode')),
        el(
          'select',
          { class: 'select-native', onchange: (e: Event) => mut((x) => { x.mode = (e.target as HTMLSelectElement).value as MaskMode; }) },
          el('option', { value: 'luminance', selected: m.mode === 'luminance' }, 'Luminance / Auto'),
          el('option', { value: 'alpha', selected: m.mode === 'alpha' }, 'Alpha channel'),
          el('option', { value: 'color', selected: m.mode === 'color' }, 'Color Range'),
          el('option', { value: 'solid', selected: m.mode === 'solid' }, 'Solid (100%)'),
        ),
      ),
      fitSelect(t('masks.fit'), m.fit, (v) => mut((x) => { x.fit = v; })),
    ),
  );

  if (m.mode === 'color') {
    sec.append(
      el(
        'div',
        { class: 'row' },
        el('label', { style: { fontSize: '12px', color: 'var(--muted)' } }, t('masks.pickColor')),
        el('input', {
          type: 'color',
          value: m.color,
          oninput: (e: Event) => mut((x) => { x.color = (e.target as HTMLInputElement).value; }, true),
          onchange: () => store.commit(),
        }),
      ),
      rangeField({ label: 'Tolerance', val: m.tolerance, def: 20, min: 0, max: 100, step: 1, unit: '%', onChange: (v, tr) => mut((x) => { x.tolerance = v; }, tr) }),
      rangeField({ label: 'Softness', val: m.softness, def: 10, min: 0, max: 100, step: 1, unit: '%', onChange: (v, tr) => mut((x) => { x.softness = v; }, tr) }),
    );
  }

  sec.append(
    rangeField({ label: 'Levels Low', val: m.levelsLow, def: 0, min: 0, max: 250, step: 1, onChange: (v, tr) => mut((x) => { x.levelsLow = Math.min(v, x.levelsHigh - 1); }, tr) }),
    rangeField({ label: 'Levels High', val: m.levelsHigh, def: 255, min: 5, max: 255, step: 1, onChange: (v, tr) => mut((x) => { x.levelsHigh = Math.max(v, x.levelsLow + 1); }, tr) }),
    el(
      'label',
      { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
      el('input', {
        type: 'checkbox',
        checked: m.threshold !== null,
        onchange: (e: Event) => mut((x) => { x.threshold = (e.target as HTMLInputElement).checked ? 128 : null; }),
      }),
      t('masks.threshold'),
    ),
  );
  if (m.threshold !== null) {
    sec.append(rangeField({ label: t('masks.thresholdVal'), val: m.threshold, def: 128, min: 0, max: 255, step: 1, onChange: (v, tr) => mut((x) => { x.threshold = v; }, tr) }));
  }
  sec.append(
    rangeField({ label: t('holo.choke'), val: m.chokeMm, def: 0, min: -1, max: 1, step: 0.05, unit: 'mm', onChange: (v, tr) => mut((x) => { x.chokeMm = v; }, tr) }),
    rangeField({ label: t('holo.feather'), val: m.featherMm, def: 0, min: 0, max: 2, step: 0.05, unit: 'mm', onChange: (v, tr) => mut((x) => { x.featherMm = v; }, tr) }),
    el(
      'label',
      { class: 'row', style: { cursor: 'pointer', fontSize: '12px' } },
      el('input', {
        type: 'checkbox',
        checked: m.invert,
        onchange: (e: Event) => mut((x) => { x.invert = (e.target as HTMLInputElement).checked; }),
      }),
      t('masks.invert'),
    ),
  );
  root.append(sec);
}

// ============================================================
// 5. SPECS TAB
// ============================================================
function renderSpecsTab(root: HTMLElement, p: Project) {
  const s = p.specs;
  const numMm = (label: string, mmVal: number, onMm: (mm: number) => void, step = 0.1) => {
    const displayed = +toUnit(mmVal, s.unit, s.dpi).toFixed(s.unit === 'px' ? 0 : s.unit === 'in' ? 3 : 2);
    return el(
      'div',
      { class: 'field' },
      el('div', { class: 'field__head' }, label, el('strong', {}, s.unit)),
      el('input', {
        class: 'input',
        type: 'number',
        step: s.unit === 'px' ? 1 : s.unit === 'in' ? 0.01 : step,
        value: displayed,
        onchange: (e: Event) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (!Number.isNaN(v)) onMm(Math.max(0, fromUnit(v, s.unit, s.dpi)));
        },
      }),
    );
  };

  root.append(
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('specs.sizeTitle')),
      el(
        'div',
        { class: 'field' },
        el('div', { class: 'field__head' }, t('specs.preset')),
        el(
          'select',
          {
            class: 'select-native',
            onchange: (e: Event) => {
              const id = (e.target as HTMLSelectElement).value;
              const pr = CARD_PRESETS.find((x) => x.id === id);
              store.update((d) => {
                d.specs.preset = id;
                if (pr && id !== 'custom') { d.specs.widthMm = pr.w; d.specs.heightMm = pr.h; }
              });
            },
          },
          ...CARD_PRESETS.map((pr) => el('option', { value: pr.id, selected: s.preset === pr.id }, pr.label)),
        ),
      ),
      el(
        'div',
        { class: 'row row--between', style: { marginBottom: '10px' } },
        el('span', { class: 'list-item__meta' }, t('specs.unit')),
        el(
          'div',
          { class: 'seg' },
          ...(['mm', 'in', 'px'] as Unit[]).map((u) =>
            el('button', {
              type: 'button',
              'aria-pressed': String(s.unit === u),
              onclick: () => store.update((d) => { d.specs.unit = u; }),
            }, u),
          ),
        ),
      ),
      el(
        'div',
        { class: 'grid-2' },
        numMm(t('specs.width'), s.widthMm, (mm) => store.update((d) => { d.specs.widthMm = Math.max(10, mm); d.specs.preset = 'custom'; })),
        numMm(t('specs.height'), s.heightMm, (mm) => store.update((d) => { d.specs.heightMm = Math.max(10, mm); d.specs.preset = 'custom'; })),
        numMm(t('specs.bleed'), s.bleedMm, (mm) => store.update((d) => { d.specs.bleedMm = mm; })),
        numMm(t('specs.safe'), s.safeMm, (mm) => store.update((d) => { d.specs.safeMm = mm; })),
        numMm(t('specs.corner'), s.cornerMm, (mm) => store.update((d) => { d.specs.cornerMm = mm; })),
        el(
          'div',
          { class: 'field' },
          el('div', { class: 'field__head' }, t('specs.substrate')),
          el(
            'select',
            {
              class: 'select-native',
              onchange: (e: Event) => store.update((d) => { d.specs.substrate = (e.target as HTMLSelectElement).value as 'white' | 'metallic'; }),
            },
            el('option', { value: 'white', selected: s.substrate === 'white' }, t('specs.subWhite')),
            el('option', { value: 'metallic', selected: s.substrate === 'metallic' }, t('specs.subMetal')),
          ),
        ),
      ),
      el(
        'div',
        { class: 'list-item__meta', style: { marginTop: '4px' } },
        `${t('specs.totalBleed')} ${fmtUnit(s.widthMm + 2 * s.bleedMm, s.unit, s.dpi)} × ${fmtUnit(s.heightMm + 2 * s.bleedMm, s.unit, s.dpi)}`,
      ),
    ),
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('specs.dpiTitle')),
      el(
        'div',
        { class: 'grid-2' },
        el(
          'div',
          { class: 'field' },
          el('div', { class: 'field__head' }, t('specs.artDpi')),
          el(
            'select',
            { class: 'select-native', onchange: (e: Event) => store.update((d) => { d.specs.dpi = Number((e.target as HTMLSelectElement).value); }) },
            ...[300, 400, 600].map((v) => el('option', { value: v, selected: s.dpi === v }, `${v} DPI`)),
          ),
        ),
        el(
          'div',
          { class: 'field' },
          el('div', { class: 'field__head' }, t('specs.plateDpi')),
          el(
            'select',
            { class: 'select-native', onchange: (e: Event) => store.update((d) => { d.specs.plateDpi = Number((e.target as HTMLSelectElement).value); }) },
            ...[300, 600, 1200].map((v) => el('option', { value: v, selected: s.plateDpi === v }, `${v} DPI`)),
          ),
        ),
        el(
          'div',
          { class: 'field' },
          el('div', { class: 'field__head' }, t('specs.minFoil')),
          el('input', {
            class: 'input',
            type: 'number',
            step: 0.05,
            value: s.minFoilLineMm,
            onchange: (e: Event) => store.update((d) => { d.specs.minFoilLineMm = Math.max(0.05, parseFloat((e.target as HTMLInputElement).value) || 0.15); }),
          }),
        ),
        el(
          'div',
          { class: 'field' },
          el('div', { class: 'field__head' }, t('specs.minEmboss')),
          el('input', {
            class: 'input',
            type: 'number',
            step: 0.05,
            value: s.minEmbossLineMm,
            onchange: (e: Event) => store.update((d) => { d.specs.minEmbossLineMm = Math.max(0.1, parseFloat((e.target as HTMLInputElement).value) || 0.5); }),
          }),
        ),
      ),
    ),
  );
}

// ============================================================
// 6. PREFLIGHT TAB
// ============================================================
function renderPreflightTab(root: HTMLElement, cb: PanelCallbacks) {
  const issues = cb.getPreflight();
  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warn').length;

  root.append(
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('pf.title')),
      el('button', { class: 'btn btn--primary btn--full', type: 'button', onclick: () => void cb.onRunPreflight() }, t('pf.run')),
      issues.length
        ? el('div', { class: 'list-item__meta', style: { marginTop: '8px' } }, t('pf.summary', { e: errs, w: warns }))
        : null,
    ),
    el(
      'section',
      { class: 'sec' },
      ...issues.map((it) =>
        el(
          'div',
          {
            class: `issue issue--${it.severity}`,
            onclick: () => {
              if (it.side) {
                store.setUI({
                  side: it.side,
                  view: 'flat',
                  guides: true,
                  highlight: it.box ? { side: it.side, ...it.box } : null,
                });
              }
            },
          },
          el(
            'div',
            { class: 'issue__title' },
            icon(it.severity === 'error' ? 'x-circle' : it.severity === 'warn' ? 'alert-triangle' : 'check-circle', 14),
            el('span', {}, it.title),
          ),
          el('div', { class: 'issue__detail' }, it.detail),
        ),
      ),
    ),
  );
}

// ============================================================
// 7. EXPORT TAB
// ============================================================
function renderExportTab(root: HTMLElement, p: Project, cb: PanelCallbacks) {
  const st = cb.getExportState();
  const activeHoloCount = p.holo.enabled
    ? p.holo.layers.filter((hl) => hl.visible && (exportChecks.holoPattern || hl.masking.exportAsPlate)).length * 2
    : 0;
  const activeCount = p.layers.filter((l) => l.visible && l.masks.length > 0).length + activeHoloCount;

  const chk = (key: keyof typeof exportChecks, label: string) =>
    el(
      'label',
      { class: 'row', style: { cursor: 'pointer', fontSize: '12.5px' } },
      el('input', {
        type: 'checkbox',
        checked: exportChecks[key],
        onchange: (e: Event) => { exportChecks[key] = (e.target as HTMLInputElement).checked; },
      }),
      label,
    );

  root.append(
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('exp.title')),
      el('p', { class: 'list-item__meta', style: { margin: '0 0 10px' } }, `${p.specs.widthMm}×${p.specs.heightMm}mm • Bleed ${p.specs.bleedMm}mm • ${p.specs.dpi}/${p.specs.plateDpi} DPI • ${activeCount} plates`),
      chk('pdf', t('exp.pdf')),
      chk('tiffs', t('exp.tiffs', { a: p.specs.dpi, p: p.specs.plateDpi })),
      chk('holoPattern', t('exp.holo')),
      chk('dieline', t('exp.dieline')),
      chk('mockup', t('exp.mockup')),
      chk('video', t('exp.video')),
      chk('specSheet', t('exp.spec')),
      el(
        'button',
        {
          class: 'btn btn--primary btn--full',
          type: 'button',
          disabled: st.busy,
          style: { marginTop: '10px' },
          onclick: () => void cb.onExportZip({ ...exportChecks }),
        },
        st.busy ? t('exp.busy') : t('exp.btn'),
      ),
      el(
        'button',
        {
          class: 'btn btn--full',
          type: 'button',
          disabled: st.busy,
          style: { marginTop: '6px' },
          onclick: () => void cb.onExportVideo(),
        },
        t('exp.videoBtn'),
      ),
      st.busy || st.pct > 0 || st.label
        ? el(
            'div',
            { class: 'export-progress' },
            el('div', { class: 'progress' }, el('div', { class: 'progress__bar', style: { transform: `scaleX(${Math.max(0, Math.min(100, st.pct)) / 100})` } })),
            el('div', { class: 'list-item__meta', style: st.label.startsWith('Error:') ? { color: 'var(--err)' } : {} }, st.label),
            st.downloadUrl && st.downloadName && !st.busy
              ? el(
                  'a',
                  {
                    class: 'btn btn--full export-dl',
                    href: st.downloadUrl,
                    download: st.downloadName,
                  },
                  icon('download', 14),
                  `${st.downloadName}${st.downloadSize ? ` (${(st.downloadSize / 1048576).toFixed(1)} MB)` : ''}`,
                )
              : null,
          )
        : null,
    ),
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('exp.projTitle')),
      el(
        'div',
        { class: 'grid-2' },
        el('button', { class: 'btn', type: 'button', onclick: () => void cb.onSaveProject() }, t('exp.saveProj')),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => cb.onOpenProject() }, t('exp.openProj')),
      ),
    ),
  );
}

// ============================================================
// 4B. HDRI ENVIRONMENT TAB
// ============================================================
function renderEnvTab(root: HTMLElement, p: Project, cb: PanelCallbacks) {
  const env = normalizeEnv(p.env);
  const def = defaultEnvConfig();
  const isVi = getLang() === 'vi';
  const mut = (fn: (e: ReturnType<typeof defaultEnvConfig>) => void, transient = false) =>
    store.update((pr) => {
      pr.env = normalizeEnv(pr.env);
      fn(pr.env);
    }, { transient });

  const envInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/*',
    hidden: true,
    onchange: () => {
      if (envInput.files?.[0]) void cb.onUploadFile(envInput.files[0], 'envMap');
      envInput.value = '';
    },
  });

  const presetCards = ENV_PRESETS.map((pr) => {
    const active = !env.customAssetId && env.preset === pr.id;
    return el(
      'button',
      {
        type: 'button',
        class: `env-card ${active ? 'is-active' : ''}`,
        onclick: () =>
          mut((e) => {
            e.preset = pr.id;
            e.customAssetId = null;
            e.exposure = pr.defaultExposure ?? 1;
            e.temperature = pr.defaultTemp ?? 0;
          }),
      },
      el('div', { class: 'env-card__swatch', style: { background: pr.preview } }),
      el(
        'div',
        { class: 'env-card__meta' },
        el('span', { class: 'env-card__name' }, isVi ? pr.labelVi : pr.labelEn),
        el('span', { class: 'env-card__desc' }, isVi ? pr.descVi : pr.descEn),
      ),
    );
  });

  const customUrl = env.customAssetId ? assets.url(env.customAssetId) : null;

  root.append(
    el(
      'section',
      { class: 'sec' },
      el(
        'div',
        { class: 'sec__title' },
        el('span', {}, t('env.presetsTitle')),
        el(
          'button',
          {
            class: 'text-btn',
            type: 'button',
            onclick: () => mut((e) => Object.assign(e, defaultEnvConfig())),
          },
          t('env.reset'),
        ),
      ),
      el('div', { class: 'env-grid' }, ...presetCards),
    ),
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('env.customTitle')),
      envInput,
      customUrl
        ? el(
            'div',
            {},
            el('img', { class: 'env-custom-preview', src: customUrl, alt: 'Custom HDRI' }),
            el(
              'div',
              { class: 'row row--between' },
              el('span', { class: 'field__hint' }, t('env.customActive')),
              el(
                'button',
                {
                  type: 'button',
                  class: 'text-btn',
                  onclick: () => mut((e) => (e.customAssetId = null)),
                },
                t('env.clearCustom'),
              ),
            ),
          )
        : null,
      el(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--full', onclick: () => envInput.click() },
        t('env.uploadBtn'),
      ),
      el('p', { class: 'field__hint' }, t('env.customHint')),
    ),
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('env.lightTitle')),
      rangeField({
        label: t('env.rotation'),
        val: env.rotation,
        def: def.rotation,
        min: 0,
        max: 360,
        step: 1,
        unit: '°',
        onChange: (v, tr) => mut((e) => (e.rotation = v), tr),
      }),
      rangeField({
        label: t('env.exposure'),
        val: env.exposure,
        def: def.exposure,
        min: 0.3,
        max: 2.5,
        step: 0.05,
        unit: '%',
        displayScale: 100,
        onChange: (v, tr) => mut((e) => (e.exposure = v), tr),
      }),
      rangeField({
        label: t('env.temperature'),
        val: env.temperature,
        def: def.temperature,
        min: -100,
        max: 100,
        step: 1,
        onChange: (v, tr) => mut((e) => (e.temperature = v), tr),
      }),
      rangeField({
        label: t('env.elevation'),
        val: env.elevation,
        def: def.elevation,
        min: -45,
        max: 45,
        step: 1,
        unit: '°',
        onChange: (v, tr) => mut((e) => (e.elevation = v), tr),
      }),
    ),
    el(
      'section',
      { class: 'sec' },
      el('h2', { class: 'sec__title' }, t('env.backdropTitle')),
      el(
        'label',
        { class: 'row check-row' },
        el('input', {
          type: 'checkbox',
          checked: env.showBackdrop,
          onchange: (ev: Event) => mut((e) => (e.showBackdrop = (ev.target as HTMLInputElement).checked)),
        }),
        el('span', {}, t('env.showBackdrop')),
      ),
      rangeField({
        label: t('env.backdropBlur'),
        val: env.backdropBlur,
        def: def.backdropBlur,
        min: 0,
        max: 40,
        step: 1,
        unit: 'px',
        disabled: !env.showBackdrop,
        onChange: (v, tr) => mut((e) => (e.backdropBlur = v), tr),
      }),
      rangeField({
        label: t('env.backdropDim'),
        val: env.backdropDim,
        def: def.backdropDim,
        min: 0.1,
        max: 1.0,
        step: 0.05,
        unit: '%',
        displayScale: 100,
        disabled: !env.showBackdrop,
        onChange: (v, tr) => mut((e) => (e.backdropDim = v), tr),
      }),
    ),
  );
}

// ============================================================
// PRO SLIDER: DRAG + DIRECT NUMBER INPUT + DEFAULT TICK + RESET
// ============================================================
interface RangeOpts {
  label: string;
  val: number;
  def: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  displayScale?: number;
  disabled?: boolean;
  onChange: (v: number, transient: boolean) => void;
}

function rangeField(o: RangeOpts) {
  const scale = o.displayScale ?? 1;
  const toDisp = (v: number) => +(v * scale).toFixed(scale > 1 ? 0 : o.step < 0.01 ? 3 : o.step < 0.1 ? 2 : 1);
  const fromDisp = (d: number) => Math.min(o.max, Math.max(o.min, d / scale));
  const defPct = Math.min(100, Math.max(0, ((o.def - o.min) / (o.max - o.min)) * 100));
  const isAtDef = (v: number) => Math.abs(v - o.def) < o.step * 0.4;

  const numInput = el('input', {
    class: 'num-inline',
    type: 'number',
    min: toDisp(o.min),
    max: toDisp(o.max),
    step: toDisp(o.step) || 0.01,
    value: toDisp(o.val),
    disabled: o.disabled,
    oninput: () => {
      const parsed = parseFloat(numInput.value);
      if (Number.isNaN(parsed)) return;
      const v = fromDisp(parsed);
      rangeInput.value = String(v);
      resetBtn.classList.toggle('is-default', isAtDef(v));
      o.onChange(v, true);
    },
    onchange: () => {
      const parsed = parseFloat(numInput.value);
      const v = Number.isNaN(parsed) ? o.def : fromDisp(parsed);
      numInput.value = String(toDisp(v));
      rangeInput.value = String(v);
      resetBtn.classList.toggle('is-default', isAtDef(v));
      o.onChange(v, false);
    },
  });

  const resetBtn = el('button', {
    type: 'button',
    class: `slider-reset ${isAtDef(o.val) ? 'is-default' : ''}`,
    title: t('slider.resetTitle', { v: `${toDisp(o.def)}${o.unit ?? ''}` }),
    disabled: o.disabled,
    onclick: () => {
      rangeInput.value = String(o.def);
      numInput.value = String(toDisp(o.def));
      resetBtn.classList.add('is-default');
      o.onChange(o.def, false);
    },
  }, icon('reset', 12));

  const rangeInput = el('input', {
    type: 'range',
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.val,
    disabled: o.disabled,
    oninput: () => {
      const v = parseFloat(rangeInput.value);
      numInput.value = String(toDisp(v));
      resetBtn.classList.toggle('is-default', isAtDef(v));
      o.onChange(v, true);
    },
    onchange: () => store.commit(),
    ondblclick: () => {
      if (o.disabled) return;
      rangeInput.value = String(o.def);
      numInput.value = String(toDisp(o.def));
      resetBtn.classList.add('is-default');
      o.onChange(o.def, false);
    },
  });

  return el(
    'div',
    { class: 'field' },
    el(
      'div',
      { class: 'field__head' },
      el('span', {}, o.label),
      el(
        'span',
        { class: 'field__val' },
        numInput,
        o.unit ? el('span', { class: 'num-unit' }, o.unit) : null,
        resetBtn,
      ),
    ),
    el(
      'div',
      { class: 'slider-wrap' },
      el('span', { class: 'slider-default', style: { left: `${defPct}%` }, title: t('slider.resetTitle', { v: `${toDisp(o.def)}${o.unit ?? ''}` }) }),
      rangeInput,
    ),
  );
}
