/**
 * The starter agents of the home app. The sample world holds 120 generated library agents ("Amber Cartographer", "A cartographer with nothing added yet."),
 * which tell a stranger nothing and make an empty agent when added. The Agents tab of the Add drawer offers six hand-written starters instead: each has a plain
 * name, a real one-line job and two or three real skills from the plain layer (plain.ts), so the agent a person adds is not empty.
 *
 * They travel the existing path: they are ready-made agents of the one library the sample already has, so "Add agent" copies one with the store's own
 * `installItem`, and the copy keeps the skills the starter holds. `withStarterAgents` swaps them in for the generated ones in the world of the home app only;
 * the sample itself, which the 0.7 screens and their tests use, is not changed. The words of a starter are read by the plain layer through `starterOf`.
 * Pure: no React, no DOM, no clock, no random number.
 */
import { globalScope } from '../proto/common.js';
import { CASE_IDS, hashText } from '../proto/sample.js';
import type { AgentItem, World } from '../proto/types.js';

/** One starter. `job` is the line under its name, in the words a person would use. Banned words stay out of it (no "plan"), and it has at most 12 words. */
export interface Starter {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly job: string;
  readonly instructions: string;
  /** Ids of real skills of the sample, held by the agent that is added. Two or three. */
  readonly skills: readonly string[];
}

const make = (s: Starter): Starter => Object.freeze({ ...s, skills: Object.freeze([...s.skills]) });

export const STARTERS: readonly Starter[] = Object.freeze([
  make({ id: 'agent-starter-note-taker', name: 'Note taker', role: 'note taker', job: 'Writes up your meetings and lists who does what.',
    instructions: 'Listen to what was said, write it up in a few clear points, and list who must do what, and by when.', skills: ['skill-042', 'skill-009', 'skill-026'] }),
  make({ id: 'agent-starter-email-drafter', name: 'Email drafter', role: 'email drafter', job: 'Drafts replies in your voice for you to check.',
    instructions: 'Read the mail, draft a short reply that sounds like the person, and leave it to be checked before it goes out.', skills: ['skill-022', 'skill-025', 'skill-012'] }),
  make({ id: 'agent-starter-research-reader', name: 'Research reader', role: 'research reader', job: 'Reads articles and tells you what matters.',
    instructions: 'Find trusted sources on a topic, boil each one down to its main points, and compare the choices side by side.', skills: ['skill-024', 'skill-029', 'skill-010'] }),
  make({ id: 'agent-starter-trip-planner', name: 'Trip planner', role: 'trip planner', job: 'Lays out a trip day by day and hunts for prices.',
    instructions: 'Lay out each day of a trip with times, look for the best prices, and find a time that works for everyone.', skills: ['skill-037', 'skill-018', 'skill-033'] }),
  make({ id: 'agent-starter-budget-checker', name: 'Budget checker', role: 'budget checker', job: 'Checks your spending and flags what looks odd.',
    instructions: 'Sort each expense under the right heading, add the totals up again, and point out charges that look new or too high.', skills: ['skill-035', 'skill-021', 'skill-020'] }),
  make({ id: 'agent-starter-reading-coach', name: 'Reading coach', role: 'reading coach', job: 'Explains hard words and sums up what you read.',
    instructions: 'Explain a hard word in plain language, cut a long text down, and give the gist in two or three lines.', skills: ['skill-015', 'skill-016', 'skill-036'] }),
]);

/** What `installItem` adds to an id when it copies a ready-made agent into the person's own agents: "-copy", then "-2", "-3" and so on. */
const COPY_SUFFIX = /-copy(?:-\d+)?$/;

/** The starter an agent id stands for: the starter itself, or a copy of it that the person added. Undefined for any other agent. */
export function starterOf(id: string): Starter | undefined {
  const base = id.replace(COPY_SUFFIX, '');
  return STARTERS.find(s => s.id === base);
}

const isReadyMadeAgent = (item: World['items'][number]): boolean => item.kind === 'agent' && item.library !== null;

/**
 * The world with the six starters as its ready-made agents in place of the generated ones. They belong to the one library the sample has, found in one place,
 * with the instructions written out. A world that has no library, no global place to hold them, or that already has the starters comes back as it is.
 */
export function withStarterAgents(world: World): World {
  const home = globalScope(world), library = world.libraries.find(l => l.id === CASE_IDS.newerLibrary);
  if (home === undefined || library === undefined) return world;
  const ready = world.items.filter(isReadyMadeAgent);
  if (ready.length === STARTERS.length && STARTERS.every(s => ready.some(i => i.id === s.id))) return world;
  const agents = STARTERS.map((s): AgentItem => {
    const text = `# ${s.name}\nrole: ${s.role}\n\n${s.instructions}\n`;
    return {
      id: s.id, kind: 'agent', name: s.name, scopeId: home.id, library: { library: library.id, pinnedVersion: library.installedVersion },
      foundAt: [{ interface: 'claude-code', path: `agents/${s.id.replace('agent-starter-', '')}.md`, contentHash: hashText(text), text }],
      definition: { name: s.name, role: s.role, instructions: s.instructions, skillIds: [...s.skills], toolAttachments: [] }, extras: [],
    };
  });
  return { ...world, items: [...world.items.filter(i => !isReadyMadeAgent(i)), ...agents] };
}
