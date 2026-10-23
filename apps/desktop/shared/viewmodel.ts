/**
 * What each screen says, in plain words, worked out from the snapshot. Pure functions: no file, no window.
 * The renderer only draws these results.
 */
import type { CacheData, FolderData, ItemContent, ItemKind, LibraryItem, LockMatch, ProjectData, ProjectItem, ProjectStatus, Snapshot, StoreData } from './types.js';
import { KIND_WORDS, ORIGIN_WORDS, codeWords, humanBytes, plural, titleOf } from './words.js';

export type Tone = 'good' | 'warn' | 'bad' | 'quiet';
export interface Chip { label: string; tone: Tone }
export interface Link { screen: 'home' | 'library' | 'item' | 'projects' | 'project' | 'folders' | 'storage' | 'settings'; kind?: ItemKind; id?: string; key?: string }

// ------------------------------------------------------------------------------------------------------------- chips

export const STATUS_CHIP: Record<ProjectStatus, Chip> = {
  ready: { label: 'Ready', tone: 'good' },
  drifted: { label: 'Drifted', tone: 'warn' },
  'lock-problem': { label: 'Lock problem', tone: 'bad' },
  'not-set-up': { label: 'Not set up', tone: 'quiet' },
  unreadable: { label: 'Cannot open', tone: 'bad' },
};

export const STATUS_SENTENCE: Record<ProjectStatus, string> = {
  ready: 'Everything this project asks for is in place and matches what was locked.',
  drifted: 'This project has drifted. What it asks for no longer matches what is saved or locked. Nothing is broken; a person needs to look.',
  'lock-problem': 'The lock file of this project has a problem, so Bowerloom cannot confirm that it uses the versions it should.',
  'not-set-up': 'This folder has no project list yet, so Bowerloom is not managing anything here.',
  unreadable: 'Bowerloom would not open this folder.',
};

export const LOCK_MATCH_WORDS: Record<LockMatch, { text: string; tone: Tone }> = {
  same: { text: 'Matches the lock', tone: 'good' },
  changed: { text: 'Changed since it was locked', tone: 'warn' },
  missing: { text: 'Not in the lock', tone: 'warn' },
  'not-used': { text: 'No lock needed', tone: 'quiet' },
  unknown: { text: 'Cannot compare, the lock is not readable', tone: 'bad' },
};

// -------------------------------------------------------------------------------------------------------------- pins

/** `@synthetic/brand-voice@1.2.0:skills/brand-voice` becomes `Fixed to version 1.2.0 from npm`. */
export function pinWords(pin: string | null, origin: LibraryItem['origin']): string {
  if (pin === null) return origin === 'yours' ? 'Not fixed. It follows your own folder.' : 'Not fixed to a version.';
  const clean = pin.split(':')[0]!, at = clean.lastIndexOf('@'), version = at > 0 ? clean.slice(at + 1) : clean;
  return origin === 'npm' ? `Fixed to version ${version} from npm` : `Fixed to GitHub copy ${version.slice(0, 8)}`;
}

// ------------------------------------------------------------------------------------------------------------- home

export interface Attention { id: string; tone: Tone; title: string; body: string; todo: string; technical: string | null; link: Link | null }

const pathName = (key: string): string => key.split('/').filter(Boolean).pop() ?? key;

