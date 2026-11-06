import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const social = JSON.parse(await readFile(resolve(root, 'release/social-preview.json'), 'utf8'));
assert.ok(social.docs?.image, 'release/social-preview.json needs a docs card');
assert.notEqual(social.docs.image.url, social.image.url, 'The docs card needs its own image');
// The landing page carries the home card. Every docs page carries the docs card.
const expectedFor = card => ({
  'og:title': card.title, 'og:description': card.description,
  'og:site_name': social.siteName, 'og:type': social.type,
  'og:image': card.image.url, 'og:image:secure_url': card.image.url,
  'og:image:width': String(card.image.width), 'og:image:height': String(card.image.height),
  'og:image:type': card.image.type, 'og:image:alt': card.image.alt,
  'twitter:card': 'summary_large_image', 'twitter:title': card.title,
  'twitter:description': card.description, 'twitter:image': card.image.url, 'twitter:image:alt': card.image.alt,
});
const decode = value => value.replace(/&(?:amp|quot|lt|gt|#39);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'" })[entity]);
async function inspect(file, expected) {
  const html = await readFile(file, 'utf8');
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert.ok(head, `Built HTML has a head: ${file}`);
  const tags = [...head.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => ({
    key: tag.match(/\b(?:property|name)="([^"]+)"/)?.[1],
    value: decode(tag.match(/\bcontent="([^"]*)"/)?.[1] ?? ''),
  }));
  for (const [key, value] of Object.entries(expected)) {
    const matches = tags.filter(tag => tag.key === key);
    assert.equal(matches.length, 1, `Built HTML has one ${key}: ${file}`);
    assert.equal(matches[0].value, value, `Built HTML uses its card's ${key}: ${file}`);
  }
  assert.doesNotMatch(head, /%SOCIAL_[A-Z_]+%/, `Built HTML resolves social placeholders: ${file}`);
}
async function pages(directory) {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) found.push(...await pages(path));
    else if (item.isFile() && item.name.endsWith('.html')) found.push(path);
  }
  return found;
}
await inspect(resolve(root, 'apps/landing/dist/index.html'), expectedFor(social));
const docs = await pages(resolve(root, 'apps/docs/dist'));
assert.ok(docs.length > 0, 'The built documentation must contain pages');
for (const page of docs) await inspect(page, expectedFor(social.docs));
for (const [card, path] of [[social, '/social/bowerloom-home.png'], [social.docs, '/social/bowerloom-docs.png']]) {
  const imagePath = new URL(card.image.url).pathname;
  assert.equal(imagePath, path);
  const source = await readFile(resolve(root, 'apps/landing/public' + imagePath));
  const built = await readFile(resolve(root, 'apps/landing/dist' + imagePath));
  assert.deepEqual(built, source, `The landing build serves the committed card: ${path}`);
  assert.deepEqual(built.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(built.readUInt32BE(16), card.image.width);
  assert.equal(built.readUInt32BE(20), card.image.height);
}
console.log(`Card tags pass on the landing page and ${docs.length} built documentation pages; both PNGs match at 1200 by 630.`);
