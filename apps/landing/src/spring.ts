// A tiny damped-spring solver. It samples a spring that moves from 0 to 1, and turns the samples into a CSS `linear()` easing.
// The spring is x'' = -(k/m)(x - 1) - (c/m)x', starting at rest at 0. The closed form is used, so there is no stepping error.

export interface Spring { mass: number; stiffness: number; damping: number }

/** Position of the spring at time `t` seconds. It starts at 0 and rests at 1. */
export function springPosition({ mass, stiffness, damping }: Spring, t: number): number {
  if (t <= 0) return 0;
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(zeta - 1) < 1e-6) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - root);
  const r2 = -omega * (zeta + root);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

const STEP = 1 / 240;
const LIMIT = 10;

/** The last moment, in seconds, at which the spring is further than `tolerance` from rest. */
export function settleTime(spring: Spring, tolerance = 0.003): number {
  let last = 0;
  for (let t = 0; t <= LIMIT; t += STEP) if (Math.abs(springPosition(spring, t) - 1) > tolerance) last = t;
  return last + STEP;
}

/** The highest position above 1, as a fraction (0.04 is a 4 percent overshoot). */
export function peakOvershoot(spring: Spring): number {
  let peak = 0;
  for (let t = 0; t <= settleTime(spring, 1e-5); t += STEP) peak = Math.max(peak, springPosition(spring, t) - 1);
  return peak;
}

const trim = (value: number) => String(Number(value.toFixed(4)));

/** A CSS `linear()` easing that follows the spring over its settle time. It starts at 0 and ends at exactly 1. */
export function toLinear(spring: Spring, points = 40): string {
  const duration = settleTime(spring);
  const values = Array.from({ length: points }, (_, i) => (i === 0 ? 0 : i === points - 1 ? 1 : springPosition(spring, (i / (points - 1)) * duration)));
  return `linear(${values.map(trim).join(', ')})`;
}

export interface NamedSpring { easing: string; durationMs: number }

export function describeSpring(spring: Spring): NamedSpring {
  return { easing: toLinear(spring), durationMs: Math.round(settleTime(spring) * 1000) };
}

/**
 * Soft rise for cards and images: damping ratio 0.72, so it overshoots by about 4 percent and settles in about 0.6 s.
 * Text: damping ratio 0.95, so it never visibly overshoots and settles in about 0.4 s.
 */
export const SPRINGS = {
  soft: { mass: 1, stiffness: 130, damping: 16.4 },
  text: { mass: 1, stiffness: 210, damping: 27.5 },
} as const satisfies Record<string, Spring>;

/** Writes each spring to the element as `--spring-<name>` and `--spring-<name>-duration`. Does nothing where `linear()` is unsupported, so the CSS fallback curves stay. */
export function installSprings(root: HTMLElement): boolean {
  if (typeof CSS === 'undefined' || !CSS.supports('transition-timing-function', 'linear(0, 1)')) return false;
  for (const [name, spring] of Object.entries(SPRINGS)) {
    const { easing, durationMs } = describeSpring(spring);
    root.style.setProperty(`--spring-${name}`, easing);
    root.style.setProperty(`--spring-${name}-duration`, `${durationMs}ms`);
  }
  return true;
}