function projectReasons(p: ProjectData): string[] {
  const out: string[] = [];
  if (p.status === 'unreadable' && p.openCode !== null) out.push(codeWords(p.openCode));
  if (p.configState === 'invalid') out.push(codeWords(p.configCode));
  if (p.lockState === 'invalid' || p.lockState === 'orphan') out.push(p.lockState === 'orphan' ? 'There is a lock file, but no project list for it to lock.' : codeWords(p.lockCode ?? 'LOCK_INVALID'));
  if (p.lockState === 'mismatch') out.push(codeWords('LOCK_CONFIG_MISMATCH'));
  if (p.lockState === 'stale') out.push('The lock is out of date.');
  for (const i of p.items) {
    if (i.lock === 'changed') out.push(`${KIND_WORDS[i.kind].one} "${i.id}" changed in your library after the lock was written.`);
    if (i.hold !== null) out.push(`${KIND_WORDS[i.kind].one} "${i.id}": ${codeWords(i.hold.code)}`);
  }
  for (const h of p.held) if (h.kind === 'agent' || h.kind === 'slice') out.push(`${titleOf(h.kind)} "${h.id}": ${codeWords(h.code)}`);
  for (const d of p.drift) {
    if (d.kind === 'unexpected') out.push(`Bowerloom's setup check found something it did not expect in this project: ${d.path}.`);
    else if (d.kind === 'resolve-error') out.push(codeWords(d.code));
    else if (d.kind === 'edited') out.push(`A file Bowerloom manages was edited by hand: ${d.path}.`);
    else if (!['config-invalid', 'lock-invalid', 'lock-orphan'].includes(d.kind)) out.push(`Something differs from what was set up: ${d.path}.`);
  }
  if (p.storeCode !== null) out.push(codeWords(p.storeCode));
  return [...new Set(out.filter(Boolean))];
}
export const reasonsOf = projectReasons;

