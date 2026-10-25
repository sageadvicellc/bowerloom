// The persona files, the report format, the run notes and the subagent brief: the sections each must hold, the same ten tasks in every persona, plain words
// for the tasks, and the Simple English lint rules that the repository hook applies to Markdown (short sentences, no semicolons or dashes, active voice words).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const TOOL = join(DESKTOP, 'tools', 'personas');
const PERSONAS = ['persona-layperson.md', 'persona-senior-dev.md', 'persona-designer.md', 'persona-it-security.md'];
const read = (...parts: string[]): string => readFileSync(join(TOOL, ...parts), 'utf8');
const SECTIONS = ['## Who I am', '## What I want', '## What I will not tolerate', '## How I speak', '## How I test', '## Tasks to try'];
const TASKS = ['First minute', 'See all my', 'Understand one', 'Take a skill away, then undo', 'Give a', 'Two versions of one skill', 'Pick notes for', 'Send my setup to someone', 'Find earlier states', 'Watch the intro again'];

/** The words of each control or label in the app. A task that names one gives the answer away, so a persona has to find the control itself. */
const UI_LABELS = ['Find my agents', 'Share my agents', 'Choose notes', 'Save points', 'Go back', 'Skip tour', 'Add drawer', 'Open a shared file', 'Show more', 'Discard changes', 'Undo all changes', 'Share', 'Skip to details', 'Recently changed', 'Replay the tour', 'Version history', 'Resolve two'];

function tasksOf(text: string): string[] {
  const after = text.slice(text.indexOf('## Tasks to try'));
  return after.split('\n').filter(l => /^\d+\. /.test(l));
}

test('the four persona files exist, one for each viewpoint', () => {
  const found = readdirSync(join(TOOL, 'personas')).filter(f => f.endsWith('.md')).sort();
  assert.deepEqual(found, [...PERSONAS].sort());
});

test('each persona file has the six sections, in order, and ends with the task list', () => {
  for (const file of PERSONAS) {
    const text = read('personas', file);
    let at = -1;
    for (const section of SECTIONS) { const next = text.indexOf(`\n${section}\n`); assert.ok(next > at, `${file} must have "${section}" after the one before it`); at = next; }
    assert.ok(text.startsWith('# Persona: '), file);
    const last = text.trimEnd().split('\n').at(-1)!;
    assert.match(last, /^10\. /, `${file} ends with task 10`);
    assert.equal(text.slice(text.indexOf('## Tasks to try')).includes('\n## '), false, `${file}: nothing follows the task list`);
  }
});

test('each persona says who they are: a name, an age, a job, the tools they use, and their mood this morning', () => {
  const who = (file: string): string => { const t = read('personas', file); return t.slice(t.indexOf('## Who I am'), t.indexOf('## What I want')); };
  for (const file of PERSONAS) {
    const text = who(file);
    assert.match(text, /My name is [A-Z][a-z]+ [A-Z][a-z]+\. I am \d{2}\./, `${file}: name and age`);
    assert.match(text, /\b(?:run|lead|am a)\b/i, `${file}: a job`);
    assert.match(text, /\b(?:use|live in|work in)\b/i, `${file}: tools`);
    assert.match(text, /\b(?:woke up|It is Monday|rested|second coffee)\b/, `${file}: mood this morning`);
  }
  assert.match(who('persona-layperson.md'), /woke up/);
  assert.match(who('persona-layperson.md'), /never opened a terminal/);
});

test('each persona has the test habits of their viewpoint', () => {
  const how = (file: string): string => { const t = read('personas', file); return t.slice(t.indexOf('## How I test'), t.indexOf('## Tasks to try')); };
  const layperson = how('persona-layperson.md');
  assert.match(layperson, /never read source code/);
  assert.match(layperson, /three tries/);
  assert.match(layperson, /give up/);
  const dev = how('persona-senior-dev.md');
  for (const word of ['keyboard path', 'File access', 'Escape hatches', 'Silent failures']) assert.match(dev, new RegExp(word), word);
  const designer = how('persona-designer.md');
  for (const word of ['hierarchy', 'consistent|one visual language|compare skill cards', '1280 by 800', '900 by 600', 'dark', 'light', 'tone']) assert.match(`${designer} ${read('personas', 'persona-designer.md')}`, new RegExp(word, 'i'), word);
  const security = how('persona-it-security.md');
  for (const word of ['read', 'write', 'send', 'store', 'secret', 'file from outside']) assert.match(security, new RegExp(word, 'i'), word);
  assert.match(read('personas', 'persona-it-security.md'), /roll ?out/i, 'the security persona asks what a rollout needs');
  for (const file of PERSONAS) assert.match(how(file), /never read source code/, file);
});

