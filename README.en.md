# dsh-ichuny-codex

English | [简体中文](README.md)

`@ipedia/dsh-ichuny-codex` offers two independent ChatGPT connections in DeepSeek Harness: **ChatGPT (Local)** uses the current OS user's Codex CLI sign-in, while **ChatGPT (OAuth Preview)** uses official Sign in with ChatGPT and a separate Codex app-server. Both providers can coexist; changing the new-chat preference does not switch existing sessions.

## Features

- **Local connection.** Retain Codex CLI's `chatgpt` sign-in, model catalog, tools, and sandbox. The plugin never reads or copies Codex auth files and does not accept API-key account mode.
- **OAuth Preview connection.** Authorize through Settings → ChatGPT connections using official SIWC. Independent `my-codex-oauth` credentials, app-server and replay state never fall back to the local provider. Initial scope: one trusted local OS user and one OAuth account.
- **Conversation and DSH tools.** Both connections use app-server for streamed text/reasoning, image and file inputs, cancellation, and DSH tool responses. Attachments require the DSH attachment service; dynamic tools require a persistent session and the experimental app-server API. OAuth does not claim parity with local Codex sandboxing, built-in tools, or hosted tools.
- **Connection management.** Settings shows local state and model count, with recheck; the OAuth tab offers sign-in, cancellation, disconnect and an official Usage link. The non-secret preference guides new chats only; OAuth cannot be preferred until connected.
- **Usage boundary.** Composer percentages, five-hour/weekly limits and credits apply only to `my-codex`. Official SIWC Preview has no published remaining-quota summary API: OAuth links to ChatGPT Usage and surfaces request errors when a usage limit is reached, without inventing a percentage.

By default the plugin runs the pinned native Codex executable. Both app-servers start directly without a shell. Only SIWC authorization calls documented `auth.openai.com` endpoints, and the OAuth child targets public `api.openai.com/v1`; there is no telemetry, private ChatGPT backend, or API-key fallback.

## Install

### Quick install

Install the published npm package into the DSH `web` profile:

```powershell
dsh plugin --profile web add @ipedia/dsh-ichuny-codex --ignore-scripts --workspace-root
```

Restart `dsh web` after installation. Choose **ChatGPT（本地）** directly, or authorize in Settings → ChatGPT connections before choosing **ChatGPT（OAuth Preview）**. The command installs npm's `latest`; after `1.8.0` appears on the registry, pin `@ipedia/dsh-ichuny-codex@1.8.0` with `--save-exact`.

### Install from source

GitHub does not contain the generated `lib/` directory. Build and pack the source before installing it; do not use the repository URL as if it were a built plugin. For Windows PowerShell:

```powershell
git clone https://github.com/ipedia825/dsh-ichuny-codex.git
cd dsh-ichuny-codex
npm ci --ignore-scripts --legacy-peer-deps
npm run verify
npm run build
$plugin = npm pack --ignore-scripts --silent
dsh plugin --profile web add "file:$((Get-Location).Path)\$plugin" --save-exact --ignore-scripts --workspace-root
```

**Restart the DSH profile** after installation. The patch contains `llm-codex` and an independent OAuth controller; provider IDs are `my-codex` and `my-codex-oauth`. Refreshing the browser does not reload the Host plugin.

### Requirements

- Node.js 22.19 or newer. This version requires the credentials, authorization and Typert seams from DSH `0.2.2-rc.5`; the rc.5 Host requires Node.js 24.9 or newer. Older rc.1/rc.3 profiles are outside this version's compatibility contract.
- Keep optional dependencies enabled so that `@openai/codex@0.169.0` installs its native executable for your platform.
- For the local connection, sign in to Codex CLI with ChatGPT as the OS user running DSH (`codex login status`). OAuth is authorized independently in Settings and does not reuse CLI credentials.

If the Codex platform package is missing, reinstall with optional dependencies enabled or set `command` to the absolute path of a native Codex executable. Do not supply a shell command or a `.cmd`/`.ps1` wrapper.

