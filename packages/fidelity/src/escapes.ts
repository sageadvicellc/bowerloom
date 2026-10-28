/**
 * Known escapes: request forms that a guardrail does not see in some engine (locked-in parts spec, section 8.3 rules 6
 * and 7; matching-semantics note, sections 2 and 6; rulings R1, R2, R4, and R5 of the review of 122891c). Every shell
 * loss line lists the shell escapes of its engine, and every path loss line the path escapes.
 *
 * - The universal ones escape a rule in every engine and in the neutral model too, because matching is on the text as
 *   written.
 * - The others are where an engine reads less than the neutral model, so an engine can decide more permissively there.
 *   `escapesOf` names those for one request; the property tests accept a looser decision only through them.
 */
import type { EngineId } from '../../harness-definition/src/index.js';
import { codexSplits } from './codex-shell.js';
import type { NeutralRequest, RuleShape } from './neutral.js';
import { normalizeRequestPath, pathMatches } from './paths.js';
import {
  hasExtraWhitespace, opaqueForms, splitCommand, startsWithAssignment, startsWithWrapper, startsWithWrapperOptions,
  stripAssignments, type OpaqueForm,
} from './shell.js';

export type EscapeId =
  | 'sudo' | 'env' | 'shell-c' | 'absolute-path' | 'quoting' | 'find-exec' | 'subcommand-flags'
  | 'whitespace' | 'wrapper' | 'wrapper-options' | 'assignment' | 'here-document' | 'eval-exec' | 'coproc' | 'pipe-to-shell'
  | 'runtime-word' | 'unparsed-syntax' | 'unsplit-script' | 'path-case' | 'path-form';

export interface KnownEscape {
  readonly kind: 'shell' | 'path';
  readonly engines: readonly EngineId[];
  /** The text that every loss line of this kind and these engines carries. */
  readonly text: string;
}

const ALL: readonly EngineId[] = ['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'];
const RULE_ENGINES: readonly EngineId[] = ['claude-code', 'codex', 'opencode'];
const PARSER = 'the engine parses it itself, and Bowerloom does not model that parser; Bowerloom fails closed, and the live check of step 5 confirms the engine';

export const KNOWN_ESCAPES: Readonly<Record<EscapeId, KnownEscape>> = Object.freeze({
  sudo: { kind: 'shell', engines: ALL, text: 'sudo in front of a command escapes the rule' },
  env: { kind: 'shell', engines: ALL, text: 'env in front of a command escapes the rule' },
  'shell-c': { kind: 'shell', engines: ALL, text: 'a command inside bash -c or sh -c text escapes the rule' },
  'absolute-path': { kind: 'shell', engines: ALL, text: 'an absolute program path such as /bin/rm escapes the rule' },
  quoting: { kind: 'shell', engines: ALL, text: 'quoting a word, as in git \'push\', escapes the rule' },
  'find-exec': { kind: 'shell', engines: ALL, text: 'a command run by find -exec escapes the rule' },
  'subcommand-flags': { kind: 'shell', engines: ALL, text: 'a flag before the subcommand, as in git -C . push or git --no-pager push, escapes the rule' },
  whitespace: { kind: 'shell', engines: ['claude-code'], text: 'extra spaces or a tab between words can escape the rule, because Bowerloom does not know that Claude Code reads them as one space' },
  wrapper: { kind: 'shell', engines: ['codex', 'opencode'], text: 'a wrapper such as timeout, nice, nohup, or xargs in front of a command escapes the rule, because this engine strips none' },
  'wrapper-options': { kind: 'shell', engines: RULE_ENGINES, text: 'command -p, or xargs with options such as -0 or -I{}, in front of a command escapes the rule, because this engine does not strip them' },
  assignment: { kind: 'shell', engines: ['codex', 'opencode'], text: 'a leading NAME=value escapes the rule, because this engine does not skip it' },
  'here-document': { kind: 'shell', engines: RULE_ENGINES, text: `a here-document, such as a script fed to bash, can escape the rule: ${PARSER}` },
  'eval-exec': { kind: 'shell', engines: RULE_ENGINES, text: `a command run through eval or exec can escape the rule: ${PARSER}` },
  coproc: { kind: 'shell', engines: RULE_ENGINES, text: `a command run as a coproc can escape the rule: ${PARSER}` },
  'pipe-to-shell': { kind: 'shell', engines: RULE_ENGINES, text: `text piped into sh or bash runs commands the rule does not see: ${PARSER}` },
  'runtime-word': { kind: 'shell', engines: RULE_ENGINES, text: `a program name built at run time, as in $(echo rm), $R, rm$IFS-rf, or {rm,x}, escapes the rule: ${PARSER}` },
  'unparsed-syntax': { kind: 'shell', engines: RULE_ENGINES, text: `a comment, $'...' quoting, case, or a function can hide a command from the rule: ${PARSER}` },
  'unsplit-script': { kind: 'shell', engines: ['codex'], text: 'Codex splits a script only when it holds plain words joined by &&, ||, ;, or |; a script with $(), a redirect, a variable, a glob, or control flow is checked as one bash -lc command, so a rule does not see the commands inside it' },
  'path-case': { kind: 'path', engines: RULE_ENGINES, text: 'a path in other letter case, such as .ENV, can escape a deny or ask, because the engine may compare letter case; the neutral model ignores it' },
  'path-form': { kind: 'path', engines: RULE_ENGINES, text: 'a path written with //, ./, or .. can escape the rule, or meet an allow it should not, because the engine may not resolve it; the neutral model resolves it first' },
});

