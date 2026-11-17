---
title: "SOP: Release Readiness"
category: procedures
service: dsh-ichuny-codex
version: "1.7.7"
tags: [sop, release, npm, provenance, packaging]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Lists current local release blockers and the checks required before enabling publication."
---

# Release Readiness

## Current status

This copy is not ready for `npm run release`. A candidate `.github/workflows/publish.yml` exists locally but has not been committed or pushed. This Windows host lacks Bash, Docker and the GitHub CLI required by `scripts/release.sh`; its npm version also differs from the pinned release-script requirement. The configured suite runs all remaining spec files and its coverage gate passes. The rc.3 development graph passes the high-severity audit, while the supported rc.1 host still pins a Zod version with a high-severity advisory. The user reports a successful installed rc.1 DSH conversation; the rc.3 host has no real-client smoke result, and a bundled app-server smoke in this agent environment could not open its local state database. The changelog contains only Unreleased notes. Do not tag, push a release tag or publish until the rc.3 smoke, publisher credentials/trusted-publishing setup and all release gates are confirmed. [PATH: scripts/release.sh] [PATH: .github/workflows/publish.yml] [PATH: vitest.config.ts] [PATH: package.json] [PATH: CHANGELOG.md]

## Prepare a candidate

1. Confirm the manifest name `@ipedia/dsh-ichuny-codex`, the GitHub target `ipedia825/dsh-ichuny-codex` and the version fields in `package.json`, `package-lock.json` and `src/app-server/client.ts`. The plugin export is named `dsh-ichuny-codex`; its provider ID is `my-codex`. [PATH: package.json] [PATH: scripts/release.sh] [PATH: src/index.ts] [PATH: src/adapter.ts]
2. Review source, dependencies, `LICENSE` and NOTICE. Keep the required-file checksum synchronized only after reviewing the actual license; add dated notes for the candidate version without restoring discarded old history. [PATH: scripts/verify-required-files.mjs] [PATH: CHANGELOG.md]
3. Run the local development checks and the applicable coverage, dependency and signature audits. The configured suite runs all remaining spec files, including adapter, dynamic-tool, Cordis composition and app-server protocol tests; use an isolated DSH host and authenticated Codex smoke to validate provider registration, model discovery, streaming, attachments, Web quota and cancellation. Do not describe those checks as passed until executed. [PATH: package.json] [PATH: vitest.config.ts] [PATH: AGENTS.md]
4. Build with `npm run build`, inspect `npm run package:check`, then test a disposable locally packed artifact. `lib/` is generated and is never edited by hand. [PATH: package.json] [PATH: tsconfig.build.json]

Only after the Git repository and a reviewed publication workflow exist should a maintainer assess whether `scripts/release.sh` matches their GitHub and npm permissions. Running it may create and push tags and publish a package; it requires separate explicit approval. [PATH: scripts/release.sh]

See [post-release verification](sop-post-release-testing.md), [local checks](sop-pre-commit.md) and [security](../reference/security.md).
