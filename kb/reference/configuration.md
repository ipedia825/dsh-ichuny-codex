---
title: "dsh-ichuny-codex Configuration Reference"
category: reference
service: dsh-ichuny-codex
version: "1.8.0"
tags: [configuration, dsh, codex, models, authentication]
created: "2026-08-26"
last_updated: "2026-11-24"
description: "Documents the current plugin configuration schema and Codex dependency boundary."
---

# Configuration

The Cordis plugin entry is `llm-codex`; implemented LLM provider IDs are `my-codex` (`ChatGPT（本地）`) and `my-codex-oauth` (`ChatGPT（OAuth Preview）`). The plugin also stores a non-secret volatile `preferredConnection` preference for the connection settings page; it does not switch or unload an active adapter. OAuth UI can manage the official SIWC Preview credential through an authenticated Typert controller; `my-codex-oauth` starts its independent app-server only after a validated SIWC credential is available. [PATH: cordis.patch.yml] [PATH: src/index.ts] [PATH: src/adapter.ts] [PATH: client.js]

| Field | Default | Accepted values |
|---|---|---|
| `command` | `bundled` | Native Codex executable path, or `bundled` to use the pinned `@openai/codex` platform binary. Empty strings fail. |
| `cwd` | Effective DSH session directory when `sessions` and `workingDirectory` are mounted; otherwise `process.cwd()` | Explicit nonempty working directory for Codex threads overrides the session directory. |
| `sandbox` | `workspace-write` | `read-only`, `workspace-write`, `danger-full-access`. |
| `approvalPolicy` | `untrusted` | `never`, `on-request`, `untrusted`. |
| `requestTimeoutMs` | `30000` | Safe integer from 1,000 through 300,000 milliseconds for app-server requests. |
| `preferredConnection` | `local` | Volatile non-secret preference, `local` or `oauth`; the UI disables OAuth selection until its credential is connected. Existing sessions retain their provider. |

[PATH: src/index.ts] [PATH: src/codex-command.ts]

The plugin starts Codex directly with `app-server --listen stdio://`. `bundled` resolves the native executable from the plugin's own installed dependencies, independent of the global `codex` command. Keep optional platform dependencies enabled. If the platform package is unavailable, reinstall or explicitly configure a native executable path. [PATH: src/codex-command.ts] [PATH: src/app-server/transport.ts]

## Authentication and models

The local provider requires an existing Codex CLI `chatgpt` login for its models, generation and quota; API-key login is not accepted. OAuth uses separate official SIWC authorization and a DSH credential record, never Codex auth files or local quota. Models come from `model/list`, hidden models are filtered from the ordinary listing, and upstream reasoning efforts are exposed on model resolution. [PATH: src/adapter.ts] [PATH: src/app-server/client.ts]

## Optional services and tools

The DSH `llm`, `credentials`, and `authorization` services are required. The host owns the credential provider; this plugin registers one `dsh-ichuny-codex/my-codex-oauth` authorization flow and never installs a credential store itself. An attachment store is optional for text requests but required for image and file blocks. A web server is optional for the quota and local connection-status routes; the bundled Web client uses those routes in the ChatGPT connections settings section. The adapter uses `experimentalApi: true` on every app-server connection. When a request contains DSH tools, a persistent `sessionId` is required; there is no `experimentalDynamicTools` configuration flag. [PATH: src/index.ts] [PATH: src/adapter.ts] [PATH: client.js]

The `sessions` and `workingDirectory` services are optional. When both are mounted, each request reads the live DSH session's effective cwd rather than reusing the Web host's launch directory; if only `sessions` exists it uses the session header's initial cwd. Explicit `cwd` wins in all cases. Changing a session directory updates an existing Codex thread via `thread/resume` between turns. [PATH: src/index.ts] [PATH: src/adapter.ts]

The current plugin does not expose `provider`, `allowApiKeyAuth`, `inheritSessionPermissions`, `dynamicToolTimeoutMs` or `turnTimeoutMs` configuration fields. The separate `resolveSessionPermissions` helper is not wired into `apply()`. In-process threads keep a DSH user-message cursor; successful replies also persist the non-secret Codex thread ID and cursor in DSH replay metadata. A new adapter can resume a thread from that metadata, but older replies have no replay state and pending tool calls cannot survive restart. [PATH: src/index.ts] [PATH: src/adapter.ts] [PATH: src/session-permissions.ts]

## Child environment

The allowed inherited variables are `APPDATA`, `CODEX_HOME`, `HOME`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `SYSTEMROOT`, `TEMP`, `TMP`, `USERPROFILE`, `WINDIR`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, plus names starting with `LC_`. Other ambient variables are dropped. This is the implemented list, not a guarantee that all platform-specific certificate or proxy settings are supported. [PATH: src/index.ts]

See [architecture](architecture.md), [security](security.md) and [setup](../howto/setup.md).
