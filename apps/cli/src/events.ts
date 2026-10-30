import { recordEvent } from '../../../packages/diagnostics/src/index.js';
import { privateStateRoot } from '../../../packages/project-context/src/index.js';
import { codeOf } from './human.js';

/**
 * Records usage events in the local log (packages/diagnostics). The log is private to this computer, and nothing here sends it anywhere.
 * Recording never changes what a command prints or its exit code: a failure to write is one stderr line, and never a throw.
 */
type Where = { readonly env: NodeJS.ProcessEnv; readonly home: string };

/** Writes one event. On a write failure it prints `Bowerloom could not write its local event log: <code>` to stderr. */
export function noteEvent(where: Where, input: Readonly<Record<string, unknown>>, now: Date = new Date()): void {
  try {
    const result = recordEvent({ stateRoot: privateStateRoot(where.env, where.home), env: where.env, now }, { source: 'cli', ...input });
    if (!result.ok) process.stderr.write(`Bowerloom could not write its local event log: ${result.code}\n`);
  } catch {
    try { process.stderr.write('Bowerloom could not write its local event log: IO_ERROR\n'); } catch { /* a closed stderr */ }
  }
}

/** The words of a command that may appear in the log as a step. Any other first word is never stored. */
export function stepOf(words: readonly string[], known: ReadonlySet<string>): string | undefined {
  const word = words[0];
  return word !== undefined && known.has(word) && /^[a-z][a-z0-9-]{1,31}$/.test(word) ? word : undefined;
}

/** The top-level catch of the CLI: one `error` event with the code the failure report uses. */
export function noteFailure(where: Where, error: unknown, words: readonly string[], known: ReadonlySet<string>): void {
  const step = stepOf(words, known);
  noteEvent(where, { kind: 'error', code: codeOf(error) ?? 'IO_ERROR', ...(step !== undefined ? { step } : {}) });
}

export interface ScenarioSpec {
  readonly scenario?: string;
  readonly step: string;
  readonly engines?: readonly string[];
  readonly plan?: string;
  /** The absolute project folder. The log keeps only a pseudonym of it. */
  readonly targetRoot?: string;
}

/**
 * Runs a command and records how it ended: `done` when it returns exit code 0, `refused` with the error's code when it throws.
 * An exit code of 3 (a plan waits for approval) records nothing, and neither does 130 (stopped). The result is passed on as it is.
 * `spec` may be a function of the outcome, read after the run, for facts that only the run knows. It may return null to record nothing.
 */
export async function recordScenario(where: Where, spec: ScenarioSpec | ((outcome: 'done' | 'refused') => ScenarioSpec | null), run: () => Promise<number>): Promise<number> {
  const resolve = (outcome: 'done' | 'refused'): ScenarioSpec | null => { try { return typeof spec === 'function' ? spec(outcome) : spec; } catch { return null; } };
  let exit: number;
  try { exit = await run(); } catch (error) {
    const s = resolve('refused');
    if (s !== null) noteEvent(where, { kind: 'scenario', outcome: 'refused', code: codeOf(error) ?? 'IO_ERROR', ...s });
    throw error;
  }
  if (exit === 0) { const s = resolve('done'); if (s !== null) noteEvent(where, { kind: 'scenario', outcome: 'done', ...s }); }
  return exit;
}
