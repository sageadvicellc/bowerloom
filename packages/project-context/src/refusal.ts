/**
 * The fixed refusals of the project layer. Internal to packages/project-context.
 * Every refusal has a fixed code and a fixed message. A message never carries a path, so output stays safe to share.
 */
import { DefinitionError } from '../../contracts/src/index.js';

const MESSAGES = {
  USAGE: 'Use an absolute path.',
  PROJECT_NOT_FOUND: 'No Bowerloom project holds this folder. Run the command inside a project folder that has a .bowerloom folder.',
  PROJECT_ROOT_REFUSED: 'Bowerloom does not use the home folder or the root of the disk as a project.',
  PROJECT_IN_CLOUD_FOLDER: 'This folder syncs to a cloud service. Keep the project in a local folder, such as ~/Projects.',
  PROJECT_UNSAFE: 'The .bowerloom folder is not safe to use. It must be a real folder that you own, with no write access for others.',
  PROJECT_UNREADABLE: 'Bowerloom could not read a folder between this one and the project, so it cannot check the project. Check the folder permissions and macOS privacy settings.',
  PROJECT_LOCKED: 'Another Bowerloom command is changing this project. Wait for it to finish, then run the command again.',
  PROJECT_LOCK_UNAVAILABLE: 'Bowerloom could not take the project lock. Try again.',
  PROJECT_LOCK_SLOT_COLLISION: 'Another program holds the local port that Bowerloom uses to lock this project.',
} as const;

export type ProjectRefusalCode = keyof typeof MESSAGES;
export const refuse = (code: ProjectRefusalCode): DefinitionError => new DefinitionError(code, MESSAGES[code]);
