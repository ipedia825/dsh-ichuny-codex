---
title: "SOP: Local Development Verification"
category: procedures
service: dsh-ichuny-codex
version: "1.7.7"
tags: [sop, pre-commit, testing, security, packaging]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Checks the current source, selected tests, KB, security scan and local npm artifact before changes are shared."
---

# Local Development Verification

## Scope

The working copy may have no `.git` directory. Do not require `git status`, commit hooks or a clean Git tree to build or inspect this local copy. Keep user files, Codex state, `node_modules` and generated `lib/` distinct from editable source. [PATH: package.json] [PATH: tsconfig.build.json]

## Checks

```bash
npm ci --ignore-scripts --legacy-peer-deps
npm run verify
npm run typecheck
npm run lint
npm test
npm run build
npm run audit
npm run audit:permissions
npm run package:check
```

`verify` checks required files, version sync and KB frontmatter. Its `LICENSE` checksum must continue to match the reviewed Apache-2.0 license. `npm test` runs only `core`, `attachments` and `quota-client` tests selected in `vitest.config.ts`; it does not establish coverage of the remaining test files. Run additional applicable tests and an isolated DSH composition/live-client smoke before making compatibility claims. [PATH: package.json] [PATH: scripts/verify-required-files.mjs] [PATH: vitest.config.ts] [PATH: AGENTS.md]

Review `npm pack --dry-run --ignore-scripts` for `lib/`, `client.js`, `cordis.patch.yml`, README, CHANGELOG, LICENSE and NOTICE, and ensure source, tests, KB and credentials do not ship. Audit and dependency/signature checks are separate supply-chain gates; they may require registry access. Do not commit or publish an artifact with known failing required gates. [PATH: package.json] [PATH: .npmignore]

For protocol or configuration changes, update unit and integration tests and the relevant KB references together. The current adapter uses provider `my-codex`, an experimental app-server connection and in-memory thread state. Do not restore claims from the superseded decision records without source and real-client verification. [PATH: src/index.ts] [PATH: src/adapter.ts]

See [source setup](../howto/setup.md), [architecture](../reference/architecture.md) and [release readiness](sop-release.md).