export function homeModel(s: Snapshot): { sentence: string; counts: { label: string; value: number; link: Link }[]; attention: Attention[] } {
  const lib = s.library, counts = [
    { label: 'Teams', value: lib.teams.length, link: { screen: 'library', kind: 'team' } as Link },
    { label: 'Skills', value: lib.skills.length, link: { screen: 'library', kind: 'skill' } as Link },
    { label: 'Prompts', value: lib.prompts.length, link: { screen: 'library', kind: 'prompt' } as Link },
    { label: 'Projects', value: s.projects.length, link: { screen: 'projects' } as Link },
  ];
  const sentence = s.store.state === 'ready'
    ? `You have ${plural(lib.teams.length, 'team')}, ${plural(lib.skills.length, 'skill')} and ${plural(lib.prompts.length, 'prompt')} in your library, used by ${plural(s.projects.length, 'project')}.`
    : s.store.state === 'absent' ? 'There is no Bowerloom library on this computer yet.' : 'Bowerloom could not read your library.';
  const attention: Attention[] = [];

  for (const p of s.projects) {
    if (p.status === 'ready' || p.status === 'not-set-up') continue;
    const reasons = projectReasons(p);
    const tone: Tone = p.status === 'drifted' ? 'warn' : 'bad';
    const title = p.status === 'lock-problem' ? `The lock file of ${p.name} has a problem` : p.status === 'unreadable' ? `Bowerloom cannot open ${p.name}` : `${p.name} has drifted`;
    attention.push({
      id: `project:${p.key}`, tone, title, body: reasons.length ? reasons.join(' ') : STATUS_SENTENCE[p.status],
      todo: p.status === 'lock-problem' ? 'Ask the person who looks after this project to rebuild the lock file. Until then, nothing can be confirmed.' : p.status === 'unreadable' ? 'Move the project somewhere Bowerloom can open it, such as a plain folder in your home folder.' : 'Open the project to see what is different. A person then brings it back in line.',
      technical: [p.lockCode, p.configCode, p.openCode].filter(Boolean).join(', ') || null, link: { screen: 'project', key: p.key },
    });
    for (const a of p.agents) {
      if (a.hold === null) continue;
      attention.push({
        id: `agent:${p.key}:${a.role}`, tone: 'warn', title: `Helper "${a.role}" is waiting for a review`, body: `${codeWords(a.hold.code)} It belongs to the project ${p.name}.`,
        todo: 'A person should read the helper\'s file and decide whether its powers are right before it is installed.', technical: a.hold.code, link: { screen: 'project', key: p.key },
      });
    }
  }
  for (const f of s.folders) {
    if (f.state === 'missing') attention.push({ id: `folder:${f.name}`, tone: 'warn', title: `The knowledge folder "${f.name}" is missing`, body: `Bowerloom saved ${f.path ?? 'its place'} but nothing is there now.`, todo: 'Put the folder back where it was, or ask the person who looks after Bowerloom to remove the saved place.', technical: null, link: { screen: 'folders' } });
    else if (f.state === 'refused') attention.push({ id: `folder:${f.name}`, tone: 'bad', title: `The knowledge folder "${f.name}" cannot be used`, body: codeWords(f.code), todo: 'Ask the person who looks after Bowerloom to check the folder.', technical: f.code, link: { screen: 'folders' } });
  }
  const st = s.store;
  if (st.state === 'absent') attention.push({ id: 'store:absent', tone: 'quiet', title: 'No library yet', body: 'The .bowerloom folder is not in your home folder, so there are no skills, prompts, or teams to show.', todo: 'It is made the first time you create something with Bowerloom.', technical: null, link: { screen: 'storage' } });
  else if (st.state !== 'ready') attention.push({ id: 'store:problem', tone: 'bad', title: 'Your library has a problem', body: st.state === 'foreign' ? codeWords('STORE_INVALID') : codeWords(st.code), todo: 'Ask the person who looks after Bowerloom to check the .bowerloom folder in your home folder.', technical: st.code, link: { screen: 'storage' } });
  else {
    if (st.git !== null && st.git.problem !== null) attention.push({ id: 'store:git', tone: 'warn', title: 'Your library is not shared on GitHub yet', body: 'Teammates cannot fetch items that only exist on this computer, so projects that are shared cannot lock them.', todo: 'Ask the person who looks after Bowerloom to put the library on GitHub.', technical: st.git.problem, link: { screen: 'storage' } });
    if (st.gitignoreMissing) attention.push({ id: 'store:gitignore', tone: 'warn', title: 'The library may share private files', body: 'The library\'s ignore list is missing lines that keep this computer\'s own files out of GitHub.', todo: 'Ask the person who looks after Bowerloom to add them.', technical: null, link: { screen: 'storage' } });
    if (st.foldersTracked) attention.push({ id: 'store:folders', tone: 'warn', title: 'Knowledge folder records are tracked by git', body: 'They may be shared when the library is next pushed.', todo: 'Ask the person who looks after Bowerloom to stop tracking them.', technical: null, link: { screen: 'storage' } });
    if (st.leftovers.length) attention.push({ id: 'store:leftovers', tone: 'quiet', title: 'Leftover files in the library', body: `${plural(st.leftovers.length, 'temporary file')} from a change that stopped part way.`, todo: 'The next change removes them by itself.', technical: null, link: { screen: 'storage' } });
  }
  for (const pr of s.problems) if (pr.area !== 'store') attention.push({ id: `problem:${pr.area}`, tone: 'bad', title: 'Part of the library could not be read', body: codeWords(pr.code), todo: 'Open Storage to see more.', technical: pr.code, link: { screen: 'storage' } });
  const tokenRelevant = st.git?.remote != null || s.projects.some(p => p.shared);
  if (st.token !== 'set' && tokenRelevant) attention.push({ id: 'token', tone: 'quiet', title: st.token === 'invalid' ? 'The GitHub access key looks wrong' : 'No GitHub access key is set', body: 'Without a key, this computer can only fetch public files from GitHub. Private shared items cannot be fetched.', todo: 'If your shared library is private, ask the person who looks after Bowerloom to set the key. The viewer never shows it.', technical: null, link: { screen: 'storage' } });
  for (const r of s.scan.roots) if (!r.ok) attention.push({ id: `root:${r.path}`, tone: 'warn', title: 'A folder you added cannot be searched', body: `${r.path}: ${r.reason ?? ''}`, todo: 'Open Settings to remove it or add it again.', technical: null, link: { screen: 'settings' } });
  if (s.scan.truncated) attention.push({ id: 'scan:truncated', tone: 'quiet', title: 'Not every project is shown', body: 'The search stopped early because it found a lot of folders.', todo: 'Add a smaller folder in Settings.', technical: null, link: { screen: 'settings' } });
  const order: Record<string, number> = { bad: 0, warn: 1, quiet: 2, good: 3 };
  attention.sort((a, b) => (order[a.tone] ?? 2) - (order[b.tone] ?? 2));
  return { sentence, counts, attention };
}

// ---------------------------------------------------------------------------------------------------------- library

