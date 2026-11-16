import { randomUUID } from 'node:crypto'

import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type ModelModality,
  type RequestMessage,
  type ResolvedRetryPolicy,
  type StreamChunk,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

import type { AppServerClient } from './app-server/client.js'
import { safeErrorMessage } from './app-server/redaction.js'
import { toolCallId } from './dsh-compat.js'
import { isJsonValue, parseDeltaNotification, parseExperimentalDynamicToolCall, parseTokenUsageNotification } from './app-server/validation.js'
import type { AppServerRequest } from './app-server/types.js'
import type { CodexModel, CodexTokenUsageBreakdown, CodexUserInput, ExperimentalDynamicToolSpec, ExperimentalDynamicToolResult, JsonObject, JsonValue } from './app-server/types.js'

export const CODEX_PROVIDER = 'my-codex'

type Notification = Parameters<Parameters<AppServerClient['onNotification']>[0]>[0]

type PendingToolCall = {
  readonly callId: string
  readonly resolve: (result: ExperimentalDynamicToolResult) => void
  readonly reject: (error: Error) => void
  responded: boolean
}

type ThreadState = {
  readonly threadId: string
  readonly toolNames: ReadonlySet<string>
  readonly pendingCalls: Map<string, PendingToolCall>
  readonly queue: Notification[]
  wake: (() => void) | undefined
  unsubscribe: (() => void) | undefined
  turnId: string | undefined
}

const MAX_DYNAMIC_TOOLS = 128
const MAX_DYNAMIC_TOOL_ARGUMENT_BYTES = 262_144
const DYNAMIC_TOOL_NAME = /^[A-Za-z0-9_-]+$/u

export interface CodexAdapterOptions {
  readonly client: AppServerClient
  readonly cwd: string
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly approvalPolicy: 'never' | 'on-request' | 'untrusted'
  readonly requestTimeoutMs: number
  readonly attachments?: () => AttachmentStore | undefined
}

export class CodexAdapter extends LlmAdapter {
  private readonly client: AppServerClient
  private readonly cwd: string
  private readonly sandbox: CodexAdapterOptions['sandbox']
  private readonly approvalPolicy: CodexAdapterOptions['approvalPolicy']
  private readonly requestTimeoutMs: number
  private readonly attachments: (() => AttachmentStore | undefined) | undefined
  private readonly threads = new Map<string, ThreadState>()
  private readonly unregisterServerRequestHandler: () => void

  constructor(options: CodexAdapterOptions) {
    super()
    this.client = options.client
    this.cwd = options.cwd
    this.sandbox = options.sandbox
    this.approvalPolicy = options.approvalPolicy
    this.requestTimeoutMs = options.requestTimeoutMs
    this.attachments = options.attachments
    this.unregisterServerRequestHandler = this.client.registerServerRequestHandler(
      (request, signal) => this.handleServerRequest(request, signal),
    )
  }

