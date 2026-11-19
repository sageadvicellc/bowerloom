// The page of the test build. A small screen over the same call path as the real app (page -> Tauri command -> sidecar pipe), so a WebdriverIO spec can click through
// launch, the folder pick, an adoption plan and run, the close guard and the saved read. The folder pick is answered by the test-only switch of the shell (`pick_folder`).
import '@wdio/tauri-plugin';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const $ = id => document.getElementById(id);
const say = (id, text) => { $(id).textContent = text; };
const call = async (method, ...args) => JSON.parse(await invoke('core_call', { name: 'main', method, args }));
const engine = (name, ...args) => call('engine', name, ...args);

const state = { folder: null, home: '', scan: '', plan: null, guard: false };

async function open(dir) {
  await call('engine.setNextFolder', dir);
  const answer = await engine('chooseFolder');
  if (!answer.ok) throw new Error(`chooseFolder: ${answer.refusal.code}`);
  return answer.value.id;
}

async function plan(id) {
  const first = await engine('planAdoption', id, { picks: {}, acknowledged: [] });
  if (!first.ok) throw new Error(`plan: ${first.refusal.code}`);
  const ack = first.value.unmapped.find(u => u.gate === 'acknowledge');
  const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: ack === undefined ? [] : [{ id: ack.id, hash: ack.hash }] };
  const view = await engine('planAdoption', id, choices);
  if (!view.ok) throw new Error(`plan: ${view.refusal.code}`);
  return { id, choices, revision: view.value.revision, approvals: view.value.approvals.map(a => ({ key: a.key, hash: a.hash })) };
}

const guarded = (id, run) => async () => { try { await run(); } catch (error) { say(id, `error ${error.code ?? error.message}`); } };

$('ping').addEventListener('click', guarded('ping-out', async () => { say('ping-out', (await call('ping')).pong ? 'pong' : 'no'); }));

$('pick').addEventListener('click', guarded('folder', async () => {
  const fixture = await invoke('pick_folder', { advance: true });
  state.folder = fixture.picked;
  state.home = fixture.home;
  say('folder', state.folder ?? 'none');
}));

$('plan').addEventListener('click', guarded('plan-out', async () => {
  state.planCalls = (state.planCalls ?? 0) + 1;
  $('plan').dataset.calls = String(state.planCalls);
  const id = await open(state.folder);
  state.plan = await plan(id);
  say('plan-out', `plan ${state.plan.revision.slice(0, 8)} approvals ${state.plan.approvals.length}`);
}));

$('run').addEventListener('click', guarded('run-out', async () => {
  const p = state.plan;
  const write = id => engine('runAdoption', id, p.revision, p.choices, p.approvals);
  let answer;
  try { answer = await write(p.id); } catch (error) {
    // The new core does not know the folder id. Open the folder again and send the same, old plan.
    if (error.code !== 'UNKNOWN_FOLDER') throw error;
    answer = await write(await open(state.folder));
  }
  say('run-out', answer.ok ? 'written' : answer.refusal.code);
}));

$('kill').addEventListener('click', guarded('kill-out', async () => {
  const before = (await invoke('core_info', { name: 'main' })).generation;
  await invoke('core_kill', { name: 'main' });
  await invoke('core_wait_ready', { name: 'main', after: before });
  say('kill-out', 'restarted');
}));

$('scan').addEventListener('click', guarded('scan-out', async () => {
  const kept = await call('scanKept', state.scan, state.home);
  say('scan-out', `${kept.items} items`);
}));

$('saved').addEventListener('click', guarded('saved-out', async () => {
  const saved = await call('scanSaved', state.home);
  say('saved-out', saved.status === 'saved' ? `saved ${saved.items}` : saved.status);
}));

$('guard').addEventListener('click', guarded('guard-out', async () => {
  state.guard = !state.guard;
  await invoke('set_close_guard', { on: state.guard });
  say('guard-out', state.guard ? 'on' : 'off');
}));

$('stay').addEventListener('click', () => { $('guard-dialog').hidden = true; });
$('leave').addEventListener('click', () => { invoke('close_window'); });

listen('close-guard', () => { $('guard-dialog').hidden = false; });

(async () => {
  try {
    const fixture = await invoke('pick_folder', { advance: false });
    state.home = fixture.home;
    state.scan = fixture.scan;
    await invoke('core_start', { name: 'main', home: state.home, timeoutMs: 30000 });
    say('status', 'ready');
  } catch (error) {
    say('status', `failed ${error.code ?? error.message}`);
  }
})();
