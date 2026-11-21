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
  let nextTurnStatus: 'completed' | 'failed' = 'completed'
  const methods = {
    registerServerRequestHandler: vi.fn(() => () => undefined),
    readAccount: vi.fn(async () => ({ authenticated: true, kind: 'chatgpt' as const, requiresOpenaiAuth: true })),
    listModels: vi.fn(async () => [MODEL] as readonly CodexModel[]),
    startThread: vi.fn(async () => ({ id: 'thread-1' })),
    resumeThread: vi.fn(async (request: { readonly threadId: string }) => ({ id: request.threadId })),
    startTurn: vi.fn(async (_request: { readonly input: readonly { readonly type: string; readonly text?: string }[] }) => {
      const id = `turn-${++nextTurn}`
      const status = nextTurnStatus
      nextTurnStatus = 'completed'
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'thread-1', turnId: id, itemId: 'reasoning-1', summaryIndex: 0, delta: 'think' } })
          listener({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: id, itemId: 'message-1', delta: 'answer' } })
          listener({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id, items: [], status, error: status === 'failed' ? { message: 'transient failure' } : null } } })
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
  return { adapter, methods, failNextTurn: () => { nextTurnStatus = 'failed' } }
}

function options(sessionId?: string, messageId = 'message-1'): GenerateOptions {
  return {
    provider: CODEX_PROVIDER,
    model: MODEL.model,
    messages: [{ id: MessageId(messageId), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }],
    ...(sessionId === undefined ? {} : { sessionId: sessionId as NonNullable<GenerateOptions['sessionId']> }),
  }
}

