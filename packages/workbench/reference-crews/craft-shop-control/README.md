# Craft-shop reference crew

This Workbench control uses Emery for a functional HTML prototype and Coda for refinement. Each task requires exact write approval and registered browser acceptance.

The second task consumes the accepted prototype. Separate output paths preserve both artifacts.

The crew demonstrates the [portable authoring contract](../../../authoring/README.md). Its names and prompts are reference choices, not framework requirements.

The frozen [scenario](../../scenarios/craft-shop-v1/scenario.json) pins the brief, browser contract, synthetic orders, output paths, and four browser criteria.

## Prepare an offline copy

1. Copy this directory into a new private project directory.
2. Obtain canonical manifest bytes from the reviewed installation's registered tester.
3. Save those bytes unchanged as `assets/test-manifest.json` in your copy.
4. Run the authoring validation and export commands in the [personal-agent instructions](../../../../docs/authoring/personal-agent.md).

The template intentionally omits the tester manifest. Offline tests supply a synthetic manifest only in temporary fixtures.

Do not use fixture digests for live acceptance. The installer must match the export against its actual registered tester before dispatch.

## Included maps

`authoring.json` links the crew, brief, skill descriptor, relay map, Vines map, and scenario.

The skill descriptor binds `skills/craft-ui.md` to the owners that declare it. Their prompts and instructions remain pinned crew assets.

The relay map declares the accepted `design.draft` handoff into `build.draft`. It installs no socket or remote transport.

The Vines map declares runtime status, write receipts, and browser acceptance evidence for both tasks. It adds no collection service or self-improvement loop.

Public defaults reserve 25 percent capacity and allow at most two active workers. This scenario executes its tasks sequentially.

Export is offline and confers no approval authority. The [installation helpers](../../../../docs/authoring/installation.md) prepare its private snapshot; live Workbench execution remains separate.