test('every persona has the same ten tasks, in the same order, and none of them names a control', () => {
  const lists = PERSONAS.map(f => tasksOf(read('personas', f)));
  for (const [i, list] of lists.entries()) {
    assert.equal(list.length, 10, PERSONAS[i]);
    list.forEach((item, k) => { assert.ok(item.startsWith(`${k + 1}. `), item); assert.ok(item.includes(TASKS[k]!), `${PERSONAS[i]} task ${k + 1} is about "${TASKS[k]}": ${item}`); });
    for (const item of list) for (const label of UI_LABELS) assert.ok(!item.includes(label), `${PERSONAS[i]}: "${item}" names the control "${label}"`);
  }
  const viewpoints = new Set(lists.map(l => l.join('|')));
  assert.equal(viewpoints.size, 4, 'each persona has the tasks worded for their viewpoint');
  for (const f of PERSONAS) assert.match(read('personas', f), /The task text does not name any button\./);
});

test('REPORT-FORMAT.md holds the sections, the ranking, the word limit, and the no-table rule', () => {
  const text = read('REPORT-FORMAT.md');
  for (const heading of ['## First 60 seconds', '## Tasks', '## Top 5 problems', '## What worked', '## Would I keep using it? Why']) assert.ok(text.includes(`\n${heading}\n`), heading);
  assert.match(text, /ONE report/);
  assert.match(text, /under 700 words/);
  assert.match(text, /Use no tables/);
  assert.match(text, /first person/);
  for (const word of ['HIGH', 'MEDIUM', 'LOW', 'done, stuck or gave up', 'tries', 'quote|short quote', 'screen', 'expected', 'concrete fix']) assert.match(text, new RegExp(word, 'i'), word);
  assert.doesNotMatch(text, /^\|.*\|$/m, 'the format uses no table');
});

test('RUN.md is 15 lines or fewer and tells the main session each step of a round', () => {
  const text = read('RUN.md');
  const lines = text.split('\n').filter(l => l.trim() !== '');
  assert.ok(lines.length <= 15, `RUN.md has ${lines.length} lines`);
  for (const must of [/personas:serve/, /--id/, /--out/, /subagent-brief\.md/, /REPORT-FORMAT\.md/, /dated folder/, /outside the repository/, /\bstop\b/, /transcript/, /one subagent per persona|one subagent/i, /goto welcome/, /scratchpad/]) assert.match(text, must, String(must));
  assert.match(text, /removes the data folder that it made, and nothing else/);
});

test('subagent-brief.md carries the rules: no repo, no source, the command list, the report shape, and the placeholders to fill', () => {
  const text = read('subagent-brief.md');
  for (const word of ['<ID>', '<DESKTOP>', '<PASTE THE WHOLE TEXT OF THE PERSONA FILE HERE>', '<PASTE THE WHOLE TEXT OF REPORT-FORMAT.md HERE>']) assert.ok(text.includes(word), word);
  for (const name of ['look', 'click', 'type', 'press', 'hover', 'drag', 'scroll', 'resize', 'theme', 'motion', 'goto', 'log', 'stop']) assert.match(text, new RegExp(`^${name}\\b`, 'm'), `the brief lists ${name}`);
  assert.match(text, /Do not read, search or list any file or folder, except the screenshot files/);
  assert.match(text, /Do not read source code/);
  assert.match(text, /Do not run any command except the `drive\.mjs` command/);
  assert.match(text, /Never stop the server/);
  assert.match(text, /Return it as your final message/);
  assert.match(text, /Stay in character/);
});

