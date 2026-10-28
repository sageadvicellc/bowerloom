/**
 * Translates guardrails to every engine, builds the loss report, and judges it with the contract's `checkFidelity`.
 * Pure functions: nothing is read from or written to disk, and no engine runs.
 */
import {
  appliesTo, checkFidelity, type ApprovalOptions, type EngineId, type EngineTarget, type FidelityVerdict, type GuardrailRule,
  type LossReport, type SandboxRequirement,
} from '../../harness-definition/src/index.js';
import { claudeCodeFormDecide, translateClaudeCode, type ClaudeCodeForm } from './claude-code.js';
import { codexFormDecide, translateCodex, type CodexForm } from './codex.js';
import type { Decision } from './decision.js';
import { patternProblem, type NeutralRequest } from './neutral.js';
import { translateNoRules, type NoRulesForm } from './no-rules.js';
import { openCodeFormDecide, translateOpenCode, type OpenCodeForm } from './opencode.js';
import { Collector, type Translation } from './translation.js';

export type EngineForm = ClaudeCodeForm | CodexForm | OpenCodeForm | NoRulesForm;
export type GuardrailTranslation = Translation<EngineForm>;

/** The guardrail entries of a definition, or of resolved layers. */
export interface GuardrailEntries {
  readonly rules: readonly GuardrailRule[];
  readonly sandbox: readonly SandboxRequirement[];
}

/**
 * Translates the rules and sandbox requirements that apply to one engine. A rule outside the neutral language of its
 * action is `absent` in every engine and never written.
 */
export function translateGuardrails(engine: EngineId, entries: GuardrailEntries): GuardrailTranslation {
  const out = new Collector(engine);
  const rules: GuardrailRule[] = [];
  for (const rule of entries.rules) {
    if (!appliesTo(rule, engine)) continue;
    const problem = patternProblem(rule);
    if (problem !== null) out.line(rule, 'absent', `The pattern is outside the neutral language of ${rule.action} rules: ${problem} Not written.`);
    else rules.push(rule);
  }
  const sandbox = entries.sandbox.filter(s => appliesTo(s, engine));
  const translation: Translation<EngineForm> = (() => {
    switch (engine) {
      case 'claude-code': return translateClaudeCode(rules, sandbox, out);
      case 'codex': return translateCodex(rules, sandbox, out);
      case 'opencode': return translateOpenCode(rules, sandbox, out);
      case 'pi': case 'deepseek-harness': return translateNoRules(engine, rules, sandbox, out);
    }
  })();
  // One line per entry, in the order of the definition.
  const order = new Map([...entries.rules, ...entries.sandbox].map((e, i) => [e.id, i]));
  return { ...translation, lines: [...translation.lines].sort((a, b) => (order.get(a.entry) ?? 0) - (order.get(b.entry) ?? 0)) };
}

/** What a translated engine form decides for one neutral request. */
export function engineDecision(form: EngineForm, request: NeutralRequest): Decision {
  switch (form.engine) {
    case 'claude-code': return claudeCodeFormDecide(form, request);
    case 'codex': return codexFormDecide(form, request);
    case 'opencode': return openCodeFormDecide(form, request);
    case 'pi': case 'deepseek-harness': return 'default';
  }
}

/** Guardrail entries and the engines a harness projects to. */
export interface GuardrailSource extends GuardrailEntries {
  readonly engines: readonly (EngineTarget | EngineId)[];
}

/** Judges a guardrail loss report with the contract's `checkFidelity`. Other parts are judged by their own lanes. */
export function judgeGuardrails(source: GuardrailSource, report: LossReport, approvals: readonly unknown[], options: ApprovalOptions = {}): FidelityVerdict {
  return checkFidelity({
    entries: { skills: [], subagents: [], rules: source.rules, sandbox: source.sandbox, hooks: [], mcp: [] },
    engines: source.engines,
  }, report, approvals, options);
}

export interface GuardrailProjection {
  readonly translations: Readonly<Partial<Record<EngineId, GuardrailTranslation>>>;
  /** Every line of every engine, in engine order. */
  readonly report: LossReport;
  readonly verdict: FidelityVerdict;
}

/** Translates to every engine of the source, then judges the loss report against the recorded approvals. */
export function projectGuardrails(source: GuardrailSource, approvals: readonly unknown[] = [], options: ApprovalOptions = {}): GuardrailProjection {
  const translations: Partial<Record<EngineId, GuardrailTranslation>> = {};
  const report = [];
  for (const target of source.engines) {
    const engine = typeof target === 'string' ? target : target.id;
    const t = translateGuardrails(engine, source);
    translations[engine] = t;
    report.push(...t.lines);
  }
  return { translations, report, verdict: judgeGuardrails(source, report, approvals, options) };
}
