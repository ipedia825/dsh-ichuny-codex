---
title: "SOP: Release Readiness"
category: procedures
service: dsh-ichuny-codex
version: "1.8.0"
tags: [sop, release, npm, provenance, packaging]
created: "2026-08-26"
last_updated: "2026-11-24"
description: "Lists current local release blockers and the checks required before enabling publication."
---

# Release Readiness

## Current status

The 1.8.0 candidate adds independent local and SIWC OAuth Preview providers and requires the DSH 0.2.2-rc.5 credential, authorization and Typert seams. The user completed SIWC authorization, OAuth model selection and one text conversation in an isolated rc.5 Web profile. A separate local real-client smoke using a reviewed native Codex executable passed login, model discovery, streaming and quota retrieval; the pinned bundled Windows executable still encountered arg0/SQLite access errors on this host. OAuth image/tool/cancellation/refresh/disconnect paths have automated coverage but not individual real-client smoke. Re-run all gates on the release commit before tagging. The tag-triggered workflow uses Node.js 24.9.0 and publishes with provenance. [PATH: .github/workflows/publish.yml] [PATH: package.json] [PATH: scripts/live-smoke.mjs] [PATH: CHANGELOG.md]

## Prepare a candidate

1. Confirm the manifest name `@ipedia/dsh-ichuny-codex`, the GitHub target `ipedia825/dsh-ichuny-codex` and the version fields in `package.json`, `package-lock.json` and `src/app-server/client.ts`. The plugin export is named `dsh-ichuny-codex`; provider IDs are `my-codex` and `my-codex-oauth`. [PATH: package.json] [PATH: scripts/release.sh] [PATH: src/index.ts] [PATH: src/adapter.ts]
2. Review source, dependencies, `LICENSE` and NOTICE. Keep the required-file checksum synchronized only after reviewing the actual license; add dated notes for the candidate version without restoring discarded old history. [PATH: scripts/verify-required-files.mjs] [PATH: CHANGELOG.md]
3. Run the local development checks and the applicable coverage, dependency and signature audits against DSH rc.5. The configured suite runs all remaining spec files, including adapter, dynamic-tool, Cordis composition and app-server protocol tests. Run `npm run smoke:live` as the authenticated DSH OS user to verify real Codex login, model discovery, a streamed text turn and quota retrieval; then use an isolated rc.5 DSH host to validate provider registration, attachments and cancellation. Do not describe those checks as passed until executed. [PATH: package.json] [PATH: scripts/live-smoke.mjs] [PATH: vitest.config.ts] [PATH: AGENTS.md]
4. Build with `npm run build`, inspect `npm run package:check`, then test a disposable locally packed artifact. `lib/` is generated and is never edited by hand. [PATH: package.json] [PATH: tsconfig.build.json]

The release script requires a clean `main` synchronized with `origin`, reviewed npm 11.13.0, Bash, Docker, GitHub CLI, and successful Linux/packaging checks before it creates a signed tag and pushes it. Publishing is performed by the tag-triggered GitHub Actions workflow with provenance. If any prerequisite or npm trusted-publisher authorization is missing, do not push a release tag; report the unmet condition. [PATH: scripts/release.sh] [PATH: .github/workflows/publish.yml]

See [post-release verification](sop-post-release-testing.md), [local checks](sop-pre-commit.md) and [security](../reference/security.md).
