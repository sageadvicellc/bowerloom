// The reader of a real setup (step one and step two of the first read) and adoption must agree on what they count. A Codex agent file with its instructions
// in a multi-line string (`"""` or `'''`) is one agent to the reader, so it must be one adopted subagent, or one listed entry with a reason. It is never lost
// between the two. Made-up folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import { planAdoption } from '../../../packages/adoption/src/index.js';
import { tempDir } from './support.js';

const Q3 = '"'.repeat(3), S3 = "'".repeat(3);
const agent = (name: string, instructions: string, extra = ''): string => `name = "${name}"\ndescription = "The ${name}."\n${extra}developer_instructions = ${instructions}\n`;

const FILES: Readonly<Record<string, string>> = {
  'basic-one-line.toml': agent('basic-one-line', '"Read the diff."'),
  'basic-multi.toml': agent('basic-multi', `${Q3}\nRead the diff.\nReport "each" finding.\n${Q3}`),
  'basic-folded.toml': agent('basic-folded', `${Q3}\\\n  Read the diff, \\\n  then report.${Q3}`),
  'literal-multi.toml': agent('literal-multi', `${S3}\nUse C:\\work and \\n as text.\n${S3}`),
  // A file saved with CR LF line endings, with comments before, after and around a multi-line string.
  'crlf-comments.toml': `# top\nname = "crlf-comments"\ndescription = "The crlf-comments." # why\ndeveloper_instructions = ${Q3}\nRead the diff.\nStop.\n${Q3} # the end\n`.replace(/\n/g, '\r\n'),
  'quotes-before-closer.toml': agent('quotes-before-closer', `${Q3}ends with a "quote${'"'.repeat(4)}`),
};
const REFUSED: Readonly<Record<string, string>> = {
  // A read-only agent is a tool limit adoption lists with a reason. The reader still counts it as an agent.
  'read-only.toml': agent('read-only', `${Q3}\nLook only.\n${Q3}`, 'sandbox_mode = "read-only"\n'),
};

function put(dir: string, files: Readonly<Record<string, string>>): void {
  mkdirSync(join(dir, '.codex', 'agents'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, '.codex', 'agents', name), text);
}

async function scanCount(home: string): Promise<{ counted: number; records: number }> {
  const scanner = createScanner({ home });
  const d = await scanner.discover();
  const place = d.places.find(p => p.label === 'Codex at home');
  assert.ok(place, d.places.map(p => p.label).join(' | '));
  const batch = await scanner.read([place.id]);
  return { counted: place.counts.agents, records: batch.reads[0]!.records.filter(r => r.kind === 'agent').length };
}

test('the reader and adoption agree on Codex agent files with multi-line strings: every file the reader counts is adopted, and none is refused', async t => {
  const dir = tempDir(t);
  put(dir, FILES);
  const scanned = await scanCount(dir);
  const plan = planAdoption({ projectDir: dir, stateDir: tempDir(t), engines: [{ id: 'codex' }] });
  const adopted = plan.items.filter(i => i.part === 'subagents').length;
  const refused = plan.unmapped.filter(u => u.path.startsWith('.codex/agents/')).length;
  assert.equal(scanned.counted, Object.keys(FILES).length, 'step one counts every file by its path');
  assert.equal(scanned.records, scanned.counted, 'step two reads one agent from each file');
  assert.equal(refused, 0, JSON.stringify(plan.unmapped));
  assert.equal(adopted, scanned.records, 'adoption adopts the same agents');
});

test('the counts still agree when adoption lists a file with a reason: adopted plus listed equals what the reader counts', async t => {
  const dir = tempDir(t);
  put(dir, { ...FILES, ...REFUSED });
  const scanned = await scanCount(dir);
  const plan = planAdoption({ projectDir: dir, stateDir: tempDir(t), engines: [{ id: 'codex' }] });
  const adopted = plan.items.filter(i => i.part === 'subagents').length;
  const listed = new Set(plan.unmapped.filter(u => u.path.startsWith('.codex/agents/')).map(u => u.path)).size;
  assert.equal(scanned.counted, Object.keys(FILES).length + 1);
  assert.equal(scanned.records, scanned.counted);
  assert.equal(listed, 1, 'only the read-only agent is listed');
  assert.equal(adopted + listed, scanned.records);
});
