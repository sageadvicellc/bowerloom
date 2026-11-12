/**
 * The reading of Obsidian-style notes for the Memory explorer (v0.9, lane 4), pure: no file, no clock, no Node module, no React. A note is markdown text. The reader finds its tags (front matter and `#tag` in the text) and its links
 * (`[[wiki links]]` and `[markdown](links.md)`), and the analytics count four things over a folder of notes: notes, links, tags, and links that point at a missing note. Every number is computed from the files. Nothing is guessed.
 * What counts is written in docs/v0.9/memory-explorer.md. The four layers are a proposal for the maintainer (spec evidence gap E2).
 *
 * Code is never read as notes: a fenced block and an inline code span hold no link and no tag. A web address, a mail address, a link to a heading of the same note, and a link to a file that is not a note (a picture, a PDF) are no link.
 * A link names its note the way Obsidian does: by the name of the file, or by a path that ends the path of the note, in any letter case. Two notes with one name: the link goes to the first path in order.
 */

/** The limits that keep one hostile note from costing much. They are per note. The caps of a place (pages read, files listed) are in shared/memory/read-flow.ts and packages/module-scope. */
export const MEMORY_LIMITS = Object.freeze({ linksPerNote: 500, tagsPerNote: 200, tagChars: 100, targetChars: 300, lineChars: 20000, tagsTotal: 5000, missingTotal: 5000 });

/** How many tags and how many missing targets the analytics list. The counts above the lists are never cut. */
export const ANALYTICS_LIST_MAX = 10;

export interface NoteLink { readonly target: string; readonly style: 'wiki' | 'markdown' }
export interface ParsedNote { readonly path: string; readonly tags: readonly string[]; readonly links: readonly NoteLink[] }

export interface MemoryAnalytics {
  /** The notes analysed: the markdown files of the folder, also those whose text could not be read. */
  readonly notes: number;
  /** Links: one for each note and each note or missing target it links to. A target a note links twice counts once. */
  readonly links: number;
  /** Distinct tags, and how many times a note uses one (one for each note and each tag). */
  readonly tags: number;
  readonly tagUses: number;
  /** Links whose target is no note of the folder, and how many different targets those are. */
  readonly missingLinks: number;
  readonly missingTargets: number;
  /** True when the distinct tags or the distinct missing targets reached their total cap. Then `tags` and `missingTargets` are lower bounds. The other counts are exact. */
  readonly capped: boolean;
  /** The most used tags, by the number of notes that hold them, then by name. At most ANALYTICS_LIST_MAX. */
  readonly topTags: readonly { readonly tag: string; readonly notes: number }[];
  /** The missing targets that most links point at, then by name. At most ANALYTICS_LIST_MAX. */
  readonly missing: readonly { readonly target: string; readonly count: number }[];
}

const NOTE_EXTENSION = /\.(?:md|markdown)$/i;
/** The files a link can name that are not notes. A target with another ending, such as `v1.2`, is a note. */
const OTHER_FILE = /\.(?:png|jpe?g|gif|svg|webp|bmp|avif|heic|tiff?|mp3|wav|m4a|ogg|flac|mp4|webm|mov|mkv|pdf|docx?|xlsx?|pptx?|csv|txt|zip|canvas|base|json)$/i;
const TAG_BODY = /^[\p{L}\p{N}_/-]+$/u;
/** A name with a control, format or bidirectional character is not listed: it could reorder the words around it. */
const ODD_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const tagOf = (raw: string): string | null => {
  // A string far longer than a tag is no tag. This check comes before any other work, so a run of a quarter of a million quotes costs nothing.
  if (raw.length > MEMORY_LIMITS.tagChars + 8) return null;
  let start = 0, end = raw.length;
  while (start < end && /\s/.test(raw[start]!)) start += 1;
  while (end > start && /\s/.test(raw[end - 1]!)) end -= 1;
  while (start < end && (raw[start] === '"' || raw[start] === "'")) start += 1;
  while (end > start && (raw[end - 1] === '"' || raw[end - 1] === "'")) end -= 1;
  while (start < end && raw[start] === '#') start += 1;
  const cleaned = raw.slice(start, end).toLowerCase();
  return cleaned.length > 0 && cleaned.length <= MEMORY_LIMITS.tagChars && TAG_BODY.test(cleaned) && !/^\d+$/.test(cleaned) ? cleaned : null;
};

