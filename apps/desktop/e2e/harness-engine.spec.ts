/**
 * The adopt and install sheets in the real window, on the sample launch (--prototype-v3): synthetic folders in memory, nothing read or written.
 * "New harness from a folder": the conflict to pick, the reasons of what is not carried over, the words of every approval and acknowledgement, each ticked
 * one by one, and "Write N files" blocked until the last one. "Install a folder's harness": the weaker rules to approve first, then every result word with its
 * reason, the partial notice, pending trust, code shown in full, the drift report with Accept AGENTS.md as the default, the plan approval that a changed choice
 * takes back, the write, Undo as a removal plan, and the recovery of a stopped folder. Set HARNESS_SHOTS to a folder to save screenshots.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './proto-temp.js';
import { fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;
const PROJECTS = '#prototype-v3/projects';

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), PROJECTS); });

const adoptSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'New harness from a folder' });
const installSheet = (p: Page, name = 'Install a folder\'s harness'): Locator => p.getByRole('dialog', { name });

test('New harness from a folder: pick a copy, read every approval and acknowledgement, tick each one, and only then write', async () => {
  const p = page();
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  const s = adoptSheet(p);
  await expect(s).toBeVisible();
  await expect(s.getByText('Sample folders. Nothing is read or written.')).toBeVisible();
  await expect(s.locator('[data-folder="sample-inbox-tools"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-folder="sample-weekly-report"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(s.locator('[data-folder="sample-weekly-report"]')).toContainText('Holds a harness already.');
  await shot(p, 'E1-adopt-folder');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByText('Read 9 files in ~/Projects/inbox-tools. Nothing is written yet.')).toBeVisible();
  const conflict = s.locator('[data-conflict="system-prompt/AGENTS.md"]');
  await expect(conflict).toContainText('Two copies of AGENTS.md differ.');
  await expect(conflict).toContainText('Pick one to go on.');
  await expect(s.locator('[data-item="mcp/mail"]')).toContainText('.mcp.json#/mcpServers/mail');
  await expect(s.locator('[data-item="mcp/mail"]')).toContainText('.codex/config.toml#/mcp_servers/mail');
  await expect(s.locator('[data-unmapped=".claude/settings.json#/permissions/defaultMode"]')).toContainText('Permission modes do not translate between engines');
  await expect(s.locator('[data-unmapped=".claude/settings.json#/permissions/defaultMode"]')).toContainText('Needs your acknowledgement.');
  await expect(s.locator('[data-unmapped=".claude/skills/sort-mail/SKILL.md#/allowed-tools"]')).toContainText('Listed only.');
  await expect(s.locator('[data-section="differences"]')).toContainText('git push *');
  await expect(s.locator('[data-section="secrets"]')).toContainText('${SEARCH_KEY}');
  await expect(s.locator('[data-file="instructions/AGENTS.md"]')).toContainText('.bowerloom/instructions/AGENTS.md');
  await shot(p, 'E2-adopt-review');
  await conflict.getByRole('radio', { name: /^AGENTS\.md/ }).click();
  await expect(conflict).toContainText('Using AGENTS.md.');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  // Confirm: the words of each approval and acknowledgement, each with its own box. Nothing is ticked for the person.
  await expect(s.locator('[data-waiting]')).toContainText('Still waiting for: 2 acknowledgements, 3 approvals');
  const approvals = s.locator('[data-section="approvals"] [data-tick]');
  await expect(approvals).toHaveCount(3);
  await expect(approvals.nth(0)).toContainText('A hook runs a command. A person reads the command before Bowerloom writes it into an engine.');
  await expect(approvals.nth(2)).toContainText('Your own value of SEARCH_KEY will be sent to this server.');
  await expect(approvals.nth(2)).toContainText('${SEARCH_KEY}');
  const write = s.getByRole('button', { name: 'Write 7 files', exact: true });
  await expect(write).toBeDisabled();
  for (const box of await s.getByRole('checkbox').all()) await expect(box).not.toBeChecked();
  await shot(p, 'E3-adopt-confirm');
  const acks = s.locator('[data-section="acknowledgements"] [data-tick]');
  await expect(acks).toHaveCount(2);
  await acks.nth(0).getByRole('checkbox').check();
  await acks.nth(1).getByRole('checkbox').check();
  await expect(s.locator('[data-waiting]')).toContainText('Still waiting for: 3 approvals');
  await approvals.nth(0).getByRole('checkbox').check();
  await approvals.nth(1).getByRole('checkbox').check();
  await expect(s.locator('[data-section="approvals"]')).toContainText('2 of 3 ticked');
  await expect(write).toBeDisabled();
  await approvals.nth(2).getByRole('checkbox').check();
  await expect(s.locator('[data-waiting]')).toHaveText('Ready to write.');
  await expect(write).toBeEnabled();
  await shot(p, 'E4-adopt-ready');
  await write.click();
  // Done lists every file written (U5), and offers the next step: install the new harness.
  const done = s.locator('[data-done]');
  await expect(done).toBeVisible();
  for (const f of ['.bowerloom/harness.json', '.bowerloom/instructions/AGENTS.md', '.bowerloom/mcp.json']) await expect(done).toContainText(f);
  await shot(p, 'E4b-adopt-done');
  await s.getByRole('button', { name: 'Install it', exact: true }).click();
  await expect(installSheet(p)).toBeVisible();
  await expect(installSheet(p).locator('[data-folder="sample-inbox-tools"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Decision D8B: "Use for every engine" is one tick per part, off by default, with its count; a tick plans again, and the write needs that plan', async () => {
  const p = page();
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  const s = adoptSheet(p);
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const section = s.locator('[data-section="every-engine"]');
  await expect(section).toContainText('0 of 3 ticked');
  const boxes = section.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  for (const b of await boxes.all()) await expect(b).not.toBeChecked();
  const hooks = section.locator('[data-tick="every-engine/hooks"]');
  await expect(hooks).toContainText('1 item reaches only some engines.');
  await expect(section.locator('[data-tick="every-engine/mcp"]')).toContainText('1 item reaches only some engines.');
  // The rules that differ keep their engines, each with the reason.
  const guardrails = section.locator('[data-tick="every-engine/guardrails"]');
  await expect(guardrails).toContainText('2 items keep their engines, because they differ.');
  await expect(guardrails.locator('[data-not-widened="ask-shell-17a2d0c4"]')).toContainText('differs between engines');
  const hook = s.locator('[data-item="hooks/pre-tool-use-9c03e1f2"]');
  await expect(hook).toContainText('Claude Code');
  await s.getByRole('checkbox', { name: 'Use for every engine: Hooks' }).check();
  await expect(section).toContainText('1 of 3 ticked');
  await expect(hooks).toContainText('1 item now reaches every engine.');
  await expect(hooks.getByRole('checkbox')).toBeChecked();
  await expect(hook).toContainText('Every interface');
  await expect(hook).toContainText('Used for every engine');
  // By keyboard: Space ticks the servers box too, and the plan follows.
  await s.getByRole('checkbox', { name: 'Use for every engine: Servers' }).focus();
  await p.keyboard.press('Space');
  await expect(section).toContainText('2 of 3 ticked');
  await expect(s.locator('[data-item="mcp/search"]')).toContainText('Every interface');
  await shot(p, 'E2c-adopt-every-engine');
  // Taking a tick back plans again without it.
  await s.getByRole('checkbox', { name: 'Use for every engine: Servers' }).uncheck();
  await expect(section).toContainText('1 of 3 ticked');
  await expect(s.locator('[data-item="mcp/search"]')).toContainText('Claude Code');
  // The rest of the flow is unchanged: pick, acknowledge, approve, write; the hook's approval shows the text with no engine filter.
  await s.locator('[data-conflict="system-prompt/AGENTS.md"]').getByRole('radio', { name: /^AGENTS\.md/ }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const approvals = s.locator('[data-section="approvals"] [data-tick]');
  await expect(approvals.nth(0)).not.toContainText('"engines"');
  for (const box of await s.locator('[data-section="acknowledgements"] input').all()) await box.check();
  for (const box of await s.locator('[data-section="approvals"] input').all()) await box.check();
  await expect(s.locator('[data-waiting]')).toHaveText('Ready to write.');
  await s.getByRole('button', { name: 'Write 7 files', exact: true }).click();
  await expect(s.locator('[data-done]')).toContainText('.bowerloom/hooks.json');
});

/** Opens the install sheet on weekly-report and goes to the review of all three interfaces. */
async function openInstallReview(p: Page): Promise<Locator> {
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = installSheet(p);
  await expect(s.locator('[data-folder="sample-weekly-report"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-folder="sample-inbox-tools"]')).toHaveAttribute('aria-disabled', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const boxes = s.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  for (const b of await boxes.all()) await expect(b).toBeChecked();
  await shot(p, 'E5-install-interfaces');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  return s;
}

test('Install: approve each weaker rule first, then read every result word, the partial notice, trust, code in full, and the drift report with Accept AGENTS.md as the default', async () => {
  const p = page();
  const s = await openInstallReview(p);
  const lines = s.locator('[data-section="approve-lines"] [data-tick]');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText('Codex · Guardrails');
  await expect(lines.nth(0)).toContainText('Weakened');
  await expect(lines.nth(0)).toContainText('Common forms of git push --force escape the rule.');
  const again = s.getByRole('button', { name: 'Plan with these approvals', exact: true });
  await expect(again).toBeDisabled();
  await shot(p, 'E6-install-approve-lines');
  for (const line of await lines.all()) await line.getByRole('checkbox').check();
  await again.click();
  // The plan.
  await expect(s.getByText('Changes 10 files in ~/Projects/weekly-report.')).toBeVisible();
  await expect(s.locator('[data-partial]')).toContainText('This projection is partial');
  const loss = s.locator('[data-section="loss"]');
  await expect(loss.locator('[data-engine]')).toHaveCount(3);
  await expect(loss.locator('[data-engine="codex"] h4')).toContainText('Codex, version 0.157.0');
  await expect(loss.locator('[data-engine="codex"] h4')).toContainText('2 exact, 2 weakened, 1 absent');
  for (const word of ['Exact', 'Translated', 'Weakened', 'Absent']) await expect(loss.getByText(word, { exact: true }).first()).toBeVisible();
  await expect(loss.locator('[data-engine="codex"] [data-part="mcp"]')).toContainText('The value of ROOT names another variable, so the server is not written.');
  await expect(s.locator('[data-section="trust"] [data-trust="pending trust"]')).toHaveCount(3);
  const plugin = s.locator('[data-review="code"][data-path=".opencode/plugins/bowerloom-hooks.js"] pre');
  await expect(plugin).toContainText('export const BowerloomHooks');
  await expect(plugin).toContainText('A Bowerloom hook blocked this action.');
  await expect(s.locator('[data-path=".mcp.json"] .hxe-env')).toContainText('read from a variable when it runs');
  await expect(s.locator('[data-section="approved"] li')).toHaveCount(3);
  // The drift report.
  const drift = s.locator('[data-section="drift"]');
  await expect(drift).toContainText('AGENTS.md and CLAUDE.md differ');
  await expect(drift.locator('[data-drift-engine="claude-code"]')).toContainText('Claude Code does not read AGENTS.md.');
  await expect(drift.locator('[data-drift-engine="codex"]')).toContainText('Codex does not read CLAUDE.md.');
  await expect(drift.getByRole('radio', { name: /Accept AGENTS\.md/ })).toHaveAttribute('aria-checked', 'true');
  await expect(drift.getByRole('radio', { name: /Accept AGENTS\.md/ })).toContainText('The default');
  await expect(drift.getByRole('radio', { name: /Merge/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(drift.getByRole('radio', { name: /Merge/ })).toContainText('Moves CLAUDE.md into the harness.');
  await expect(s).not.toContainText('Not built yet');
  await expect(s.locator('[data-file="CLAUDE.md"]')).toContainText('Replaces yours');
  await shot(p, 'E7-install-plan');
  await drift.scrollIntoViewIfNeeded();
  await shot(p, 'E8-drift-report');
  // Approve the plan, then change a choice: the approval is taken back and the write waits for a new one.
  const write = s.getByRole('button', { name: 'Write 10 files', exact: true });
  await expect(write).toBeDisabled();
  const approve = s.locator('[data-approve-plan] input');
  await approve.check();
  await expect(write).toBeEnabled();
  await drift.getByRole('radio', { name: /Keep both/ }).click();
  await expect(drift.getByRole('radio', { name: /Keep both/ })).toHaveAttribute('aria-checked', 'true');
  await expect(s.locator('[data-file="CLAUDE.md"]')).toHaveCount(0);
  // The new plan comes with no approval: the box is unticked, and Write waits for a new tick (U4).
  await expect(approve).not.toBeChecked();
  await expect(s.getByRole('button', { name: 'Write 9 files', exact: true })).toBeDisabled();
  // The radios go round: from Keep both, the next one is Accept AGENTS.md.
  await drift.getByRole('radio', { name: /Keep both/ }).press('ArrowRight');
  await expect(drift.getByRole('radio', { name: /Accept AGENTS\.md/ })).toHaveAttribute('aria-checked', 'true');
  await expect(drift.getByRole('radio', { name: /Accept AGENTS\.md/ })).toBeFocused();
  await approve.check();
  await write.click();
  const done = s.locator('[data-done]');
  await expect(done).toBeVisible();
  for (const f of ['AGENTS.md', 'CLAUDE.md', '.opencode/plugins/bowerloom-hooks.js']) await expect(done).toContainText(f);
  await shot(p, 'E8b-install-done');
  // Undo is a removal plan the person approves too.
  await s.getByRole('button', { name: 'Undo', exact: true }).click();
  const r = installSheet(p, 'Remove what Bowerloom wrote');
  await expect(r).toBeVisible();
  await expect(r.locator('[data-file="CLAUDE.md"]')).toContainText('Puts yours back');
  await expect(r.locator('[data-file="AGENTS.md"]')).toContainText('Deletes');
  const remove = r.getByRole('button', { name: 'Remove 4 files', exact: true });
  await expect(remove).toBeDisabled();
  await shot(p, 'E9-removal');
  await r.locator('[data-approve-plan] input').check();
  await remove.click();
  const removed = r.locator('[data-done]');
  await expect(removed.locator('[data-section="result-Removed"] .hxi-file')).toHaveText(['.claude/settings.json', '.codex/rules/bowerloom.rules', 'AGENTS.md']);
  await expect(removed.locator('[data-section="result-Put back"] .hxi-file')).toHaveText(['CLAUDE.md']);
});

test('Merge: its own plan shows the CLAUDE.md text and the harness file, writes after its approval, and the install that follows accepts AGENTS.md', async () => {
  const p = page();
  const s = await openInstallReview(p);
  for (const line of await s.locator('[data-section="approve-lines"] input').all()) await line.check();
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  const drift = s.locator('[data-section="drift"]');
  const merge = drift.getByRole('radio', { name: /Merge/ });
  await merge.click();
  await expect(merge).toHaveAttribute('aria-checked', 'true');
  const plan = s.locator('[data-section="merge"]');
  await expect(plan).toContainText('Draft the report on Friday.');
  await expect(plan.locator('[data-file=".bowerloom/instructions/AGENTS.md"]')).toContainText('Update');
  await expect(s.locator('[data-section="loss"]')).toHaveCount(0);
  const go = s.getByRole('button', { name: 'Merge into the harness', exact: true });
  await expect(go).toBeDisabled();
  await s.locator('[data-approve-plan] input').check();
  await expect(go).toBeEnabled();
  await shot(p, 'E8c-merge-plan');
  await go.click();
  // The install plan comes back with Accept AGENTS.md, and waits for its own approval.
  await expect(s.locator('[data-merged]')).toContainText('The harness now holds the CLAUDE.md text.');
  await expect(drift.getByRole('radio', { name: /Accept AGENTS\.md/ })).toHaveAttribute('aria-checked', 'true');
  await expect(s.locator('[data-file="CLAUDE.md"]')).toContainText('Replaces yours');
  await expect(s.locator('[data-approve-plan] input')).not.toBeChecked();
  // A second Merge has nothing to move, and says so in its own words.
  await merge.click();
  await expect(s.getByRole('alert')).toContainText('There is nothing to merge');
  await s.getByRole('alert').getByRole('button', { name: 'Accept AGENTS.md', exact: true }).click();
  await expect(drift.getByRole('radio', { name: /Accept AGENTS\.md/ })).toHaveAttribute('aria-checked', 'true');
  await s.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: 'Write 10 files', exact: true }).click();
  await expect(s.locator('[data-done]')).toContainText('CLAUDE.md');
});

test('a stopped folder: the plan refuses in its own words and offers the recovery plan, which runs after its approval', async () => {
  const p = page();
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).click();
  const s = installSheet(p);
  await s.locator('[data-folder="sample-garden"]').click();
  await expect(s.locator('[data-folder="sample-garden"]')).toContainText('An install stopped part way here.');
  await s.getByRole('button', { name: 'Plan a recovery', exact: true }).click();
  const r = installSheet(p, 'Finish a stopped install');
  await expect(r).toContainText('Take the stopped run back');
  await expect(r.locator('[data-file="AGENTS.md"]')).toContainText('Undo');
  await shot(p, 'E10-recovery');
  const finish = r.getByRole('button', { name: 'Finish', exact: true });
  await expect(finish).toBeDisabled();
  await r.locator('[data-approve-plan] input').check();
  await finish.click();
  // Done names each step taken back, not only the title of the sheet.
  await expect(r.locator('[data-section="result-Taken back"] .hxi-file')).toHaveText(['AGENTS.md', '.claude/settings.json']);
  await shot(p, 'E10b-recovery-done');
});

test('the install sheet opens by keyboard at 900 by 600 and nothing sticks out of it (every control and its ring: harness-small.spec.ts)', async () => {
  const p = page();
  await p.setViewportSize({ width: 900, height: 600 });
  await p.getByRole('button', { name: 'Install from a folder', exact: true }).focus();
  await p.keyboard.press('Enter');
  const s = installSheet(p);
  await expect(s).toBeVisible();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  for (const line of await s.locator('[data-section="approve-lines"] input').all()) await line.check();
  await s.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  await expect(s.locator('[data-section="loss"]')).toBeVisible();
  const box = (await s.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(900); expect(box.y + box.height).toBeLessThanOrEqual(600);
  const wide = await s.evaluate(el => [...el.querySelectorAll<HTMLElement>('*')].filter(x => { const r = x.getBoundingClientRect(); const o = el.getBoundingClientRect(); return r.width > 0 && (r.right > o.right + 1 || r.left < o.left - 1); }).map(x => x.className));
  expect(wide).toEqual([]);
  await shot(p, 'E11-install-900x600');
});
