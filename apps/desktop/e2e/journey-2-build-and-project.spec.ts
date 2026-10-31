/**
 * Journey 2 (spec section 12): "Build and project". The person opens a folder's harness and drags a skill to an agent. They save, then install. The result shows in Claude Code and Codex.
 * After a restart, she goes back to the save point before the change.
 *
 * It runs on the made-up home (tools/made-up-home.ts), project `rope-yard`, which already holds a harness for both programs. "The result shows in Claude Code and Codex" is checked on disk:
 * the files in the plan are the files written, and each one carries the bytes its source says. No program is started. Whether each program lists the skills and agents is the owner's
 * look at pass 2 and is not tested here.
 *
 * The step "drags a skill to an agent" FAILS on this folder (the last test of the file, an expected failure): the Builder moves the agents away while a skill is dragged, so the drop misses. The journey
 * joins the skill the other way the Builder offers (press the agent, its circle, then the skill) and goes on from there.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { dragSkillToAgent, installSheet, linkSkillToAgent, newMadeUpHome, node, openInBuilder, readTree, saveFromBuilder, saveSheet, startApp, without } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

let h: RealHarness;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

/** The parts of an agent file of the harness: its front matter lines and its body, as the test reads them. */
function parseAgent(text: string): { front: string; body: string; skills: string[]; description: string } {
  const m = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(text)!;
  const front = m[1]!;
  const skills = [...front.matchAll(/^ {2}- (.+)$/gm)].map(x => x[1]!);
  return { front, body: m[2]!.trim(), skills, description: /^description: (.+)$/m.exec(front)![1]! };
}

