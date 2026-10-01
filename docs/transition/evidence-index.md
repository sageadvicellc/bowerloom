# Research evidence index

The independent review supports all 67 registered claims within their recorded limits. The records below date from October 1, 2026.

## Review records

The complete notes and independent report remain in the private campaign workspace under `work/campaign/research`. This repository records their hashes in [evidence-manifest.json](evidence-manifest.json).

The specification cites fact identifiers from those records. The table maps each identifier group to its retained note. Public documentation links remain in the specification.

| Fact identifiers | Retained note | Confirmed claims |
|---|---|---:|
| `durable-F1` through `durable-F11` | `notes/durable-execution.md` | 11 |
| `hp-F1` through `hp-F21` | `notes/harness-portability.md` | 21 |
| `contracts-F1` through `contracts-F4` | `notes/module-contracts.md` | 4 |
| `qmd-F1` through `qmd-F12` | `notes/qmd-scaling.md` | 12 |
| `rstruct-F1` through `rstruct-F10` | `notes/repository-structure.md` | 10 |
| `capacity-F1` through `capacity-F9` | `notes/subscription-capacity.md` | 9 |

`CHECK.md` records 67 confirmed claims, zero changed claims, zero failed claims, and zero unsupported claims. Confirmation applies to the documented observation or experiment.

The retained records include source revisions, commands, observations, limitations, and proposed decisions. Raw private evidence remains outside this repository. A hash identifies a retained record but does not replace its evidence.

## Reproducible experiments

The [research runner](../../experiments/transition/README.md) reproduces 159 assertions and cases across five experiments. These use synthetic data and local stubs.

The runner does not reproduce the native QMD benchmark or the existing Roots validator test. Those require the recorded environment and source revisions. Their evidence remains in the private records.

No experiment establishes a working Trellis release, authenticated permissions, a provider quota guarantee, or production containment. The specification preserves these limitations as release gates.

## Founder clarification

On October 1, Hanna limited the sole-merger rule to `main`. The [working order](working-order.md) records team authority over feature branches.

The current candidate includes that instruction after the independent review. The manifest records the amendment separately. Research observations and experiment sources remain unchanged.

Hanna also selected the framework monorepo and retirement of the five dispersed module repositories. The [cutover plan](monorepo-cutover.md) records preservation and retirement gates. This decision follows the independent research review.

Hanna added Codex-first `v0.7-alpha` for testing, beta baseline measurements, and marketing preparation before beta. The [release plan](release-plan.md) records that decision and the proposed acceptance criteria. This amendment adds no new experiment result.
