export interface HoloAttrs {
  rarity?: string;
  supertype?: string;
  subtypes?: string;
  number?: string;
  set?: string;
  gallery?: boolean;
  types?: string;
}

export type EngineId = 'css' | '151';

export interface HoloStyle {
  id: string;
  engine: EngineId;
  label: string;
  attrs: HoloAttrs;
  /** Real foil/pattern asset files used by this preset (attached to production ZIP export) */
  patterns: string[];
}

const css = (id: string, label: string, attrs: HoloAttrs, patterns: string[] = ['img/foils/grain.webp']): HoloStyle => ({
  id: 'css:' + id,
  engine: 'css',
  label,
  attrs,
  patterns,
});
const s151 = (id: string, label: string, attrs: HoloAttrs, patterns: string[] = ['img/foils/grain.webp']): HoloStyle => ({
  id: '151:' + id,
  engine: '151',
  label,
  attrs,
  patterns,
});

const P = { supertype: 'pokémon', subtypes: 'basic' };
const SUPPORTER = { supertype: 'trainer', subtypes: 'supporter' };

export const ENGINES: Record<EngineId, { label: string; dir: string; files: string[] }> = {
  css: {
    label: 'Pokémon Cards CSS',
    dir: 'css/pokemon-cards-css/',
    files: [
      'cards/base.css', 'cards/cards.css', 'cards/basic.css', 'cards/reverse-holo.css', 'cards/regular-holo.css',
      'cards/cosmos-holo.css', 'cards/amazing-rare.css', 'cards/radiant-holo.css', 'cards/v-regular.css',
      'cards/v-full-art.css', 'cards/v-max.css', 'cards/v-star.css', 'cards/trainer-full-art.css',
      'cards/rainbow-holo.css', 'cards/rainbow-alt.css', 'cards/secret-rare.css',
      'cards/trainer-gallery-holo.css', 'cards/trainer-gallery-v-regular.css',
      'cards/trainer-gallery-v-max.css', 'cards/trainer-gallery-secret-rare.css',
      'cards/shiny-rare.css', 'cards/shiny-v.css', 'cards/shiny-vmax.css', 'cards/swsh-pikachu.css',
    ],
  },
  '151': {
    label: 'Pokémon Cards 151',
    dir: 'css/pokemon-cards-151/',
    files: [
      'cards/base.css', 'cards/cards.css', 'cards/basic.css', 'cards/reverse-holo.css', 'cards/regular-holo.css',
      'cards/radiant-holo.css', 'cards/rainbow-alt.css', 'cards/ex-regular.css', 'cards/ex-full-art.css',
      'cards/illustration-rare.css', 'cards/poke-ball-holo.css',
      'cards/ex-special-illustration-rare.css', 'cards/hyper-rare.css',
    ],
  },
};

