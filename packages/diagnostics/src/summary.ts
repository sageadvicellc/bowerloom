import { SCENARIOS } from './schema.js';
import type { EngineName, Scenario, UsageEvent } from './schema.js';

export interface UsageSummary {
  schema: 'bowerloom/usage-summary/v1';
  from: string;
  to: string;
  scenarios: Record<Scenario, { done: number; refused: number }>;
  s2BothEngines: boolean;
  s8DistinctTargets: number;
  errors: { code: string; count: number }[];
  checks: { yes: number; partly: number; no: number };
  notes?: string[];
}

const DAY = 86_400_000;
const planOf = (plan: string): string => plan.replace(/^sha256:/, '');

/**
 * The counts of the 7 days before `now`, from the start of that UTC day. It holds no target, no plan and no time of day.
 * S2 counts as met by an S2 event, or by one plan installed into both engines within the window. S8 is met when two or
 * more distinct project folders had a done install. Notes come out only with `withNotes`.
 */
export function weeklySummary(events: readonly UsageEvent[], now: Date, options: { withNotes?: boolean } = {}): UsageSummary {
  const start = new Date(now.getTime() - 7 * DAY); start.setUTCHours(0, 0, 0, 0);
  const inWindow = events.filter(e => { const t = Date.parse(e.at); return t >= start.getTime() && t <= now.getTime(); });
  const scenarios = Object.fromEntries(SCENARIOS.map(s => [s, { done: 0, refused: 0 }])) as UsageSummary['scenarios'];
  const errors = new Map<string, number>(), checks = { yes: 0, partly: 0, no: 0 }, notes: string[] = [];
  const installs = inWindow.filter(e => e.kind === 'scenario' && e.step === 'install' && e.outcome === 'done');
  for (const e of inWindow) {
    if (e.kind === 'scenario' && e.scenario !== undefined && e.outcome !== undefined && e.scenario !== 'S8') scenarios[e.scenario][e.outcome] += 1;
    else if (e.kind === 'error' && e.code !== undefined) errors.set(e.code, (errors.get(e.code) ?? 0) + 1);
    else if (e.kind === 'check') { if (e.answer !== undefined) checks[e.answer] += 1; if (e.note !== undefined) notes.push(e.note); }
  }
  const byPlan = new Map<string, Set<EngineName>>();
  let both = installs.some(e => e.scenario === 'S2');
  for (const e of installs) {
    const engines = new Set(e.engines ?? []);
    const key = e.plan === undefined ? null : planOf(e.plan);
    const merged = key === null ? engines : (byPlan.get(key) ?? new Set<EngineName>());
    if (key !== null) { for (const n of engines) merged.add(n); byPlan.set(key, merged); }
    if (merged.has('claude-code') && merged.has('codex')) both = true;
  }
  if (both && scenarios.S2.done === 0) scenarios.S2.done = 1;
  const targets = new Set(installs.flatMap(e => (e.target === undefined ? [] : [e.target])));
  if (targets.size >= 2) scenarios.S8.done = 1;
  const summary: UsageSummary = {
    schema: 'bowerloom/usage-summary/v1', from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), scenarios,
    s2BothEngines: both, s8DistinctTargets: targets.size,
    errors: [...errors].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1)).slice(0, 10),
    checks,
  };
  if (options.withNotes === true) summary.notes = notes;
  return summary;
}
