/**
 * What an engine, or the neutral source, decides for one request.
 *
 * - `deny`: blocked.
 * - `ask`: a person approves first.
 * - `default`: no rule matched, so the engine's own default applies: its permission mode, approval policy, and sandbox.
 *   Bowerloom writes the engine default and reports it (locked-in parts spec, section 8.3 rule 12).
 * - `allow`: runs without asking.
 *
 * The order is from strict to permissive. `default` sits between `ask` and `allow`: an engine default can run an
 * action without asking (for example inside the Codex sandbox), but it is never wider than an explicit allow.
 */
import type { GuardrailEffect } from '../../harness-definition/src/index.js';

export const DECISIONS = Object.freeze(['deny', 'ask', 'default', 'allow'] as const);
export type Decision = (typeof DECISIONS)[number];

const RANK: Readonly<Record<Decision, number>> = { deny: 0, ask: 1, default: 2, allow: 3 };

/** True when `a` lets more run without a person than `b` does. */
export function morePermissive(a: Decision, b: Decision): boolean {
  return RANK[a] > RANK[b];
}

/** The stricter of two decisions. */
export function stricter(a: Decision, b: Decision): Decision {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Effects in the fixed order of precedence, strongest first. */
export const PRECEDENCE: readonly GuardrailEffect[] = Object.freeze(['deny', 'ask', 'allow']);

/**
 * Combines the decisions for the parts of one request, such as the commands of a compound command or the files of
 * one patch: any `deny` denies, else any `ask` asks, else `allow` only when every part is allowed.
 */
export function combineParts(parts: readonly Decision[]): Decision {
  if (parts.length === 0) return 'default';
  if (parts.includes('deny')) return 'deny';
  if (parts.includes('ask')) return 'ask';
  return parts.every(p => p === 'allow') ? 'allow' : 'default';
}
