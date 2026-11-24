import { MessageId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'

import type { AppServerNotification, CodexModel } from '../src/app-server/types.js'
import { CODEX_OAUTH_PROVIDER, OAuthCodexAdapter, type OAuthCodexRuntime } from '../src/oauth-adapter.js'

const MODEL: CodexModel = {
  id: 'oauth-model', model: 'oauth-model', displayName: 'OAuth Model', description: 'OAuth test model',
  hidden: false, isDefault: true, inputModalities: ['text', 'image'], reasoningEfforts: [], defaultReasoningEffort: 'medium',
}

function createRuntime(initialRegistration = 'registration-a', completeTurns = true) {
  const listeners = new Set<(notification: AppServerNotification) => void>()
  const closeListeners = new Set<(error: Error) => void>()
  let registration = initialRegistration
  let generation = 1
  let turn = 0
  const methods = {
    registrationId: vi.fn(() => registration),
    generationId: vi.fn(() => generation),
    rotateGeneration: () => { generation += 1 },
    setRegistration: (next: string) => { registration = next },
    failTransport: (error: Error) => { for (const listener of closeListeners) listener(error) },
    onClose: vi.fn((listener: (error: Error) => void) => { closeListeners.add(listener); return () => { closeListeners.delete(listener) } }),
    ensureReady: vi.fn(async () => undefined),
    registerServerRequestHandler: vi.fn(() => () => undefined),
    listModels: vi.fn(async () => [MODEL] as readonly CodexModel[]),
    startThread: vi.fn(async () => ({ id: 'oauth-thread' })),
    resumeThread: vi.fn(async (request: { readonly threadId: string }) => ({ id: request.threadId })),
    startTurn: vi.fn(async () => {
      const id = `oauth-turn-${++turn}`
      if (completeTurns) queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ method: 'item/agentMessage/delta', params: { threadId: 'oauth-thread', turnId: id, itemId: 'message', delta: 'answer' } })
          listener({ method: 'turn/completed', params: { threadId: 'oauth-thread', turn: { id, items: [], status: 'completed', error: null } } })
        }
      })
      return { id, items: [], status: 'inProgress' as const, error: null }
    }),
    onNotification: vi.fn((listener: (notification: AppServerNotification) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
    readRateLimits: vi.fn(async () => ({})),
    readAccount: vi.fn(async () => ({ authenticated: false, requiresOpenaiAuth: false })),
    interruptTurn: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return methods as unknown as OAuthCodexRuntime & typeof methods
}

function options(): GenerateOptions {
  return {
    provider: CODEX_OAUTH_PROVIDER,
    model: MODEL.model,
    sessionId: 'oauth-session' as NonNullable<GenerateOptions['sessionId']>,
    messages: [{ id: MessageId('oauth-message'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }],
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function adapter(runtime: OAuthCodexRuntime): OAuthCodexAdapter {
  return new OAuthCodexAdapter({
    runtime, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000,
  })
}

describe('OAuth Codex adapter', () => {
  it('exposes only the OAuth provider and discovers models after runtime readiness', async () => {
    const runtime = createRuntime()
    const instance = adapter(runtime)
    try {
      expect(instance.providerInfo(CODEX_OAUTH_PROVIDER)).toEqual({ id: CODEX_OAUTH_PROVIDER, name: 'ChatGPT（OAuth Preview）' })
      expect(() => instance.providerInfo('my-codex')).toThrow('Unknown provider')
      expect(await instance.listModels(CODEX_OAUTH_PROVIDER)).toEqual([expect.objectContaining({ provider: CODEX_OAUTH_PROVIDER, id: MODEL.model })])
      expect(runtime.ensureReady).toHaveBeenCalled()
      expect(runtime.readAccount).not.toHaveBeenCalled()
    } finally { await instance.close() }
  })

  it('resumes only replay state bound to the same OAuth registration', async () => {
    const originalRuntime = createRuntime('registration-a')
    const original = adapter(originalRuntime)
    const chunks = await collect(original.stream(options()))
    await original.close()
    const finish = chunks.find(chunk => chunk.type === 'finish')
    const assistant = {
      id: MessageId('oauth-assistant'), role: 'assistant' as const,
      source: { kind: 'model' as const, provider: CODEX_OAUTH_PROVIDER, model: MODEL.model, replayState: finish?.type === 'finish' ? finish.replayState : undefined },
      content: [{ type: 'text' as const, text: 'prior answer' }],
    }
    const followup = { id: MessageId('oauth-followup'), role: 'user' as const, source: { kind: 'user' as const }, content: [{ type: 'text' as const, text: 'continue' }] }

    const sameRuntime = createRuntime('registration-a')
    const same = adapter(sameRuntime)
    try {
      await collect(same.stream({ ...options(), messages: [...options().messages, assistant, followup] }))
      expect(sameRuntime.resumeThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'oauth-thread' }), expect.any(Object))
      expect(sameRuntime.startThread).not.toHaveBeenCalled()
    } finally { await same.close() }

    const changedRuntime = createRuntime('registration-b')
    const changed = adapter(changedRuntime)
    try {
      await expect(collect(changed.stream({ ...options(), messages: [...options().messages, assistant, followup] }))).rejects.toMatchObject({ failure: { code: 'SESSION_ACCOUNT_CHANGED' } })
      expect(changedRuntime.resumeThread).not.toHaveBeenCalled()
      expect(changedRuntime.startThread).not.toHaveBeenCalled()
    } finally { await changed.close() }
  })

  it('resumes a same-account thread after an OAuth child generation change', async () => {
    const runtime = createRuntime()
    const instance = adapter(runtime)
    try {
      await collect(instance.stream(options()))
      runtime.rotateGeneration()
      const followup = { id: MessageId('oauth-followup'), role: 'user' as const, source: { kind: 'user' as const }, content: [{ type: 'text' as const, text: 'again' }] }
      await collect(instance.stream({ ...options(), messages: [...options().messages, followup] }))
      expect(runtime.resumeThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'oauth-thread' }), expect.any(Object))
      expect(runtime.startThread).toHaveBeenCalledOnce()
    } finally { await instance.close() }
  })

  it('rejects a changed account for an existing in-memory thread', async () => {
    const runtime = createRuntime()
    const instance = adapter(runtime)
    try {
      await collect(instance.stream(options()))
      runtime.setRegistration('registration-b')
      const followup = { id: MessageId('oauth-followup'), role: 'user' as const, source: { kind: 'user' as const }, content: [{ type: 'text' as const, text: 'again' }] }
      await expect(collect(instance.stream({ ...options(), messages: [...options().messages, followup] }))).rejects.toMatchObject({ failure: { code: 'SESSION_ACCOUNT_CHANGED' } })
      expect(runtime.startThread).toHaveBeenCalledOnce()
    } finally { await instance.close() }
  })

  it('wakes a pending stream when its OAuth child closes', async () => {
    const runtime = createRuntime('registration-a', false)
    const instance = adapter(runtime)
    try {
      const pending = collect(instance.stream(options()))
      await vi.waitFor(() => expect(runtime.startTurn).toHaveBeenCalledOnce())
      runtime.failTransport(new Error('synthetic process exit'))
      await expect(pending).rejects.toMatchObject({ failure: { code: 'CODEX_APP_SERVER' } })
    } finally { await instance.close() }
  })

  it('writes replay v2 bound to the active registration', async () => {
    const runtime = createRuntime('registration-a')
    const instance = adapter(runtime)
    try {
      const chunks = await collect(instance.stream(options()))
      const finish = chunks.find(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop')
      expect(finish).toMatchObject({
        type: 'finish',
        replayState: { response: { version: 2, registrationId: 'registration-a', threadId: 'oauth-thread', lastUserMessageId: 'oauth-message' } },
      })
      expect(runtime.ensureReady).toHaveBeenCalledWith(undefined, true)
    } finally { await instance.close() }
  })
})