export interface LibraryRow { kind: ItemKind; id: string; label: string; origin: string; originTone: Tone; version: string; used: string; usedBy: string[]; problem: string | null }
export function libraryRows(s: Snapshot, kind: ItemKind): LibraryRow[] {
  const list = kind === 'skill' ? s.library.skills : kind === 'prompt' ? s.library.prompts : s.library.teams;
  return list.map(i => ({
    kind, id: i.id, label: titleOf(i.id), origin: ORIGIN_WORDS[i.origin], originTone: i.origin === 'yours' ? 'good' : 'quiet', version: pinWords(i.pin, i.origin),
    used: i.usedBy.length === 0 ? 'Not used by any project' : `Used by ${plural(i.usedBy.length, 'project')}`, usedBy: i.usedBy,
    problem: i.problem === null ? null : 'The folder for this skill is missing from your library.',
  }));
}

// -------------------------------------------------------------------------------------------------------------- item

const POWER_KEYS: [RegExp, string][] = [
  [/^permissionMode:\s*["']?bypassPermissions["']?\s*$/m, 'Skips permission questions (bypassPermissions)'],
  [/^hooks:/m, 'Runs commands by itself (hooks)'],
  [/^mcpServers:/m, 'Connects to outside tools (mcpServers)'],
];
export function powerfulSettings(text: string | null): string[] {
  if (text === null) return [];
  const m = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, '\n'));
  if (m === null) return [];
  return POWER_KEYS.filter(([re]) => re.test(m[1]!)).map(([, label]) => label);
}
export const noticeWords = (notice: string): string | null =>
  notice === 'permissionMode:bypassPermissions' ? 'Skips permission questions (bypassPermissions)' : notice === 'hooks' ? 'Runs commands by itself (hooks)' : notice === 'mcpServers' ? 'Connects to outside tools (mcpServers)' : null;

export interface ItemDetail {
  title: string; kindWords: string; what: string; origin: string; version: string; usedBy: { key: string; name: string }[];
  files: { path: string; text: string | null; note: string | null; powers: string[] }[]; pinned: string[] | null; note: string | null; powers: string[];
}
export function itemDetail(s: Snapshot, kind: ItemKind, id: string, content: ItemContent | null, projectKey: string | null): ItemDetail {
  const lib = (kind === 'skill' ? s.library.skills : kind === 'prompt' ? s.library.prompts : s.library.teams).find(i => i.id === id);
  const project = projectKey === null ? undefined : s.projects.find(p => p.key === projectKey);
  const row = project?.items.find(i => i.kind === kind && i.id === id);
  const origin = lib?.origin ?? row?.origin ?? 'yours';
  const pin = lib?.pin ?? row?.pin ?? null;
  const files = (content?.files ?? []).map(f => ({ path: f.path, text: f.text, note: f.note, powers: f.path.includes('agents/') ? powerfulSettings(f.text) : [] }));
  return {
    title: titleOf(id), kindWords: KIND_WORDS[kind].one, what: KIND_WORDS[kind].what, origin: ORIGIN_WORDS[origin], version: pinWords(pin, origin),
    usedBy: (lib?.usedBy ?? (project ? [project.key] : [])).map(key => ({ key, name: pathName(key) })), files, pinned: content?.pinned?.lines ?? null, note: content?.note ?? null,
    powers: [...new Set(files.flatMap(f => f.powers))],
  };
}

// ----------------------------------------------------------------------------------------------------------- projects

export interface ProjectRow { key: string; name: string; dir: string; chip: Chip; summary: string }
export function projectRows(s: Snapshot): ProjectRow[] {
  return s.projects.map(p => ({
    key: p.key, name: p.name, dir: p.dir, chip: STATUS_CHIP[p.status],
    summary: p.status === 'not-set-up' ? 'No project list yet' : p.status === 'unreadable' ? codeWords(p.openCode) : `${plural(p.items.filter(i => i.kind === 'skill').length, 'skill')}, ${plural(p.items.filter(i => i.kind === 'prompt').length, 'prompt')}, ${plural(p.items.filter(i => i.kind === 'team').length, 'team')}`,
  }));
}

