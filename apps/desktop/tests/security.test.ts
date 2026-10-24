// Security rules, each with a test: window settings, policy, links, navigation, the bridge, and what the main process may do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_INDEX, CSP, EXTERNAL_HOSTS, allowRequest, decideNavigation, isAllowedExternal, resolveAppFile, webPreferences } from '../main/security.js';
import { join as joinPath } from 'node:path';
import { CHANNELS } from '../shared/channels.js';
import { DESKTOP } from './support.js';

const read = (path: string): string => readFileSync(join(DESKTOP, path), 'utf8');
const sources = (dir: string): { file: string; text: string }[] => readdirSync(join(DESKTOP, dir)).filter(f => f.endsWith('.ts')).map(f => ({ file: `${dir}/${f}`, text: read(`${dir}/${f}`) }));
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the window has context isolation, no Node, a sandbox, and no webview', () => {
  const p = webPreferences('/x/preload.cjs');
  assert.equal(p.contextIsolation, true); assert.equal(p.nodeIntegration, false); assert.equal(p.sandbox, true);
  assert.equal(p.webSecurity, true); assert.equal(p.allowRunningInsecureContent, false); assert.equal(p.webviewTag, false);
  assert.equal(p.nodeIntegrationInWorker, false); assert.equal(p.nodeIntegrationInSubFrames, false); assert.equal(p.experimentalFeatures, false);
  assert.equal(p.preload, '/x/preload.cjs');
  // The real window is made from those settings and no other.
  const main = read('main/main.ts');
  assert.match(main, /webPreferences: webPreferences\(/);
  assert.doesNotMatch(main, /nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|webSecurity\s*:\s*false/);
});

test('the content security policy is strict and the page carries exactly that policy', () => {
  assert.doesNotMatch(CSP, /unsafe-inline|unsafe-eval|https?:|\*/);
  assert.match(CSP, /default-src 'none'/); assert.match(CSP, /script-src 'self'(;|$)/); assert.match(CSP, /connect-src 'none'/); assert.match(CSP, /frame-src 'none'/); assert.match(CSP, /base-uri 'none'/);
  const html = read('renderer/index.html'), meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  assert.ok(meta, 'the page has a policy'); assert.equal(meta![1], CSP);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/, 'no inline handler');
  assert.doesNotMatch(html, /(src|href)="https?:/, 'no remote content');
});

