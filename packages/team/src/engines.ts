/**
 * What each engine offers a team member: its delivery modes (section 6) and how Bowerloom would start it unattended.
 * Every command and flag comes from a record: the Claude Code and Codex adapters in this repository, or the research
 * notes engines-E and engines-G of 2026-10-28. Where no record names a flag, the row says so, and the start is refused
 * rather than guessed (decision 9).
 */
import type { EngineId, Result } from '../../harness-definition/src/index.js';
import type { DeliveryMode, InboxMode, StartMode } from './words.js';

/** One row of the section 6 table: the modes, strongest first, and the result word with a relay bus. */
export interface DeliveryRow {
  readonly modes: readonly DeliveryMode[];
  readonly result: Result;
  readonly note: string;
}
export const DELIVERY_TABLE: Readonly<Record<EngineId, DeliveryRow>> = Object.freeze({
  'claude-code': { modes: ['push', 'turn', 'pull'], result: 'translated', note: 'push goes through the cross-session inbox, whose wire frame is undocumented' },
  codex: { modes: ['turn', 'pull'], result: 'weakened', note: 'codex exec takes no message while it runs; exec resume carries a turn' },
  opencode: { modes: ['push', 'turn'], result: 'translated', note: 'push goes through prompt_async on opencode serve' },
  pi: { modes: ['push', 'turn'], result: 'translated', note: 'push goes through steer and follow_up in RPC mode; guardrails stay absent' },
  'deepseek-harness': { modes: ['turn'], result: 'weakened', note: 'no push was found for headless, and ACP takes one prompt at a time' },
});

/** How an unattended instance starts, or why 0.8 does not start it. */
export type StartRow =
  | {
    readonly supported: true;
    /** The command without the model. */
    readonly argv: readonly string[];
    /** The arguments that set the model, or null when no record names the flag. */
    readonly model: ((model: string, inbox: InboxMode) => readonly string[]) | null;
    /** `message`: the first message goes on standard input. `none`: standard input is empty. */
    readonly stdin: 'message' | 'none';
    /** Environment names Bowerloom sets for the instance. Values never appear in a plan. */
    readonly environment: readonly string[];
    /** The lowest version whose flags the command uses. */
    readonly minVersion?: string;
    readonly source: string;
    /**
     * How the command pins the sandbox and the approval behaviour, or null when no recorded flag pins them. A start
     * whose command pins neither is refused: ambient engine config would decide (ruling T5).
     */
    readonly pinned: { readonly sandbox: string; readonly approval: string } | null;
    /** What ambient engine config still loads, which the plan does not read. */
    readonly ambient: string;
  }
  | { readonly supported: false; readonly code: 'TEAM_START_MODE_UNSUPPORTED' | 'TEAM_START_UNDOCUMENTED'; readonly reason: string };

