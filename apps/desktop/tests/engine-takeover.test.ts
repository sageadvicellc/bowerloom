// Definition spec section 12, check 1, in the app: an install on a folder whose files already hold what Bowerloom would write takes them over. The app
// shows each as taken over, counts only the files it writes in main's own dialog, reports them as taken over and not written, and a removal leaves them
// as they are. Main still asks before every write that is not a no-op. Synthetic folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { ASK } from '../main/engine-consent.js';
import { writesFile } from '../shared/engine/types.js';
import type { Answer, ProjectAnswer, ProjectInput, ProjectView } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-28T12:00:00Z');
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code} ${a.refusal.message}`); return a.value; };
const planOf = (a: ProjectAnswer): ProjectView => { assert.equal(a.kind, 'plan'); return (a as Extract<ProjectAnswer, { kind: 'plan' }>).plan; };
const put = (dir: string, rel: string, text: string): void => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); chmodSync(join(dir, rel), 0o644); };
const stamp = (p: string): string => { const s = statSync(p, { bigint: true }); return `${s.ino}:${s.mtimeNs}:${readFileSync(p).toString('base64')}`; };

interface Asked { title: string; message: string; detail: string }
function setup(t: test.TestContext, dir: (home: string) => string): { service: EngineService; dir: string; asked: Asked[] } {
  const home = homeFolder(tempDir(t, 'bowerloom-takeover-'));
  const folder = dir(home), asked: Asked[] = [];
  const service = createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => folder, who: 'tester', now: () => WHEN,
    confirm: async q => { asked.push(q); return true; },
  });
  return { service, dir: folder, asked };
}
/** Plans with every line the plan needs approved, as a person ticks them. */
async function planned(service: EngineService, id: string, base: ProjectInput): Promise<{ input: ProjectInput; plan: ProjectView }> {
  let a = value(await service.planProjection(id, base)), input = base;
  if (a.kind === 'approve') { input = { ...base, approve: a.lines.map(l => l.key) }; a = value(await service.planProjection(id, input)); }
  return { input, plan: planOf(a) };
}

const SKILL = '---\nname: review\ndescription: Reviews a change.\n---\n\nReview it.\n';
const TAKEN = ['.agents/skills/review/SKILL.md', '.claude/skills/review/SKILL.md', 'AGENTS.md'];

test('check 1: the app shows taken-over files as taken over, counts only written files in its dialog, and reports them as taken over, not written', async t => {
  const { service, dir, asked } = setup(t, home => {
    const d = definedFolder(home);
    put(d, 'AGENTS.md', '# Demo\n\nUse npm.\n'); put(d, '.claude/skills/review/SKILL.md', SKILL); put(d, '.agents/skills/review/SKILL.md', SKILL);
    return d;
  });
  const id = value(await service.chooseFolder()).id, label = (await service.folders())[0]!.label;
  const before = Object.fromEntries(TAKEN.map(p => [p, stamp(join(dir, p))]));
  const { input, plan } = await planned(service, id, { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] });
  assert.deepEqual(plan.changes.filter(c => c.action === 'take-over').map(c => c.path), TAKEN);
  assert.deepEqual(plan.takenOver.filter(x => x.entry === null).map(x => x.path), TAKEN);
  const writes = plan.changes.filter(writesFile).length;
  assert.ok(writes > 0 && writes === plan.changes.length - TAKEN.length, 'every other path of this plan writes');
  const done = value(await service.runProjection(id, plan.revision, input));
  assert.deepEqual(asked.at(-1), ASK.projection(label, writes, plan.revision), 'the dialog counts only the files written');
  assert.deepEqual(done.takenOver, TAKEN);
  assert.ok(TAKEN.every(p => !done.written.includes(p)), 'a taken-over file is not reported as written');
  assert.equal(done.written.length, writes);
  for (const p of TAKEN) assert.equal(stamp(join(dir, p)), before[p], `${p} is not written`);
  // Removal leaves each taken-over file as it is: the view calls it keep, the dialog does not count it, and the result lists it as kept.
  const removal = value(await service.planRemoval(id));
  assert.deepEqual(removal.changes.filter(c => c.action === 'keep').map(c => c.path), TAKEN);
  const removed = value(await service.runRemoval(id, removal.revision));
  const restores = removal.changes.filter(c => c.action === 'restore').length, deletes = removal.changes.filter(c => c.action === 'delete').length;
  assert.deepEqual(asked.at(-1), ASK.removal(label, deletes, restores, removal.revision));
  assert.deepEqual(removed.kept, TAKEN);
  assert.ok(TAKEN.every(p => !removed.restored.includes(p)));
  for (const p of TAKEN) assert.equal(stamp(join(dir, p)), before[p], `${p} stays as it is`);
});

test('check 1: a plan that only takes files over still asks, as a record update; only a no-op plan skips main\'s dialog', async t => {
  const { service, asked } = setup(t, home => {
    const d = join(home, 'Projects', 'prompt-only');
    put(d, '.bowerloom/harness.json', JSON.stringify({ format: 'bowerloom/harness/v1beta1', id: 'demo', description: 'A demo harness.', engines: [{ id: 'codex' }], parts: { 'system-prompt': 'instructions/AGENTS.md' } }, null, 2) + '\n');
    put(d, '.bowerloom/instructions/AGENTS.md', '# Demo\n\nUse npm.\n');
    put(d, 'AGENTS.md', '# Demo\n\nUse npm.\n');
    return d;
  });
  const id = value(await service.chooseFolder()).id, label = (await service.folders())[0]!.label;
  const { input, plan } = await planned(service, id, { engines: ['codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] });
  assert.deepEqual(plan.changes.map(c => [c.path, c.action]), [['AGENTS.md', 'take-over']]);
  assert.equal(plan.noop, false);
  const done = value(await service.runProjection(id, plan.revision, input));
  assert.deepEqual(asked.at(-1), ASK.record(label, plan.revision));
  assert.deepEqual([done.written, done.takenOver], [[], ['AGENTS.md']]);
  const count = asked.length;
  const again = await planned(service, id, input);
  assert.equal(again.plan.noop, true);
  const second = value(await service.runProjection(id, again.plan.revision, input));
  assert.equal(second.noop, true);
  assert.equal(asked.length, count, 'a no-op plan writes nothing and asks nothing');
});
