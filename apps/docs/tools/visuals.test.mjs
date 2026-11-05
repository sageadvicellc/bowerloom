import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execSync} from 'node:child_process';
import {existsSync, realpathSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {applyVisuals, terminalCopyText, readVisualManifest, renderVisualHtml, commandsFromPanel, themeFiles} from '../src/lib/visuals.mjs';
import {prepareVisualSource, createDocsRenderer, searchIndexes} from '../src/lib/content.mjs';

const manifest = JSON.parse(await readFile(new URL('./fixtures/visuals-manifest.json', import.meta.url), 'utf8'));
const shotLine = '::visual{id="app-builder"}';
const termLine = '::visual{id="cli-plan"}';
const page = 'start.md';
const html = (text, file = page) => applyVisuals(text, {file, manifest, mode: 'html'});
const plain = (text, file = page) => applyVisuals(text, {file, manifest, mode: 'text'});

test('a shot directive renders a figure with both theme images, sizes, caption, and an Enlarge button', () => {
  const out = html(shotLine);
  assert.match(out, /^<figure class="visual visual-shot" data-visual="app-builder"/);
  assert.match(out, /<img [^>]*data-shot-theme="light" src="\/docs\/visuals\/app-builder-light\.webp" width="2200" height="1375" alt="The builder screen with a team of three agents\."[^>]*loading="lazy"/);
  assert.match(out, /<img [^>]*data-shot-theme="dark" src="\/docs\/visuals\/app-builder-dark\.webp" width="2200" height="1375"/);
  assert.match(out, /<figcaption class="visual-meta"><span class="visual-caption">Build a team in the app\.<\/span>/);
  assert.match(out, /<button type="button" class="visual-enlarge" hidden aria-haspopup="dialog"/);
  assert.equal(out.split('<img').length - 1, 2);
});
test('a terminal directive renders a labelled code sample with a title bar, lines, caption, and buttons', () => {
  const out = html(termLine);
  assert.match(out, /^<figure class="visual visual-terminal" data-visual="cli-plan" role="group" aria-label="Terminal sample: bowerloom plan">/);
  assert.match(out, /<span class="vt-title">bowerloom plan<\/span>/);
  assert.match(out, /<button type="button" class="vt-copy" hidden aria-label="Copy the commands from bowerloom plan">Copy<\/button>/);
  assert.match(out, /<pre class="vt-body" tabindex="0"><code>/);
  assert.match(out, /<samp class="vt-line vt-cmd">bowerloom plan<\/samp>/);
  assert.match(out, /<samp class="vt-line vt-err">warning: no harness signed in<\/samp>/);
  assert.match(out, /Plan: 2 steps &lt;ready&gt; &amp; waiting/);
  assert.match(out, /<figcaption class="visual-meta"><span class="visual-caption">The plan lists each step before anything runs\.<\/span>/);
  assert.match(out, /class="visual-enlarge" hidden/);
});
test('the rendered block has no blank line, so Markdown keeps it as one HTML block', () => {
  for (const line of [shotLine, termLine]) assert.doesNotMatch(html(line), /\n\s*\n/);
});
test('the terminal copy text holds the commands and nothing else', () => {
  assert.equal(terminalCopyText(manifest.terminals['cli-plan']), 'bowerloom plan\nbowerloom apply --dry-run');
  assert.equal(terminalCopyText({lines: [{kind: 'out', text: 'x'}]}), '');
});
test('commandsFromPanel reads the same commands from the rendered markup', () => {
  const out = html(termLine);
  const cmds = [...out.matchAll(/<samp class="vt-line vt-cmd">([^<]*)<\/samp>/g)].map(m => m[1]);
  assert.deepEqual(cmds, terminalCopyText(manifest.terminals['cli-plan']).split('\n'));
  const fake = {querySelectorAll: selector => selector === '.vt-cmd' ? cmds.map(textContent => ({textContent})) : []};
  assert.equal(commandsFromPanel(fake), terminalCopyText(manifest.terminals['cli-plan']));
});
test('an unknown id fails with the page and the id named', () => {
  assert.throws(() => html('Text\n\n::visual{id="no-such-shot"}\n', 'guides/team.md'), error => {
    assert.match(error.message, /guides\/team\.md/);
    assert.match(error.message, /no-such-shot/);
    assert.match(error.message, /app-builder/, 'lists known ids');
    return true;
  });
  assert.throws(() => plain('::visual{id="no-such-shot"}', 'x.md'), error => /x\.md/.test(error.message) && /no-such-shot/.test(error.message));
});
test('a malformed directive fails instead of rendering as plain text', () => {
  for (const bad of ['::visual{id=app-builder}', '::visual{id="App Builder"}', '::visual', '::visual{id="app-builder" size="big"}'])
    assert.throws(() => html(bad), /Malformed visual directive/, bad);
});
test('with no manifest, a page with no visuals builds and a page with one fails', () => {
  const empty = {shots: {}, terminals: {}};
  assert.equal(applyVisuals('No visuals here.', {file: 'a.md', manifest: empty, mode: 'html'}), 'No visuals here.');
  assert.throws(() => applyVisuals(shotLine, {file: 'a.md', manifest: empty, mode: 'html'}), error => /a\.md/.test(error.message) && /app-builder/.test(error.message));
});
test('a missing manifest file reads as an empty manifest', async () => {
  assert.deepEqual(await readVisualManifest(new URL('./fixtures/none.json', import.meta.url)), {shots: {}, terminals: {}});
});
test('a directive inside a code fence is left as written', () => {
  const fenced = '```md\n' + shotLine + '\n```\n';
  assert.equal(html(fenced), fenced);
  assert.equal(plain(fenced), fenced);
});
test('the text form shows a short line for a shot and a fenced block for a terminal', () => {
  assert.equal(plain(shotLine), '[Screenshot: The builder screen with a team of three agents.] Build a team in the app.');
  const text = plain(`Before\n\n${termLine}\n\nAfter`);
  const body = manifest.terminals['cli-plan'].lines.map(l => (l.kind === 'cmd' ? '$ ' : '') + l.text).join('\n');
  assert.equal(text, `Before\n\nThe plan lists each step before anything runs.\n\n\`\`\`text\n${body}\n\`\`\`\n\nAfter`);
  assert.doesNotMatch(text, /::visual|<figure|<span/);
});
test('the text form widens its fence when a line holds backticks', () => {
  const tricky = {shots: {}, terminals: {t: {title: 't', caption: 'c', lines: [{kind: 'out', text: '```'}]}}};
  const text = applyVisuals('::visual{id="t"}', {file: 'a.md', manifest: tricky, mode: 'text'});
  assert.match(text, /^c\n\n````text\n```\n````$/);
});
test('a visual in a page reaches the markdown, the llms text, and search as text and the page as HTML', async () => {
  const source = `---\n---\n\n# Heading\n\nIntro.\n\n${shotLine}\n\n## Next\n\n${termLine}\n`;
  const prepared = prepareVisualSource(source.replace(/^---\n---\n\n/, ''), {file: 'start.md', manifest});
  assert.doesNotMatch(prepared.text, /::visual|<figure|<img|<pre/);
  assert.match(prepared.text, /\[Screenshot: The builder screen/);
  assert.match(prepared.text, /```text\n\$ bowerloom plan/);
  const renderer = await createDocsRenderer();
  const rendered = await renderer.render(prepared.htmlSource);
  assert.equal(rendered.code.split('<figure').length - 1, 2);
  assert.equal(rendered.code.split('<img ').length - 1, 2, 'the shot is an img with no script');
  assert.match(rendered.code, /<pre class="vt-body" tabindex="0"><code>/, 'the terminal is a pre with no script');
  assert.doesNotMatch(rendered.code, /::visual/);
  assert.equal(rendered.metadata.headings.length, 2);
  const doc = {hidden: false, title: 'Start', description: '', url: '/docs/start/', body: prepared.text, markdown: prepared.text, headings: rendered.metadata.headings};
  const entries = searchIndexes([doc]);
  assert(entries.length >= 2);
  assert(entries.every(entry => !/::visual|<figure|<img|<span/.test(entry.content)));
});
test('terminal colors pass 4.5:1 in both themes', async () => {
  const css = await readFile(new URL('../src/styles/visuals.css', import.meta.url), 'utf8');
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const read = block => Object.fromEntries([...block.matchAll(/--(vt-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
  const light = read(css.match(/\.vt-panel\s*\{([^}]*)\}/)[1]);
  const dark = read(css.match(/\[data-theme='dark'\]\s*\.vt-panel\s*\{([^}]*)\}/)[1]);
  for (const [name, colors] of [['light', light], ['dark', dark]])
    for (const key of ['vt-fg', 'vt-out', 'vt-err', 'vt-prompt', 'vt-title'])
      assert(ratio(colors[key], colors['vt-bg']) >= 4.5, `${name} ${key} ${ratio(colors[key], colors['vt-bg']).toFixed(2)}`);
  assert(ratio(dark['vt-title'], dark['vt-bar']) >= 4.5 && ratio(light['vt-title'], light['vt-bar']) >= 4.5, 'title on the bar');
});
test('every shot in the real manifest has a light and a dark file', async t => {
  const real = await readVisualManifest();
  const ids = Object.keys(real.shots);
  if (!ids.length) return t.skip('no real manifest or no shots yet');
  for (const id of ids) for (const file of themeFiles(id)) {
    const info = await stat(new URL(`../public/visuals/${file}`, import.meta.url)).catch(() => null);
    assert(info?.isFile(), `missing public/visuals/${file}`);
  }
});
test('every real terminal and shot renders', async () => {
  const real = await readVisualManifest();
  for (const id of [...Object.keys(real.shots), ...Object.keys(real.terminals)]) assert.match(renderVisualHtml(id, real), /<figure /);
});

// Real-browser checks, as the landing tests do. Skips with a reason when no Playwright is found; fails in CI.
const require = createRequire(import.meta.url);
function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_CORE_PATH];
  candidates.push(join(dirname(process.execPath), '../lib/node_modules/@playwright/cli/node_modules/playwright-core'));
  try { candidates.push(join(realpathSync(execSync('which playwright-cli', {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()), '../../node_modules/playwright-core')); } catch { /* none */ }
  try { candidates.push(join(execSync('npm root -g', {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(), '@playwright/cli/node_modules/playwright-core')); } catch { /* none */ }
  for (const path of candidates) { if (!path || !existsSync(path)) continue; try { return require(path).chromium; } catch { /* next */ } }
  return null;
}
const chromium = loadChromium();
let skipReason = chromium ? null : 'no Playwright was found (set PLAYWRIGHT_CORE_PATH)';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const fixturePage = body => `<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}:root{--brand-ground:#F6EEE8;--brand-surface:#FFF9F4;--brand-ink:#373A32;--brand-muted:#655D61;--brand-line:#D5C9C8;--brand-action:#80515B;--brand-action-ink:#FFF9F4}:root[data-theme=dark]{--brand-ground:#27262B;--brand-surface:#343238;--brand-ink:#F6EEE8;--brand-muted:#D0BEC6;--brand-line:#665B63;--brand-action:#E8B3BF;--brand-action-ink:#27262B}body{margin:0;background:var(--brand-ground);color:var(--brand-ink)}</style><link rel="stylesheet" href="/src/styles/visuals.css?direct"><script type="module">import {mountVisuals} from '/src/lib/visuals-client.mjs';mountVisuals(document.body,document,{base:''});</script></head><body><main class="docs-prose">${body}</main></body></html>`;
async function withFixture(run) {
  const requests = [];
  const server = await createServer({root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', server: {host: '127.0.0.1', port: 0, hmr: false, watch: null}, plugins: [{
    name: 'visual-fixture',
    configureServer(s) {
      s.middlewares.use((request, response, next) => {
        if (request.url.startsWith('/visuals/')) { requests.push(request.url); response.setHeader('content-type', 'image/png'); response.end(PNG); return; }
        if (request.url.startsWith('/__fixture')) {
          const body = `${applyVisuals(shotLine, {file: page, manifest, mode: 'html', base: ''})}\n${applyVisuals(termLine, {file: page, manifest, mode: 'html', base: ''})}`;
          s.transformIndexHtml('/__fixture', fixturePage(body)).then(text => { response.setHeader('content-type', 'text/html'); response.end(text); });
          return;
        }
        next();
      });
    },
  }]});
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined});
    await run({url: `http://127.0.0.1:${server.httpServer.address().port}/__fixture`, browser, requests}); }
  finally { await browser?.close(); await server.close(); }
}
const dom = (name, run) => test(name, async context => {
  if (skipReason) { if (process.env.CI) assert.fail(`CI needs a browser: ${skipReason}`); return context.skip(skipReason); }
  try { await withFixture(run); } catch (error) { if (/Executable doesn't exist|browserType\.launch/.test(String(error.message))) return context.skip('Chromium is not installed for Playwright'); throw error; }
});
const open = async (browser, url, options = {}) => {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, ...options});
  const tab = await context.newPage();
  await tab.goto(url);
  return {context, tab};
};

dom('only the current theme loads, and the buttons appear once the script runs', async ({browser, url, requests}) => {
  const {context, tab} = await open(browser, url);
  await tab.waitForSelector('.visual-enlarge:not([hidden])');
  await tab.locator('.visual-shot').scrollIntoViewIfNeeded();
  await tab.waitForLoadState('networkidle');
  assert(requests.some(r => r.includes('app-builder-light')));
  assert(!requests.some(r => r.includes('app-builder-dark')), requests.join());
  assert.equal(await tab.locator('.visual-shot img[data-shot-theme=light]').isVisible(), true);
  assert.equal(await tab.locator('.visual-shot img[data-shot-theme=dark]').isVisible(), false);
  await context.close();
});
dom('without JavaScript a shot is an image, a terminal is a pre, and the buttons stay hidden', async ({browser, url}) => {
  const {context, tab} = await open(browser, url, {javaScriptEnabled: false});
  assert.equal(await tab.locator('.visual-shot img[data-shot-theme=light]').isVisible(), true);
  assert.equal(await tab.locator('.vt-body').isVisible(), true);
  assert.equal(await tab.locator('.visual-enlarge').first().isVisible(), false);
  assert.equal(await tab.locator('.vt-copy').isVisible(), false);
  await context.close();
});
dom('the shot opens in the framed viewer, loads both themes, traps Tab, closes on Escape and returns the focus', async ({browser, url, requests}) => {
  const {context, tab} = await open(browser, url);
  const button = tab.locator('.visual-shot .visual-enlarge');
  await button.focus();
  await button.press('Enter');
  const dialog = tab.locator('dialog.visual-dialog[open]');
  await dialog.waitFor();
  assert.equal(await dialog.locator('img').count(), 2 + 2, 'two shots and two plants');
  const frame = await tab.evaluate(() => getComputedStyle(document.querySelector('dialog.visual-dialog .visual-device'), '::after').borderImageSource);
  assert.match(frame, /frame-light\.webp/);
  await tab.keyboard.press('Tab'); await tab.keyboard.press('Tab');
  assert.equal(await tab.evaluate(() => document.activeElement?.closest('dialog') !== null), true, 'focus stays inside');
  await tab.keyboard.press('Escape');
  await tab.waitForSelector('dialog.visual-dialog[open]', {state: 'detached'});
  assert.equal(await tab.evaluate(() => document.activeElement?.className), 'visual-enlarge');
  assert(requests.some(r => r.includes('app-builder-dark')), 'the second theme loads on first open');
  await context.close();
});
dom('the dark theme shows the dark shot and the dark frame', async ({browser, url}) => {
  const {context, tab} = await open(browser, url);
  await tab.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.equal(await tab.locator('.visual-shot img[data-shot-theme=dark]').isVisible(), true);
  await tab.locator('.visual-shot .visual-enlarge').click();
  const frame = await tab.evaluate(() => getComputedStyle(document.querySelector('dialog.visual-dialog .visual-device'), '::after').borderImageSource);
  assert.match(frame, /frame-dark\.webp/);
  assert.equal(await tab.locator('dialog[open] .visual-full:visible').count(), 1);
  await context.close();
});
dom('a click on the backdrop closes the viewer and a terminal sits in the frame', async ({browser, url}) => {
  const {context, tab} = await open(browser, url);
  await tab.locator('.visual-terminal .visual-enlarge').click();
  const dialog = tab.locator('dialog.visual-dialog[open]');
  await dialog.waitFor();
  assert.equal(await dialog.locator('.vt-panel').count(), 1);
  assert.equal(await dialog.locator('.vt-body').count(), 1);
  assert.equal(await tab.locator('.visual-terminal .vt-panel').count(), 1, 'the page keeps its own panel');
  await tab.mouse.click(4, 4);
  await tab.waitForSelector('dialog.visual-dialog[open]', {state: 'detached'});
  await context.close();
});
dom('the Copy button copies only the commands, and a selection leaves the prompt out', async ({browser, url}) => {
  const {context, tab} = await open(browser, url);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: new URL(url).origin}).catch(() => {});
  await tab.locator('.vt-copy').click();
  assert.equal(await tab.evaluate(() => navigator.clipboard.readText()), 'bowerloom plan\nbowerloom apply --dry-run');
  assert.match(await tab.locator('.vt-copy').innerText(), /Copied/);
  const selected = await tab.evaluate(() => { const code = document.querySelector('.vt-body code'); getSelection().selectAllChildren(code); return getSelection().toString(); });
  assert.doesNotMatch(selected, /^\$ /m);
  assert.match(selected, /^bowerloom plan$/m);
  assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('.vt-cmd'), '::before').content), '"$ "');
  await context.close();
});
dom('on a phone the page does not scroll sideways, and a long line scrolls inside the panel', async ({browser, url}) => {
  const {context, tab} = await open(browser, url, {viewport: {width: 390, height: 800}, isMobile: true});
  const wide = await tab.evaluate(() => [document.documentElement.scrollWidth, ...[...document.querySelectorAll('body *')].filter(n => n.getBoundingClientRect().right > 391).map(n => n.tagName + '.' + n.className + ':' + Math.round(n.getBoundingClientRect().right))].join(' | '));
  assert(await tab.evaluate(() => document.documentElement.scrollWidth) <= 390, wide);
  assert.equal(await tab.evaluate(() => { const b = document.querySelector('.vt-body'); return b.scrollWidth > b.clientWidth; }), true);
  await tab.locator('.visual-terminal .visual-enlarge').click();
  await tab.waitForSelector('dialog.visual-dialog[open]');
  assert(await tab.evaluate(() => document.documentElement.scrollWidth) <= 390);
  assert(await tab.evaluate(() => document.querySelector('dialog.visual-dialog').scrollWidth <= document.querySelector('dialog.visual-dialog').clientWidth + 1));
  await context.close();
});
dom('the viewer has no motion under reduced motion and a short fade otherwise', async ({browser, url}) => {
  for (const [reducedMotion, expected] of [['reduce', '0s'], ['no-preference', '0.22s']]) {
    const {context, tab} = await open(browser, url, {reducedMotion});
    await tab.locator('.visual-shot .visual-enlarge').click();
    await tab.waitForSelector('dialog.visual-dialog[open]');
    assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('dialog.visual-dialog')).transitionDuration.split(',')[0].trim()), expected);
    await context.close();
  }
});
