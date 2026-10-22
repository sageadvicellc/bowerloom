# 07. Private store token

## 1. Header

- Source: sageadvicellc/bowerloom#80, decision 21. Decision record: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163. It reverses the rule "no credentials from the environment" in `packages/skill-manifest/src/public-get.ts:15`. Decision 19 and the lock design: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333018480.
- Lane: 2.
- Branch: `beta3/07-private-store-token`.
- Depends on: spec 06 (the store git fetch, `proveAuthored`, `fetchStoreGit`, the lock, and the `githubAuth` hook).
- This spec is a security change. It needs a security review before it merges (see `docs/beta3/README.md`). The diff is kept small so the reviewer reads one thing. It touches no file that spec 06 does not already touch, apart from the listed ones.
- Line numbers below are from commit c9730d3. Find each place by its function name if it moved.

## 2. Problem

A store that lives in a private GitHub repository cannot be fetched. The public fetcher sends no credentials (`packages/skill-manifest/src/public-get.ts:15,94-98`). GitHub answers 404 for a private repository. Spec 06 reports that as `STORE_REMOTE_PRIVATE`. Most client work is private, so a team could not share a store.

This spec adds one opt-in way in: a GitHub token that the person puts in one environment variable, `BOWERLOOM_GITHUB_TOKEN`. Bowerloom sends it only to `api.github.com`, and only for the repository of the store remote. It never stores it, prints it, or logs it.

Without the variable, nothing changes.

## 3. Behavior

### 3.1 The variable

- Name: `BOWERLOOM_GITHUB_TOKEN`. It is the only setting. There is no file, no flag, and no stored value.
- If the variable is not set, or is set to an empty string, no token is used. The behavior is exactly the behavior of spec 06.
- If the variable is set to a non-empty value, the value must match `^[A-Za-z0-9_-]{20,255}$`. This holds a GitHub classic token (`ghp_...`), a fine-grained token (`github_pat_...`), and the other GitHub token forms. A value with a space, a newline, a quote, or any other character, or a length outside 20 to 255, refuses `GITHUB_TOKEN_INVALID`. The refusal happens before any network call. The message never shows the value or any part of it.
- Bowerloom does not trim the value.

### 3.2 Where the variable is read

Only these commands read it, and only when they must talk to a store remote:

1. `use`, `use team`, and `lock update`, when they prove an authored store item (spec 06, 3.10).
2. `apply --frozen`, `skills sync` (with or without `--frozen`), and the sync step of `up`, when an authored item from the lock is not in the store cache.
3. `team adopt`, when it fetches the team into the store cache.
4. `store migrate` in a shared project (spec 08), when it proves an authored item.
5. `store status`, to report whether the variable is set (3.6). It sends nothing.

No other command reads it. `skills add`, `skills check`, `ls`, `status`, plain `apply`, the npm fetch, and the fetch of pinned GitHub skills never read it and never send it. Pinned GitHub skills stay anonymous.

The CLI functions read `env.BOWERLOOM_GITHUB_TOKEN` from the `env` argument they already receive (`runSyncCommand`, `runApplyCommand`, `runUpCommand`, `runUseCommand`, `runLockCommand`, `runStoreCommand`). No library function reads `process.env` for the token.

### 3.3 Where the token is sent

The token goes in the header `Authorization: Bearer <token>`. Bowerloom sends it only when all of these are true:

1. The request is an HTTPS GET to the host `api.github.com`.
2. The request path starts with `/repos/<owner>/<repo>/`, and `<owner>/<repo>` equals (compared in lower case) one of the repositories named in the approved plan under `network.credentials.repositories`.
3. The transport was created with a token.

No other request carries the header. Not the npm registry. Not another GitHub repository. Not a request that the plan did not approve.

Redirects are still refused. The transport already refuses any response with a `Location` header and any status other than 200 (`public-get.ts:~134-137`). A redirect can therefore never carry the token to another host.

### 3.4 Which repositories the plan names

- For `use`, `use team`, `lock update`, and `store migrate`: the store remote from `readStoreRepo` (spec 06, 3.10).
- For `apply --frozen`, `skills sync`, `up`, and `team adopt`: the distinct `remote` values of the authored lock items that need fetching. There is usually one.

Each repository is shown in the plan. The list has at most 8 entries. A lock that names more than 8 distinct remotes for items that need fetching refuses `LOCK_INVALID` with the extra sentence `The lock names more than 8 remotes.`

### 3.5 What the plan shows and binds

When a token is set and at least one repository needs it, the plan carries the field `network.credentials`:

