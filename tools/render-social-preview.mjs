import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Renders the home and docs social cards. Requires playwright-cli and its Chromium browser. No external assets are fetched.
const run = promisify(execFile);
const landing = fileURLToPath(new URL('../apps/landing/', import.meta.url));
const publicRoot = resolve(landing, 'public');
const designRoot = resolve(landing, 'design');
const cards = [
  { page: '/design/social-preview.html', output: 'social/bowerloom-home.png' },
  { page: '/design/social-preview-docs.html', output: 'social/bowerloom-docs.png' },
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
const server = createServer(async (request, response) => {
  try {
    const file = resolveRequest(new URL(request.url, 'http://localhost').pathname);
    if (!file) { response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
// The page must load its fonts and pictures, keep every word inside the card, and keep the heading clear of the address.
const readyCheck = 'async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); if (!document.fonts.check("500 64px Newsreader") || !document.fonts.check("600 19px Manrope")) throw new Error("Preview fonts did not load"); for (const node of document.querySelectorAll("h1, .wordmark, .chip, .description, .address")) { const box = node.getBoundingClientRect(); if (box.left < 0 || box.top < 0 || box.right > 1200 || box.bottom > 630) throw new Error("Preview content does not fit"); } const words = [...document.querySelectorAll("h1, .description")].at(-1).getBoundingClientRect(); const address = document.querySelector(".address").getBoundingClientRect(); if (words.bottom > address.top - 16) throw new Error("Preview text runs into the address"); return "PREVIEW_READY"; }';
await new Promise(done => server.listen(0, '127.0.0.1', done));
const cli = (...args) => run('playwright-cli', [`-s=${session}`, ...args], { cwd: scratch, timeout: 30_000, maxBuffer: 1024 * 1024 });
try {
  await mkdir(scratch, { recursive: true });
  await mkdir(resolve(publicRoot, 'social'), { recursive: true });
  await cli('open', 'about:blank');
  await cli('resize', '1200', '630');
  for (const card of cards) {
    const output = resolve(publicRoot, card.output);
    await cli('goto', `http://127.0.0.1:${server.address().port}${card.page}`);
    const ready = await cli('eval', readyCheck);
    assert.ok(ready.stdout.includes('PREVIEW_READY'), `${card.page}: assets and fonts must load, and text must fit`);
    await cli('screenshot', `--filename=${output}`);
    const bytes = await readFile(output);
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    console.log(`Saved ${output}`);
  }
} finally {
  try { await cli('close'); } finally { await new Promise(done => server.close(done)); }
}
