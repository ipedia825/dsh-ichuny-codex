---
title: "Codex App-Server Protocol Surface"
category: reference
service: dsh-ichuny-codex
version: "1.7.7"
tags: [codex, app-server, json-rpc, protocol, streaming]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Records the app-server methods and wire boundaries used by the current plugin."
---

# App-Server Protocol

The plugin starts the pinned native Codex executable directly with `app-server --listen stdio://`, then exchanges one JSON object per line over stdio. `AppServerClient` sends `initialize`, validates the response and sends `initialized`. `apply()` sets `experimentalApi: true` and `requestAttestation: false`. The current client information is `name: softspark_dsh_codex`, `title: SoftSpark DSH Codex`, and version `1.7.7`; client identity is separate from the npm package and provider names. [PATH: src/app-server/transport.ts] [PATH: src/app-server/client.ts] [PATH: src/index.ts]

## Used requests

| Method | Purpose |
|---|---|
| `account/read` | Require an authenticated `chatgpt` account; never read credential storage. |
| `account/rateLimits/read` | Read quota data for a restricted Web route summary. |
| `model/list` | Discover models and reasoning efforts; cap pagination at 100 pages. |
| `thread/start` | Open a new thread, optionally registering tools supplied with a persistent DSH request. |
| `turn/start` | Send user input and selected model/reasoning effort. |
| `turn/interrupt` | Attempt to interrupt an aborted turn. |

`AppServerClient` also exposes `thread/resume`, but the current adapter does not call it or persist thread IDs across a restart. [PATH: src/app-server/client.ts] [PATH: src/adapter.ts]

## Stream and server requests

The adapter handles `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`, `thread/tokenUsage/updated`, and `turn/completed`. With DSH tools present, `item/tool/call` becomes a DSH tool call. DSH runs the tool; the adapter correlates the following tool messages and responds with text content. Non-text tool-result blocks are not forwarded by the current result parser. [PATH: src/adapter.ts]

The current adapter limits tool catalogs to 128 entries, concurrent pending calls to 16 and serialized arguments to 256 KiB. It rejects changed sets of tool names after starting a thread, but does not compare full schemas on subsequent requests. The server-request timeout defaults to `requestTimeoutMs` and is cancellable; there is no independent plugin-facing tool timeout. [PATH: src/adapter.ts] [PATH: src/app-server/client.ts]

## Validation and failure

JSON-RPC responses, notifications and server requests pass runtime guards. Transport frames JSONL with an 8 MiB line limit and 64 KiB retained stderr; process termination is bounded by a 5 second default shutdown stage. Incoming failure data is redacted at protocol error boundaries. A protocol or process failure closes the client; the adapter's in-memory thread map is not recovered from DSH history. [PATH: src/app-server/validation.ts] [PATH: src/app-server/redaction.ts] [PATH: src/app-server/transport.ts] [PATH: src/adapter.ts]

Updating `@openai/codex` can change the wire contract. Review generated schemas from the pinned Codex CLI and update protocol validation and tests together; a green TypeScript build does not establish live compatibility.
