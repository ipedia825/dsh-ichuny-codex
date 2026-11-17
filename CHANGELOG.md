# Changelog

All notable changes from 2026-11-14 onward are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Declared DSH `0.2.2-rc.1` and `0.2.2-rc.3` as supported peer versions. Both dependency graphs pass the configured tests, typecheck and build; the rc.3 host still needs a live-client smoke test.
- Updated the development dependency graph to rc.3 and repaired the lockfile to match the official `esquery` package version.
- Identified `ipedia` as the current package author while retaining upstream attribution in NOTICE.

### Security

- Redacted credential-like values from quota-route error responses.
- Bounded dynamic tool result batches to 4 MiB of UTF-8 text, checked duplicate/missing/non-text results before answering Codex, and interrupted the turn on invalid batches. Tool-only continuation no longer fails the empty-input check. Duplicate, oversized or already-aborted incoming tool requests are rejected before they enter the pending map.
- Resolved high-severity findings in the rc.3 development dependency graph. The rc.1 host still pins a vulnerable Zod version; its risk remains with that host.

### Tests

- Replaced obsolete adapter, dynamic-tool and refusal-reporting tests with current adapter, dynamic-tool correlation and Cordis composition coverage, including quota success and redacted failure responses. All 12 remaining test files (118 tests) and the configured coverage gate pass.
