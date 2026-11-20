/**
 * Interactive holo card — TypeScript port of Card.svelte from
 * simeydotme/pokemon-cards-css & pokemon-cards-151 (GPL-3.0) via Ribi Holo.
 * Adds two WebGL canvases (front/back) for printing-technique overlays.
 */
import { spring, afterFrame, frameScheduled, type Spring } from '../core/spring';
import { adjust, clamp, lerp, round, smooth } from '../core/math';
import type { EngineId, HoloAttrs } from './styles';
import type { HoloInteraction, HoloMasking, HoloOptical } from '../model/types';

const springInteractSettings = { stiffness: 0.066, damping: 0.25 };
const springPopoverSettings = { stiffness: 0.033, damping: 0.45 };
const ZOOM_WIDTH = { wide: 630, portrait: 470 };
const ROTATE_DIVISOR = 3.5;
const BLEND_MS = 1200;

export interface CardState {
  /** rotateY in degrees (horizontal tilt, includes flip delta) */
  rx: number;
  /** rotateX in degrees (vertical tilt) */
  ry: number;
  /** pointer position in % */
  px: number;
  py: number;
  /** glare opacity 0..1 */
  o: number;
  /** cos of facing angle, < 0 when the back faces the viewer */
  facing: number;
}

export interface RenderedHoloLayer {
  id: string;
  engine: EngineId;
  attrs: HoloAttrs;
  foilUrl: string | null;
  maskUrl: string | null;
  optical: HoloOptical;
  masking: HoloMasking;
}

type V2 = { x: number; y: number };
type V3 = { x: number; y: number; o: number };

export class HoloCard {
  root!: HTMLElement;
  frontCanvas!: HTMLCanvasElement;
  backCanvas!: HTMLCanvasElement;
  private rotator!: HTMLButtonElement;
  private backImg!: HTMLImageElement;
  private frontImg!: HTMLImageElement;
  private holoStack!: HTMLElement;
  private holoLayerEntries: { el: HTMLElement; scanlineRatio: number }[] = [];

  private engine: EngineId = 'css';
  private hover = false;
  private active = false;
  private layoutScale = 1;
  private zoomTarget = 1;
  private turnToken = 0;
  private turn: { token: number; sawBack: boolean } | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  private canZoom = !!(window.CSS && CSS.supports && CSS.supports('zoom', '2'));
  private dirty = false;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: { background: V2; rotate: V2; glare: V3 } | null = null;
  private pendingRaf: number | null = null;
  private auto = { enabled: false, amp: 13, freq: 0.35, phase: 0 };
  private interaction: HoloInteraction = {
    mode: 'pointer-auto',
    autoPattern: 'orbit',
    amp: 13,
    freq: 0.35,
    sensitivity: 1,
    stiffness: 0.066,
    damping: 0.25,
    parallax: 1,
    restingGlow: 0,
    invertTilt: false,
    manualX: 12,
    manualY: -8,
    manualLightX: 35,
    manualLightY: 35,
  };
  private blend: { start: number; from: { rot: V2; glare: V3; bg: V2 } } | null = null;
  private autoRaf: number | null = null;
  private lastAutoT = 0;
  private visible = true;
  private randomSeed = { x: Math.random(), y: Math.random() };
  private bgPosition1 = { x: Math.floor(this.randomSeed.x * 734), y: Math.floor(this.randomSeed.y * 1280) };
  private bgPosition2 = { x: Math.floor(Math.random() * 734), y: Math.floor(Math.random() * 1280) };

  private springRotate: Spring<V2>;
  private springGlare: Spring<V3>;
  private springBackground: Spring<V2>;
  private springRotateDelta: Spring<V2>;
  private springTranslate: Spring<V2>;
  private springScale: Spring<number>;

  /** called after every rendered frame with the current tilt state */
  onRender: (s: CardState) => void = () => {};
  onZoom: (z: boolean) => void = () => {};
  onLayout: () => void = () => {};

