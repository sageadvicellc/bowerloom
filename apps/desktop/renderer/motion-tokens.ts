/**
 * Motion tokens: every duration, easing, distance and spring of the app, in one place, so they can be retuned in one edit.
 *
 * CONFIRMED. Hanna set the weighting on 2026-10-24 (spec section 7 of the Bowerloom 0.8 spec). The design-motion-principles skill names three lenses:
 * Emil Kowalski (restraint and speed), Jakub Krehel (production polish), and Jhey Tompkins (play). Checked against the apple-design rules
 * (purposeful, brief, cancellable, never the only carrier of meaning, reduced motion honoured). The weighting:
 *   Whole product ........................ Jakub leads, with Emil on the busy actions.
 *   Harness editor, skills, agents ....... Emil leads, with Jhey on drop and connect (a short settle).
 *   Knowledge graph ...................... Jhey leads: the graph settles into place and stops, brief, never looping.
 *   Setup and scan ....................... Jhey leads the reveal of found items.
 *   Versions and export .................. Jakub leads.
 * The map group below keeps the first recommendation (Emil, with Jhey on connect, drop and layout moves); the panels are Jakub; the `proto` group
 * holds the four tokens the prototype added.
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
  // The prototype's own tokens (weighting above). A reveal is slow and staggered, a lasso is quick, a drop settles with the existing settle ease.
  proto: Object.freeze({
    /** Jhey: found items appear one after another, `stagger` apart, and rise `distance` pixels as they come. */
    setupReveal: { ms: 280, stagger: 40, distance: 6, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } satisfies Transition & { stagger: number; distance: number },
    /** Jakub: the version list and the export view. A new result rises `distance` pixels as it fades in. */
    versions: { ms: 240, distance: 4, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } satisfies Transition & { distance: number },
    /** Emil: the lasso on the knowledge graph is a busy action, so it is quick. */
    lasso: { ms: 90, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } satisfies Transition,
    /** Jhey: the short settle after a drop. It uses the same ease as `ease.settle`. */
    dropSettle: { ms: 220, ease: 'cubic-bezier(0.34, 1.4, 0.64, 1)' } satisfies Transition,
  }),
  // Jakub: panels are polished, brief, and slide a short way.
  panel: Object.freeze({ slide: { ms: 220, ease: 'cubic-bezier(0.23, 1, 0.32, 1)', distance: 16 } satisfies Slide, close: { ms: 150, ease: 'cubic-bezier(0.4, 0, 1, 1)' } satisfies Transition }),
  graph: Object.freeze({
    /** How long the graph keeps settling before it rests by itself, and how it cools. Not a loop: it ends. */
    settleMs: 3500, cooldownTicks: 220, alphaDecay: 0.03, velocityDecay: 0.38,
    /** With reduced motion the graph settles before it is drawn. The ticks are capped by the size of the graph (about `budget` node-ticks in all). */
    warmup: { max: 200, min: 20, budget: 100000 },
    /** Pages that are not next to the pointed-at page fade by this much (0 to 1). */
    dimAlpha: 0.82,
    /** Typing in the search waits this long before the picture is filtered. */
    searchDebounce: 150,
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
  // A distance is 0 when the person asked for less motion, as a duration is: nothing travels.
  const travel = (name: string, px: number): void => { set(name, `${prefersReducedMotion() ? 0 : px}px`); };
  const t = (name: string, tr: Transition): void => { set(`${name}-ms`, `${ms(tr.ms)}ms`); set(`${name}-ease`, tr.ease); };
  const m = MOTION.map;
  t('node-enter', m.nodeEnter); set('node-enter-distance', `${m.nodeEnter.distance}px`); set('node-enter-scale', String(m.nodeEnter.scaleFrom));
  t('node-exit', m.nodeExit); t('edge-draw', m.edgeDraw); t('hover', m.hover); t('select', m.select); t('layout-move', m.layoutMove);
  t('drop', m.drop); set('drop-scale', String(m.drop.scaleFrom)); t('connect', m.connect); t('fit', m.fit);
  t('panel-slide', MOTION.panel.slide); set('panel-slide-distance', `${MOTION.panel.slide.distance}px`); t('panel-close', MOTION.panel.close);
  t('graph-highlight', MOTION.graph.highlight);
  const p = MOTION.proto;
  t('setup-reveal', p.setupReveal); set('setup-reveal-stagger', `${ms(p.setupReveal.stagger)}ms`); t('versions', p.versions); t('lasso', p.lasso); t('drop-settle', p.dropSettle);
  // One ease for the shared parts of the app (the navigation, buttons, rows, cards and tabs), which time themselves with --motion-hover-ms.
  set('ease-out', MOTION.ease.out);
  travel('setup-reveal-travel', p.setupReveal.distance); travel('versions-travel', p.versions.distance);
  set('reduced', prefersReducedMotion() ? '1' : '0');
}
