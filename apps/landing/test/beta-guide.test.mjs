import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { betaGuidePath, docsPath, setupCommands, readerRelease, release } from '../src/release.ts';
import { expandRelease } from '../../docs/src/lib/release.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const exists = path => access(new URL('../' + path, import.meta.url)).then(() => true, () => false);

test('the beta guide is a docs page with a plain link in its old landing spot', async () => {
  assert.equal(betaGuidePath, `${docsPath}beta-guide/`);
  assert.equal(await exists('src/BetaGuide.tsx'), false);
  const builder = await read('src/TutorialBuilder.tsx'), nav = await read('src/SiteNavigation.tsx'), app = await read('src/App.tsx');
  assert.doesNotMatch(builder, /BetaGuide|<details className="beta-guide"/);
  const intro = builder.indexOf('</div>', builder.indexOf('className="tutorial-intro"'));
  const link = builder.indexOf('<p className="tutorial-guide-link" id="beta-guide"><a href={betaGuidePath}>Beta guide: integrate a workflow with your project</a></p>');
  assert.ok(link > intro && link < builder.indexOf('<form'), 'The link sits between the intro and the setup form.');
  assert.doesNotMatch(builder, /Beta Guide above/);
  assert.match(nav, /<a href=\{betaGuidePath\} onClick=\{onNavigate\}>Beta guide<\/a>/);
  assert.doesNotMatch(app + nav, /href="#beta-(guide|evidence)"|href="#release-plan"/);
  assert.match(app, /href=\{`\$\{betaGuidePath\}#release-plan`\}/);
});

test('the docs page keeps the install block, up startup path and iCloud sentence', async () => {
  const page = await readFile(new URL('../../docs/src/content/docs/beta-guide.md', import.meta.url), 'utf8');
  const contributors = await readFile(new URL('../../docs/src/content/docs/contributors.md', import.meta.url), 'utf8');
  const field = (text, name) => text.match(new RegExp(`^${name}: (.+)$`, 'm'))[1];
  // The 0.7 team setup pages sit in their own legacy section since 0.8.0-beta.1.
  assert.equal(field(page, 'section'), '"Legacy 0.7 team setup"');
  assert.notEqual(field(page, 'section'), field(contributors, 'section'));
  // The generator decides the install block: the command shows only after npm publishes.
  const unpublished = { ...release, state: 'unreleased', npm: { ...release.npm, published: false } };
  const published = { ...release, state: 'published', npm: { ...release.npm, published: true } };
  const before = expandRelease(page, unpublished), after = expandRelease(page, published);
  assert.ok(!before.includes(setupCommands.split('\n')[0]));
  assert.match(before, /The install command arrives when the beta publishes/);
  assert.ok(after.includes(setupCommands.split('\n')[0]));
  assert.ok(after.includes(readerRelease.installNote));
  assert.doesNotMatch(after, /arrives when the beta publishes/);
  assert.ok(page.includes('`bowerloom up --team <name> --goal <goal>`'));
  assert.ok(page.includes('Keep the project out of iCloud Drive, because `init` does not check.'));
  for (const id of ['local-backend', 'beta-evidence', 'release-plan']) assert.ok(page.includes(`<a id="${id}"></a>`), id);
  assert.match(page, /<!-- release:install:start -->[\s\S]*<!-- release:install:end -->/);
  assert.doesNotMatch(page.split('---').slice(2).join('---'), /;|—|n't\b/);
});

test('the Labs section no longer carries the workbench version paragraph', async () => {
  const labs = await read('src/LabsWorkflow.tsx'), css = await read('src/labs.css');
  assert.doesNotMatch(labs, /labs-boundary|versions belong to Labs|independently executed this Sagespec team/);
  // Workbench version labels stay in the docs and README. The landing page does not name them.
  assert.doesNotMatch(labs, /workbench|finder-path/i);
  assert.doesNotMatch(css, /labs-boundary|\.beta-guide/);
});
