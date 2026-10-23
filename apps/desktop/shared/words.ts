/** Plain-language text. The screens say these words; the technical term appears only inside a "What is this?" note. */
import type { ItemKind, Origin } from './types.js';

export const KIND_WORDS: Record<ItemKind, { one: string; many: string; what: string }> = {
  skill: { one: 'Skill', many: 'Skills', what: 'A skill is a set of written instructions that teaches an AI helper how to do one kind of job, such as writing in your studio voice.' },
  prompt: { one: 'Prompt', many: 'Prompts', what: 'A prompt is a piece of text you reuse to ask an AI helper for something, such as a weekly update.' },
  team: { one: 'Team', many: 'Teams', what: 'A team is a group of AI helpers with different roles, such as a lead, a maker, and a reviewer, that work on a job together.' },
};

export const ORIGIN_WORDS: Record<Origin, string> = { yours: 'Yours', github: 'From GitHub', npm: 'From npm' };
export const ORIGIN_NOTE: Record<Origin, string> = {
  yours: 'You made this one. It lives in a folder on this computer.',
  github: 'This one is copied from a shared place on GitHub, a website where people keep and share files.',
  npm: 'This one is copied from npm, a public shelf where people publish ready-made packages.',
};

export const EXPLAINERS: Record<string, { title: string; body: string }> = {
  store: { title: 'The library (store)', body: 'The store is the folder named .bowerloom in your home folder. It keeps your skills, prompts, and teams in one place so any project can use them.' },
  lock: { title: 'The lock file', body: 'The lock file is called bowerloom.lock.json. It remembers the exact version of everything a project uses, so a teammate gets the same ones.' },
  drift: { title: 'Drift', body: 'A project drifts when what it asks for no longer matches what is saved, locked, or set up. Nothing is broken; it needs a person to look.' },
  pin: { title: 'Fixed version (pin)', body: 'A pin ties an item to one exact version, so it cannot change under you without you knowing.' },
  agent: { title: 'Helper (agent)', body: 'An agent is one AI helper with a name, a short job description, and a list of what it may do.' },
  slice: { title: 'Knowledge slice', body: 'A slice is a short list of the files from a knowledge folder that a helper should read at the start, so it does not have to read everything.' },
  folder: { title: 'Knowledge folder (registered folder)', body: 'A knowledge folder is a folder of notes that sits outside your projects. Bowerloom reads it and never changes it.' },
  grant: { title: 'Permission to read a folder (grant)', body: 'Each project must be allowed, one by one, to read a knowledge folder. The permission is saved in your library.' },
  cache: { title: 'Saved copies (cache)', body: 'The cache holds copies of things downloaded from GitHub or npm, so they do not need to be downloaded again.' },
  token: { title: 'GitHub access key (token)', body: 'A token is a secret key that lets this computer fetch private files from GitHub. The viewer only tells you whether one is set. It never shows it.' },
  config: { title: 'The project list (bowerloom.json)', body: 'The file bowerloom.json lists which skills, prompts, and teams a project uses.' },
};

/** A sentence for a code that Bowerloom reports. The code itself is shown only in the small technical note. */
const CODE_WORDS: Record<string, string> = {
  LOCK_INVALID: 'The lock file cannot be read. It may be damaged, or it may hold leftover marks from combining two versions.',
  LOCK_UNSAFE: 'The lock file is a shortcut, too big, or something other people can change, so Bowerloom will not trust it.',
  LOCK_LIMIT: 'The lock file is bigger than Bowerloom allows.',
  LOCK_CONFIG_MISMATCH: 'The lock file and the project list name different items.',
  LOCK_STORE_NOT_PUSHED: 'The library has changes that are not shared on GitHub yet, so the lock cannot point at them.',
  CONFIG_INVALID: 'The project list (bowerloom.json) cannot be read. It may be out of order or have a typing mistake.',
  CONFIG_LIMIT: 'The project list is bigger than Bowerloom allows.',
  CONFIG_DUPLICATE_ID: 'The project list names the same item twice.',
  CONFIG_UNSAFE: 'The project list is a shortcut, or something other people can change, so Bowerloom will not trust it.',
  STORE_ITEM_MISSING: 'This project asks for an item that is not in your library any more.',
  CONFIG_ITEM_MISSING: 'This project lists an item it does not define.',
  AGENT_GRANT_REVIEW_REQUIRED: 'This helper asks for powerful permissions. Bowerloom will not install it until a person has reviewed it.',
  AGENT_INVALID: 'The file for this helper is not written the way Bowerloom expects.',
  AGENT_KEY_UNKNOWN: 'The file for this helper uses a setting Bowerloom does not know.',
  AGENT_NAME_MISMATCH: 'The helper\'s name does not match its file name.',
  AGENT_TARGET_OCCUPIED: 'A different file is already where this helper would be installed.',
  FOLDER_NOT_ALLOWED: 'This project has not been given permission to read this knowledge folder.',
  SLICE_ROOT_MISSING: 'The folder this slice points to is not there.',
  SLICE_ROOT_UNSAFE: 'The folder this slice points to is not safe to read.',
  SKILLS_OFFLINE: 'Some fixed-version skills have not been downloaded to this computer yet.',
  PROJECT_UNSAFE: 'Bowerloom will not trust this project folder, because other people or shortcuts can change it.',
  PROJECT_FOLDER_UNSAFE: 'Bowerloom will not trust this folder, because other people can change it.',
  PROJECT_IN_CLOUD_FOLDER: 'This folder is in a cloud-synced place (such as iCloud). Syncing moves files around and breaks Bowerloom\'s safety checks.',
  PROJECT_ROOT_REFUSED: 'This folder is too broad to be a project.',
  PROJECT_UNREADABLE: 'A folder on the way to this project could not be read.',
  PROJECT_NOT_FOUND: 'No project was found here.',
  OUTSIDE_ROOT: 'This folder is outside the folders you chose.',
  THROUGH_LINK: 'This folder is reached through a shortcut (a link), which the viewer does not follow.',
  NOT_FOUND: 'This folder is not there any more.',
  STORE_INVALID: 'The .bowerloom folder in your home folder is not a Bowerloom library.',
  STORE_UNSAFE: 'The library is not safe to use. Other people or shortcuts can change it.',
  STORE_UNREADABLE: 'The library could not be read.',
  FOLDER_UNSAFE: 'This knowledge folder is not safe to use.',
  FOLDER_INVALID: 'The saved record for this knowledge folder is damaged.',
  REVISION_PENDING: 'A change to this project was started and not finished.',
  MANAGED_SKILL_LEGACY_PRESENT: 'This project has skills installed by an older version of Bowerloom.',
  MANAGED_SKILL_RECOVERY_REQUIRED: 'An earlier install stopped part way and needs to be recovered.',
  UNREADABLE: 'It could not be read.',
};
export const codeWords = (code: string | null | undefined): string => code === null || code === undefined ? '' : CODE_WORDS[code] ?? 'Bowerloom reported a problem it has no plain words for yet. The technical name is shown below.';

export const humanBytes = (n: number): string => n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
/** `house-style` becomes `House style`. */
export const titleOf = (id: string): string => { const s = id.replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
