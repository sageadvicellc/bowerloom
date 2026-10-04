import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { labsRoles, roleYaml } from '../src/labs-roles.ts';

test('Labs illustration contains precisely the first Sagespec team’s three roles', () => {
  assert.deepEqual(labsRoles.map(role => role.name), ['Knowledge officer', 'Brand review', 'Tech lead']);
  assert.match(labsRoles[0].job, /ingests raw material/);
  assert.match(labsRoles[0].job, /source documents into specifications/);
  assert.match(labsRoles[1].job, /products, presentation decks, and ads/);
  assert.match(labsRoles[1].job, /Delegates scoped design work/);
  assert.match(labsRoles[2].job, /Researches founder requests/);
  assert.match(labsRoles[2].job, /delegates bounded work to specialists/);
});
test('each illustrative YAML excerpt parses and agrees with the selected role and permissions', () => {
  for (const role of labsRoles) {
    const document = parse(roleYaml(role));
    assert.deepEqual(Object.keys(document), ['owners']);
    assert.equal(document.owners.length, 1);
    const owner = document.owners[0];
    assert.equal(owner.id, role.id);assert.equal(owner.role, role.name);
    assert.equal(owner.prompt, `${role.id}-prompt`);
    assert.deepEqual(owner.skills, [role.skill]);
    assert.equal(owner.modelClass, role.modelClass);
    assert.deepEqual(owner.permissions, [
      {operation:'workspace.read',path:role.reads},
      {operation:'workspace.write',path:role.writes},
    ]);
  }
});
