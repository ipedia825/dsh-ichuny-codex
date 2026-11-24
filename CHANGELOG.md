# Changelog

All notable changes from 2026-11-14 onward are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-11-24

### Added

- Added independent my-codex-oauth and existing my-codex providers in the DSH Web model catalog. The ChatGPT connections settings page manages local status, official SIWC Preview sign-in, cancellation, disconnect, and a non-secret new-chat preference.
- Added a separate OAuth Codex app-server with dedicated CODEX_HOME, PKCE/OIDC/JWKS validation, bounded official endpoint requests, credential refresh/revocation, and registration-bound replay v2. The OAuth child starts only after a validated grant and never falls back to local Codex.
- Added isolated local connection status and kept five-hour/weekly quota percentages exclusive to the local provider. OAuth links to official ChatGPT Usage; the SIWC Preview does not expose a documented remaining-quota summary API.

### Fixed

- Recover closed OAuth app-server generations, resume same-account threads after child replacement, reject changed accounts, stop a waiting turn when its transport closes, and close the OAuth child before revoking its credential.
- Keep returning SIWC sign-in bound to the verified account, replace revoked tokens with a non-secret marker, and guard refresh/authorization races.
- Mount the authenticated OAuth Remote namespace without external browser modules; preserve the browser click gesture for authorization and provide a link when popup blocking occurs.

### Compatibility and verification

- Require DSH 0.2.2-rc.5 credentials, authorization and Typert seams; remove rc.1/rc.3 compatibility claims and their obsolete release gates.
- Automated suite, DSH composition, build, security audit and packaging gates pass. The user verified OAuth authorization, model selection and one text conversation on an isolated rc.5 profile. A local real-client smoke verified model discovery, streamed reply and quota using a reviewed native Codex executable; the bundled Windows binary still encounters arg0/SQLite access errors on that host. OAuth image/tool/cancellation/refresh/disconnect paths have not each passed a real-client smoke.

## [1.7.15] - 2026-11-22

### Changed

- Added DSH `0.2.2-rc.5` to the supported peer contract and updated the development dependency graph to rc.5.
- Added `npm run smoke:live` to verify the bundled Codex app server, ChatGPT login, model discovery, a streamed text reply and quota retrieval without reading credential files.
- Updated the release compatibility gates to exercise both older declared DSH peers, `0.2.2-rc.1` and `0.2.2-rc.3`, instead of the obsolete `0.1.1-rc.2` graph.

### Fixed

- Ground Codex `run_code` instructions in the effective session thread directory and require an actual tool failure before claiming that a workspace is unwritable.
- Isolate DSH compaction and other auxiliary-purpose model calls from the main Codex thread, preventing compaction from consuming pending tool results and triggering a follow-on `EMPTY_INPUT` failure.
- Use each DSH session's effective working directory for Codex threads by default, including later working-directory changes; explicit `cwd` configuration still overrides it.
- Keep DSH time/skill/runtime context before the latest human task in Codex input, and remind Codex to try the exposed `run_code` tool before claiming tool failures.
- Reject a resumed Codex thread with a different ID instead of silently losing the prior task context.
- Keep a failed Codex turn's user input eligible for retry; the cursor advances only after successful completion.
- Allow tool-catalog or system-instructions updates without a new user message to continue with a bounded instruction, while preserving rejection of truly duplicate empty requests.

### Documentation

- Documented the DSH rc.5 host requirement for Node.js 24.9 or newer while retaining Node.js 22.19 support for the plugin and older declared hosts.

## [1.7.14] - 2026-11-19

### Security

- Updated the development-only ESLint dependency to 10.15.0. The full dependency audit still reports moderate-severity findings in the upstream development-tool chain; production-only dependency audit reports no findings. No runtime or DSH peer dependency changed.

### Fixed

- Stop replaying historical system and assistant text as Codex user input; subsequent turns send only new DSH user-role messages after the acknowledged message cursor.
- Store non-secret Codex thread and cursor metadata in successful replies so an adapter reload can resume the same thread when DSH history retains it. Refuse to guess when compaction removes the cursor and safe assistant boundary.

## [1.7.13] - 2026-11-18

### Fixed

- Forward mixed text and stored WebP/PNG image results from DSH tools such as `read_image` as Codex `inputText` and `inputImage` items.
- Enforce an eight-image and 4 MiB aggregate encoded result cap before answering any pending dynamic tool requests; fail clearly when the DSH attachment store is unavailable.

## [1.7.12] - 2026-11-18

### Fixed

- Expose all pending Codex dynamic tool calls received in the current batch, rather than only the first call.
- Require DSH results only for tool calls emitted in the preceding step; later arrivals remain pending until a following step. Missing results for exposed calls still interrupt the turn.
- Apply the 16-call limit to concurrent unanswered calls rather than already answered calls.

## [1.7.11] - 2026-11-17

### Fixed

- Refresh changed DSH tool declarations with Codex `thread/resume` between completed turns instead of failing the next request with `DYNAMIC_TOOL_SCHEMA_DRIFT`; a pending DSH tool call keeps its original catalog until it is answered.
- Compare normalized full tool schemas while rejecting duplicate names, so harmless JSON key reordering does not restart a thread.

## [1.7.10] - 2026-11-17

### Fixed

- Removed the required `@deepseek-ai/dsh-host-webserver` peer: WebServer is provided by the DSH host and injected optionally, so profile-level pnpm installs must not report it as a missing plugin peer. The package remains a development-only type dependency.

## [1.7.9] - 2026-11-17

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
