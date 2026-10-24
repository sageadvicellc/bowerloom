/**
 * What each screen says, in plain words, worked out from the snapshot. Pure functions: no file, no window.
 * The renderer only draws these results.
 */
import type { CacheData, FolderData, FolderRole, ItemContent, ItemKind, LibraryItem, LockMatch, ProjectData, ProjectItem, ProjectStatus, Snapshot, StoreData } from './types.js';
import { KIND_WORDS, ORIGIN_WORDS, codeWords, humanBytes, isPowerful, plural, powerWords, titleOf } from './words.js';

export type Tone = 'good' | 'warn' | 'bad' | 'quiet';
export interface Chip { label: string; tone: Tone }
export interface Link { screen: 'home' | 'map' | 'graph' | 'library' | 'item' | 'projects' | 'project' | 'folders' | 'storage' | 'settings'; kind?: ItemKind; id?: string; key?: string; fromProject?: string }

// ------------------------------------------------------------------------------------------------------------- chips

export const STATUS_CHIP: Record<ProjectStatus, Chip> = {
  ready: { label: 'Ready', tone: 'good' },
  'not-locked': { label: 'Nothing locked yet', tone: 'quiet' },
  drifted: { label: 'Drifted', tone: 'warn' },
  'lock-problem': { label: 'Lock problem', tone: 'bad' },
  'not-set-up': { label: 'Not set up', tone: 'quiet' },
  unreadable: { label: 'Cannot open', tone: 'bad' },
};

export const ROLE_WORDS: Record<FolderRole, { label: string; what: string }> = {
  project: { label: 'Project', what: 'A folder of work that uses Bowerloom.' },
  workspace: { label: 'Workspace', what: 'A folder that holds other Bowerloom folders, the layers of one body of work.' },
  'context-store': { label: 'Context store', what: 'The central store of knowledge that projects read from. It is not a project.' },
};
/** The chip of a folder that is not a project: neutral words, since "drifted" belongs to projects. */
export function chipFor(p: ProjectData): Chip { return p.role === 'project' || p.status === 'ready' || p.status === 'unreadable' || p.status === 'lock-problem' ? STATUS_CHIP[p.status] : { label: 'Setup differs', tone: 'warn' }; }

export const STATUS_SENTENCE: Record<ProjectStatus, string> = {
  ready: 'Everything this project asks for is in place and matches what was locked.',
  'not-locked': 'Everything this project asks for is in place. Nothing is locked yet, so there is no saved version to compare it with.',
  drifted: 'This project has drifted: what it asks for does not match what is saved or locked, or something could not be checked. A person needs to look at it.',
  'lock-problem': 'The lock file of this project has a problem, so Bowerloom cannot confirm that it uses the versions it should.',
  'not-set-up': 'This folder has no project list yet, so Bowerloom is not managing anything here.',
  unreadable: 'Bowerloom could not open this project, so nothing about it can be shown.',
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

export interface Attention { id: string; tone: Tone; title: string; body: string; todo: string; technical: string | null; link: Link | null; /** When several projects share one problem: each of them. */ members?: { key: string; name: string }[] }

/**
 * One row for each repository: checkouts of one repository (git work trees that share a git folder) are shown once, with a count of
 * the other places. The shortest path is the one shown. A folder that is not a git checkout is always its own row.
 */
export function representatives(projects: readonly ProjectData[]): { project: ProjectData; alsoIn: number }[] {
  const groups = new Map<string, ProjectData[]>(), out: { project: ProjectData; alsoIn: number }[] = [];
  for (const p of projects) { if (p.gitCommon === null) { out.push({ project: p, alsoIn: 0 }); continue; } groups.set(p.gitCommon, [...(groups.get(p.gitCommon) ?? []), p]); }
  for (const list of groups.values()) { const sorted = [...list].sort((a, b) => a.dir.length - b.dir.length || (a.dir < b.dir ? -1 : 1)); out.push({ project: sorted[0]!, alsoIn: sorted.length - 1 }); }
  const order = new Map(projects.map((p, i) => [p.key, i])); return out.sort((a, b) => order.get(a.project.key)! - order.get(b.project.key)!);
}

const pathName = (key: string): string => key.split('/').filter(Boolean).pop() ?? key;

/** What one kind of difference means, in plain words. The file or folder is in the details, not here. */
const DRIFT_WORDS: Record<string, string> = {
  missing: 'A file that Bowerloom set up is missing.', changed: 'A file that Bowerloom set up has changed.', unsafe: 'Something in the setup is not safe for Bowerloom to read: a shortcut, or a file other people can change.',
  unexpected: 'Bowerloom\'s setup check found something in this project that it did not expect.', 'invalid-receipt': 'The record of the setup (the receipt) cannot be read.',
  'installation-binding-changed': 'This folder moved, or was copied, since it was set up.', 'compiler-failed': 'The team description could not be put together again.',
  'revision-pending': 'A change to this project was started and not finished.', 'owner-refused': 'A part of the setup was refused by the check that owns it.',
};
function driftWords(kind: string, layout: ProjectData['layout']): string { return DRIFT_WORDS[kind] ?? (layout === 'older' ? 'Bowerloom\'s check found a difference that this viewer cannot describe. It is in the details.' : 'Something differs from what was set up.'); }

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
  for (const h of p.held) {
    if (h.kind === 'agent') out.push(`Helper "${h.id}": ${codeWords(h.code)}`);
    else if (h.kind === 'slice') { const row = p.slices.find(x => x.id === h.id); out.push(`Reading list "${h.id}": ${(row === undefined ? null : sliceReason(row)) ?? codeWords(h.code)}`); }
  }
  for (const d of p.drift) {
    if (d.kind === 'resolve-error') out.push(codeWords(d.code));
    else if (!['config-invalid', 'lock-invalid', 'lock-orphan'].includes(d.kind)) out.push(driftWords(d.kind, p.layout));
  }
  if (p.ownedEdited.length > 0 && p.status !== 'ready') out.push(`${plural(p.ownedEdited.length, 'file')} that Bowerloom manages ${p.ownedEdited.length === 1 ? 'was' : 'were'} edited by hand.`);
  if (p.layout === 'older' && p.status === 'drifted' && out.length === 0) out.push('Bowerloom\'s own check says this differs from what was set up, but did not say what. Everything it reported is in the details.');
  if (p.storeCode !== null) out.push(codeWords(p.storeCode));
  if (p.unavailable !== null) out.push(codeWords(p.unavailable));
  if (p.lockState === 'absent') out.push('This project is shared but has no lock file yet.');
  for (const sl of p.slices) if (sl.grantStyle === 'unknown') out.push(`Reading list "${sl.id}": could not check the folder. ${codeWords(sl.grantCode)}`);
  return [...new Set(out.filter(Boolean))];
}
export const reasonsOf = projectReasons;

