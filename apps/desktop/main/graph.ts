/**
 * The knowledge graph: a context store's markdown pages and the links between them. Read only, in the main process. The window
 * gets ids, titles, tags, folders, sizes and links, never a page's text. A page is opened one at a time, as plain text.
 */
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { readGuarded } from '../../../packages/project-authoring/src/files.js';
import { safeLine, safeText } from '../shared/text.js';
import type { GraphEdge, GraphNode, KnowledgeGraph, PageResult } from '../shared/types.js';
import { isInside } from './safe.js';

export const GRAPH_LIMITS = Object.freeze({ nodes: 5000, edges: 20000, fileBytes: 256 * 1024, depth: 6 });

const WIKILINK = /!?\[\[([^\]\n]{1,200})\]\]/g;
const MDLINK = /(!?)\[[^\]\n]{0,200}\]\(\s*<?([^)\s>\n]{1,300})>?(?:\s+"[^"\n]*")?\s*\)/g;
const TAG = /(?<![\w&#/\\.:=?-])#([A-Za-z][\w/-]{0,39})/g;
const decode = (text: string): string => { try { return decodeURIComponent(text); } catch { return text; } };

interface Found { rel: string; abs: string }

/** Markdown pages by a bounded walk: no links followed, no hidden folders, no node_modules. Sorted, so the result is the same each time. */
function walk(root: string, max: number, notices: string[]): Found[] {
  const found: Found[] = []; let capped = false, deep = false;
  const visit = (at: string, depth: number): void => {
    if (capped) return;
    let entries; try { entries = readdirSync(at, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (capped) return;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (depth >= GRAPH_LIMITS.depth) deep = true; else visit(join(at, e.name), depth + 1); }
      else if (e.isFile() && /\.md$/i.test(e.name)) {
        if (found.length >= max) { capped = true; return; }
        found.push({ rel: relative(root, join(at, e.name)).split(sep).join('/'), abs: join(at, e.name) });
      }
    }
  };
  visit(root, 0);
  if (capped) notices.push(`The store holds more pages than the viewer shows. It shows the first ${max} pages, in folder order.`);
  if (deep) notices.push(`Some folders are nested deeper than ${GRAPH_LIMITS.depth} levels. The viewer does not look inside them.`);
  return found;
}

function frontmatter(text: string): { tags: string[]; title: string | null; body: string } {
  const m = /^---\r?\n([\s\S]{0,4000}?)\r?\n---\r?\n?/.exec(text);
  if (m === null) return { tags: [], title: null, body: text };
  const tags: string[] = [], block = m[1]!;
  const inline = /^tags:\s*\[([^\]\n]*)\]/m.exec(block);
  if (inline !== null) tags.push(...inline[1]!.split(',').map(x => x.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')));
  const list = /^tags:\s*\n((?:\s*-\s*.+\n?)+)/m.exec(block + '\n');
  if (list !== null) tags.push(...list[1]!.split('\n').map(x => x.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean));
  const single = /^tags:\s*([^\[\n][^\n]*)$/m.exec(block);
  if (single !== null && inline === null) tags.push(...single[1]!.split(/[,\s]+/).map(x => x.replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean));
  const title = /^title:\s*["']?([^"'\n]{1,200})["']?\s*$/m.exec(block);
  return { tags: tags.filter(t => /^[A-Za-z][\w/-]{0,39}$/.test(t)), title: title === null ? null : title[1]!.trim(), body: text.slice(m[0].length) };
}

/** Text with fenced code and inline code taken out, so a link or a tag inside code does not count. */
const withoutCode = (text: string): string => text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/~~~[\s\S]*?(~~~|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');

/**
 * Reads one store. `limits` can lower the caps (tests). Never reads outside `dir`: pages that are links are skipped, a path that
 * would leave the store is not a page, and a page that cannot be read safely stays in the graph with no links.
 */
export function buildGraph(dir: string, limits: Partial<{ nodes: number; edges: number }> = {}): KnowledgeGraph {
  const maxNodes = Math.min(limits.nodes ?? GRAPH_LIMITS.nodes, GRAPH_LIMITS.nodes), maxEdges = Math.min(limits.edges ?? GRAPH_LIMITS.edges, GRAPH_LIMITS.edges);
  const notices: string[] = [];
  const pages = walk(dir, maxNodes, notices);
  const ids = new Set(pages.map(p => p.rel)), lower = new Map<string, string[]>();
  const stem = (rel: string): string => basename(rel).replace(/\.md$/i, '').toLowerCase();
  for (const p of pages) { const k = stem(p.rel); lower.set(k, [...(lower.get(k) ?? []), p.rel]); }
  const byPath = new Map(pages.map(p => [p.rel.toLowerCase().replace(/\.md$/, ''), p.rel] as const));
  const resolveWiki = (target: string, from: string): string | null => {
    const t = decode(target.split('|')[0]!.split('#')[0]!).trim().replace(/\\/g, '/').replace(/\.md$/i, '');
    if (t === '') return null;
    if (t.includes('/')) { const clean = posix.normalize(t.replace(/^\/+/, '')).toLowerCase(); return byPath.get(clean) ?? (ids.has(`${clean}.md`) ? `${clean}.md` : null); }
    const hits = lower.get(t.toLowerCase()) ?? [];
    if (hits.length <= 1) return hits[0] ?? null;
    const near = hits.find(h => dirname(h) === dirname(from)); // the page beside the linking page wins when several share a name
    return near ?? hits[0]!;
  };
  const resolveRelative = (target: string, from: string): string | 'outside' | 'skip' | null => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) return 'skip';
    const clean = decode(target.split('#')[0]!.split('?')[0]!);
    if (clean === '' || !/\.md$/i.test(clean)) return 'skip';
    if (clean.startsWith('/') || isAbsolute(clean)) return 'skip';
    const joined = posix.normalize(posix.join(dirname(from), clean.replace(/\\/g, '/')));
    if (joined.startsWith('..') || joined.includes('\0')) return 'outside';
    return ids.has(joined) ? joined : null;
  };

  const nodes = new Map<string, GraphNode>(), edges: GraphEdge[] = [], seen = new Set<string>();
  let broken = 0, big = 0, unreadable = 0, edgeCapped = false;
  for (const p of pages) {
    const folder = dirname(p.rel) === '.' ? '' : dirname(p.rel);
    const node: GraphNode = { id: p.rel, title: safeLine(basename(p.rel).replace(/\.md$/i, '')), folder, tags: [], bytes: 0, degree: 0, inDegree: 0, orphan: false, big: false };
    nodes.set(p.rel, node);
    let size = 0; try { size = lstatSync(p.abs).size; } catch { unreadable++; continue; }
    node.bytes = size;
    if (size > GRAPH_LIMITS.fileBytes) { node.big = true; big++; continue; }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: false }).decode(readGuarded(p.abs, GRAPH_LIMITS.fileBytes)); } catch { unreadable++; continue; }
    const fm = frontmatter(text), body = withoutCode(fm.body);
    const heading = /^#\s+(.{1,200}?)\s*#*\s*$/m.exec(body);
    node.title = safeLine((fm.title ?? heading?.[1] ?? node.title).trim());
    const tags = new Set(fm.tags);
    for (const m of body.replace(/^#{1,6}\s.*$/gm, ' ').matchAll(TAG)) tags.add(m[1]!);
    node.tags = [...tags].map(safeLine).sort();
    const addEdge = (to: string): void => {
      if (to === p.rel) return;
      const k = `${p.rel}\0${to}`;
      if (seen.has(k)) return;
      if (edges.length >= maxEdges) { edgeCapped = true; return; }
      seen.add(k); edges.push({ from: p.rel, to });
    };
    for (const m of body.matchAll(WIKILINK)) { const to = resolveWiki(m[1]!, p.rel); if (to === null) broken++; else addEdge(to); }
    for (const m of body.matchAll(MDLINK)) {
      const to = resolveRelative(m[2]!, p.rel);
      if (to === 'skip') continue;
      if (to === null || to === 'outside') broken++; else addEdge(to);
    }
  }
  if (edgeCapped) notices.push(`The store holds more links than the viewer shows. It shows the first ${maxEdges} links.`);
  if (big > 0) notices.push(`${big} ${big === 1 ? 'page is' : 'pages are'} too large to read for links, so ${big === 1 ? 'it shows' : 'they show'} with no links.`);
  if (unreadable > 0) notices.push(`${unreadable} ${unreadable === 1 ? 'page' : 'pages'} could not be read, so ${unreadable === 1 ? 'it shows' : 'they show'} with no links.`);
  for (const e of edges) { nodes.get(e.from)!.degree++; nodes.get(e.to)!.degree++; nodes.get(e.to)!.inDegree++; }
  const list = [...nodes.values()];
  for (const n of list) n.orphan = n.degree === 0;
  return {
    nodes: list, edges, broken, notices, limits: { nodes: maxNodes, edges: maxEdges },
    folders: [...new Set(list.map(n => n.folder))].sort(), tags: [...new Set(list.flatMap(n => n.tags))].sort(),
  };
}

/** One page as plain text. Only a markdown file inside the store, not through a link, within the size limit. */
export function readPage(storeDir: string, page: unknown): PageResult {
  const NO = 'This page is not shown. It is outside the store, a link, too large, or not plain text.';
  if (typeof page !== 'string' || page === '' || page.length > 500 || page.includes('\0') || !/\.md$/i.test(page) || isAbsolute(page) || page.split('/').includes('..')) return { text: null, note: NO };
  try {
    const root = realpathSync(storeDir), target = join(root, ...page.split('/'));
    let at = root;
    for (const part of page.split('/').filter(Boolean)) {
      at = join(at, part);
      if (lstatSync(at).isSymbolicLink()) return { text: null, note: NO };
    }
    if (!isInside(root, realpathSync(target))) return { text: null, note: NO };
    const bytes = readGuarded(target, GRAPH_LIMITS.fileBytes);
    if (bytes.includes(0)) return { text: null, note: NO };
    return { text: safeText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), note: null };
  } catch { return { text: null, note: NO }; }
}