```json
{ "variable": "BOWERLOOM_GITHUB_TOKEN", "host": "api.github.com", "repositories": ["owner/repo"] }
```

It is `null` otherwise. The field is part of the plan revision. It never holds the token or any part of it. At apply time, the token must be set and valid if the plan has the field, and must not be set if the plan has `null` for it and the plan needed repositories. A mismatch refuses `STALE_APPROVAL`. (The run that did not need a repository never reads the variable, so it cannot mismatch.)

Review lines, verbatim:

```text
Credentials: BOWERLOOM_GITHUB_TOKEN is set. It is sent to api.github.com for github.com/<owner>/<repo> only.
```

One such line for the whole plan, with the repositories joined by `, ` and `and` before the last: `github.com/a/b and github.com/c/d`.

The `Network:` line of spec 06 changes only in its tail. Where it says `without credentials` it says `with your GitHub token for the repositories above` for the authored items, and still says `without credentials` for pinned items. When a plan fetches both kinds, the line reads:

```text
Network: reads api.github.com and registry.npmjs.org for <n> items. Pins are fetched without credentials. Store items use your GitHub token.
```

The plan JSON and the result JSON never contain the token. Neither do error messages, the lock, the config, the cache, the receipts, the catalogs, or `--json` output.

### 3.6 `store status`

Add one line to the `Git:` block and one JSON field.

Text, after the `Git:` line, only when the store has a git remote:

```text
  GitHub token: BOWERLOOM_GITHUB_TOKEN is set
```

or

```text
  GitHub token: BOWERLOOM_GITHUB_TOKEN is not set
```

or

```text
  GitHub token: BOWERLOOM_GITHUB_TOKEN is set but is not a valid token
```

JSON `git.token`: `"set"`, `"not-set"`, or `"invalid"`. The command never prints the value or its length, and sends nothing.

### 3.7 Errors from GitHub with a token

| What GitHub answers | Result |
|---|---|
| 200 | Normal. |
| 401 or 403, token sent | `STORE_REMOTE_AUTH_FAILED` |
| 404 on the commit request, token sent | `STORE_REMOTE_AUTH_FAILED` (the token may lack access, or the repository does not exist) |
| 404 on a later request after the commit worked | `LOCK_STORE_NOT_PUSHED` when proving, `LOCK_COMMIT_UNREACHABLE` when fetching |
| 404, no token | As spec 06: `STORE_REMOTE_PRIVATE`, or `LOCK_COMMIT_UNREACHABLE` for `--commit` |
| 401 or 403, no token | `SKILLS_ADD_NETWORK` mapped as in spec 06 (a network failure) |
| Any other status | `SKILLS_ADD_NETWORK` mapped as in spec 06 |

`STORE_REMOTE_PRIVATE` now has the next step `Set BOWERLOOM_GITHUB_TOKEN to a GitHub token that can read the repository, or make the repository public.` (Spec 06 gave it a shorter text. This spec replaces it.)

### 3.8 Security properties the reviewer checks

Each property has a test in section 10. The reviewer reads the code of section 6 against this list.

1. The token is read in the CLI layer only, from the `env` argument.
2. A value outside the pattern refuses `GITHUB_TOKEN_INVALID` and is never echoed.
3. The token lives in a `GithubToken` object. Its `toString`, `toJSON`, and `util.inspect.custom` all return `[redacted]`. The raw value is held in a private field (`#value`) and read by one method, `authorization()`, used by the transport only.
4. The header is added only for `api.github.com` and a path under an approved repository.
5. No request to `registry.npmjs.org` carries the header.
6. No redirect is followed.
7. The plan carries no token. The revision does not depend on the token value.
8. No file Bowerloom writes contains the token. A test scans every file under the project, the store, the state root, and the temporary folder after a full flow with a canary token.
9. Standard output and standard error contain no part of the token. The same test covers `--json`.
10. Error objects never carry the token. `STORE_REMOTE_AUTH_FAILED` has a fixed message.
11. The transport's existing guards stay: HTTPS only, certificate checks, TLS 1.2 or later, public IPv4 addresses only, no proxy, status 200 only (`public-get.ts:44-50,58-70,123-137`).
12. The token is never put in `process.env` of another process, because Bowerloom starts none (`tests/no-spawn.test.ts`).

## 4. Schemas

### 4.1 `GithubToken`

New file `packages/skill-manifest/src/github-token.ts`:

```ts
export const GITHUB_TOKEN_VARIABLE = 'BOWERLOOM_GITHUB_TOKEN' as const;
export class GithubToken {
  #value: string;
  private constructor(value: string) { this.#value = value; }
  static fromEnv(env: NodeJS.ProcessEnv): GithubToken | null   // null when unset or empty. Throws GITHUB_TOKEN_INVALID when set and wrong.
  static status(env: NodeJS.ProcessEnv): 'set' | 'not-set' | 'invalid'
  authorization(): string                                       // 'Bearer ' + value
  toString(): string                                            // '[redacted]'
  toJSON(): string                                              // '[redacted]'
  [Symbol.for('nodejs.util.inspect.custom')](): string          // '[redacted]'
}
```

### 4.2 Transport option

`PublicGetOptions` (`public-get.ts:38`) gains:

```ts
githubAuth?: { token: GithubToken; repositories: readonly string[] } | null
```

Each repository is `owner/repo` in lower case. `createPublicTransport` validates it: a `GithubToken` instance, and one to eight repositories that match `^[a-z0-9][a-z0-9-]{0,38}/[a-z0-9._-]{1,100}$`. Else `SKILLS_ADD_NETWORK`.

### 4.3 Plan field

`network.credentials` in `SyncPlan`, `ApplyPlan`, `ConfigChangePlan`, and the lock update plan:

| Field | Type | Meaning |
|---|---|---|
| `variable` | string | The exact text `BOWERLOOM_GITHUB_TOKEN` |
| `host` | string | The exact text `api.github.com` |
| `repositories` | array | 1 to 8 strings `owner/repo`, lower case, sorted, no repeats |

The whole field is `null` when no token is used.

### 4.4 `store status` JSON

`git.token`: `"set"`, `"not-set"`, or `"invalid"`. Spec 06 defines the rest of `git`.

## 5. Refusal codes

| Code | Cause | Next step |
|---|---|---|
| `GITHUB_TOKEN_INVALID` | `BOWERLOOM_GITHUB_TOKEN` is set to a value that is not a valid GitHub token. | Set it to a token with letters, digits, `_` or `-`, 20 to 255 characters. |
| `STORE_REMOTE_AUTH_FAILED` | GitHub refused the token for the store repository, or the repository does not exist. | Check that the token can read the repository, and that the repository name is right. |
| `STORE_REMOTE_PRIVATE` (text changed) | The repository answered 404 and no token was set. | Set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token that can read the repository, or make the repository public. |
| `STALE_APPROVAL` | The token was set or removed between plan and apply. | Run the command again without `--approve`. |

Add `GITHUB_TOKEN_INVALID` and `STORE_REMOTE_AUTH_FAILED` to the `MESSAGES` of `packages/skill-manifest/src/refusal.ts` (they are thrown by the transport and the token reader) and to `REFUSALS` in `apps/cli/src/human.ts`. Messages are fixed text:

- `GITHUB_TOKEN_INVALID`: `The BOWERLOOM_GITHUB_TOKEN variable does not hold a valid GitHub token.`
- `STORE_REMOTE_AUTH_FAILED`: `GitHub did not accept the token for the store repository, or the repository does not exist.`

## 6. Where to change

Create:

- `packages/skill-manifest/src/github-token.ts` (4.1).
- Test files in section 10.

Change:

- `packages/skill-manifest/src/public-get.ts`:
  - Header comment (lines 1-31): replace the sentence `no Authorization or cookie header, no credentials from the environment` with `no cookie header. The Authorization header is sent only for a GitHub repository that the caller names, with a token that the caller passes in (githubAuth). Nothing reads the environment here.`
  - `PublicGetOptions` (line 38): add `githubAuth`.
  - Line 56 (the closed key list in `createPublicTransport`): add `'githubAuth'` and validate it as in 4.2.
  - `headersFor(host, url)` (lines 94-98): when `host === 'api.github.com'` and `githubAuth` is set and the URL path starts with `/repos/<o>/<r>/` for an approved repository, add `Authorization: githubAuth.token.authorization()`. For every other case the header set is unchanged.
  - Status handling (line 134): before the 404 branch, add: if the request carried the header and the status is 401 or 403, `settle('STORE_REMOTE_AUTH_FAILED')`. The existing 404 branch is unchanged.
  - The token object must not appear in `settle` failures or in any thrown object. Do not log it.