export interface ProjectDetail {
  name: string; dir: string; chip: Chip; sentence: string; reasons: string[]; technical: string[];
  items: { kind: ItemKind; id: string; label: string; origin: string; version: string; from: string; match: { text: string; tone: Tone }; hold: string | null }[];
  agents: { role: string; team: string | null; status: string; tone: Tone; powers: string[]; slices: string[] }[];
  slices: SliceGroup[];
  config: string[]; lock: string[]; lockSentence: string;
}
export interface SliceModel {
  id: string; folder: string | null; where: string; files: string; stateLabel: 'Live' | 'Held'; state: string; tone: Tone;
  /** One plain sentence, only when the slice is held. */
  reason: string | null; wants: string | null; permission: string | null; agents: string[]; technical: string | null;
  bars: { role: string; start: number; whole: number; startText: string; wholeText: string; percent: number; sentence: string }[]; hold: string | null;
}
export interface SliceGroup { folder: string; slices: SliceModel[]; conflict: string | null }

export function lockSentence(p: ProjectData): string {
  switch (p.lockState) {
    case 'valid': return 'The lock file is good. It records the exact versions this project uses.';
    case 'not-used': return 'This project does not need a lock file. It is not shared with other people.';
    case 'absent': return 'This project is shared but has no lock file yet, so teammates could get different versions.';
    case 'stale': return 'The lock file is out of date. Something in the library changed after it was written.';
    case 'invalid': return codeWords(p.lockCode ?? 'LOCK_INVALID');
    case 'mismatch': return codeWords('LOCK_CONFIG_MISMATCH');
    case 'orphan': return 'There is a lock file, but the project has no project list for it to lock.';
    default: return 'The state of the lock file is unknown.';
  }
}

export function configLines(p: ProjectData): string[] {
  if (p.configState === 'absent') return ['This project has no project list (bowerloom.json).'];
  if (p.configState === 'invalid') return [codeWords(p.configCode)];
  const by = (k: ItemKind) => p.items.filter(i => i.kind === k);
  const list = (k: ItemKind): string => { const items = by(k); return items.length === 0 ? `It uses no ${KIND_WORDS[k].many.toLowerCase()}.` : `It uses ${plural(items.length, KIND_WORDS[k].one.toLowerCase())}: ${items.map(i => `${i.id} (${i.from === 'store' ? 'from your library' : 'made in this project'})`).join(', ')}.`; };
  return [list('team'), list('skill'), list('prompt')];
}

const RANK = { none: 0, heading: 1, frontmatter: 2 } as const;
const styleWords = (style: 'none' | 'heading' | 'frontmatter', key: string | null): string => style === 'none' ? 'no text from the files' : style === 'heading' ? 'each file\'s first heading' : `each file's \`${key ?? 'key'}\``;
const allowedWords = (style: 'none' | 'heading' | 'frontmatter', key: string | null): string => style === 'none' ? 'only the file names' : style === 'heading' ? 'headings' : `the \`${key ?? 'key'}\` of each file`;

/** Why a slice is held, in one sentence of plain words, or null when it is live. */
export function sliceReason(sl: ProjectData['slices'][number]): string | null {
  if (sl.grantStyle === 'unset') return 'An older permission without a style needs to be set again.';
  if (sl.grantStyle !== null && sl.wants !== null && (RANK[sl.wants] > RANK[sl.grantStyle] || (sl.wants === 'frontmatter' && sl.grantStyle === 'frontmatter' && sl.wantsKey !== sl.grantKey))) {
    return `This reading list wants to show ${styleWords(sl.wants, sl.wantsKey)}, but this project was only allowed to show ${allowedWords(sl.grantStyle, sl.grantKey)}.`;
  }
  if (sl.hold === null) return null;
  if (sl.hold.code === 'FOLDER_NOT_ALLOWED') return 'This folder has not been allowed for this project yet.';
  const words = codeWords(sl.hold.code);
  return words.includes('no plain words') ? 'Bowerloom is holding this reading list back. The technical name is below.' : words;
}

