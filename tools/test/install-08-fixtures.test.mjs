// The frozen 0.8 install fixtures in tests/fixtures/install-0.8 (made by tools/fixtures-0.8/make.mjs from the published bowerloom@0.8.0-beta.1).
// This test reads the files only. It needs no network and no Docker. It checks each file against manifest.json (SHA-256 and caps),
// and that no sandbox path and no token pattern is left. A copy of the folder with one change shows that each check can fail.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../../tests/fixtures/install-0.8', import.meta.url));
const DATA_FILES = ['project.json', 'project-preview.json', 'home-store.json', 'state.json', 'global-prefix.json'];
const ALL_FILES = [...DATA_FILES, 'manifest.json'];
const FOLDER_CAP = Math.floor(1.5 * 1024 * 1024);
// The caps are fixed here. manifest.json is generated, so a cap that it names could be raised by the same change that breaks it.
const FILE_CAPS = {
  'project.json': 256 * 1024,
  'project-preview.json': 256 * 1024,
  'home-store.json': 64 * 1024,
  'state.json': 512 * 1024,
  'global-prefix.json': 16 * 1024,
  'manifest.json': 32 * 1024,
};

// The paths of the sandbox that made the fixtures, and of any Mac or temporary folder that could run the generator.
const SANDBOX_PATHS = ['/home/node', '/Users/', '/private/tmp/', '/private/var/', '/var/folders/'];
// The one allowed exception. The pinned skill package is frozen as published, and its own package.json holds this temporary path
// from its publisher's computer. It is third-party bytes, and it is allowed in state.json only, as this exact string.
const PUBLISHER_TEMP_PATH = '/private/var/folders/m3/r413t_qj4kxg1mdnmk1zb8q80000gn/T/ad388974b1a8b17ca1bd0d75828c0f2e/tanstack-db-skills-0.0.1.tgz';
const ALLOWED_PATHS = { 'state.json': [PUBLISHER_TEMP_PATH] };
// Shapes of a real secret, and of the address of a person. A fixture holds none. The pattern for an address needs a name before the @,
// so a pattern such as '%@company.com' in a skill's own text is not an address.
const TOKEN_PATTERNS = [
  /[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\/\/[^\s"']*:_authToken=/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/,
];

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const scratchCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-08-fixtures-'));
  made.push(dir);
  for (const name of ALL_FILES) fs.copyFileSync(path.join(FIXTURES, name), path.join(dir, name));
  return dir;
};

/** Every problem in a fixtures folder, as short sentences. An empty list means the folder is sound. */
function problemsIn(dir) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (error) {
    return [`manifest.json cannot be read: ${error.message}`];
  }
  const names = fs.readdirSync(dir).sort();
  if (JSON.stringify(names) !== JSON.stringify([...ALL_FILES].sort())) problems.push(`The folder holds ${names.join(', ')}`);
  let total = 0;
  for (const name of ALL_FILES) {
    let bytes;
    try { bytes = fs.readFileSync(path.join(dir, name)); } catch { problems.push(`${name} is missing`); continue; }
    total += bytes.length;
    if (name === 'manifest.json') {
      if (bytes.length > FILE_CAPS[name]) problems.push(`manifest.json is ${bytes.length} bytes, over its cap of ${FILE_CAPS[name]}`);
    } else {
      const listed = manifest.files?.[name];
      if (!listed) { problems.push(`${name} is not listed in manifest.json`); continue; }
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== listed.sha256) problems.push(`${name} has the SHA-256 ${sha}, and manifest.json lists ${listed.sha256}`);
      if (bytes.length !== listed.bytes) problems.push(`${name} is ${bytes.length} bytes, and manifest.json lists ${listed.bytes}`);
    }
    if (bytes.length > FILE_CAPS[name]) problems.push(`${name} is ${bytes.length} bytes, over its cap of ${FILE_CAPS[name]}`);
    let text = bytes.toString('utf8');
    for (const allowed of ALLOWED_PATHS[name] ?? []) text = text.split(allowed).join('');
    for (const sandbox of SANDBOX_PATHS) if (text.includes(sandbox)) problems.push(`${name} holds the sandbox path ${sandbox}`);
    for (const pattern of TOKEN_PATTERNS) if (pattern.test(text)) problems.push(`${name} matches the token pattern ${pattern}`);
    if (name !== 'manifest.json') {
      try { JSON.parse(text); } catch { problems.push(`${name} is not JSON`); }
    }
  }
  if (total > Math.min(manifest.totalCapBytes ?? FOLDER_CAP, FOLDER_CAP)) problems.push(`The folder is ${total} bytes, over its cap`);
  return problems;
}

test('the install-0.8 fixtures match manifest.json, stay inside the caps, and hold no sandbox path and no token', () => {
  assert.deepEqual(problemsIn(FIXTURES), []);
});

