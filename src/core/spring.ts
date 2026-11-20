/**
 * Port of svelte/motion `spring` used by pokemon-cards-css (GPL-3.0),
 * running on a shared rAF loop so many springs cost one frame callback.
 */
type SpringValue = number | { [k: string]: number };

interface Task {
  callback: (t: number) => boolean;
  promise: Promise<void>;
  resolve: () => void;
}

const now = () => performance.now();
const tasks = new Set<Task>();
export const afterFrame = new Set<() => void>();
let rafId: number | null = null;
let inRun = false;

function run() {
  rafId = null;
  inRun = true;
  const t = now();
  tasks.forEach((task) => {
    if (!task.callback(t)) {
      tasks.delete(task);
      task.resolve();
    }
  });
  afterFrame.forEach((fn) => fn());
  inRun = false;
  if (tasks.size && rafId === null) rafId = requestAnimationFrame(run);
}

function loop(callback: (t: number) => boolean): Task {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  const task: Task = { callback, promise, resolve };
  tasks.add(task);
  if (rafId === null) rafId = requestAnimationFrame(run);
  return task;
}

export const frameScheduled = (): boolean => inRun || rafId !== null;

interface TickCtx {
  invMass: number;
  opts: { stiffness: number; damping: number; precision: number };
  settled: boolean;
  dt: number;
}

function tickSpring<T extends SpringValue>(ctx: TickCtx, last: T, current: T, target: T): T {
  if (typeof current === 'number') {
    const delta = (target as number) - current;
    const velocity = (current - (last as number)) / (ctx.dt || 1 / 60);
    const spring = ctx.opts.stiffness * delta;
    const damper = ctx.opts.damping * velocity;
    const acceleration = (spring - damper) * ctx.invMass;
    const d = (velocity + acceleration) * ctx.dt;
    if (Math.abs(d) < ctx.opts.precision && Math.abs(delta) < ctx.opts.precision) return target;
    ctx.settled = false;
    return (current + d) as T;
  }
  const next: Record<string, number> = {};
  const c = current as Record<string, number>;
  for (const k in c) {
    next[k] = tickSpring(ctx, (last as Record<string, number>)[k], c[k], (target as Record<string, number>)[k]);
  }
  return next as T;
}

export interface Spring<T extends SpringValue> {
  set(v: T, o?: { hard?: boolean; soft?: boolean | number }): Promise<void>;
  readonly value: T;
  readonly target: T;
  stiffness: number;
  damping: number;
  precision: number;
}

export function spring<T extends SpringValue>(
  initial: T,
  opts: { stiffness?: number; damping?: number; precision?: number } = {},
  onChange: (v: T) => void = () => {},
): Spring<T> {
  let value = initial;
  let lastValue = initial;
  let targetValue = initial;
  let lastTime = 0;
  let task: Task | null = null;
  let invMass = 1;
  let invMassRecoveryRate = 0;
  let cancelTask = false;

  const api: Spring<T> = {
    set,
    get value() {
      return value;
    },
    get target() {
      return targetValue;
    },
    stiffness: opts.stiffness ?? 0.15,
    damping: opts.damping ?? 0.8,
    precision: opts.precision ?? 0.01,
  };

  function set(newValue: T, o: { hard?: boolean; soft?: boolean | number } = {}): Promise<void> {
    targetValue = newValue;
    if (value == null || o.hard || (api.stiffness >= 1 && api.damping >= 1)) {
      cancelTask = true;
      lastTime = now();
      lastValue = newValue;
      value = newValue;
      onChange(value);
      return Promise.resolve();
    } else if (o.soft) {
      const rate = o.soft === true ? 0.5 : +o.soft;
      invMassRecoveryRate = 1 / (rate * 60);
      invMass = 0;
    }
    if (!task) {
      lastTime = now();
      cancelTask = false;
      task = loop((t) => {
        if (cancelTask) {
          cancelTask = false;
          task = null;
          return false;
        }
        invMass = Math.min(invMass + invMassRecoveryRate, 1);
        const ctx: TickCtx = { invMass, opts: api, settled: true, dt: Math.min(((t - lastTime) * 60) / 1000, 2) };
        const next = tickSpring(ctx, lastValue, value, targetValue);
        lastTime = t;
        lastValue = value;
        value = next;
        onChange(value);
        if (ctx.settled) task = null;
        return !ctx.settled;
      });
    }
    return task.promise;
  }

  return api;
}