export function sliceModels(p: ProjectData): SliceModel[] {
  return p.slices.map(sl => {
    const bars = p.measure.filter(m => sl.agents.includes(m.role)).map(m => {
      const pct = m.baselineBytes === 0 ? 100 : Math.min(100, Math.round(m.startBytes / m.baselineBytes * 100));
      return { role: m.role, start: m.startBytes, whole: m.baselineBytes, startText: humanBytes(m.startBytes), wholeText: humanBytes(m.baselineBytes), percent: pct, sentence: `${m.role} reads ${humanBytes(m.startBytes)} at the start instead of ${humanBytes(m.baselineBytes)} if it read every note.` };
    });
    const reason = sliceReason(sl), held = reason !== null;
    return {
      id: sl.id, folder: sl.folder,
      where: sl.rootKind === 'registered' || sl.folder !== null ? `the knowledge folder "${sl.folder ?? sl.rootName}"` : sl.rootKind === 'project' ? 'this project\'s own files' : 'an unknown place',
      files: sl.rootKind === 'unknown' && sl.members === 0 ? 'no files yet' : plural(sl.members, 'file'), stateLabel: held ? 'Held' : 'Live', state: held ? 'Held' : 'Live', tone: held ? 'warn' : 'good',
      reason, wants: sl.wants === null ? null : `Wants to show ${styleWords(sl.wants, sl.wantsKey)}.`,
      permission: sl.grantStyle === null ? null : sl.grantStyle === 'unset' ? 'This project\'s permission for the folder has no style yet.' : `This project may show ${allowedWords(sl.grantStyle, sl.grantKey)}.`,
      agents: sl.agents, bars, hold: reason, technical: sl.hold?.code ?? null,
    };
  });
}

/** The slices of a project, grouped by folder. Two slices on one folder that need different styles are shown together with a note. */
export function sliceGroups(p: ProjectData): SliceGroup[] {
  const models = sliceModels(p), groups = new Map<string, SliceModel[]>();
  models.forEach((m, i) => { const key = m.folder ?? `(${p.slices[i]!.rootKind})`; groups.set(key, [...(groups.get(key) ?? []), m]); });
  return [...groups.entries()].map(([folder, slices]) => {
    const rows = p.slices.filter(sl => (sl.folder ?? `(${sl.rootKind})`) === folder);
    const styled = rows.filter(sl => sl.grantStyle !== null && sl.wants !== null);
    const differ = styled.length >= 2 && new Set(styled.map(sl => `${sl.wants}:${sl.wantsKey ?? ''}`)).size > 1;
    return { folder, slices, conflict: differ ? 'A folder permission holds one style per project, so only one of these can be live.' : null };
  });
}

export function projectDetail(p: ProjectData): ProjectDetail {
  const reasons = projectReasons(p);
  return {
    name: p.name, dir: p.dir, chip: STATUS_CHIP[p.status], sentence: STATUS_SENTENCE[p.status], reasons,
    technical: [...p.drift.map(d => `${d.kind}${d.code ? ` (${d.code})` : ''}: ${d.path}`), ...(p.lockCode ? [p.lockCode] : []), ...(p.unavailable ? [p.unavailable] : [])],
    items: p.items.map(i => ({ kind: i.kind, id: i.id, label: titleOf(i.id), origin: ORIGIN_WORDS[i.origin], version: pinWords(i.pin, i.origin), from: i.from === 'store' ? 'Your library' : 'This project', match: LOCK_MATCH_WORDS[i.lock], hold: i.hold === null ? null : codeWords(i.hold.code) })),
    agents: p.agents.map(a => ({ role: a.role, team: a.team, status: a.hold ? 'Waiting for a review' : a.state === 'new' ? 'Not installed yet' : a.state === 'up-to-date' ? 'Installed' : titleOf(a.state), tone: a.hold ? 'warn' : 'quiet', powers: a.notices.map(noticeWords).filter((x): x is string => x !== null), slices: a.slices })),
    slices: sliceGroups(p), config: configLines(p), lock: p.lockRows.map(r => `${KIND_WORDS[r.kind].one} ${r.id}: ${r.source.replace(/^npm /, 'npm package ')}`), lockSentence: lockSentence(p),
  };
}

