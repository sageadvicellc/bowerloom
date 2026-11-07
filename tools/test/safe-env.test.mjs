import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSecretName, scrubEnv, redact, emptyNpmConfigEnv, REDACTED, KEEPABLE_ENV } from '../lib/safe-env.mjs';

const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'safe-env-test-'))); made.push(dir); return dir; };
// Token-shaped strings are built from parts so this file holds no literal that looks like a secret.
const body = n => 'a1B2'.repeat(Math.ceil(n / 4)).slice(0, n);
const npmTok = ['npm', '_', body(36)].join('');
const ghTok = ['gh', 'p_', body(36)].join('');
const patTok = ['github', '_pat_', body(40)].join('');
const skTok = ['sk', '-', body(40)].join('');
const slackTok = ['xox', 'b-', '1234567890-abcdefghij'].join('');
const googleTok = ['AI', 'za', body(35)].join('');
const jwtTok = ['ey', 'J', 'hbGciOiJIUzI1', '.', 'ey', 'J', 'zdWIiOiIxMjM0', '.', 'c2lnbmF0dXJl'].join('');

test('isSecretName catches the secret endings, the named variables, and npm auth forms', () => {
  const secret = ['NPM_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'VERCEL_TOKEN', 'OPENAI_API_KEY', 'stripe_key', 'github_token', 'APP_SECRET', 'DB_PASSWORD', 'NPM_OTP',
    'npm_config__auth', 'npm_config_//registry.npmjs.org/:_authToken', 'NPM_CONFIG_//REGISTRY.NPMJS.ORG/:_AUTHTOKEN', 'npm_config_//registry.example.com/:_auth', 'npm_config_//r/:_password', 'NPM_CONFIG__AUTH', 'x_authtoken_y'];
  for (const name of secret) assert.equal(isSecretName(name), true, name);
  const plain = ['PATH', 'HOME', 'KEYBOARD', 'TOKENIZER', 'TOKEN_COUNT', 'MONKEY_PATCH', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'AUTHORITY', 'npm_config_userconfig', 'npm_config_cache'];
  for (const name of plain) assert.equal(isSecretName(name), false, name);
});

test('scrubEnv drops secret names and undefined values and keeps the rest', () => {
  const env = scrubEnv({ PATH: '/bin', A_TOKEN: 'x', B_KEY: 'y', GH_TOKEN: 'z', C_SECRET: 'q', D_PASSWORD: 'r', E_OTP: '1', 'npm_config__auth': 'a', 'npm_config_//registry.npmjs.org/:_authToken': 'b', GIT_AUTHOR_NAME: 'n', GONE: undefined, KEEP: '1' });
  assert.deepEqual(env, { PATH: '/bin', GIT_AUTHOR_NAME: 'n', KEEP: '1' });
});

test('redact blanks token-shaped text of every listed shape', () => {
  for (const [label, token] of [['npm', npmTok], ['github classic', ghTok], ['github fine-grained', patTok], ['sk key', skTok], ['slack', slackTok], ['google', googleTok], ['jwt', jwtTok]]) {
    const out = redact(`before ${token} after`, {});
    assert.equal(out, `before ${REDACTED} after`, label);
  }
});

test('redact blanks auth assignments, password assignments, and Authorization headers but keeps their names', () => {
  const AUTH = '_auth', PASS = 'pass' + 'word';
  assert.equal(redact(`//registry.npmjs.org/:${AUTH}Token=abcdef123456`, {}), `//registry.npmjs.org/:${AUTH}Token=${REDACTED}`);
  assert.equal(redact(`${AUTH}=dXNlcjpwYXNz`, {}), `${AUTH}=${REDACTED}`);
  assert.equal(redact(`${PASS}=hunter22 and more`, {}), `${PASS}=${REDACTED} and more`);
  assert.equal(redact(`db_${PASS} = "s3cret-value"`, {}), `db_${PASS} = "${REDACTED}"`);
  assert.equal(redact(`{"${PASS}": "s3cret-value"}`, {}), `{"${PASS}": "${REDACTED}"}`);
  assert.equal(redact('Authorization: Bearer abc.def-123_xyz==', {}), `Authorization: Bearer ${REDACTED}`);
  assert.equal(redact('authorization: basic dXNlcjpwYXNz', {}), `authorization: basic ${REDACTED}`);
  assert.equal(redact('curl -H "Authorization: Bearer abcdefgh12345678"', {}), `curl -H "Authorization: Bearer ${REDACTED}"`);
});

test('redact blanks the value of every secret-named variable in env, anywhere in the text', () => {
  const env = { MY_SERVICE_TOKEN: 'plain-value-1', OTHER_KEY: 'plain-value-2', PLAIN_NOTE: 'visible-value', SHORT_TOKEN: 'ab' };
  const out = redact('a plain-value-1 b plain-value-2 c visible-value d ab', env);
  assert.equal(out, `a ${REDACTED} b ${REDACTED} c visible-value d ab`);
});

