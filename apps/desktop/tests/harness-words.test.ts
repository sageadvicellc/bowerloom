// The words of the harness-first preview: every fixed string obeys the limits and the banned list, the source holds no banned word, and the status words built by the logic obey the same rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_WORDS, HARNESS_BANNED, LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { BANNED, bannedIn } from '../shared/home/textbudget.js';
import { KIND_NAME, KIND_PLURAL, WORDS, addName, addTo, addToWords, fixName, fromWords, harnessListHint, installTitle, linkFromWords, missingKind, namedBy, nodeName, partsCount, projectsHint, startName, tabWords, willUse } from '../renderer/harness/words.js';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import * as status from '../shared/harness/status.js';
import { buildInstallPlan, installButtonWords, planSummary } from '../shared/harness/files.js';
import { DESKTOP } from './support.js';

test('the preview\'s rule is the home rule less the words the design is built on, and every other banned word stays', () => {
  assert.deepEqual([...DESIGN_WORDS].sort(), ['conflict', 'harness', 'helper', 'interface', 'plan', 'project', 'scan', 'version']);
  assert.ok(DESIGN_WORDS.every(w => BANNED.includes(w)), 'each design word was banned at home');
  assert.deepEqual([...HARNESS_BANNED], BANNED.filter(w => !DESIGN_WORDS.includes(w)));
  for (const word of ['global', 'scope', 'slice', 'apply', 'adopt', 'export', 'import', 'team', 'grant', 'wire', 'ghost', 'lasso', 'mcp', 'token']) assert.notEqual(bannedHere(`the ${word} here`), null, word);
  for (const word of ['harness', 'project', 'conflict', 'interface', 'scan', 'helper', 'plans', 'version']) { assert.equal(bannedHere(`the ${word} here`), null, word); assert.notEqual(bannedIn(`the ${word} here`), null, `${word} stays banned at home`); }
  assert.equal(bannedHere('Version history'), null);
});

test('WORDS is frozen all the way down; a label has at most 5 words, a hint 12, a paragraph 25, and none has a banned word', () => {
  assert.equal(Object.isFrozen(WORDS), true); assert.equal(Object.isFrozen(WORDS.label), true); assert.throws(() => { (WORDS.label as Record<string, string>).start = 'x'; }, TypeError);
  const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['paragraph', LIMITS.paragraph]] as const;
  for (const [group, limit] of groups) {
    const entries = Object.entries(WORDS[group]);
    assert.ok(entries.length >= 5, group);
    for (const [key, text] of entries) { assert.ok(countWords(text) <= limit, `${group}.${key}: ${text}`); assert.equal(bannedHere(text), null, `${group}.${key}`); assert.equal(text, text.trim(), `${group}.${key}`); }
  }
  for (const line of WORDS.notInPreview) { assert.ok(countWords(line) <= LIMITS.popover, line); assert.equal(bannedHere(line), null, line); }
  assert.deepEqual(WORDS.notInPreview, ['The confirm sheet for a community skill', 'The layouts for a 900 by 600 window', 'Real files', 'Real runs']);
});

test('the words copied from the design are exactly as written in the pictures', () => {
  const l = WORDS.label, h = WORDS.hint, p = WORDS.paragraph;
  assert.deepEqual([l.newHarness, l.workspace, l.versionHistory, l.start, l.openInBuilder, l.assignToProject, l.viewFile, l.removeFromHarness, l.addToHarness, l.addParts, l.startFromScan, l.emptyTitle],
    ['New harness', 'Workspace', 'Version history', 'Start', 'Open in builder', 'Assign to project', 'View file', 'Remove from this harness', 'Add to a harness', 'Add parts', 'Start from a scan', 'This harness is empty']);
  assert.deepEqual([h.legendNew, h.legendMissing, h.missingNode, h.removeNote, h.readOnlyRelease, h.emptyBody], ['New in this harness', 'Missing. Fix shows the change first.', 'Missing. Needed.', 'This does not delete the file.', 'Read-only in this release', 'Add agents, skills, tools and context from your Library.']);
  assert.equal(p.pickAPart, 'Pick a part to see its file, what it uses and where else it is used.'); assert.equal(p.fileNote, 'Secrets in this file are hidden here. Bowerloom keeps what it reads on this computer.');
  assert.equal(harnessListHint(4), '4 harnesses. Pick one to see what holds.'); assert.equal(projectsHint(5), '5 projects. Each shows where a harness is installed.');
  assert.equal(fromWords('skill', 'Caveman plug-in', '1'), 'Skill from Caveman plug-in, version 1'); assert.equal(fromWords('agent', 'Made by you', undefined), 'Agent from Made by you');
});