- `packages/skill-manifest/src/refusal.ts:26`: add the two messages. Add the codes to `ManifestRefusalCode` and to the code list that `fixedRefusal`/`isManifestRefusal` use.
- `packages/skill-manifest/src/index.ts:2`: export `GithubToken`, `GITHUB_TOKEN_VARIABLE`.
- `packages/skill-manifest/src/resolve-store-git.ts` (spec 06): `fetchAuthored` and `proveAuthored` receive the transport. They need no change except for the error mapping of 3.7: with a token, a 404 on the commit request becomes `STORE_REMOTE_AUTH_FAILED`. Add a parameter `authed: boolean`.
- `packages/project-sync/src/store-git.ts` (spec 06): `fetchStoreGit` creates its transport with `githubAuth` from `deps.githubToken` and the repositories of the plan. It refuses `STALE_APPROVAL` when the plan has `network.credentials` and `deps.githubToken` is null, or the reverse. Map the 404 as `proveAuthored` does.
- `packages/project-sync/src/deps.ts` (`SyncDeps`, line ~28): add `githubToken?: GithubToken | null`.
- `packages/project-sync/src/plan.ts` (`SyncInput`, line 45): add `githubToken?: GithubToken | null`. In `observeSync`, compute `network.credentials` (4.3) from the token and the authored items that need fetching. Add it to the body at line 422. `syncBinding` (line 361) keeps it, because it is part of `network`: change the line that sets `network: { hosts: body.network.hosts }` to `network: { hosts: body.network.hosts, credentials: body.network.credentials }`.
- `packages/project-sync/src/apply-project.ts`: `ApplyInput` gets `githubToken`. Pass it to `observeSync` and `prepareSkillChildren`.
- `packages/project-sync/src/change.ts` (spec 06): the config-change and lock-update planners accept `githubToken` and set `network.credentials`.
- `apps/cli/src/sync.ts` (`runSyncCommand`, line 126), `apps/cli/src/apply.ts` (`runApplyCommand`, line 100), `apps/cli/src/up.ts` (`runUpCommand`, line 212), `apps/cli/src/use.ts`, `apps/cli/src/lock.ts`, `apps/cli/src/store.ts`: read the token with `GithubToken.fromEnv(env)` only in the code path that needs a store remote. Pass it in the inputs. A thrown `GITHUB_TOKEN_INVALID` surfaces as a refusal.
- `apps/cli/src/sync.ts:60-72` (`renderSyncReview`) and `apps/cli/src/apply.ts:65-76` (`renderApplyReview`): print the `Credentials:` line and the changed `Network:` line.
- `apps/cli/src/store.ts` and `packages/project-config/src/git.ts`: `store status` adds the token line from `GithubToken.status(env)`.
- `apps/cli/src/human.ts`: the refusal words (section 5) and the changed `STORE_REMOTE_PRIVATE` text. `TOPICS.lock` and `TOPICS.store` gain a short paragraph on the variable:

```text
A store in a private GitHub repository needs a token. Set BOWERLOOM_GITHUB_TOKEN to a GitHub token that can read
the repository. Bowerloom sends it only to api.github.com, only for that repository. It never stores or prints it.
```

- `tests/support/fake-network.ts:~30-40` (`serve`): record whether the request had an `Authorization` header, as a boolean field `authorization` in the logged line. Never log the value. The function receives the request options as its second argument (`_options`).

## 7. Edge cases

| Case | Expected result |
|---|---|
| Variable not set | Identical to spec 06. No `Credentials:` line. |
| Variable set to an empty string | Same as not set. |
| Variable set to `abc` | `GITHUB_TOKEN_INVALID` before any network call, in any command that reads it. |
| Variable set to a valid token and the command is `skills add github:...` | The token is not read. The request has no header. |
| Variable set and an npm pin is fetched in the same sync | The npm request has no header. The authored item request has the header. |
| Variable set and the lock names two remotes | The plan lists both. The header goes to each approved repository only. |
| Variable set and the lock is edited to name a third remote after the plan | The plan changes. `STALE_APPROVAL`. |
| Variable removed between plan and apply | `STALE_APPROVAL`. |
| Variable set after the plan was made without it | `STALE_APPROVAL` only if the plan named repositories. Otherwise the run does not read the variable. |
| GitHub answers 401 | `STORE_REMOTE_AUTH_FAILED`. Nothing is installed. |
| GitHub answers 301 with a `Location` header | Refused as a network failure. The token is not sent to the new place. |
| A request to `api.github.com/repos/other/repo/...` in a run that approved `owner/repo` | The header is not added. (A test calls the transport with such a URL.) |
| A request to `registry.npmjs.org` with the transport created with a token | No header. |
| The repository name has capitals | Compared in lower case. The header is added. |
| `store status` with an invalid variable | Prints the `is set but is not a valid token` line. Exits 0. |
| `--json` output of any command with a canary token | The canary appears nowhere in stdout or stderr. |
| Debug output, thrown errors, and stack traces | Contain no part of the token. |

