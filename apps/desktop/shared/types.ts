/** Plain data that crosses from the main process to the window. JSON only: no class, no function, no path the window can ask for. */

export type Mode = 'sample' | 'real';
export type ItemKind = 'skill' | 'prompt' | 'team';
export type Origin = 'yours' | 'github' | 'npm';
export type ProjectStatus = 'ready' | 'not-locked' | 'drifted' | 'lock-problem' | 'not-set-up' | 'unreadable';

export interface Hold { code: string; next: string }

export interface LibraryItem {
  kind: ItemKind; id: string; origin: Origin;
  /** `package@version` or `owner/repo@commit8`; null for an item that is just your folder. */
  pin: string | null;
  /** The reason the store cannot show this item (for example a skill whose folder is gone), or null. */
  problem: string | null;
  /** Keys of the projects that use it. */
  usedBy: string[];
}

export interface Library {
  skills: LibraryItem[]; prompts: LibraryItem[]; teams: LibraryItem[]; unlisted: number; pinsError: string | null;
  /** The code of why the library could not be read, or null. When set, the counts are not known. */
  failed: string | null;
}

export type LockMatch = 'same' | 'changed' | 'missing' | 'not-used' | 'unknown';
export interface ProjectItem {
  kind: ItemKind; id: string;
  from: 'store' | 'project'; via: string[];
  resolvedFrom: 'store' | 'lock' | 'project';
  origin: Origin; pin: string | null;
  hold: Hold | null; lock: LockMatch;
}
export interface AgentRow {
  role: string; team: string | null; state: string; action: string; hold: Hold | null;
  /** Powerful settings: `hooks`, `mcpServers`, `permissionMode:bypassPermissions`, and the tool notices. */
  notices: string[];
  /** Slice ids the agent loads. */
  slices: string[];
}
export interface SliceRow {
  id: string; state: string; hold: Hold | null;
  rootKind: 'project' | 'registered' | 'unknown'; rootName: string | null; rootPath: string | null;
  members: number; agents: string[];
  /** The registered folder the slice reads, from its definition file (known even when the slice is held). */
  folder: string | null;
  /** What the slice wants to show of each file: nothing, the first heading, or one frontmatter key. */
  wants: 'none' | 'heading' | 'frontmatter' | null; wantsKey: string | null;
  /** What this project's permission for the folder says: no permission (absent), an older one with no style (unset), or a style. Null when the slice has no registered folder. */
  grantStyle: 'absent' | 'unset' | 'unknown' | 'heading' | 'frontmatter' | null; grantKey: string | null;
  /** For `unknown`: the code of what went wrong when the permission was checked. */
  grantCode: string | null;
  /** From `context measure`: the bytes of the index an agent loads, and of the files it points to. */
  indexBytes: number | null; memberBytes: number | null;
}
export interface MeasureRow { role: string; startBytes: number; baselineBytes: number; startTokens: number; baselineTokens: number }
export interface DriftRow { kind: string; path: string; code: string | null }
export interface LockRow { kind: ItemKind; id: string; source: string }

export interface ProjectData {
  key: string; name: string; dir: string;
  /** `library`: uses bowerloom.json and the shared library. `older`: set up the older way, a .bowerloom folder alone. `none`: neither. */
  layout: 'library' | 'older' | 'none';
  /** Files that Bowerloom manages and that were edited by hand (from its own check). */
  ownedEdited: string[];
  /** The git folder that this folder's work tree belongs to, when it is one of several checkouts of one repository. */
  gitCommon: string | null;
  /** What to call it on screen: the folder name, or its path inside the chosen folder when two share a name. */
  label: string;
  status: ProjectStatus;
  /** The refusal code when Bowerloom would not open the folder. */
  openCode: string | null;
  setup: string | null; configState: 'absent' | 'valid' | 'invalid'; configCode: string | null;
  lockState: string; lockCode: string | null;
  drift: DriftRow[]; notes: string[]; storeCode: string | null; unavailable: string | null;
  items: ProjectItem[]; agents: AgentRow[]; slices: SliceRow[]; held: { kind: string; id: string; code: string; next: string }[];
  measure: MeasureRow[]; measureCode: string | null; baselineBytes: number | null; baselineFiles: number | null;
  lockRows: LockRow[];
  shared: boolean;
}

