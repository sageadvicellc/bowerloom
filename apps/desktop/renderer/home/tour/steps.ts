/**
 * The seven steps of the tour: the six of the storyboard (section 9) and "Share and history", which lights Share and Version history together. Each lights one thing,
 * found by its `data-tour` id, and says one sentence of at most 10 words. Later waves keep these ids on the same things: map, agent, details (the panel that was the
 * shelves), add, save, share, help. The third step lights the details panel of the agent that was picked, whose Skills come first, so "Skills are what it knows how to do"
 * is true of what is lit, and its card keeps off that agent. The fifth says only what the bar does, so it is true whether or not a change waits.
 */
import type { TourStep } from './tour.js';

/** The `data-tour` ids, in tour order. */
export const TOUR_TARGETS = Object.freeze(['map', 'agent', 'details', 'add', 'save', 'share', 'help'] as const);

export const TOUR_STEPS: readonly TourStep[] = Object.freeze([
  { id: 'map', target: 'map', text: 'These are your AI agents, from every tool.' },
  { id: 'agent', target: 'agent', text: 'Click an agent to see what it can do.', wait: true, hint: 'Click an agent, or select one and press Enter.', area: 'map' },
  { id: 'details', target: 'details', text: 'Skills show what the agent you picked can do.', pickedText: 'We picked an agent. Skills show what it can do.', avoid: '.hm-grid .kit-card[data-selected], .hm-grid .kit-card[data-owner]' },
  { id: 'add', target: 'add', text: 'Add skills, tools, and notes here.' },
  { id: 'save', target: 'save', text: 'This bar shows your changes. Press Save to keep them.' },
  { id: 'share', target: 'share', text: 'Share your agents or go back in time here.' },
  { id: 'help', target: 'help', text: 'Replay this tour any time.' },
].map(step => Object.freeze(step)));

/**
 * The same seven steps for a setup that is only looked at (real mode): the bar step says what the bar is there, since there is nothing to save. Every other step is the same
 * sentence, and none names an agent, a skill or a place, so the tour is true of any setup.
 */
export const TOUR_STEPS_READ_ONLY: readonly TourStep[] = Object.freeze(TOUR_STEPS.map(step => (step.id === 'save' ? Object.freeze({ ...step, text: 'This bar is read-only. Nothing here changes your setup.' }) : step)));
