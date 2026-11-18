// The page of the Tauri spike. It runs the scenario named on the command line of the shell, and hands the result to the shell (`write_result`), which writes it to a file.
// Every call to the Node core goes page -> Tauri command -> sidecar pipe, the path the real app would use. Results have the same shape as the Electron scenarios (src/scenarios.mjs).
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const now = () => performance.now();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = [];
const violations = [];

document.addEventListener('securitypolicyviolation', e => violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));

const start = (name, home = '', timeoutMs = 30000) => invoke('core_start', { name, home, timeoutMs });
/** One call. The shell answers with the raw JSON text of the value; this parses it. A refusal rejects with `{ code, message }`. */
const call = async (name, method, ...args) => JSON.parse(await invoke('core_call', { name, method, args }));
const info = name => invoke('core_info', { name });
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');

const SCENARIOS = {
  async ping({ args }) {
    await start('main');
    const reply = await call('main', 'ping');
    return { sent: 1, returned: 1, pong: reply.pong === true, childPid: reply.pid, childIsNotShell: reply.pid !== args.pid, exePath: args.exe_path, childVersions: reply.versions };
  },

  async payload({ options }) {
    await start('main', options.home);
    const began = now();
    const text = await invoke('core_call', { name: 'main', method: 'scan', args: [options.picked, options.home] });
    const ms = Math.round(now() - began);
    const reply = JSON.parse(text);
    const json = JSON.stringify(reply.result);
    const bytes = new TextEncoder().encode(json).length;
    const counts = reply.result.counts;
    return { bytes, childBytes: reply.bytes, bytesMatch: bytes === reply.bytes, digestMatch: (await sha256(json)) === reply.digest, items: counts.skills + counts.agents + counts.tools + counts.hooks + counts.notes, counts, places: reply.places, ms, rawChars: text.length };
  },

  async events({ options }) {
    await listen('core-event', e => events.push(e.payload[1]));
    await start('main');
    const n = options.n;
    const reply = await call('main', 'events', n);
    // The events travel from the shell to the page apart from the answer, so wait until they are all here (or none arrives for 5 s).
    let last = events.length;
    let idle = 0;
    while (events.length < n && idle < 50) {
      await sleep(100);
      if (events.length === last) idle += 1; else { idle = 0; last = events.length; }
    }
    const unique = new Set(events);
    let inOrder = true;
    for (let i = 0; i < events.length; i += 1) if (events[i] !== i) { inOrder = false; break; }
    let missing = 0;
    for (let i = 0; i < n; i += 1) if (!unique.has(i)) missing += 1;
    return { n, sent: reply.sent, received: events.length, inOrder, duplicates: events.length - unique.size, missing };
  },

  async timeout({ options }) {
    const names = ['t1', 't2', 't3'];
    for (const name of names) await start(name, '', options.limitMs);
    const timed = async (name, method, ...args) => {
      const began = now();
      try { const value = await call(name, method, ...args); return { returned: true, ms: Math.round(now() - began), value }; } catch (error) { return { returned: false, code: error.code, ms: Math.round(now() - began) }; }
    };
    const results = await Promise.all([timed('t1', 'sleep', 1000), timed('t2', 'hang'), timed('t3', 'spin')]);
    let recoveredAfter = true;
    for (const name of names.slice(1)) {
      await invoke('core_wait_ready', { name, after: (await info(name)).generation - 1 });
      try { recoveredAfter = recoveredAfter && (await call(name, 'ping')).pong === true; } catch { recoveredAfter = false; }
    }
    const failed = results.filter(r => !r.returned);
    return { calls: results.length, returned: results.filter(r => r.returned).length, failedWithFAILED: failed.filter(r => r.code === 'FAILED').length, maxMs: Math.max(...failed.map(r => r.ms)), minFailMs: Math.min(...failed.map(r => r.ms)), returnedMs: results[0].ms, recoveredAfter };
  },

  async cycles({ options }) {
    await start('main');
    const timings = [];
    const pids = new Set([(await call('main', 'ping')).pid]);
    for (let i = 0; i < options.n; i += 1) {
      const began = now();
      const before = (await info('main')).generation;
      await invoke('core_kill', { name: 'main' });
      const after = await invoke('core_wait_ready', { name: 'main', after: before });
      const reply = await call('main', 'ping');
      pids.add(reply.pid);
      timings.push({ ms: Math.round(now() - began), newGeneration: after === before + 1, pong: reply.pong === true });
    }
    const times = timings.map(t => t.ms).sort((a, b) => a - b);
    return {
      n: options.n, recovered: timings.filter(t => t.pong && t.newGeneration).length, withinLimit: timings.filter(t => t.pong && t.ms <= options.limitMs).length, limitMs: options.limitMs,
      distinctChildren: pids.size, maxMs: times.at(-1), medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)], minMs: times[0],
    };
  },

  async inflight({ options }) {
    await start('main');
    const sentBefore = (await info('main')).sent_calls;
    const outcome = call('main', 'mark', options.marker, 60000).then(() => ({ code: 'returned' }), error => ({ code: error.code }));
    await sleep(400);
    const sent = (await info('main')).sent_calls - sentBefore;
    const before = (await info('main')).generation;
    await invoke('core_kill', { name: 'main' });
    const result = await outcome;
    await invoke('core_wait_ready', { name: 'main', after: before });
    const sentAfterRestart = (await info('main')).sent_calls;
    const ping = await call('main', 'ping');
    await sleep(1500);
    return { code: result.code, sentToChild: sent, newChildSawCall: (await info('main')).sent_calls - sentAfterRestart !== 1, pingAfter: ping.pong === true };
  },

  async planstate({ options }) {
    await start('main', options.home);
    const engine = (name, ...a) => call('main', 'engine', name, ...a);
    const open = async dir => { await call('main', 'engine.setNextFolder', dir); const answer = await engine('chooseFolder'); if (!answer.ok) throw new Error(`chooseFolder: ${answer.refusal.code}`); return answer.value.id; };
    const planOf = async id => {
      const first = await engine('planAdoption', id, { picks: {}, acknowledged: [] });
      if (!first.ok) throw new Error(`plan: ${first.refusal.code}`);
      const ack = first.value.unmapped.find(u => u.gate === 'acknowledge');
      const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: ack === undefined ? [] : [{ id: ack.id, hash: ack.hash }] };
      const view = await engine('planAdoption', id, choices);
      if (!view.ok) throw new Error(`plan: ${view.refusal.code}`);
      return { choices, revision: view.value.revision, approvals: view.value.approvals.map(a => ({ key: a.key, hash: a.hash })) };
    };
    const idA = await open(options.a);
    const planA = await planOf(idA);
    const control = await engine('runAdoption', idA, planA.revision, planA.choices, planA.approvals);
    const idB = await open(options.b);
    const planB = await planOf(idB);
    const before = (await info('main')).generation;
    await invoke('core_kill', { name: 'main' });
    await invoke('core_wait_ready', { name: 'main', after: before });
    let unknown = 'none';
    try { const r = await engine('runAdoption', idB, planB.revision, planB.choices, planB.approvals); unknown = r.ok ? 'ok' : r.refusal.code; } catch (error) { unknown = error.code; }
    const reopened = await open(options.b);
    const after = await engine('runAdoption', reopened, planB.revision, planB.choices, planB.approvals);
    return { controlWriteOk: control.ok === true, afterRestartUnknownFolder: unknown, afterRestartCode: after.ok ? 'ok' : after.refusal.code, sameFolderIdAfterReopen: reopened === idB };
  },

  /** Gate 2: the web features and the page scheme, in the real page of the app. */
  async 'webview-features'() {
    const stage = document.getElementById('stage');
    const features = {};
    const make = (tag, props = {}) => { const el = document.createElement(tag); Object.assign(el, props); return el; };

    const progress = step => invoke('write_result', { contents: JSON.stringify({ progress: step }) });
    await progress('container query');
    const cq = make('div', { id: 'cq' }); const kid = make('div', { className: 'kid' }); cq.append(kid); stage.append(cq);
    features.containerQuery = getComputedStyle(kid).width === '123px';

    const parent = make('div', { className: 'has-parent' }); stage.append(parent);
    const before = getComputedStyle(parent).width;
    parent.append(make('span', { className: 'has-child' }));
    features.has = before === '10px' && getComputedStyle(parent).width === '77px';

    const mix = make('div', { className: 'mix', textContent: 'x' }); stage.append(mix);
    const mixed = getComputedStyle(mix).color;
    features.colorMix = CSS.supports('color', 'color-mix(in srgb, red 50%, blue 50%)') && mixed !== '' && mixed !== 'rgb(0, 0, 0)' && !mixed.includes('255, 0, 0)');

    const blur = make('div', { className: 'blur' }); stage.append(blur);
    const bf = getComputedStyle(blur).backdropFilter || getComputedStyle(blur).webkitBackdropFilter;
    features.backdropFilter = (CSS.supports('backdrop-filter', 'blur(4px)') || CSS.supports('-webkit-backdrop-filter', 'blur(4px)')) && typeof bf === 'string' && bf !== 'none' && bf !== '';

    const balance = make('p', { className: 'balance', textContent: 'balanced text' }); stage.append(balance);
    features.textWrap = CSS.supports('text-wrap', 'balance') && getComputedStyle(balance).textWrap === 'balance';

    await progress('resize observer');
    const box = make('div'); box.style.width = '50px'; box.style.height = '10px'; stage.append(box);
    features.resizeObserver = await new Promise(resolve => {
      let seen = 0;
      const observer = new ResizeObserver(() => { seen += 1; if (seen === 2) { observer.disconnect(); resolve(true); } });
      observer.observe(box);
      setTimeout(() => { box.style.width = '80px'; }, 100);
      setTimeout(() => resolve(false), 3000);
    });

    await progress('web animations');
    const animated = make('div'); stage.append(animated);
    try {
      const animation = animated.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 50 });
      await Promise.race([animation.finished, sleep(3000).then(() => { throw new Error('never finished'); })]);
      features.webAnimations = animation.playState === 'finished';
    } catch { features.webAnimations = false; }

    const scheme = { protocol: location.protocol, origin: location.origin, secureContext: window.isSecureContext, notFile: location.protocol !== 'file:' };
    return { userAgent: navigator.userAgent, features, scheme };
  },

  /** Content security policy. Each attempt is blocked by the policy of the page, and the page sees one violation event for it. */
  async 'webview-csp'() {
    const stage = document.getElementById('stage');
    const make = (tag, props = {}) => { const el = document.createElement(tag); Object.assign(el, props); return el; };
    const countFor = directive => violations.filter(v => v.directive.startsWith(directive)).length;
    window.__inline = 0;
    stage.append(make('script', { textContent: 'window.__inline = 1;' }));
    const remoteScript = make('script', { src: 'https://example.invalid/x.js' }); stage.append(remoteScript);
    let fetchRefused = false;
    try { await fetch('https://example.invalid/'); } catch { fetchRefused = true; }
    const image = new Image(); image.src = 'https://example.invalid/i.png';
    await sleep(500);
    const csp = {
      inlineScriptBlocked: window.__inline !== 1 && countFor('script-src') >= 1,
      remoteScriptBlocked: violations.some(v => v.directive.startsWith('script-src') && v.blocked.includes('example.invalid')),
      remoteFetchBlocked: fetchRefused && violations.some(v => v.directive.startsWith('connect-src') && v.blocked.includes('example.invalid')),
      remoteImageBlocked: violations.some(v => v.directive.startsWith('img-src') && v.blocked.includes('example.invalid')),
      violations: violations.length,
    };
    return { csp, violationList: violations.slice(0, 8) };
  },

  /** Permission requests. Camera and microphone are not asked: a prompt there could open a system dialog. Each step writes its name first, so a step that stalls is named in the result file. */
  async 'webview-permissions'() {
    const progress = step => invoke('write_result', { contents: JSON.stringify({ progress: step }) });
    const permissions = {};
    await progress('query');
    try { permissions.geolocation = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (error) { permissions.geolocation = `unavailable: ${error.name}`; }
    await progress('geolocation');
    permissions.geolocationRefused = await new Promise(resolve => {
      if (!navigator.geolocation) { resolve(true); return; }
      navigator.geolocation.getCurrentPosition(() => resolve(false), () => resolve(true), { timeout: 4000 });
      setTimeout(() => resolve(true), 6000);
    });
    permissions.notifications = typeof Notification === 'undefined' ? 'unavailable' : Notification.permission;
    await progress('clipboard');
    // A read that waits for a person (WebKit shows a paste bubble) and never answers counts as not granted. It is recorded.
    permissions.clipboardRead = await Promise.race([navigator.clipboard.readText().then(() => 'granted', () => 'refused'), sleep(3000).then(() => 'no answer in 3 s')]);
    permissions.clipboardReadRefused = permissions.clipboardRead !== 'granted';
    await progress('window.open');
    permissions.windowOpenRefused = window.open('https://example.invalid/') === null;
    return { permissions };
  },

  /** A WebGL 2 context, one shader program, one frame: a full-screen triangle in red, read back from the frame. */
  async webgl() {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const gl = canvas.getContext('webgl2');
    if (gl === null) return { context: false };
    const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null; };
    const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }');
    const fragment = compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0, 0.0, 0.0, 1.0); }');
    const program = gl.createProgram();
    if (vertex && fragment) { gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); }
    const linked = Boolean(vertex && fragment) && gl.getProgramParameter(program, gl.LINK_STATUS);
    const pixel = new Uint8Array(4);
    if (linked) {
      gl.useProgram(program);
      gl.viewport(0, 0, 8, 8);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { context: true, shadersCompiled: Boolean(vertex && fragment), linked, pixel: [...pixel], version: gl.getParameter(gl.VERSION), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), glError: gl.getError() };
  },

  async hold() { await start('main'); await invoke('report_pids', { name: 'main' }); return null; },
  async 'hold-stuck'() { await start('main'); await invoke('report_pids', { name: 'main' }); call('main', 'spin').catch(() => {}); return null; },
  async quit() { await start('main'); await invoke('report_pids', { name: 'main' }); await sleep(300); await invoke('quit_app'); return null; },
  async crash() { await start('main'); await invoke('report_pids', { name: 'main' }); await sleep(300); await invoke('crash_app'); return null; },
};

(async () => {
  const args = await invoke('app_args');
  if (!args.scenario) return;
  const run = SCENARIOS[args.scenario];
  let result;
  try {
    if (run === undefined) throw new Error(`unknown scenario ${args.scenario}`);
    // A scenario that does not end in 90 s is a failure that names itself, so a test never waits for ever.
    result = await Promise.race([run({ args, options: JSON.parse(args.options) }), sleep(90000).then(() => { throw new Error(`scenario ${args.scenario} did not end in 90 s`); })]);
  } catch (error) {
    result = { error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : JSON.stringify(error) };
  }
  // The holding scenarios wrote their own result (the process ids) and wait for the test.
  if (result !== null) {
    await invoke('write_result', { contents: JSON.stringify(result) });
    await invoke('quit_app');
  }
})();
