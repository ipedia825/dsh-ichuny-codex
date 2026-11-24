---
title: "ChatGPT Dual Connection Stage 0 Decision"
category: reference
service: dsh-ichuny-codex
version: "1.8.0"
tags: [architecture, authentication, oauth, chatgpt, security]
created: "2026-11-22"
last_updated: "2026-11-24"
description: "Records the owner decisions and remaining governance gates for the proposed ChatGPT OAuth connection."
---

# ChatGPT Dual Connection Stage 0 Decision

## Status

The product owner approved the revised target architecture and a narrow repository-policy exception for the official SIWC endpoints, documented scopes and independent OAuth app-server. This record does not claim OAuth behavior is implemented. Private ChatGPT endpoints, API-key fallback, copied client IDs and credential leakage remain prohibited. [PATH: CHATGPT_CONNECTION_DESIGN.md] [PATH: AGENTS.md] [PATH: CLAUDE.md] [PATH: kb/reference/security.md]

## Decisions

| Topic | Decision |
|---|---|
| Existing local provider | Preserve `my-codex` and all current session/replay compatibility. |
| OAuth provider | Register independent provider ID `my-codex-oauth`; never fall back silently to `my-codex`. |
| Upstream protocol | Use OpenAI's official Sign in with ChatGPT open-source flow, currently documented as Preview. Do not use ChatGPT `backend-api` endpoints. |
| Execution architecture | Run a separate Codex app-server configured for ChatGPT-plan Responses access. Keep its process, token injection, lifecycle, replay and usage-limit state independent from the local provider. |
| OAuth flow | Dynamic client registration, Authorization Code with PKCE, OIDC nonce/state validation, exact loopback redirect on `127.0.0.1`, and the documented `offline_access resource.invoke chatgpt.tokens.use.direct` scopes. |
| Deployment boundary | First release is limited to one trusted local OS user. Remote and multi-user Web deployments are out of scope. |
| Credential storage | Use DSH credential records in the owner-only local store, with atomic replacement and permission checks. Accept that this is not an OS keychain and same-UID processes can read the file. |
| Refresh and sign-out | Serialize refreshes per registration, atomically replace rotating tokens, restart only the OAuth app-server after refresh, resume its thread, and attempt the documented remote refresh-token revocation before local deletion. |
| Account scope | First release supports one active OAuth account; no account pool or automatic rotation. |
| Capability claims | Treat the integration as Preview. Show only capabilities proven by contract and real-client smoke tests; do not claim parity with the local Codex sandbox or built-in tools. |
| Usage display | The official flow has no documented quota-summary API. Link to ChatGPT Settings Usage and report structured usage-limit failures; do not fabricate a local quota percentage. |
| New-session preference | Persist a non-secret preference and guide model selection. Do not claim automatic default-model switching until a live Host contract is verified. |

## Accepted upstream constraints

The official Preview requires `store: false` and `stream: true`. HTTP continuation does not provide persistent server-side conversation storage. Text, images and files are supported when the selected model accepts them. Function/custom tools are supported, while image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors and Responses `tool_search` are not. The OAuth app-server path may use local shell/MCP tools, but those are separate from hosted Responses tools and remain subject to DSH approval boundaries.

Official references:

- [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts, refresh and revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Codex app-server configuration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

## Remaining gates

1. The implementation plan must define runtime validation, bounded responses, cancellation, timeout, concurrency, refresh single-flight, replay namespace and provider/account ownership checks.
2. Tests and documentation must change with behavior. Required gates include composition, packaging and a real-client smoke test for both providers before any end-to-end claim.
3. Preview changes upstream may invalidate this decision. Re-check the cited official documents before implementation and release.

## Rejected alternatives

- Copying a fixed OAuth client ID, scope or private ChatGPT endpoint from another project.
- Adding a mode branch to the existing local adapter or passing OAuth replay metadata into `my-codex`.
- Storing tokens in plugin config, browser storage, URLs or logs.
- Claiming quota details or unsupported tools that the official Preview does not expose.
