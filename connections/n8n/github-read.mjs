import { createHash } from 'node:crypto';

/** Export a credential-free, manually triggered reader for one immutable GitHub file. */
export function githubReadWorkflow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'commit,owner,path,repo') throw new Error('INVALID_GITHUB_SOURCE');
  const { owner, repo, commit, path } = input;
  if (typeof owner !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)
    || typeof repo !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(repo)
    || repo === '.' || repo === '..'
    || typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)
    || typeof path !== 'string' || path.length > 240
    || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:md|json)$/.test(path)
    || path.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('INVALID_GITHUB_SOURCE');
  }
  const identity = createHash('sha256').update(JSON.stringify([owner.toLowerCase(), repo.toLowerCase(), commit, path])).digest('hex');
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`;
  return {
    name: `Trellis experiment reader ${identity.slice(0, 12)}`,
    active: false,
    nodes: [
      { id: 'manual', name: 'Read selected experiment', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      { id: 'github-read', name: 'Pinned GitHub record', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [260, 0],
        parameters: { method: 'GET', url, authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi',
          sendHeaders: true, headerParameters: { parameters: [
            { name: 'Accept', value: 'application/vnd.github+json' },
            { name: 'X-GitHub-Api-Version', value: '2022-11-28' },
          ] }, options: { timeout: 15000, redirect: { redirect: { followRedirects: false } } } } },
    ],
    connections: { 'Read selected experiment': { main: [[{ node: 'Pinned GitHub record', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', saveExecutionProgress: false, saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none' },
    tags: [],
  };
}
