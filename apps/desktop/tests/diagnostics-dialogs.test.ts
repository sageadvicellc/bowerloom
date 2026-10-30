// The Help menu and its two dialogs, with a fake dialog, a fake browser, and a fake clipboard: the menu entries, that Report a problem shows the whole bundle
// and sends nothing, that Cancel opens nothing, that Open GitHub issue opens one allowlisted link, and that Usage log saves a private summary without notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recordEvent } from '../../../packages/diagnostics/src/index.js';
import type { ProcessRunner } from '../../../packages/diagnostics/src/index.js';
import { REPORT_BUTTONS, USAGE_BUTTONS, issueLink, reportProblem, showUsageLog } from '../main/diagnostics-dialogs.js';
import type { DialogDeps, MessageOptions } from '../main/diagnostics-dialogs.js';
import { HELP_LABELS, helpMenu } from '../main/help-menu.js';
import { isAllowedExternal } from '../main/security.js';
import { tempDir } from './support.js';

const NOW = new Date('2026-10-30T14:00:00Z');
const HOME = '/home/test-person';
const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const NOTE = 'My private note about Test Person';

const fakeRun: ProcessRunner = async file => {
  if (file === 'claude') return { stdout: '2.1.0 (Claude Code)', stderr: '' };
  if (file === 'codex') return { stdout: `codex-cli 0.9.1 ${HOME}/bin ${SECRET}`, stderr: '' };
  return { stdout: '15.1', stderr: '' };
};

function setup(t: test.TestContext, answer: (o: MessageOptions) => number, lines = 3): { deps: DialogDeps; shown: MessageOptions[]; opened: string[]; copied: string[]; saved: string[]; stateRoot: string; saveTo: { path: string | null } } {
  const stateRoot = join(tempDir(t, 'bowerloom-dialogs-'), 'state');
  for (let i = 0; i < lines; i++) recordEvent({ stateRoot, env: {}, now: new Date(NOW.getTime() - i * 1000) }, { source: 'app', kind: 'scenario', scenario: 'S1', step: 'adopt', outcome: 'done' });
  recordEvent({ stateRoot, env: {}, now: NOW }, { source: 'app', kind: 'check', answer: 'no', note: NOTE });
  const shown: MessageOptions[] = [], opened: string[] = [], copied: string[] = [], saved: string[] = [], saveTo: { path: string | null } = { path: join(stateRoot, '..', 'summary.json') };
  const deps: DialogDeps = {
    stateRoot, home: HOME, env: { PATH: '/usr/bin' }, appVersion: '0.8.0-beta.1', platform: 'darwin', run: fakeRun, now: () => NOW,
    showMessage: async o => { shown.push(o); return { response: answer(o) }; },
    showSave: async () => (saveTo.path === null ? { canceled: true } : { canceled: false, filePath: saveTo.path }),
    openExternal: async url => { opened.push(url); },
    copyText: text => { copied.push(text); },
  };
  return { deps, shown, opened, copied, saved, stateRoot, saveTo };
}

test('the Help menu has Report a problem and Usage log, and each entry runs its own action', () => {
  const ran: string[] = [];
  const menu = helpMenu({ report: () => ran.push('report'), usage: () => ran.push('usage') });
  assert.equal(menu.label, 'Help'); assert.equal(menu.role, 'help');
  assert.deepEqual(menu.submenu.map(i => i.label), ['Report a problem…', 'Usage log…']);
  assert.deepEqual([HELP_LABELS.report, HELP_LABELS.usage], menu.submenu.map(i => i.label));
  for (const item of menu.submenu) item.click();
  assert.deepEqual(ran, ['report', 'usage']);
});

test('Report a problem shows the whole bundle with three buttons, Cancel the default and the cancel id; no path, token, note or target is in it', async t => {
  const s = setup(t, () => 2);
  assert.equal(await reportProblem(s.deps), 'cancelled');
  assert.equal(s.shown.length, 1);
  const box = s.shown[0]!;
  assert.deepEqual([...box.buttons], ['Open GitHub issue', 'Copy bundle', 'Cancel']);
  assert.deepEqual([...box.buttons], [...REPORT_BUTTONS]);
  assert.equal(box.defaultId, 2); assert.equal(box.cancelId, 2); assert.equal(box.noLink, true);
  assert.match(box.detail, /^Bowerloom problem report \(bowerloom\/report\/v1\)/);
  assert.match(box.detail, /Bowerloom app: 0\.8\.0-beta\.1/);
  assert.match(box.detail, /Claude Code: 2\.1\.0/);
  assert.match(box.detail, /Recent events \(4\):/);
  for (const text of [box.detail, box.message]) {
    assert.equal(text.includes(HOME), false); assert.equal(text.includes(SECRET), false); assert.equal(text.includes(NOTE), false);
  }
  assert.deepEqual([s.opened, s.copied], [[], []], 'Cancel opens nothing and copies nothing');
});

