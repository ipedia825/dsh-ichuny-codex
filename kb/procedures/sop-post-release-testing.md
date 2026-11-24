---
title: "SOP: Post-Release Testing"
category: procedures
service: dsh-ichuny-codex
version: "1.8.0"
tags: [sop, post-release, npm, provenance, smoke-test]
created: "2026-08-26"
last_updated: "2026-11-24"
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

Use a disposable DSH profile compatible with the declared peer versions. Record whether the local smoke used the bundled executable or an explicit reviewed `CODEX_SMOKE_COMMAND`; an override verifies adapter compatibility but does not prove the bundled Windows binary starts on that host. Keep local Codex authentication under Codex and do not copy its credential files. Install the exact artifact, restart that profile, and check that the patch loads `my-codex` as `ChatGPT（本地）`, `my-codex-oauth` as `ChatGPT（OAuth Preview）`, and the separate OAuth controller row. For local, confirm ChatGPT login, model discovery, a streamed text turn, image/file handling, tools, cancellation, local connection status and quota. For OAuth, complete official SIWC in the settings page, confirm model discovery and the same supported request paths, verify replay v2 after adapter recreation, force a token refresh at a safe turn boundary, and confirm only the OAuth app-server generation restarts. Disconnect must remove the OAuth catalog, make existing OAuth sessions report authentication failure, and never route them to `my-codex`. [PATH: cordis.patch.yml] [PATH: src/adapter.ts] [PATH: src/oauth-adapter.ts] [PATH: src/siwc/app-server-runtime.ts] [PATH: src/index.ts] [PATH: client.js]

If the host supplies DSH tools, test a persistent session ID, a valid tool call and its correlated text result. The current adapter enables experimental API on every connection and has no opt-in `experimentalDynamicTools` setting. After a restart, verify that a completed turn with valid replay metadata resumes the original Codex thread; older replies without metadata and pending tool calls cannot be recovered. [PATH: src/index.ts] [PATH: src/adapter.ts]

Record environment versions, published artifact identity, sanitized test output, failures and unexecuted checks in a dated verification record. Separate registry artifact checks from local candidate checks; avoid logging account identifiers, credential files or prompts. A failing live smoke blocks claims of end-to-end functionality. [PATH: AGENTS.md] [PATH: kb/reference/security.md]

See [release readiness](sop-release.md) and [troubleshooting](../troubleshooting/common-issues.md).
