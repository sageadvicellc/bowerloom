/** A made-up snapshot with about `n` things on the map: workspaces, projects, teams, helpers, skills. For speed tests only. */
import type { ProjectData, Snapshot } from '../../shared/types.js';

export function syntheticSnapshot(n: number): Snapshot {
  const projects: ProjectData[] = [];
  const base = (key: string, name: string, role: ProjectData['role']): ProjectData => ({
    key, name, dir: key, layout: 'library', role, roleGuess: role, roleChosen: false, pages: null, readBy: [], ownedEdited: [], gitCommon: null, label: name, status: 'ready', openCode: null, setup: null, configState: 'valid', configCode: null,
    lockState: 'valid', lockCode: null, drift: [], notes: [], storeCode: null, unavailable: null, items: [], agents: [], slices: [], held: [], measure: [], measureCode: null, baselineBytes: null, baselineFiles: null, lockRows: [], shared: false,
  });
  let count = 1;
  for (let w = 0; count < n; w++) {
    const ws = base(`/synthetic/ws${w}`, `ws${w}`, 'workspace'); projects.push(ws); count++;
    for (let p = 0; p < 5 && count < n; p++) {
      const proj = base(`/synthetic/ws${w}/p${p}`, `p${w}-${p}`, 'project'); count++;
      for (let t = 0; t < 2; t++) { proj.items.push({ kind: 'team', id: `team-${t}`, from: 'project', via: [], resolvedFrom: 'project', origin: 'yours', pin: null, hold: null, lock: 'not-used', note: null }); proj.agents.push({ role: `agent-${t}`, team: `team-${t}`, state: 'new', action: 'install', hold: null, notices: [], slices: [] }); count += 2; }
      for (let s = 0; s < 10; s++) { proj.items.push({ kind: 'skill', id: `skill-${s}`, from: 'project', via: ['team-0'], resolvedFrom: 'project', origin: 'yours', pin: null, hold: null, lock: 'not-used', note: null }); count++; }
      projects.push(proj);
    }
  }
  return {
    mode: 'sample', at: new Date().toISOString(), problems: [], folders: [], projects, cache: { state: 'ok', code: null, entries: [], totalBytes: 0, totalEntries: 0, unknownSize: 0, unlisted: 0, truncated: false, unreadable: [] },
    scan: { roots: [], skipped: [], truncated: false, found: projects.length, depthReached: false, skippedMore: false, depthLimit: 4, linkedFolders: [], linkedFoldersTotal: 0, depthFolders: [], unopenedFolders: 0, exampleFolders: [], exampleFoldersTotal: 0 },
    store: { state: 'absent', code: null, path: '/synthetic/.bowerloom', message: null, git: null, gitignoreMissing: false, foldersTracked: false, leftovers: [], token: 'not-set', counts: null },
    library: { skills: [], prompts: [], teams: [], unlisted: 0, pinsError: null, failed: null },
  };
}
