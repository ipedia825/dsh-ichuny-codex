import { MessageId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'

import { CODEX_PROVIDER, CodexAdapter } from '../src/adapter.js'
import type { AppServerClient } from '../src/app-server/client.js'
import type { AppServerNotification, CodexModel } from '../src/app-server/types.js'

const MODEL: CodexModel = {
  id: 'model-id',
  model: 'model-name',
  displayName: 'Model Name',
  description: 'Test model',
  hidden: false,
  isDefault: true,
  inputModalities: ['text', 'image'],
  reasoningEfforts: [{ id: 'medium', description: 'Balanced' }],
  defaultReasoningEffort: 'medium',
}

function createFakeClient() {
  const listeners = new Set<(notification: AppServerNotification) => void>()
  let nextTurn = 0
  const methods = {
    registerServerRequestHandler: vi.fn(() => () => undefined),
    readAccount: vi.fn(async () => ({ authenticated: true, kind: 'chatgpt' as const, requiresOpenaiAuth: true })),
    listModels: vi.fn(async () => [MODEL] as readonly CodexModel[]),
    startThread: vi.fn(async () => ({ id: 'thread-1' })),
    startTurn: vi.fn(async () => {
      const id = `turn-${++nextTurn}`
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'thread-1', turnId: id, itemId: 'reasoning-1', summaryIndex: 0, delta: 'think' } })
          listener({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: id, itemId: 'message-1', delta: 'answer' } })
          listener({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id, items: [], status: 'completed', error: null } } })
        }
      })
      return { id, items: [], status: 'inProgress' as const, error: null }
    }),
    interruptTurn: vi.fn(async () => undefined),
    onNotification: vi.fn((listener: (notification: AppServerNotification) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    close: vi.fn(async () => undefined),
  }
  const adapter = new CodexAdapter({
    client: methods as unknown as AppServerClient,
    cwd: '/workspace',
    sandbox: 'workspace-write',
    approvalPolicy: 'untrusted',
    requestTimeoutMs: 1_000,
  })
  return { adapter, methods }
}

function options(sessionId?: string): GenerateOptions {
  return {
    provider: CODEX_PROVIDER,
    model: MODEL.model,
    messages: [{ id: MessageId('message-1'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }],
    ...(sessionId === undefined ? {} : { sessionId: sessionId as NonNullable<GenerateOptions['sessionId']> }),
  }
}

async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const result: StreamChunk[] = []
  for await (const chunk of chunks) result.push(chunk)
  return result
}

describe('current Codex adapter', () => {
  it('requires ChatGPT login and rejects a different provider', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      expect(adapter.providerInfo(CODEX_PROVIDER)).toEqual({ id: CODEX_PROVIDER, name: 'My Codex' })
      expect(() => adapter.providerInfo('codex')).toThrow('Unknown provider')
      methods.readAccount.mockResolvedValueOnce({ authenticated: false, kind: 'chatgpt', requiresOpenaiAuth: true })
      await expect(adapter.listModels(CODEX_PROVIDER)).rejects.toMatchObject({ failure: { code: 'AUTH' } })
    } finally {
      await adapter.close()
    }
  })

  it('discovers visible models and resolves their reasoning efforts', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      methods.listModels.mockResolvedValueOnce([MODEL, { ...MODEL, id: 'hidden', hidden: true }])
      expect(await adapter.listModels(CODEX_PROVIDER)).toEqual([expect.objectContaining({ provider: CODEX_PROVIDER, id: MODEL.model, inputModalities: ['text', 'image'] })])
      expect(await adapter.resolveModel(CODEX_PROVIDER, MODEL.model)).toMatchObject({ reasoning: { defaultEffort: 'medium' } })
      await expect(adapter.resolveModel(CODEX_PROVIDER, 'missing')).rejects.toMatchObject({ failure: { code: 'UNKNOWN_MODEL' } })
    } finally {
      await adapter.close()
    }
  })

  it('streams text and reasoning and reuses a persistent in-process thread', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      const first = await collect(adapter.stream(options('session-1')))
      const second = await collect(adapter.stream(options('session-1')))
      expect(first).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning-delta', text: 'think' }),
        expect.objectContaining({ type: 'text-delta', text: 'answer' }),
        expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }),
      ]))
      expect(second).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } })]))
      expect(methods.startThread).toHaveBeenCalledTimes(1)
      expect(methods.startTurn).toHaveBeenCalledTimes(2)
    } finally {
      await adapter.close()
    }
    expect(methods.close).toHaveBeenCalledOnce()
  })

  it('refuses tool catalogs without a persistent session', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      const request = { ...options(), tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }] } as GenerateOptions
      await expect(collect(adapter.stream(request))).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOLS_REQUIRE_SESSION' } })
      expect(methods.startThread).not.toHaveBeenCalled()
    } finally {
      await adapter.close()
    }
  })

  it('refuses empty user content before opening an app-server thread', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      await expect(collect(adapter.stream({ ...options(), messages: [] }))).rejects.toMatchObject({ failure: { code: 'EMPTY_INPUT' } })
      expect(methods.startThread).not.toHaveBeenCalled()
    } finally {
      await adapter.close()
    }
  })
})