/** The front matter and the body. A block that never closes is text, not front matter. */
function split(text: string): { readonly front: string[]; readonly body: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r\n?|\n/);
  if (lines[0]?.trim() !== '---') return { front: [], body: lines };
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!.trimEnd();
    if (line === '---' || line === '...') return { front: lines.slice(1, i), body: lines.slice(i + 1) };
  }
  return { front: [], body: lines };
}

/** The tags of the front matter: `tags: [a, b]`, `tags: a, b` and a block list under `tags:` (also `tag:`). It stops at the per-note cap. */
function frontTags(front: readonly string[]): string[] {
  const found: string[] = [];
  const take = (raw: string): boolean => { const tag = tagOf(raw); if (tag !== null) found.push(tag); return found.length >= MEMORY_LIMITS.tagsPerNote; };
  for (let i = 0; i < front.length; i += 1) {
    const key = /^(?:tags?)\s*:\s*(.*)$/i.exec(front[i]!);
    if (key === null) continue;
    let value = key[1]!.trim();
    if (value === '') {
      for (let j = i + 1; j < front.length; j += 1) {
        const item = /^\s*-\s+(.+)$/.exec(front[j]!);
        if (item === null) break;
        if (take(item[1]!)) return found;
      }
    } else {
      if (value.startsWith('[')) value = value.slice(1);
      if (value.endsWith(']')) value = value.slice(0, -1);
      for (const raw of value.split(/[\s,]+/)) if (take(raw)) return found;
    }
  }
  return found;
}

/** The body lines that are not code: a fenced block is dropped, and an inline code span is cut out of its line. */
function textLines(body: readonly string[]): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const raw of body) {
    const line = raw.length > MEMORY_LIMITS.lineChars ? raw.slice(0, MEMORY_LIMITS.lineChars) : raw;
    const mark = /^ {0,3}(```|~~~)/.exec(line);
    if (fence !== null) { if (mark !== null && mark[1] === fence) fence = null; continue; }
    if (mark !== null) { fence = mark[1]!; continue; }
    out.push(line.replace(/`[^`]*`/g, ' '));
  }
  return out;
}

const decode = (text: string): string => { try { return decodeURIComponent(text); } catch { return text; } };

/** The note a wiki link names, as written, without its alias, its heading or its block, or null when it names no note. */
function wikiTarget(inner: string): string | null {
  const target = inner.split('|', 1)[0]!.replace(/\\+$/, '').split('#', 1)[0]!.trim();
  return target === '' || target.length > MEMORY_LIMITS.targetChars || OTHER_FILE.test(target) ? null : target;
}

/** The note a markdown link names, or null for the web, mail, a heading of this note, and a file that is not a note. */
function markdownTarget(raw: string): string | null {
  const inner = raw.startsWith('<') ? raw.slice(1, -1) : raw;
  if (inner === '' || inner.startsWith('#') || URL_SCHEME.test(inner)) return null;
  const target = decode(inner.split('#', 1)[0]!.split('?', 1)[0]!).trim();
  // A markdown link names a note only with the ending of a note, or with none. Any other ending is another kind of file.
  const otherEnding = /\.[A-Za-z0-9]{1,8}$/.test(target) && !NOTE_EXTENSION.test(target);
  return target === '' || target.length > MEMORY_LIMITS.targetChars || otherEnding ? null : target;
}

