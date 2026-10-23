// Spec 07, section 10: the GithubToken holder. The value is read from an env object the caller passes, never from
// process.env, and it is reachable only through authorization().
import test from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import { GithubToken, GITHUB_TOKEN_VARIABLE } from '../../../dist/packages/skill-manifest/src/github-token.js';
import { GithubToken as Exported, GITHUB_TOKEN_VARIABLE as ExportedName } from '../../../dist/packages/skill-manifest/src/index.js';

// A canary: ghp_ and 36 letters from g to z, so no hex digit, and a unique prefix to search for.
const CANARY = 'ghp_' + ('ghijklmnopqrstuvwxyz' + 'zyxwvutsrqponmlkjh').slice(0, 36);
const env = value => (value === undefined ? {} : { [GITHUB_TOKEN_VARIABLE]: value });
const parts = (value, n = 8) => Array.from({ length: value.length - n + 1 }, (_, i) => value.slice(i, i + n));

test('the variable name is fixed, and the package index exports the class and the name', () => {
  assert.equal(GITHUB_TOKEN_VARIABLE, 'BOWERLOOM_GITHUB_TOKEN');
  assert.equal(Exported, GithubToken); assert.equal(ExportedName, GITHUB_TOKEN_VARIABLE);
  assert.equal(CANARY.length, 40); assert.match(CANARY, /^ghp_[g-z]{36}$/);
});

test('1. fromEnv returns null for an unset variable and for an empty string', () => {
  assert.equal(GithubToken.fromEnv(env(undefined)), null);
  assert.equal(GithubToken.fromEnv(env('')), null);
  assert.equal(GithubToken.fromEnv({ OTHER: CANARY, GITHUB_TOKEN: CANARY, GH_TOKEN: CANARY }), null);
});

test('2. fromEnv returns a token for 20 and 255 characters, a classic token, and a fine-grained token', () => {
  for (const value of ['a'.repeat(20), 'Z'.repeat(255), CANARY, 'github_pat_' + 'Abc_def_GHI_jkl_mno_pqr_stu_vwx']) {
    const token = GithubToken.fromEnv(env(value));
    assert.ok(token instanceof GithubToken, value.slice(0, 12));
    assert.equal(token.authorization(), `Bearer ${value}`);
  }
});

test('3 and 4. fromEnv refuses GITHUB_TOKEN_INVALID for a bad value, and the error carries no part of it', () => {
  const bad = ['a'.repeat(19), 'a'.repeat(256), `${CANARY} x`, `${CANARY}\n`, `${CANARY}"`, `${CANARY}/x`, `${CANARY}.x`, `${CANARY}é`, ` ${CANARY}`, `${CANARY}\t`];
  for (const value of bad) {
    let caught;
    try { GithubToken.fromEnv(env(value)); } catch (error) { caught = error; }
    assert.ok(caught, JSON.stringify(value.slice(0, 6)));
    assert.equal(caught.code, 'GITHUB_TOKEN_INVALID');
    assert.equal(caught.message, 'The BOWERLOOM_GITHUB_TOKEN variable does not hold a valid GitHub token.');
    const shown = `${caught.code} ${caught.message} ${caught.stack ?? ''} ${util.inspect(caught)} ${JSON.stringify(caught)}`;
    if (value.length >= 8) for (const part of parts(value)) assert.equal(shown.includes(part), false, 'part of the value is in the error');
    assert.equal(shown.includes('ghp_'), false);
  }
});

test('5. String, JSON, util.inspect, a template, and console.log all give [redacted]', t => {
  const token = GithubToken.fromEnv(env(CANARY));
  assert.equal(String(token), '[redacted]');
  assert.equal(`${token}`, '[redacted]');
  assert.equal(token.toString(), '[redacted]'); assert.equal(token.toJSON(), '[redacted]');
  assert.equal(JSON.stringify({ token }), '{"token":"[redacted]"}');
  assert.equal(util.inspect(token), '[redacted]');
  assert.equal(util.inspect({ token }, { showHidden: true, depth: 5 }).includes(CANARY), false);
  assert.equal(util.format('%s %o %O %j', token, token, token, token).includes(CANARY), false);
  const lines = [];
  t.mock.method(console, 'log', (...args) => { lines.push(util.format(...args)); });
  console.log(token); console.log({ token }); console.log('%o', token);
  t.mock.restoreAll();
  assert.deepEqual(lines, ['[redacted]', '{ token: [redacted] }', '[redacted]']);
});

test('6. no own key, property name, or prototype member shows the value; only authorization() reaches it', () => {
  const token = GithubToken.fromEnv(env(CANARY));
  assert.deepEqual(Object.keys(token), []);
  assert.equal(JSON.stringify(Object.getOwnPropertyNames(token)), '[]');
  assert.deepEqual(Object.getOwnPropertySymbols(token), []);
  assert.equal(JSON.stringify(Object.entries(token)), '[]');
  assert.equal(JSON.stringify(Object.getOwnPropertyDescriptors(token)), '{}');
  assert.equal(JSON.stringify({ ...token }), '{}');
  assert.equal(structuredClone({ a: 1 }).a, 1);
  assert.throws(() => structuredClone(token).authorization(), TypeError);
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(token))) {
    if (name === 'authorization' || name === 'constructor') continue;
    const value = token[name];
    const shown = typeof value === 'function' ? String(value.call(token)) : String(value);
    assert.equal(shown.includes(CANARY), false, name);
  }
  assert.equal(Object.isFrozen(token), true);
  assert.throws(() => { token.extra = 1; }, TypeError);
  // The constructor is not a way in from outside.
  assert.throws(() => new GithubToken(CANARY), TypeError);
});

test('7. status gives set, not-set, and invalid, and never throws', () => {
  assert.equal(GithubToken.status(env(undefined)), 'not-set');
  assert.equal(GithubToken.status(env('')), 'not-set');
  assert.equal(GithubToken.status(env(CANARY)), 'set');
  for (const value of ['abc', `${CANARY} `, 'a'.repeat(256), `${CANARY}\n`]) assert.equal(GithubToken.status(env(value)), 'invalid');
  assert.equal(GithubToken.status({}), 'not-set');
});

test('8. authorization() returns Bearer and the value', () => {
  assert.equal(GithubToken.fromEnv(env(CANARY)).authorization(), `Bearer ${CANARY}`);
});

test('fromEnv takes its env object only: process.env is never read', t => {
  const saved = process.env[GITHUB_TOKEN_VARIABLE];
  t.after(() => { if (saved === undefined) delete process.env[GITHUB_TOKEN_VARIABLE]; else process.env[GITHUB_TOKEN_VARIABLE] = saved; });
  process.env[GITHUB_TOKEN_VARIABLE] = CANARY;
  assert.equal(GithubToken.fromEnv({}), null);
  assert.equal(GithubToken.status({}), 'not-set');
  for (const bad of [null, undefined, 'x', 1]) assert.throws(() => GithubToken.fromEnv(bad), e => e.code === 'GITHUB_TOKEN_INVALID');
  for (const bad of [null, undefined, 'x', 1]) assert.equal(GithubToken.status(bad), 'invalid');
  // A non-string value in the env object is invalid, never coerced.
  assert.throws(() => GithubToken.fromEnv({ [GITHUB_TOKEN_VARIABLE]: { toString: () => CANARY } }), e => e.code === 'GITHUB_TOKEN_INVALID');
});
