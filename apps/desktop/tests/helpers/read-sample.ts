// Run in a child process by the "no spawn, no network" test: seeds the sample and reads everything, as the app does.
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedSample } from '../../main/sample.js';
import { readSnapshot } from '../../main/reader.js';
import { readItemContent } from '../../main/content.js';
import { storeRootOf } from '../../../../packages/project-context/src/index.js';

const app = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-deny-')));
const world = seedSample(app, process.argv[2]!);
const { snapshot } = await readSnapshot({ mode: 'sample', home: world.home, env: world.env, roots: [world.projects] });
readItemContent(storeRootOf(world.home), 'store', 'team', 'research-desk');
process.stdout.write(`READ ${snapshot.projects.length} projects\n`);
