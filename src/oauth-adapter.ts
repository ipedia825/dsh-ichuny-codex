import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

import { CodexAdapter, type CodexAppServer } from './adapter.js'

export interface OAuthCodexRuntime extends CodexAppServer {
  registrationId(): string | undefined
  generationId(): number
  setCanReplace?(check: () => boolean): void
  ensureReady(signal?: AbortSignal, allowRefresh?: boolean): Promise<void>
}

export const CODEX_OAUTH_PROVIDER = 'my-codex-oauth'

export interface OAuthCodexAdapterOptions {
  readonly runtime: OAuthCodexRuntime
  readonly cwd: string
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly approvalPolicy: 'never' | 'on-request' | 'untrusted'
  readonly requestTimeoutMs: number
  readonly sessionCwd?: (sessionId: GenerateOptions['sessionId']) => string | undefined
  readonly attachments?: () => AttachmentStore | undefined
}

export class OAuthCodexAdapter extends CodexAdapter {
  constructor(options: OAuthCodexAdapterOptions) {
    super({
      client: options.runtime,
      cwd: options.cwd,
      sandbox: options.sandbox,
      approvalPolicy: options.approvalPolicy,
      requestTimeoutMs: options.requestTimeoutMs,
      ...(options.sessionCwd === undefined ? {} : { sessionCwd: options.sessionCwd }),
      ...(options.attachments === undefined ? {} : { attachments: options.attachments }),
      providerId: CODEX_OAUTH_PROVIDER,
      providerName: 'ChatGPT（OAuth Preview）',
      replayVersion: 2,
      registrationId: () => options.runtime.registrationId(),
      contextGeneration: () => options.runtime.generationId(),
      requireReady: (signal, allowRefresh) => options.runtime.ensureReady(signal, allowRefresh),
    })
    options.runtime.setCanReplace?.(() => !this.hasActiveTurns())
  }
}
