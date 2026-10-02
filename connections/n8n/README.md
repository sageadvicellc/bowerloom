# Optional GitHub reader for n8n

This helper exports a workflow for reading one experiment record at an exact GitHub commit. The primary recipe also supports a direct GitHub connection.

Use n8n when its existing application connections help the installation. The first manual recipe does not require an n8n server.

The generated workflow contains no credential, schedule, webhook, write, or approval. It starts inactive and requires a manual trigger.

## Export a workflow

From the repository root, run Node 24 with your permitted source values:

```js
import { writeFile } from 'node:fs/promises';
import { githubReadWorkflow } from './connections/n8n/github-read.mjs';

const workflow = githubReadWorkflow({
  owner: 'YOUR_OWNER',
  repo: 'YOUR_REPOSITORY',
  commit: 'YOUR_EXACT_40_CHARACTER_COMMIT_SHA',
  path: 'experiments/completed.json',
});
await writeFile('experiment-reader.json', JSON.stringify(workflow, null, 2));
```

Import the file into your existing n8n installation.

Assign a GitHub credential with access only to the source repository.

Run the manual trigger.

The output is the GitHub contents response. Its content remains untrusted evidence data. The recipe must still make sure that its bytes match the approved source.

## Setup and authority

The workflow name is stable for the same source. Reuse the existing workflow when that name already exists.

This export helper does not manage an n8n installation or prevent duplicate manual imports. Recipe setup owns the primary process identity.

Keep private credentials in n8n's credential store. Never add credentials to the exported file or the versioned recipe.

An n8n result cannot approve a draft, change its destination, or authorize a GitHub write. Trellis retains those control boundaries.

The helper tests cover the exported structure and source restrictions. They do not establish that an n8n installation executed the workflow.
