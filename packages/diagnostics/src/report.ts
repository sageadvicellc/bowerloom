import { execFile } from 'node:child_process';
import { release as osRelease } from 'node:os';
import { readEvents } from './log.js';
import { redactDeep, redactText } from './redact.js';
import { isoSeconds } from './schema.js';
import type { UsageEvent } from './schema.js';

export interface RunOptions { readonly timeout: number; readonly env: Readonly<Record<string, string>>; readonly shell: false }
/** Runs one program with arguments, never through a shell. Rejects with an error whose `code` is ENOENT when the program is missing. */
export type ProcessRunner = (file: string, args: readonly string[], options: RunOptions) => Promise<{ stdout: string; stderr: string }>;

/** The runner for real use: execFile, with the options it is given. */
export const execFileRunner: ProcessRunner = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, [...args], { timeout: options.timeout, env: { ...options.env }, shell: false, encoding: 'utf8', maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    if (error) reject(error); else resolve({ stdout, stderr });
  });
});

export type RecentEvent = Pick<UsageEvent, 'at' | 'source' | 'kind'> & Partial<Pick<UsageEvent, 'scenario' | 'outcome' | 'step' | 'code' | 'answer'>>;
export interface ReportBundle {
  schema: 'bowerloom/report/v1';
  created: string;
  bowerloom: { cli: string; app?: string };
  os: { platform: string; version: string };
  engines: { 'claude-code': string; codex: string };
  lastError: string;
  planHash: string;
  recent: RecentEvent[];
}
export interface ReportOptions {
  readonly stateRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly now: Date;
  readonly run: ProcessRunner;
  readonly platform: string;
  /** The CLI version, from the installed release record. */
  readonly release: string;
  readonly appVersion?: string;
  /** Replaces os.release() on a system other than macOS. For tests. */
  readonly osRelease?: () => string;
}

const PROBE_TIMEOUT_MS = 3000;
const VERSION = /\d+\.\d+\.\d+[\w.+-]*/;

/** The version an engine prints for `--version`: the first x.y.z match, `not found` when the program is missing, else `unknown`. */
export async function probeEngine(file: string, run: ProcessRunner, path: string, home: string): Promise<string> {
  try {
    const { stdout } = await run(file, ['--version'], { timeout: PROBE_TIMEOUT_MS, env: { PATH: path, HOME: home }, shell: false });
    return VERSION.exec(stdout)?.[0]?.slice(0, 64) ?? 'unknown';
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === 'ENOENT' ? 'not found' : 'unknown';
  }
}

async function osVersion(options: ReportOptions): Promise<string> {
  const fallback = (options.osRelease ?? osRelease)();
  if (options.platform !== 'darwin') return fallback;
  try {
    const { stdout } = await options.run('sw_vers', ['-productVersion'], { timeout: PROBE_TIMEOUT_MS, env: { PATH: options.env.PATH ?? '', HOME: options.home }, shell: false });
    const text = stdout.trim();
    return /^\d+(?:\.\d+){0,2}$/.test(text) ? text : fallback;
  } catch { return fallback; }
}

const reduce = (e: UsageEvent): RecentEvent => ({
  at: e.at, source: e.source, kind: e.kind,
  ...(e.scenario !== undefined ? { scenario: e.scenario } : {}), ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
  ...(e.step !== undefined ? { step: e.step } : {}), ...(e.code !== undefined ? { code: e.code } : {}), ...(e.answer !== undefined ? { answer: e.answer } : {}),
});

/**
 * The problem report bundle: versions, system, the newest log lines reduced to allowlisted fields. It holds no note,
 * no target id and no plan line. A last pass replaces the home folder, user folder prefixes and token-shaped strings.
 */
export async function buildReport(options: ReportOptions): Promise<ReportBundle> {
  const path = options.env.PATH ?? '';
  const [claude, codex, version] = await Promise.all([probeEngine('claude', options.run, path, options.home), probeEngine('codex', options.run, path, options.home), osVersion(options)]);
  const { events } = readEvents(options.stateRoot);
  const newest = [...events].reverse();
  const bundle: ReportBundle = {
    schema: 'bowerloom/report/v1', created: isoSeconds(options.now),
    bowerloom: { cli: options.release, ...(options.appVersion !== undefined ? { app: options.appVersion } : {}) },
    os: { platform: options.platform, version },
    engines: { 'claude-code': claude, codex },
    lastError: newest.find(e => e.code !== undefined && (e.kind === 'error' || (e.kind === 'scenario' && e.outcome === 'refused')))?.code ?? 'none',
    planHash: newest.find(e => e.plan !== undefined)?.plan ?? 'none',
    recent: events.slice(-20).map(reduce),
  };
  return redactDeep(bundle, options.home);
}

const line = (e: RecentEvent): string => `  ${[e.at, e.source, e.kind, e.scenario, e.outcome, e.step, e.code, e.answer].filter(x => x !== undefined).join(' ')}`;

/** The bundle as plain text, one field to a line. `omitted` is the number of older lines the caller left out. */
export function renderReport(bundle: ReportBundle, options: { omitted?: number } = {}): string {
  const omitted = options.omitted ?? 0;
  const text = [
    `Bowerloom problem report (${bundle.schema})`,
    `Created: ${bundle.created}`,
    `Bowerloom: ${bundle.bowerloom.cli}`,
    ...(bundle.bowerloom.app !== undefined ? [`Bowerloom app: ${bundle.bowerloom.app}`] : []),
    `Operating system: ${bundle.os.platform} ${bundle.os.version}`,
    `Claude Code: ${bundle.engines['claude-code']}`,
    `Codex: ${bundle.engines.codex}`,
    `Last error: ${bundle.lastError}`,
    `Plan hash: ${bundle.planHash}`,
    `Recent events (${bundle.recent.length}):`,
    ...bundle.recent.map(line),
    ...(omitted > 0 ? [`(${omitted} older lines left out)`] : []),
  ].join('\n');
  return redactText(text);
}

export const ISSUE_TEMPLATES = ['bug.yml', 'fidelity-gap.yml', 'engine-change.yml'] as const;
export type IssueTemplate = (typeof ISSUE_TEMPLATES)[number];
export const ISSUE_URL_LIMIT = 7500;

/** The GitHub new-issue link that carries the bundle in the form field `bundle`. Older recent lines go first to stay under 7,500 characters. */
export function issueUrl(bundle: ReportBundle, template: string): string {
  if (!(ISSUE_TEMPLATES as readonly string[]).includes(template)) throw new TypeError('Unknown issue template.');
  const build = (dropped: number): string =>
    `https://github.com/sageadvicellc/bowerloom/issues/new?template=${template}&bundle=${encodeURIComponent(renderReport({ ...bundle, recent: bundle.recent.slice(dropped) }, { omitted: dropped }))}`;
  let dropped = 0, url = build(0);
  while (url.length > ISSUE_URL_LIMIT && dropped < bundle.recent.length) { dropped += 1; url = build(dropped); }
  return url;
}
