/**
 * The six steps of the tour, from the storyboard (section 9). Each lights one thing, found by its `data-tour` id, and says one sentence of at most 12 words.
 * Later waves keep these ids on the same things: map, agent, shelves, add, save, help.
 */
import type { TourStep } from './tour.js';

/** The `data-tour` ids, in tour order. */
export const TOUR_TARGETS = Object.freeze(['map', 'agent', 'shelves', 'add', 'save', 'help'] as const);

export const TOUR_STEPS: readonly TourStep[] = Object.freeze([
  { id: 'map', target: 'map', text: 'These are your AI agents, from every tool.' },
  { id: 'agent', target: 'agent', text: 'Click an agent to see what it can do.', wait: true, hint: 'Click any agent.', area: 'map' },
  { id: 'shelves', target: 'shelves', text: 'Skills are what it knows how to do.' },
  { id: 'add', target: 'add', text: 'Add skills, tools, and notes here.' },
  { id: 'save', target: 'save', text: 'Changes wait here until you press Save.' },
  { id: 'help', target: 'help', text: 'Replay this tour any time.' },
].map(step => Object.freeze(step)));