  override providerInfo(provider: string): LlmProviderInfo {
    this.assertProvider(provider)
    return { id: CODEX_PROVIDER, name: 'My Codex' }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    this.assertProvider(provider)
    return undefined
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    this.assertProvider(provider)
    await this.requireLogin()
    const models = await this.client.listModels({ includeHidden: false })
    return models.filter((model) => !model.hidden).map((model) => this.modelInfo(model))
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    this.assertProvider(provider)
    await this.requireLogin(signal)
    const models = await this.client.listModels({
      includeHidden: true,
      ...requestOptions(signal),
      timeoutMs: this.requestTimeoutMs,
    })
    const found = models.find((candidate) => candidate.id === model || candidate.model === model)
    if (found === undefined) throw new LlmError(`Codex model "${model}" was not found`, 'UNKNOWN_MODEL')
    const info = this.modelInfo(found)
    return {
      ...info,
      context: { contextWindow: 128_000 },
      ...(found.reasoningEfforts.length === 0 ? {} : {
        reasoning: {
          efforts: found.reasoningEfforts.map((effort) => ({ id: ReasoningEffortId(effort.id), name: effort.id, description: effort.description })),
          defaultEffort: ReasoningEffortId(found.defaultReasoningEffort),
        },
      }),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.assertProvider(options.provider)
    const input = await this.buildUserInput(options.messages, options.signal)
    if (input.length === 0) throw new LlmError('Codex request has no user content', 'EMPTY_INPUT')
    await this.requireLogin(options.signal)

    if ((options.tools?.length ?? 0) > 0 && options.sessionId === undefined) {
      throw new LlmError('Dynamic tools require a persistent DSH session id', 'DYNAMIC_TOOLS_REQUIRE_SESSION')
    }
    const key = options.sessionId === undefined ? `ephemeral:${randomUUID()}` : String(options.sessionId)
    let state = this.threads.get(key)
    if (state === undefined) {
      const toolSpecs = buildToolSpecs(options.tools ?? [])
      const thread = await this.client.startThread({
        cwd: this.cwd,
        sandbox: this.sandbox,
        approvalPolicy: this.approvalPolicy,
        ...(toolSpecs.length === 0 ? {} : { dynamicTools: toolSpecs }),
      }, { ...requestOptions(options.signal), timeoutMs: this.requestTimeoutMs })
      state = {
        threadId: thread.id,
        toolNames: new Set(toolSpecs.map((tool) => tool.name)),
        pendingCalls: new Map(),
        queue: [],
        wake: undefined,
        unsubscribe: undefined,
        turnId: undefined,
      }
      this.threads.set(key, state)
    } else if ((options.tools?.length ?? 0) > 0) {
      const names = new Set((options.tools ?? []).map((tool) => tool.name))
      if (names.size !== state.toolNames.size || [...names].some((name) => !state?.toolNames.has(name))) {
        throw new LlmError('Dynamic tool catalog changed after the Codex thread started', 'DYNAMIC_TOOL_SCHEMA_DRIFT')
      }
    }

    if (state === undefined) throw new LlmError('Codex thread state was not created', 'CODEX_THREAD_STATE')
    const activeState: ThreadState = state
    if (activeState.unsubscribe === undefined) {
      activeState.unsubscribe = this.client.onNotification((notification) => {
        activeState.queue.push(notification)
        activeState.wake?.()
        activeState.wake = undefined
      })
    }
    const queue = activeState.queue
    const notify = (): Promise<void> => new Promise<void>((resolve) => { activeState.wake = resolve })
    const abort = () => { void this.interrupt(activeState.threadId, turnId) }
    let turnId = activeState.turnId ?? ''
    try {
      if (activeState.pendingCalls.size > 0) {
        resolveToolResults(activeState.pendingCalls, options.messages)
      } else {
        const turn = await this.client.startTurn(
          {
            threadId: activeState.threadId,
            input,
            model: options.model,
            ...(options.reasoningEffort === undefined ? {} : { effort: String(options.reasoningEffort) }),
          },
          { ...requestOptions(options.signal), timeoutMs: this.requestTimeoutMs },
        )
        turnId = turn.id
        activeState.turnId = turnId
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      let index = 0
      const blocks = new Map<number, { readonly kind: 'text' | 'reasoning'; text: string }>()
      let usage: CodexTokenUsageBreakdown | undefined
      while (true) {
        const notification = await nextNotification(queue, notify)
        if (notification.method === 'dsh/dynamic-tool-call') {
          const callId = typeof notification.params?.['callId'] === 'string' ? notification.params['callId'] : ''
          const pending = activeState.pendingCalls.get(callId)
          if (pending === undefined) continue
          const index = blocks.size
          const id = toolCallId(callId)
          const args = typeof notification.params?.['arguments'] === 'string' ? notification.params['arguments'] : '{}'
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index, id, ...(typeof notification.params?.['tool'] === 'string' ? { name: notification.params['tool'] } : {}), argumentsDelta: args }
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name: typeof notification.params?.['tool'] === 'string' ? notification.params['tool'] : 'unknown', arguments: args } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        if (notification.method === 'thread/tokenUsage/updated') {
          const parsed = parseTokenUsageNotification(notification.method, notification.params)
          if (parsed.params.turnId === turnId) usage = parsed.params.last
          continue
        }
        if (notification.method === 'item/agentMessage/delta' || notification.method === 'item/reasoning/summaryTextDelta' || notification.method === 'item/reasoning/textDelta') {
          const parsed = parseDeltaNotification(notification.method, notification.params)
          if (parsed.method !== 'item/agentMessage/delta' && parsed.method !== 'item/reasoning/summaryTextDelta' && parsed.method !== 'item/reasoning/textDelta') continue
          if (parsed.params.turnId !== turnId) continue
          const kind = parsed.method === 'item/agentMessage/delta' ? 'text' : 'reasoning'
          const existing = [...blocks.entries()].find(([, value]) => value.kind === kind)
          const blockIndex = existing?.[0] ?? index++
          if (existing === undefined) { blocks.set(blockIndex, { kind, text: '' }); yield { type: 'block-start', index: blockIndex, blockType: kind } }
          const block = blocks.get(blockIndex)
          if (block === undefined) continue
          block.text += parsed.params.delta
          yield kind === 'text' ? { type: 'text-delta', index: blockIndex, text: parsed.params.delta } : { type: 'reasoning-delta', index: blockIndex, text: parsed.params.delta }
          continue
        }
        if (notification.method !== 'turn/completed') continue
        const completed = parseDeltaNotification(notification.method, notification.params)
        if (completed.method !== 'turn/completed' || completed.params.turn.id !== turnId) continue
        for (const [blockIndex, block] of blocks) yield { type: 'block-end', index: blockIndex, block: { type: block.kind, text: block.text } }
        activeState.pendingCalls.clear()
        activeState.turnId = undefined
        if (usage !== undefined) yield usageChunk(usage)
        if (completed.params.turn.status === 'completed') {
          yield { type: 'finish', reason: { kind: 'stop' } }
        } else {
          yield { type: 'finish', reason: { kind: completed.params.turn.status === 'interrupted' ? 'aborted' : 'error', failure: { code: 'CODEX_TURN_FAILED', message: safeErrorMessage(completed.params.turn.error?.message ?? 'Codex turn failed') } } }
        }
        return
      }
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('Codex request was aborted', 'ABORTED')
      throw error instanceof LlmError ? error : new LlmError(safeErrorMessage(error), 'CODEX_APP_SERVER')
    } finally {
      options.signal?.removeEventListener('abort', abort)
      if (activeState.pendingCalls.size === 0 || options.sessionId === undefined) {
        activeState.unsubscribe?.()
        activeState.unsubscribe = undefined
      }
      if (options.sessionId === undefined) this.threads.delete(key)
    }
  }

  private async buildUserInput(
    messages: readonly RequestMessage[],
    signal: AbortSignal | undefined,
  ): Promise<readonly CodexUserInput[]> {
    const input: CodexUserInput[] = []
    const store = this.attachments?.()
    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'text') {
          if (block.text.length > 0) input.push({ type: 'text', text: block.text })
          continue
        }
        if (block.type === 'image') {
          if (store === undefined) throw new LlmError('Codex cannot read image attachments without an attachment store', 'UNSUPPORTED_CONTENT')
          input.push({ type: 'image', url: await imageDataUrl(store, block.attachment, signal) })
          continue
        }
        if (block.type === 'file') {
          if (store === undefined) throw new LlmError('Codex cannot read file attachments without an attachment store', 'UNSUPPORTED_CONTENT')
          input.push({ type: 'text', text: fileHandleText(block.attachment, store.fileHostPath(block.attachment)) })
          continue
        }
      }
    }
    return input
  }
  async readRateLimits(signal?: AbortSignal): Promise<JsonObject> {
    await this.requireLogin(signal)
    return this.client.readRateLimits({ ...requestOptions(signal), timeoutMs: this.requestTimeoutMs })
  }
  async close(): Promise<void> {
    this.unregisterServerRequestHandler()
    for (const state of this.threads.values()) {
      for (const pending of state.pendingCalls.values()) pending.reject(new LlmError('Codex adapter closed', 'ADAPTER_CLOSED'))
      state.unsubscribe?.()
    }
    this.threads.clear()
    await this.client.close()
  }



  private handleServerRequest(request: AppServerRequest, signal: AbortSignal): Promise<JsonValue> {
    if (request.method !== 'item/tool/call') return Promise.reject(new LlmError(`Unsupported Codex server request: ${request.method}`, 'UNSUPPORTED_SERVER_REQUEST'))
    const call = parseExperimentalDynamicToolCall(request.params)
    const state = [...this.threads.values()].find((candidate) => candidate.threadId === call.threadId)
    if (state === undefined || state.turnId !== call.turnId) return Promise.reject(new LlmError('Dynamic tool call has no active DSH thread', 'DYNAMIC_TOOL_STATE_LOST'))
    if (!state.toolNames.has(call.tool)) return Promise.reject(new LlmError(`Codex requested unknown dynamic tool "${call.tool}"`, 'DYNAMIC_TOOL_UNKNOWN'))
    if (state.pendingCalls.size >= 16) return Promise.reject(new LlmError('Dynamic tool pending-call limit exceeded', 'DYNAMIC_TOOL_PENDING_LIMIT'))
    const argumentText = JSON.stringify(call.arguments)
    if (Buffer.byteLength(argumentText, 'utf8') > MAX_DYNAMIC_TOOL_ARGUMENT_BYTES) return Promise.reject(new LlmError('Dynamic tool arguments are too large', 'DYNAMIC_TOOL_ARGUMENTS_TOO_LARGE'))
    return new Promise<JsonValue>((resolve, reject) => {
      const onAbort = (): void => {
        state.pendingCalls.delete(call.callId)
        reject(new LlmError('Dynamic tool call was aborted', 'ABORTED'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      state.pendingCalls.set(call.callId, {
        callId: call.callId,
        resolve: (result) => { if (state.pendingCalls.get(call.callId)?.responded === true) return; signal.removeEventListener('abort', onAbort); const pending = state.pendingCalls.get(call.callId); if (pending !== undefined) pending.responded = true; resolve(dynamicResultJson(result)) },
        reject: (error) => { signal.removeEventListener('abort', onAbort); state.pendingCalls.delete(call.callId); reject(error) },
        responded: false,
      })
      state.queue.push({ method: 'dsh/dynamic-tool-call', params: { callId: call.callId, tool: call.tool, arguments: argumentText } })
      state.wake?.()
      state.wake = undefined
    })
  }
  private async requireLogin(signal?: AbortSignal): Promise<void> {
    const account = await this.client.readAccount({ ...requestOptions(signal), timeoutMs: this.requestTimeoutMs })
    if (!account.authenticated || account.kind !== 'chatgpt') throw new LlmError('Codex ChatGPT login is required', 'AUTH')
  }

  private modelInfo(model: CodexModel): LlmModelInfo {
    return {
      provider: CODEX_PROVIDER,
      id: model.model,
      name: model.displayName,
      description: model.description,
      inputModalities: inputModalities(model),
    }
  }

  private assertProvider(provider: string): void {
    if (provider !== CODEX_PROVIDER) throw new LlmError(`Unknown provider: ${provider}`, 'INVALID_PROVIDER')
  }

  private async interrupt(threadId: string, turnId: string): Promise<void> {
    if (turnId.length === 0) return
    try { await this.client.interruptTurn({ threadId, turnId }, { timeoutMs: this.requestTimeoutMs }) } catch { /* cancellation is already authoritative */ }
  }
}

function buildToolSpecs(tools: readonly ToolSchema[]): readonly ExperimentalDynamicToolSpec[] {
  if (tools.length > MAX_DYNAMIC_TOOLS) throw new LlmError(`Dynamic tool catalog exceeds ${MAX_DYNAMIC_TOOLS} tools`, 'DYNAMIC_TOOL_CATALOG_LIMIT')
  return tools.map((tool) => {
    if (!DYNAMIC_TOOL_NAME.test(tool.name)) throw new LlmError(`Invalid dynamic tool name: ${tool.name}`, 'DYNAMIC_TOOL_NAME_INVALID')
    if (!isJsonValue(tool.parameters) || Array.isArray(tool.parameters)) throw new LlmError(`Invalid schema for dynamic tool: ${tool.name}`, 'DYNAMIC_TOOL_SCHEMA_INVALID')
    return { type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters as JsonObject }
  })
}

function resolveToolResults(pending: Map<string, PendingToolCall>, messages: readonly RequestMessage[]): void {
  const results = messages
    .map((message) => message as unknown as Record<string, unknown>)
    .filter((message) => message['role'] === 'tool')
  for (const raw of results) {
    const callId = typeof raw['toolCallId'] === 'string' ? raw['toolCallId'] : typeof (raw['source'] as Record<string, unknown> | undefined)?.['callId'] === 'string' ? (raw['source'] as Record<string, unknown>)['callId'] as string : ''
    const call = pending.get(callId)
    if (call === undefined || call.responded) continue
    const content = Array.isArray(raw['content']) ? raw['content'] : []
    const text = content.map((block) => {
      const value = block as Record<string, unknown>
      return value['type'] === 'text' && typeof value['text'] === 'string' ? value['text'] : ''
    }).join('')
    call.resolve({ contentItems: [{ type: 'inputText', text }], success: raw['isError'] !== true })
  }
  if ([...pending.values()].some((call) => !call.responded)) throw new LlmError(`Missing dynamic tool results for ${pending.size} call(s)`, 'DYNAMIC_TOOL_RESULT_MISSING')
}

function dynamicResultJson(result: ExperimentalDynamicToolResult): JsonObject {
  return {
    contentItems: result.contentItems.map((item) => item.type === 'inputText'
      ? { type: item.type, text: item.text }
      : item.type === 'inputImage'
        ? { type: item.type, imageUrl: item.imageUrl }
        : { type: item.type, audioUrl: item.audioUrl }),
    success: result.success,
  }
}


function requestOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal }
}


