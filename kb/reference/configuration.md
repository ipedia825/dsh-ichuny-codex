---
title: "dsh-ichuny-codex Configuration Reference"
category: reference
service: dsh-ichuny-codex
version: "1.7.7"
tags: [configuration, dsh, codex, models, authentication]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Documents the current plugin configuration schema and Codex dependency boundary."
---

# Configuration

The Cordis plugin entry is `llm-codex`; the LLM provider ID is `my-codex`. The display name is `My Codex`. The only plugin configuration fields are those in `src/index.ts`. [PATH: cordis.patch.yml] [PATH: src/index.ts] [PATH: src/adapter.ts]

| Field | Default | Accepted values |
|---|---|---|
| `command` | `bundled` | Native Codex executable path, or `bundled` to use the pinned `@openai/codex` platform binary. Empty strings fail. |
| `cwd` | `process.cwd()` | Nonempty working directory for new Codex threads. |
| `sandbox` | `workspace-write` | `read-only`, `workspace-write`, `danger-full-access`. |
| `approvalPolicy` | `untrusted` | `never`, `on-request`, `untrusted`. |
| `requestTimeoutMs` | `30000` | Safe integer from 1,000 through 300,000 milliseconds for app-server requests. |

[PATH: src/index.ts] [PATH: src/codex-command.ts]

The plugin starts Codex directly with `app-server --listen stdio://`. `bundled` resolves the native executable from the plugin's own installed dependencies, independent of the global `codex` command. Keep optional platform dependencies enabled. If the platform package is unavailable, reinstall or explicitly configure a native executable path. [PATH: src/codex-command.ts] [PATH: src/app-server/transport.ts]

## Authentication and models

An existing Codex CLI `chatgpt` login is required for model discovery, generation and quota reads. API-key login is not accepted by this adapter. Authentication and token storage belong to Codex; the plugin does not inspect its credential files. Models come from `model/list`, hidden models are filtered from the ordinary listing, and upstream reasoning efforts are exposed on model resolution. [PATH: src/adapter.ts] [PATH: src/app-server/client.ts]

## Optional services and tools

The DSH `llm` service is required. An attachment store is optional for text requests but required for image and file blocks. A web server is optional for the quota route; the bundled Web client requires that route to show quota. The adapter uses `experimentalApi: true` on every app-server connection. When a request contains DSH tools, a persistent `sessionId` is required; there is no `experimentalDynamicTools` configuration flag. [PATH: src/index.ts] [PATH: src/adapter.ts] [PATH: client.js]

The current plugin does not expose `provider`, `allowApiKeyAuth`, `inheritSessionPermissions`, `dynamicToolTimeoutMs` or `turnTimeoutMs` configuration fields. The separate `resolveSessionPermissions` helper is not wired into `apply()`. Threads are cached only in process memory; after a plugin restart the adapter starts a new thread rather than resuming a serialized one. [PATH: src/index.ts] [PATH: src/adapter.ts] [PATH: src/session-permissions.ts]

## Child environment

The allowed inherited variables are `APPDATA`, `CODEX_HOME`, `HOME`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `SYSTEMROOT`, `TEMP`, `TMP`, `USERPROFILE`, `WINDIR`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, plus names starting with `LC_`. Other ambient variables are dropped. This is the implemented list, not a guarantee that all platform-specific certificate or proxy settings are supported. [PATH: src/index.ts]

See [architecture](architecture.md), [security](security.md) and [setup](../howto/setup.md).
