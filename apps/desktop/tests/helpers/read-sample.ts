// Run in a child process by the "no spawn, no network" test: seeds the sample and reads everything, as the app does.
// `sample` reads it as sample data. `real` reads it through the controller in real-data mode, with a folder to scan chosen in the settings,
// which is the path a person's own Bowerloom takes.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedSample } from '../../main/sample.js';
import { readSnapshot } from '../../main/reader.js';
import { readItemContent } from '../../main/content.js';
import { createController } from '../../main/controller.js';
import { storeRootOf } from '../../../../packages/project-context/src/index.js';

// The test that starts this process passes a folder it removes itself (argument 4). With none, this process makes one and removes it when it ends.
const [sampleDir, mode, given] = [process.argv[2]!, process.argv[3] ?? 'sample', process.argv[4]];
const app = given !== undefined ? realpathSync(given) : realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-deny-')));
if (given === undefined) process.on('exit', () => rmSync(app, { recursive: true, force: true }));
const world = seedSample(app, sampleDir);
if (mode === 'real') {
  const appDir = join(app, 'real-app'); mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'viewer-settings.json'), JSON.stringify({ theme: 'system', roots: [world.projects], mode: 'real' }));
  const controller = createController({ appDir, sampleDir, version: 'test', platform: 'test', forcedMode: null, home: world.home, env: world.env, pickFolder: async () => null, openExternal: async () => undefined });
  const snapshot = await controller.getSnapshot();
  const key = snapshot.projects[0]!.key;
  await controller.getFileText({ projectKey: key, file: 'config' }); await controller.getItemContent({ kind: 'team', id: 'research-desk', projectKey: null });
  process.stdout.write(`READ ${snapshot.projects.length} projects (${snapshot.mode})\n`);
} else {
  const { snapshot } = await readSnapshot({ mode: 'sample', home: world.home, env: world.env, roots: [world.projects] });
  readItemContent(storeRootOf(world.home), 'store', 'team', 'research-desk');
  process.stdout.write(`READ ${snapshot.projects.length} projects (${snapshot.mode})\n`);
}
