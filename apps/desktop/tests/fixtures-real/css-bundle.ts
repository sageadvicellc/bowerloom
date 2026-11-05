/**
 * The style sheet that the build of the page makes, as the build makes it: the same esbuild options as tools/bundle.mjs for renderer/app.ts, run in memory. A test reads the order
 * of the rules in it, because the cascade depends on that order. esbuild runs in a child process, as in tests/fixtures-real/static-check.ts, so the test bundle holds no binary.
 */
import { spawnSync } from 'node:child_process';

const CHILD = `
import { build } from 'esbuild';
const { entry } = JSON.parse(process.argv[1]);
const result = await build({ entryPoints: [entry], bundle: true, write: false, outfile: 'out/app.js', format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'silent' });
process.stdout.write(JSON.stringify(result.outputFiles.filter(f => f.path.endsWith('.css')).map(f => f.text)));
`;

/** The text of the CSS file(s) that bundling `entry` (relative to `desktop`) emits, one string for each file. Throws if the build fails. */
export function cssOfEntry(entry: string, desktop: string): string[] {
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, JSON.stringify({ entry })], { cwd: desktop, encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
  if (ran.status !== 0) throw new Error(`The build of ${entry} failed: ${ran.stderr || String(ran.error)}`);
  return JSON.parse(ran.stdout) as string[];
}
