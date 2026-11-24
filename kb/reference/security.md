---
title: "dsh-ichuny-codex Security Model"
category: reference
service: dsh-ichuny-codex
version: "1.8.0"
tags: [security, credentials, subprocess, json-rpc, tools]
created: "2026-08-26"
last_updated: "2026-11-24"
description: "Defines the actual credential, process, tool and quota-route trust boundaries."
---

# Security Model

## Credentials and process

For the implemented local `my-codex` provider, Codex owns login, token refresh, credential storage and its built-in tools. The adapter asks `account/read` for status and requires authenticated `chatgpt` mode; it never reads Codex credential files and has no API-key fallback. The pinned native Codex executable starts directly, with fixed `app-server --listen stdio://` arguments, `shell: false`, and the explicit environment allowlist in `src/index.ts`. [PATH: src/adapter.ts] [PATH: src/codex-command.ts] [PATH: src/app-server/transport.ts] [PATH: src/index.ts]

Only `APPDATA`, `CODEX_HOME`, `HOME`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `SYSTEMROOT`, `TEMP`, `TMP`, `USERPROFILE`, `WINDIR`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and `LC_*` pass to the child. Do not assume arbitrary project, cloud, certificate or telemetry variables propagate. [PATH: src/index.ts]

## Protocol and attachments

Untrusted app-server JSONL is framed and runtime-validated before use. The transport bounds lines to 8 MiB and retained stderr to 64 KiB by default; shutdown is time-bounded. Credential-like values are redacted from protocol errors. User image bytes come only from the optional DSH attachment store and are sent as data URLs; files are represented as read-only path descriptions, not opened by the adapter. [PATH: src/app-server/transport.ts] [PATH: src/app-server/validation.ts] [PATH: src/app-server/redaction.ts] [PATH: src/adapter.ts]

## DSH tools and approvals

The app-server connection enables its experimental API. Tools are offered when DSH supplies them on a request with `sessionId`; there is no plugin-level opt-in switch. The adapter does not run DSH tools itself: it emits tool-call stream blocks and returns correlated text and stored image results after DSH executes them. Tool images are read only through the optional DSH attachment store. Current limits cover 128 tool definitions, 16 unanswered calls, 256 KiB serialized arguments, 256-byte UTF-8 call IDs, eight tool-result images and 4 MiB aggregate encoded UTF-8 results. Duplicate or pre-aborted incoming calls are rejected before registration. Duplicate, missing, oversized and unsupported blocks fail the batch before any pending call is answered; failures reject pending requests and interrupt the turn. Tool catalogs are compared with a canonical full-schema fingerprint between completed turns and refreshed with `thread/resume` when needed. Configure Codex sandbox and approval policy explicitly for the intended host; the separate `resolveSessionPermissions` helper is not applied by the current plugin entry. [PATH: src/index.ts] [PATH: src/adapter.ts] [PATH: src/session-permissions.ts]

Successful assistant replies persist only the Codex thread ID and last consumed DSH user message ID in adapter-private replay metadata, not credentials or user text. A fresh adapter may resume that thread; older replies without metadata cannot be recovered, and an invalid replay or missing safe cursor fails closed. Pending tool calls remain in-memory and cannot be resumed across a restart. [PATH: src/adapter.ts]

## Web quota route

The optional Web route exposes only selected quota fields on successful requests and does not include account IDs in that success response. Error responses pass through `safeErrorMessage` to remove credential-like values; this is not an authorization boundary. Review host access control before exposing the route to untrusted clients. [PATH: src/index.ts] [PATH: client.js]

## Verification limits

The default Vitest configuration selects every remaining spec file in `tests/`, including adapter, dynamic-tool, Cordis composition and app-server protocol coverage. Build and package checks do not prove live DSH composition, approval behavior or authenticated Codex turns. Run a real-client smoke test before making an end-to-end release claim. [PATH: vitest.config.ts] [PATH: package.json]

## Approved OAuth boundary

The repository permits one narrow plugin-owned OAuth path: OpenAI's official Sign in with ChatGPT open-source Preview, limited to one trusted local OS user and independent provider `my-codex-oauth` running through a separately configured Codex app-server. Allowed network surfaces are the documented `auth.openai.com` authorization, token, JWKS and revocation endpoints plus public `api.openai.com/v1/models` and `/v1/responses`; allowed scopes are `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Dynamic client registration, PKCE, OIDC validation, exact loopback redirects, DSH credential records, serialized rotating-token refresh and remote revocation are required. The local credential provider enforces owner-only POSIX modes and atomic replacement; on Windows it does not verify equivalent ACL ownership, so the supported deployment remains one trusted local OS user.

Private ChatGPT `backend-api` endpoints, copied/fixed third-party client IDs, undocumented scopes/endpoints, API-key fallback, credential logging, browser/config token storage and cross-provider fallback remain prohibited. OAuth credentials, process lifecycle, replay state, pending tools and cancellation must not mix with `my-codex`. Before launch, the OAuth runtime creates and verifies its dedicated `CODEX_HOME` directory; it rejects a non-directory or symbolic-link target. No Codex auth files are copied into that home. The protocol foundation, DSH authorization flow and credential lifecycle are implemented, and the settings Client uses an authenticated Typert controller for connect/status/cancel/disconnect; `my-codex-oauth` is registered with an isolated app-server runtime and replay v2 binding. Returning OAuth login requires the same verified subject. Revocation replaces tokens with a non-secret marker, so a concurrent new authorization cannot be erased by a later delete. Disconnect closes the OAuth child before revocation; child generation changes require same-account thread resume, and transport closure wakes pending turns. A real-account text turn was reported by the user, while image/tool/cancellation/refresh/disconnect live checks remain unverified. [PATH: kb/reference/chatgpt-connection-decision.md] [PATH: CHATGPT_CONNECTION_DESIGN.md]

See [architecture](architecture.md), [protocol](app-server-protocol.md) and [configuration](configuration.md).
