// The notes keeper kit: one agent, six skills, and a starter wiki template. These tests load the kit through the harness
// definition loader and lint the skill text for the two rules every changing skill must keep: a clean-tree check first, and
// exactly one commit at the end. A wiki may be its own repository or a folder inside a larger one, so the check and the commit
// are limited to the wiki folder; the last tests run the skills' own commands with real git in a larger repository. The kit
// text is public, so a test checks it holds no path, link, or address.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDefinitionFiles } from '../../dist/packages/harness-definition/src/index.js';
import { findGit } from '../../dist/packages/notes-source/src/index.js';

const KIT = fileURLToPath(new URL('../../kits/wiki-keeper/', import.meta.url));
const SKILLS = ['add-source', 'file-page', 'answer-from-notes', 'check-notes', 'log-change', 'refine-report'];
const CHANGING = ['add-source', 'file-page', 'log-change', 'refine-report'];
const READ_ONLY = ['answer-from-notes', 'check-notes'];
const STARTER = ['AGENTS.md', 'index.md', 'log.md', 'sources/README.md', 'pages/README.md', 'reports/README.md'];

const read = rel => fs.readFileSync(path.join(KIT, rel), 'utf8');
const skillText = id => read(`skills/${id}/SKILL.md`);

/** Every regular file under a folder, as a path relative to it. */
function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, child));
    else out.push(child);
  }
  return out.sort();
}

/** The lines inside fenced code blocks of a Markdown text. */
function codeLines(markdown) {
  const lines = [];
  let inside = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) { inside = !inside; continue; }
    if (inside) lines.push(line.trim());
  }
  return lines;
}

/** The kit's skills and agent as a definition held in memory. */
function kitFiles() {
  const harness = {
    format: 'bowerloom/harness/v1beta1',
    id: 'notes-kit-check',
    description: 'A check of the notes keeper kit.',
    engines: [{ id: 'claude-code' }, { id: 'codex' }],
    parts: { skills: 'skills/', subagents: 'agents/' },
  };
  const files = [{ path: 'harness.json', bytes: Buffer.from(JSON.stringify(harness, null, 2) + '\n') }];
  for (const rel of walk(KIT, 'skills')) files.push({ path: rel, bytes: fs.readFileSync(path.join(KIT, rel)) });
  for (const rel of walk(KIT, 'agents')) files.push({ path: rel, bytes: fs.readFileSync(path.join(KIT, rel)) });
  return files;
}

test('kit.json names the kit, its format, and its version', () => {
  const kit = JSON.parse(read('kit.json'));
  assert.equal(kit.format, 'bowerloom/kit/v1beta1');
  assert.equal(kit.id, 'wiki-keeper');
  assert.equal(kit.name, 'Notes keeper');
  assert.match(kit.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof kit.description, 'string');
});

test('the kit holds exactly the planned skills, one agent, and the starter folder', () => {
  assert.deepEqual(fs.readdirSync(path.join(KIT, 'skills')).sort(), [...SKILLS].sort());
  assert.deepEqual(fs.readdirSync(path.join(KIT, 'agents')), ['notes-keeper.md']);
  assert.deepEqual(walk(KIT, 'starter'), STARTER.map(f => `starter/${f}`).sort());
  for (const id of SKILLS) assert.deepEqual(walk(KIT, `skills/${id}`), [`skills/${id}/SKILL.md`]);
});

test('the skills and the agent load through the harness definition loader', () => {
  const result = loadDefinitionFiles(kitFiles());
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.problems));
  const { entries } = result.definition;
  assert.deepEqual(entries.skills.map(s => s.id).sort(), [...SKILLS].sort());
  assert.deepEqual(entries.subagents.map(s => s.id), ['notes-keeper']);
});

test('the agent lists every skill of the kit and needs no engine-private setting', () => {
  const { definition } = loadDefinitionFiles(kitFiles());
  const keeper = definition.entries.subagents[0];
  assert.deepEqual([...keeper.skills].sort(), [...SKILLS].sort());
  assert.deepEqual(keeper.privateBlocks, {});
  assert.equal(keeper.engines, undefined, 'the keeper runs in every engine');
  assert.ok(keeper.tools.includes('read') && keeper.tools.includes('shell'));
  assert.ok(!keeper.tools.includes('web'), 'the keeper needs no web access');
});

