export const round = (value: number, precision = 3): number => parseFloat(value.toFixed(precision));

export const clamp = (value: number, min = 0, max = 100): number => Math.min(Math.max(value, min), max);

export const adjust = (value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number =>
  round(toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smooth = (t: number): number => t * t * (3 - 2 * t);

let idCounter = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** run immediately if a call is pending */
  flush(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: A | null = null;
  const run = () => {
    t = undefined;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };
  const d = ((...args: A) => {
    pending = args;
    clearTimeout(t);
    t = setTimeout(run, ms);
  }) as Debounced<A>;
  d.flush = () => {
    if (!pending) return;
    clearTimeout(t);
    run();
  };
  return d;
}
