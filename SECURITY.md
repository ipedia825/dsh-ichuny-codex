# Security Policy

## Supported versions

Security fixes target the current maintained branch and supported releases as recorded
in [CHANGELOG.md](CHANGELOG.md). A source build is not a published npm release;
verify the exact package version and its supported DSH peers before deploying.

## Reporting a vulnerability

Report vulnerabilities privately to the maintainer of [this repository](https://github.com/ipedia825/dsh-ichuny-codex). Use GitHub's private vulnerability reporting when available; do not open a public issue containing sensitive details.

Include the affected commit, reproduction steps, impact, and a minimal proof of concept. Remove tokens, authorization headers, Codex state, prompts, workspace contents, and personal data before sending the report. The repository maintainer coordinates validation, remediation and disclosure.

## Security design

### Credentials

Codex owns login, token refresh, credential storage, and account state. The plugin must not read or write Codex authentication files. It must not accept raw access tokens, refresh tokens, cookies, API keys, or authorization headers as configuration.

Diagnostics must redact credential-like fields and bearer values. Tests use synthetic placeholders only.

### Process boundary

The plugin starts the local `codex app-server` executable directly and communicates over stdio. It never invokes a shell or interpolates arguments into command strings.

The child inherits only the environment keys allowlisted by `childEnvironment`: basic user, system and executable paths, temporary paths, proxy settings, `CODEX_HOME`, and `LC_*`. Other ambient project and cloud credentials are dropped. The adapter requires Codex-managed ChatGPT authentication and offers no API-key bypass.

The executable path and arguments are untrusted configuration. Implementations must validate them before process creation. Child processes require startup, request, and shutdown timeouts plus cancellation.

### JSON-RPC boundary

Every app-server response, notification, and server request is untrusted. Runtime validation must reject malformed IDs, unknown shapes, invalid tool payloads, and unsafe error data.

Parsers must bound line size, pending requests, buffered output, and tool-result size. Protocol failures close stdin, send TERM, and escalate to KILL after the bounded shutdown timeout. Incoming server-request handlers use the request timeout and receive an abort signal. A result plus error-reply double failure rejects pending work and closes the client without an unhandled rejection.

Codex threads are cached only in the running adapter. After a restart, the adapter opens a new thread; it does not restore one from historical replay state.

### Tool boundary

The app-server experimental API is enabled by the plugin. When DSH provides tools for a persistent session, the adapter accepts at most 128 tool definitions and 16 pending calls, bounds serialized arguments to 256 KiB, and refuses duplicate or over-256-byte UTF-8 call IDs and already-aborted requests. Tool results must be text-only and are limited to 4 MiB of aggregate UTF-8 text per batch. Missing, duplicate, oversized or non-text results reject the batch before any pending call is answered; the adapter rejects pending calls and interrupts the Codex turn. DSH remains the tool executor under its own permission path. A full JSON Schema fingerprint is not currently checked on an existing thread.

Pending calls exist only in the running process. An invalid tool-result batch rejects outstanding calls and attempts to interrupt the Codex turn; adapter close rejects the calls and closes the client. Reinstalling or restarting the plugin does not restore pending calls or the previous thread.

### Network and telemetry

The plugin must not add a direct HTTP client, telemetry, analytics, crash upload, or remote logging. Network traffic initiated by Codex or DSH remains under those products' configuration and policy.

## Scope

Reports about this adapter, its packaging, process handling, protocol validation, tool bridge, or redaction are in scope.

Vulnerabilities in Codex, OpenAI services, DeepSeek Harness, Cordis, Node.js, or third-party packages should also be reported to the affected upstream project. Dependency reports that demonstrate an exploitable path through this package remain in scope.
