// The scenarios of Gate 1 Part C. Each one runs inside the Electron main process, uses the host, and returns plain counts. The numbers that the plan marks "proposal"
// come in through `options`; this file holds no approved number.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineFolder, filesOf } from './engine-folders.mjs';

const now = () => performance.now();

export const SCENARIOS = {
  /** 1 ping. */
  async ping({ host }) {
    const reply = await host.call('ping');
    const pick = v => ({ electron: v.electron, node: v.node, chrome: v.chrome, v8: v.v8 });
    return { sent: 1, returned: 1, pong: reply.pong === true, childPid: reply.pid, childIsNotMain: reply.pid !== process.pid, execPath: process.execPath, versions: pick(process.versions), childVersions: reply.versions };
  },

  /** The scan result comes back whole: the size and the SHA-256 that the child computed equal the ones the main process computes on what it received. */
  async payload({ host, options }) {
    const began = now();
    const reply = await host.call('scan', options.picked, options.home);
    const ms = Math.round(now() - began);
    const json = JSON.stringify(reply.result);
    const bytes = Buffer.byteLength(json);
    const digest = createHash('sha256').update(json).digest('hex');
    const counts = reply.result.counts;
    return { bytes, childBytes: reply.bytes, bytesMatch: bytes === reply.bytes, digestMatch: digest === reply.digest, items: counts.skills + counts.agents + counts.tools + counts.hooks + counts.notes, counts, places: reply.places, ms };
  },

  /** `n` numbered events, in order and once each. */
  async events({ host, options, events }) {
    const n = options.n;
    const reply = await host.call('events', n);
    const seen = events.splice(0);
    const unique = new Set(seen);
    let inOrder = true;
    for (let i = 0; i < seen.length; i += 1) if (seen[i] !== i) { inOrder = false; break; }
    let missing = 0;
    for (let i = 0; i < n; i += 1) if (!unique.has(i)) missing += 1;
    return { n, sent: reply.sent, received: seen.length, inOrder, duplicates: seen.length - unique.size, missing };
  },

  /** A call that returns, a call that never answers and a call on a child that is stuck in a loop. The two stuck calls must fail with FAILED at the limit, and the children must come back. */
  async timeout({ makeHost, options }) {
    const limitMs = options.limitMs;
    const hosts = [await makeHost({ callTimeoutMs: limitMs }), await makeHost({ callTimeoutMs: limitMs }), await makeHost({ callTimeoutMs: limitMs })];
    const timed = async (host, method, ...args) => {
      const began = now();
      try { const value = await host.call(method, ...args); return { returned: true, ms: Math.round(now() - began), value }; } catch (error) { return { returned: false, code: error.code, ms: Math.round(now() - began) }; }
    };
    const results = await Promise.all([timed(hosts[0], 'sleep', 1000), timed(hosts[1], 'hang'), timed(hosts[2], 'spin')]);
    let recoveredAfter = true;
    for (const host of hosts.slice(1)) {
      await host.whenReady();
      try { recoveredAfter = recoveredAfter && (await host.call('ping')).pong === true; } catch { recoveredAfter = false; }
    }
    const failed = results.filter(r => !r.returned);
    return {
      calls: results.length, returned: results.filter(r => r.returned).length, failedWithFAILED: failed.filter(r => r.code === 'FAILED').length,
      maxMs: Math.max(...failed.map(r => r.ms)), minFailMs: Math.min(...failed.map(r => r.ms)), returnedMs: results[0].ms, recoveredAfter,
    };
  },

  /** `n` kills of the child in a row. Each cycle ends when the new child has answered a ping. */
  async cycles({ host, options }) {
    const timings = [];
    const pids = new Set([(await host.call('ping')).pid]);
    for (let i = 0; i < options.n; i += 1) {
      const began = now();
      const before = host.generation;
      host.killChild();
      await host.whenReady();
      const reply = await host.call('ping');
      const ms = Math.round(now() - began);
      pids.add(reply.pid);
      timings.push({ ms, newGeneration: host.generation === before + 1, pong: reply.pong === true });
    }
    const times = timings.map(t => t.ms).sort((a, b) => a - b);
    return {
      n: options.n, recovered: timings.filter(t => t.pong && t.newGeneration).length, withinLimit: timings.filter(t => t.pong && t.ms <= options.limitMs).length, limitMs: options.limitMs,
      distinctChildren: pids.size, maxMs: times.at(-1), medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)], minMs: times[0],
    };
  },

  /** A call is running in the child when the child is killed. It fails with FAILED, and nothing runs it again. */
  async inflight({ host, options }) {
    const work = mkdtempSync(join(tmpdir(), 'stage1-inflight-'));
    const marker = join(work, 'marker.txt');
    writeFileSync(marker, '');
    const sentBefore = host.sentCalls;
    const call = host.call('mark', marker, 60000).then(() => ({ code: 'returned' }), error => ({ code: error.code }));
    await new Promise(resolve => setTimeout(resolve, 400));
    const sent = host.sentCalls - sentBefore;
    host.killChild();
    const outcome = await call;
    await host.whenReady();
    const before = host.sentCalls;
    const ping = await host.call('ping');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const markerLines = readFileSync(marker, 'utf8').split('\n').filter(Boolean).length;
    rmSync(work, { recursive: true, force: true });
    return { code: outcome.code, markerLines, sentToChild: sent, newChildSawCall: host.sentCalls - before !== 1, pingAfter: ping.pong === true };
  },

  /**
   * The plan shown last. Folder A: plan, then write: the write runs (control). Folder B: plan, kill the child, restart, then write with the plan the old child showed:
   * first with the old folder id (unknown to the new child), then after the folder is opened again. That write must return NOT_THE_PLAN_SHOWN and change nothing.
   */
  async planstate({ host, options }) {
    const engine = (name, ...args) => host.call('engine', name, ...args);
    const open = async dir => { await host.call('engine.setNextFolder', dir); const a = await engine('chooseFolder'); if (!a.ok) throw new Error(`chooseFolder: ${a.refusal.code}`); return a.value.id; };
    const planOf = async id => {
      const first = await engine('planAdoption', id, { picks: {}, acknowledged: [] });
      if (!first.ok) throw new Error(`plan: ${first.refusal.code}`);
      const ack = first.value.unmapped.find(u => u.gate === 'acknowledge');
      const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: ack === undefined ? [] : [{ id: ack.id, hash: ack.hash }] };
      const view = await engine('planAdoption', id, choices);
      if (!view.ok) throw new Error(`plan: ${view.refusal.code}`);
      return { choices, revision: view.value.revision, approvals: view.value.approvals.map(a => ({ key: a.key, hash: a.hash })) };
    };
    const a = engineFolder(options.home, 'a');
    const idA = await open(a);
    const planA = await planOf(idA);
    const control = await engine('runAdoption', idA, planA.revision, planA.choices, planA.approvals);

    const b = engineFolder(options.home, 'b');
    const idB = await open(b);
    const planB = await planOf(idB);
    const before = filesOf(b);
    host.killChild();
    await host.whenReady();
    let unknown = 'none';
    try { const r = await engine('runAdoption', idB, planB.revision, planB.choices, planB.approvals); unknown = r.ok ? 'ok' : r.refusal.code; } catch (error) { unknown = error.code; }
    const reopened = await open(b);
    const after = await engine('runAdoption', reopened, planB.revision, planB.choices, planB.approvals);
    const afterCode = after.ok ? 'ok' : after.refusal.code;
    return {
      controlWriteOk: control.ok === true, afterRestartUnknownFolder: unknown, afterRestartCode: afterCode,
      folderUnchanged: JSON.stringify(filesOf(b)) === JSON.stringify(before), sameFolderIdAfterReopen: reopened === idB,
    };
  },
};

/** The scenarios that report process ids and then wait, so a test can end the main process in a chosen way. */
export const HOLDERS = new Set(['hold', 'quit', 'crash']);

export function reportPids({ host, out }) {
  writeFileSync(out, JSON.stringify({ mainPid: process.pid, childPid: host.childPid, ready: true }));
}