test('Journey 2: join a skill to an agent, save, install to Claude Code and Codex, restart, go back to the save point before the change', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome(), dir = home.rope, def = join(dir, '.bowerloom');
  const original = readTree(def);
  const outsideBefore = without(readTree(dir), '.bowerloom/');
  expect(outsideBefore, 'the project holds only its harness at the start').toEqual({});
  expect(parseAgent(original['agents/tallyman.md']!).skills).toEqual([]);
  let p: Page;

  await test.step('2.1 open the folder\'s harness: the graph shows its agents and skills', async () => {
    h = await startApp(home, 'harnesses');
    p = h.page;
    await openInBuilder(h, dir, 'rope-yard');
    const ids = await p.locator('.hx-node').evaluateAll(els => els.map(e => e.getAttribute('data-node')).sort());
    expect(ids).toEqual(['agent:foreman', 'agent:tallyman', 'skill:coil-count', 'skill:knot-guide', 'skill:splice']);
    await expect(p.locator('[data-draft]')).toContainText('No change yet.');
    await expect(p.locator('main')).not.toContainText(home.home);
  });

  await test.step('2.2 join the skill knot-guide to the agent tallyman (press the agent, its circle, then the skill): a draft, and nothing is written', async () => {
    await linkSkillToAgent(p, 'knot-guide', 'tallyman');
    await expect(p.locator('[data-draft]')).toContainText('1 change, not saved yet.');
    await expect(p.locator('[data-agent="tallyman"]').getByRole('checkbox', { name: 'knot-guide: tallyman' })).toBeChecked();
    expect(readTree(def), 'a draft writes nothing').toEqual(original);
  });

  let saved: Record<string, string>;
  await test.step('2.3 save: the review lists one file, and the file on disk then lists the skill', async () => {
    const listed = await saveFromBuilder(h);
    expect(listed).toEqual({ '.bowerloom/agents/tallyman.md': 'update' });
    expect((await h.asked()).at(-1)!.message).toMatch(/^Change 1 file in ~\/Projects\/rope-yard\/\.bowerloom\?$/);
    saved = readTree(def);
    expect(Object.keys(saved)).toEqual(Object.keys(original));
    for (const [path, text] of Object.entries(original)) if (path !== 'agents/tallyman.md') expect(saved[path], path).toBe(text);
    expect(parseAgent(saved['agents/tallyman.md']!).skills).toEqual(['knot-guide']);
    const loaded = loadDefinition(def);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.definition.entries.subagents.find(a => a.id === 'tallyman')?.skills).toEqual(['knot-guide']);
    expect(loaded.definition.entries.subagents.find(a => a.id === 'foreman')?.skills).toEqual(['splice']);
  });

  let planned: string[];
  await test.step('2.4 install to Claude Code and Codex: the sheet lists the files, and nothing is written while she reads', async () => {
    await saveSheet(p).locator('[data-install-next]').click();
    const install = installSheet(p);
    await expect(install).toBeVisible();
    await install.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(install.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
    await expect(install.getByRole('checkbox', { name: 'Codex' })).toBeChecked();
    await install.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(install.locator('[data-approve-plan] input')).toBeVisible();
    planned = (await install.locator('[data-file]').evaluateAll(els => els.map(e => e.getAttribute('data-file') ?? ''))).sort();
    expect(planned.length).toBeGreaterThan(0);
    expect(without(readTree(dir), '.bowerloom/'), 'nothing is projected while the person reads').toEqual({});
    await install.locator('[data-approve-plan] input').check();
    await install.getByRole('button', { name: /^Write \d+ files$/ }).click();
    await expect(install.locator('[data-done]')).toBeVisible();
    expect((await h.asked()).at(-1)!.message).toBe(`Write ${planned.length} files in ~/Projects/rope-yard?`);
  });

  let afterInstall: Record<string, string>;
  await test.step('2.5 the result shows in Claude Code and Codex: the written files are the planned files, and each carries the bytes its source says', async () => {
    const projected = without(readTree(dir), '.bowerloom/');
    expect(Object.keys(projected).sort(), 'the files on disk are the files in the plan').toEqual(planned);
    const agents = ['foreman', 'tallyman'], skills = ['coil-count', 'knot-guide', 'splice'];
    expect(planned).toEqual([
      'AGENTS.md', ...skills.map(s => `.agents/skills/${s}/SKILL.md`), ...agents.map(a => `.claude/agents/${a}.md`), ...skills.map(s => `.claude/skills/${s}/SKILL.md`), ...agents.map(a => `.codex/agents/${a}.toml`),
    ].sort());
    expect(projected['AGENTS.md'], 'instructions').toBe(saved['instructions/AGENTS.md']);
    for (const s of skills) {
      expect(projected[`.claude/skills/${s}/SKILL.md`], `Claude Code skill ${s}`).toBe(saved[`skills/${s}/SKILL.md`]);
      expect(projected[`.agents/skills/${s}/SKILL.md`], `Codex skill ${s}`).toBe(saved[`skills/${s}/SKILL.md`]);
    }
    for (const a of agents) {
      const source = parseAgent(saved[`agents/${a}.md`]!);
      const claude = projected[`.claude/agents/${a}.md`]!, codex = projected[`.codex/agents/${a}.toml`]!;
      expect(claude, `Claude Code agent ${a}: name`).toMatch(new RegExp(`^name: "?${a}"?$`, 'm'));
      expect(claude, `Claude Code agent ${a}: description`).toContain(source.description);
      expect(claude.trim().endsWith(source.body), `Claude Code agent ${a}: instructions`).toBe(true);
      if (source.skills.length > 0) expect(claude, `Claude Code agent ${a}: skills`).toMatch(new RegExp(`^skills: \\[${source.skills.map(s => `"${s}"`).join(', ')}\\]$`, 'm'));
      else expect(claude, `Claude Code agent ${a}: no skills line`).not.toMatch(/^skills:/m);
      expect(codex, `Codex agent ${a}: name`).toContain(`name = "${a}"`);
      expect(codex, `Codex agent ${a}: description`).toContain(source.description);
      expect(codex, `Codex agent ${a}: instructions`).toContain(source.body);
    }
    afterInstall = projected;
  });

  await test.step('2.6 restart, open the folder again, and go back to the save point before the change', async () => {
    await h.app.close();
    h = await startApp(home, 'harnesses');
    p = h.page;
    await openInBuilder(h, dir, 'rope-yard');
    await expect(p.locator('[data-agent="tallyman"]').getByRole('checkbox', { name: 'knot-guide: tallyman' })).toBeChecked();
    await p.getByRole('button', { name: 'Save points', exact: true }).click();
    const drawer = p.getByRole('dialog', { name: 'Save points' });
    await expect(drawer.locator('[data-version]')).toHaveCount(2);
    const asItWas = drawer.locator('[data-version]', { hasText: /as it was/i });
    await expect(asItWas).toHaveCount(1);
    const id = (await asItWas.getAttribute('data-version'))!;
    await asItWas.getByRole('button', { name: `Go back to ${id}`, exact: true }).click();
    const t = saveSheet(p), back = t.locator('[data-save-review="restore"]');
    await expect(back.locator('[data-file]')).toHaveCount(1);
    await expect(back.locator('[data-file=".bowerloom/agents/tallyman.md"]')).toHaveAttribute('data-action', 'update');
    expect(readTree(def), 'nothing is written while the person reads').toEqual(saved);
    await back.locator('[data-approve-plan] input').check();
    await t.getByRole('button', { name: `Go back to ${id}`, exact: true }).click();
    await expect(t.locator('[data-version-kept]')).toBeVisible();
  });

  await test.step('2.7 the harness is byte for byte as it was before the change; the installed files stay as installed', async () => {
    expect(readTree(def)).toEqual(original);
    const loaded = loadDefinition(def);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.definition.entries.subagents.find(a => a.id === 'tallyman')?.skills ?? []).toEqual([]);
    expect(without(readTree(dir), '.bowerloom/'), 'a go-back does not touch the projected files').toEqual(afterInstall);
    // The Builder reads the folder again once the sheet closes: the link is gone.
    await saveSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(node(p, 'agent:tallyman')).toBeVisible();
    await expect(p.locator('[data-agent="tallyman"]').getByRole('checkbox', { name: 'knot-guide: tallyman' })).not.toBeChecked();
    await expect(p.locator('[data-draft]')).toContainText('No change yet.');
  });
});

// KNOWN FAILURE, found by this journey. The spec says "drags a skill to an agent". In a folder whose parts have no saved places, the Builder lays out a skill that is being dragged first:
// every other skill and every agent is placed below it (shared/harness/layout.ts, `graphOf`: the dragged skill's place raises the cursor for the others), so the agent runs away from the
// pointer and the drop misses. Playwright runs this test as an expected failure. When the Builder is fixed, the test passes, Playwright reports it, and `test.fail` is removed.
test('Journey 2, drag: dropping the skill knot-guide on the agent tallyman links them (known failure: the agent moves away while the skill is dragged)', async () => {
  test.fail(true, 'The agents are laid out below the dragged skill, so the drop misses. See the comment above.');
  test.setTimeout(120_000);
  const home = newMadeUpHome();
  h = await startApp(home, 'harnesses');
  await openInBuilder(h, home.rope, 'rope-yard');
  await dragSkillToAgent(h.page, 'knot-guide', 'tallyman');
  await expect(h.page.locator('[data-draft]')).toContainText('1 change, not saved yet.', { timeout: 3000 });
});