test('every skill has a one-line purpose that starts with a verb and fits the limit', () => {
  const { definition } = loadDefinitionFiles(kitFiles());
  for (const s of definition.entries.skills) {
    assert.ok(s.description.length > 20 && s.description.length <= 400, `${s.id}: description length ${s.description.length}`);
    assert.ok(!s.description.includes('\n'), `${s.id}: description is one line`);
  }
});

/** The clean check every changing skill runs: limited to the wiki folder, so a change elsewhere in a larger repository does not count. */
const STATUS = 'git status --porcelain -- .';
/** The paths of a `git add -- <paths>` or a `git commit -F - -- <paths> <<'MSG'` line. */
const addPaths = line => line.replace(/^git add -- /, '').split(' ');
const commitPaths = line => /^git commit -F - -- (.+) <<'MSG'$/.exec(line)?.[1].split(' ') ?? null;

test('a skill that changes a page starts with the clean-tree check and ends with one commit', () => {
  for (const id of CHANGING) {
    const text = skillText(id);
    const code = codeLines(text);
    const status = code.findIndex(l => l === STATUS);
    const commits = code.filter(l => /^git commit\b/.test(l));
    assert.notEqual(status, -1, `${id}: runs ${STATUS} in a code block`);
    assert.equal(code.filter(l => /^git status\b/.test(l) && l !== STATUS).length, 0, `${id}: every status is limited to the wiki folder`);
    assert.equal(commits.length, 1, `${id}: exactly one git commit line`);
    assert.ok(status < code.findIndex(l => /^git commit\b/.test(l)), `${id}: the check comes before the commit`);
    assert.ok(code.findIndex(l => /^git add\b/.test(l)) > status, `${id}: nothing is staged before the check`);
    assert.match(text, /not empty[\s\S]{0,200}stop/i, `${id}: stops when the tree is not clean`);
    assert.match(text, /one commit/i, `${id}: says it makes one commit`);
    assert.equal(code.filter(l => /^git (?:reset|checkout|clean|stash|push|rebase|merge|commit --amend)/.test(l)).length, 0, `${id}: no history or remote command`);
    assert.ok(!commits[0].includes('--amend') && !commits[0].includes('--no-verify'), `${id}: a plain commit`);
  }
});

test('a skill that changes a page stops with a report when the folder is not inside a git work tree', () => {
  for (const id of CHANGING) {
    const text = skillText(id);
    assert.match(text, /not inside a git work tree/i, `${id}: names the case`);
    assert.match(text, /change nothing/i, `${id}: changes nothing in that case`);
    // The wiki may be its own repository or a folder inside a larger one. The status check itself tells: it fails outside a work tree. No other git command is needed.
    assert.match(text, /git status --porcelain -- \.`? fails/i, `${id}: a failing status means no work tree`);
    assert.match(text, /larger repository/i, `${id}: says the wiki may sit inside a larger repository`);
    assert.doesNotMatch(text, /`\.git` folder at (?:its|the) root/i, `${id}: no longer asks for .git at the wiki root`);
  }
});

test('a changing skill commits exactly the paths it staged, so other staged changes in a larger repository stay out', () => {
  for (const id of CHANGING) {
    const code = codeLines(skillText(id));
    const adds = code.filter(l => /^git add\b/.test(l)), commit = code.find(l => /^git commit\b/.test(l));
    assert.equal(adds.length, 1, `${id}: one staging line`);
    assert.deepEqual(commitPaths(commit), addPaths(adds[0]), `${id}: the commit names the staged paths: ${commit}`);
  }
  for (const id of ['add-source', 'file-page']) assert.match(skillText(id), /both lines/i, `${id}: an extra page goes on the staging line and the commit line`);
});

test('the log skill reads the history of the wiki folder only', () => {
  const logs = codeLines(skillText('log-change')).filter(l => /^git log\b/.test(l));
  assert.ok(logs.length >= 2);
  for (const line of logs) assert.match(line, / -- \.$/, line);
});

// ---- every git command in the kit, in prose and in code, against one allowlist -------------------------------------------

/** The git subcommands a text can name. A word after "git" that is not one of these (such as "repository") is prose, not a command. */
const GIT_COMMANDS = new Set(('add am apply archive bisect blame branch bundle cat-file checkout cherry-pick citool clean clone commit config describe diff '
  + 'fetch filter-branch for-each-ref format-patch fsck gc grep gui hash-object init log ls-files ls-tree maintenance merge mv notes prune pull push '
  + 'range-diff read-tree rebase reflog remote repack replace reset restore rev-list rev-parse revert rm shortlog show sparse-checkout stash status '
  + 'submodule switch symbolic-ref tag update-index update-ref worktree write-tree').split(' '));

/** Every git command a text names, anywhere: each `git <command> ...` up to the end of its line or its code span, with a following option too. */
function gitCommands(text) {
  const out = [];
  for (const m of text.matchAll(/\bgit\s+((?:-c\s+\S+\s+|-C\s+\S+\s+|--?[a-z][\w-]*\s+)*)([a-z][a-z-]*)([^`\n]*)/g)) {
    if (m[1].trim() !== '') { out.push(`git ${m[1]}${m[2]}${m[3]}`.trim()); continue; }
    if (GIT_COMMANDS.has(m[2])) out.push(`git ${m[2]}${m[3]}`.trim());
  }
  return out;
}