test('the manifest records the tarball, the tool versions, the pinned skill, and each command with its exit code', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));
  assert.equal(manifest.package.name, 'bowerloom');
  assert.equal(manifest.package.version, '0.8.0-beta.1');
  assert.equal(manifest.package.integrity, 'sha512-8HrwtMDM25dVcVgqZ9HKQn5YyK3PCbyUA4kzUG0bNGdXWIU4ZCTvjoMXJTGqVvPbLj63BZMoHo8LejhpFuhiIA==');
  assert.match(manifest.node, /^v24\.\d+\.\d+$/);
  assert.match(manifest.npm, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.image, /^node:24\.[\d.]+-bookworm@sha256:[0-9a-f]{64}$/);
  assert.match(manifest.skillPin.license, /^(MIT|Apache-2\.0)$/);
  assert.ok(manifest.skillPin.name && manifest.skillPin.version && manifest.skillPin.integrity.startsWith('sha512-'));
  assert.ok(manifest.commands.length > 0);
  for (const command of manifest.commands) assert.equal(command.exit, 0, `${command.command} exited ${command.exit}`);
  assert.deepEqual(manifest.placeholders, ['{{HOME}}', '{{PROJECT}}', '{{STATE}}', '{{PROJECT_ID}}', '{{ROOT}}', '{{EMAIL}}']);
  for (const name of DATA_FILES) assert.ok(manifest.files[name].capBytes > 0, name);
});

test('the fixtures hold what a 0.8 install leaves: three commands, a lock, engine files, and the preview files', () => {
  const read = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  const prefix = read('global-prefix.json');
  assert.deepEqual(Object.keys(prefix.links).sort(), ['bin/bowerloom', 'bin/bowerloom-guard', 'bin/bowerloom-mcp']);
  assert.deepEqual(Object.keys(prefix.package.fields.bin).sort(), ['bowerloom', 'bowerloom-guard', 'bowerloom-mcp']);
  const project = read('project.json');
  for (const file of ['bowerloom.json', 'bowerloom.lock.json', '.bowerloom/harness.json', '.codex/rules/bowerloom.rules', '.claude/settings.json', '.mcp.json']) {
    assert.ok(project.files[file], `project.json holds ${file}`);
  }
  assert.equal(project.files['bowerloom.lock.json'].mode, '0644');
  const preview = read('project-preview.json');
  for (const file of ['.opencode/plugins/bowerloom-hooks.js', '.dsh/bowerloom.patch.yml']) assert.ok(preview.files[file], `project-preview.json holds ${file}`);
  const store = read('home-store.json');
  for (const file of ['store.json', 'skills.json', '.gitignore']) assert.ok(store.files[file], `home-store.json holds ${file}`);
  const state = read('state.json');
  assert.equal(state.dirs['{{PROJECT_ID}}'], '0700');
  assert.ok(state.files['events/events.jsonl']);
});

test('a changed byte, a sandbox path, a token, and a file over its cap are each found in a copy of the folder', () => {
  const edit = (dir, name, change) => fs.writeFileSync(path.join(dir, name), change(fs.readFileSync(path.join(dir, name), 'utf8')));
  const changed = scratchCopy();
  edit(changed, 'home-store.json', text => text.replace('bowerloom/store', 'bowerloom/stare'));
  assert.ok(problemsIn(changed).some(p => /home-store\.json has the SHA-256/.test(p)));

  const sandboxed = scratchCopy();
  edit(sandboxed, 'global-prefix.json', text => text.replace('"about"', '"path": "/home/node/work", "about"'));
  assert.ok(problemsIn(sandboxed).some(p => /holds the sandbox path \/home\/node/.test(p)));

  const tokened = scratchCopy();
  edit(tokened, 'global-prefix.json', text => text.replace('"about"', '"token": "ghp_' + 'a'.repeat(36) + '", "about"'));
  assert.ok(problemsIn(tokened).some(p => /token pattern/.test(p)));

  const emailed = scratchCopy();
  edit(emailed, 'global-prefix.json', text => text.replace('"about"', '"email": "someone.name@example.org", "about"'));
  assert.ok(problemsIn(emailed).some(p => /token pattern/.test(p)));

  // The publisher's temporary path is allowed in state.json only. Elsewhere, and with any other temporary path, it is a problem.
  const temp = scratchCopy();
  edit(temp, 'global-prefix.json', text => text.replace('"about"', `"path": "${PUBLISHER_TEMP_PATH}", "about"`));
  assert.ok(problemsIn(temp).some(p => /global-prefix\.json holds the sandbox path \/private\/var\//.test(p)));
  const otherTemp = scratchCopy();
  edit(otherTemp, 'state.json', text => text.replace('"files"', '"path": "/var/folders/zz/other/T/x", "files"'));
  assert.ok(problemsIn(otherTemp).some(p => /state\.json holds the sandbox path \/var\/folders\//.test(p)));

  const big = scratchCopy();
  edit(big, 'global-prefix.json', text => text.replace('"about"', '"filler": "' + 'x'.repeat(20000) + '", "about"'));
  assert.ok(problemsIn(big).some(p => /over its cap/.test(p)));
});
