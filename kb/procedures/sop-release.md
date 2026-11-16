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

This copy now has a Git work tree once cloned, but it has no `.github/workflows/publish.yml`, which is required by `scripts/release.sh`. The changelog currently has no dated release entries after the retained history cutoff. Do not run the release script, create a tag, push a release tag or publish until the publication workflow and every release gate are reviewed. [PATH: scripts/release.sh] [PATH: CHANGELOG.md]

## Prepare a candidate

1. Confirm the manifest name `@ipedia/dsh-ichuny-codex`, the GitHub target `ipedia825/dsh-ichuny-codex` and the version fields in `package.json`, `package-lock.json` and `src/app-server/client.ts`. The plugin export is named `dsh-ichuny-codex`; its provider ID is `my-codex`. [PATH: package.json] [PATH: scripts/release.sh] [PATH: src/index.ts] [PATH: src/adapter.ts]
2. Review source, dependencies, `LICENSE` and NOTICE. Fix the required-file gate only after reviewing the actual license; add dated notes for the candidate version without restoring discarded old history. [PATH: scripts/verify-required-files.mjs] [PATH: CHANGELOG.md]
3. Run the local development checks and the applicable coverage, dependency and signature audits. The default tests include only three files; use a real DSH composition and authenticated Codex smoke to validate provider registration, model discovery, streaming, attachments, Web quota and cancellation. Do not describe those checks as passed until executed. [PATH: package.json] [PATH: vitest.config.ts] [PATH: AGENTS.md]
4. Build with `npm run build`, inspect `npm run package:check`, then test a disposable locally packed artifact. `lib/` is generated and is never edited by hand. [PATH: package.json] [PATH: tsconfig.build.json]

Only after the Git repository and a reviewed publication workflow exist should a maintainer assess whether `scripts/release.sh` matches their GitHub and npm permissions. Running it may create and push tags and publish a package; it requires separate explicit approval. [PATH: scripts/release.sh]

See [post-release verification](sop-post-release-testing.md), [local checks](sop-pre-commit.md) and [security](../reference/security.md).