/** The allowlist. Anything else, in prose or in code, fails. */
const ALLOWED = [
  /^git status --porcelain -- \.$/,
  /^git add --(?!.*\s(?:-A|--all|\.|-f|--force|-u|--update)(?:\s|$)) \S.*$/,
  /^git commit -F - --(?!.*\s(?:-\S*|\.)(?:\s|$)) \S.* <<'MSG'$/,
  /^git log(?:\s+(?!--output|--ext-diff|-p\b|--patch)\S+)*$/,
];
const allowed = cmd => ALLOWED.some(r => r.test(cmd));

test('the allowlist itself refuses the commands that change history, the tree, or a remote', () => {
  for (const cmd of ['git status --porcelain -- .', 'git add -- pages/a.md log.md', "git commit -F - -- pages/a.md log.md <<'MSG'", 'git log', 'git log --format="%ad %s" --date=short -n 50 -- .',
    'git log -1 --stat --format="%s" <commit> -- .']) {
    assert.ok(allowed(cmd), cmd);
  }
  for (const cmd of ['git add -A', 'git add .', 'git add -- .', 'git add -- -A', 'git commit -a', 'git commit -m "x"', 'git commit --amend', 'git commit -F - --amend', 'git rm a.md',
    "git commit -F - <<'MSG'", "git commit -F - -- . <<'MSG'", "git commit -F - -- a.md --amend <<'MSG'", "git commit -F - -- a.md -a <<'MSG'", 'git status --porcelain',
    'git restore a.md', 'git switch main', 'git gc', 'git push', 'git reset --hard', 'git show --stat HEAD', 'git rev-parse --show-toplevel', 'git status',
    'git log --output=x', 'git -c core.pager=sh log', 'git checkout -- a.md', 'git stash', 'git clean -fd']) {
    assert.ok(!allowed(cmd), cmd);
  }
  assert.deepEqual(gitCommands('Run `git add -A` and git push, then git repository words.'), ['git add -A', 'git push, then git repository words.']);
  assert.deepEqual(gitCommands('```\ngit -c x=y status --porcelain\n```'), ['git -c x=y status --porcelain']);
});

test('every git command in every skill and in the agent, in prose and in code, is on the allowlist', () => {
  const texts = [...SKILLS.map(id => [`skills/${id}/SKILL.md`, skillText(id)]), ['agents/notes-keeper.md', read('agents/notes-keeper.md')]];
  let seen = 0;
  for (const [rel, text] of texts) {
    for (const cmd of gitCommands(text)) { seen += 1; assert.ok(allowed(cmd), `${rel}: ${cmd}`); }
  }
  assert.ok(seen > 0);
});

test('a changing skill commits with a quoted heredoc, one message line, and tells the agent to reduce the title to plain characters', () => {
  for (const id of CHANGING) {
    const text = skillText(id);
    const code = codeLines(text);
    const at = code.findIndex(l => /^git commit\b/.test(l));
    assert.match(code[at], /^git commit -F - -- \S.* <<'MSG'$/, `${id}: the message comes on stdin, never inside quotes on the command line`);
    assert.match(code[at + 1], /^[a-z][a-z -]*: [<A-Za-z][A-Za-z0-9 <>-]*$/, `${id}: one plain message line`);
    assert.equal(code[at + 2], 'MSG', `${id}: the heredoc ends on the next line`);
    assert.match(text, /letters, digits, spaces, and hyphens/i, `${id}: the title is reduced to plain characters`);
    assert.doesNotMatch(text, /git commit -m/, `${id}: no message inside double quotes`);
  }
});