test('redact leaves ordinary text and npm_config names alone and tolerates non-string input', () => {
  const text = 'npm_config_cache=/tmp/x npm_lifecycle_event=test ensures password policy; sk-short';
  assert.equal(redact(text, {}), text);
  assert.equal(redact(undefined, {}), '');
  assert.equal(redact(null, undefined), '');
});

test('emptyNpmConfigEnv writes two empty private files and returns the two npm variables', () => {
  const dir = path.join(tmp(), 'cfg');
  const env = emptyNpmConfigEnv(dir);
  assert.deepEqual(Object.keys(env).sort(), ['npm_config_globalconfig', 'npm_config_userconfig']);
  for (const file of Object.values(env)) {
    assert.equal(path.dirname(file), dir);
    assert.equal(fs.readFileSync(file, 'utf8'), '');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.notEqual(env.npm_config_userconfig, env.npm_config_globalconfig);
  // The variables are not themselves secret names, so scrubEnv keeps them.
  assert.deepEqual(scrubEnv(env), env);
});

test('scrubEnv drops the ssh agent variables by default, and the names that hold credentials', () => {
  const env = scrubEnv({ SSH_AUTH_SOCK: '/tmp/agent.sock', SSH_AGENT_PID: '123', DB_PASSWD: 'a', OPENAI_APIKEY: 'b', STRIPE_API_KEY: 'c', GOOGLE_APPLICATION_CREDENTIALS: 'd', AWS_CREDENTIALS: 'e', GH_PAT: 'f', DATABASE_URL: 'g', gh_pat: 'h', KEEP: '1' });
  assert.deepEqual(env, { KEEP: '1' });
  assert.equal(isSecretName('SSH_AUTH_SOCK'), true);
  assert.equal(isSecretName('SSH_AGENT_PID'), true);
  for (const name of ['X_PASSWD', 'X_APIKEY', 'X_API_KEY', 'X_CREDENTIALS', 'GH_PAT', 'DATABASE_URL', 'database_url']) assert.equal(isSecretName(name), true, name);
  for (const name of ['DATABASE_URL_NOTE', 'PATH', 'PASSWD_FILE_NOTE']) assert.equal(isSecretName(name), false, name);
});

test('scrubEnv with keep passes the two ssh agent variables and nothing else that is secret', () => {
  const source = { SSH_AUTH_SOCK: '/tmp/agent.sock', SSH_AGENT_PID: '123', GH_TOKEN: 'x', NPM_TOKEN: 'y', KEEP: '1' };
  assert.deepEqual(scrubEnv(source, { keep: ['SSH_AUTH_SOCK', 'SSH_AGENT_PID'] }), { SSH_AUTH_SOCK: '/tmp/agent.sock', SSH_AGENT_PID: '123', KEEP: '1' });
  assert.deepEqual(scrubEnv(source, { keep: ['SSH_AUTH_SOCK'] }), { SSH_AUTH_SOCK: '/tmp/agent.sock', KEEP: '1' });
  assert.deepEqual(scrubEnv(source, { keep: ['GH_TOKEN', 'NPM_TOKEN'] }), { KEEP: '1' }, 'only the ssh agent names can be kept');
  assert.deepEqual(scrubEnv(source, { keep: [] }), { KEEP: '1' });
  assert.deepEqual(KEEPABLE_ENV, ['SSH_AUTH_SOCK', 'SSH_AGENT_PID']);
});

test('redact blanks the JSON form of a password key, with any prefix, in either quote style and inside escaped JSON', () => {
  const PASS = 'pass' + 'word';
  assert.equal(redact(`{"_${PASS}": "s3cret-value"}`, {}), `{"_${PASS}": "${REDACTED}"}`);
  assert.equal(redact(`{"${PASS}": "s3cret-value", "user": "a"}`, {}), `{"${PASS}": "${REDACTED}", "user": "a"}`);
  assert.equal(redact(`{'db_${PASS}':'s3cret-value'}`, {}), `{'db_${PASS}':'${REDACTED}'}`);
  assert.equal(redact(`{"passwd": "s3cret-value"}`, {}), `{"passwd": "${REDACTED}"}`);
  assert.equal(redact(`"{\\"${PASS}\\":\\"s3cret-value\\"}"`, {}).includes('s3cret-value'), false);
  assert.equal(redact('{"username": "a"}', {}), '{"username": "a"}');
});

test('redact blanks the password in URL userinfo and keeps the user name and host', () => {
  assert.equal(redact('clone https://alice:hunter2pw@example.com/org/repo.git now', {}), `clone https://alice:${REDACTED}@example.com/org/repo.git now`);
  assert.equal(redact('postgres://svc:pw1234@example.com:5432/app', {}), `postgres://svc:${REDACTED}@example.com:5432/app`);
  assert.equal(redact('https://:onlypw@example.com/x', {}), `https://:${REDACTED}@example.com/x`);
  assert.equal(redact('https://example.com:8080/path and ssh://git@example.com/x', {}), 'https://example.com:8080/path and ssh://git@example.com/x');
});
