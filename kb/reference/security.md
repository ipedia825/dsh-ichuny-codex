---
title: "dsh-ichuny-codex Security Model"
category: reference
service: dsh-ichuny-codex
version: "1.7.7"
tags: [security, credentials, subprocess, json-rpc, tools]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Defines the actual credential, process, tool and quota-route trust boundaries."
---

# Security Model

## Credentials and process

Codex owns login, token refresh, credential storage and its built-in tools. The adapter asks `account/read` for status and requires authenticated `chatgpt` mode; it neither reads Codex credential files nor implements OAuth or an API-key fallback. The pinned native Codex executable starts directly, with fixed `app-server --listen stdio://` arguments, `shell: false`, and the explicit environment allowlist in `src/index.ts`. [PATH: src/adapter.ts] [PATH: src/codex-command.ts] [PATH: src/app-server/transport.ts] [PATH: src/index.ts]

Only `APPDATA`, `CODEX_HOME`, `HOME`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `SYSTEMROOT`, `TEMP`, `TMP`, `USERPROFILE`, `WINDIR`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and `LC_*` pass to the child. Do not assume arbitrary project, cloud, certificate or telemetry variables propagate. [PATH: src/index.ts]

## Protocol and attachments

Untrusted app-server JSONL is framed and runtime-validated before use. The transport bounds lines to 8 MiB and retained stderr to 64 KiB by default; shutdown is time-bounded. Credential-like values are redacted from protocol errors. User image bytes come only from the optional DSH attachment store and are sent as data URLs; files are represented as read-only path descriptions, not opened by the adapter. [PATH: src/app-server/transport.ts] [PATH: src/app-server/validation.ts] [PATH: src/app-server/redaction.ts] [PATH: src/adapter.ts]

## DSH tools and approvals

The app-server connection enables its experimental API. Tools are offered when DSH supplies them on a request with `sessionId`; there is no plugin-level opt-in switch. The adapter does not run DSH tools itself: it emits tool-call stream blocks and returns correlated text results after DSH executes them. Current limits cover 128 tool definitions, 16 pending calls, 256 KiB serialized arguments, 256-byte UTF-8 call IDs and 4 MiB aggregate UTF-8 text results. Duplicate or pre-aborted incoming calls are rejected before registration. Duplicate, missing, oversized and non-text results fail the batch before any pending call is answered; failures reject pending requests and interrupt the turn. The catalog check still does not establish a full schema fingerprint. Configure Codex sandbox and approval policy explicitly for the intended host; the separate `resolveSessionPermissions` helper is not applied by the current plugin entry. [PATH: src/index.ts] [PATH: src/adapter.ts] [PATH: src/session-permissions.ts]

Threads live only in an in-process map. A restart loses their state; no replay-state parser or automatic `thread/resume` path runs in the adapter. [PATH: src/adapter.ts]

## Web quota route

The optional Web route exposes only selected quota fields on successful requests and does not include account IDs in that success response. Error responses pass through `safeErrorMessage` to remove credential-like values; this is not an authorization boundary. Review host access control before exposing the route to untrusted clients. [PATH: src/index.ts] [PATH: client.js]

## Verification limits

The default Vitest configuration selects every remaining spec file in `tests/`, including adapter, dynamic-tool, Cordis composition and app-server protocol coverage. Build and package checks do not prove live DSH composition, approval behavior or authenticated Codex turns. Run a real-client smoke test before making an end-to-end release claim. [PATH: vitest.config.ts] [PATH: package.json]

See [architecture](architecture.md), [protocol](app-server-protocol.md) and [configuration](configuration.md).
