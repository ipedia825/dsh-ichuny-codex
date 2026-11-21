---
title: "SOP: Release Readiness"
category: procedures
service: dsh-ichuny-codex
version: "1.7.15"
tags: [sop, release, npm, provenance, packaging]
created: "2026-08-26"
last_updated: "2026-11-20"
description: "Lists current local release blockers and the checks required before enabling publication."
---

# Release Readiness

## Current status

The 1.7.15 candidate extends the peer contract to DSH 0.2.2-rc.5 and moves the locked development graph to rc.5. On 2026-11-20, the rc.1, rc.3 and rc.5 dependency graphs passed typecheck and all 130 tests; the rc.5 graph also passed coverage, build, source and permission audits, the high-severity dependency threshold, registry signature verification and package inspection. A locally packed artifact installed into an isolated rc.5 profile, where `llm-codex` loaded with a complete configuration schema and no composition diagnostics. Publication remains blocked because the bundled Codex app server could not open its own state database for the authenticated Windows user, so the required streamed rc.5 conversation did not run. Prior rc.3 evidence does not establish rc.5 end-to-end compatibility. [PATH: .github/workflows/publish.yml] [PATH: package.json] [PATH: scripts/live-smoke.mjs] [PATH: CHANGELOG.md]

## Prepare a candidate

1. Confirm the manifest name `@ipedia/dsh-ichuny-codex`, the GitHub target `ipedia825/dsh-ichuny-codex` and the version fields in `package.json`, `package-lock.json` and `src/app-server/client.ts`. The plugin export is named `dsh-ichuny-codex`; its provider ID is `my-codex`. [PATH: package.json] [PATH: scripts/release.sh] [PATH: src/index.ts] [PATH: src/adapter.ts]
2. Review source, dependencies, `LICENSE` and NOTICE. Keep the required-file checksum synchronized only after reviewing the actual license; add dated notes for the candidate version without restoring discarded old history. [PATH: scripts/verify-required-files.mjs] [PATH: CHANGELOG.md]
3. Run the local development checks and the applicable coverage, dependency and signature audits. The configured suite runs all remaining spec files, including adapter, dynamic-tool, Cordis composition and app-server protocol tests. Run `npm run smoke:live` as the authenticated DSH OS user to verify real Codex login, model discovery, a streamed text turn and quota retrieval; then use an isolated rc.5 DSH host to validate provider registration, attachments and cancellation. Do not describe those checks as passed until executed. [PATH: package.json] [PATH: scripts/live-smoke.mjs] [PATH: vitest.config.ts] [PATH: AGENTS.md]
4. Build with `npm run build`, inspect `npm run package:check`, then test a disposable locally packed artifact. `lib/` is generated and is never edited by hand. [PATH: package.json] [PATH: tsconfig.build.json]

Only after the Git repository and a reviewed publication workflow exist should a maintainer assess whether `scripts/release.sh` matches their GitHub and npm permissions. Running it may create and push tags and publish a package; it requires separate explicit approval. [PATH: scripts/release.sh]

See [post-release verification](sop-post-release-testing.md), [local checks](sop-pre-commit.md) and [security](../reference/security.md).
