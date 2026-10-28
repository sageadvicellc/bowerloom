/**
 * Known escapes: command forms that a shell rule does not see in some engine (locked-in parts spec, section 8.3 rules 6
 * and 7; matching-semantics note, sections 2 and 6). Every shell guardrail loss line lists the escapes of its engine.
 *
 * The first four escape a rule in every engine, the neutral model too, because matching is on the text as written. The
 * others are where an engine reads less than the neutral model: Codex and OpenCode strip no wrapper and keep a leading
 * `NAME=value`, and Codex splits a `bash -lc` script only when it holds plain words.
 */
import type { EngineId } from '../../harness-definition/src/index.js';
import type { NeutralRequest } from './neutral.js';
import { splitCommand, startsWithAssignment, startsWithWrapper, stripAssignments } from './shell.js';
import { codexSplits } from './codex-shell.js';

export type EscapeId = 'sudo' | 'env' | 'shell-c' | 'absolute-path' | 'quoting' | 'wrapper' | 'assignment' | 'unsplit-script';

export interface KnownEscape {
  readonly engines: readonly EngineId[];
  /** The text that every loss line of these engines carries. */
  readonly text: string;
}

const ALL: readonly EngineId[] = ['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'];

export const KNOWN_ESCAPES: Readonly<Record<EscapeId, KnownEscape>> = Object.freeze({
  sudo: { engines: ALL, text: 'sudo in front of a command escapes the rule' },
  env: { engines: ALL, text: 'env in front of a command escapes the rule' },
  'shell-c': { engines: ALL, text: 'a command inside bash -c or sh -c text escapes the rule' },
  'absolute-path': { engines: ALL, text: 'an absolute program path such as /bin/rm escapes the rule' },
  quoting: { engines: ALL, text: 'quoting a word, as in git \'push\', escapes the rule' },
  wrapper: { engines: ['codex', 'opencode'], text: 'a wrapper such as timeout, nice, nohup, or xargs in front of a command escapes the rule, because this engine strips none' },
  assignment: { engines: ['codex', 'opencode'], text: 'a leading NAME=value escapes the rule, because this engine does not skip it' },
  'unsplit-script': { engines: ['codex'], text: 'Codex splits a script only when it holds plain words joined by &&, ||, ;, or |; a script with $(), a redirect, a variable, a glob, or control flow is checked as one bash -lc command, so a rule does not see the commands inside it' },
});

/** The escape list of one engine, as one sentence for a loss line. */
export function escapeSentence(engine: EngineId): string {
  const texts = (Object.values(KNOWN_ESCAPES) as KnownEscape[]).filter(e => e.engines.includes(engine)).map(e => e.text);
  return `Known escapes: ${texts.join('; ')}.`;
}

/**
 * The escapes of an engine that a request uses, where the engine reads less than the neutral model. Only these can
 * make an engine more permissive than the source, so the property tests ask for them. The four escapes of every engine
 * are not returned: the neutral model misses them too.
 */
export function escapesOf(engine: EngineId, request: NeutralRequest): EscapeId[] {
  if (request.action !== 'shell') return [];
  const out = new Set<EscapeId>();
  const parts = splitCommand(request.command);
  if (KNOWN_ESCAPES.wrapper.engines.includes(engine) && parts.some(p => startsWithWrapper(stripAssignments(p)))) out.add('wrapper');
  if (KNOWN_ESCAPES.assignment.engines.includes(engine) && parts.some(startsWithAssignment)) out.add('assignment');
  if (engine === 'codex' && !codexSplits(request.command)) out.add('unsplit-script');
  return [...out];
}