/** The mechanical rules of the Simple English lint, as the repository hook applies them to Markdown. */
function lint(markdown: string): string[] {
  const hits: string[] = [];
  const body = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' CODESPAN ')
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/https?:\/\/\S+/g, ' URL ');
  const sentences = body
    .replace(/^\s*(?:[-*]|\d+\.)\s+(.*?)([.!?:])?\s*$/gm, (_m, text: string, end: string | undefined) => `${text}${end ?? '.'} `)
    .split(/(?<=[.!?:])\s+/).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2);
  for (const s of sentences) {
    if (s.split(/\s+/).length > 20) hits.push(`sentence over 20 words: ${s.slice(0, 60)}`);
    const trailing = /\s(if|when)\s/i.exec(s);
    if (trailing !== null && trailing.index >= 4 && !/^(if|when)\b/i.test(s)) hits.push(`condition after the command: ${s.slice(0, 60)}`);
  }
  const rules: [string, RegExp][] = [
    ['contraction', /\b\w+(?:n't|'ll|'re|'ve|'d)\b|\bit's\b|\byou're\b/gi],
    ['modal verb', /\b(?:should|would|may|might|could)\b/gi],
    ['perfect tense', /\b(?:has|have|had)\s+been\b|\b(?:has|have)\s+\w+ed\b/gi],
    ['-ing clause', /,\s*(?:mak|allow|enabl|ensur|highlight|creat|provid|offer|help|reduc|improv|lead|caus|result)ing\b/gi],
    ['semicolon', /;/g],
    ['dash', /—|(?<!\d)–(?!\d)|(?<= )--(?= )|(?<=[^\s\d]{2}) - (?=[^\s\d]{2})/g],
    ['latin abbreviation', /\b(?:e\.g\.|i\.e\.|etc\.?)(?=[\s,)]|$)/gi],
    ['filler word', /\b(?:simply|seamless\w*|effortless\w*|robust|leverag\w*|utiliz\w*|comprehensive|powerful|streamlin\w*|facilitat\w*|crucial|pivotal|delve|plethora|myriad)\b/gi],
  ];
  for (const [name, rule] of rules) for (const m of body.matchAll(rule)) hits.push(`${name}: ${m[0]}`);
  return hits;
}

test('the lint finds what it is meant to find', () => {
  assert.deepEqual(lint('Press the button.\n'), []);
  assert.ok(lint('I could press it.').some(h => h.startsWith('modal verb')));
  assert.ok(lint("I can't press it.").some(h => h.startsWith('contraction')));
  assert.ok(lint('Press it; then wait.').some(h => h.startsWith('semicolon')));
  assert.ok(lint('Press it — then wait.').some(h => h.startsWith('dash')));
  assert.ok(lint('Wait for the screen to change when you press the button.').some(h => h.startsWith('condition after')));
  assert.deepEqual(lint('When the screen changes, wait.'), []);
  assert.ok(lint('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone.').some(h => h.startsWith('sentence over')));
  assert.deepEqual(lint('```\nI could press it; then wait — now.\n```\n'), [], 'code blocks are not linted');
  assert.deepEqual(lint('# A heading that is far longer than twenty words is fine because a title is exempt from the limit of the lint rules here.\n'), []);
});

test('every Markdown file of the tool passes the Simple English lint: short sentences, no semicolons or dashes, no modal verbs', () => {
  const files = ['REPORT-FORMAT.md', 'RUN.md', 'subagent-brief.md', ...PERSONAS.map(f => join('personas', f))];
  for (const file of files) assert.deepEqual(lint(read(file)), [], file);
});

test('no Markdown file of the tool names the vendors that client material must not name, or holds a link', () => {
  for (const file of ['REPORT-FORMAT.md', 'RUN.md', 'subagent-brief.md', ...PERSONAS.map(f => join('personas', f))]) {
    const text = read(file);
    assert.doesNotMatch(text, /Fearless|Advanced Metrics/i, file);
    assert.doesNotMatch(text, /https?:\/\//, file);
  }
});
