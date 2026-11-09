// Test tooling, never shipped. A `node --test` reporter that prints one JSON line for each leaf test:
//   {"file":"<path relative to the working folder>","name":"<test name>","status":"pass|fail|skip|todo"}
// Use it as: node --test --test-reporter=<path>/tools/inventory-reporter.mjs <files>
// tools/test-inventory.mjs builds the frozen inventory from this output.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const relative = file => (file === undefined ? '' : file.startsWith('file:') ? path.relative(process.cwd(), fileURLToPath(file)) : path.relative(process.cwd(), file));

export default async function* inventoryReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const data = event.data;
    // A suite or a file wrapper reports too (details.type === 'suite'); only the leaf tests count.
    if (data.details?.type === 'suite') continue;
    const status = event.type === 'test:fail' ? 'fail' : data.skip !== undefined && data.skip !== false ? 'skip' : data.todo !== undefined && data.todo !== false ? 'todo' : 'pass';
    yield JSON.stringify({ file: relative(data.file), name: data.name, status }) + '\n';
  }
}
