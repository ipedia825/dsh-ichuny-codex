---
title: "dsh-ichuny-codex Common Issues"
category: troubleshooting
service: dsh-ichuny-codex
version: "1.7.14"
tags: [troubleshooting, codex, authentication, dsh, tools, attachments]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Diagnoses current installation, authentication, model, attachment, tool and quota failures."
---

# Common Issues

## Build or verification fails

Use Node.js 22.19 or newer. Install the reviewed dependency graph with `npm ci --ignore-scripts --legacy-peer-deps`, then run `npm run verify`, `npm run typecheck`, `npm test`, `npm run build` and `npm run package:check`. If the required-file check reports a `LICENSE` checksum mismatch, review the source license before changing either the file or the pinned hash. The configured test command runs all remaining spec files in `tests/`, but it does not replace a live DSH host smoke test. [PATH: package.json] [PATH: vitest.config.ts] [PATH: scripts/verify-required-files.mjs]

## Bundled Codex executable is missing

The default `command: bundled` resolves `@openai/codex` and its optional platform-specific package from the plugin installation. Reinstall with optional dependencies enabled, or set `command` to a native executable path. Changing the global `codex` command does not upgrade the plugin's pinned CLI. Do not pass a shell command, `.cmd` wrapper or token value as `command`. [PATH: src/codex-command.ts] [PATH: src/app-server/transport.ts]

## Codex login is rejected

The adapter requires an authenticated `chatgpt` account and returns `AUTH` otherwise. Run `codex login status` as the OS user running DSH; complete login through Codex itself if needed. Never read, copy or edit Codex auth files through this plugin. [PATH: src/adapter.ts]

## Model list is empty or provider is missing

Confirm the patch loads `llm-codex`, the adapter registers `my-codex`, and the host has a compatible DSH `llm` service. The ordinary model listing filters hidden models and requires a valid ChatGPT login; inspect sanitized app-server validation errors when `model/list` fails. Do not look for provider `codex`, which is not the ID registered by this build. [PATH: cordis.patch.yml] [PATH: src/index.ts] [PATH: src/adapter.ts]

## Images or files fail

Text requests can run without `attachments`. Image and file blocks require the optional DSH attachment store; otherwise the adapter returns `UNSUPPORTED_CONTENT`. Images are converted to bounded request bytes and sent as data URLs. Files are sent as a read-only path description; the adapter does not read arbitrary file content. [PATH: src/adapter.ts]

## Dynamic tool calls stop

Tools require a persistent DSH `sessionId`. A catalog above 128 entries, more than 16 pending calls, duplicate or invalid names, or arguments above 256 KiB are rejected. The adapter forwards text and stored image tool-result blocks. A DSH image without an available attachment store fails with `DYNAMIC_TOOL_IMAGE_UNAVAILABLE`; unsupported audio or other blocks are still rejected. If the next completed turn has different tools, the adapter validates the entire catalog and uses Codex `thread/resume` to refresh it, including an initially empty catalog. Only tool calls actually emitted in a DSH step require results in the next continuation. Codex calls arriving afterward are exposed in the following step; a missing result for an exposed call remains fatal. If `DYNAMIC_TOOL_RESULT_MISSING` persists, inspect the archived assistant tool-call IDs and corresponding tool/result IDs before changing a session. If `thread/resume` itself fails, check the app-server error and pinned Codex CLI version. After a plugin restart, successful replies from this version may restore their Codex thread via adapter replay metadata; older replies without metadata start a fresh thread. `SESSION_CURSOR_MISSING` means compaction removed the last sent user message and no safe matching assistant boundary remains: do not resend the whole retained history blindly. [PATH: src/adapter.ts] [PATH: src/app-server/client.ts]

## Quota display is absent

The Web client shows the quota control only while a model from `my-codex` is selected and the optional web-server route returns an available snapshot. Check `/api/dsh-ichuny-codex/rate-limits` through the host and ensure the client plugin was loaded after restarting the DSH profile. Error messages are redacted for credential-like values but the route relies on the host for access control. [PATH: client.js] [PATH: src/index.ts]

See [architecture](../reference/architecture.md), [configuration](../reference/configuration.md) and [security](../reference/security.md).
