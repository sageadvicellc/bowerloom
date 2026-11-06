import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Renders the home and docs social cards. Requires playwright-cli and its Chromium browser. No external assets are fetched.
const run = promisify(execFile);
const landing = fileURLToPath(new URL('../apps/landing/', import.meta.url));
const publicRoot = resolve(landing, 'public');
const designRoot = resolve(landing, 'design');
// Each card names the elements it must show. A missing element fails the render.
const cards = [
  { page: '/design/social-preview.html', output: 'social/bowerloom-home.png', required: ['.wordmark', '.chip', 'h1', '.address'] },
  { page: '/design/social-preview-docs.html', output: 'social/bowerloom-docs.png', required: ['.wordmark', '.chip', 'h1', '.description', '.address'] },
];
const session = `bowerloom-social-${process.pid}`;
const scratch = fileURLToPath(new URL('../.trellis/social-preview-browser/', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
// The server reads only the brand stylesheet, the design folder, and the public folder.
function resolveRequest(pathname) {
  if (pathname === '/src/brand.css') return resolve(landing, 'src/brand.css');
  const [root, rest] = pathname.startsWith('/design/') ? [designRoot, pathname.slice('/design'.length)] : [publicRoot, pathname];
  const file = resolve(root, '.' + decodeURIComponent(rest));
  return file.startsWith(root + sep) ? file : null;
}
// Every request that the server cannot answer is recorded, so a missing stylesheet or picture fails the render.
const failedRequests = [];
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  // The browser asks for a favicon on its own. The cards do not use one.
  if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
  try {
    const file = resolveRequest(pathname);
    if (!file) { failedRequests.push(`403 ${pathname}`); response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch (error) {
    failedRequests.push(`404 ${pathname} (${error.code ?? error.message})`);
    response.writeHead(404).end();
  }
});
// The page must load its fonts and pictures, show every required element inside the card, and keep its words clear of the address.
// The result token is built at run time, so the command echo of this source can never match it.
const readyCheck = required => `async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(image => image.decode()));
  for (const font of ["500 64px Newsreader", "600 19px Manrope", "400 25px Manrope"]) if (!document.fonts.check(font)) throw new Error("Preview font did not load: " + font);
  const boxes = {};
  for (const selector of ${JSON.stringify(required)}) {
    const node = document.querySelector(selector);
    if (!node) throw new Error("Preview is missing " + selector);
    const box = node.getBoundingClientRect();
    if (box.left < 0 || box.top < 0 || box.right > 1200 || box.bottom > 630) throw new Error("Preview content does not fit: " + selector);
    if (node.scrollWidth > node.clientWidth + 1) throw new Error("Preview text overflows its box: " + selector);
    boxes[selector] = box;
  }
  const words = boxes[".description"] ?? boxes.h1;
  if (words.bottom > boxes[".address"].top - 16) throw new Error("Preview text runs into the address");
  return ["PREVIEW", "READY"].join("_");
}`;
await new Promise(done => server.listen(0, '127.0.0.1', done));
const cli = (...args) => run('playwright-cli', [`-s=${session}`, ...args], { cwd: scratch, timeout: 30_000, maxBuffer: 1024 * 1024 });
const rendered = [];
let failure;
try {
  await mkdir(scratch, { recursive: true });
  await mkdir(resolve(publicRoot, 'social'), { recursive: true });
  await cli('open', 'about:blank');
  await cli('resize', '1200', '630');
  // Each card is drawn into the scratch folder first. The committed files change only after every card passes.
  for (const card of cards) {
    const draft = resolve(scratch, card.output.replace('/', '-'));
    await rm(draft, { force: true });
    await cli('goto', `http://127.0.0.1:${server.address().port}${card.page}`);
    const ready = await cli('eval', readyCheck(card.required));
    assert.match(ready.stdout, /^### Result\n"PREVIEW_READY"$/m, `${card.page}: the readiness check failed\n${ready.stdout}`);
    assert.deepEqual(failedRequests, [], `${card.page}: the server could not answer every request`);
    await cli('screenshot', `--filename=${draft}`);
    const bytes = await readFile(draft);
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${card.page}: the screenshot is not a PNG`);
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    rendered.push([draft, resolve(publicRoot, card.output)]);
  }
  for (const [draft, output] of rendered) { await copyFile(draft, output); console.log(`Saved ${output}`); }
} catch (error) {
  failure = error;
} finally {
  // A failure to close the browser is reported, but it never hides the first failure.
  try { await cli('close'); } catch (error) { console.error(`Could not close the browser session: ${error.message}`); }
  await new Promise(done => server.close(done));
}
if (failure) throw failure;