test('the words built from a name or a number obey the same rules', () => {
  const built = [startName('Weekly report crew'), fixName('Translate'), addName('Translate'), installTitle('Weekly report crew'), linkFromWords('Researcher'), addToWords('Spreadsheet', 'Weekly report crew'), partsCount(11), partsCount(1),
    nodeName('Researcher', 'agent', 'Finds sources.'), tabWords('skill', 49), missingKind('skill'), addTo('Caveman pack'), namedBy(['Writer']), willUse(['Writer']), harnessListHint(1), ...Object.values(KIND_NAME), ...Object.values(KIND_PLURAL)];
  for (const text of built) assert.equal(bannedHere(text), null, text);
  for (const text of [linkFromWords('Researcher'), namedBy(['Writer']), willUse(['Writer']), harnessListHint(4), tabWords('skill', 49)]) assert.ok(countWords(text) <= LIMITS.hint, text);
});

test('the words the logic builds (statuses, counts, install lines, notices) obey the same rules', () => {
  const w = createSampleWorld(), texts: string[] = [];
  for (const h of w.harnesses) { texts.push(status.harnessStatus(w, h.id).words, status.harnessCountsWords(w, h), status.partsWords(h)); for (const part of status.partsOf(w, h)) texts.push(part.name, part.summary, part.description); }
  for (const p of w.projects) { const s = status.projectStatus(w, p.id); if (s !== null) texts.push(s.words); }
  for (const i of w.installs) texts.push(status.installLine(w, i).words, ...status.installStates(w, i).map(r => status.chipWords(r.name, r.state)));
  for (const i of w.interfaces) for (const h of w.harnesses) texts.push(status.installInterfaceLine(w, h, i), status.startInterfaceLine(w, SAMPLE_IDS.bowerloom, h.id, i).words);
  texts.push(status.compareNotice(2)!, status.startButtonWords(2), status.usedInWords(0), status.usedInWords(2), status.usedInOtherWords(1), ...(['installed', 'out-of-date', 'conflict', 'not-installed'] as const).map(status.stateWords));
  const plan = buildInstallPlan(w, SAMPLE_IDS.bowerloom, SAMPLE_IDS.weekly, ['claude-code', 'codex']);
  texts.push(planSummary(plan), installButtonWords(plan), ...w.history.map(e => e.text), ...w.interfaces.map(i => i.healthWords));
  for (const text of texts) assert.equal(bannedHere(text), null, text);
  for (const text of [status.compareNotice(2)!]) assert.ok(countWords(text) <= LIMITS.paragraph, text);
  for (const text of texts.filter(t => t !== status.compareNotice(2))) assert.ok(countWords(text) <= LIMITS.hint, text);
});

test('no source file of the preview has a banned word in a string literal or in JSX text', () => {
  const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const files = ['renderer/harness', 'shared/harness'].flatMap(dir => readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join((e as unknown as { parentPath: string }).parentPath, e.name)));
  assert.ok(files.length >= 30, `${files.length} files`);
  for (const file of files) {
    const code = strip(readFileSync(file, 'utf8')).replace(/\b(?:from|import)\s*['"][^'"\n]*['"]/g, '');
    const pieces: string[] = [];
    for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) pieces.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' '));
    for (const m of code.matchAll(/>([^<>{}=;()]*[A-Za-z][^<>{}=;()]*)</g)) pieces.push(m[1]!);
    // The sample's own text (the files that people read) is checked on the data; ids, paths and CSS class names are code.
    if (file.endsWith('/sample.ts')) continue;
    for (const piece of pieces) assert.equal(bannedHere(piece), null, `${file}: ${piece}`);
  }
});
