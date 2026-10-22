/**
 * The fixed refusals of the project layer. Internal to packages/project-context.
 * Every refusal has a fixed code and a fixed message. A message never carries a path, so output stays safe to share.
 */
import { DefinitionError } from '../../contracts/src/index.js';

const MESSAGES = {
  USAGE: 'Use an absolute path.',
  PROJECT_NOT_FOUND: 'No Bowerloom project holds this folder. Run the command inside a project folder that has a .bowerloom folder or a bowerloom.json file.',
  PROJECT_ROOT_REFUSED: 'Bowerloom does not use the home folder or the root of the disk as a project.',
  PROJECT_IN_CLOUD_FOLDER: 'This folder syncs to a cloud service. Keep the project in a local folder, such as ~/Projects.',
  PROJECT_UNSAFE: 'The .bowerloom folder or the bowerloom.json file is not safe to use. A .bowerloom folder must be a real folder that you own, with no write access for others. A project folder holds at most one .bowerloom and one bowerloom.json, spelled exactly so.',
  PROJECT_UNREADABLE: 'Bowerloom could not read a folder between this one and the project, so it cannot check the project. Check the folder permissions and macOS privacy settings.',
  PROJECT_LOCKED: 'Another Bowerloom command is changing this project. Wait for it to finish, then run the command again.',
  PROJECT_LOCK_UNAVAILABLE: 'Bowerloom could not take the project lock. Try again.',
  PROJECT_LOCK_SLOT_COLLISION: 'Another program holds the local port that Bowerloom uses to lock this project.',
  PROJECT_FOLDER_UNSAFE: 'The project folder is not safe to use. It must be yours, with no write access for others.',
  STORE_NOT_FOUND: 'There is no store yet.',
  STORE_INVALID: 'The store folder has no usable store.json.',
  STORE_UNSAFE: 'The store is not safe to use. It must be a real folder that you own, with no write access for others and no link on its path. Your home folder must be yours or root\'s, and others must not be able to write in it unless it is sticky. Bowerloom does not check the folders above your home folder.',
  STORE_UNREADABLE: 'Bowerloom cannot read the store or a folder on the way to it.',
  STORE_IN_CLOUD_FOLDER: 'The store is in a cloud-synced folder.',
  STORE_NOT_A_PROJECT: 'The store holds definitions only, so a folder inside it cannot be a project.',
  STORE_WRITE_FAILED: 'Bowerloom could not write to the store.',
  STORE_LOCKED: 'Another Bowerloom command is changing the store.',
  STORE_STATE_NESTED: 'The private state folder and the store must not be inside one another.',
  STALE_APPROVAL: 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.',
  FOLDER_NAME_INVALID: 'A folder name is lower-case letters and digits in words joined by single hyphens, at most 64 characters.',
  FOLDER_EXISTS: 'Your store already has a folder with that name.',
  FOLDER_NOT_FOUND: 'Your store has no folder with that name.',
  FOLDER_UNSAFE: 'This folder cannot be registered. It must exist below your home folder, belong to you, and be safe from other users.',
  FOLDER_IN_CLOUD: 'This folder syncs to a cloud service, so it cannot be registered.',
  FOLDER_INVALID: 'A folder record in your store is not valid.',
  CONFIG_UNREADABLE: 'Bowerloom cannot read bowerloom.json.',
  CONFIG_UNSAFE: 'bowerloom.json is not safe to read. It must be a plain file that you own, with one link, no write access for others, and at most 1 MiB.',
} as const;

export type ProjectRefusalCode = keyof typeof MESSAGES;
/** The fixed refusal for `code`. `extra` is a fixed sentence of the caller's; it never carries a path. */
export const refuse = (code: ProjectRefusalCode, extra?: string): DefinitionError => new DefinitionError(code, extra === undefined ? MESSAGES[code] : `${MESSAGES[code]} ${extra}`);

/** STORE_WRITE_FAILED with the system error named in the message. Only an upper-case system name is kept. */
export function storeWriteFailed(error: unknown): DefinitionError {
  const name = (error as NodeJS.ErrnoException | null)?.code;
  return new DefinitionError('STORE_WRITE_FAILED', `${MESSAGES.STORE_WRITE_FAILED} System error: ${typeof name === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(name) ? name : 'UNKNOWN'}.`);
}
