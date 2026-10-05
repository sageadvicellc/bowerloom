---
title: "Codex and Claude Code"
description: "Understand fixture conversion and the open native execution boundary."
---
A harness is the agent application that runs a model and exposes its tools. Bowerloom keeps portable team definitions separate from harness-specific settings.

## Selected synthetic configuration

The CLI exposes fixture import, planning, approved projection, removal, and recovery for `codex` and `claude`. These operate on explicitly selected synthetic files.

Do not point fixture commands at your live `.codex/` or Claude Code settings. The `--synthetic` flag records your assertion; it cannot prove the selected data is synthetic.

The supported subset preserves explicit provider model names. It does not translate one provider's permissions or model names into another's authority.

## Native execution remains gated

Internal Codex boundary and admission work binds qualifications, artifact identity, expiry, and exact launch scope. A missing qualification must refuse; it is not permission to fall back to a less restricted mode.

This documentation supplies no native bootstrap or model-run command. Complete live tasks under both harnesses, native tool bypass tests, and broader security qualification remain open.

## Evidence and limits

Source reference: [`packages/harness-portability`](https://github.com/sageadvicellc/bowerloom/tree/37f1efab545921d08378956eef854c3b17bd4f16/packages/harness-portability), development snapshot `37f1efa`. Fixture projections are not native compatibility evidence. The independent `cd62b530` CLI UX trial did not accept native adapters.
