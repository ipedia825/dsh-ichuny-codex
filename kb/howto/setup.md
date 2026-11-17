---
title: "Set Up dsh-ichuny-codex from Source"
category: howto
service: dsh-ichuny-codex
version: "1.7.7"
tags: [setup, source, codex, dsh, authentication]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Builds the current plugin and checks the local package before isolated DSH installation."
---

# Source Setup

## Prerequisites

- Node.js 22.19 or newer and npm compatible with the lockfile.
- DSH 0.2.2-rc.1 or 0.2.2-rc.3 per the declared peer contract. Both graphs pass project checks; only the rc.1 host has a user-reported live conversation so far. Its pinned Zod version has a high-severity advisory; prefer rc.3 and verify a live client there before release.
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

The package must include `client.js`, `cordis.patch.yml`, `lib/`, README, CHANGELOG, LICENSE and NOTICE. The patch loads `llm-codex`; the actual provider ID is `my-codex` and its display name is `My Codex`. Restart the target DSH profile after installing the plugin; an existing browser page alone does not reload a host plugin. [PATH: package.json] [PATH: cordis.patch.yml] [PATH: src/adapter.ts]

An isolated DSH composition and a real authenticated Codex request are separate smoke checks. Do not claim end-to-end operation from `npm test`, `npm run build` or `npm pack` alone. Preserve the user's existing Codex login and regular DSH profile. [PATH: AGENTS.md]

See [configuration](../reference/configuration.md) and [common issues](../troubleshooting/common-issues.md).
