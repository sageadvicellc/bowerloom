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
import { patternProgram, ruleOpaque, type NeutralRequest, type RuleShape } from './neutral.js';
import { normalizeRequestPath, pathMatches } from './paths.js';
import {
  hasExtraWhitespace, opaqueForms, programWord, splitCommand, startsWithAssignment, startsWithWrapper, startsWithWrapperOptions,
  stripAssignments, type OpaqueForm,
} from './shell.js';

export type EscapeId =
  | 'sudo' | 'env' | 'shell-c' | 'absolute-path' | 'quoting' | 'find-exec' | 'subcommand-flags' | 'runner' | 'program-case'
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
  // The neutral model misses these too, because matching is on the text as written.
  'absolute-path': { kind: 'shell', engines: ALL, text: 'an absolute program path such as /bin/rm escapes the rule' },
  quoting: { kind: 'shell', engines: ALL, text: 'quoting a word after the program, as in git \'push\', escapes the rule' },
  'subcommand-flags': { kind: 'shell', engines: ALL, text: 'a flag before the subcommand, as in git -C . push or git --no-pager push, escapes the rule' },
  // The neutral model fails closed on these (rulings R1 and R4, review items W2 to W4, W7, and W9); the engine may not.
  sudo: { kind: 'shell', engines: RULE_ENGINES, text: `sudo in front of a command escapes the rule: ${PARSER}` },
  env: { kind: 'shell', engines: RULE_ENGINES, text: `env in front of a command escapes the rule: ${PARSER}` },
  'find-exec': { kind: 'shell', engines: RULE_ENGINES, text: `a command run by find -exec escapes the rule: ${PARSER}` },
  'shell-c': { kind: 'shell', engines: RULE_ENGINES, text: `a command inside bash -c or sh -c text escapes the rule: ${PARSER}` },
  runner: { kind: 'shell', engines: RULE_ENGINES, text: `a program that runs another command, such as busybox, setsid, ionice, flock, watch, chroot, script -c, ssh, strace, parallel, doas, or su -c, escapes the rule: ${PARSER}` },
  'program-case': { kind: 'shell', engines: RULE_ENGINES, text: 'a program name in other letter case, such as RM, escapes the rule, because this engine compares letter case; the neutral model ignores it for a deny or ask' },
  whitespace: { kind: 'shell', engines: ['claude-code'], text: 'extra spaces or a tab between words can escape the rule, because Bowerloom does not know that Claude Code reads them as one space' },
  wrapper: { kind: 'shell', engines: ['codex', 'opencode'], text: 'a wrapper such as timeout, nice, nohup, or xargs in front of a command escapes the rule, because this engine strips none' },
  'wrapper-options': { kind: 'shell', engines: RULE_ENGINES, text: `command -p, or xargs, timeout, nice, nohup, or command with options, such as -0, -I{}, --, or combined flags, in front of a command escapes the rule: ${PARSER}` },
  assignment: { kind: 'shell', engines: ['codex', 'opencode'], text: 'a leading NAME=value escapes the rule, because this engine does not skip it' },
  'here-document': { kind: 'shell', engines: RULE_ENGINES, text: `a here-document, such as a script fed to bash, can escape the rule: ${PARSER}` },
  'eval-exec': { kind: 'shell', engines: RULE_ENGINES, text: `a command run through eval, exec, or trap can escape the rule: ${PARSER}` },
  coproc: { kind: 'shell', engines: RULE_ENGINES, text: `a command run as a coproc can escape the rule: ${PARSER}` },
  'pipe-to-shell': { kind: 'shell', engines: RULE_ENGINES, text: `a shell, source, or . that reads commands from a pipe, a file, a here-string, or <(...) runs commands the rule does not see: ${PARSER}` },
  'runtime-word': { kind: 'shell', engines: RULE_ENGINES, text: `a word built at run time, in the program or in the words a rule names, as in $(echo rm), $R, rm$IFS-rf, {rm,x}, 'rm', git $(echo push), git pu*, or git ~, escapes the rule: ${PARSER}` },
  'unparsed-syntax': { kind: 'shell', engines: RULE_ENGINES, text: `a comment, $'...' quoting, case, or a function can hide a command from the rule: ${PARSER}` },
  'unsplit-script': { kind: 'shell', engines: ['codex'], text: 'Codex splits a script only when it holds plain words joined by &&, ||, ;, or |; a script with $(), a redirect, a variable, a glob, or control flow is checked as one bash -lc command, so a rule does not see the commands inside it' },
  'path-case': { kind: 'path', engines: RULE_ENGINES, text: 'a path in other letter case, such as .ENV, can escape a deny or ask, because the engine may compare letter case; the neutral model ignores it' },
  'path-form': { kind: 'path', engines: RULE_ENGINES, text: 'a path written with //, ./, or .. can escape the rule, or meet an allow it should not, because the engine may not resolve it; the neutral model resolves it first' },
});