/** The escape list of one engine and kind, as one sentence for a loss line. */
export function escapeSentence(engine: EngineId, kind: KnownEscape['kind'] = 'shell'): string {
  const texts = (Object.values(KNOWN_ESCAPES) as KnownEscape[]).filter(e => e.kind === kind && e.engines.includes(engine)).map(e => e.text);
  return texts.length ? `Known escapes: ${texts.join('; ')}.` : '';
}

const OPAQUE_ESCAPE: Readonly<Record<OpaqueForm, EscapeId>> = {
  'here-document': 'here-document', comment: 'unparsed-syntax', 'ansi-c-quote': 'unparsed-syntax', case: 'unparsed-syntax',
  function: 'unparsed-syntax', eval: 'eval-exec', exec: 'eval-exec', coproc: 'coproc', 'pipe-to-shell': 'pipe-to-shell', 'runtime-word': 'runtime-word',
};

/**
 * The escapes of an engine that a request uses, where the engine reads less than the neutral model. `rules` is needed
 * for `path-case`: it holds when a deny or ask path rule matches the path only in other letter case.
 */
export function escapesOf(engine: EngineId, request: NeutralRequest, rules: readonly RuleShape[] = []): EscapeId[] {
  const out = new Set<EscapeId>();
  const applies = (id: EscapeId) => KNOWN_ESCAPES[id].engines.includes(engine);
  if (request.action === 'shell') {
    const parts = splitCommand(request.command);
    if (applies('whitespace') && parts.some(hasExtraWhitespace)) out.add('whitespace');
    if (applies('wrapper') && parts.some(p => startsWithWrapper(stripAssignments(p)))) out.add('wrapper');
    if (applies('wrapper-options') && parts.some(p => startsWithWrapperOptions(stripAssignments(p)))) out.add('wrapper-options');
    if (applies('assignment') && parts.some(startsWithAssignment)) out.add('assignment');
    for (const form of opaqueForms(request.command)) if (applies(OPAQUE_ESCAPE[form])) out.add(OPAQUE_ESCAPE[form]);
    if (engine === 'codex' && !codexSplits(request.command)) out.add('unsplit-script');
    return [...out];
  }
  if (request.action === 'read' || request.action === 'edit' || request.action === 'write') {
    if (!applies('path-form')) return [];
    const normal = normalizeRequestPath(request.path);
    if (normal !== request.path) out.add('path-form');
    const path = normal ?? request.path;
    const denyLike = rules.filter(r => ['read', 'edit', 'write'].includes(r.action) && r.effect !== 'allow');
    if (denyLike.some(r => pathMatches(r.pattern, path, 'any-depth', true) && !pathMatches(r.pattern, path, 'any-depth'))) out.add('path-case');
  }
  return [...out];
}
