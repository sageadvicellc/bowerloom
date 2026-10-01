# Local session contract

This source connects a private local installation to the graph and supervised runtime. The public command entry point still needs the registered browser package.

The installation file contains machine paths and account bindings. Portable crew definitions contain the versioned prompts, skills, task graph, permissions, and test manifest. Keep these files separate.

The controller accepts a loopback PostgreSQL database and six distinct schemas. It preserves the existing account admission ledger. It does not create an account or replace its policy.

The local operator owns the private installation and credential files. Both files require owner-only permissions, regular files, and unique links. The parser rejects duplicate JSON keys and oversized input.

The alpha uses one supervised installation per database. Separate schemas do not establish independent DBOS recovery domains. Shared company installations remain a beta requirement.

## Commands

The session parser defines `up`, `status`, `review`, `approve`, and `cancel`. Each command requires an explicit installation file. The `up` command also requires `--demo` and one tier flag.

The tier flags do not claim measured subscription rates. The alpha keeps the declared crew limit and the current account admission policy. Each demo graph runs sequentially.

The `status` and `review` paths start no model or browser. The `review` result includes the stored proposal. The `approve` path requires its exact candidate and action digests.

An approval permits the stored artifact write and its declared acceptance test. The runtime stops if approval, ownership, capacity evidence, or test evidence fails. It never retries an uncertain action automatically.

The session stops for a pending approval, a terminal result, an interrupt, or its two-minute deadline. An interrupt or deadline requests cancellation. The controller completes cleanup before it emits the result.

The `cancel` path records cancellation before runtime recovery. This prevents a recovered workflow from starting another model operation. Cleanup failure remains an error and does not imply that an external process stopped.

## Browser gate

The graph permits one approved artifact write and one optional registered test per task. A browser test requires an HTML output and the exact pinned manifest. The only supported test is `craft-shop-ui-v1`.

The bridge selects the write by its operation name. Effect order does not change the target. The local session requires the browser gate on every task. A missing or changed manifest prevents bridge construction.

The controller validates bridge policy and supported task shapes before runtime recovery. An interrupted approval grants no authority after the interrupted read.

The operator proof lasts two minutes. Each approval lasts at most one minute and also respects the task deadline and lease.

The native input limit is 32,768 UTF-8 bytes, including its fixed instruction. This permits a bounded accepted HTML handoff between leads. Oversized input fails without truncation or model submission.

The native policy version is `codex-subscription-proposal/v0.7-alpha.2`. Its process, output, permission, and subscription controls remain unchanged.

## Evidence limits

Unit tests cover argument rejection, exact approval, interruption, deadlines, private file handling, graph gates, and input limits. Real CLI orchestration and generated-artifact acceptance remain separate tests.