/** Reads one note: its tags and its links. Never throws. The path is kept as given. */
export function parseNote(path: string, text: string): ParsedNote {
  const { front, body } = split(typeof text === 'string' ? text : '');
  const lines = textLines(body);
  const tags = new Set<string>(frontTags(front));
  const links = new Map<string, NoteLink>();
  const addLink = (link: NoteLink): void => { const key = `${link.style}|${link.target.toLowerCase()}`; if (links.size < MEMORY_LIMITS.linksPerNote && !links.has(key)) links.set(key, link); };
  for (const line of lines) {
    for (const m of line.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) { const tag = tagOf(m[1]!); if (tag !== null && tags.size < MEMORY_LIMITS.tagsPerNote) tags.add(tag); }
    for (const m of line.matchAll(/\[\[([^[\]\n]{1,300})\]\]/g)) { const target = wikiTarget(m[1]!); if (target !== null) addLink({ target, style: 'wiki' }); }
    for (const m of line.matchAll(/\[[^[\]\n]{0,300}\]\((<[^<>\n]{1,300}>|[^()\s<>]{1,300})(?:\s+"[^"\n]*")?\)/g)) { const target = markdownTarget(m[1]!); if (target !== null) addLink({ target, style: 'markdown' }); }
  }
  return Object.freeze({ path, tags: Object.freeze([...tags]), links: Object.freeze([...links.values()]) });
}

// ---------------------------------------------------------------------------------------------------------------------- resolving links

const withoutEnding = (path: string): string => path.replace(NOTE_EXTENSION, '').toLowerCase();

/** An index of the notes of a folder, so each link is found without a walk of the list. The first path in the order given wins for a name that two notes share. */
export interface NoteIndex {
  /** The path of a note without its ending, in lower case, to the path. */
  readonly full: ReadonlyMap<string, string>;
  /** Every end of a path from a folder boundary, in lower case, to the first path that has it: `a/b/c` gives `a/b/c`, `b/c` and `c`. */
  readonly ends: ReadonlyMap<string, string>;
}

export function indexNotes(paths: readonly string[]): NoteIndex {
  const full = new Map<string, string>(), ends = new Map<string, string>();
  for (const path of paths) {
    const key = withoutEnding(path);
    if (!full.has(key)) full.set(key, path);
    const parts = key.split('/');
    for (let i = 0; i < parts.length; i += 1) { const end = parts.slice(i).join('/'); if (!ends.has(end)) ends.set(end, path); }
  }
  return { full, ends };
}

/** Joins a relative target to the folder of a note and folds `.` and `..`. Null when the result leaves the root of the folder. */
function joinFrom(from: string, target: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (parts.length === 0) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join('/');
}

export function resolveWith(index: NoteIndex, link: NoteLink, from: string): string | null {
  const target = link.target.replace(/\\/g, '/').replace(/^\/+/, '');
  if (link.style === 'markdown') {
    const relative = joinFrom(from, link.target);
    if (relative === null) return null;
    return index.full.get(withoutEnding(relative)) ?? index.full.get(withoutEnding(target)) ?? null;
  }
  return index.ends.get(withoutEnding(target)) ?? null;
}

/** The path of the note a link names, or null when the folder holds no such note. */
export function resolveLink(paths: readonly string[], link: NoteLink, from: string): string | null {
  return resolveWith(indexNotes(paths), link, from);
}

// ---------------------------------------------------------------------------------------------------------------------- the four layers

const byCountThenName = <T extends { readonly count: number; readonly name: string }>(a: T, b: T): number => (b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/**
 * The four layers over a folder. `paths` is every note of the folder (so a note that could not be read is still a note and still a target). `parsed` holds the notes that were read: a note in `parsed` that is not in
 * `paths` is left out. Pure and the same for the same input.
 */
export function analyse(paths: readonly string[], parsed: readonly ParsedNote[]): MemoryAnalytics {
  const index = indexNotes(paths), known = new Set(paths);
  let links = 0, tagUses = 0, missingLinks = 0;
  const tags = new Map<string, number>(), missing = new Map<string, { target: string; count: number }>();
  let capped = false;
  for (const note of parsed) {
    if (!known.has(note.path)) continue;
    for (const tag of note.tags) {
      tagUses += 1;
      const have = tags.get(tag);
      if (have !== undefined) tags.set(tag, have + 1); else if (tags.size < MEMORY_LIMITS.tagsTotal) tags.set(tag, 1); else capped = true;
    }
    // One link for each note and each target: a note that links one target by a wiki link and by a markdown link has one link.
    const seen = new Set<string>();
    for (const link of note.links) {
      const to = resolveWith(index, link, note.path);
      const key = to !== null ? `note|${to}` : `missing|${withoutEnding(link.target)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links += 1;
      if (to === null) {
        missingLinks += 1;
        const name = withoutEnding(link.target), have = missing.get(name);
        if (have !== undefined) have.count += 1; else if (missing.size < MEMORY_LIMITS.missingTotal) missing.set(name, { target: link.target.replace(NOTE_EXTENSION, ''), count: 1 }); else capped = true;
      }
    }
  }
  return Object.freeze({
    notes: paths.length, links, tags: tags.size, tagUses, missingLinks, missingTargets: missing.size, capped,
    topTags: Object.freeze([...tags].map(([tag, notes]) => ({ tag, notes, count: notes, name: tag })).sort(byCountThenName).slice(0, ANALYTICS_LIST_MAX).map(({ tag, notes }) => Object.freeze({ tag, notes }))),
    missing: Object.freeze([...missing].filter(([, m]) => !ODD_CHARACTER.test(m.target)).map(([key, m]) => ({ target: m.target, count: m.count, name: key })).sort(byCountThenName).slice(0, ANALYTICS_LIST_MAX).map(({ target, count }) => Object.freeze({ target, count }))),
  });
}
