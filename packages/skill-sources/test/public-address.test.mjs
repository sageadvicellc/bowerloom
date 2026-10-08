import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publicIPv4 } from '../../../dist/packages/skill-sources/src/public-address.js';

// Review M3 finding 4: one public IPv4 test, shared by npm.ts, git.ts and skill-manifest public-get.ts.
const source = relative => fs.readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), 'utf8');

test('the three network reads import the one shared public IPv4 test and keep no copy of their own', () => {
  for (const file of ['packages/skill-sources/src/npm.ts', 'packages/skill-sources/src/git.ts', 'packages/skill-manifest/src/public-get.ts']) {
    const text = source(file);
    assert.doesNotMatch(text, /function publicIPv4/, file);
    assert.match(text, /import \{ publicIPv4 \} from '[./]+(?:skill-sources\/src\/)?public-address\.js';/, file);
  }
  assert.equal((source('packages/skill-sources/src/public-address.ts').match(/function publicIPv4/g) ?? []).length, 1);
});

test('the shared table: public addresses pass, every special-use range refuses, and anything but IPv4 refuses', () => {
  for (const address of ['104.16.25.34', '140.82.112.6', '1.1.1.1', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '192.88.98.1', '198.17.255.255', '198.20.0.0', '223.255.255.255']) assert.equal(publicIPv4(address), true, address);
  for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '100.127.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.8', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255']) assert.equal(publicIPv4(address), false, address);
  for (const address of ['::1', '2606:4700::1', '::ffff:104.16.25.34', 'localhost', '', '104.16.25', '104.16.25.34.1']) assert.equal(publicIPv4(address), false, address);
});
