# dsh-ichuny-codex

English | [简体中文](README.md)

Use your locally authenticated Codex inside DeepSeek Harness. `@ipedia/dsh-ichuny-codex` adds Codex as the **My Codex** model provider, so conversations, model selection, and quota information are available in the DSH interface. The plugin communicates with the local `codex app-server`; it does not implement its own sign-in flow or read or store Codex credentials.

## Features

- **Use your existing ChatGPT sign-in.** Codex CLI owns authentication; the plugin reads account status and model information. This adapter requires a `chatgpt` login and does not accept API-key account mode.
- **Chat in DSH.** Stream text and reasoning output, send images and file handles, and cancel requests. Images and files require a DSH attachment service.
- **Use DSH tools.** When a DSH request includes tools, Codex can request a tool call, DSH runs it, and the adapter returns the text result. This requires a persistent DSH session and the experimental Codex app-server API.
- **Check Codex quota.** With **My Codex** selected, the Web UI can show remaining capacity in the five-hour window. Open the control for plan, weekly quota, and balance details. The plugin provides the data through its own local route.

By default, the plugin runs the native Codex executable from its pinned dependency, independently of the version of any globally installed `codex` command. It starts the child process directly, without a shell, and adds neither telemetry nor a direct OpenAI HTTP API client.

## Install

### Quick install

Install the published npm package into the DSH `web` profile:

```powershell
dsh plugin --profile web add @ipedia/dsh-ichuny-codex --ignore-scripts --workspace-root
```

Restart `dsh web` after installation, then select **My Codex** in the model selector. This command installs npm's `latest`; to pin a version, use `@ipedia/dsh-ichuny-codex@1.7.9` and add `--save-exact`.

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

**Restart the DSH profile** after installation, then select **My Codex** in the model selector. The bundle patch entry is `llm-codex`; the provider ID is `my-codex`. Refreshing the browser does not reload the host plugin.

### Requirements

- Node.js 22.19 or newer. The peer contract supports DSH `0.2.2-rc.1` and `0.2.2-rc.3`. Both dependency graphs passed typechecking, the remaining tests, and build, and the rc.3 host received an actual **My Codex** reply after installation. The Zod version pinned by the rc.1 host has a high-severity advisory, so upgrade to rc.3 when possible.
- Keep optional dependencies enabled so that `@openai/codex@0.169.0` installs its native executable for your platform.
- Sign in to Codex CLI with ChatGPT as the same OS user who runs DSH. Check with `codex login status`. A global CLI can check sign-in status, but its version does not determine the bundled executable version.

If the Codex platform package is missing, reinstall with optional dependencies enabled or set `command` to the absolute path of a native Codex executable. Do not supply a shell command or a `.cmd`/`.ps1` wrapper.

## Use and configuration

The plugin accepts these fields through DSH plugin configuration:

| Field | Default | Purpose |
| --- | --- | --- |
| `command` | `bundled` | Use the bundled native Codex executable or specify a native executable path |
| `cwd` | Current working directory | Working directory for Codex threads |
| `sandbox` | `workspace-write` | Codex sandbox: `read-only`, `workspace-write`, or `danger-full-access` |
| `approvalPolicy` | `untrusted` | Codex approval policy: `never`, `on-request`, or `untrusted` |
| `requestTimeoutMs` | `30000` | Per-request app-server timeout, from 1,000 to 300,000 ms |

Text requests do not need an attachment service. Images are read from DSH attachments and sent as data URLs. Files are passed as read-only path descriptions; the plugin does not directly open arbitrary files. DSH executes dynamic tools. The adapter accepts text-only tool results, with a 4 MiB UTF-8 limit for the whole batch; duplicate, missing, oversized, or non-text results reject the pending batch. Codex threads exist only in plugin process memory and are not automatically restored after a restart.

The Web quota control appears only when `my-codex` is selected. `/api/dsh-ichuny-codex/rate-limits` returns selected quota fields; successful responses omit account IDs. Error messages are scrubbed for credential-like values, but review access control before deploying on an untrusted host. The control is hidden when quota information is unavailable.

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

`npm test` runs all 12 remaining spec files selected in [vitest.config.ts](vitest.config.ts), including adapter, dynamic-tool, and Cordis composition tests. Build, package checks, and automated tests do not replace a conversation through the target DSH host; the rc.3 **My Codex** reply was confirmed by the user. For implementation details and troubleshooting, see [Architecture](kb/reference/architecture.md), [Configuration](kb/reference/configuration.md), and [Common issues](kb/troubleshooting/common-issues.md).

Licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for license terms and upstream attribution.