## Use and configuration

The plugin accepts these fields through DSH plugin configuration:

| Field | Default | Purpose |
| --- | --- | --- |
| `command` | `bundled` | Use the bundled native Codex executable or specify a native executable path |
| `cwd` | Active DSH session directory, falling back to host launch cwd when unavailable | Codex thread directory; an explicit setting overrides the DSH session directory |
| `sandbox` | `workspace-write` | Codex sandbox: `read-only`, `workspace-write`, or `danger-full-access` |
| `approvalPolicy` | `untrusted` | Codex approval policy: `never`, `on-request`, or `untrusted` |
| `requestTimeoutMs` | `30000` | Per-request app-server timeout, from 1,000 to 300,000 ms |
| `preferredConnection` | `local` | Non-secret volatile new-chat preference: `local` or `oauth`; existing sessions do not switch |

Text requests do not need an attachment service. Images are read from DSH attachments and sent as data URLs. Files are passed as read-only path descriptions; the plugin does not directly open arbitrary files. DSH executes dynamic tools. The adapter accepts text and stored image tool results such as `read_image`, forwarding them as Codex `inputText` and `inputImage`; the combined encoded batch is capped at 4 MiB UTF-8. Concurrent calls already received by Codex are exposed together; later calls are emitted on a subsequent step. Only calls exposed to DSH are required in the current continuation. Duplicate, missing exposed, oversized, or unsupported non-text/non-image results reject the pending batch. Between completed turns, changed DSH tool declarations are applied using Codex `thread/resume`, including a previously empty catalog or changed schemas. While a tool result is pending, the original catalog remains in force until that turn completes. Within one DSH session the adapter reuses its Codex thread. Only a successfully completed turn advances the input cursor, so a failed turn can retry the same user message. Subsequent turns send only new user-role messages; a tool-catalog-only or system-instructions-only update sends one bounded continuation without replaying the historical input. DSH `purpose: compaction` calls use a separate read-only ephemeral Codex thread even when they carry the same DSH session ID; they register no DSH dynamic tools and never consume main-thread pending results or update its input cursor. A fully repeated ordinary request with no new work is still rejected as `EMPTY_INPUT`. On a new thread the leading system prompt becomes Codex base instructions. A successful reply persists the non-secret thread ID and cursor in DSH replay metadata so the plugin can attempt `thread/resume` after a restart. Older replies have no replay state; if both the cursor and a safe model boundary disappear during compaction, the adapter refuses to guess, and a failed resume is not silently replaced with a new thread.

DSH-injected time, skill, and runtime context is placed before the human request in the Codex turn. When `run_code` is available, the thread receives a reminder to try it before claiming tool failure; the adapter cannot force the model to invoke tools, so verify work through actual tool calls and file changes. A resume returning a different thread ID fails with `SESSION_THREAD_MISMATCH` rather than silently losing the prior development task.

The Web quota percentage appears only for `my-codex`. `/api/dsh-ichuny-codex/rate-limits` and `/api/dsh-ichuny-codex/connection-status` expose redacted local-only fields, never OAuth remaining quota. Open official ChatGPT Usage from OAuth settings. Remote and multi-user Web deployments are not supported.

## Development and verification

```powershell
npm run verify
npm run typecheck
npm run lint
npm test
npm run build
npm run audit
npm run audit:permissions
npm run package:check
```

`npm test` collects all specs from [vitest.config.ts](vitest.config.ts), covering both providers, SIWC, dynamic tools and Cordis composition. Live evidence includes local model/stream/quota checks and an isolated rc.5 profile's OAuth authorization, model selection and one text conversation. OAuth image/tool/cancellation/refresh/disconnect paths are covered by automated tests but have not each passed a real-client check; do not claim full end-to-end parity. For implementation details and troubleshooting, see [Architecture](kb/reference/architecture.md), [Configuration](kb/reference/configuration.md), and [Common issues](kb/troubleshooting/common-issues.md).

Licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for license terms and upstream attribution.
