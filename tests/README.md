# Tests

`npm test` builds the project, checks that every test pattern matches a file, and runs every test file with `node --test`.

## Test homes: `~/.bowerloom-test-homes`

Some test files make folders in HOME. Each of them first imports `tests/support/isolate-home.ts`, which points HOME at a private folder of its own process:

```
~/.bowerloom-test-homes/<file key>-<process ID>/home-XXXXXX
```

- The file key is the first 16 hex characters of the SHA-256 of the test file path. The process ID keeps two runs of one checkout apart.
- Every folder is mode 0700 and owned by you. If the root or its own folder is a link, is owned by someone else, or is open to others, the helper refuses to run.
- When the test process exits, it removes its `home-XXXXXX` folder. Then, if they are empty, it removes its `<file key>-<process ID>` folder and the older `<file key>` folder from before the process ID was in the key.
- The root, `~/.bowerloom-test-homes`, stays.
- A run that is killed leaves its `home-XXXXXX` folder and the files in it. Nothing else writes there. When no test is running, you can remove `~/.bowerloom-test-homes`.

## Lock slot collisions

Test files that take a project lock use the `test` from `tests/support/lock-slot-retry.ts`. A project lock is a local port picked from the project folder's device and inode. Now and then a fresh folder's port is held by another program. Then the test runs again from the start, with fresh folders, up to 5 times. Only an error that names a `*_LOCK_SLOT_COLLISION` code is retried. Any other failure is reported at once.
