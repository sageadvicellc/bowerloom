// The words of the harness-first preview: every fixed string obeys the limits and the banned list, the source holds no banned word, and the status words built by the logic obey the same rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DESIGN_WORDS, HARNESS_BANNED, LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { BANNED, bannedIn } from '../shared/home/textbudget.js';
import { KIND_NAME, KIND_PLURAL, WORDS, addName, addTo, addToWords, fixName, fromWords, helpLines, notYetWords, detailsName, harnessListHint, installTitle, linkFromWords, missingKind, namedBy, nodeName, partsCount, projectsHint, startName, tabWords, willUse, welcomeGoLine } from '../renderer/harness/words.js';
import { FLOW, historyLines, welcomeLines } from '../renderer/harness/words-flow.js';
import { RUN_WORDS, bringTipWords, bringToastWords, noRunsWords } from '../renderer/harness/runs-words.js';
import { ASK } from '../main/engine-consent.js';
import { NOTES_REFUSAL_WORDS } from '../renderer/harness/words-engine.js';
import { SAMPLE_MESSAGES } from '../shared/engine/sample.js';
import { REAL, countsLine, couldNotReadLine, foldersLine, foundInLine, foundPlaces, modelBadgeLine, moreNotes, nothingReadLine, limitsLine, readCountLine, readSummary, skippedLine, textsCutLine } from '../renderer/harness/real/words-real.js';
import { reasonWords } from '../renderer/home/real/words.js';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import * as status from '../shared/harness/status.js';
import { buildInstallPlan, installButtonWords, planSummary } from '../shared/harness/files.js';
import { DESKTOP } from './support.js';

test('the preview\'s rule is the home rule less the words the design is built on, and every other banned word stays', () => {
  assert.deepEqual([...DESIGN_WORDS].sort(), ['conflict', 'harness', 'helper', 'plan', 'project', 'scan', 'version']);
  assert.ok(DESIGN_WORDS.every(w => BANNED.includes(w)), 'each design word was banned at home');
  assert.deepEqual([...HARNESS_BANNED], BANNED.filter(w => !DESIGN_WORDS.includes(w)));
  for (const word of ['global', 'scope', 'slice', 'apply', 'adopt', 'export', 'import', 'team', 'grant', 'wire', 'ghost', 'lasso', 'mcp', 'token']) assert.notEqual(bannedHere(`the ${word} here`), null, word);
  for (const word of ['harness', 'project', 'conflict', 'scan', 'helper', 'plans', 'version']) { assert.equal(bannedHere(`the ${word} here`), null, word); assert.notEqual(bannedIn(`the ${word} here`), null, `${word} stays banned at home`); }
  assert.equal(bannedHere('Install history'), null);
  assert.notEqual(bannedHere('Pick an interface'), null, 'the screens say engine, so interface is banned again');
  assert.equal(bannedHere('Pick an engine'), null);
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
  assert.deepEqual(WORDS.notInPreview, ['The confirm sheet for a community skill', 'Real files', 'Real runs']);
});

