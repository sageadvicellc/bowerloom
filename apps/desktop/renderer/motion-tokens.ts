/**
 * Motion tokens: every duration, easing, distance and spring of the app, in one place, so they can be retuned in one edit.
 *
 * UNCONFIRMED, OWNER TO CHOOSE. The weighting below is a recommendation from the design-motion-principles skill (Create mode),
 * checked against the apple-design rules (purposeful, brief, cancellable, never the only carrier of meaning, reduced motion honoured):
 *   Node map ........ mostly Emil Kowalski (restraint and speed), with Jhey Tompkins (playful) only on connect, drop and layout moves.
 *   Knowledge graph . mostly Jhey Tompkins (the graph settling is the ambient motion), still brief, with no looping decoration.
 *   Panels .......... Jakub Krehel (polish: a short slide with a small fade).
 * Where the two sources differ, the accessibility rules win: with "reduce motion" on, every duration here becomes 0, nothing moves,
 * and nothing is left half-finished. Frequent actions (selecting, hovering, typing in search, arrow-key moves) get no travel at all.
 */

export interface Transition { ms: number; ease: string }
export interface Slide extends Transition { distance: number }

export const MOTION = Object.freeze({
  ease: Object.freeze({
    /** Strong ease-out: quick start, soft landing. For things that appear. */
    out: 'cubic-bezier(0.23, 1, 0.32, 1)',
    /** For things that leave: quicker, quieter. */
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    /** For things that move between two places. */
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
    /** A small overshoot, used only where the person has just let go of something (drop, connect). */
    settle: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  }),
  map: Object.freeze({
    // Emil: appear quickly, leave faster, never from nothing (start from 0.96, not 0).
    nodeEnter: { ms: 160, ease: 'cubic-bezier(0.23, 1, 0.32, 1)', distance: 6, scaleFrom: 0.96 } satisfies Slide & { scaleFrom: number },
    nodeExit: { ms: 110, ease: 'cubic-bezier(0.4, 0, 1, 1)' } satisfies Transition,
    /** A wire draws itself from its start to its end. */
    edgeDraw: { ms: 240, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } satisfies Transition,
    /** Selecting and hovering are frequent: very short, and nothing travels. */
    hover: { ms: 90, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } satisfies Transition,
    select: { ms: 120, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } satisfies Transition,
    // Jhey, only here: the person has just done something, so a little life is welcome.
    layoutMove: { ms: 360, ease: 'cubic-bezier(0.65, 0, 0.35, 1)' } satisfies Transition,
    drop: { ms: 220, ease: 'cubic-bezier(0.34, 1.4, 0.64, 1)', scaleFrom: 0.94 } satisfies Transition & { scaleFrom: number },
    connect: { ms: 260, ease: 'cubic-bezier(0.34, 1.4, 0.64, 1)' } satisfies Transition,
    fit: { ms: 300, ease: 'cubic-bezier(0.65, 0, 0.35, 1)' } satisfies Transition,
    /** Small waits, in milliseconds, that go with the motion above: a leaving node stays this long past its exit, a tidy ends this long past its move. */
    exitGrace: 20, settleGrace: 30,
    /** Moves that land closer together than this are saved together. */
    saveDebounce: 400,
    /** Arrow-key moves closer together than this are one step to undo. */
    keyMoveBurst: 500,
  }),
  // Jakub: panels are polished, brief, and slide a short way.
  panel: Object.freeze({ slide: { ms: 220, ease: 'cubic-bezier(0.23, 1, 0.32, 1)', distance: 16 } satisfies Slide, close: { ms: 150, ease: 'cubic-bezier(0.4, 0, 1, 1)' } satisfies Transition }),
  graph: Object.freeze({
    /** How long the graph keeps settling before it rests by itself, and how it cools. Not a loop: it ends. */
    settleMs: 3500, cooldownTicks: 220, alphaDecay: 0.03, velocityDecay: 0.38,
    /** Neighbours light up on hover. */
    highlight: { ms: 140, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } satisfies Transition,
    /** The camera moves to a chosen page. */
    focus: { ms: 420, ease: 'cubic-bezier(0.65, 0, 0.35, 1)' } satisfies Transition,
  }),
});

export const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The duration to use right now: 0 when the person asked for less motion. */
export const ms = (value: number): number => (prefersReducedMotion() ? 0 : value);

/**
 * Publishes the tokens as CSS custom properties on the page, so style sheets can use them. Called at start and again when the
 * "reduce motion" setting changes. Set one property at a time (never a style attribute as text), which the page's policy allows.
 */
export function applyMotionTokens(root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string): void => { root.style.setProperty(`--motion-${name}`, value); };
  const t = (name: string, tr: Transition): void => { set(`${name}-ms`, `${ms(tr.ms)}ms`); set(`${name}-ease`, tr.ease); };
  const m = MOTION.map;
  t('node-enter', m.nodeEnter); set('node-enter-distance', `${m.nodeEnter.distance}px`); set('node-enter-scale', String(m.nodeEnter.scaleFrom));
  t('node-exit', m.nodeExit); t('edge-draw', m.edgeDraw); t('hover', m.hover); t('select', m.select); t('layout-move', m.layoutMove);
  t('drop', m.drop); set('drop-scale', String(m.drop.scaleFrom)); t('connect', m.connect); t('fit', m.fit);
  t('panel-slide', MOTION.panel.slide); set('panel-slide-distance', `${MOTION.panel.slide.distance}px`); t('panel-close', MOTION.panel.close);
  t('graph-highlight', MOTION.graph.highlight);
  set('reduced', prefersReducedMotion() ? '1' : '0');
}
