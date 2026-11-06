// Visuals in documentation pages. An author puts one line in a page, such as ::visual{id="app-builder"}.
// The build replaces that line before Markdown runs: with figure markup for the page, or with plain text for the
// Markdown routes, the llms files, and search. The ids come from src/visuals/manifest.json. An id the manifest does
// not hold stops the build and names the page and the id.
import {readFile, open} from 'node:fs/promises';
import {sourcePaths} from './build-paths.mjs';

const ID = '[a-z0-9]+(?:-[a-z0-9]+)*';
const DIRECTIVE = new RegExp(`^::visual\\{id="(${ID})"\\}\\s*$`);
const ATTEMPT = /^\s{0,3}::visual(?![A-Za-z])/;
const THEMES = ['light', 'dark'];
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const themeFiles = id => THEMES.map(theme => `${id}-${theme}.webp`);

/** The manifest builder B writes. A missing file is an empty manifest, so a docs build with no visuals still passes. */
export async function readVisualManifest(url = sourcePaths.visuals, publicUrl = sourcePaths.publicVisuals) {
  let text;
  try { text = await readFile(url, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return {shots: {}, terminals: {}}; throw error; }
  const parsed = JSON.parse(text);
  const manifest = validateManifest({shots: parsed.shots ?? {}, terminals: parsed.terminals ?? {}});
  for (const id of Object.keys(manifest.shots)) for (const theme of THEMES) await checkImage(id, theme, new URL(`${id}-${theme}.webp`, publicUrl));
  return manifest;
}

/** A shot file must exist, hold bytes, and start with a WebP header (RIFF, a size, then WEBP). */
async function checkImage(id, theme, url) {
  let handle;
  try { handle = await open(url, 'r'); } catch (error) { if (error.code === 'ENOENT') throw new Error(`Visual "${id}": the ${theme} image is missing (public/visuals/${id}-${theme}.webp).`); throw error; }
  try {
    const {size} = await handle.stat();
    if (size === 0) throw new Error(`Visual "${id}": the ${theme} image is empty (public/visuals/${id}-${theme}.webp).`);
    const head = Buffer.alloc(12);
    await handle.read(head, 0, 12, 0);
    if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WEBP') throw new Error(`Visual "${id}": the ${theme} image is not a WebP file (public/visuals/${id}-${theme}.webp).`);
  } finally { await handle.close(); }
}

const KINDS = ['cmd', 'out', 'err'];
const oneLine = (value, id, field) => {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error(`Visual "${id}": ${field} must be one line of text with no line break.`);
};
const checkLines = (id, item) => {
  if (!Array.isArray(item?.lines)) throw new Error(`Visual "${id}": a terminal needs a lines list.`);
  for (const line of item.lines) if (typeof line?.text !== 'string' || /[\r\n]/.test(line.text)) throw new Error(`Visual "${id}": each line text must be one line of text with no line break.`);
  for (const line of item.lines) if (!KINDS.includes(line.kind)) throw new Error(`Visual "${id}": line kind ${JSON.stringify(line.kind)} is not one of ${KINDS.join(', ')}.`);
};
/** Refuses a manifest whose text could add Markdown or markup to the text form, or whose line kind is not known. Returns the manifest. */
export function validateManifest(manifest) {
  for (const [id, item] of [...Object.entries(manifest.shots), ...Object.entries(manifest.terminals)]) if (!item || typeof item !== 'object') throw new Error(`Visual "${id}": the entry must be an object.`);
  for (const [id, item] of Object.entries(manifest.shots)) {
    oneLine(item.alt, id, 'alt'); oneLine(item.caption, id, 'caption');
    for (const field of ['width', 'height']) if (!Number.isInteger(item[field]) || item[field] <= 0) throw new Error(`Visual "${id}": ${field} must be a positive whole number.`);
  }
  for (const [id, item] of Object.entries(manifest.terminals)) { oneLine(item.title, id, 'title'); oneLine(item.caption, id, 'caption'); checkLines(id, item); }
  return manifest;
}

export {terminalCopyText, commandsFromPanel} from './terminal-text.mjs';

function lookup(id, manifest, file) {
  if (manifest.shots[id]) return {kind: 'shot', item: manifest.shots[id]};
  if (manifest.terminals[id]) return {kind: 'terminal', item: manifest.terminals[id]};
  const known = [...Object.keys(manifest.shots), ...Object.keys(manifest.terminals)];
  throw new Error(`Unknown visual id "${id}" in ${file}. Known ids: ${known.length ? known.join(', ') : 'none (src/visuals/manifest.json is empty or missing)'}.`);
}
const enlarge = label => `<button type="button" class="visual-enlarge" hidden aria-haspopup="dialog" aria-label="${escapeHtml(label)}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span aria-hidden="true">Enlarge</span></button>`;
const caption = (text, label) => `<figcaption class="visual-meta"><span class="visual-caption">${escapeHtml(text)}</span>${enlarge(label)}</figcaption>`;

/** The figure markup for one id. It is one line with no blank line, so Markdown keeps it as a single HTML block. */
export function renderVisualHtml(id, manifest, {file = 'a page', base = '/docs'} = {}) {
  const {kind, item} = lookup(id, manifest, file);
  if (kind === 'shot') {
    const [light, dark] = themeFiles(id).map(name => `${base}/visuals/${name}`);
    const image = (theme, src) => `<img class="visual-img" data-shot-theme="${theme}" src="${escapeHtml(src)}" width="${Number(item.width)}" height="${Number(item.height)}" alt="${escapeHtml(item.alt)}" loading="lazy" decoding="async"/>`;
    return `<figure class="visual visual-shot" data-visual="${id}"><span class="visual-frame">${image('light', light)}${image('dark', dark)}</span>${caption(item.caption, `Enlarge screenshot: ${item.caption}`)}</figure>`;
  }
  checkLines(id, item);
  const lines = item.lines.map(line => `<samp class="vt-line vt-${line.kind}">${escapeHtml(line.text)}</samp>`).join('&#10;');
  return `<figure class="visual visual-terminal" data-visual="${id}" role="group" aria-label="Terminal sample: ${escapeHtml(item.title)}"><div class="vt-panel"><div class="vt-bar"><span class="vt-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="vt-title">${escapeHtml(item.title)}</span><button type="button" class="vt-copy" hidden aria-label="Copy the commands from ${escapeHtml(item.title)}">Copy</button><span class="vt-status" role="status"></span></div><pre class="vt-body" tabindex="0" role="region" aria-label="Terminal output: ${escapeHtml(item.title)}"><code>${lines}</code></pre></div>${caption(item.caption, `Enlarge terminal: ${item.title}`)}</figure>`;
}

/** The text form for the Markdown routes, the llms files, and search. */
export function renderVisualText(id, manifest, {file = 'a page'} = {}) {
  const {kind, item} = lookup(id, manifest, file);
  if (kind === 'shot') return `[Screenshot: ${item.alt}] ${item.caption}`;
  checkLines(id, item);
  const body = item.lines.map(line => (line.kind === 'cmd' ? '$ ' : '') + line.text);
  const longest = Math.max(2, ...body.map(line => Math.max(0, ...[...line.matchAll(/`+/g)].map(run => run[0].length))));
  const fence = '`'.repeat(longest + 1);
  return `${item.caption}\n\n${fence}text\n${body.join('\n')}\n${fence}`;
}

/** Replaces every directive line outside a code fence. `mode` is 'html' or 'text'. */
export function applyVisuals(markdown, {file, manifest, mode, base = '/docs'}) {
  let fence = null;
  return markdown.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    // A closing fence has no info string (CommonMark), so a line such as ```js inside a fence does not close it.
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null; return line; }
    if (fence) return line;
    const match = line.match(DIRECTIVE);
    if (!match) {
      if (ATTEMPT.test(line) || line.includes('::visual{')) throw new Error(`Malformed visual directive in ${file}: ${line.trim()}. Write it as ::visual{id="some-id"}.`);
      return line;
    }
    return mode === 'html' ? renderVisualHtml(match[1], manifest, {file, base}) : renderVisualText(match[1], manifest, {file});
  }).join('\n');
}
