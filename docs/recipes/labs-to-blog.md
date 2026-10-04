# Labs experiment → blog draft

This alpha recipe takes a completed experiment whose evidence is already committed to one GitHub repository, accepts an evidence-linked Markdown draft from a personal agent, and creates or updates one **draft** pull request for that experiment. It never publishes or merges. Trellis supplies reusable tooling; private Labs choices belong in the operator's installation.

The personal agent writes and critiques the prose using its existing harness. No model-provider library or paid model call is used here. Citation validation checks exact committed evidence bytes and declared links; it does **not** establish that a claim is true, comprehensive, or appropriately qualified. The human reviews that judgment.

## Prepare once

Use Node 24, PostgreSQL (including local Supabase), and a GitHub App installation token scoped to the chosen repository with Contents and Pull requests write access. The token lives in a separate operator-owned JSON file as `{"token":"..."}`; PostgreSQL uses `{"password":"..."}`. The operator creates a private installation file, also mode 0600 and owned by the current OS user. Paths must resolve without symlinks, files must be regular and singly linked. Never include credentials in the portable recipe or a tool argument.

```json
{
  "format": "trellis/recipe-installation/v1",
  "recipe": {
    "format": "trellis/recipe/labs-to-blog/v1",
    "id": "labs-blog",
    "sourceRevision": "REPLACE_WITH_REVIEWED_40_HEX_SOFTWARE_COMMIT",
    "github": {
      "host": "github.com",
      "owner": "YOUR_OWNER",
      "repo": "YOUR_REPO",
      "baseBranch": "main",
      "branchPrefix": "trellis/labs-blog/labs",
      "draftPath": "drafts/labs-experiment.md",
      "evidencePrefix": "experiments"
    }
  },
  "postgres": {
    "host": "127.0.0.1", "port": 56582,
    "database": "trellis_recipes", "user": "postgres",
    "passwordFile": "/PRIVATE/postgres.json",
    "controlSchema": "trellis_labs_control",
    "checkpointSchema": "trellis_labs_checkpoints"
  },
  "github": { "tokenFile": "/PRIVATE/github.json" },
  "approval": { "subject": "operator", "enabled": true }
}
```

Replace every placeholder. `sourceRevision` is the exact reviewed software/recipe source commit attested by the operator; the installation loader does not independently inspect the installed executable. The recipe's full JSON digest is also bound into each plan. The source experiment has its own exact GitHub commit, and its bytes are verified through the sealed connection.

The database already exists. `setup` creates only the two explicitly configured schemas, installs pinned LangGraph checkpoint migrations, and stores the exact recipe. Repeating identical setup reuses it. A different recipe under the same ID is refused. A pre-existing checkpoint schema with no corresponding control schema is refused. Reserve the configured schema names for this installation, and do not point them at another application.

After root CLI integration:

```sh
trellis recipe inspect --installation /PRIVATE/installation.json
trellis recipe setup --installation /PRIVATE/installation.json
trellis recipe plan --installation /PRIVATE/installation.json --input /PRIVATE/plan-input.json
```

The reusable API is `openRecipeService(privateInstallationPath)` returning `{dispatch(operation,args), close()}`. CLI and MCP use this same controller. The MCP server receives the private path at startup; its tools cannot select another installation. MCP does not expose `approve`. The operator CLI records exact approval separately. Tool annotations are not a permission boundary.

## Prepare and review a draft

`plan` takes exactly `{experiment,draft,metrics}`. The experiment contains `id`, `status:"completed"`, ISO UTC `completedAt`, a 40-hex `commit`, `record`, and one to eight `evidence` files. Each file contains `{id,path,content,digest}`, where digest is SHA-256 over the supplied UTF-8 bytes. Paths must sit beneath the installation's evidence prefix, in the same sealed repository. The source revision must be immutable; branch names are refused.

The draft contains `{title,markdown,claims}`. Each claim is `{text,evidenceIds}`; text must occur in the Markdown and links must include the corresponding exact `https://github.com/OWNER/REPO/blob/COMMIT/PATH` evidence URLs. Markdown is bounded to 64 KiB. Regular Git blobs and parent trees are checked; symlinks and submodules are refused. The personal agent must still review unsupported assertions and omissions.

Metrics contain all seven keys: `setupMinutes`, `draftingMinutes`, `reviewMinutes`, `corrections`, `inputTokens`, `outputTokens`, and `baselineMinutes`. Use null for anything not measured. These values are explicitly personal-agent-reported. Human review time stays null until actually measured. A direct-tools comparison is matched only for the same measured steps, evidence, and output; this implementation computes no gain or subscription rate. Durable step claim/completion timestamps describe observed elapsed time, including interruptions, not human effort or provider usage.

`plan` reads GitHub but performs no GitHub write. Its digest binds the exact recipe, experiment, evidence, draft, destination repository/path, base SHA, prior head/file SHA, PR identity, and proposed content. Copy its `jobId` into a request file for `run`, `review`, `status`, `reconcile`, or `cancel`:

```json
{"jobId":"sha256:EXACT_JOB_DIGEST"}
```