export interface FolderData {
  name: string; path: string | null; state: 'ready' | 'missing' | 'refused'; code: string | null;
  /** Keys of the projects with a valid grant. */
  allowed: string[];
  /** Keys of the projects with a grant file that no longer matches. */
  outdated: string[];
  /** The style each allowed project's permission records. */
  styles: { key: string; style: 'heading' | 'frontmatter'; styleKey: string | null }[];
  /** Projects whose permission is an older one with no style. */
  unstyled: string[];
  /** Projects whose permission could not be checked, and why. */
  unknown: { key: string; code: string }[];
}

export interface CacheRow { id: string; scope: string; label: string | null; status: string; bytes: number | null; files: number | null; usedByStore: boolean | null; usedByProject: boolean | null }
export interface CacheData { state: 'ok' | 'unavailable'; code: string | null; entries: CacheRow[]; totalBytes: number; totalEntries: number; unknownSize: number; unlisted: number; truncated: boolean; unreadable: string[] }

export interface StoreData {
  state: 'ready' | 'absent' | 'foreign' | 'refused' | 'unreadable';
  code: string | null; path: string; message: string | null;
  git: { problem: string | null; remote: string | null; branch: string | null; head: string | null; pushed: string | null } | null;
  gitignoreMissing: boolean; foldersTracked: boolean; leftovers: string[];
  token: 'set' | 'not-set' | 'invalid';
  counts: { skills: number; pinned: number | null; prompts: number; teams: number } | null;
}

export interface ScanInfo {
  roots: { path: string; ok: boolean; reason: string | null }[]; skipped: { path: string; reason: string }[]; truncated: boolean; found: number;
  /** True when some folder at the deepest level searched had folders below it that were not looked into. */
  depthReached: boolean;
  /** True when more entries were skipped than listed. */
  skippedMore: boolean;
  /** How many levels down the search went. */
  depthLimit: number;
  /** Names of folders that are shortcuts (links to folders) and were not searched. Links to files are not counted. */
  linkedFolders: string[]; linkedFoldersTotal: number;
  /** The folders, relative to the chosen folder, where the depth limit was reached. */
  depthFolders: string[];
  /** Folders that could not be opened. */
  unopenedFolders: number;
  /** Example and test folders that were skipped and hold a project, and how many. Empty when they are searched. */
  exampleFolders: string[]; exampleFoldersTotal: number;
}

export interface Snapshot {
  mode: Mode; at: string;
  store: StoreData; library: Library; folders: FolderData[]; projects: ProjectData[]; cache: CacheData; scan: ScanInfo;
  /** Set when a whole screen's data could not be read, so the screen says so instead of looking empty. */
  problems: { area: string; code: string }[];
}

export interface FileView { path: string; text: string | null; note: string | null; bytes: number }
export interface ItemContent { kind: ItemKind; id: string; where: 'store' | 'project'; files: FileView[]; pinned: { lines: string[] } | null; note: string | null }

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'; roots: string[]; mode: Mode | null;
  /** Also look inside folders named examples, fixtures, test, tests. Off by default. */
  includeExamples: boolean;
  /** True once the folders near the person were looked for on the first real-data launch, so a removed folder is never added back. */
  discovered: boolean;
}
export interface SettingsResult { settings: AppSettings; /** A plain sentence when the change could not be made or kept, else null. */ message: string | null }
export interface AppInfo { version: string; mode: Mode | null; storePath: string; updates: { enabled: boolean; status: string }; platform: string; firstRun: boolean;
  /** A plain sentence about the viewer's own settings file (damaged, unreadable, could not be saved), or null. */
  notice: string | null }

/** The whole surface of the preload: named read-only calls and nothing else. */
export interface ViewerApi {
  getInfo(): Promise<AppInfo>;
  getSettings(): Promise<AppSettings>;
  getSnapshot(): Promise<Snapshot>;
  getItemContent(request: { kind: ItemKind; id: string; projectKey: string | null }): Promise<ItemContent>;
  getFileText(request: { projectKey: string; file: 'config' | 'lock' }): Promise<{ text: string | null; note: string | null }>;
  chooseMode(mode: Mode): Promise<AppInfo>;
  addRoot(): Promise<SettingsResult>;
  removeRoot(path: string): Promise<SettingsResult>;
  setTheme(theme: AppSettings['theme']): Promise<SettingsResult>;
  setIncludeExamples(on: boolean): Promise<SettingsResult>;
  copyText(text: string): Promise<boolean>;
  checkForUpdates(): Promise<{ status: string }>;
  openLink(url: string): Promise<boolean>;
}
