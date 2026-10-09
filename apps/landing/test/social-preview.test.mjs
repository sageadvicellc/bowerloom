import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import config, * as metadataModule from '../vite.config.ts';
import {hero} from '../src/content.ts';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const preview = async () => JSON.parse(await read('../../../release/social-preview.json'));
const meta = html => new Map([...html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)].map(match => [match[1], match[2]]));

test('one preview record uses the approved landing message and public image', async () => {
  const social = await preview();
  assert.equal(social.title, `Bowerloom · ${hero.H1}`);
  assert.equal(social.description, hero.Body.split('. ')[0] + '.');
  assert.equal(social.siteName, 'Bowerloom');
  assert.equal(social.type, 'website');
  assert.equal(social.image.url, 'https://bowerloom.ai/social/bowerloom.png');
  assert.equal(social.image.width, 1200);
  assert.equal(social.image.height, 630);
  assert.equal(social.image.type, 'image/png');
  assert.match(social.image.alt, /Bowerloom.*S4-G3.*plant chamber/i);
});

test('landing HTML contains complete social metadata before JavaScript runs', async () => {
  const social = await preview();
  const plugin = config.plugins.flat().find(plugin => plugin.name === 'shared-release-metadata');
  const html = await plugin.transformIndexHtml(await read('../index.html'));
  const tags = meta(html);
  for (const [name, value] of Object.entries({
    'og:title': social.title, 'og:description': social.description,
    'og:site_name': social.siteName, 'og:type': social.type,
    'og:image': social.image.url, 'og:image:secure_url': social.image.url,
    'og:image:width': String(social.image.width), 'og:image:height': String(social.image.height),
    'og:image:type': social.image.type, 'og:image:alt': social.image.alt,
    'twitter:card': 'summary_large_image', 'twitter:title': social.title,
    'twitter:description': social.description, 'twitter:image': social.image.url,
    'twitter:image:alt': social.image.alt,
  })) assert.equal(tags.get(name), value, name);
  assert.equal(tags.get('og:url'), 'https://bowerloom.ai');
  assert.doesNotMatch(html, /%(?:RELEASE_|SOCIAL_)[A-Z_]+%/);
});

test('metadata substitution escapes attribute content and leaves unknown tokens intact', () => {
  assert.equal(typeof metadataModule.renderMetadata, 'function');
  assert.equal(metadataModule.renderMetadata('<meta content="%SOCIAL_TITLE%">%SOCIAL_UNKNOWN% %OTHER_TITLE%', {
    SOCIAL_TITLE: 'A "quote" & <tag> \'single\'',
  }), '<meta content="A &quot;quote&quot; &amp; &lt;tag&gt; \'single\'">%SOCIAL_UNKNOWN% %OTHER_TITLE%');
});

test('docs uses the shared preview without changing its page identity or index policy', async () => {
  const layout = await read('../../docs/src/components/Layout.astro');
  assert.match(layout, /import social from ['"]\.\.\/\.\.\/\.\.\/\.\.\/release\/social-preview\.json['"]/);
  for (const [name, field] of Object.entries({
    'og:title': 'title', 'og:description': 'description', 'og:site_name': 'siteName', 'og:type': 'type',
    'og:image': 'image.url', 'og:image:secure_url': 'image.url',
    'og:image:width': 'image.width', 'og:image:height': 'image.height',
    'og:image:type': 'image.type', 'og:image:alt': 'image.alt',
    'twitter:title': 'title', 'twitter:description': 'description',
    'twitter:image': 'image.url', 'twitter:image:alt': 'image.alt',
  })) assert.ok(layout.includes(`="${name}" content={social.${field}}`), name);
  assert.match(layout, /name="twitter:card" content="summary_large_image"/);
  assert.match(layout, /<title>\{title\} · Bowerloom docs<\/title>/);
  assert.match(layout, /name="description" content=\{description\}/);
  assert.match(layout, /name="robots" content="noindex, nofollow"/);
  assert.match(layout, /rel="canonical" href=\{'https:\/\/bowerloom.ai'\+url\}/);
  assert.doesNotMatch(layout, /property="og:url"/);
});
