// Packaging and the one-command launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as Record<string, unknown> & { dependencies: Record<string, string>; devDependencies: Record<string, string>; build: Record<string, unknown>; scripts: Record<string, string> };
const root = JSON.parse(readFileSync(join(DESKTOP, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string>; workspaces: string[] };

test('every dependency is pinned to an exact version', () => {
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version}`);
  for (const name of ['electron', 'electron-builder', 'electron-updater']) assert.ok(name in pkg.dependencies || name in pkg.devDependencies, name);
});

test('the viewer is its own package: the command line package and the root workspaces do not include it', () => {
  assert.ok(!root.workspaces.some(w => w.includes('desktop')), 'not a workspace');
  assert.ok(!JSON.stringify(root).includes('electron'), 'the root package holds no Electron dependency');
  assert.equal(existsSync(join(DESKTOP, 'package-lock.json')), true);
});

test('the build targets are macOS (dmg and zip), Windows (nsis), and Linux (AppImage), with a GitHub feed and no publishing', () => {
  const b = pkg.build as { mac: { target: { target: string }[] }; win: { target: string[] }; linux: { target: string[] }; publish: { provider: string; owner: string; repo: string }; appId: string; extraResources: { from: string; to: string }[] };
  assert.deepEqual(b.mac.target.map(x => x.target).sort(), ['dmg', 'zip']); assert.deepEqual(b.win.target, ['nsis']); assert.deepEqual(b.linux.target, ['AppImage']);
  assert.deepEqual(b.publish, { provider: 'github', owner: 'sageadvicellc', repo: 'bowerloom' });
  assert.ok(b.extraResources.some(r => r.from === 'sample-data' && r.to === 'sample-data'));
  assert.match(pkg.scripts.build!, /--publish never/);
  for (const script of Object.values(pkg.scripts)) assert.doesNotMatch(script, /--publish always|publish onTag|npm publish/);
});

test('the commands: one to open the app, one for sample data, both from the repository root', () => {
  assert.equal(root.scripts.desktop, 'node apps/desktop/tools/run.mjs --real-data'); assert.equal(root.scripts['desktop:sample'], 'node apps/desktop/tools/run.mjs --sample-data');
  for (const name of ['desktop:dev', 'desktop:build', 'desktop:test']) assert.ok(root.scripts[name], name);
});

test('the one-command launcher works from another folder: it installs what is missing, builds, and stops before the window with --build-only', () => {
  const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), '--build-only'], { cwd: tmpdir(), encoding: 'utf8', timeout: 240000 });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /Building the viewer/);
  for (const f of ['dist/main.mjs', 'dist/preload.cjs', 'dist/renderer/app.js', 'dist/renderer/index.html', 'dist/renderer/tokens.css', 'dist/renderer/styles.css']) assert.equal(existsSync(join(DESKTOP, f)), true, f);
});

test('the colors and sizes live in one tokens file', () => {
  const css = readFileSync(join(DESKTOP, 'renderer', 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(\s*\d/, 'styles use tokens, not colors');
  assert.match(readFileSync(join(DESKTOP, 'renderer', 'tokens.css'), 'utf8'), /prefers|\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /:focus-visible/);
});

test('the build turns on the safe fuses: no run-as-node, no NODE_OPTIONS, no inspect arguments, asar integrity and asar-only on', () => {
  const f = (pkg.build as { electronFuses: Record<string, boolean> }).electronFuses;
  assert.equal(f.runAsNode, false); assert.equal(f.enableNodeOptionsEnvironmentVariable, false); assert.equal(f.enableNodeCliInspectArguments, false);
  assert.equal(f.enableEmbeddedAsarIntegrityValidation, true); assert.equal(f.onlyLoadAppFromAsar, true); assert.equal(f.grantFileProtocolExtraPrivileges, false);
  assert.match(pkg.devDependencies['@electron/fuses']!, /^\d+\.\d+\.\d+$/);
});

test('the built binary has those fuses (checked when a macOS build is present)', { skip: !existsSync(join(DESKTOP, 'release', 'mac-arm64', 'Bowerloom Viewer.app')) ? 'no macOS build in release/' : false }, () => {
  const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'check-fuses.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const x64 = join(DESKTOP, 'release', 'mac', 'Bowerloom Viewer.app', 'Contents', 'MacOS', 'Bowerloom Viewer');
  if (existsSync(x64)) assert.equal(spawnSync(process.execPath, [join(DESKTOP, 'tools', 'check-fuses.mjs'), x64], { encoding: 'utf8' }).status, 0);
});

test('the launcher gives install scripts a minimal environment: no token reaches them, names match whatever the case', async () => {
  const { installEnv, marker } = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as { installEnv(s: Record<string, string | undefined>): Record<string, string>; marker(d: string): string };
  const env = installEnv({ PATH: '/bin', HOME: '/h', TMPDIR: '/t', BOWERLOOM_GITHUB_TOKEN: 'ghp_secret', NPM_TOKEN: 'npm_secret', GH_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'y', npm_config_registry: 'https://registry.example/', npm_config_proxy: 'http://p:1', 'npm_config__authToken': 'z', npm_config_cafile: '/ca.pem', npm_config__password: 'w', HTTPS_PROXY: 'http://p:2', SYSTEMROOT: 'C:\\Windows', ANTHROPIC_API_KEY: 'k',
    NODE_EXTRA_CA_CERTS: '/extra.pem', SSL_CERT_FILE: '/ssl.pem', ALL_PROXY: 'http://p:3', XDG_CONFIG_HOME: '/xdg', ELECTRON_SKIP_BINARY_DOWNLOAD: '1', ELECTRON_GET_USE_PROXY: '1', GLOBAL_AGENT_HTTPS_PROXY: 'http://p:4', GLOBAL_AGENT_NO_PROXY: 'x', GLOBAL_AGENT_TOKEN: 'secret-agent' });
  assert.deepEqual(Object.keys(env).sort(), ['ALL_PROXY', 'ELECTRON_GET_USE_PROXY', 'ELECTRON_SKIP_BINARY_DOWNLOAD', 'GLOBAL_AGENT_HTTPS_PROXY', 'GLOBAL_AGENT_NO_PROXY', 'HOME', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'PATH', 'SSL_CERT_FILE', 'SYSTEMROOT', 'TMPDIR', 'XDG_CONFIG_HOME', 'npm_config_cafile', 'npm_config_proxy', 'npm_config_registry'].sort());
  for (const value of Object.values(env)) assert.doesNotMatch(value, /secret|^z$|^w$|^k$/);
  // Windows spells names with mixed case: Path, SystemRoot, ComSpec, PathExt. They are kept, under the name they have.
  const win = installEnv({ Path: 'C:\\bin', SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe', PathExt: '.EXE', Temp: 'C:\\t', UserProfile: 'C:\\u', AppData: 'C:\\a', Https_Proxy: 'http://p', Bowerloom_Github_Token: 'ghp_x', NPM_TOKEN: 'n', Npm_Config__AuthToken: 'z', Global_Agent_Token: 'g' });
  assert.deepEqual(Object.keys(win).sort(), ['AppData', 'ComSpec', 'Https_Proxy', 'Path', 'PathExt', 'SystemRoot', 'Temp', 'UserProfile']);
  assert.equal(marker('/x'), '/x/node_modules/.bowerloom-install-ok');
});

test('the launcher refuses an unknown flag with a plain message, and both modes at once, without installing or building anything', () => {
  for (const [args, re] of [[['--sample'], /do not know "--sample"/], [['--sample-data', '--real-data'], /not both/], [['--build-only', '--nope', '-x'], /"--nope", "-x"/]] as const) {
    const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), ...args], { cwd: tmpdir(), encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2, args.join(' ')); assert.match(r.stderr, re); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
});

test('the launcher source: a failed or signalled step exits non-zero, spawn errors are printed, no shell is used, and a marker proves an install finished', () => {
  const src = readFileSync(join(DESKTOP, 'tools', 'run.mjs'), 'utf8');
  for (const needle of ['r.error', 'r.signal', 'npm_execpath', 'npm-cli.js', 'path.txt', 'bowerloom-install-ok', "child.on('error'", "child.on('exit', (code, signal)"]) assert.ok(src.includes(needle), needle);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /shell\s*:\s*true|\.cmd\b|\.bin/, 'no shell, no .cmd shim');
  assert.match(src, /step\('Installing the viewer[^\n]*clean\)/); assert.match(src, /step\('Downloading the app window[^\n]*clean\)/); assert.match(src, /step\('Installing Bowerloom[^\n]*clean\)/);
});

test('the launcher finds npm and the app binary without a shell', async () => {
  const { npmCommand, electronBinary } = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as { npmCommand(env: Record<string, string | undefined>, node: string): { command: string; prefix: string[] }; electronBinary(desktop: string, platform: string): string | null };
  const viaNpm = npmCommand({ npm_execpath: '/usr/lib/npm/bin/npm-cli.js' }, '/usr/bin/node'); assert.deepEqual(viaNpm, { command: '/usr/bin/node', prefix: ['/usr/lib/npm/bin/npm-cli.js'] });
  const beside = npmCommand({}, '/opt/node/bin/node'); assert.equal(beside.command, '/opt/node/bin/node'); assert.match(beside.prefix[0]!, /node_modules\/npm\/bin\/npm-cli\.js$/);
  const bin = electronBinary(DESKTOP, process.platform); assert.ok(bin === null || bin.includes(`${join('node_modules', 'electron', 'dist')}`), String(bin));
  assert.equal(electronBinary('/nowhere', 'darwin'), null);
});