/** The note of a path allow in an engine that matches the path as written. */
export const PATH_ALLOW_REACH = 'The engine may not resolve .. and may compare letter case differently, so the allow can reach a path outside it, as with src/../x; that is weakened (follow-up ruling 4 on the review of 122891c).';

/** The escape list of one engine and kind, as one sentence for a loss line. */
export function escapeSentence(engine: EngineId, kind: KnownEscape['kind'] = 'shell'): string {
  const texts = (Object.values(KNOWN_ESCAPES) as KnownEscape[]).filter(e => e.kind === kind && e.engines.includes(engine)).map(e => e.text);
  return texts.length ? `Known escapes: ${texts.join('; ')}.` : '';
}

const OPAQUE_ESCAPE: Readonly<Record<OpaqueForm, EscapeId>> = {
  'here-document': 'here-document', comment: 'unparsed-syntax', 'ansi-c-quote': 'unparsed-syntax', case: 'unparsed-syntax',
  function: 'unparsed-syntax', eval: 'eval-exec', exec: 'eval-exec', coproc: 'coproc', 'pipe-to-shell': 'pipe-to-shell', 'runtime-word': 'runtime-word',
  'wrapper-option': 'wrapper-options', 'shell-input': 'pipe-to-shell', runner: 'runner',
};

/** The escape of a runner or shell part, named as specifically as the list allows. */
function partEscape(part: string): EscapeId | null {
  const program = programWord(part);
  const name = program.slice(program.lastIndexOf('/') + 1);
  if (name === 'sudo') return 'sudo';
  if (name === 'env') return 'env';
  if (name === 'find' && opaqueForms(part).includes('runner')) return 'find-exec';
  if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'].includes(name) && / -[a-z]*c\b/.test(part)) return 'shell-c';
  return null;
}

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
    for (const part of parts) {
      const specific = partEscape(part);
      for (const form of opaqueForms(part)) {
        const id = specific !== null && (form === 'runner' || form === 'shell-input') ? specific : OPAQUE_ESCAPE[form];
        if (applies(id)) out.add(id);
      }
    }
    for (const form of opaqueForms(request.command)) if (!['runner', 'shell-input', 'wrapper-option', 'eval', 'exec', 'coproc', 'runtime-word'].includes(form) && applies(OPAQUE_ESCAPE[form])) out.add(OPAQUE_ESCAPE[form]);
    if (applies('runtime-word') && ruleOpaque(rules, request.command)) out.add('runtime-word');
    if (applies('program-case')) {
      const programs = new Set(rules.filter(r => r.action === 'shell' && r.effect !== 'allow').map(r => patternProgram(r.pattern)?.toLowerCase()));
      if (parts.some(p => { const w = programWord(p); return w !== w.toLowerCase() && programs.has(w.toLowerCase()); })) out.add('program-case');
    }
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
