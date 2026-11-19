// Runs the packaged-app checks of Gate 1 Part C on macOS: the fuse check and signing check, the install of the dmg and the zip to a path with spaces and non-ASCII
// characters, and then the whole Part C scenario set against the packaged app (whose fuses are the shipped ones). Run `npm run package` first.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const exe = join(spike, 'app', 'release', arch, 'Bowerloom Spike.app', 'Contents', 'MacOS', 'Bowerloom Spike');
if (!existsSync(exe)) { console.error(`No packaged app at ${exe}. Run npm run package first.`); process.exit(2); }

const node = (args, env = {}) => spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;
const packaged = node(['--test', '--test-reporter=spec', '--test-concurrency=1', join(spike, 'test', 'packaged.test.mjs')]);
const partC = node(['--test', '--test-reporter=spec', '--test-concurrency=1', join(spike, 'test', 'part-c.test.mjs')], { SPIKE_ELECTRON_EXE: exe });
process.exit(packaged === 0 && partC === 0 ? 0 : 1);