  constructor(private mount: HTMLElement) {
    const mk = <T extends number | V2 | V3>(v: T, s: { stiffness: number; damping: number }) =>
      spring<T>(v, s, () => this.markDirty());
    this.springRotate = mk<V2>({ x: 0, y: 0 }, springInteractSettings);
    this.springGlare = mk<V3>({ x: 50, y: 50, o: 0 }, springInteractSettings);
    this.springBackground = mk<V2>({ x: 50, y: 50 }, springInteractSettings);
    this.springRotateDelta = mk<V2>({ x: 0, y: 0 }, springPopoverSettings);
    this.springTranslate = mk<V2>({ x: 0, y: 0 }, springPopoverSettings);
    this.springScale = mk<number>(1, springPopoverSettings);

    this.build();
    this.bind();
    this.updateLayout();
    new ResizeObserver(() => this.updateLayout()).observe(this.mount);
    // Pause auto-rotation work when the card is off-screen (perf)
    new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
    }).observe(this.mount);
    afterFrame.add(() => this.flushIfDirty());
    this.flush();
  }

  private build() {
    const root = document.createElement('div');
    root.className = 'card interactive loading';
    root.innerHTML = `
      <div class="card__translater">
        <button class="card__rotator" type="button" aria-label="Phóng to thẻ">
          <img class="card__back" alt="" width="750" height="1050" draggable="false" />
          <canvas class="card__tech card__tech--back"></canvas>
          <div class="card__layer-mask card__layer-mask--back"></div>
          <div class="card__front">
            <img class="card__front-img" alt="" width="750" height="1050" draggable="false" />
            <div class="card__holo-stack"></div>
            <div class="card__layer-mask card__layer-mask--front"></div>
            <canvas class="card__tech card__tech--front"></canvas>
          </div>
        </button>
      </div>`;
    this.root = root;
    this.rotator = root.querySelector('.card__rotator')!;
    this.backImg = root.querySelector('.card__back')!;
    this.frontImg = root.querySelector('.card__front-img')!;
    this.holoStack = root.querySelector('.card__holo-stack')!;
    this.frontCanvas = root.querySelector('.card__tech--front')!;
    this.backCanvas = root.querySelector('.card__tech--back')!;
    this.mount.appendChild(root);
  }

  private layers() {
    this.root.classList.toggle('is-scaled', this.engine === '151' && this.springScale.value > 1);
  }

  private bind() {
    this.rotator.addEventListener('pointerenter', (e) => this.enter(e));
    this.rotator.addEventListener('pointermove', (e) => this.interact(e));
    this.rotator.addEventListener('pointerleave', () => this.leave());
    this.rotator.addEventListener('click', () => this.toggle());
    window.addEventListener('resize', () => this.updateLayout());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active) this.deactivate();
    });
    document.addEventListener('visibilitychange', () => {
      this.lastAutoT = 0;
    });
  }

  // ---------- public API ----------
  setEngine(engine: EngineId) {
    this.engine = engine;
    this.layers();
    this.markDirty();
  }

  setAttrs({ rarity = 'common', supertype = 'pokémon', subtypes = 'basic', number = '', set = '', gallery = false, types = '' }: HoloAttrs = {}) {
    const r = this.root;
    r.dataset.number = String(number).toLowerCase();
    r.dataset.set = set;
    r.dataset.subtypes = String(subtypes).toLowerCase();
    r.dataset.supertype = String(supertype).toLowerCase();
    r.dataset.rarity = String(rarity).toLowerCase();
    r.dataset.trainerGallery = String(!!gallery);
    r.className = r.className
      .replace(/\b(water|fire|grass|lightning|psychic|fighting|darkness|metal|dragon|fairy)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (types) r.classList.add(...String(types).toLowerCase().split(' '));
  }

  setImages({ front, back, foil, mask }: { front?: string | null; back?: string | null; foil?: string | null; mask?: string | null }) {
    const st = this.root.style;
    if (back !== undefined) {
      if (back) this.backImg.src = back;
      else this.backImg.removeAttribute('src');
    }
    if (foil !== undefined) st.setProperty('--foil', foil ? `url("${foil}")` : 'none');
    if (mask !== undefined) {
      st.setProperty('--mask', mask ? `url("${mask}")` : 'none');
      this.root.classList.toggle('masked', !!mask);
    }
    if (front !== undefined) {
      if (!front) {
        this.frontImg.removeAttribute('src');
        this.root.classList.remove('loading');
        return;
      }
      const probe = new Image();
      const done = () => {
        this.frontImg.src = front;
        this.root.classList.remove('loading');
      };
      probe.onload = () => (probe.decode ? probe.decode().then(done, done) : done());
      probe.onerror = done;
      probe.src = front;
    }
  }

  setLayerMaskOverlay(side: 'front' | 'back', url: string | null) {
    const st = this.root.style;
    if (side === 'front') {
      st.setProperty('--layer-mask-front', url ? `url("${url}")` : 'none');
      this.root.classList.toggle('show-layer-mask-front', !!url);
    } else {
      st.setProperty('--layer-mask-back', url ? `url("${url}")` : 'none');
      this.root.classList.toggle('show-layer-mask-back', !!url);
    }
  }

  private holoLayerMap = new Map<string, { el: HTMLElement; engine: EngineId; hasGlare: boolean; scanlineRatio: number }>();

  setHoloLayers(list: RenderedHoloLayer[], cardWidthMm = 63.5) {
    const w = this.mount.clientWidth || 360;
    const isScaled = this.engine === '151' && this.springScale.value > 1;
    const nextIds = new Set(list.map((x) => x.id));

    // Remove deleted/hidden layers only
    for (const [id, entry] of this.holoLayerMap) {
      if (!nextIds.has(id)) {
        entry.el.remove();
        this.holoLayerMap.delete(id);
      }
    }

    this.holoLayerEntries = [];
    for (let idx = 0; idx < list.length; idx++) {
      const item = list[idx];
      const needGlare = item.optical.glareIntensity > 0.01;
      let entry = this.holoLayerMap.get(item.id);

      if (!entry) {
        const el = document.createElement('div');
        entry = { el, engine: item.engine, hasGlare: !needGlare, scanlineRatio: 0 };
        this.holoLayerMap.set(item.id, entry);
      }

      const el = entry.el;
      if (entry.engine !== item.engine || entry.hasGlare !== needGlare || !el.firstChild) {
        entry.engine = item.engine;
        entry.hasGlare = needGlare;
        const glareHtml = needGlare
          ? item.engine === '151'
            ? '<div class="card__glare"></div><div class="card__glare2"></div>'
            : '<div class="card__glare"></div>'
          : '';
        el.innerHTML =
          item.engine === '151'
            ? `<div class="card__shine"></div><div class="card__glitter"></div>${glareHtml}<div class="card__mask-preview"></div>`
            : `<div class="card__shine"></div>${glareHtml}<div class="card__mask-preview"></div>`;
      }

      const { rarity = 'common', supertype = 'pokémon', subtypes = 'basic', number = '', set = '', gallery = false, types = '' } = item.attrs;
      const cls = ['card', 'card--holo-layer', 'interactive'];
      if (this.layoutScale !== 1) cls.push('is-sized');
      if (item.maskUrl) cls.push('masked');
      if (item.masking.previewOverlay) cls.push('show-mask-preview');
      if (isScaled) cls.push('is-scaled');
      if (types) cls.push(...String(types).toLowerCase().split(' '));
      el.className = cls.join(' ');

      el.dataset.number = String(number).toLowerCase();
      el.dataset.set = set;
      el.dataset.subtypes = String(subtypes).toLowerCase();
      el.dataset.supertype = String(supertype).toLowerCase();
      el.dataset.rarity = String(rarity).toLowerCase();
      el.dataset.trainerGallery = String(!!gallery);
      el.dataset.maskScope = item.masking.scope;

      const st = el.style;
      st.setProperty('--foil', item.foilUrl ? `url("${item.foilUrl}")` : 'none');
      st.setProperty('--mask', item.maskUrl ? `url("${item.maskUrl}")` : 'none');
      const opt = item.optical;
      const scanlineRatio = (opt.scanlineMm || 0.7) / Math.max(10, cardWidthMm);
      entry.scanlineRatio = scanlineRatio;
      st.setProperty('--holo-scanline-space', `${Math.max(0.4, (w * scanlineRatio) / 4).toFixed(3)}px`);
      st.setProperty('--holo-shine-mul', String(opt.shineIntensity));
      st.setProperty('--holo-glare-mul', String(opt.glareIntensity));
      st.setProperty('--angle', `${opt.angle}deg`);
      st.setProperty('--space', `${opt.space}%`);
      st.setProperty('--glittersize', `${opt.glitterSize}%`);

      const filters: string[] = [];
      if (opt.hue !== 0) filters.push(`hue-rotate(${opt.hue}deg)`);
      if (opt.saturation !== 1) filters.push(`saturate(${opt.saturation})`);
      if (opt.brightness !== 1) filters.push(`brightness(${opt.brightness})`);
      if (opt.contrast !== 1) filters.push(`contrast(${opt.contrast})`);
      st.setProperty('--holo-extra-filter', filters.length ? filters.join(' ') : 'none');
      if (opt.blendMode === 'auto') st.removeProperty('--holo-blend');
      else st.setProperty('--holo-blend', opt.blendMode);

      // Keep DOM order synced without detaching unchanged nodes
      if (this.holoStack.children[idx] !== el) {
        this.holoStack.insertBefore(el, this.holoStack.children[idx] ?? null);
      }
      this.holoLayerEntries.push({ el, scanlineRatio });
    }
    this.markDirty();
  }

  setHoloInteraction(interaction: HoloInteraction) {
    const prevMode = this.interaction.mode;
    this.interaction = { ...interaction };
    this.auto.amp = interaction.amp;
    this.auto.freq = interaction.freq;

    const wantAuto = interaction.mode === 'auto' || (interaction.mode === 'pointer-auto' && this.auto.enabled);
    if (interaction.mode === 'manual') {
      this.applyManualTarget();
    } else if (wantAuto) {
      if (this.autoRaf === null) {
        this.lastAutoT = 0;
        if (!this.hover) this.startBlend();
        this.autoRaf = requestAnimationFrame((t) => this.autoTick(t));
      }
    } else if (prevMode === 'manual' || !this.hover) {
      this.settle(0);
    }
    this.markDirty();
  }

  private applyManualTarget() {
    const { manualX, manualY, manualLightX, manualLightY, parallax } = this.interaction;
    const bgX = 50 + (adjust(manualLightX, 0, 100, 37, 63) - 50) * parallax;
    const bgY = 50 + (adjust(manualLightY, 0, 100, 33, 67) - 50) * parallax;
    this.updateSprings(
      { x: bgX, y: bgY },
      { x: manualX, y: manualY },
      { x: manualLightX, y: manualLightY, o: 1 },
    );
  }

  setAuto(opts: Partial<typeof this.auto>) {
    const was = this.auto.enabled;
    Object.assign(this.auto, opts);
    if (this.interaction.mode === 'manual' || this.interaction.mode === 'pointer') return;
    if (this.auto.enabled && !was) {
      this.auto.phase = 0;
      this.lastAutoT = 0;
      if (!this.hover) this.startBlend();
      if (this.autoRaf === null) this.autoRaf = requestAnimationFrame((t) => this.autoTick(t));
    } else if (!this.auto.enabled && was && this.interaction.mode !== 'auto') {
      this.blend = null;
      if (!this.hover) this.settle(0);
    }
  }

  /** Show a specific face (used by the side switch). */
  showSide(side: 'front' | 'back') {
    this.springRotateDelta.stiffness = springPopoverSettings.stiffness;
    this.springRotateDelta.damping = springPopoverSettings.damping;
    const cur = this.springRotateDelta.target.x;
    const base = Math.round(cur / 360) * 360;
    void this.springRotateDelta.set({ x: side === 'back' ? base + 180 : base, y: 0 });
  }

  get state(): CardState {
    const g = this.springGlare.value;
    const rot = this.springRotate.value;
    const delta = this.springRotateDelta.value;
    const rx = rot.x + delta.x;
    return { rx, ry: rot.y + delta.y, px: g.x, py: g.y, o: g.o, facing: Math.cos((rx * Math.PI) / 180) };
  }

  requestRender() {
    this.markDirty();
  }

  // ---------- render ----------
  private markDirty() {
    this.dirty = true;
    if (!frameScheduled()) requestAnimationFrame(() => this.flushIfDirty());
  }

  private flushIfDirty() {
    if (this.dirty) this.flush();
  }

  private flush() {
    this.dirty = false;
    const g = this.springGlare.value;
    const rot = this.springRotate.value;
    const delta = this.springRotateDelta.value;
    const bg = this.springBackground.value;
    const tr = this.springTranslate.value;
    const sc = this.springScale.value;
    this.checkReveal(rot.x + delta.x);
    const is151 = this.engine === '151';
    const px = is151 ? clamp(g.x) : g.x;
    const py = is151 ? clamp(g.y) : g.y;
    const st = this.root.style;
    const set = (k: string, v: string | number) => st.setProperty(k, String(v));

    set('--seedx', this.randomSeed.x);
    set('--seedy', this.randomSeed.y);
    set('--cosmosbg', `${this.bgPosition1.x}px ${this.bgPosition1.y}px`);
    set('--birthdaybg', `${this.bgPosition2.x}px ${this.bgPosition2.y}px`);
    set('--pointer-x', `${px}%`);
    set('--pointer-y', `${py}%`);
    set('--pointer-from-center', clamp(Math.sqrt((g.y - 50) * (g.y - 50) + (g.x - 50) * (g.x - 50)) / 50, 0, 1));
    set('--pointer-from-top', g.y / 100);
    set('--pointer-from-left', g.x / 100);
    set('--card-opacity', g.o);
    set('--rotate-x', `${rot.x + delta.x}deg`);
    set('--rotate-y', `${rot.y + delta.y}deg`);
    set('--rotate-delta', `${delta.x}deg`);
    set('--background-x', `${is151 ? clamp(bg.x) : bg.x}%`);
    set('--background-y', `${is151 ? clamp(bg.y) : bg.y}%`);
    set('--card-scale', sc);
    set('--card-xform-scale', sc / this.layoutScale);
    set('--translate-x', `${tr.x}px`);
    set('--translate-y', `${tr.y}px`);
    if (is151) this.root.classList.toggle('is-scaled', sc > 1);
    this.onRender(this.state);
  }

  // ---------- interaction ----------
  private updateSprings(background: V2, rotate: V2, glare: V3) {
    const stiff = this.interaction.stiffness || springInteractSettings.stiffness;
    const damp = this.interaction.damping || springInteractSettings.damping;
    for (const s of [this.springBackground, this.springRotate, this.springGlare] as Spring<any>[]) {
      s.stiffness = stiff;
      s.damping = damp;
    }
    void this.springBackground.set(background);
    void this.springRotate.set(rotate);
    void this.springGlare.set(glare);
  }

  private enter(e: PointerEvent) {
    if (this.interaction.mode === 'auto' || this.interaction.mode === 'manual') return;
    this.hover = true;
    this.blend = null;
    clearTimeout(this.settleTimer);
    this.interact(e);
  }

  private interact(e: PointerEvent) {
    if (document.visibilityState !== 'visible') return;
    if (this.interaction.mode === 'auto' || this.interaction.mode === 'manual') return;
    if (!this.hover) this.enter(e);
    this.root.classList.add('interacting');
    const rect = this.rotator.getBoundingClientRect();
    const percent = {
      x: clamp(round((100 / rect.width) * (e.clientX - rect.left))),
      y: clamp(round((100 / rect.height) * (e.clientY - rect.top))),
    };
    const center = { x: percent.x - 50, y: percent.y - 50 };
    const sign = this.interaction.invertTilt ? -1 : 1;
    const sens = this.interaction.sensitivity;
    const p = this.interaction.parallax;
    const bgX = 50 + (adjust(percent.x, 0, 100, 37, 63) - 50) * p;
    const bgY = 50 + (adjust(percent.y, 0, 100, 33, 67) - 50) * p;
    this.pending = {
      background: { x: bgX, y: bgY },
      rotate: { x: round((-(center.x / ROTATE_DIVISOR)) * sens * sign), y: round((center.y / ROTATE_DIVISOR) * sens * sign) },
      glare: { x: round(percent.x), y: round(percent.y), o: 1 },
    };
    if (this.pendingRaf === null) {
      this.pendingRaf = requestAnimationFrame(() => {
        this.pendingRaf = null;
        if (this.pending && this.hover) this.updateSprings(this.pending.background, this.pending.rotate, this.pending.glare);
        this.pending = null;
      });
    }
  }

  private leave() {
    this.hover = false;
    if (this.pendingRaf !== null) {
      cancelAnimationFrame(this.pendingRaf);
      this.pendingRaf = null;
    }
    this.pending = null;
    if (this.interaction.mode === 'manual') return;
    const willAuto = this.interaction.mode === 'auto' || (this.interaction.mode === 'pointer-auto' && this.auto.enabled);
    this.settle(willAuto ? 0 : 500);
  }

  private settle(delay = 500) {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (this.hover || this.interaction.mode === 'manual') return;
      this.root.classList.remove('interacting');
      const willAuto = this.interaction.mode === 'auto' || (this.interaction.mode === 'pointer-auto' && this.auto.enabled);
      if (willAuto) {
        this.startBlend();
        return;
      }
      for (const [s, rest] of [
        [this.springRotate, { x: 0, y: 0 }],
        [this.springGlare, { x: 50, y: 50, o: this.interaction.restingGlow }],
        [this.springBackground, { x: 50, y: 50 }],
      ] as [Spring<any>, any][]) {
        s.stiffness = 0.01;
        s.damping = 0.06;
        void s.set(rest, { soft: 1 });
      }
    }, delay);
  }

  private startBlend() {
    this.blend = {
      start: performance.now(),
      from: { rot: { ...this.springRotate.value }, glare: { ...this.springGlare.value }, bg: { ...this.springBackground.value } },
    };
  }

  private autoTargets() {
    const { amp, phase } = this.auto;
    const th = phase * Math.PI;
    const pat = this.interaction.autoPattern;
    let rx = 0, ry = 0;
    if (pat === 'figure8') {
      rx = Math.sin(th) * amp;
      ry = Math.sin(th * 2) * amp * 0.55;
    } else if (pat === 'sweep-x') {
      rx = Math.sin(th) * amp;
      ry = 0;
    } else if (pat === 'sweep-y') {
      rx = 0;
      ry = Math.sin(th) * amp * 0.85;
    } else {
      rx = Math.cos(th) * amp;
      ry = Math.sin(th) * amp * 0.6;
    }
    const rot = { x: rx, y: ry };
    const px = clamp(50 - rot.x * ROTATE_DIVISOR);
    const py = clamp(50 + rot.y * ROTATE_DIVISOR);
    const p = this.interaction.parallax;
    const bgX = 50 + (adjust(px, 0, 100, 37, 63) - 50) * p;
    const bgY = 50 + (adjust(py, 0, 100, 33, 67) - 50) * p;
    return { rot, glare: { x: px, y: py, o: 1 }, bg: { x: bgX, y: bgY } };
  }

  private autoTick(t: number) {
    const activeAuto = this.interaction.mode === 'auto' || (this.interaction.mode === 'pointer-auto' && this.auto.enabled);
    if (!activeAuto) {
      this.autoRaf = null;
      return;
    }
    this.autoRaf = requestAnimationFrame((n) => this.autoTick(n));
    const dt = this.lastAutoT ? Math.min((t - this.lastAutoT) / 1000, 0.1) : 0;
    this.lastAutoT = t;
    if (!this.visible || document.visibilityState !== 'visible') return;
    this.auto.phase += dt * this.auto.freq;
    if (this.hover && this.interaction.mode !== 'auto') return;
    const a = this.autoTargets();
    let { rot, glare, bg } = a;
    if (this.blend) {
      const k = smooth(clamp((performance.now() - this.blend.start) / BLEND_MS, 0, 1));
      const f = this.blend.from;
      rot = { x: lerp(f.rot.x, a.rot.x, k), y: lerp(f.rot.y, a.rot.y, k) };
      glare = { x: lerp(f.glare.x, a.glare.x, k), y: lerp(f.glare.y, a.glare.y, k), o: lerp(f.glare.o, a.glare.o, k) };
      bg = { x: lerp(f.bg.x, a.bg.x, k), y: lerp(f.bg.y, a.bg.y, k) };
      if (k >= 1) this.blend = null;
    }
    this.updateSprings(bg, rot, glare);
  }

  // ---------- zoom ----------
  private toggle() {
    if (this.active) this.deactivate();
    else this.activate();
  }

  activate() {
    this.active = true;
    this.root.classList.add('active');
    this.popover(true);
    this.onZoom(true);
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.root.classList.remove('active');
    this.retreat();
    this.onZoom(false);
  }

  private setCenter() {
    const rect = this.mount.getBoundingClientRect();
    const view = document.documentElement;
    void this.springTranslate.set({
      x: round(view.clientWidth / 2 - rect.x - rect.width / 2),
      y: round(view.clientHeight / 2 - rect.y - rect.height / 2),
    });
  }

  private zoomScale() {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;
    if (!w || !h) return 1;
    const target = (window.matchMedia('(max-width: 880px)').matches ? ZOOM_WIDTH.portrait : ZOOM_WIDTH.wide) / w;
    return Math.max(1, Math.min(target, (window.innerWidth * 0.9) / w, (window.innerHeight * 0.9) / h));
  }

  private syncScanlineVar() {
    const w = this.mount.clientWidth || 360;
    for (const entry of this.holoLayerEntries) {
      const spacePx = Math.max(0.4, (w * entry.scanlineRatio) / 4);
      entry.el.style.setProperty('--holo-scanline-space', `${spacePx.toFixed(3)}px`);
      entry.el.classList.toggle('is-sized', this.layoutScale !== 1);
    }
  }

  updateLayout() {
    const target = this.zoomScale();
    this.zoomTarget = target;
    const scale = this.canZoom ? target : 1;
    this.layoutScale = scale;
    this.root.style.setProperty('--card-layout-scale', String(scale));
    this.root.classList.toggle('is-sized', scale !== 1);
    this.root.style.width = scale === 1 ? '' : `${this.mount.clientWidth * scale}px`;
    this.syncScanlineVar();
    if (this.active) {
      this.setCenter();
      void this.springScale.set(target);
    }
    this.onLayout();
    this.markDirty();
  }

  private popover(spin: boolean) {
    this.setCenter();
    if (spin) {
      const token = this.beginTurn();
      const base = this.springRotateDelta.target.x;
      void Promise.all([this.springRotateDelta.set({ x: base + 360, y: 0 }), this.springScale.set(this.zoomTarget)]).then(() =>
        this.endTurn(token),
      );
    } else void this.springScale.set(this.zoomTarget);
    this.settle(spin ? 1000 : 100);
  }

  private retreat() {
    this.springRotateDelta.stiffness = springPopoverSettings.stiffness;
    this.springRotateDelta.damping = springPopoverSettings.damping;
    const base = this.springRotateDelta.target.x;
    const facingBack = Math.round(((base % 360) + 360) % 360) === 180;
    void this.springScale.set(1, { soft: true });
    void this.springTranslate.set({ x: 0, y: 0 }, { soft: true });
    void this.springRotateDelta.set({ x: facingBack ? 180 : 0, y: 0 }, { soft: true });
    this.settle(100);
  }

  private beginTurn() {
    const token = ++this.turnToken;
    clearTimeout(this.revealTimer);
    this.root.classList.remove('is-revealing');
    this.root.classList.add('is-turning');
    this.turn = { token, sawBack: false };
    setTimeout(() => this.endTurn(token), 3500);
    return token;
  }

  private checkReveal(rotateYDeg: number) {
    if (!this.turn) return;
    const facing = Math.cos((rotateYDeg * Math.PI) / 180);
    if (facing < 0) this.turn.sawBack = true;
    const remaining = Math.abs(this.springScale.value - this.springScale.target) / Math.max(0.05, this.zoomTarget - 1);
    if (this.turn.sawBack && facing > 0.5 && remaining < 0.08) this.endTurn(this.turn.token);
  }

  private endTurn(token: number) {
    if (token !== this.turnToken || !this.root.classList.contains('is-turning')) return;
    this.turn = null;
    this.root.classList.remove('is-turning');
    this.root.classList.add('is-revealing');
    this.revealTimer = setTimeout(() => this.root.classList.remove('is-revealing'), 600);
  }
}