## 8. Migration from beta.2 projects

None. No file format changes. The variable is optional. A machine without it behaves as spec 06.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/security.md`: a new section "The GitHub token for a private store". It says what the variable is, the one host and the one repository it goes to, that Bowerloom never stores or prints it, that redirects are refused, and what scope to give the token (read access to the store repository only). Say that a fine-grained token with read-only `Contents` permission on one repository is enough. State this as advice, not as a check Bowerloom makes.
- `apps/docs/src/content/docs/cli.md`: one paragraph under `## Apply` and under `store status` about the variable and the `Credentials:` line.
- `apps/docs/src/content/docs/reference/errors.md`: rows for `GITHUB_TOKEN_INVALID` and `STORE_REMOTE_AUTH_FAILED`. Update the `STORE_REMOTE_PRIVATE` row.
- `apps/docs/src/content/docs/troubleshooting.md`: an entry "My store is private" with the steps.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: "A store in a private GitHub repository works when you set `BOWERLOOM_GITHUB_TOKEN`. Bowerloom sends the token only to `api.github.com` for that repository and never stores or prints it."
- `apps/docs/src/content/docs/security.md` must also keep any sentence that says the public fetchers send no credentials. Change it to say: "`skills add` and the fetch of pinned skills send no credentials. Only the fetch of store items does, and only when you set `BOWERLOOM_GITHUB_TOKEN`." Search the docs for `credentials` and update each place that says otherwise.
- Spec 10 covers the token in the page "Where your items come from".

## 10. Acceptance tests

`packages/skill-manifest/test/github-token.test.mjs`:

1. `fromEnv` returns null for an unset variable and for an empty string.
2. `fromEnv` returns a token for a 20-character value, a 255-character value, `ghp_` plus 36 letters, and `github_pat_` plus letters and underscores.
3. `fromEnv` throws `GITHUB_TOKEN_INVALID` for 19 characters, 256 characters, a value with a space, a newline, a quote, a slash, a dot, and a non-ASCII letter.
4. The thrown error's `message` and `code` contain no part of the value (test with a value that has a unique canary prefix).
5. `String(token)`, `JSON.stringify({ token })`, `util.inspect(token)`, `` `${token}` ``, and `console.log` capture all give `[redacted]`.
6. `Object.keys(token)` and `JSON.stringify(Object.getOwnPropertyNames(token))` show no value. The value is not reachable except through `authorization()`.
7. `status` returns `set`, `not-set`, and `invalid` for the three cases and never throws.
8. `authorization()` returns `Bearer ` plus the value.

`packages/skill-manifest/test/public-get-auth.test.mjs` (stub `https.request` as `public-get.test.mjs` does):

1. With no `githubAuth`, no request has an `Authorization` header. This repeats the old guarantee.
2. With `githubAuth` for `owner/repo`, a request to `https://api.github.com/repos/owner/repo/git/commits/<sha>` has the header.
3. A request to `https://api.github.com/repos/other/repo/git/commits/<sha>` has no header.
4. A request to `https://api.github.com/repos/Owner/Repo/git/trees/<sha>` has the header (case-insensitive).
5. A request to `https://registry.npmjs.org/<package>` has no header.
6. A request to `https://api.github.com/repos/owner/repo-two/git/commits/<sha>` has no header (the prefix check includes the slash).
7. A 401 and a 403 response to a request with the header give `STORE_REMOTE_AUTH_FAILED`. The same statuses without the header keep their old result.
8. A response with a `Location` header is refused, and no second request is made.
9. A 404 gives `SKILLS_ADD_NOT_FOUND` in both cases.
10. `createPublicTransport` refuses a `githubAuth` that is not a `GithubToken`, has zero or more than eight repositories, or has a malformed repository.
11. The thrown error of any failed request carries no part of the token (canary).
12. All the old guards still hold: a non-public address, an IPv6 answer, a non-200 status, a content encoding other than identity, an oversized body. Run the cases of `public-get.test.mjs` unchanged.