test('the words copied from the design are exactly as written in the pictures', () => {
  const l = WORDS.label, h = WORDS.hint, p = WORDS.paragraph;
  assert.deepEqual([l.newHarness, l.workspace, l.installHistory, l.start, l.openInBuilder, l.assignToProject, l.viewFile, l.removeFromHarness, l.addToHarness, l.addParts, l.startFromScan, l.emptyTitle],
    ['New harness', 'Workspace', 'Install history', 'Start', 'Open in builder', 'Assign to project', 'View file', 'Remove from this harness', 'Add to a harness', 'Add parts', 'Start from a scan', 'This harness is empty']);
  assert.deepEqual([h.legendNew, h.legendMissing, h.missingNode, h.removeNote, h.readOnly, h.emptyBody], ['New in this harness', 'Missing. Fix shows the change first.', 'Missing. Needed.', 'Remove deletes the skill\'s files when you save.', 'Read-only', 'Add agents, skills, tools and context from your Library.']);
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

/**
 * Names in code that are banned words as text but not words on a screen: a route, a step, a store operation, a data tag, a file name. Each file lists its names piece by piece, exactly. A new one in
 * any file, and a name that left a file, both fail until this list says so. No whole string is exempt anywhere else, so "interface" as a label or a note is still caught.
 */
const times = (piece: string, n: number): string[] => Array.from({ length: n }, () => piece);
const CODE_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'renderer/harness/HarnessApp.tsx': times('interfaces', 1), 'renderer/harness/Navigation.tsx': times('interfaces', 3), 'renderer/harness/Shell.tsx': times('interfaces', 1), 'renderer/harness/ui.tsx': times('interfaces', 2),
  'renderer/harness/screens/Interfaces.tsx': times('interfaces', 2), 'renderer/harness/screens/Projects.tsx': times('interfaces', 1), 'renderer/harness/sheets/InstallSheet.tsx': times('interfaces', 5), 'renderer/harness/sheets/ProjectSheet.tsx': times('interfaces', 8),
  'shared/harness/builder-draft.ts': times('last-interface', 2), 'shared/harness/route.ts': times('interfaces', 8), 'shared/harness/status.ts': times('interfaces', 1),
  'shared/harness/store.ts': [...times('set-interface', 4), ...times('interface', 4)], 'shared/harness/types.ts': times('set-interface', 1),
  'shared/engine/types.ts': [...times('mcp', 3), 'apply'], 'main/engine-consent.ts': ['mcp', 'mcp.json'],
});
/** The text pieces of a source file: its string literals and its JSX text, without comments and import paths. */
function textPieces(source: string): string[] {
  const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const code = strip(source).replace(/\b(?:from|import)\s*['"][^'"\n]*['"]/g, '');
  const pieces: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) pieces.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' '));
  for (const m of code.matchAll(/>([^<>{}=;()]*[A-Za-z][^<>{}=;()]*)</g)) pieces.push(m[1]!);
  return pieces;
}

test('no source file of the preview, its engine screens or main\'s dialogs has a banned word in a string literal or in JSX text', () => {
  const dirs = ['renderer/harness', 'shared/harness', 'shared/engine'];
  const files = [...dirs.flatMap(dir => readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join((e as unknown as { parentPath: string }).parentPath, e.name))), join(DESKTOP, 'main', 'engine-consent.ts')];
  assert.ok(files.length >= 30, `${files.length} files`);
  assert.ok(files.some(f => f.endsWith(`${sep}main${sep}engine-consent.ts`)) && files.some(f => f.includes(`${sep}shared${sep}engine${sep}`)), 'the dialog words and the engine words are scanned');
  const listed = new Set<string>();
  for (const file of files) {
    const name = relative(DESKTOP, file).split(sep).join('/');
    // The sample's own text (the files that people read) is checked on the data. real-map.ts names the reader's own kinds in code (a data tag is not a word on screen); the words it makes are checked in tests/harness-real-map.test.ts.
    // shared/engine/sample.ts holds the text of whole sample files (code, hooks, rules); its refusal messages are held to the words by the test below.
    if (name === 'shared/harness/sample.ts' || name === 'shared/harness/real-map.ts' || name === 'shared/engine/sample.ts') continue;
    const rest = textPieces(readFileSync(file, 'utf8'));
    for (const piece of CODE_NAMES[name] ?? []) {
      const at = rest.indexOf(piece);
      assert.notEqual(at, -1, `${name}: the listed name "${piece}" is not there any more, or is listed too often`);
      rest.splice(at, 1);
    }
    if (name in CODE_NAMES) listed.add(name);
    for (const piece of rest) assert.equal(bannedHere(piece), null, `${name}: ${piece}`);
  }
  assert.deepEqual([...listed].sort(), Object.keys(CODE_NAMES).sort(), 'every file in the list was scanned');
});

test('the guard catches the old word as a whole string anywhere that is not a listed name in code', () => {
  assert.notEqual(bannedHere('interface'), null); assert.notEqual(bannedHere('Interfaces'), null); assert.notEqual(bannedHere('last-interface'), null);
  assert.deepEqual(textPieces("const label = 'interface'; const note = `Pick an interface`;"), ['interface', 'Pick an interface'], 'a string that equals the old word is a piece like any other');
  assert.deepEqual(textPieces('<h2>interface</h2>'), ['interface'], 'a bare word on a screen is a piece, and only the per-file list of names in code lets one stay');
});

test('main\'s write dialogs and the engine words say engine, not interface', () => {
  const asks = [ASK.projection('bowerloom', 3, 'abcdef123456', 2), ASK.record('bowerloom', 'abcdef123456', 2)];
  for (const ask of asks) { assert.match(ask.detail, /an engine carries more weakly/); assert.doesNotMatch(`${ask.title} ${ask.message} ${ask.detail}`, /interface/i); }
  for (const text of [...Object.values(SAMPLE_MESSAGES), ...Object.values(NOTES_REFUSAL_WORDS)]) assert.doesNotMatch(text, /interface/i, text);
});

