const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconName =
  | 'eye'
  | 'eye-off'
  | 'link'
  | 'lock'
  | 'unlock'
  | 'copy'
  | 'arrow-up'
  | 'arrow-down'
  | 'trash'
  | 'reset'
  | 'download'
  | 'close'
  | 'plus'
  | 'check-circle'
  | 'alert-triangle'
  | 'x-circle';

const PATHS: Record<IconName, string> = {
  eye: '<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  'eye-off': '<path d="M2 2l12 12"/><path d="M6.5 3.8A6.8 6.8 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11.3 11.3 0 0 1-2.2 2.7"/><path d="M9.4 9.4A2 2 0 0 1 6.6 6.6"/><path d="M4.2 5.3A11.2 11.2 0 0 0 1.5 8s2.5 4.5 6.5 4.5c1 0 1.9-.2 2.7-.6"/>',
  link: '<path d="M6.5 9.5a3 3 0 0 0 4.2.2l1.8-1.8a3 3 0 0 0-4.2-4.2L7.2 4.8"/><path d="M9.5 6.5a3 3 0 0 0-4.2-.2L3.5 8.1a3 3 0 0 0 4.2 4.2l1.1-1.1"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-1.3"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3.5 10.5H3A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"/>',
  'arrow-up': '<path d="M8 12.5v-9"/><path d="M4.5 7 8 3.5 11.5 7"/>',
  'arrow-down': '<path d="M8 3.5v9"/><path d="M4.5 9 8 12.5 11.5 9"/>',
  trash: '<path d="M2.5 4.5h11"/><path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/><path d="M4 4.5l.7 8.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.5"/>',
  reset: '<path d="M3 5.5A5.5 5.5 0 1 1 2.8 10"/><path d="M3 2.5v3h3"/>',
  download: '<path d="M8 2.5v8"/><path d="M4.8 7.5 8 10.7l3.2-3.2"/><path d="M2.5 13h11"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  'check-circle': '<circle cx="8" cy="8" r="6"/><path d="M5.3 8.2 7.2 10l3.5-3.8"/>',
  'alert-triangle': '<path d="M7.1 2.7 1.9 12a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5L8.9 2.7a1 1 0 0 0-1.8 0Z"/><path d="M8 6v3"/><circle cx="8" cy="11.2" r="0.5" fill="currentColor" stroke="none"/>',
  'x-circle': '<circle cx="8" cy="8" r="6"/><path d="M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6"/>',
};

export function icon(name: IconName, size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ui-icon');
  svg.innerHTML = PATHS[name];
  return svg;
}