export const STYLES: HoloStyle[] = [
  css('regular-holo', 'Regular Holo', { rarity: 'rare holo', ...P }, ['img/foils/grain.webp']),
  css('cosmos-holo', 'Cosmos Holo', { rarity: 'rare holo cosmos', ...P }, [
    'img/foils/cosmos-bottom.png',
    'img/foils/cosmos-middle-trans.png',
    'img/foils/cosmos-top-trans.png',
  ]),
  css('amazing-rare', 'Amazing Rare', { rarity: 'amazing rare', ...P }, ['img/foils/glitter.png']),
  css('v', 'V', { rarity: 'rare holo v', subtypes: 'basic v', supertype: 'pokémon' }, ['img/foils/grain.webp']),
  css('v-full-art', 'V Full Art', { rarity: 'rare ultra', subtypes: 'basic v', supertype: 'pokémon' }, ['img/foils/illusion.png']),
  css('v-max', 'VMAX', { rarity: 'rare holo vmax', subtypes: 'vmax', supertype: 'pokémon' }, ['img/foils/vmaxbg.jpg']),
  css('v-star', 'VSTAR', { rarity: 'rare holo vstar', subtypes: 'vstar', supertype: 'pokémon' }, ['img/foils/ancient.png']),
  css('trainer-full-art', 'Trainer Full Art', { rarity: 'rare ultra', ...SUPPORTER }, ['img/foils/trainerbg.png', 'img/foils/glitter.png']),
  css('rainbow-holo', 'Rainbow Rare', { rarity: 'rare rainbow', subtypes: 'basic v', supertype: 'pokémon' }, [
    'img/foils/illusion-mask.png',
    'img/foils/glitter.png',
  ]),
  css('rainbow-alt', 'Rainbow Alt', { rarity: 'rare rainbow alt', subtypes: 'vmax', supertype: 'pokémon' }, ['img/foils/glitter.png']),
  css('secret-rare', 'Secret Rare', { rarity: 'rare secret', ...P }, ['img/foils/geometric.png', 'img/foils/glitter.png']),
  css('shiny-rare', 'Shiny Rare', { rarity: 'rare shiny', ...P }, ['img/foils/illusion.png']),
  css('shiny-v', 'Shiny V', { rarity: 'rare shiny v', subtypes: 'basic v', supertype: 'pokémon' }, ['img/foils/illusion.png']),
  css('shiny-vmax', 'Shiny VMAX', { rarity: 'rare shiny vmax', subtypes: 'vmax', supertype: 'pokémon' }, ['img/foils/glitter.png']),
  css('swsh-pikachu', 'Pikachu SWSH 160', { rarity: 'rare secret', set: 'swsh12pt5', number: '160', ...P }, [
    'img/foils/illusion-mask.png',
    'img/foils/glitter.png',
  ]),
  css('tg-holo', 'Trainer Gallery • Holo', { rarity: 'rare holo', gallery: true, number: 'tg01', ...P }, ['img/foils/grain.webp']),
  css('tg-v', 'Trainer Gallery • V', { rarity: 'rare holo v', gallery: true, number: 'tg01', subtypes: 'basic v', supertype: 'pokémon' }, ['img/foils/grain.webp']),
  css('tg-vmax', 'Trainer Gallery • VMAX', { rarity: 'rare holo vmax', gallery: true, number: 'tg01', subtypes: 'vmax', supertype: 'pokémon' }, ['img/foils/vmaxbg.jpg']),
  css('tg-secret', 'Trainer Gallery • Secret Rare', { rarity: 'rare secret', gallery: true, number: 'tg01', ...P }, [
    'img/foils/geometric.png',
    'img/foils/glitter.png',
  ]),

  s151('basic', 'Basic', { rarity: 'common', ...P }, ['img/foils/grain.webp']),
  s151('reverse-holo', 'Reverse Holo', { rarity: 'common reverse holo', ...P }, ['img/foils/grain.webp']),
  s151('regular-holo', 'Regular Holo', { rarity: 'rare holo', ...P }, ['img/foils/grain.webp']),
  s151('radiant-rare', 'Radiant Rare', { rarity: 'radiant rare', ...P }, ['img/foils/trainerbg.png', 'img/foils/glitter.webp']),
  s151('rainbow-alt', 'Rainbow Alt', { rarity: 'rare rainbow alt', subtypes: 'vmax', supertype: 'pokémon' }, ['img/foils/glitter.webp']),
  s151('double-rare', 'Double Rare (ex)', { rarity: 'double rare', subtypes: 'basic ex', supertype: 'pokémon' }, [
    'img/foils/151/birthday-holo-dank.webp',
    'img/foils/151/birthday-holo-dank-2.webp',
  ]),
  s151('ultra-rare', 'Ultra Rare (ex Full Art & Trainer)', { rarity: 'ultra rare', subtypes: 'basic ex', supertype: 'pokémon' }, [
    'img/foils/illusion.png',
    'img/foils/glitter.webp',
  ]),
  s151('illustration-rare', 'Illustration Rare', { rarity: 'illustration rare', ...P }, ['img/foils/grain.webp']),
  s151('special-illustration-rare', 'Special Illustration Rare', { rarity: 'special illustration rare', subtypes: 'basic ex', supertype: 'pokémon' }, [
    'img/foils/151/iri-9.webp',
    'img/foils/151/iri-8.webp',
    'img/foils/151/iri-7.webp',
  ]),
  s151('hyper-rare', 'Hyper Rare (Gold card)', { rarity: 'hyper rare', subtypes: 'basic ex', supertype: 'pokémon' }, [
    'img/foils/151/iri-9.webp',
    'img/foils/151/iri-8.webp',
    'img/foils/151/iri-7.webp',
  ]),
  s151('pokeball-holo', 'Poké Ball Holo', { rarity: 'pokeball holo', ...P }, [
    'img/foils/151/pokeball-outer.webp',
    'img/foils/151/pokeball-inner.webp',
    'img/foils/151/noise-base.webp',
    'img/foils/151/iri-1.webp',
  ]),
  s151('masterball-holo', 'Master Ball Holo', { rarity: 'masterball holo', ...P }, [
    'img/foils/151/masterball-outer.webp',
    'img/foils/151/masterball-inner.webp',
    'img/foils/151/noise-base.webp',
    'img/foils/151/iri-1.webp',
  ]),
];

export const DEFAULT_STYLE = 'css:trainer-full-art';
export const NO_HOLO: HoloStyle = { id: 'none', engine: 'css', label: 'Không holo', attrs: { rarity: 'common', ...P }, patterns: [] };

let currentEngine: EngineId = 'css';

/** Swap engine stylesheets (both engines define the same selectors, so only one may be active). */
export async function loadEngine(engine: EngineId, anchor: Element): Promise<void> {
  if (engine === currentEngine) return;
  const cfg = ENGINES[engine];
  const olds = [...document.querySelectorAll('link[data-engine]')];
  await Promise.all(
    cfg.files.map((file) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.engine = engine;
      link.href = cfg.dir + file;
      anchor.before(link);
      return new Promise((resolve) => (link.onload = link.onerror = resolve));
    }),
  );
  olds.forEach((l) => l.remove());
  currentEngine = engine;
}
