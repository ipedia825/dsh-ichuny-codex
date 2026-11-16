---
title: "SOP: Post-Release Testing"
category: procedures
service: dsh-ichuny-codex
version: "1.7.7"
tags: [sop, post-release, npm, provenance, smoke-test]
created: "2026-08-26"
last_updated: "2026-11-16"
description: "Verifies a published artifact independently of the source checkout and records live DSH and Codex behavior."
---

# Post-Release Testing

Apply these steps only after an exact version `X.Y.Z` has actually been published. This document does not assert that the current local version is published or has passed a real-client smoke test. [PATH: package.json]

## Registry and package

```bash
npm view @ipedia/dsh-ichuny-codex@X.Y.Z version dist.integrity dist.tarball
npm view @ipedia/dsh-ichuny-codex@X.Y.Z engines peerDependencies
npm view @ipedia/dsh-ichuny-codex@X.Y.Z dist.attestations dist.signatures --json
```

In a disposable environment, install the exact registry version with `--ignore-scripts` and verify its dependency signatures. Check that the tarball contains `lib/`, `client.js`, `cordis.patch.yml`, README, CHANGELOG, LICENSE and NOTICE, and excludes source, tests, KB and local settings. Record the published integrity and provenance separately from local build results. [PATH: package.json] [PATH: .npmignore]

## Isolated DSH smoke

Use a disposable DSH profile compatible with the declared peer versions. Keep Codex authentication under Codex and do not copy its credential files. Install the exact published artifact, restart that profile, and check that the patch `llm-codex` loads provider `my-codex` with display name `My Codex`. Confirm ChatGPT login, model discovery, a streamed text turn, image/file handling with an attachment store, cancellation and quota display from `/api/dsh-ichuny-codex/rate-limits`. [PATH: cordis.patch.yml] [PATH: src/adapter.ts] [PATH: src/index.ts] [PATH: client.js]

If the host supplies DSH tools, test a persistent session ID, a valid tool call and its correlated text result. The current adapter enables experimental API on every connection and has no opt-in `experimentalDynamicTools` setting. Do not claim cross-process replay: the adapter only retains threads in memory and starts a new thread after restart. [PATH: src/index.ts] [PATH: src/adapter.ts]

Record environment versions, published artifact identity, sanitized test output, failures and unexecuted checks in a dated verification record. Separate registry artifact checks from local candidate checks; avoid logging account identifiers, credential files or prompts. A failing live smoke blocks claims of end-to-end functionality. [PATH: AGENTS.md] [PATH: kb/reference/security.md]

See [release readiness](sop-release.md) and [troubleshooting](../troubleshooting/common-issues.md).