// ----------------------------------------------------------------------------------------------------------- folders

export interface FolderRow { name: string; path: string; state: string; tone: Tone; allowed: { key: string; name: string }[]; outdated: { key: string; name: string }[]; note: string; styles: { name: string; text: string }[]; styleNote: string | null }
export function folderRows(s: Snapshot): FolderRow[] {
  const name = (key: string) => ({ key, name: s.projects.find(p => p.key === key)?.name ?? pathName(key) });
  return s.folders.map((f: FolderData) => ({
    name: f.name, path: f.path ?? 'Unknown place', state: f.state === 'ready' ? 'Ready' : f.state === 'missing' ? 'Missing' : 'Cannot be used', tone: f.state === 'ready' ? 'good' : f.state === 'missing' ? 'warn' : 'bad',
    allowed: f.allowed.map(name), outdated: f.outdated.map(name),
    styles: f.allowed.flatMap(key => { const p = s.projects.find(x => x.key === key); const sl = p?.slices.find(x => x.folder === f.name && x.grantStyle !== null); return p && sl ? [{ name: p.name, text: sl.grantStyle === 'unset' ? 'Needs a style' : `May show ${allowedWords(sl.grantStyle!, sl.grantKey)}` }] : []; }),
    styleNote: s.projects.some(p => p.slices.some(x => x.folder === f.name && x.grantStyle !== null)) ? null : 'This version of Bowerloom records only that a project may read the folder. It keeps no style (what may be shown of each file) in the permission.',
    note: f.state === 'ready' ? (f.allowed.length === 0 ? 'No project is allowed to read this folder yet.' : `${plural(f.allowed.length, 'project')} can read it.`) : codeWords(f.code) || 'The folder is not at its saved place.',
  }));
}
export function slicesByProject(s: Snapshot): { project: ProjectRow; slices: SliceGroup[] }[] {
  const rows = projectRows(s);
  return s.projects.filter(p => p.slices.length > 0).map(p => ({ project: rows.find(r => r.key === p.key)!, slices: sliceGroups(p) }));
}

// ------------------------------------------------------------------------------------------------------------ storage

export function cacheSummary(c: CacheData): string {
  if (c.state === 'unavailable') return 'The saved copies could not be listed.';
  if (c.totalEntries === 0) return 'Nothing is saved yet. Copies appear here after items are downloaded from GitHub or npm.';
  return `${plural(c.totalEntries, 'saved copy', 'saved copies')}, ${humanBytes(c.totalBytes)}${c.unknownSize ? ` and ${c.unknownSize} of unknown size` : ''}.`;
}
export function storeSummary(st: StoreData): { location: string; state: string; git: string; token: string; lines: string[] } {
  const git = st.git === null ? 'Not checked.' : st.git.problem === null ? `Shared on GitHub at ${st.git.remote?.replace('https://', '')}, on the branch "${st.git.branch}". Everything is pushed.` : st.git.problem === 'none' ? 'Not shared. The library is not a git folder, so it lives only on this computer.' : st.git.problem === 'no-origin' ? 'Kept in git here, but not connected to GitHub.' : st.git.problem === 'unpushed' ? 'Connected to GitHub, but the newest changes are not pushed yet.' : 'The GitHub connection could not be checked.';
  return {
    location: st.path,
    state: st.state === 'ready' ? 'Ready' : st.state === 'absent' ? 'No library yet' : st.state === 'foreign' ? 'Not a Bowerloom library' : st.state === 'refused' ? 'Not safe to use' : 'Could not be read',
    git, token: st.token === 'set' ? 'A GitHub access key is set on this computer.' : st.token === 'invalid' ? 'A GitHub access key is set, but it does not look right.' : 'No GitHub access key is set.',
    lines: st.counts === null ? [] : [plural(st.counts.skills, 'skill folder'), st.counts.pinned === null ? 'Fixed-version skills could not be counted' : plural(st.counts.pinned, 'fixed-version skill'), plural(st.counts.prompts, 'prompt'), plural(st.counts.teams, 'team')],
  };
}