test('Open GitHub issue opens exactly one link, and it is an allowlisted GitHub issue form that carries the bundle', async t => {
  const s = setup(t, () => 0);
  assert.equal(await reportProblem(s.deps), 'opened');
  assert.equal(s.opened.length, 1);
  const url = s.opened[0]!;
  assert.equal(isAllowedExternal(url), true);
  assert.match(url, /^https:\/\/github\.com\/sageadvicellc\/bowerloom\/issues\/new\?template=bug\.yml&bundle=/);
  const bundle = decodeURIComponent(url.split('&bundle=')[1]!);
  assert.match(bundle, /Bowerloom problem report/);
  assert.equal(bundle.includes(SECRET), false);
  assert.equal(s.copied.length, 0);
});

test('Copy bundle copies the shown text and opens nothing', async t => {
  const s = setup(t, () => 1);
  assert.equal(await reportProblem(s.deps), 'copied');
  assert.deepEqual(s.opened, []);
  assert.equal(s.copied.length, 1);
  assert.equal(s.copied[0], s.shown[0]!.detail);
});

test('a bundle too long for the allowlist is cut from the link by its older lines, the link says how many, and the dialog says so', async t => {
  const s = setup(t, () => 0, 0);
  for (let i = 0; i < 20; i++) recordEvent({ stateRoot: s.stateRoot, env: {}, now: new Date(NOW.getTime() - (i + 1) * 1000) }, { source: 'app', kind: 'error', step: 'install', code: 'PORTABLE_FIDELITY_REFUSED_FOR_THIS_PLAN' });
  assert.equal(await reportProblem(s.deps), 'opened');
  const url = s.opened[0]!;
  assert.ok(url.length <= 2048);
  assert.equal(isAllowedExternal(url), true);
  assert.match(decodeURIComponent(url), /\(\d+ older lines left out\)/);
  assert.match(s.shown[0]!.detail, /The link carries the newest \d+ of these lines\. Copy bundle copies all of them\./);
  const { carried } = issueLink(JSON.parse('{"schema":"bowerloom/report/v1","created":"2026-10-30T14:00:00Z","bowerloom":{"cli":"1"},"os":{"platform":"darwin","version":"15"},"engines":{"claude-code":"1.0.0","codex":"1.0.0"},"lastError":"none","planHash":"none","recent":[]}'));
  assert.equal(carried, 0);
});

test('Usage log shows the weekly counts and the log path with ~, never a note, with Save summary and Close', async t => {
  const s = setup(t, () => 1);
  s.deps = { ...s.deps };
  assert.equal(await showUsageLog(s.deps), 'closed');
  const box = s.shown[0]!;
  assert.deepEqual([...box.buttons], [...USAGE_BUTTONS]);
  assert.deepEqual([...box.buttons], ['Save summary…', 'Close']);
  assert.equal(box.cancelId, 1);
  assert.match(box.detail, /S1 See everything: 3 done, 0 refused/);
  assert.match(box.detail, /After-apply checks: 0 yes, 0 partly, 1 no/);
  assert.equal(box.detail.includes(NOTE), false);
  assert.equal(existsSync(join(s.stateRoot, '..', 'summary.json')), false, 'Close writes nothing');
});

test('Save summary writes the summary JSON for its owner only, with no note, no plan, and no target', async t => {
  const s = setup(t, () => 0);
  assert.equal(await showUsageLog(s.deps), 'saved');
  const path = s.saveTo.path!;
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const text = readFileSync(path, 'utf8');
  const summary = JSON.parse(text) as { schema: string; checks: { no: number }; notes?: unknown };
  assert.equal(summary.schema, 'bowerloom/usage-summary/v1'); assert.equal(summary.checks.no, 1); assert.equal(summary.notes, undefined);
  assert.equal(text.includes(NOTE), false);
});

test('a closed save dialog writes nothing, and a failed write says so and does not throw', async t => {
  const s = setup(t, () => 0);
  s.saveTo.path = null;
  assert.equal(await showUsageLog(s.deps), 'not-saved');
  const failing = setup(t, o => (o.buttons.length === 2 ? 0 : 0));
  const outcome = await showUsageLog({ ...failing.deps, writeFile: () => { throw new Error('read-only'); } });
  assert.equal(outcome, 'not-saved');
  assert.equal(failing.shown.length, 2);
  assert.match(failing.shown[1]!.message, /could not save the summary/);
});
