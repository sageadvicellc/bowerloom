# Harness syntax observation — October 4, 2026

This is a narrow syntax snapshot for synthetic fixtures. It is not proof of model availability, permissions equivalence, configuration application, account capacity, or a running session. Only `--help` and `--version` were invoked; no live configuration was read by the import tool and no model session started.

## Codex CLI 0.157.0

The installed CLI reported `codex-cli 0.157.0`. Its complete help is preserved in `codex-help.txt`; it documents model selection and TOML-valued configuration overrides and includes an `o3` model example. Its sandbox and approval modes are native controls, outside this conversion slice.

The official [configuration reference](https://developers.openai.com/codex/config-reference/) redirected to [ChatGPT Learn's configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The retrieved reference gives `gpt-6.1-sol` as a model example and lists reasoning-effort labels including low, medium, high and xhigh. Actual available levels depend on model and client. These observations justify recognition of the two explicitly observed model identifiers and a restricted four-label preference subset; they do not justify selecting or executing a model. Native permission settings are not imported into the neutral preferences.

## Claude Code 2.1.288

The installed CLI reported `2.1.288 (Claude Code)`. Its complete help is preserved in `claude-help.txt`. Its model flag describes fable, opus and sonnet aliases; its effort flag lists low, medium, high, xhigh and max.

The official [model configuration guide](https://code.claude.com/docs/en/model-config) distinguishes a session's CLI effort from persistent configuration. `effortLevel` accepts low, medium, high and xhigh, while max is not a persistent setting. The effect of top-level effort also depends on model, settings scope and per-model overrides. This slice therefore records a preference, not effective capability. The [settings guide](https://code.claude.com/docs/en/settings) documents JSON files and precedence. The importer examines one explicitly selected synthetic file only; it does not resolve precedence across user, project or managed settings.

## Parser decision

The current workspace has yaml 2.9.1 and its own duplicate-strict JSON parser. No TOML parser was installed. JSON must pass the existing strict parser before YAML is used for structural checks. The intentionally restricted TOML parser rejects syntax outside its documented grammar instead of approximating a full TOML document. No dependency was downloaded.