test('the stale-plan notes say plan, not preview', () => {
  assert.equal(NOTES_REFUSAL_WORDS.NOTES_STALE, 'The folder changed. Look at the plan again.');
  assert.equal(SAMPLE_MESSAGES.NOTES_STALE, 'The folder changed after the plan, or the approval is for another plan. Nothing was changed. Plan again.');
});

test('the real words (the preview on the person\'s own folders) are frozen, within the limits, and have no banned word', () => {
  assert.equal(Object.isFrozen(REAL), true); assert.equal(Object.isFrozen(REAL.label), true); assert.equal(Object.isFrozen(REAL.notInBeta), true);
  assert.throws(() => { (REAL.label as Record<string, string>).useSample = 'x'; }, TypeError);
  for (const [group, limit] of [['label', LIMITS.label], ['hint', LIMITS.hint], ['paragraph', LIMITS.paragraph]] as const) {
    const entries = Object.entries(REAL[group]);
    assert.ok(entries.length >= 4, group);
    for (const [key, text] of entries) { assert.ok(countWords(text) <= limit, `${group}.${key}: ${text}`); assert.equal(bannedHere(text), null, `${group}.${key}`); assert.equal(text, text.trim(), `${group}.${key}`); }
  }
  for (const line of REAL.notInBeta) { assert.ok(countWords(line) <= LIMITS.popover, line); assert.equal(bannedHere(line), null, line); }
  assert.deepEqual(REAL.notInBeta, ['Start', 'Compare', 'Runs', 'Assign to project, in the Harnesses details', 'Assign harness, Install, Update and Review, in Projects', 'Add (the plus button), in the Library', 'Add a folder, in Projects']);
  assert.ok(!REAL.notInBeta.some(line => /^Install from a folder$|^From a folder$/.test(line)), 'Install from a folder works, so it is not on the list');
  assert.deepEqual([REAL.label.beta, REAL.label.aboutBeta, REAL.label.notInBeta, WORDS.hint.notInBeta], ['Beta', 'About this beta', 'Not in beta.1', 'Not in beta.1.']);
  assert.equal(notYetWords(true), 'Not in beta.1.'); assert.equal(notYetWords(false), 'Not in this preview.');
});

test('the real words say what the design asks for, word for word', () => {
  assert.equal(REAL.label.consentTitle, 'Read what is inside?');
  assert.deepEqual([REAL.label.yesRead, REAL.label.notNow, REAL.label.addFolder, REAL.label.useSample, REAL.label.tryAgain, REAL.label.nothingTitle], ['Yes, read them', 'Not now', 'Add a folder', 'Use the sample', 'Try again', 'Nothing found yet']);
  assert.equal(REAL.paragraph.betaAbout, 'Bowerloom is in beta. It reads your own folders and writes only after you approve what it will write.');
  assert.equal(couldNotReadLine(3), 'Could not read 3 things.'); assert.equal(couldNotReadLine(1), 'Could not read 1 thing.');
  assert.equal(REAL.hint.stoppedEarly, 'It stopped early to stay within its limits.'); assert.equal(REAL.hint.consentOne, 'It reads text only in the folders you ticked.');
  assert.equal(REAL.hint.replaceLine, 'Reading again starts over. It changes nothing on your computer.'); assert.equal(REAL.label.cancel, 'Cancel');
  assert.match(REAL.paragraph.chooseLine, /opened settings files and read names and structure\. It reads text only in folders you keep ticked\./, 'the Choose line says what is opened before the tick and what only after it');
  assert.doesNotMatch(REAL.paragraph.chooseLine, /opens only the folders you keep ticked/);
  assert.match(REAL.paragraph.consentNotes, /whole folder/); assert.match(REAL.paragraph.consentNotes, /first lines of up to 2000/); assert.match(REAL.hint.consentLinks, /Linked folders are followed/);
});

