import { MessageId, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'

import { CodexAdapter, CODEX_PROVIDER } from '../src/adapter.js'
import type { AppServerClient } from '../src/app-server/client.js'
import type { AppServerNotification, AppServerRequest, JsonValue, ServerRequestHandler } from '../src/app-server/types.js'
import { toolCallId } from '../src/dsh-compat.js'

const TOOL = { name: 'lookup', description: 'Look up a value', parameters: { type: 'object', properties: { key: { type: 'string' } } } } as const
const USER: Message = { id: MessageId('user-1'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'find a value' }] }

function options(messages: Message[], tools: GenerateOptions['tools'] = [TOOL]): GenerateOptions {
  return { provider: CODEX_PROVIDER, model: 'test-model', sessionId: 'session-1' as NonNullable<GenerateOptions['sessionId']>, messages, tools }
}

function fakeClient() {
  const listeners = new Set<(notification: AppServerNotification) => void>()
  let handler: ServerRequestHandler | undefined
  const methods = {
    readAccount: vi.fn(async () => ({ authenticated: true, kind: 'chatgpt' as const, requiresOpenaiAuth: true })),
    startThread: vi.fn(async () => ({ id: 'thread-1' })),
    startTurn: vi.fn(async () => ({ id: 'turn-1', items: [], status: 'inProgress' as const, error: null })),
    onNotification: vi.fn((listener: (notification: AppServerNotification) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    registerServerRequestHandler: vi.fn((callback: ServerRequestHandler) => {
      handler = callback
      return () => { handler = undefined }
    }),
    interruptTurn: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return {
    methods,
    client: methods as unknown as AppServerClient,
    emit(notification: AppServerNotification): void {
      for (const listener of listeners) listener(notification)
    },
    requestTool(tool: string, callId = 'call-1', signal = new AbortController().signal): Promise<JsonValue> {
      if (handler === undefined) throw new Error('Missing test server-request handler')
      const request: AppServerRequest = {
        id: 'request-1', method: 'item/tool/call',
        params: { threadId: 'thread-1', turnId: 'turn-1', callId, namespace: null, tool, arguments: { key: 'a' } },
      }
      return handler(request, signal)
    },
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function toolResult(text: string, id = 'result-1', callId = 'call-1'): Message {
  return {
    id: MessageId(id), role: 'tool', toolCallId: toolCallId(callId),
    source: { kind: 'tool', callId: toolCallId(callId) },
    content: [{ type: 'text', text }],
  }
}

async function beginToolCall(fake: ReturnType<typeof fakeClient>, adapter: CodexAdapter): Promise<{ readonly response: Promise<JsonValue> }> {
  const stream = collect(adapter.stream(options([USER])))
  await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
  const response = fake.requestTool(TOOL.name)
  void response.catch(() => undefined)
  await stream
  return { response }
}

describe('current DSH dynamic tools', () => {
  it('routes a Codex call through DSH and returns a correlated text result', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const first = collect(adapter.stream(options([USER])))
      await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
      expect(fake.methods.startThread).toHaveBeenCalledWith(expect.objectContaining({
        dynamicTools: [expect.objectContaining({ name: TOOL.name })],
      }), expect.anything())

      const response = fake.requestTool(TOOL.name)
      expect(await first).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool-call-delta', name: TOOL.name }),
        expect.objectContaining({ type: 'finish', reason: { kind: 'tool-calls' } }),
      ]))
      const result: Message = {
        id: MessageId('result-1'), role: 'tool', toolCallId: toolCallId('call-1'),
        source: { kind: 'tool', callId: toolCallId('call-1') },
        content: [{ type: 'text', text: 'found' }],
      }
      const continuation = collect(adapter.stream(options([USER, result])))
      await expect(response).resolves.toEqual({ contentItems: [{ type: 'inputText', text: 'found' }], success: true })
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      expect(await continuation).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } })]))
      expect(fake.methods.startTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('rejects invalid tool names and oversized catalogs before opening a thread', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      await expect(collect(adapter.stream(options([USER], [{ ...TOOL, name: 'invalid.tool' }])))).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_NAME_INVALID' } })
      const tooMany = Array.from({ length: 129 }, (_, i) => ({ ...TOOL, name: `tool_${i}` }))
      await expect(collect(adapter.stream(options([USER], tooMany)))).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_CATALOG_LIMIT' } })
      expect(fake.methods.startThread).not.toHaveBeenCalled()
    } finally {
      await adapter.close()
    }
  })

  it('continues from a tool-only message without opening another Codex turn', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      const continuation = collect(adapter.stream(options([toolResult('found')])))
      await expect(response).resolves.toEqual({ contentItems: [{ type: 'inputText', text: 'found' }], success: true })
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      await expect(continuation).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } })]))
      expect(fake.methods.startTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('keeps the pending turn intact when DSH updates its catalog mid-call', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      const continuation = collect(adapter.stream(options([toolResult('found')], [])))
      await expect(response).resolves.toMatchObject({ contentItems: [{ type: 'inputText', text: 'found' }] })
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      await expect(continuation).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } })]))
      expect(fake.methods.startTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('rejects duplicate results atomically and interrupts the pending turn', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      await expect(collect(adapter.stream(options([toolResult('first'), toolResult('second', 'result-2')]))))
        .rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_DUPLICATE' } })
      await expect(response).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_DUPLICATE' } })
      expect(fake.methods.interruptTurn).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' }, expect.anything())
    } finally {
      await adapter.close()
    }
  })

  it('bounds text results and rejects the pending server request', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      await expect(collect(adapter.stream(options([toolResult('x'.repeat(4 * 1024 * 1024 + 1))]))))
        .rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_TOO_LARGE' } })
      await expect(response).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_TOO_LARGE' } })
      expect(fake.methods.interruptTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('rejects missing tool results without leaving a pending server request', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      await expect(collect(adapter.stream(options([]))))
        .rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_MISSING' } })
      await expect(response).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_MISSING' } })
      expect(fake.methods.interruptTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('emits all four concurrent Codex calls before requiring their results', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const stream = collect(adapter.stream(options([USER])))
      await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
      const ids = ['call-1', 'call-2', 'call-3', 'call-4']
      const responses = ids.map((id) => fake.requestTool(TOOL.name, id))
      expect((await stream).filter((chunk) => chunk.type === 'tool-call-delta').map((chunk) => chunk.id))
        .toEqual(ids.map(toolCallId))
      const results = ids.map((id, index) => toolResult(`value-${index}`, `result-${index}`, id))
      const continuation = collect(adapter.stream(options(results)))
      await expect(Promise.all(responses)).resolves.toHaveLength(4)
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      expect(await continuation).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } })]))
      expect(fake.methods.interruptTurn).not.toHaveBeenCalled()
    } finally {
      await adapter.close()
    }
  })

  it('exposes a late Codex call after responding to the first one', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response: first } = await beginToolCall(fake, adapter)
      const second = fake.requestTool(TOOL.name, 'call-2')
      const continuation = collect(adapter.stream(options([toolResult('first')])))
      await expect(first).resolves.toMatchObject({ success: true })
      expect((await continuation).filter((chunk) => chunk.type === 'tool-call-delta').map((chunk) => chunk.id))
        .toEqual([toolCallId('call-2')])
      const finalStep = collect(adapter.stream(options([toolResult('second', 'result-2', 'call-2')])))
      await expect(second).resolves.toMatchObject({ success: true })
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      await expect(finalStep).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } })]))
      expect(fake.methods.startTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })


  it('rejects an incomplete batch when both calls were exposed to DSH', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const stream = collect(adapter.stream(options([USER])))
      await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
      const first = fake.requestTool(TOOL.name)
      const second = fake.requestTool(TOOL.name, 'call-2')
      void first.catch(() => undefined)
      void second.catch(() => undefined)
      expect((await stream).filter((chunk) => chunk.type === 'tool-call-delta')).toHaveLength(2)
      await expect(collect(adapter.stream(options([toolResult('found')]))))
        .rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_MISSING' } })
      await expect(first).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_MISSING' } })
      await expect(second).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_MISSING' } })
      expect(fake.methods.interruptTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('forwards a mixed text and image tool result without dropping either block', async () => {
    const fake = fakeClient()
    const bytes = Uint8Array.from([0, 1, 2, 3])
    const store = { readImageRequest: vi.fn(async () => ({ data: bytes, mediaType: 'image/webp' as const })) }
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000, attachments: () => store as never })
    try {
      const { response } = await beginToolCall(fake, adapter)
      const result = { ...toolResult(''), content: [
        { type: 'text', text: 'screenshot' },
        { type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/webp', bytes: 4, width: 1, height: 1 } },
      ] } as unknown as Message
      const continuation = collect(adapter.stream(options([result])))
      await expect(response).resolves.toEqual({
        contentItems: [
          { type: 'inputText', text: 'screenshot' },
          { type: 'inputImage', imageUrl: 'data:image/webp;base64,AAECAw==' },
        ],
        success: true,
      })
      expect(store.readImageRequest).toHaveBeenCalledOnce()
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      await expect(continuation).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } })]))
    } finally {
      await adapter.close()
    }
  })

  it('rejects images without an attachment store before answering any calls', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      const result = { ...toolResult(''), content: [{ type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/webp', bytes: 4, width: 1, height: 1 } }] } as unknown as Message
      await expect(collect(adapter.stream(options([result])))).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_IMAGE_UNAVAILABLE' } })
      await expect(response).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_IMAGE_UNAVAILABLE' } })
      expect(fake.methods.interruptTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('rejects unsupported tool result blocks instead of silently discarding them', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      const unsupportedResult = {
        ...toolResult(''),
        content: [{ type: 'reasoning', text: 'internal reasoning' }],
      } as unknown as Message
      await expect(collect(adapter.stream(options([unsupportedResult]))))
        .rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_UNSUPPORTED' } })
      await expect(response).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_RESULT_UNSUPPORTED' } })
    } finally {
      await adapter.close()
    }
  })

  it('rejects duplicate and oversized call ids without replacing the original call', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      await expect(fake.requestTool(TOOL.name, 'call-1')).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_DUPLICATE' } })
      await expect(fake.requestTool(TOOL.name, '字'.repeat(86))).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_CALL_ID_TOO_LARGE' } })
      const continuation = collect(adapter.stream(options([toolResult('found')])))
      await expect(response).resolves.toMatchObject({ contentItems: [{ type: 'inputText', text: 'found' }] })
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      await continuation
      expect(fake.methods.startTurn).toHaveBeenCalledOnce()
    } finally {
      await adapter.close()
    }
  })

  it('refuses an already-aborted server request without registering it', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const { response } = await beginToolCall(fake, adapter)
      const controller = new AbortController()
      controller.abort()
      await expect(fake.requestTool(TOOL.name, 'call-2', controller.signal)).rejects.toMatchObject({ failure: { code: 'ABORTED' } })
      const continuation = collect(adapter.stream(options([toolResult('found')])))
      await expect(response).resolves.toMatchObject({ success: true })
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      await continuation
    } finally {
      await adapter.close()
    }
  })

  it('rejects an unregistered tool for an active turn', async () => {
    const fake = fakeClient()
    const adapter = new CodexAdapter({ client: fake.client, cwd: '/workspace', sandbox: 'workspace-write', approvalPolicy: 'untrusted', requestTimeoutMs: 1_000 })
    try {
      const stream = collect(adapter.stream(options([USER])))
      await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
      await expect(fake.requestTool('not_registered')).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_UNKNOWN' } })
      fake.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      await stream
    } finally {
      await adapter.close()
    }
  })
})
