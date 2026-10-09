import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Requires playwright-cli and its Chromium browser. No external assets are fetched.
const run = promisify(execFile);
const landing = fileURLToPath(new URL('../apps/landing/', import.meta.url));
const publicRoot = resolve(landing, 'public');
const output = resolve(publicRoot, 'social/bowerloom.png');
const session = `bowerloom-social-${process.pid}`;
const scratch = fileURLToPath(new URL('../.trellis/social-preview-browser/', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const special = { '/': resolve(landing, 'design/social-preview.html'), '/src/brand.css': resolve(landing, 'src/brand.css') };
    const file = special[pathname] ?? resolve(publicRoot, '.' + decodeURIComponent(pathname));
    if (!special[pathname] && !file.startsWith(publicRoot + sep)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' }[extname(file)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const cli = (...args) => run('playwright-cli', [`-s=${session}`, ...args], { cwd: scratch, timeout: 30_000, maxBuffer: 1024 * 1024 });
try {
  await mkdir(scratch, { recursive: true });
  await mkdir(resolve(publicRoot, 'social'), { recursive: true });
  await cli('open', `http://127.0.0.1:${server.address().port}`);
  await cli('resize', '1200', '630');
  const ready = await cli('eval', 'async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); if (!document.fonts.check("500 67px Newsreader") || !document.fonts.check("400 25px Manrope")) throw new Error("Preview fonts did not load"); for (const node of document.querySelectorAll("h1, .wordmark, .description, .address")) { const box = node.getBoundingClientRect(); if (box.left < 0 || box.top < 0 || box.right > 1200 || box.bottom > 630) throw new Error("Preview content does not fit"); } return "PREVIEW_READY"; }');
  assert.ok(ready.stdout.includes('PREVIEW_READY'), 'Preview assets and fonts must load, and text must fit');
  await cli('screenshot', `--filename=${output}`);
  const bytes = await readFile(output);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  console.log(`Saved ${output}`);
} finally {
  try { await cli('close'); } finally { await new Promise(resolve => server.close(resolve)); }
}
