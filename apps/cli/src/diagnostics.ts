import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { buildReport, eventLogPath, execFileRunner, issueUrl, readEvents, redactText, renderReport, weeklySummary } from '../../../packages/diagnostics/src/index.js';
import type { ProcessRunner, UsageEvent, UsageSummary } from '../../../packages/diagnostics/src/index.js';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { privateStateRoot } from '../../../packages/project-context/src/index.js';
import { newCommandJson, plainText } from './human.js';
import { readInstalledRelease } from './release.js';

/** `bowerloom report` and `bowerloom events`. Both read this computer's own state. Neither one sends anything. */
const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const REPORT_USAGE = 'Use bowerloom report [--template bug|fidelity-gap|engine-change] [--json].';
const EVENTS_USAGE = 'Use bowerloom events [--json], or bowerloom events summary [--with-notes] [--out <absolute-file>] [--json].';
const TEMPLATES: Readonly<Record<string, string>> = { bug: 'bug.yml', 'fidelity-gap': 'fidelity-gap.yml', 'engine-change': 'engine-change.yml' };

export async function runReportCommand(args: readonly string[], home: string, write: (text: string) => void, env: NodeJS.ProcessEnv = process.env, run: ProcessRunner = execFileRunner, now: Date = new Date()): Promise<number> {
  let json = false, template = 'bug';
  for (let i = 1; i < args.length; i++) {
    const word = args[i]!;
    if (word === '--json' && !json) json = true;
    else if (word === '--template' && i + 1 < args.length && Object.hasOwn(TEMPLATES, args[i + 1]!)) template = args[++i]!;
    else usage(REPORT_USAGE);
  }
  const bundle = await buildReport({ stateRoot: privateStateRoot(env, home), env, home, now, run, platform: process.platform, release: readInstalledRelease().version });
  const url = issueUrl(bundle, TEMPLATES[template]!);
  write(json ? newCommandJson({ bundle, issueUrl: url })
    : `${plainText(renderReport(bundle), true)}\n\nNothing was sent. To file an issue, read the bundle above, then open this link:\n${url}\n`);
  return 0;
}

const LISTED = 50;
const NAMES: Readonly<Record<string, string>> = {
  S1: 'see everything', S2: 'one harness in both engines', S3: 'add from a library', S4: 'project override',
  S5: 'recover', S6: 'hand a setup to a colleague', S7: 'knowledge slice', S8: 'one team harness in many repos',
};
/** An event as it is shown: no target, no plan, no note. */
const shown = (e: UsageEvent): Record<string, unknown> => ({
  at: e.at, source: e.source, kind: e.kind, ...(e.scenario !== undefined ? { scenario: e.scenario } : {}), ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
  ...(e.step !== undefined ? { step: e.step } : {}), ...(e.code !== undefined ? { code: e.code } : {}), ...(e.answer !== undefined ? { answer: e.answer } : {}),
  ...(e.engines !== undefined ? { engines: e.engines } : {}),
});
const lineOf = (e: UsageEvent): string => `  ${[e.at, e.source, e.kind, e.scenario, e.outcome, e.step, e.code, e.answer, e.engines?.join('+')].filter(x => x !== undefined).join(' ')}`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function renderSummary(s: UsageSummary): string {
  return [
    `Usage summary, ${s.from} to ${s.to}`,
    ...Object.entries(s.scenarios).map(([id, c]) => `  ${id} ${NAMES[id]!.padEnd(32)}${c.done} done, ${c.refused} refused`),
    `  One harness in both engines: ${s.s2BothEngines ? 'yes' : 'no'}`,
    `  Project folders with an install: ${s.s8DistinctTargets}`,
    `After-apply checks: ${s.checks.yes} yes, ${s.checks.partly} partly, ${s.checks.no} no`,
    ...(s.errors.length ? ['Errors:', ...s.errors.map(e => `  ${e.code} ${e.count}`)] : ['Errors: none']),
    ...(s.notes !== undefined ? ['Notes:', ...(s.notes.length ? s.notes.map(n => `  ${n}`) : ['  none'])] : []),
  ].join('\n');
}

export function runEventsCommand(args: readonly string[], home: string, write: (text: string) => void, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): number {
  const stateRoot = privateStateRoot(env, home), tilde = (path: string): string => redactText(path, home);
  const isSummary = args[1] === 'summary';
  let json = false, withNotes = false, out: string | undefined;
  for (let i = isSummary ? 2 : 1; i < args.length; i++) {
    const word = args[i]!;
    if (word === '--json' && !json) json = true;
    else if (isSummary && word === '--with-notes' && !withNotes) withNotes = true;
    else if (isSummary && word === '--out' && out === undefined && i + 1 < args.length && isAbsolute(args[i + 1]!) && !args[i + 1]!.includes('\0')) out = args[++i]!;
    else usage(EVENTS_USAGE);
  }
  const { events, malformed } = readEvents(stateRoot);
  if (isSummary) {
    const summary = weeklySummary(events, now, { withNotes });
    if (out !== undefined) {
      // The summary is a file the person chose to write. It never replaces a file, and it is private to its owner.
      try { writeFileSync(out, newCommandJson(summary), { flag: 'wx', mode: 0o600 }); } catch (error) {
        if ((error as { code?: string }).code === 'EEXIST') throw new DefinitionError('TARGET_EXISTS', 'That file already exists. Bowerloom does not replace it. Choose a new file name.');
        throw error;
      }
      write(`Wrote the summary to ${plainText(tilde(out))}.\n`);
    } else write(json ? newCommandJson(summary) : `${plainText(renderSummary(summary), true)}\n`);
    return 0;
  }
  const newest = events.slice(-LISTED), log = tilde(eventLogPath(stateRoot));
  if (json) { write(newCommandJson({ log, events: newest.map(shown), malformed })); return 0; }
  write([
    ...(newest.length ? [`Newest ${plural(newest.length, 'event', 'events')} of ${events.length}:`, ...newest.map(lineOf)] : ['No events yet.']),
    ...(malformed ? [plural(malformed, 'line', 'lines') + ' could not be read.'] : []),
    `Log: ${plainText(log)}`, '',
  ].join('\n'));
  return 0;
}
