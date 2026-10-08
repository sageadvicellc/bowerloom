// Read-only compatibility command. Never rewrite Content sources or README.
// --check also refuses version drift in README and the badge, and missing or unpaired release markers.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {getDocuments} from '../src/lib/content.mjs';
import {readRelease} from '../src/lib/release.mjs';
const root = resolve(import.meta.dirname, '../../..');
const docs = 'apps/docs/src/content/docs/';
const markers = {
  'README.md': ['support'],
  [docs + 'status.md']: ['support'],
  ...Object.fromEntries(['revision', 'stop', 'cli', 'backend', 'mcp', 'releases'].map(x => [docs + x + '.md', ['status']])),
};
const problems = [];
if (process.argv.includes('--check')) {
  const release = await readRelease();
  for (const file of ['README.md', 'docs/assets/badge-version.svg']) {
    const found = (await readFile(resolve(root, file), 'utf8')).match(/0\.7\.0-(?:alpha|beta)\.\d+/g) ?? [];
    for (const version of new Set(found)) if (version !== release.version) problems.push(`RELEASE_VERSION_DRIFT: ${file} holds ${version}, expected ${release.version}.`);
    if (!found.includes(release.version)) problems.push(`RELEASE_VERSION_MISSING: ${file} does not hold ${release.version}.`);
  }
  for (const [file, kinds] of Object.entries(markers)) {
    const text = await readFile(resolve(root, file), 'utf8');
    for (const kind of kinds) {
      const starts = text.split(`<!-- release:${kind}:start -->`).length - 1, ends = text.split(`<!-- release:${kind}:end -->`).length - 1;
      if (starts !== 1 || ends !== 1) problems.push(`RELEASE_MARKER_UNPAIRED: ${file} needs one release:${kind}:start and one release:${kind}:end marker, found ${starts} and ${ends}.`);
    }
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const documents = await getDocuments();
console.log(JSON.stringify({mode:'checked-in-memory',pages:documents.length,sourceWrites:0}));
