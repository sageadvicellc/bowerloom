// Visuals in documentation pages. An author puts one line in a page, such as ::visual{id="app-builder"}.
// The build replaces that line before Markdown runs: with figure markup for the page, or with plain text for the
// Markdown routes, the llms files, and search. The ids come from src/visuals/manifest.json. An id the manifest does
// not hold stops the build and names the page and the id.
import {readFile} from 'node:fs/promises';
import {sourcePaths} from './build-paths.mjs';

const ID = '[a-z0-9]+(?:-[a-z0-9]+)*';
const DIRECTIVE = new RegExp(`^::visual\\{id="(${ID})"\\}\\s*$`);
const ATTEMPT = /^\s{0,3}::visual(?![A-Za-z])/;
const THEMES = ['light', 'dark'];
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const themeFiles = id => THEMES.map(theme => `${id}-${theme}.webp`);

/** The manifest builder B writes. A missing file is an empty manifest, so a docs build with no visuals still passes. */
export async function readVisualManifest(url = sourcePaths.visuals) {
  let text;
  try { text = await readFile(url, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return {shots: {}, terminals: {}}; throw error; }
  const parsed = JSON.parse(text);
  return {shots: parsed.shots ?? {}, terminals: parsed.terminals ?? {}};
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
  const lines = item.lines.map(line => `<samp class="vt-line vt-${line.kind}">${escapeHtml(line.text)}</samp>`).join('&#10;');
  return `<figure class="visual visual-terminal" data-visual="${id}" role="group" aria-label="Terminal sample: ${escapeHtml(item.title)}"><div class="vt-panel"><div class="vt-bar"><span class="vt-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="vt-title">${escapeHtml(item.title)}</span><button type="button" class="vt-copy" hidden aria-label="Copy the commands from ${escapeHtml(item.title)}">Copy</button></div><pre class="vt-body" tabindex="0"><code>${lines}</code></pre></div>${caption(item.caption, `Enlarge terminal: ${item.title}`)}</figure>`;
}

/** The text form for the Markdown routes, the llms files, and search. */
export function renderVisualText(id, manifest, {file = 'a page'} = {}) {
  const {kind, item} = lookup(id, manifest, file);
  if (kind === 'shot') return `[Screenshot: ${item.alt}] ${item.caption}`;
  const body = item.lines.map(line => (line.kind === 'cmd' ? '$ ' : '') + line.text);
  const longest = Math.max(2, ...body.map(line => Math.max(0, ...[...line.matchAll(/`+/g)].map(run => run[0].length))));
  const fence = '`'.repeat(longest + 1);
  return `${item.caption}\n\n${fence}text\n${body.join('\n')}\n${fence}`;
}

/** Replaces every directive line outside a code fence. `mode` is 'html' or 'text'. */
export function applyVisuals(markdown, {file, manifest, mode, base = '/docs'}) {
  let fence = null;
  return markdown.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; return line; }
    if (fence) return line;
    const match = line.match(DIRECTIVE);
    if (!match) {
      if (ATTEMPT.test(line)) throw new Error(`Malformed visual directive in ${file}: ${line.trim()}. Write it as ::visual{id="some-id"}.`);
      return line;
    }
    return mode === 'html' ? renderVisualHtml(match[1], manifest, {file, base}) : renderVisualText(match[1], manifest, {file});
  }).join('\n');
}