test('the words the real screens build from a number or a code obey the same rules', () => {
  const built = [foundPlaces(1), foundPlaces(4), countsLine({ agents: 2, skills: 6, tools: 3, hooks: 1, notes: 6 }), readSummary(3, 14), couldNotReadLine(2), textsCutLine(1), textsCutLine(5), moreNotes(1), moreNotes(4), foldersLine(1), foldersLine(3), nothingReadLine(null), nothingReadLine({ couldNotRead: 0, stoppedEarly: true, notes: [], textsCut: 0 }),
    readCountLine(1, 1), readCountLine(12, 180), foundInLine('Your Claude Code folder'), foundInLine('Caveman plug-in'), modelBadgeLine('Claude Code only'), ...['BUSY', 'NOT_ALLOWED', 'UNKNOWN_PLACE', 'NO_BRIDGE', 'FAILED'].map(reasonWords)];
  for (const text of built) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.hint, text); }
  for (const text of [skippedLine(1, true), skippedLine(11, true), skippedLine(1, false), skippedLine(11, false), limitsLine(), REAL.hint.nextStep, REAL.hint.detailsFrom]) { assert.equal(bannedHere(text), null, text); assert.ok(countWords(text) <= LIMITS.paragraph, text); }
  assert.equal(foundInLine('Your Claude Code folder'), 'Found in your Claude Code folder'); assert.equal(foundInLine('Caveman plug-in'), 'Found in Caveman plug-in'); assert.equal(REAL.label.notChecked, 'Not checked');
  assert.equal(textsCutLine(1), '1 text was cut short.'); assert.equal(textsCutLine(5), '5 texts were cut short.');
  assert.equal(readCountLine(1, 1), '1 source, 1 part in all.'); assert.equal(foldersLine(3), '3 folders ticked.'); assert.equal(moreNotes(4), 'and 4 more notes.');
});

test('the words that depend on the mode never say that a blocked feature works in real mode, and the sample keeps its words', () => {
  const real = [...helpLines(true), ...welcomeLines(true), welcomeGoLine(true), ...historyLines(true, 0), noRunsWords(true), bringTipWords(true), bringToastWords(true)];
  for (const text of real) {
    assert.equal(bannedHere(text), null, text);
    assert.doesNotMatch(text, /Press Start|press Install|run it in any engine|undo an install in Install history|You can undo in Install history/i, text);
  }
  for (const text of [...welcomeLines(true), ...historyLines(true, 0), noRunsWords(true), bringToastWords(true), bringTipWords(true)]) assert.ok(countWords(text) <= LIMITS.hint, text);
  for (const text of helpLines(true)) assert.ok(countWords(text) <= LIMITS.paragraph, text);
  assert.equal(noRunsWords(true), 'Runs are not in beta.1.');
  assert.equal(welcomeLines(true)[1], 'Running one is not in beta.1.');
  assert.equal(helpLines(true)[1], 'Build one from your agents and skills. Running one is not in beta.1.');
  assert.equal(helpLines(true)[3], 'Bowerloom only reads until you approve a write. To undo a folder install, press Undo, then approve the removal.');
  assert.deepEqual(historyLines(true, 0), ['Nothing is listed yet. Installs from Projects are not in beta.1.', 'To undo a folder install, press Undo, then approve the removal.']);
  assert.equal(bringToastWords(true), 'Not in beta.1.'); assert.equal(bringTipWords(true), 'Brings the engine window forward. Not in beta.1.');
  // The sample keeps the words of the pictures.
  assert.deepEqual(helpLines(false), [WORDS.paragraph.helpOne, WORDS.paragraph.helpTwo, WORDS.paragraph.helpThree, WORDS.paragraph.helpFour]);
  assert.equal(helpLines(false)[1], 'Build one from your agents and skills. Then run it in any engine you use.');
  assert.equal(helpLines(false)[3], 'Bowerloom only reads until you press Install. You can undo an install in Install history.');
  assert.deepEqual(welcomeLines(false), ['Build a harness from your agents and skills.', 'Then run it in any engine you use.']);
  assert.deepEqual(historyLines(false, 0), [FLOW.hint.historyHint]); assert.deepEqual(historyLines(false, 3), [FLOW.hint.historyHint]); assert.deepEqual(historyLines(true, 2), [FLOW.hint.historyHint]);
  assert.equal(noRunsWords(false), 'No runs yet. Press Start on a harness.');
  assert.equal(bringToastWords(false), 'Not in this preview.'); assert.equal(bringTipWords(false), 'Brings the engine window forward. Not in this preview.');
  assert.equal(RUN_WORDS.hint.noRuns, 'No runs yet. Press Start on a harness.');
});