test('a skill that stages files names each path and never stages everything', () => {
  for (const id of CHANGING) {
    for (const line of codeLines(skillText(id)).filter(l => /^git add\b/.test(l))) {
      assert.match(line, /^git add -- \S/, `${id}: ${line}`);
      assert.ok(!/\s(?:-A|--all|\.)(?:\s|$)/.test(line), `${id}: ${line}`);
    }
  }
});

test('the refine skill writes one report under reports/ and nothing else', () => {
  const text = skillText('refine-report');
  const adds = codeLines(text).filter(l => /^git add\b/.test(l));
  assert.deepEqual(adds, ['git add -- reports/YYYY-MM-DD-refine.md']);
  assert.match(text, /only file you (?:write|create)/i);
  assert.match(text, /no other (?:file|page)/i);
  assert.match(text, /already exists[\s\S]{0,120}stop/i, 'it never overwrites a report');
  for (const must of ['merge', 'split', 'shorten', 'stale', 'missing link']) assert.match(text, new RegExp(must, 'i'), must);
  assert.match(text, /do not (?:edit|change|write)[^.\n]*(?:index\.md|log\.md)/i, 'it does not touch the index or the log');
  assert.equal(codeLines(text).filter(l => /^git commit\b/.test(l)).length, 1);
});

test('the other changing skills never write under reports/', () => {
  for (const id of ['add-source', 'file-page', 'log-change']) {
    for (const line of codeLines(skillText(id)).filter(l => /^git add\b/.test(l))) assert.ok(!line.includes('reports/'), `${id}: ${line}`);
  }
});

test('a read-only skill says it changes nothing and runs no write command', () => {
  for (const id of READ_ONLY) {
    const text = skillText(id);
    assert.match(text, /changes? nothing/i, id);
    for (const line of codeLines(text)) assert.ok(!/^git (?:add|commit|init|rm|mv|checkout|reset)\b/.test(line), `${id}: ${line}`);
  }
});

test('the answer skill cites a page for each claim and reports a gap instead of filling it', () => {
  const text = skillText('answer-from-notes');
  assert.match(text, /cite/i);
  assert.match(text, /holds? nothing|does not (?:answer|hold|say)/i);
  assert.match(text, /never (?:guess|estimate|invent)/i);
});

test('the check skill covers broken links, pages with no links, and missing frontmatter', () => {
  const text = skillText('check-notes');
  assert.match(text, /broken link/i);
  assert.match(text, /no links|nothing links/i);
  assert.match(text, /frontmatter/i);
});

