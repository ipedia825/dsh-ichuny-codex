---
title: "Set Up dsh-ichuny-codex from Source"
category: howto
service: dsh-ichuny-codex
version: "1.8.0"
tags: [setup, source, codex, dsh, authentication]
created: "2026-08-26"
last_updated: "2026-11-24"
description: "Builds the current plugin and checks the local package before isolated DSH installation."
---

# Source Setup

## Prerequisites

- Node.js 22.19 or newer and npm compatible with the lockfile.
- DSH 0.2.2-rc.5: the OAuth provider requires its credentials, authorization and Typert seams. This version does not claim rc.1/rc.3 compatibility. The plugin needs Node.js 22.19 or newer; the rc.5 Host needs Node.js 24.9 or newer. [PATH: package.json]
- Codex CLI already authenticated as the same OS user who will run DSH. Use `codex login status` to check it; do not copy or inspect credential files.
- Optional platform dependencies enabled when installing this package. The default plugin command uses the pinned native `@openai/codex` executable from its dependency tree, not the globally installed CLI. [PATH: src/codex-command.ts]

## Develop and package

In the project root on Windows:

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm run verify
npm run typecheck
npm run lint
npm test
npm run build
npm run package:check
```

`npm run verify` checks the required files, version synchronization and KB metadata. Its pinned `LICENSE` checksum matches the reviewed local Apache-2.0 text. `npm test` runs all remaining spec files listed in `vitest.config.ts`. Build produces `lib/` from `src/`; do not hand-edit it. [PATH: package.json] [PATH: scripts/verify-required-files.mjs] [PATH: vitest.config.ts] [PATH: tsconfig.build.json]

For a disposable local artifact after reviewing the package contents:

```powershell
$plugin = npm pack --ignore-scripts --silent
dsh plugin --profile web add "file:$((Get-Location).Path)\$plugin" --save-exact --ignore-scripts --workspace-root
```

The package must include `client.js`, `cordis.patch.yml`, `lib/`, README, CHANGELOG, LICENSE and NOTICE. The patch loads `llm-codex` plus the independent OAuth controller. Provider IDs are `my-codex` (`ChatGPT（本地）`) and `my-codex-oauth` (`ChatGPT（OAuth Preview）`). Connect OAuth from Settings → ChatGPT connections before selecting its model; local Codex credentials remain separate. Restart the target DSH profile after installing the plugin; an existing browser page alone does not reload a host plugin. [PATH: package.json] [PATH: cordis.patch.yml] [PATH: src/adapter.ts]

An isolated DSH composition and a real authenticated Codex request are separate smoke checks. Run `npm run smoke:live` as the same authenticated OS user to exercise Codex app-server, model discovery, streaming and quota retrieval without reading credential files. It uses the bundled executable by default; for a diagnosed bundled-binary startup problem, set `CODEX_SMOKE_COMMAND` to a reviewed native Codex executable path for the smoke only. It still does not replace an isolated rc.5 Web profile check for provider registration, attachments and cancellation. Preserve the user's existing Codex login and regular DSH profile. [PATH: scripts/live-smoke.mjs] [PATH: AGENTS.md]

See [configuration](../reference/configuration.md) and [common issues](../troubleshooting/common-issues.md).
