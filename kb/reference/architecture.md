---
title: "dsh-ichuny-codex Architecture"
category: reference
service: dsh-ichuny-codex
version: "1.7.14"
tags: [architecture, dsh, codex, json-rpc, stdio, web]
created: "2026-11-14"
last_updated: "2026-11-16"
description: "Describes the current provider, app-server transport, attachment handling, tool flow, and Web quota surface."
---

# Architecture

`@ipedia/dsh-ichuny-codex` is a Cordis plugin named `dsh-ichuny-codex`. Its patch inserts `llm-codex`; the actual LLM provider ID is `my-codex`, displayed as `My Codex`. The plugin requires the DSH `llm` service and injects `sessions`, `workingDirectory`, `attachments` and `webServer` optionally. \[PATH: src/index.ts] \[PATH: src/adapter.ts] \[PATH: cordis.patch.yml]

## Runtime path

1. The plugin resolves the native executable from its pinned `@openai/codex` platform package unless `command` overrides it. It starts `codex app-server --listen stdio://` directly with `shell: false` and a restricted environment. \[PATH: src/codex-command.ts] \[PATH: src/app-server/transport.ts]
2. `AppServerClient` initializes JSON-RPC over JSONL with `experimentalApi: true`, reads Codex-owned account status, and discovers models. The adapter requires an authenticated `chatgpt` account; it never reads credentials. \[PATH: src/index.ts] \[PATH: src/app-server/client.ts] \[PATH: src/adapter.ts]
3. `CodexAdapter` converts DSH user text, image and file blocks to Codex inputs, streams text and reasoning deltas, usage, tool calls and finish status. Images use the optional attachment store and become data URLs. Files become read-only path descriptions for Codex to access through its own tools. \[PATH: src/adapter.ts]
4. When DSH supplies tools, the adapter registers up to 128 tool schemas on a new Codex thread. An incoming `item/tool/call` becomes a DSH tool-call stream; DSH executes it and the next adapter invocation supplies matching text and image results from the attachment store. Tools require a persistent DSH session ID. There is no plugin configuration switch to disable the experimental API or this per-request tool path. \[PATH: src/adapter.ts]
5. The optional web server serves a sanitized `account/rateLimits/read` summary at `/api/dsh-ichuny-codex/rate-limits`. The Web client shows 5-hour and weekly remaining quota in the conversation composer only while `my-codex` is selected, with a five-minute cache. \[PATH: src/index.ts] \[PATH: client.js]

## State and limits

Codex threads are cached by DSH session ID within a process. Acknowledged `turn/start` records a pending user message ID; only a successful `turn/completed` advances the durable input cursor. A failed turn may retry the same input. Subsequent successful turns only project user-role messages after that cursor. When only the DSH tool catalog or system instructions change, Codex `thread/resume` updates the thread context and a bounded continuation is sent instead of replaying the old user message; an identical request without new work is still refused. System text on a newly created thread is supplied as `baseInstructions`, never replayed as user text. Successful replies persist the Codex thread ID and cursor in DSH assistant replay state, allowing a later adapter generation to call `thread/resume`. Old assistant messages without replay state and histories with neither a cursor nor a safe assistant boundary cannot recover the prior thread. A completed in-memory thread is also resumed with updated `dynamicTools` when the DSH catalog changes. \[PATH: src/adapter.ts]

The plugin reads the effective per-session directory from optional `sessions` and `workingDirectory` services when it creates or resumes a Codex thread; an explicit `cwd` setting takes precedence. Changing the DSH directory updates the same Codex thread at the next turn boundary. Without those services, it falls back to the configured/default host cwd. Compaction and other DSH auxiliary-purpose requests use separate temporary read-only Codex threads even when DSH supplies the ordinary session ID. They cannot register DSH dynamic tools and do not mutate the main thread's in-flight tool calls or user-message cursor. [PATH: src/adapter.ts]

User-role context injected by DSH is projected before the human user request in a new Codex turn so administrative time/skill metadata cannot be the final instruction. When DSH exposes `run_code`, Codex receives a short developer instruction to attempt the tool before claiming failure; tool use is still the model's choice. A `thread/resume` reply whose ID differs from the requested thread is rejected to avoid silently losing prior tasks. \[PATH: src/adapter.ts]

Tool limits include 128 catalog entries, 16 concurrent unanswered calls, 256 KiB per serialized argument payload, 256-byte UTF-8 call IDs, eight images and 4 MiB aggregate encoded UTF-8 tool results. Duplicate or already-aborted incoming calls are refused before registration. Duplicate, missing, oversized and unsupported result blocks fail the batch before any pending call is answered; failures reject pending calls and interrupt the turn. A change to tool names, descriptions, or schemas is validated and applied with `thread/resume` between completed turns; tool results in flight use their original catalog. Server requests are bounded by the client timeout and cancellation. \[PATH: src/adapter.ts] \[PATH: src/app-server/client.ts]

## Development boundaries

Codex owns authentication, built-in tools and sandbox prompts. DSH executes DSH tools under its own policy. The app-server transport bounds JSONL lines at 8 MiB, retained stderr at 64 KiB and shutdown stages at 5 seconds by default. The current test runner covers every remaining spec file in `tests/`, including adapter, dynamic tools, Cordis composition and app-server protocol checks; neither a passing build nor those tests establish a live DSH host or Codex smoke result. \[PATH: src/app-server/transport.ts] \[PATH: vitest.config.ts]

See [configuration](configuration.md), [protocol](app-server-protocol.md), [security](security.md) and [setup](../howto/setup.md).
