/**
 * The one owner/name pattern of a github.com repository (review F4 of PR 97). The remote normalizer
 * (project-config git.ts), the lock's remote check (resolve-store-git.ts), the store fetch (project-sync store-git.ts),
 * and the public transport's githubAuth check (public-get.ts) all read it here, so a remote one of them accepts is a
 * remote each of the others accepts.
 */
/** An owner: a letter or digit, then up to 38 letters, digits, or hyphens. */
export const GITHUB_OWNER_SOURCE = '[a-z0-9][a-z0-9-]{0,38}';
/** A repository name: 1 to 100 letters, digits, dots, underscores, or hyphens; never `.` or `..`. */
export const GITHUB_NAME_SOURCE = '[a-z0-9._-]{1,100}';
/** `owner/name` in lower case. */
export const GITHUB_REPOSITORY = new RegExp(`^(${GITHUB_OWNER_SOURCE})/(${GITHUB_NAME_SOURCE})$`);
/** The normal form of a remote: `https://github.com/owner/name`, in lower case. */
export const GITHUB_REMOTE = new RegExp(`^https://github\\.com/(${GITHUB_OWNER_SOURCE})/(${GITHUB_NAME_SOURCE})$`);
/** An owner and a name in any case, before they are lower-cased (the normalizer reads git config as it is). */
export const GITHUB_OWNER_ANY_CASE = new RegExp(`^${GITHUB_OWNER_SOURCE}$`, 'i');
export const GITHUB_NAME_ANY_CASE = new RegExp(`^${GITHUB_NAME_SOURCE}$`, 'i');

/** True for `owner/name` in lower case whose name is not `.` or `..`. */
export function isGithubRepository(value: unknown): value is string {
  const m = typeof value === 'string' ? GITHUB_REPOSITORY.exec(value) : null;
  return m !== null && m[2] !== '.' && m[2] !== '..';
}
/** `owner/name` of a normal remote, or null. */
export function repositoryOfRemote(remote: unknown): string | null {
  const m = typeof remote === 'string' ? GITHUB_REMOTE.exec(remote) : null;
  return m === null || m[2] === '.' || m[2] === '..' ? null : `${m[1]}/${m[2]}`;
}