`run` before approval saves a LangGraph review interrupt. `review` returns the exact plan and current durable records without advancing it. The operator reviews the content and uses an approval request containing exactly `jobId` and `planDigest`; no supplied approver name is accepted. The private controller supplies its configured issuer identity. `run` then resumes the checkpoint.

```sh
trellis recipe review --installation /PRIVATE/installation.json --input /PRIVATE/job.json
trellis recipe approve --installation /PRIVATE/installation.json --input /PRIVATE/exact-approval.json
trellis recipe run --installation /PRIVATE/installation.json --input /PRIVATE/job.json
```

Approval is a capability of the designated OS operator/controller, not an independent proof of human presence. Anyone with that same OS authority and access to the enabled private installation can invoke the approval CLI. Keep it out of untrusted agent filesystem authority. Disabled approval installations cannot issue approval; their MCP clients can plan, inspect, and pause. Do not give an untrusted trigger a writer token or approval capability.

## Recovery and stopping

One stable job ID derives from recipe ID, repository, and experiment ID. It determines the draft branch. Repeating a completed run sends no writes. After completion, a revised draft for the same experiment creates a new exact plan and approval while updating the same branch and draft PR. Up to 20 prior completed revisions are retained. A pre-existing unrecorded branch or PR is refused.

Each branch/file/PR step is committed as `SENDING` before its write. Unknown HTTP outcomes or acknowledgement loss retain the consumed claim. `run` never re-sends it. `reconcile` performs scoped reads and can confirm the exact observed state; absence alone cannot fence a paused sender and never authorizes retry. An unresolved claim needs operator investigation; this alpha has no force-release or blind retry command. A file step can leave unreferenced Git blobs/trees/commits if interrupted before its branch update; it still holds instead of repeating.

File completion and response-loss reconciliation require a commit with the exact approved parent and operation message. The controller rebuilds the expected complete Git tree from that parent with only the approved path replaced, verifies the parent tree hashes, and refuses any additional change. It persists the resulting head, parent, tree and blob as a write receipt. PR dispatch and reconciliation recheck that receipt and bind the PR head/base SHAs; another same-content commit cannot replace a recorded receipt. Planning a later update also verifies the previous receipt. Job records use `trellis/recipe-job/v2`; older receipt-less records are refused and require explicit operator investigation, not automatic adoption.

Branch updates use `force:false`, which is not an exact compare-and-swap: a concurrent rewind may still permit a fast-forward. Source/base/head/file drift refuses the write where observed. Newly created PRs always request `draft:true`; changed ready/closed PRs are refused. There is no PostgreSQL/GitHub atomic transaction or atomic PR head/draft-state precondition. The adapter checks the head immediately before sending, and the controller checks after sending, but cannot close the final network race against another remote writer. The reserved branch/PR namespace must have one automation writer and operators must avoid concurrent edits during dispatch. A later remote edit can alter a PR after the recorded observation. Reconciliation proves the approved tree transition at observation time; it does not prove the identity of every remote actor.

`cancel` revokes further dispatch. A consumed in-flight step may still complete: cancellation reports `CANCELLED_WITH_POSSIBLE_EFFECT` until observed, retains all history, and never deletes a branch or PR. Cancellation cannot retract an already transmitted GitHub request. Cross-process orchestration is serialized by a PostgreSQL advisory lock; durable effect claims still prevent duplicate sends if the connection is lost. State is not adopted by a branch name alone without the prior durable operation record.

## Optional tracing and scope

No LangSmith service is configured. The pinned graph currently refuses before construction if any of these environment variables has an enabled value: `LANGSMITH_TRACING`, `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2`, `LANGSMITH_OTEL_ENABLED`, `OTEL_ENABLED`, `LANGCHAIN_VERBOSE`, `LANGSMITH_DEBUG`. Unset, empty, `false`, `0`, or `off` are disabled. It also refuses `LANGSMITH_TRACING_MODE` values other than `langsmith`, `OTEL_TRACES_EXPORTER` other than `none`, or an active inherited tracing context. Launch this controller from an operator environment with optional tracing disabled. It never rewrites global environment variables. Explicit tracing-disabled context remains in use.

This restriction is intentional: the installed upstream versions attempted a LangSmith request under hostile tracing variables despite their explicit false context. The offline transport spy caught and blocked it. Tests establish zero optional sends on the normal exercised graph path and zero sends on hostile-environment refusal, not universal network containment of arbitrary libraries.

The only production network paths here are the explicitly sealed loopback PostgreSQL transport and fixed `api.github.com` repository REST endpoints. Credentials are read locally by the controller. There is no arbitrary URL fetch, shell runner, provider model call, or n8n dependency. An optional n8n trigger can submit identifiers for this same recipe; it cannot issue approval.

GitHub behavior is based on [reference updates](https://docs.github.com/en/rest/git/refs#update-a-reference), [Git trees](https://docs.github.com/en/rest/git/trees), and [draft PR creation](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request). Saved review uses the pinned [LangGraph interrupt and resume API](https://docs.langchain.com/oss/javascript/langgraph/interrupts).
