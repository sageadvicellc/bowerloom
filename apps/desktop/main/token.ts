/** Whether the GitHub token is set. Returns the state only: the value never leaves this function. */
import { GithubToken } from '../../../packages/skill-manifest/src/github-token.js';

export type TokenState = 'set' | 'not-set' | 'invalid';
export function tokenState(source: NodeJS.ProcessEnv | undefined = process.env): TokenState {
  const name = 'BOWERLOOM_GITHUB_TOKEN';
  const only: NodeJS.ProcessEnv = {};
  if (typeof source[name] === 'string') only[name] = source[name];
  return GithubToken.status(only);
}