export interface HomeModel {
  sentence: string; counts: { label: string; value: number | null; link: Link }[]; attention: Attention[];
  /** `library`: the numbers are the shared library's. `projects`: there is no library, so they are what the projects hold. */
  countsFrom: 'library' | 'projects';
  /** Real data with no project folder chosen: Home asks for one and never says "All clear". */
  needsFolder: boolean; sample: boolean; asOf: string;
}

/** "As of 4:12 PM". The time the data was read. */
export function asOfText(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? 'As of an unknown time' : `As of ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** The things that may hide a project from the list: limits of the search, and folders that were not searched. */
function scanCauses(s: Snapshot): string[] {
  const out: string[] = [];
  if (s.scan.truncated) out.push('The search stopped early because it found a lot of folders or projects.');
  if (s.scan.depthReached) out.push(`The search looks ${s.scan.depthLimit} folders deep. It reached that limit in ${s.scan.depthFolders.slice(0, 3).map(n => `"${n}"`).join(', ')}${s.scan.depthFolders.length > 3 ? `, and ${s.scan.depthFolders.length - 3} more places` : ''}, so a project further inside would not be found.`);
  if (s.scan.unopenedFolders > 0) out.push(`${plural(s.scan.unopenedFolders, 'folder')} could not be opened, so what is inside ${s.scan.unopenedFolders === 1 ? 'it' : 'them'} was not searched.`);
  if (s.scan.linkedFoldersTotal > 0) out.push(`${plural(s.scan.linkedFoldersTotal, 'folder')} that ${s.scan.linkedFoldersTotal === 1 ? 'is a shortcut was' : 'are shortcuts were'} not searched: ${s.scan.linkedFolders.join(', ')}${s.scan.linkedFoldersTotal > s.scan.linkedFolders.length ? ', and more' : ''}.`);
  return out;
}

export function homeModel(s: Snapshot): HomeModel {
  const lib = s.library, failed = lib.failed !== null, reps = representatives(s.projects);
  const noLibrary = s.store.state === 'absent';
  const held = (kind: ItemKind): number => reps.reduce((n, r) => n + r.project.items.filter(i => i.kind === kind).length, 0);
  const fromProjects = noLibrary && reps.length > 0;
  const n = (list: unknown[], kind: ItemKind): number | null => fromProjects ? held(kind) : failed ? null : list.length;
  const counts = [
    { label: 'Teams', value: n(lib.teams, 'team'), link: { screen: fromProjects ? 'projects' : 'library', kind: 'team' } as Link },
    { label: 'Skills', value: n(lib.skills, 'skill'), link: { screen: fromProjects ? 'projects' : 'library', kind: 'skill' } as Link },
    { label: 'Prompts', value: n(lib.prompts, 'prompt'), link: { screen: fromProjects ? 'projects' : 'library', kind: 'prompt' } as Link },
    { label: 'Projects', value: reps.filter(r => r.project.role === 'project').length, link: { screen: 'projects' } as Link },
  ];
  const sentence = fromProjects
    ? `Across your ${plural(reps.filter(r => r.project.role === 'project').length, 'project')}${reps.some(r => r.project.role !== 'project') ? ' and the folders around them' : ''}, you have ${plural(held('team'), 'team')}, ${plural(held('skill'), 'skill')} and ${plural(held('prompt'), 'prompt')}. The shared library (the newer beta.3 store) is not set up yet, and that is normal.`
    : failed ? 'Your library could not be read, so the numbers of teams, skills and prompts are not known.'
    : s.store.state === 'ready'
      ? `You have ${plural(lib.teams.length, 'team')}, ${plural(lib.skills.length, 'skill')} and ${plural(lib.prompts.length, 'prompt')} in your library, used by ${plural(reps.filter(r => r.project.role === 'project').length, 'project')}.`
      : noLibrary ? 'The shared library (the newer beta.3 store) is not set up yet, and that is normal. No project was found to show.' : 'Bowerloom could not read your library.';
  const attention: Attention[] = [];
  const needsFolder = s.mode === 'real' && s.scan.roots.length === 0;

  // Projects with one and the same problem are one card, with the list of projects, so a repeated card never buries the rest.
  const groups = new Map<string, { first: Attention; members: { key: string; name: string }[] }>();
  for (const { project: p } of reps) {
    if (p.status === 'ready' || p.status === 'not-set-up') continue;
    const reasons = projectReasons(p);
    const older = p.layout === 'older';
    const tone: Tone = p.status === 'drifted' ? 'warn' : 'bad';
    const noun = p.role === 'context-store' ? `${p.name} (context store)` : p.role === 'workspace' ? `${p.name} (workspace)` : p.name;
    const title = p.status === 'lock-problem' ? `The lock file of ${p.name} has a problem` : p.status === 'unreadable' ? `Bowerloom cannot open ${p.name}` : older || p.role !== 'project' ? `${noun} differs from what was set up` : `${p.name} has drifted`;
    const body = reasons.length ? reasons.join(' ') : STATUS_SENTENCE[p.status];
    const card: Attention = {
      id: `project:${p.key}`, tone, title, body,
      todo: p.status === 'lock-problem' ? 'Ask the person who looks after this project to rebuild the lock file. Until then, nothing can be confirmed.' : p.status === 'unreadable' ? 'Move the project somewhere Bowerloom can open it, such as a plain folder in your home folder.' : 'Open the project to see what is different. A person then brings it back in line.',
      technical: [p.lockCode, p.configCode, p.openCode].filter(Boolean).join(', ') || null, link: { screen: 'project', key: p.key },
    };
    const key = `${tone}|${p.status}|${body}|${card.todo}`, found = groups.get(key);
    if (found === undefined) groups.set(key, { first: card, members: [{ key: p.key, name: p.name }] }); else found.members.push({ key: p.key, name: p.name });
    for (const a of p.agents) {
      if (a.hold === null) continue;
      attention.push({
        id: `agent:${p.key}:${a.role}`, tone: 'warn', title: `Helper "${a.role}" is waiting for a review`, body: `${codeWords(a.hold.code)} It belongs to the project ${p.name}.`,
        todo: 'A person should read the helper\'s file and decide whether its powers are right before it is installed.', technical: a.hold.code, link: { screen: 'project', key: p.key },
      });
    }
  }
  for (const { first, members } of groups.values()) attention.push(members.length === 1 ? first : { ...first, id: `group:${first.id}`, title: `${members.length} projects share this problem`, members, link: { screen: 'projects' } });
  for (const f of s.folders) {
    if (f.state === 'missing') attention.push({ id: `folder:${f.name}`, tone: 'warn', title: `The knowledge folder "${f.name}" is missing`, body: `Bowerloom saved ${f.path ?? 'its place'} but nothing is there now.`, todo: 'Put the folder back where it was, or ask the person who looks after Bowerloom to remove the saved place.', technical: null, link: { screen: 'folders' } });
    else if (f.state === 'refused') attention.push({ id: `folder:${f.name}`, tone: 'bad', title: `The knowledge folder "${f.name}" cannot be used`, body: codeWords(f.code), todo: 'Ask the person who looks after Bowerloom to check the folder.', technical: f.code, link: { screen: 'folders' } });
  }
  const st = s.store;
  if (st.state === 'absent') attention.push({ id: 'store:absent', tone: 'quiet', title: 'The shared library is not set up yet', body: 'This is normal. The shared library is a newer feature (beta.3) that lets many projects use the same skills, prompts and teams. Until it is set up, each project keeps its own, and they are listed under Projects.', todo: 'Nothing to do. You do not need the library to look at your projects.', technical: null, link: { screen: 'projects' } });
  else if (st.state !== 'ready') attention.push({ id: 'store:problem', tone: 'bad', title: 'Your library has a problem', body: st.state === 'foreign' ? codeWords('STORE_INVALID') : codeWords(st.code), todo: 'Ask the person who looks after Bowerloom to check the .bowerloom folder in your home folder.', technical: st.code, link: { screen: 'storage' } });
  else {
    if (st.git !== null && st.git.problem !== null) attention.push({ id: 'store:git', tone: 'warn', title: 'Your library is not shared on GitHub yet', body: 'Teammates cannot fetch items that only exist on this computer, so projects that are shared cannot lock them.', todo: 'Ask the person who looks after Bowerloom to put the library on GitHub.', technical: st.git.problem, link: { screen: 'storage' } });
    if (st.gitignoreMissing) attention.push({ id: 'store:gitignore', tone: 'warn', title: 'The library may share private files', body: 'The library\'s ignore list is missing lines that keep this computer\'s own files out of GitHub.', todo: 'Ask the person who looks after Bowerloom to add them.', technical: null, link: { screen: 'storage' } });
    if (st.foldersTracked) attention.push({ id: 'store:folders', tone: 'warn', title: 'Knowledge folder records are tracked by git', body: 'They may be shared when the library is next pushed.', todo: 'Ask the person who looks after Bowerloom to stop tracking them.', technical: null, link: { screen: 'storage' } });
    if (st.leftovers.length) attention.push({ id: 'store:leftovers', tone: 'quiet', title: 'Leftover files in the library', body: `${plural(st.leftovers.length, 'temporary file')} from a change that stopped part way.`, todo: 'The next change removes them by itself.', technical: null, link: { screen: 'storage' } });
  }
  for (const pr of s.problems) if (pr.area !== 'store') attention.push({ id: `problem:${pr.area}`, tone: 'bad', title: pr.area === 'folders' ? 'The knowledge folders could not be read' : 'Part of the library could not be read', body: pr.area === 'folders' ? `${codeWords(pr.code)} Which folders exist, and which projects may read them, is not known.` : codeWords(pr.code), todo: pr.area === 'folders' ? 'Choose "Look again". If it keeps happening, ask the person who looks after Bowerloom.' : 'Open Storage to see more.', technical: pr.code, link: { screen: pr.area === 'folders' ? 'folders' : 'storage' } });
  if (failed) attention.push({ id: 'library:failed', tone: 'bad', title: 'Your library could not be read', body: `${codeWords(lib.failed)} The numbers above are not known, and the Library screen may be incomplete.`, todo: 'Choose "Look again". If it keeps happening, ask the person who looks after Bowerloom.', technical: lib.failed, link: { screen: 'storage' } });
  const causes = scanCauses(s);
  if (causes.length > 0 && !needsFolder) attention.push({ id: 'scan:limits', tone: 'warn', title: 'Some projects may be missing', body: causes.join(' '), todo: 'Add the folder that holds the project itself in Settings, so the search starts closer to it.', technical: null, link: { screen: 'settings' } });
  if (s.scan.exampleFoldersTotal > 0) attention.push({ id: 'scan:examples', tone: 'quiet', title: `${plural(s.scan.exampleFoldersTotal, 'example folder')} ${s.scan.exampleFoldersTotal === 1 ? 'was' : 'were'} skipped`, body: `Folders named examples, fixtures, test or tests are not searched, and ${s.scan.exampleFoldersTotal === 1 ? 'one of them holds' : 'these hold'} projects: ${s.scan.exampleFolders.slice(0, 3).join(', ')}${s.scan.exampleFoldersTotal > 3 ? `, and ${s.scan.exampleFoldersTotal - 3} more` : ''}.`, todo: 'To see them, turn on "Also look inside example and test folders" in Settings.', technical: null, link: { screen: 'settings' } });
  const tokenRelevant = st.git?.remote != null || s.projects.some(p => p.shared);
  if (st.token !== 'set' && tokenRelevant) attention.push({ id: 'token', tone: 'quiet', title: st.token === 'invalid' ? 'The GitHub access key looks wrong' : 'No GitHub access key is set', body: 'Without a key, this computer can only fetch public files from GitHub. Private shared items cannot be fetched.', todo: 'If your shared library is private, ask the person who looks after Bowerloom to set the key. The viewer never shows it.', technical: null, link: { screen: 'storage' } });
  for (const r of s.scan.roots) if (!r.ok) attention.push({ id: `root:${r.path}`, tone: 'warn', title: 'A folder you added cannot be searched', body: `${r.path}: ${r.reason ?? ''}`, todo: 'Open Settings to remove it or add it again.', technical: null, link: { screen: 'settings' } });
  const order: Record<string, number> = { bad: 0, warn: 1, quiet: 2, good: 3 };
  attention.sort((a, b) => (order[a.tone] ?? 2) - (order[b.tone] ?? 2));
  return { sentence, counts, countsFrom: fromProjects ? 'projects' : 'library', attention, needsFolder, sample: s.mode === 'sample', asOf: asOfText(s.at) };
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

export interface ItemDetail {
  title: string; kindWords: string; what: string; origin: string; version: string; usedBy: { key: string; name: string }[];
  files: { path: string; text: string | null; note: string | null; powers: string[] }[]; pinned: string[] | null; note: string | null; powers: string[];
  /** The raw names of the powerful settings, for the Details section only. */
  rawPowers: string[];
}
export function itemDetail(s: Snapshot, kind: ItemKind, id: string, content: ItemContent | null, projectKey: string | null): ItemDetail {
  const lib = (kind === 'skill' ? s.library.skills : kind === 'prompt' ? s.library.prompts : s.library.teams).find(i => i.id === id);
  const project = projectKey === null ? undefined : s.projects.find(p => p.key === projectKey);
  const row = project?.items.find(i => i.kind === kind && i.id === id);
  const origin = lib?.origin ?? row?.origin ?? 'yours';
  const pin = lib?.pin ?? row?.pin ?? null;
  // The plan's notices are the only authority on what a helper may do: file text is never searched for settings.
  const owners = lib?.usedBy ?? (project ? [project.key] : []);
  const agents = kind === 'team' ? s.projects.filter(p => owners.includes(p.key)).flatMap(p => p.agents.filter(a => a.team === id)) : [];
  const noticesOf = (path: string): string[] => { const m = /^agents\/([^/]+)\.md$/.exec(path); return m === null ? [] : agents.filter(a => a.role === m[1]).flatMap(a => a.notices).filter(isPowerful); };
  const files = (content?.files ?? []).map(f => ({ path: f.path, text: f.text, note: f.note, powers: [...new Set(noticesOf(f.path).map(powerWords))] }));
  const raw = [...new Set(agents.flatMap(a => a.notices).filter(isPowerful))];
  return {
    title: titleOf(id), kindWords: KIND_WORDS[kind].one, what: KIND_WORDS[kind].what, origin: ORIGIN_WORDS[origin], version: pinWords(pin, origin),
    usedBy: owners.map(key => ({ key, name: pathName(key) })), files, pinned: content?.pinned?.lines ?? null, note: content?.note ?? null,
    powers: [...new Set(raw.map(powerWords))], rawPowers: raw,
  };
}

// ----------------------------------------------------------------------------------------------------------- projects

export interface ProjectRow { key: string; name: string; dir: string; chip: Chip; summary: string; older: boolean; alsoIn: number; role: FolderRole }
/** Folders of one kind, as rows. The Projects screen shows only projects: the workspace and the context stores have their own places. */
export function rowsOfRole(s: Snapshot, role: FolderRole): ProjectRow[] { return projectRows(s).filter(r => r.role === role); }

export interface ContextStoreRow { key: string; name: string; chip: Chip; pages: string; manages: string[]; readBy: { key: string; name: string; how: string }[]; note: string }
/** Each context store, with what it holds, what manages it, and who reads it. */
export function contextStoreRows(s: Snapshot): ContextStoreRow[] {
  return s.projects.filter(p => p.role === 'context-store').map(p => ({
    key: p.key, name: p.name, chip: chipFor(p), pages: p.pages === null ? 'Pages not counted' : plural(p.pages, 'page'),
    manages: p.items.filter(i => i.note === null).map(i => `${titleOf(i.id)} (${KIND_WORDS[i.kind].one.toLowerCase()})`),
    readBy: p.readBy.map(r => ({ key: r.key, name: r.name, how: r.via === 'permission' ? 'is allowed to read it' : `reads it with the reading list "${r.list}"` })),
    note: p.readBy.length === 0 ? 'No project is allowed to read this store yet.' : `${plural(new Set(p.readBy.map(r => r.key)).size, 'project')} read${p.readBy.length === 1 ? 's' : ''} it.`,
  }));
}

export function projectRows(s: Snapshot): ProjectRow[] {
  return representatives(s.projects).map(({ project: p, alsoIn }) => ({
    key: p.key, name: p.name, dir: p.dir, chip: chipFor(p), older: p.layout === 'older', alsoIn, role: p.role,
    summary: `${p.status === 'not-set-up' ? 'No project list yet' : p.status === 'unreadable' ? codeWords(p.openCode) : `${plural(p.items.filter(i => i.kind === 'skill').length, 'skill')}, ${plural(p.items.filter(i => i.kind === 'prompt').length, 'prompt')}, ${plural(p.items.filter(i => i.kind === 'team').length, 'team')}`}${p.layout === 'older' ? '. Set up the older way' : ''}${alsoIn > 0 ? `. Also checked out in ${plural(alsoIn, 'other place')}` : ''}`,
  }));
}

export interface ProjectDetail {
  /** Set up the older way: a .bowerloom folder, no project list, no lock, no shared library. */
  older: boolean; olderNote: string | null;
  role: FolderRole; roleLabel: string; roleWhat: string; roleChosen: boolean; roleGuessLabel: string;
  name: string; dir: string; chip: Chip; sentence: string; reasons: string[]; technical: string[];
  items: { kind: ItemKind; id: string; label: string; origin: string; version: string; from: string; match: { text: string; tone: Tone }; hold: string | null }[];
  agents: { role: string; team: string | null; status: string; tone: Tone; powers: string[]; rawPowers: string[]; hold: string | null; holdCode: string | null; slices: string[] }[];
  slices: SliceGroup[];
  config: string[]; lock: string[]; lockSentence: string;
  /** Everything technical about the project, for the Details section: where it is, hashes, codes. */
  details: string[];
}
export interface SliceModel {
  id: string; folder: string | null; where: string; files: string; stateLabel: 'Live' | 'Held'; state: string; tone: Tone;
  /** One plain sentence, only when the slice is held. */
  reason: string | null; note: string | null; wants: string | null; permission: string | null; agents: string[]; technical: string | null;
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
  if (p.configState === 'absent' && p.layout !== 'older') return ['This project has no project list (bowerloom.json).'];
  if (p.configState === 'invalid') return [codeWords(p.configCode)];
  const by = (k: ItemKind) => p.items.filter(i => i.kind === k);
  const list = (k: ItemKind): string => { const items = by(k); return items.length === 0 ? `It uses no ${KIND_WORDS[k].many.toLowerCase()}.` : `It uses ${plural(items.length, KIND_WORDS[k].one.toLowerCase())}: ${items.map(i => `${i.id} (${i.from === 'store' ? 'from your library' : p.layout === 'older' ? 'in this project' : 'made in this project'})`).join(', ')}.`; };
  return [list('team'), list('skill'), list('prompt')];
}

type Style = 'none' | 'heading' | 'frontmatter';
const styleWords = (style: Style, key: string | null): string => style === 'none' ? 'no text from the files' : style === 'heading' ? 'each file\'s first heading' : `each file's ${key ?? 'key'}`;
const allowedWords = (style: Style, key: string | null): string => style === 'none' ? 'only the file names' : style === 'heading' ? 'headings' : `the ${key ?? 'key'} of each file`;
const sameStyle = (a: Style | null, ak: string | null, b: Style | null, bk: string | null): boolean => a === b && (a !== 'frontmatter' || ak === bk);

const HOLD_WORDS: Record<string, string> = {
  FOLDER_NOT_ALLOWED: 'This folder has not been allowed for this project yet.',
  SLICE_TOO_LARGE: 'This reading list is too big to load at the start. It needs to be made smaller.',
  SLICE_ROOT_MISSING: 'The folder this reading list points to is not there.',
  SLICE_ROOT_UNSAFE: 'The folder this reading list points to is not safe to read.',
  SLICE_EMPTY: 'This reading list matches no files.',
  SLICE_INVALID: 'The file that describes this reading list is not written the way Bowerloom expects.',
  SLICE_KEY_UNKNOWN: 'The file that describes this reading list uses a setting Bowerloom does not know.',
  SLICE_PATH_MISSING: 'A file or folder this reading list names is not there.',
  SLICE_SOURCE_UNSAFE: 'The file that describes this reading list is not safe to read.',
  SLICE_TARGET_OCCUPIED: 'Something else is already where this reading list would be installed.',
};
const GENERIC_HOLD = 'Bowerloom is holding this reading list back for a reason this viewer cannot describe in plain words yet. The details are below.';

/**
 * Whether a slice is held, and why. ANY hold from Bowerloom means Held, whatever the permission says. The permission only makes the
 * reason more exact: no permission, an older one, or one for another style. A permission that could not be checked is a note, not a verdict.
 */
export function sliceReason(sl: ProjectData['slices'][number]): string | null {
  if (sl.grantStyle !== null && sl.wants !== 'none') {
    if (sl.grantStyle === 'absent') return HOLD_WORDS.FOLDER_NOT_ALLOWED!;
    if (sl.grantStyle === 'unset') return 'An older permission without a style needs to be set again.';
    if (sl.grantStyle !== 'unknown' && sl.wants !== null && !sameStyle(sl.wants, sl.wantsKey, sl.grantStyle, sl.grantKey)) return `This reading list wants to show ${styleWords(sl.wants, sl.wantsKey)}, but this project was only allowed to show ${allowedWords(sl.grantStyle, sl.grantKey)}.`;
  }
  if (sl.hold === null) return null;
  return HOLD_WORDS[sl.hold.code] ?? GENERIC_HOLD;
}
/** A line for a slice whose permission could not be checked. */
export const sliceCheckNote = (sl: ProjectData['slices'][number]): string | null => sl.grantStyle === 'unknown' ? `Could not check this folder: ${codeWords(sl.grantCode)}` : null;

export function sliceModels(p: ProjectData): SliceModel[] {
  return p.slices.map(sl => {
    const bars = p.measure.filter(m => sl.agents.includes(m.role)).map(m => {
      const pct = m.baselineBytes === 0 ? 100 : Math.min(100, Math.round(m.startBytes / m.baselineBytes * 100));
      return { role: m.role, start: m.startBytes, whole: m.baselineBytes, startText: humanBytes(m.startBytes), wholeText: humanBytes(m.baselineBytes), percent: pct, sentence: `${m.role} reads ${humanBytes(m.startBytes)} at the start instead of ${humanBytes(m.baselineBytes)} if it read every note.` };
    });
    const reason = sliceReason(sl), held = reason !== null || sl.hold !== null;
    return {
      id: sl.id, folder: sl.folder,
      where: sl.rootKind === 'registered' || sl.folder !== null ? `the knowledge folder "${sl.folder ?? sl.rootName}"` : sl.rootKind === 'project' ? 'this project\'s own files' : 'an unknown place',
      files: held && sl.members === 0 ? 'Not counted while held' : plural(sl.members, 'file'), stateLabel: held ? 'Held' : 'Live', state: held ? 'Held' : 'Live', tone: held ? 'warn' : 'good',
      reason, note: sliceCheckNote(sl), wants: sl.wants === null ? null : `Wants to show ${styleWords(sl.wants, sl.wantsKey)}.`,
      permission: sl.grantStyle === null || sl.grantStyle === 'unknown' ? null : sl.grantStyle === 'absent' ? 'This project has no permission for this folder.' : sl.grantStyle === 'unset' ? 'This project\'s permission for the folder is an older one with no style.' : `This project may show ${allowedWords(sl.grantStyle, sl.grantKey)} from this folder.`,
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
    const styled = rows.filter(sl => sl.grantStyle !== null && sl.grantStyle !== 'unknown' && sl.wants !== null && sl.wants !== 'none');
    const differ = styled.length >= 2 && new Set(styled.map(sl => `${sl.wants}:${sl.wantsKey ?? ''}`)).size > 1;
    return { folder, slices, conflict: differ ? 'A folder permission holds one style per project, so only one of these can be live.' : null };
  });
}

/** `sample-co/shared-store commit 5a3c9e1d, hash 5e8c1ea7` becomes a plain sentence; the commit and hash go in Details. */
export function lockSourceWords(source: string): string {
  if (source.startsWith('npm ')) return `fixed to the npm package ${source.slice(4)}`;
  if (source.startsWith('GitHub ')) return `fixed to a copy on GitHub, ${source.slice(7)}`;
  const m = /^(\S+) commit /.exec(source);
  return m === null ? 'saved in the lock' : `a saved copy from ${m[1]}`;
}
export function projectDetails(p: ProjectData): string[] {
  return [
    `Folder: ${p.dir}`, `Set up: ${p.layout === 'older' ? 'the older way (a .bowerloom folder, no bowerloom.json)' : p.layout === 'library' ? 'with a project list (bowerloom.json)' : 'not set up'}`, ...p.ownedEdited.map(f => `Edited by hand: ${f}`), ...(p.configState !== 'absent' ? ['Project list file: bowerloom.json'] : []), `Lock file state: ${p.lockState}${p.lockCode ? ` (${p.lockCode})` : ''}`,
    ...(p.openCode ? [`Could not open: ${p.openCode}`] : []), ...p.drift.map(d => `Setup check: ${d.kind}${d.code ? ` (${d.code})` : ''}: ${d.path}`), ...(p.unavailable ? [`Plan: ${p.unavailable}`] : []),
    ...p.held.map(h => `Held ${h.kind} ${h.id}: ${h.code}`), ...p.items.filter(i => i.hold).map(i => `Item ${i.kind} ${i.id}: ${i.hold!.code}`),
    ...p.lockRows.map(r => `Lock: ${r.kind} ${r.id}: ${r.source}`), ...p.slices.filter(x => x.grantStyle === 'unknown').map(x => `Reading list ${x.id}: permission check failed (${x.grantCode})`),
  ];
}

export const OLDER_NOTE = 'Set up the older way (a .bowerloom folder). The shared library from beta.3 is not used here yet.';
/** The one sentence under the name of a project that is set up the older way. It lists nothing that is not there to list: the reasons follow it. */
function olderSentence(p: ProjectData): string {
  if (p.status === 'unreadable') return STATUS_SENTENCE.unreadable;
  return p.status === 'ready' ? 'Everything that Bowerloom set up here is in place.' : 'Something differs from what Bowerloom set up here. What differs is listed below.';
}

/** What a context store or a workspace says about itself: it is not a project, so it does not "drift". */
function nonProjectSentence(p: ProjectData): string {
  const what = p.role === 'context-store' ? 'This is a store of knowledge that projects read from. It is not a project.' : 'This is a workspace: a folder that holds other Bowerloom folders. It is not a project.';
  if (p.status === 'ready') return `${what} Its own setup is in place.`;
  if (p.status === 'unreadable') return `${what} Bowerloom could not open it.`;
  return `${what} Its own setup differs from how it was made. What differs is listed below.`;
}

export function projectDetail(p: ProjectData): ProjectDetail {
  const reasons = projectReasons(p);
  const older = p.layout === 'older';
  return {
    older, olderNote: older ? OLDER_NOTE : null,
    role: p.role, roleLabel: ROLE_WORDS[p.role].label, roleWhat: ROLE_WORDS[p.role].what, roleChosen: p.roleChosen, roleGuessLabel: ROLE_WORDS[p.roleGuess].label,
    name: p.name, dir: p.dir, chip: chipFor(p), sentence: p.role !== 'project' ? nonProjectSentence(p) : older ? olderSentence(p) : STATUS_SENTENCE[p.status], reasons,
    technical: [...p.drift.map(d => `${d.kind}${d.code ? ` (${d.code})` : ''}: ${d.path}`), ...(p.lockCode ? [p.lockCode] : []), ...(p.unavailable ? [p.unavailable] : [])],
    items: p.items.map(i => ({ kind: i.kind, id: i.id, label: titleOf(i.id), origin: ORIGIN_WORDS[i.origin], version: pinWords(i.pin, i.origin), from: i.from === 'store' ? 'Your library' : 'This project', match: i.note === 'reserved' ? { text: 'Kept by Bowerloom itself', tone: 'quiet' as Tone } : i.note === 'unlisted' ? { text: 'In the folder, but not listed', tone: 'quiet' as Tone } : older ? { text: 'Part of this project', tone: 'quiet' as Tone } : LOCK_MATCH_WORDS[i.lock], hold: i.hold === null ? null : codeWords(i.hold.code) })),
    agents: p.agents.map(a => ({ role: a.role, team: a.team, status: a.hold ? 'Waiting for a review' : a.state === 'new' ? 'Not installed yet' : a.state === 'up-to-date' ? 'Installed' : titleOf(a.state), tone: a.hold ? 'warn' : 'quiet', powers: [...new Set(a.notices.filter(isPowerful).map(powerWords))], rawPowers: a.notices.filter(isPowerful), hold: a.hold === null ? null : codeWords(a.hold.code), holdCode: a.hold?.code ?? null, slices: a.slices })),
    slices: sliceGroups(p), config: configLines(p), lock: p.lockRows.map(r => `${KIND_WORDS[r.kind].one} ${r.id}: ${lockSourceWords(r.source)}`), lockSentence: lockSentence(p),
    details: projectDetails(p),
  };
}

// ----------------------------------------------------------------------------------------------------------- folders

export interface FolderRow { unknownNotes: string[]; name: string; path: string; state: string; tone: Tone; allowed: { key: string; name: string }[]; outdated: { key: string; name: string }[]; note: string; styles: { name: string; text: string }[]; styleNote: string | null }
export function folderRows(s: Snapshot): FolderRow[] {
  const name = (key: string) => ({ key, name: s.projects.find(p => p.key === key)?.name ?? pathName(key) });
  return s.folders.map((f: FolderData) => ({
    name: f.name, path: f.path ?? 'Unknown place', state: f.state === 'ready' ? 'Ready' : f.state === 'missing' ? 'Missing' : 'Cannot be used', tone: f.state === 'ready' ? 'good' : f.state === 'missing' ? 'warn' : 'bad',
    allowed: f.allowed.map(name), outdated: f.outdated.map(name),
    unknownNotes: f.unknown.map(u => `${name(u.key).name}: could not check the permission. ${codeWords(u.code)}`),
    styles: [...f.styles.map(x => ({ name: name(x.key).name, text: `May show ${allowedWords(x.style, x.styleKey)}` })), ...f.unstyled.map(k => ({ name: name(k).name, text: 'Has an older permission with no style. It needs to be set again' }))],
    styleNote: f.allowed.length + f.unstyled.length === 0 ? null : 'A folder permission holds one style per project: the first heading of each file, or one named key. A reading list that wants another style is held.',
    note: f.state === 'ready' ? (f.unknown.length > 0 ? 'Who may read this folder could not be fully checked.' : f.allowed.length === 0 ? 'No project is allowed to read this folder yet.' : `${plural(f.allowed.length, 'project')} can read it.`) : codeWords(f.code) || 'The folder is not at its saved place.',
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

/** A sentence when the list of knowledge folders could not be read at all. Then no folder count or permission is known. */
export function foldersProblem(s: Snapshot): string | null {
  const p = s.problems.find(x => x.area === 'folders');
  return p === undefined ? null : `${codeWords(p.code)} Which folders exist, and which projects may read them, is not known.`;
}
