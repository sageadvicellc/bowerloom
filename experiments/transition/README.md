# Transition research fixtures

These experiments support the specification proposal. They are synthetic models and local stubs. They do not implement a Trellis runtime.

The source manifest binds each copied file to its reviewed research source. The draft schemas remain proposals. No JSON Schema engine evaluated them.

## Run the fixtures

The recorded environment uses Python 3.14.7, Git 2.39.5, and macOS 15.5 on arm64. Other environments remain untested.

From the repository root, run:

```sh
python3 experiments/transition/run_fixtures.py
```

The runner copies fixtures into temporary storage outside the checkout. The recovery fixture terminates only its own test processes. The portability fixture creates only local Git repositories.

The runner invokes no model, hosted API, credential reader, or installed agent harness.

| Fixture | Expected cases | Evidence scope |
|---|---:|---|
| Admission | 45 | Synthetic usage observations, reservations, and concurrent claims |
| Composition | 52 | Scoped requests, approvals, demo artifacts, and definition migration |
| Portability | 33 | Generated representations, drift, capability rejection, and simulated handoff |
| Recovery | 15 | SQLite state, forced process termination, reconciliation, and simulated external effects |
| Repository structure | 14 | Version compatibility and release-manifest selection |

These results do not establish authentication, operating-system containment, a provider quota guarantee, or production readiness. Live harness and module integration remain release gates.

The QMD benchmark and current-module source inspection remain in the private research evidence. They require their recorded environment and source revisions. This runner does not reproduce them.