test('only an allowlisted https link opens outside the app', () => {
  for (const ok of ['https://github.com/sageadvicellc/bowerloom', 'https://www.npmjs.com/package/x', 'https://npmjs.com/']) assert.equal(isAllowedExternal(ok), true, ok);
  for (const bad of ['http://github.com/x', 'https://example.com/', 'https://github.com.evil.example/', 'https://user:pw@github.com/x', 'https://github.com:8443/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'https://github.com/a b', 'https://github.com/\n', '', 'github.com', 42, null, undefined, { href: 'https://github.com' }, `https://github.com/${'a'.repeat(3000)}`]) assert.equal(isAllowedExternal(bad), false, String(bad));
  assert.deepEqual([...EXTERNAL_HOSTS].sort(), ['github.com', 'npmjs.com', 'www.npmjs.com']);
});

test('navigation: only the app page stays; links go outside only when allowlisted; everything else is blocked', () => {
  const index = 'file:///app/dist/renderer/index.html';
  assert.equal(decideNavigation(index, index), 'allow-app'); assert.equal(decideNavigation(`${index}#x`, index), 'allow-app');
  assert.equal(decideNavigation('file:///etc/passwd', index), 'block'); assert.equal(decideNavigation('file:///app/dist/renderer/other.html', index), 'block');
  assert.equal(decideNavigation(`${index}?next=1`, index), 'block');
  assert.equal(decideNavigation('https://example.com', index), 'block'); assert.equal(decideNavigation('https://github.com/x', index), 'open-external');
  assert.equal(decideNavigation('not a url', index), 'block');
  const main = read('main/main.ts');
  for (const hook of ["'will-navigate'", "'will-redirect'", 'setWindowOpenHandler', "'will-attach-webview'", 'setPermissionRequestHandler', 'onBeforeRequest']) assert.ok(main.includes(hook), hook);
  assert.match(main, /action: 'deny'/);
});

test('no request leaves the machine: the session lets through only files under the app\'s own dist folder', () => {
  const dist = '/app/dist';
  for (const url of ['file:///app/dist/renderer/app.js', 'file:///app/dist/renderer/index.html#x', 'file:///app/dist']) assert.equal(allowRequest(url, dist), true, url);
  for (const url of ['file:///app/dist-evil/app.js', 'file:///app/distant/x', 'file:///etc/passwd', 'file:///app/dist/../secret', 'file:///app/dist/%2e%2e/secret', 'file://server/app/dist/x', 'https://example.com/a.js', 'http://localhost:3000/', 'ws://localhost/', 'ftp://x/', 'data:text/html,x', 'not a url']) assert.equal(allowRequest(url, dist), false, url);
  assert.match(read('main/main.ts'), /allowRequest\(details\.url, root\)/);
  void joinPath;
});

test('the packaged window turns the developer tools off, and every frame navigation and device permission is refused', () => {
  assert.equal(webPreferences('/p', true).devTools, false); assert.equal(webPreferences('/p', false).devTools, true); assert.equal(webPreferences('/p').devTools, true);
  const main = read('main/main.ts');
  assert.match(main, /webPreferences\(join\(root, 'preload\.cjs'\), app\.isPackaged\)/); assert.match(main, /'will-frame-navigate'/); assert.match(main, /setDevicePermissionHandler\(\(\) => false\)/);
  assert.match(main, /setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/); assert.match(main, /setPermissionCheckHandler\(\(\) => false\)/);
});

test('the bridge: one named call per channel, nothing generic, and main answers each channel and no other', () => {
  const preload = strip(read('preload/preload.ts')).replace(/^import .*$/gm, '');
  const names = Object.keys(CHANNELS);
  for (const n of names) assert.match(preload, new RegExp(`${n}: .*ipcRenderer\\.invoke\\(CHANNELS\\.${n}`), `preload exposes ${n}`);
  assert.equal([...preload.matchAll(/ipcRenderer\.(\w+)/g)].every(m => m[1] === 'invoke'), true, 'only invoke');
  assert.doesNotMatch(preload, /ipcRenderer\s*[,}]|exposeInMainWorld\('[^']+',\s*ipcRenderer|require\(|process\./);
  assert.equal([...preload.matchAll(/exposeInMainWorld/g)].length, 1, 'a single bridge');
  const main = strip(read('main/main.ts'));
  for (const n of names) assert.match(main, new RegExp(`guarded\\('${n}'`), `main answers ${n}`);
  assert.equal([...main.matchAll(/ipcMain\.(\w+)/g)].every(m => m[1] === 'handle'), true);
  assert.equal([...main.matchAll(/ipcMain\.handle/g)].length, 1, 'every handler goes through one guard that checks the sender');
  assert.match(main, /senderFrame/);
  // Every call the page can make is a read, or changes the app's own settings.
  assert.deepEqual(names.sort(), ['addRoot', 'checkForUpdates', 'chooseMode', 'copyText', 'getFileText', 'getInfo', 'getItemContent', 'getSettings', 'getSnapshot', 'openLink', 'removeRoot', 'setIncludeExamples', 'setRole', 'setTheme']);
});

test('the main process calls no command that writes Bowerloom data and starts no process or server', () => {
  const forbidden = /\b(applyFolder\w+|applyConfigChange|applyLockUpdate|applySync|applyProjectApply|applyCachePrune|applyStoreMigrate|applyAdopt|applyMigrate|applyItemRecovery|applyReceiptClean|runApplyCommand|runUseCommand|runLockCommand|runCacheCommand|runStoreCommand|runFolderCommand|runUpCommand|runSyncCommand|runCreateCommand|runAdoptCommand|withStoreForWrite|withProjectLock|withCacheLock)\b/;
  for (const { file, text } of [...sources('main'), ...sources('shared'), ...sources('preload')]) {
    const code = strip(text);
    assert.doesNotMatch(code, forbidden, `${file} calls a write command`);
    assert.doesNotMatch(code, /child_process|worker_threads|node:net|node:http|node:https|(?<![.\w])(spawn|exec|fork)\(|createServer|\.listen\(/, `${file} starts a process or a server`);
  }
  // The one command that reads: status is run in process, never as a command line.
  assert.match(read('main/reader.ts'), /runProjectStatus\(\['status', '--json'\]/);
});

test('only three main files write a file: the settings, the sample copy, and the sandbox, each behind the write boundary', () => {
  const writers = sources('main').filter(({ text }) => /\b(writeFileSync|writeFile|mkdirSync|rmSync|cpSync|chmodSync|renameSync|unlinkSync|appendFileSync|copyFileSync|symlinkSync)\b/.test(strip(text))).map(f => f.file).sort();
  assert.deepEqual(writers, ['main/config.ts', 'main/sample.ts', 'main/sandbox.ts']);
  assert.match(read('main/sample.ts'), /isInside\(realpathSync\(appDir\), target\)/);
});

test('the page never builds markup from text: no innerHTML, no eval, no document.write', () => {
  for (const { file, text } of [...sources('renderer'), ...sources('shared')]) assert.doesNotMatch(strip(text), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setAttribute\(\s*['"]on|srcdoc|dangerouslySetInnerHTML/, file);
});

test('process.env is read in exactly three places (the token state, the settings of the run, and the sandbox folder constant), and the token value never leaves its module', () => {
  const users = sources('main').filter(({ text }) => /process\.env/.test(strip(text))).map(f => f.file).sort();
  assert.deepEqual(users, ['main/boundary.ts', 'main/controller.ts', 'main/token.ts']);
  const token = read('main/token.ts');
  assert.match(token, /return GithubToken\.status\(only\)/);
  assert.doesNotMatch(token, /fromEnv|reveal|\.value|console\./);
});

test('the page is served by the app itself, and only files below its renderer folder can be asked for', () => {
  assert.equal(APP_INDEX, 'app://viewer/index.html'); assert.equal(decideNavigation(APP_INDEX, APP_INDEX), 'allow-app'); assert.equal(decideNavigation('app://viewer/other.html', APP_INDEX), 'block'); assert.equal(decideNavigation('app://evil/index.html', APP_INDEX), 'block');
  assert.equal(allowRequest('app://viewer/app.js', '/x'), true); assert.equal(allowRequest('app://evil/app.js', '/x'), false);
  const dir = '/app/dist/renderer';
  assert.equal(resolveAppFile(dir, '/index.html'), '/app/dist/renderer/index.html'); assert.equal(resolveAppFile(dir, '/a%20b.css'), '/app/dist/renderer/a b.css'); assert.equal(resolveAppFile(dir, '/'), dir);
  for (const bad of ['/../main.mjs', '/%2e%2e/main.mjs', '/..%2fmain.mjs', '/a/../../main.mjs', '/%00', '/..\\main.mjs', '/%E0%A4%A']) assert.equal(resolveAppFile(dir, bad), null, bad);
  assert.equal(resolveAppFile('/app/dist/renderer', '/../renderer-evil/x'), null);
  const main = read('main/main.ts'); assert.match(main, /protocol\.handle\(APP_SCHEME/); assert.match(main, /registerSchemesAsPrivileged/); assert.match(main, /loadURL\(indexUrl\)/);
});
