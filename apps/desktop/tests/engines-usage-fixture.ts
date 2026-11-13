// Fixture engine setups for the Engines and usage module (lane 5 of v0.9). Plain data: no file, no clock, no random number. Every name, text and secret here is made up.
// `setupState` is a state with three engines: Claude Code (found, with parts in two folders), Codex (found) and OpenCode (not found). `fakeRun` and `fakeFigures` make recorded runs and what their logs held.
import { createSampleWorld } from '../shared/harness/sample.js';
import type { HarnessState, Interface, Part, PartKind, ScanSource } from '../shared/harness/types.js';
import { NO_FIGURES } from '../shared/api/runs.js';
import type { RunFigures, RunView } from '../shared/api/runs.js';

export const NOW = { daysAgo: 0, time: '10:00' };

/** A made-up key in the shape the scrub patterns know. If it shows anywhere on the screen, a view kept a value it should have hidden. */
export const FAKE_KEY = 'sk-FAKEFAKEFAKE1234567890abcd';

export interface PartOptions { readonly toolKind?: 'mcp' | 'prompt' | 'hook'; readonly hasSecret?: boolean; readonly summary?: string; readonly description?: string }

export function fakePart(id: string, kind: PartKind, name: string, origin: string, options: PartOptions = {}): Part {
  return {
    id, kind, name, summary: options.summary ?? `${name}.`, description: options.description ?? `${name} is a made-up part.`, path: `fixture/${id}`, source: 'Fixture', origin, fileText: `fixture text of ${name}`,
    cannotUse: [], inLibrary: true,
    ...(kind === 'tool' && options.toolKind !== undefined ? { toolKind: options.toolKind } : {}),
    ...(options.hasSecret === true ? { hasSecret: true } : {}),
  };
}

export const fakeSource = (id: string, interfaceName: string, label: string, partIds: readonly string[], scope: 'home' | 'project' = 'home'): ScanSource =>
  ({ id, name: `${label} (${interfaceName})`, interfaceName, harnessName: `${label} ${interfaceName}`, partIds, scope, label });

const iface = (base: Interface, over: Partial<Interface>): Interface => ({ ...base, ...over });

/** Claude Code has 3 skills, 1 agent, 2 connections (one holds a secret), 1 hook and 1 saved prompt, in two folders. Codex has 1 skill and 1 connection. OpenCode is not found. */
export function setupState(): HarnessState {
  const base = createSampleWorld(NOW);
  const [claude, codex, opencode] = base.interfaces as readonly [Interface, Interface, Interface];
  const parts: Part[] = [
    fakePart('cc-skill-1', 'skill', 'Write a reply', 'src-cc-home'), fakePart('cc-skill-2', 'skill', 'Check the totals', 'src-cc-home'), fakePart('cc-skill-3', 'skill', 'Tidy notes', 'src-cc-alpha'),
    fakePart('cc-agent-1', 'agent', 'Reviewer', 'src-cc-home'),
    fakePart('cc-conn-1', 'tool', 'tracker', 'src-cc-home', { toolKind: 'mcp', hasSecret: true, description: 'Starts node on this computer.' }),
    fakePart('cc-conn-2', 'tool', 'docs', 'src-cc-alpha', { toolKind: 'mcp', description: 'Connects to docs.example.test.' }),
    fakePart('cc-hook-1', 'tool', 'Format on save', 'src-cc-home', { toolKind: 'hook' }), fakePart('cc-prompt-1', 'tool', 'Weekly report', 'src-cc-home', { toolKind: 'prompt' }),
    fakePart('cx-skill-1', 'skill', 'Summarize', 'src-cx-home'), fakePart('cx-conn-1', 'tool', 'search', 'src-cx-home', { toolKind: 'mcp', description: 'Connects to search.example.test.' }),
    fakePart('notes-1', 'context', 'Meeting notes', 'src-notes'),
  ];
  const sources: ScanSource[] = [
    fakeSource('src-cc-home', 'Claude Code', '~', parts.filter(p => p.origin === 'src-cc-home').map(p => p.id)),
    fakeSource('src-cc-alpha', 'Claude Code', '~/Projects/alpha', parts.filter(p => p.origin === 'src-cc-alpha').map(p => p.id), 'project'),
    fakeSource('src-cx-home', 'Codex', '~', parts.filter(p => p.origin === 'src-cx-home').map(p => p.id)),
    fakeSource('src-notes', 'Notes', '~/Notes', ['notes-1'], 'project'),
  ];
  return {
    ...base, parts, sources, chosenSourceIds: sources.map(s => s.id), harnesses: [], installs: [], runs: [], history: [], projects: [],
    interfaces: [
      iface(claude, { foundAt: 'Found at ~/.claude', health: 'ready', healthWords: 'Ready', on: true }),
      iface(codex, { foundAt: 'Found at ~/.codex and ~/.agents', health: 'ready', healthWords: 'Ready', on: false }),
      iface(opencode, { foundAt: 'Not found on this computer', health: 'not-found', healthWords: 'Not found', on: false }),
    ],
    real: { couldNotRead: 0, stoppedEarly: false, notes: [], textsCut: 0 },
  };
}

export const fakeRun = (id: string, engine: RunView['engine'], startedAt: string, over: Partial<RunView> = {}): RunView =>
  ({ id, engine, instruction: 'Write a weekly report.', projectName: 'alpha', projectLabel: '~/Projects/alpha', startedAt, status: 'done', groupId: 'group-1', rating: null, notes: '', ...over });

export const fakeFigures = (over: Partial<RunFigures> = {}): RunFigures =>
  ({ state: 'found', reason: null, startedAt: '2026-11-11T10:31:00.000Z', endedAt: '2026-11-11T10:32:00.000Z', durationMs: 60_000, inputTokens: 1000, outputTokens: 200, model: 'model-a', outcome: 'finished', ...over });

export { NO_FIGURES };

/** Freezes an object and everything inside it, so a view that changed its input would throw. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) { Object.freeze(value); for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner); }
  return value;
}

/** Every string in a value, at any depth (keys are not strings of the value). */
export function stringsIn(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, into);
  else if (value instanceof Map) for (const item of value.values()) stringsIn(item, into);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) stringsIn(item, into);
  return into;
}