async function nextNotification(queue: Notification[], wait: () => Promise<void>): Promise<Notification> {
  while (queue.length === 0) await wait()
  return queue.shift() as Notification
}

const IMAGE_REQUEST_TARGET = { width: 2_000, height: 2_000, maxBytes: 5 * 1024 * 1024 } as const

export function fileHandleText(ref: { readonly name: string; readonly bytes: number; readonly attachmentId: string }, readonlyPath: string | undefined): string {
  const path = readonlyPath ?? ref.attachmentId
  return `[Attached file: ${ref.name}, ${ref.bytes} bytes, read-only path: ${path}]`
}


export async function imageDataUrl(
  store: AttachmentStore,
  ref: ImageAttachmentRef,
  signal: AbortSignal | undefined,
): Promise<string> {
  const image = await store.readImageRequest(ref, IMAGE_REQUEST_TARGET, signal)
  const bytes = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  return `data:${image.mediaType};base64,${bytes.toString('base64')}`
}

function inputModalities(model: CodexModel): readonly ModelModality[] {
  const declared = model.inputModalities.filter((value): value is ModelModality => value === 'text' || value === 'image')
  return declared.includes('text') ? declared : ['text', ...declared]
}

function usageChunk(usage: CodexTokenUsageBreakdown): StreamChunk {
  return { type: 'usage', usage: { inputTokens: Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens), outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cacheReadTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteInputTokens, reasoningTokens: usage.reasoningOutputTokens } }
}
