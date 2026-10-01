# Graph to runtime bridge

The bridge connects a committed graph claim to one supervised runtime task. It does not start a model process itself.

The controller supplies a pinned graph, a durable graph store, a runtime, and a fixed policy. The bridge reads the claim from that store. It derives the expected task request from the stored graph. A supplied request must match that request exactly, including accepted predecessor data.

The bridge binds runtime identity to the workspace, run, and task. It binds the reservation to the graph execution identity. A restart uses the same timestamps, account alias, allowance, approvers, and model route. A changed policy cannot adopt a persisted run with different input.

## Inputs and authority

The prompt contains the pinned owner instructions, skills, task description, acceptance criteria, input values, and required proposal metadata. It includes no owner credential. It asks the model to propose file content through the existing action format.

The adapter enforces its existing 32,768-byte bound on the entire prompt. The bridge uses the same function before admission. It refuses an oversized task without truncation. A large predecessor artifact can therefore stop the next task. The limit includes the adapter's fixed preamble and accepted predecessor content.

The controller must supply authenticated snapshots when it assembles the graph. The bridge proves snapshot integrity against the compiled asset pins. It does not authorize access to an external source. The roots library provides that separate retrieval boundary.

The alpha bridge uses the pinned Codex route for every owner. Portable model classes remain in the crew definition. Automatic selection among model classes remains unimplemented.

## Admission and owner credentials

Before submission, the bridge reads the policy from the runtime admission ledger. Its threshold must preserve the crew reserve. Its worker limit must not exceed the crew limit. Its allowed routes must include the pinned Codex route. The runtime then applies its normal observation, reservation, and launch controls.

An owner resolver selects the credential for each task. In alpha, this optional function must return the credential directly.

The resolver receives a copy of the task input. The controller supplies this resolver for crews with multiple owners. The broker authenticates its result at each protected operation. Without a resolver, the existing fixed owner credential remains in use.

The resolver is controller code. Do not expose it to worker output. A resolver failure or wrong identity must stop the protected operation. The runtime refuses Promise credentials before authentication. It observes their rejection without an automatic retry. Async resolution remains unsupported in this alpha profile.

## Completion and cancellation

The bridge reads completion from the runtime ledger. It requires the exact stored input, proposal, receipt, and accepted evidence. DBOS workflow success alone does not release the next task. The graph independently makes sure that the receipt and typed output match.

A consumed claim never receives an automatic retry. Missing runtime state or an uncertain submission stops the graph for reconciliation. The bridge retains the runtime allowance.

Graph cancellation stops future scheduling. The bridge reads that state again after it obtains the runtime policy. Cancellation can still race with an already committed submission. The controller must also cancel the runtime task to stop an active process. The existing runtime owns process termination and its evidence.

## Scope

The bridge supports one approved write, one output, one attempt, and an optional registered `craft-shop-ui-v1` test. The local CLI requires that test for every demo task. `examples/endor-alpha` supplies the two-lead template; the older `examples/endor` remains an offline compiler example.

Synthetic tests cover the bridge mapping and rejection paths. Separate PostgreSQL tests cover policy reads and owner credentials. The live two-lead graph completed with real browser acceptance; final independent alpha review remains pending. See [current evidence](acceptance-status.md).