function historyOptions(sessionId: string, count: number): GenerateOptions {
  return { ...options(sessionId), messages: Array.from({ length: count }, (_, index) => ({
    id: MessageId(`message-${index + 1}`), role: 'user' as const, source: { kind: 'user' as const },
    content: [{ type: 'text' as const, text: `question-${index + 1}` }],
  })) }
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
      const secondInput = { ...options('session-1', 'message-2'), messages: [
        ...options('session-1').messages,
        { id: MessageId('assistant-1'), role: 'assistant' as const, source: { kind: 'model' as const, provider: CODEX_PROVIDER, model: MODEL.model }, content: [{ type: 'text' as const, text: 'old assistant reply' }] },
        { id: MessageId('message-2'), role: 'user' as const, source: { kind: 'user' as const }, content: [{ type: 'text' as const, text: 'new question' }] },
      ] }
      const second = await collect(adapter.stream(secondInput))
      expect(methods.startTurn.mock.calls[1]?.[0]).toMatchObject({ input: [{ type: 'text', text: 'new question' }] })
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

  it('sends the system prompt as thread instructions, never as user text', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      const messages = [
        { id: MessageId('system-1'), role: 'system' as const, source: { kind: 'system-prompt' as const }, content: [{ type: 'text' as const, text: 'system rules' }] },
        ...options('session-system').messages,
      ]
      await collect(adapter.stream({ ...options('session-system'), messages }))
      expect(methods.startThread).toHaveBeenCalledWith(expect.objectContaining({ baseInstructions: 'system rules' }), expect.any(Object))
      expect(methods.startTurn.mock.calls[0]?.[0].input).toEqual([{ type: 'text', text: 'hello' }])
    } finally {
      await adapter.close()
    }
  })

  it('resumes the persisted Codex thread after adapter recreation', async () => {
    const original = createFakeClient()
    const first = await collect(original.adapter.stream(options('session-restored')))
    await original.adapter.close()
    const finish = first.find((chunk) => chunk.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', replayState: { response: { threadId: 'thread-1', lastUserMessageId: 'message-1' } } })
    const restored = createFakeClient()
    try {
      const assistant = { id: MessageId('assistant-1'), role: 'assistant' as const,
        source: { kind: 'model' as const, provider: CODEX_PROVIDER, model: MODEL.model, replayState: finish?.type === 'finish' ? finish.replayState : undefined },
        content: [{ type: 'text' as const, text: 'prior answer' }] }
      await collect(restored.adapter.stream({ ...options('session-restored'), messages: [
        ...options('session-restored').messages,
        assistant,
        { id: MessageId('message-2'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'new question' }] },
      ] }))
      expect(restored.methods.startThread).not.toHaveBeenCalled()
      expect(restored.methods.resumeThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-1' }), expect.any(Object))
      expect(restored.methods.startTurn.mock.calls[0]?.[0].input).toEqual([{ type: 'text', text: 'new question' }])
    } finally {
      await restored.adapter.close()
    }
  })

  it('retries the same user message after a failed Codex turn', async () => {
    const { adapter, methods, failNextTurn } = createFakeClient()
    try {
      failNextTurn()
      expect(await collect(adapter.stream(options('session-retry')))).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'finish', reason: expect.objectContaining({ kind: 'error' }) }),
      ]))
      await collect(adapter.stream(options('session-retry')))
      expect(methods.startThread).toHaveBeenCalledOnce()
      expect(methods.startTurn).toHaveBeenCalledTimes(2)
      expect(methods.startTurn.mock.calls[1]?.[0].input).toEqual([{ type: 'text', text: 'hello' }])
    } finally {
      await adapter.close()
    }
  })

  it('sends a bounded continuation only when the tool catalog changes', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      const first = options('session-tools-only')
      await collect(adapter.stream(first))
      const changed = { ...first, tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }] }
      await collect(adapter.stream(changed))
      expect(methods.resumeThread).toHaveBeenCalledOnce()
      expect(methods.startTurn.mock.calls[1]?.[0].input).toEqual([{ type: 'text', text: 'Continue with the updated instructions and tools.' }])
      await expect(collect(adapter.stream(changed))).rejects.toMatchObject({ failure: { code: 'EMPTY_INPUT' } })
      expect(methods.startTurn).toHaveBeenCalledTimes(2)
    } finally {
      await adapter.close()
    }
  })

  it('resumes updated system instructions without replaying user history', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      const first = { ...options('session-system-update'), system: 'Initial instructions' }
      await collect(adapter.stream(first))
      const changed = { ...first, system: 'Updated instructions' }
      await collect(adapter.stream(changed))
      expect(methods.resumeThread).toHaveBeenCalledWith(expect.objectContaining({ baseInstructions: 'Updated instructions' }), expect.any(Object))
      expect(methods.startTurn.mock.calls[1]?.[0].input).toEqual([{ type: 'text', text: 'Continue with the updated instructions and tools.' }])
      await expect(collect(adapter.stream(changed))).rejects.toMatchObject({ failure: { code: 'EMPTY_INPUT' } })
      expect(methods.startThread).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('does not replay a completed request without new user content', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      await collect(adapter.stream(options('session-repeat')))
      await expect(collect(adapter.stream(options('session-repeat')))).rejects.toMatchObject({ failure: { code: 'EMPTY_INPUT' } })
      expect(methods.startTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('resumes after compaction only past the most recent own assistant boundary', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      await collect(adapter.stream(options('session-compact')))
      const assistant = { id: MessageId('assistant-1'), role: 'assistant' as const,
        source: { kind: 'model' as const, provider: CODEX_PROVIDER, model: MODEL.model },
        content: [{ type: 'text' as const, text: 'already answered' }] }
      await collect(adapter.stream({ ...options('session-compact'), messages: [
        { id: MessageId('old-after-compaction'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }] },
        assistant,
        { id: MessageId('new-after-compaction'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'fresh' }] },
      ] }))
      expect(methods.startTurn.mock.calls[1]?.[0].input).toEqual([{ type: 'text', text: 'fresh' }])
      expect(methods.startThread).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('fails closed if compaction loses the cursor without a model boundary', async () => {
    const { adapter, methods } = createFakeClient()
    try {
      await collect(adapter.stream(options('session-cursor')))
      await expect(collect(adapter.stream({ ...options('session-cursor'), messages: [
        { id: MessageId('replaced'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'unknown history' }] },
      ] }))).rejects.toMatchObject({ failure: { code: 'SESSION_CURSOR_MISSING' } })
      expect(methods.startTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('refreshes a completed Codex thread when DSH tools become available', async () => {
    const { adapter, methods } = createFakeClient()
    const lookup = { name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: { key: { type: 'string' } } } }
    try {
      await collect(adapter.stream(historyOptions('session-tools', 1)))
      await collect(adapter.stream({ ...historyOptions('session-tools', 2), tools: [lookup] }))
      await collect(adapter.stream({ ...historyOptions('session-tools', 3), tools: [lookup] }))
      expect(methods.startThread).toHaveBeenCalledOnce()
      expect(methods.resumeThread).toHaveBeenCalledOnce()
      expect(methods.resumeThread).toHaveBeenCalledWith(expect.objectContaining({
        threadId: 'thread-1',
        dynamicTools: [expect.objectContaining({ name: 'lookup' })],
      }), expect.any(Object))
      expect(methods.startTurn).toHaveBeenCalledTimes(3)
    } finally {
      await adapter.close()
    }
  })

  it('updates changed schemas and removal but ignores only key-order differences', async () => {
    const { adapter, methods } = createFakeClient()
    const original = { name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: { key: { type: 'string' } } } }
    try {
      await collect(adapter.stream({ ...historyOptions('session-schema', 1), tools: [original] }))
      await collect(adapter.stream({ ...historyOptions('session-schema', 2), tools: [{ ...original, parameters: { properties: { key: { type: 'string' } }, type: 'object' } }] }))
      expect(methods.resumeThread).not.toHaveBeenCalled()
      await collect(adapter.stream({ ...historyOptions('session-schema', 3), tools: [{ ...original, description: 'Changed' }] }))
      await collect(adapter.stream({ ...historyOptions('session-schema', 4), tools: [{ ...original, description: 'Changed', deferLoading: true }] }))
      await collect(adapter.stream({ ...historyOptions('session-schema', 5), tools: [] }))
      expect(methods.resumeThread).toHaveBeenCalledTimes(3)
      expect(methods.resumeThread).toHaveBeenLastCalledWith(expect.objectContaining({ dynamicTools: [] }), expect.any(Object))
    } finally {
      await adapter.close()
    }
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
