---
output-mode: concise
---

# dsh-ichuny-codex

## Project

`@ipedia/dsh-ichuny-codex` is a strict ESM TypeScript provider plugin for DeepSeek Harness. The target provider ID is `codex`. It delegates execution and authentication to the local `codex app-server` process over JSON-RPC on stdio.

Version `1.0.0` is the first public release. Do not describe a later change as working until composition, packaging, and real-client smoke tests pass.

## Commands

```bash
npm ci --ignore-scripts
npm run verify
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run audit
npm run audit:permissions
npm run audit:dependencies
npm run audit:signatures
npm run package:check
```

## Architecture rules

- The local `my-codex` provider keeps Codex-owned authentication and credential storage. Never read or write Codex auth files, tokens, cookies, or browser callbacks.
- The sole plugin-owned OAuth exception is OpenAI's official Sign in with ChatGPT open-source flow: dynamic client registration, PKCE/OIDC, its documented scopes, `auth.openai.com` endpoints, and public `api.openai.com/v1/models` and `/v1/responses`.
- Run that exception only as independent provider `my-codex-oauth` through a separately configured `codex app-server`, with isolated credentials, process lifecycle, replay and pending tools.
- Never use private ChatGPT `backend-api`, copied third-party client IDs, undocumented scopes/endpoints, or an OpenAI API-key fallback. Never persist SIWC tokens in config, browser storage, URLs, logs, errors, tests, or Codex auth storage.
- Start every `codex app-server` directly without a shell.
- Validate every JSON-RPC and OAuth/HTTP boundary and redact errors before exposure.
- Do not add telemetry, analytics, crash upload, or remote logging.
- Keep `@deepseek-ai/cordis` and `@deepseek-ai/dsh-llm` as peer dependencies.
- Treat experimental dynamic tools as untrusted requests with explicit limits.

## Generated protocol schema

Files explicitly marked as generated from the Codex app-server schema are protected. Do not hand-edit them. Regenerate from the pinned Codex CLI version, review the diff, and update protocol tests in the same change.

## TypeScript rules

- Node.js 22.19 or newer, `type: module`, and `NodeNext` resolution.
- Strict mode, no `any`, no non-null assertions in production code.
- Use `unknown` plus runtime guards at protocol boundaries.
- Use `readonly` interfaces and explicit return types for exported functions.
- Use `node:` imports and `.js` extensions in relative imports.
- No lifecycle scripts, shell execution, hidden network clients, or secrets.

## Repository rules

- The KB is the source of truth once the matching document exists.
- Behavior changes require unit tests, integration tests, and documentation.
- Conventional Commits only: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Never edit generated `lib/`, local `.agents/`, `.claude/`, `.codex/`, or user `.idea/`.
- Never commit credentials, Codex state, personal configuration, logs, tarballs, or SARIF output.
- Green verification gates define completion.
