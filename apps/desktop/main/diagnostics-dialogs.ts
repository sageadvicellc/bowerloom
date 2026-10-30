/**
 * The two Help dialogs of the app, with every tool passed in so a test runs them with no Electron:
 *  - "Report a problem" builds the report bundle on this computer and shows all of it. Only "Open GitHub issue" opens the issue form, through the same allowlist
 *    as every other link of the app (main/security.ts). Nothing is sent by the app.
 *  - "Usage log" shows the weekly summary of the local log and where the log is. "Save summary" writes the summary, without notes, to the file the person picks.
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { buildReport, eventLogPath, issueUrl, readEvents, redactText, renderReport, weeklySummary } from '../../../packages/diagnostics/src/index.js';
import type { ProcessRunner, ReportBundle, UsageSummary } from '../../../packages/diagnostics/src/index.js';
import { isAllowedExternal } from './security.js';

export interface MessageOptions {
  readonly type: 'info' | 'question';
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly defaultId: number;
  readonly cancelId: number;
  readonly noLink: true;
}
export interface SaveOptions { readonly title: string; readonly defaultPath: string; readonly buttonLabel: string }

export interface DialogDeps {
  readonly stateRoot: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly appVersion: string;
  readonly platform: string;
  readonly run: ProcessRunner;
  readonly now: () => Date;
  readonly showMessage: (options: MessageOptions) => Promise<{ readonly response: number }>;
  readonly showSave: (options: SaveOptions) => Promise<{ readonly canceled: boolean; readonly filePath?: string }>;
  /** Opens a link in the person's browser. Called only with a link that passed `isAllowedExternal`. */
  readonly openExternal: (url: string) => Promise<void>;
  readonly copyText: (text: string) => void;
  /** Writes the file the person chose, for its owner only. */
  readonly writeFile?: (path: string, text: string) => void;
}

export const REPORT_BUTTONS = Object.freeze(['Open GitHub issue', 'Copy bundle', 'Cancel'] as const);
export const USAGE_BUTTONS = Object.freeze(['Save summary…', 'Close'] as const);
const ISSUE_FORM = 'https://github.com/sageadvicellc/bowerloom/issues/new';

/**
 * The issue link for a bundle. The link the package builds can be longer than the app's allowlist takes (2048 characters), so older lines of the bundle are
 * left out of the link, and the link's own text says how many. Returns the link and how many of the newest lines it carries.
 */
export function issueLink(bundle: ReportBundle, template = 'bug.yml'): { url: string; carried: number } {
  const full = issueUrl(bundle, template);
  if (isAllowedExternal(full)) return { url: full, carried: bundle.recent.length };
  for (let dropped = 1; dropped <= bundle.recent.length; dropped++) {
    const url = `${ISSUE_FORM}?template=${template}&bundle=${encodeURIComponent(renderReport({ ...bundle, recent: bundle.recent.slice(dropped) }, { omitted: dropped }))}`;
    if (isAllowedExternal(url)) return { url, carried: bundle.recent.length - dropped };
  }
  return { url: `${ISSUE_FORM}?template=${template}`, carried: 0 };
}

export type ReportOutcome = 'opened' | 'copied' | 'cancelled';

export async function reportProblem(deps: DialogDeps): Promise<ReportOutcome> {
  const bundle = await buildReport({ stateRoot: deps.stateRoot, env: deps.env, home: deps.home, now: deps.now(), run: deps.run, platform: deps.platform, release: deps.appVersion, appVersion: deps.appVersion });
  const text = renderReport(bundle), link = issueLink(bundle);
  const left = bundle.recent.length - link.carried;
  const detail = left > 0 ? `${text}\n\nThe link carries the newest ${link.carried} of these lines. Copy bundle copies all of them.` : text;
  const { response } = await deps.showMessage({
    type: 'question', title: 'Report a problem',
    message: 'This is everything a problem report holds. Bowerloom sends nothing. Open GitHub issue puts it in a form you read and send yourself.',
    detail, buttons: REPORT_BUTTONS, defaultId: 2, cancelId: 2, noLink: true,
  });
  if (response === 0) {
    if (!isAllowedExternal(link.url)) return 'cancelled';
    await deps.openExternal(link.url);
    return 'opened';
  }
  if (response === 1) { deps.copyText(text); return 'copied'; }
  return 'cancelled';
}

const SCENARIO_NAMES: Readonly<Record<string, string>> = {
  S1: 'See everything', S2: 'One harness in both engines', S3: 'Add from a library', S4: 'Project override',
  S5: 'Recover', S6: 'Hand a setup to a colleague', S7: 'Knowledge slice', S8: 'One team harness in many repos',
};

/** The weekly summary as lines a person reads. It holds the counts only. */
export function summaryText(s: UsageSummary): string {
  return [
    `Usage summary, ${s.from} to ${s.to}`,
    ...Object.entries(s.scenarios).map(([id, c]) => `${id} ${SCENARIO_NAMES[id] ?? id}: ${c.done} done, ${c.refused} refused`),
    `One harness in both engines: ${s.s2BothEngines ? 'yes' : 'no'}`,
    `Project folders with an install: ${s.s8DistinctTargets}`,
    `After-apply checks: ${s.checks.yes} yes, ${s.checks.partly} partly, ${s.checks.no} no`,
    s.errors.length ? `Errors: ${s.errors.map(e => `${e.code} ${e.count}`).join(', ')}` : 'Errors: none',
  ].join('\n');
}

const writePrivate = (path: string, text: string): void => { writeFileSync(path, text, { mode: 0o600 }); chmodSync(path, 0o600); };

export type UsageOutcome = 'saved' | 'closed' | 'not-saved';

export async function showUsageLog(deps: DialogDeps): Promise<UsageOutcome> {
  const now = deps.now();
  const { events } = readEvents(deps.stateRoot);
  const summary = weeklySummary(events, now);
  const { response } = await deps.showMessage({
    type: 'info', title: 'Usage log',
    message: 'This is what Bowerloom counted on this computer in the last 7 days. Nothing was sent.',
    detail: `${summaryText(summary)}\n\nLog: ${redactText(eventLogPath(deps.stateRoot), deps.home)}`,
    buttons: USAGE_BUTTONS, defaultId: 1, cancelId: 1, noLink: true,
  });
  if (response !== 0) return 'closed';
  const picked = await deps.showSave({ title: 'Save the usage summary', defaultPath: `bowerloom-usage-${summary.to}.json`, buttonLabel: 'Save summary' });
  if (picked.canceled || picked.filePath === undefined) return 'not-saved';
  try { (deps.writeFile ?? writePrivate)(picked.filePath, `${JSON.stringify(summary, null, 2)}\n`); } catch {
    await deps.showMessage({ type: 'info', title: 'Usage log', message: 'Bowerloom could not save the summary.', detail: 'Nothing was written. Choose another place and try again.', buttons: ['Close'], defaultId: 0, cancelId: 0, noLink: true });
    return 'not-saved';
  }
  return 'saved';
}
