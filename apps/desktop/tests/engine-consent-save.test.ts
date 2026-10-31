// The words of main's own dialog for a save and a go-back (main/engine-consent.ts). The dialog says what the plan does in plain words, and says so when it
// deletes files: a save that removes a skill deletes its files, and a yes must not hide that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK } from '../main/engine-consent.js';

const REV = 'abcdef0123456789';

test('a save that only creates or updates files says how many it changes', () => {
  assert.equal(ASK.save('~/Projects/team', 1, REV).message, 'Change 1 file in ~/Projects/team/.bowerloom?');
  assert.equal(ASK.save('~/Projects/team', 3, REV, { deletes: 0 }).message, 'Change 3 files in ~/Projects/team/.bowerloom?');
});

test('a save that deletes files says so, with the files it changes and the files it deletes', () => {
  assert.equal(ASK.save('~/Projects/team', 3, REV, { deletes: 1 }).message, 'Change 2 files and delete 1 file in ~/Projects/team/.bowerloom?');
  assert.equal(ASK.save('~/Projects/team', 5, REV, { deletes: 3 }).message, 'Change 2 files and delete 3 files in ~/Projects/team/.bowerloom?');
  assert.equal(ASK.save('~/Projects/team', 1, REV, { deletes: 1 }).message, 'Delete 1 file in ~/Projects/team/.bowerloom?');
  assert.equal(ASK.save('~/Projects/team', 2, REV, { deletes: 2 }).message, 'Delete 2 files in ~/Projects/team/.bowerloom?');
});

test('a go-back says the same, and names the save point', () => {
  assert.equal(ASK.restore('~/Projects/team', 2, 'v2', REV).message, 'Go back to v2 and change 2 files in ~/Projects/team/.bowerloom?');
  assert.equal(ASK.restore('~/Projects/team', 3, 'v2', REV, { deletes: 1 }).message, 'Go back to v2, change 2 files and delete 1 file in ~/Projects/team/.bowerloom?');
  assert.equal(ASK.restore('~/Projects/team', 1, 'v2', REV, { deletes: 1 }).message, 'Go back to v2 and delete 1 file in ~/Projects/team/.bowerloom?');
});

test('the detail line keeps the plan, the marks and the way back', () => {
  const d = ASK.save('~/Projects/team', 2, REV, { deletes: 1, executables: ['.bowerloom/skills/x/run.sh'] }).detail;
  assert.match(d, /^From plan abcdef01\. /);
  assert.match(d, /This file can run as a program: \.bowerloom\/skills\/x\/run\.sh\./);
  assert.match(d, /Bowerloom keeps a save point, so you can go back\./);
});
