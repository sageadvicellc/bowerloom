import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('INSTALLED_CODEX_IDENTITY_REJECTED'); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function regular(root, relative) {
  if (typeof relative !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(relative) || relative.split('/').some(x => !x || x === '.' || x === '..')) fail();
  let path = root;
  for (const part of relative.split('/')) {
    path = join(path, part);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail();
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 ** 20) fail();
  return readFileSync(path);
}
// Host-owned pins, never a task or model response, supply these identity inputs.
// No package import, installation, model launch, or external effect occurs here.
export function inspectInstalledCodex({ root, distributionSha256, tarballSha256 }) {
  try {
    if (!isAbsolute(root) || resolve(root) !== root || realpathSync(root) !== root || !digest(distributionSha256) || !digest(tarballSha256)) fail();
    const directory = lstatSync(root);
    if (!directory.isDirectory() || directory.isSymbolicLink()) fail();
    const bytes = regular(root, 'DISTRIBUTION.json');
    if (sha(bytes) !== distributionSha256) fail();
    const manifest = JSON.parse(bytes);
    if (manifest.schema !== 'bowerloom/cli-distribution/v0.1' || manifest.name !== 'bowerloom' || manifest.private !== true || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 1024) fail();
    const seen = new Set();
    const files = manifest.files.map(file => {
      if (!file || typeof file !== 'object' || seen.has(file.path) || !digest(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) fail();
      seen.add(file.path);
      const bytes = regular(root, file.path);
      if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) fail();
      return Object.freeze({ path: file.path, sha256: file.sha256 });
    });
    for (const file of ['index', 'boundary', 'adapter-core', 'startup-deadline', 'installation', 'policy', 'supervisor', 'guardian']) {
      if (!seen.has(`dist/packages/codex-adapter/src/${file}.js`)) fail();
    }
    for (const path of ['dist/packages/mcp-connections/src/darwin-boot-session.js','dist/packages/mcp-connections/src/model.js','dist/packages/contracts/src/index.js']) if (!seen.has(path)) fail();
    return Object.freeze({ root, tarballSha256, files: Object.freeze(files), distributionSha256, version: manifest.version });
  } catch { fail(); }
}
