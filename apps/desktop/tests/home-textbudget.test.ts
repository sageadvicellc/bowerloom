// The text budget helper: every later screen test calls assertTextBudget on its rendered markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BANNED, BANNED_PATTERN, assertTextBudget, countWords, extractText } from '../shared/home/textbudget.js';

const ok = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup);
const problems = (markup: string): string[] => assertTextBudget(markup);

test('countWords counts words and ignores bare punctuation', () => {
  assert.equal(countWords(''), 0); assert.equal(countWords('  '), 0); assert.equal(countWords('One'), 1);
  assert.equal(countWords('Click an agent to see what it can do.'), 9);
  assert.equal(countWords('a · b — c'), 3, 'a dot or a dash is not a word');
  assert.equal(countWords('2 of 6'), 3);
});

test('extractText decodes entities, skips scripts and styles, and reports the nodes in order', () => {
  const nodes = extractText('<div><p>Fish &amp; chips</p><style>.a{}</style><span>It&#x27;s&nbsp;fine</span></div>');
  assert.deepEqual(nodes.map(n => n.text), ['Fish & chips', 'It\'s fine']);
});

test('markup within the limits passes', () => {
  ok('<section><h2>Skills</h2><p>Nothing here yet.</p><button type="button">Save</button></section>');
  ok('<button>One two three four five</button>');
  ok('<p>one two three four five six seven eight nine ten eleven twelve</p>');
  ok('');
  ok('<div><svg viewBox="0 0 24 24"><path d="M1 1"></path></svg></div>');
});

test('a text node of more than 12 words fails, and the problem quotes where it starts', () => {
  const list = problems('<p>one two three four five six seven eight nine ten eleven twelve thirteen</p>');
  assert.equal(list.length, 1); assert.match(list[0]!, /13 words/); assert.match(list[0]!, /one two three/);
});

test('a heading or a button of more than 5 words fails, whatever is nested inside it', () => {
  assert.equal(problems('<h2>One two three four five six</h2>').length, 1);
  assert.equal(problems('<h1>One <em>two three</em> four five six</h1>').length, 1);
  assert.equal(problems('<button type="button">One two three four five six</button>').length, 1);
  assert.equal(problems('<button><span>One two</span><span>three four</span><span>five six</span></button>').length, 1);
  for (const tag of ['h1', 'h2', 'h3', 'h4']) assert.equal(problems(`<${tag}>a b c d e f</${tag}>`).length, 1, tag);
});

test('a label in an attribute (aria-label, title) has the same 5 word limit', () => {
  assert.equal(problems('<button aria-label="One two three four five six">?</button>').length, 1);
  ok('<button aria-label="Show me around">?</button>');
});

test('the banned words fail as whole words, in any case, and a longer word is fine', () => {
  for (const word of ['harness', 'Global', 'SCOPE', 'slice', 'version', 'apply', 'undo', 'scan', 'adopt', 'conflict', 'interface', 'export', 'import', 'helper', 'team', 'plan', 'grant', 'wire', 'ghost', 'lasso', 'MCP', 'token', 'project']) {
    assert.equal(problems(`<p>Use the ${word} now</p>`).length, 1, word);
  }
  assert.equal(problems('<p>Many Harnesses</p><p>and teams</p>').length, 2, 'plurals count');
  ok('<p>Planet, imported, sliced, Teamwork, grantee, scanner.</p>');
  assert.equal(problems('<p>The access class</p>').length, 1, 'a two word banned phrase');
});

test('the words the storyboard asks for are fine, including "This project only"', () => {
  ok('<button>This project only</button><button>Everywhere</button><p>Save points, Go back, Find, Bring in, Share, Open a shared file</p><p>Draw a loop</p><p>can only read</p>');
  assert.equal(problems('<p>The project folder</p>').length, 1, 'project alone is still banned');
});

test('a banned word in an attribute label also fails', () => {
  assert.equal(problems('<button aria-label="Apply it">x</button>').length, 1);
});

test('popover text may run to 25 words and may say MCP, and only popover text', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
  ok(`<div data-budget="popover"><p>${twenty}</p></div>`);
  ok('<div data-budget="popover"><p>MCP is how an agent talks to another program.</p></div>');
  const twentySix = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  assert.equal(problems(`<div data-budget="popover"><p>${twentySix}</p></div>`).length, 1);
  assert.equal(problems('<p>MCP is on.</p>').length, 1, 'outside a popover MCP fails');
  assert.equal(problems('<div data-budget="popover"><p>The harness runs.</p></div>').length, 1, 'other banned words still fail inside a popover');
  assert.equal(problems(`<div data-budget="popover"><h3>One two three four five six</h3></div>`).length, 0, 'a popover heading may be longer, up to 25');
  assert.equal(problems(`<div data-budget="popover">${twenty}</div><p>${twenty}</p>`).length, 1, 'text after the popover is outside it again');
});

test('a popover keeps its exemption through nested tags and sibling tags', () => {
  ok(`<aside data-budget="popover"><div><p>${Array.from({ length: 24 }, (_, i) => `w${i}`).join(' ')}</p></div></aside><p>Short.</p>`);
});

test('several problems are all reported', () => {
  const list = problems('<h2>a b c d e f</h2><p>The harness is here</p><button>a b c d e f g</button>');
  assert.equal(list.length, 3);
});

test('BANNED lists the required words, and BANNED_PATTERN is built from it', () => {
  for (const word of ['harness', 'global', 'project', 'scope', 'slice', 'version', 'apply', 'undo', 'scan', 'adopt', 'conflict', 'interface', 'export', 'import', 'access class', 'helper', 'team', 'plan', 'grant', 'wire', 'ghost', 'lasso', 'mcp', 'token']) assert.ok(BANNED.includes(word), word);
  assert.equal(Object.isFrozen(BANNED), true);
  assert.ok(BANNED_PATTERN.test('A Harness'));
});