`packages/skill-manifest/test/resolve-store-git.test.mjs` (add cases to spec 06's file):

1. With a token, a 404 on the commit request gives `STORE_REMOTE_AUTH_FAILED`.
2. Without a token, it gives `STORE_REMOTE_PRIVATE`.
3. The fake transport sees the header on all requests of one walk when the repository is approved, and on none when it is not.

`packages/project-sync/test/store-git.test.mjs` and `sync-config.test.mjs` (add cases):

1. The plan has `network.credentials` with the sorted repositories when a token is passed and an authored item needs fetching. It is null when no item needs fetching, or no token is passed.
2. The revision changes when the repository list changes. It does not change when the token value changes.
3. The plan JSON has no part of a canary token.
4. Apply refuses `STALE_APPROVAL` when the token is missing but the plan has credentials, and when a token is present but the plan has none and needed repositories.
5. Eight distinct remotes are accepted. Nine refuse `LOCK_INVALID`.
6. A pinned npm skill fetch in the same run has no header (use the stub).

`tests/token-cli.test.ts` (spawn the CLI with the fake GitHub repo and the fake network):

1. `apply --frozen` in a clone with `BOWERLOOM_GITHUB_TOKEN` set to a canary shows the `Credentials:` line and the changed `Network:` line, exits 3. With `--approve` it installs. The fake network log shows `authorization: true` for each `api.github.com/repos/<o>/<r>/` request and `authorization: false` for each `registry.npmjs.org` request.
2. The same without the variable: the lines are absent, and the log shows `authorization: false` everywhere. A private fake repository (404) gives `STORE_REMOTE_PRIVATE`.
3. An invalid value refuses `GITHUB_TOKEN_INVALID` with no network call (the log is empty).
4. A 401 from the fake gives `STORE_REMOTE_AUTH_FAILED`.
5. `use skill x` in a shared project with the variable set proves the item with the header.
6. `store status` prints each of the three token lines and the JSON `git.token` values.
7. The leak scan: after a full flow with a canary token (use, lock update, apply --frozen, team adopt, up), read every file under the project, the store, the state root, and the temporary HOME. None contains the canary. Standard output and standard error of every command (text and `--json`) do not contain the canary or any 8-character part of it.
8. `skills add` and `skills sync` of a pinned GitHub skill with the variable set send no header (the log).
9. `tests/no-spawn.test.ts` still passes.

Update `tests/human-refusal.test.ts` for the two new codes and the changed `STORE_REMOTE_PRIVATE` text. Update `tests/help-human.test.ts` only if the first screen changes (it does not).

## 11. Build order

1. `github-token.ts` and its test file.
2. `public-get.ts` changes, the refusal codes, and `public-get-auth.test.mjs`.
3. `tests/support/fake-network.ts` logs the header flag.
4. `resolve-store-git.ts` error mapping and `store-git.ts` transport options, with their cases.
5. Plan and binding changes in `plan.ts`, `apply-project.ts`, `change.ts`.
6. CLI reads, review lines, `store status` line, help text, refusal words.
7. `tests/token-cli.test.ts`.
8. Docs.
9. Run `npm run typecheck` and `npm test`. Then write the pull request body with the 12 properties of 3.8 and the test that proves each one. Ask for the security review.

## 12. Unverified items

1. GitHub accepts `Authorization: Bearer <token>` for both classic and fine-grained tokens on `api.github.com`. This is GitHub's documented form, but no test here can prove it against the live service. Check it by hand once with a real token on a private repository before the pull request. If GitHub answers 401 to `Bearer`, change `authorization()` to return `token ` plus the value (the older form) and change test case 8 of `github-token.test.mjs`.
2. The statuses GitHub uses for a missing token on a private repository. Documentation says 404. Check by hand once. If it answers 403 for rate limits and 404 for private repositories, the table in 3.7 already covers both. If it answers something else, map that status to `STORE_REMOTE_AUTH_FAILED` with a token and `STORE_REMOTE_PRIVATE` without one.
3. `util.inspect.custom` redaction under Node 22 and later. The symbol is `Symbol.for('nodejs.util.inspect.custom')`. Test case 5 proves it in this repository's Node version. If a test fails, also define `get [Symbol.toStringTag]()` returning `GithubToken`, and keep the private field.
4. The `fake-network.ts` hook gets the request options as its second argument (`serve(url, _options, callback)`). I read the function header, not the whole file. If the options are not available, record the header flag in the stub request object that the test passes in the unit tests, and keep the CLI-level assertion on the plan text and the leak scan only.
5. Whether `createPublicTransport` is created once per command or once per request in the fetch code of spec 06. The header rule works for both. If the code creates one transport for npm and git pins together, give the authored items their own transport so the npm requests can never see a token.
