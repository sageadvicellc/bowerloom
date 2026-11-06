import assert from 'node:assert/strict';
import { execFile, execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Draws the light and dark app icons from design/app-icon.html. It builds build/icon.png (1024 px, clear corners) and build/icon.icns from the light
// one, and the Dock pair build/dock/icon-light.png and build/dock/icon-dark.png, which the app swaps while it runs. Needs macOS (sips and iconutil)
// and playwright-core with its Chromium browser: the copy that ships with playwright-cli, or PLAYWRIGHT_CORE_PATH set to a playwright-core folder.
// The icon needs a clear background, which only the library can capture. The mascot comes from the website's copy, so the icon and the site show the
// same S4-G3.
const run = promisify(execFile);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const brand = resolve(desktop, '../landing/public/brand/rose-conservatory');
const scratch = resolve(desktop, '.build/app-icon');
const files = { '/': [resolve(desktop, 'design/app-icon.html'), 'text/html'], '/mascot.svg': [resolve(brand, 's4-g3-icon.svg'), 'image/svg+xml'], '/mascot-dark.svg': [resolve(brand, 's4-g3-icon-dark.svg'), 'image/svg+xml'] };
// Every request the server cannot answer is recorded, and any such request fails the render.
const failed = [];
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const file = files[pathname];
    if (!file) { failed.push(pathname); response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file[1]);
    response.end(await readFile(file[0]));
  } catch (error) {
    failed.push(`${request.url} (${error.code ?? error.name})`);
    response.writeHead(404).end();
  }
});
// The same search as the landing browser tests: an explicit path first, then the playwright-core that ships with playwright-cli.
function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_CORE_PATH, join(dirname(process.execPath), '../lib/node_modules/@playwright/cli/node_modules/playwright-core')];
  try { candidates.push(join(realpathSync(execSync('which playwright-cli', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()), '../../node_modules/playwright-core')); } catch { /* no playwright-cli on the path */ }
  for (const path of candidates) if (path && existsSync(path)) return require(path).chromium;
  throw new Error('No playwright-core found. Install playwright-cli or set PLAYWRIGHT_CORE_PATH.');
}
const pngSize = bytes => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
// PNG colour type 6 is RGBA, so the corners can be clear.
const pngHasAlpha = bytes => bytes[25] === 6;
// The iconset names and pixel sizes that iconutil expects.
const sizes = [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'], [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'], [512, 'icon_512x512'], [1024, 'icon_512x512@2x']];
// The scratch file, then its path under build/. The bundle icon is the light one, and the Dock pair goes with the app (package.json extraResources).
const outputs = [['icon-light.png', 'icon.png'], ['icon.icns', 'icon.icns'], ['icon-light.png', 'dock/icon-light.png'], ['icon-dark.png', 'dock/icon-dark.png']];
let browser, failure;
await new Promise(done => server.listen(0, '127.0.0.1', done));
try {
  await rm(scratch, { recursive: true, force: true });
  const iconset = resolve(scratch, 'icon.iconset');
  await mkdir(iconset, { recursive: true });
  browser = await loadChromium().launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  for (const theme of ['light', 'dark']) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
    const drawn = await page.evaluate(async () => {
      await Promise.all([...document.images].map(image => image.decode()));
      if (document.querySelector('.mascot').getBoundingClientRect().width < 500) throw new Error('The mascot did not draw');
      return { dark: document.documentElement.classList.contains('dark'), mascot: new URL(document.querySelector('.mascot').src).pathname };
    });
    assert.deepEqual(drawn, { dark: theme === 'dark', mascot: theme === 'dark' ? '/mascot-dark.svg' : '/mascot.svg' }, `the ${theme} icon drew its own colours and mascot`);
    assert.deepEqual(failed, [], 'Every request was answered');
    const out = resolve(scratch, `icon-${theme}.png`);
    await page.screenshot({ path: out, omitBackground: true });
    const bytes = await readFile(out);
    assert.deepEqual(pngSize(bytes), [1024, 1024], `The ${theme} master is 1024 px square`);
    assert.ok(pngHasAlpha(bytes), `The ${theme} master has clear corners`);
  }
  const master = resolve(scratch, 'icon-light.png');
  for (const [px, name] of sizes) {
    const out = resolve(iconset, `${name}.png`);
    await run('sips', ['-z', String(px), String(px), master, '--out', out]);
    assert.deepEqual(pngSize(await readFile(out)), [px, px], name);
  }
  await run('iconutil', ['-c', 'icns', iconset, '-o', resolve(scratch, 'icon.icns')]);
  const icns = await readFile(resolve(scratch, 'icon.icns'));
  assert.equal(icns.subarray(0, 4).toString('latin1'), 'icns', 'iconutil wrote an icns file');
  // The committed files change only after all four are ready.
  await mkdir(resolve(desktop, 'build/dock'), { recursive: true });
  for (const [from, to] of outputs) await copyFile(resolve(scratch, from), resolve(desktop, 'build', `${to}.next`));
  for (const [, to] of outputs) { await rename(resolve(desktop, 'build', `${to}.next`), resolve(desktop, 'build', to)); console.log(`Saved build/${to}`); }
} catch (error) {
  failure = error;
  // A failed run leaves no half-made file in build/.
  for (const [, to] of outputs) await rm(resolve(desktop, 'build', `${to}.next`), { force: true });
} finally {
  // A failure to close the browser is reported, but it never hides the first failure.
  try { await browser?.close(); } catch (error) { console.error(`Could not close the browser: ${error.message}`); }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
if (failure) throw failure;