test('the starter wiki states folders, frontmatter, links, and the log in plain words', () => {
  const agents = read('starter/AGENTS.md');
  for (const word of ['sources/', 'pages/', 'reports/', 'index.md', 'log.md', 'frontmatter', 'link']) assert.ok(agents.toLowerCase().includes(word), `AGENTS.md mentions ${word}`);
  for (const rel of STARTER) assert.ok(read(`starter/${rel}`).trim().length > 40, `${rel} has content`);
  assert.match(read('starter/log.md'), /^# /m);
  assert.match(read('starter/index.md'), /^# /m);
});

test('the kit text holds no absolute path, home path, address, or link', () => {
  const files = walk(KIT);
  assert.equal(files.length, 14);
  for (const rel of files) {
    const text = read(rel);
    assert.ok(!/(?:^|[\s("'`])\/(?:Users|home|private|tmp|var|opt|etc)\//.test(text), `${rel}: absolute path`);
    assert.ok(!/(?:^|[\s("'`])~\//.test(text), `${rel}: home path`);
    assert.ok(!/[A-Za-z]:\\/.test(text), `${rel}: drive path`);
    assert.ok(!/https?:\/\//i.test(text), `${rel}: link`);
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text), `${rel}: address`);
    assert.ok(!/\.\.\//.test(text), `${rel}: parent path`);
  }
});

test('the kit holds only plain Markdown and JSON, no hidden file, and no link', () => {
  for (const rel of walk(KIT)) {
    assert.match(rel, /\.(?:md|json)$/, rel);
    assert.ok(!rel.split('/').some(p => p.startsWith('.')), rel);
    assert.ok(!fs.lstatSync(path.join(KIT, rel)).isSymbolicLink(), rel);
  }
});

// ---- the skills' own commands, with real git, in a wiki inside a larger repository ------------------------------------------

const REAL_GIT = (() => { try { return findGit(); } catch { return null; } })();
const needsGit = REAL_GIT ? false : 'git is not installed at a path Bowerloom trusts, so the kit commands are not run here';

/**
 * A larger repository, cloned-style (a remote address and worktreeConfig), with the wiki at `knowledge-base/`. After its first commit, a file outside the
 * wiki is changed and another is staged, as a person's own work in progress in that repository would be.
 */
function largerRepo(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-kit-repo-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo'), wiki = path.join(root, 'knowledge-base');
  const env = {
    PATH: `${path.dirname(REAL_GIT.path)}:/usr/bin:/bin`, LC_ALL: 'C', HOME: base, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost',
  };
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const run = (cwd, args) => execFileSync(REAL_GIT.path, args, { cwd, env, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  // A skill's lines run as the agent runs them: through a shell, in the wiki folder, with git found on PATH and its own discovery.
  const sh = (cwd, script) => execFileSync('/bin/sh', ['-c', script], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const rel of ['README.md', 'out.md', 'knowledge-base/index.md', 'knowledge-base/log.md', 'knowledge-base/AGENTS.md']) write(rel, `# ${rel}\n`);
  run(root, ['init', '-q']);
  run(root, ['config', 'core.repositoryformatversion', '1']);
  run(root, ['config', 'extensions.worktreeConfig', 'true']);
  run(root, ['config', 'remote.origin.url', 'ssh://example.invalid/repo']);
  run(root, ['add', '-A']);
  run(root, ['commit', '-q', '-m', 'first']);
  write('out.md', '# changed outside the wiki\n');
  write('staged.md', '# staged outside the wiki\n');
  run(root, ['add', '--', 'staged.md']);
  return { base, root, wiki, write, run, sh };
}

/** A skill line with its placeholders filled: today's date, and each `<name>` as a plain name. */
const fill = line => line.replace(/YYYY-MM-DD/g, '2026-01-02').replace(/<([^>]+)>/g, (_, name) => name.replace(/\s+/g, '-'));

test('the clean check of every changing skill ignores a change outside the wiki, sees one inside it, and fails outside a work tree', { skip: needsGit }, t => {
  const repo = largerRepo(t);
  assert.notEqual(repo.run(repo.root, ['status', '--porcelain']), '', 'the larger repository has changes outside the wiki');
  for (const id of CHANGING) {
    const line = codeLines(skillText(id)).find(l => /^git status\b/.test(l));
    assert.equal(repo.sh(repo.wiki, line), '', `${id}: a change outside the wiki does not stop the skill`);
  }
  repo.write('knowledge-base/pages/draft.md', '# draft\n');
  for (const id of CHANGING) {
    const line = codeLines(skillText(id)).find(l => /^git status\b/.test(l));
    // Git names an untracked folder rather than each file in it.
    assert.match(repo.sh(repo.wiki, line), /^\?\? knowledge-base\/pages\/$/m, `${id}: a change inside the wiki stops the skill`);
  }
  const outside = path.join(repo.base, 'not-a-repo'); fs.mkdirSync(outside);
  assert.throws(() => repo.sh(outside, STATUS), 'outside a work tree the check fails, so the skill changes nothing');
});

test('the commit of every changing skill holds only its own paths, and a file staged elsewhere in the larger repository stays staged', { skip: needsGit }, t => {
  for (const id of CHANGING) {
    const repo = largerRepo(t);
    const code = codeLines(skillText(id));
    const add = fill(code.find(l => /^git add\b/.test(l)));
    const at = code.findIndex(l => /^git commit\b/.test(l));
    const commit = [fill(code[at]), fill(code[at + 1]), code[at + 2]];
    const paths = addPaths(add);
    for (const rel of paths) repo.write(`knowledge-base/${rel}`, `# ${id} wrote ${rel}\n`);
    repo.sh(repo.wiki, [add, ...commit].join('\n') + '\n');
    const committed = repo.run(repo.root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean).sort();
    assert.deepEqual(committed, paths.map(p => `knowledge-base/${p}`).sort(), `${id}: the commit holds exactly its paths`);
    assert.equal(repo.run(repo.root, ['log', '-1', '--format=%s']).trim(), commit[1], `${id}: one plain message line`);
    assert.equal(repo.run(repo.root, ['rev-list', '--count', 'HEAD']).trim(), '2', `${id}: one commit`);
    const status = repo.run(repo.root, ['status', '--porcelain']);
    assert.match(status, /^A {2}staged\.md$/m, `${id}: the other staged file is still staged`);
    assert.match(status, /^ M out\.md$/m, `${id}: the other change is left as it was`);
    assert.equal(repo.sh(repo.wiki, STATUS), '', `${id}: the wiki is clean after the commit`);
  }
});