type Unattended = Exclude<StartMode, 'manual'>;
export const START_TABLE: Readonly<Record<EngineId, Readonly<Record<Unattended, StartRow>>>> = Object.freeze({
  'claude-code': {
    headless: {
      supported: true,
      argv: ['claude', '--print'],
      model: (model, inbox) => [
        '--model', model, '--output-format', 'json', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
        '--settings', JSON.stringify({ crossSessionInbound: inbox, sandbox: { enabled: true, allowUnsandboxedCommands: false } }),
      ],
      stdin: 'message',
      environment: [],
      minVersion: '2.1.259',
      source: 'packages/claude-adapter (--print, --model, --permission-mode dontAsk, --permission-prompts none, --settings); research note engines-G, sections 3 and 5 (--permission-prompts since 2.1.259, crossSessionInbound); packages/project-sync locked writer (sandbox enabled, allowUnsandboxedCommands false)',
      pinned: { sandbox: 'enabled, no unsandboxed commands', approval: 'dontAsk with no permission prompts: a request no rule allows is denied' },
      ambient: 'User-level Claude Code settings still load, and this plan does not read them: a user permission rule can allow a request without a person.',
    },
    server: { supported: false, code: 'TEAM_START_MODE_UNSUPPORTED', reason: 'Claude Code has no server mode (section 6).' },
  },
  codex: {
    headless: {
      supported: true,
      argv: ['codex', '-c', 'approval_policy="never"', 'exec', '--json', '--sandbox', 'workspace-write'],
      model: model => ['-m', model, '-'],
      stdin: 'message',
      environment: [],
      minVersion: '0.157.0',
      source: 'packages/codex-adapter for Codex 0.157.0 (-c approval_policy="never", exec, --json, -m, and - for the message on standard input); research note engines-E, section 2 (--sandbox workspace-write)',
      pinned: { sandbox: 'workspace-write', approval: 'never: a request outside the sandbox fails' },
      ambient: 'User-level Codex config, such as its MCP servers, still loads, and this plan does not read it.',
    },
    server: { supported: false, code: 'TEAM_START_MODE_UNSUPPORTED', reason: 'Codex has no server mode of its own. Its app server is experimental, and Bowerloom 0.8 has no client to drive it (section 6, note 3).' },
  },
  opencode: {
    headless: {
      supported: true,
      argv: ['opencode', 'run', '--format', 'json'],
      model: null,
      stdin: 'none',
      environment: [],
      source: 'research note engines-E, section 1 (opencode run --format json); open issue 38723 (a run with an open standard input can hang)',
      pinned: null,
      ambient: 'ambient engine config not checked',
    },
    server: {
      supported: true,
      argv: ['opencode', 'serve'],
      model: null,
      stdin: 'none',
      environment: ['OPENCODE_SERVER_PASSWORD'],
      source: 'section 6, note 4 (opencode serve listens on 127.0.0.1, and Bowerloom sets OPENCODE_SERVER_PASSWORD)',
      pinned: null,
      ambient: 'ambient engine config not checked',
    },
  },
  pi: {
    headless: {
      supported: true,
      argv: ['pi', '-p', '--mode', 'json'],
      model: null,
      stdin: 'message',
      environment: [],
      source: 'research note engines-E, section 1 (pi -p, --mode json)',
      pinned: null,
      ambient: 'ambient engine config not checked',
    },
    server: { supported: false, code: 'TEAM_START_MODE_UNSUPPORTED', reason: 'pi --mode rpc speaks JSON lines on standard input and output. Bowerloom 0.8 has no relay bus or client to hold it (decision 7).' },
  },
  'deepseek-harness': {
    headless: { supported: false, code: 'TEAM_START_UNDOCUMENTED', reason: 'What dsh --profile headless does at an approval is not documented, and --approval-policy never is untested (research note engines-G, section 3).' },
    server: { supported: false, code: 'TEAM_START_MODE_UNSUPPORTED', reason: 'The ACP and SDK profiles of DeepSeek Harness need a client, and Bowerloom 0.8 has none (decision 7).' },
  },
});

/** Who pays for a member's runs (section 7, rule 5). */
export interface Billing {
  readonly source: 'subscription' | 'not-recorded';
  readonly note: string;
}
export function billingOf(engine: EngineId): Billing {
  return engine === 'claude-code'
    ? { source: 'subscription', note: 'Decision 6 assumes that claude --print draws from the subscription. A support article carries a dated pause note, so a person rereads it before release.' }
    : { source: 'not-recorded', note: 'The engine sign-in decides who pays. Bowerloom has no record of which sign-in this member uses.' };
}

const SEMVER = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,64}))?(?:\+[0-9A-Za-z.-]{1,64})?$/;
/** True for a semantic version such as 2.1.310 or 0.2.2-alpha.2. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER.test(value);
}
/** True when `version` is at least `min`. A prerelease counts as older than its release. */
export function atLeast(version: string, min: string): boolean {
  const a = SEMVER.exec(version), b = SEMVER.exec(min);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const x = Number(a[i]), y = Number(b[i]);
    if (x !== y) return x > y;
  }
  return a[4] === undefined || b[4] !== undefined;
}
