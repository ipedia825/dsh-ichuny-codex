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
import type { CodexModel, CodexTokenUsageBreakdown, CodexUserInput, ExperimentalDynamicToolSpec, ExperimentalDynamicToolOutput, ExperimentalDynamicToolResult, JsonObject, JsonValue } from './app-server/types.js'

export const CODEX_PROVIDER = 'my-codex'

type Notification = Parameters<Parameters<AppServerClient['onNotification']>[0]>[0]

type PendingToolCall = {
  readonly callId: string
  readonly name: string
  readonly argumentsText: string
  readonly resolve: (result: ExperimentalDynamicToolResult) => void
  readonly reject: (error: Error) => void
  responded: boolean
  exposed: boolean
}

type ThreadState = {
  threadId: string
  cwd: string
  toolNames: ReadonlySet<string>
  catalogFingerprint: string
  baseInstructions: string
  readonly pendingCalls: Map<string, PendingToolCall>
  readonly queue: Notification[]
  wake: (() => void) | undefined
  unsubscribe: (() => void) | undefined
  turnId: string | undefined
  lastUserMessageId: string | undefined
  pendingUserMessageId: string | undefined
}

const MAX_DYNAMIC_TOOLS = 128
const MAX_DYNAMIC_TOOL_ARGUMENT_BYTES = 262_144
const MAX_DYNAMIC_TOOL_CALL_ID_BYTES = 256
const MAX_DYNAMIC_TOOL_RESULT_BYTES = 4 * 1024 * 1024
const MAX_DYNAMIC_TOOL_IMAGES = 8
function dshToolInstructions(cwd: string): string {
  return `This DSH session supplies run_code as its coding tool. The current Codex thread working directory is ${JSON.stringify(cwd)}. The app-server process directory is not the session workspace or a writable-root grant. For requests to inspect project files or implement code, attempt run_code before reporting that tools failed or merely restating the task. Do not claim that a write or approval failed unless the tool actually returned that failure. Respect all DSH sandbox and approval decisions; report actual tool errors rather than inventing them.`
}
const DYNAMIC_TOOL_NAME = /^[A-Za-z0-9_-]+$/u

function codexError(message: string, code: string): LlmError {
  // rc.3 narrows the type, but both SDK constructors accept provider codes at runtime.
  return new LlmError(message, code as ConstructorParameters<typeof LlmError>[1])
}

export interface CodexAdapterOptions {
  readonly client: AppServerClient
  readonly cwd: string
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly approvalPolicy: 'never' | 'on-request' | 'untrusted'
  readonly requestTimeoutMs: number
  readonly sessionCwd?: (sessionId: GenerateOptions['sessionId']) => string | undefined
  readonly attachments?: () => AttachmentStore | undefined
}

export class CodexAdapter extends LlmAdapter {
  private readonly client: AppServerClient
  private readonly cwd: string
  private readonly sessionCwd: ((sessionId: GenerateOptions['sessionId']) => string | undefined) | undefined
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
    this.sessionCwd = options.sessionCwd
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

  async *stream(options: GenerateOptions<string>): AsyncIterable<StreamChunk> {
    this.assertProvider(options.provider)
    const auxiliary = options.purpose !== undefined
    const key = auxiliary || options.sessionId === undefined ? `ephemeral:${randomUUID()}` : String(options.sessionId)
    let state = this.threads.get(key)
    const replay = state === undefined && !auxiliary && options.sessionId !== undefined ? replayCandidate(options.messages) : undefined
    const pendingTools = (state?.pendingCalls.size ?? 0) > 0
    const freshMessages = pendingTools ? [] : auxiliary ? options.messages : newUserMessages(options.messages, state?.lastUserMessageId ?? replay?.lastUserMessageId)
    const input = pendingTools ? [] : auxiliary ? await this.buildAuxiliaryInput(freshMessages, options.signal) : await this.buildUserInput(freshMessages, options.signal)
    const baseInstructions = systemInstructions(options)
    const cwd = this.sessionCwd?.(options.sessionId) ?? this.cwd
    const updatedContext = state !== undefined && !pendingTools && (
      toolCatalogFingerprint(buildToolSpecs(options.tools ?? [])) !== state.catalogFingerprint
      || baseInstructions !== state.baseInstructions
      || cwd !== state.cwd
    )
    if (input.length === 0 && !pendingTools && !updatedContext) throw codexError('Codex request has no new user content', 'EMPTY_INPUT')
    await this.requireLogin(options.signal)

    if ((options.tools?.length ?? 0) > 0 && options.sessionId === undefined && !auxiliary) {
      throw codexError('Dynamic tools require a persistent DSH session id', 'DYNAMIC_TOOLS_REQUIRE_SESSION')
    }
    if (state === undefined) {
      const toolSpecs = buildToolSpecs(auxiliary ? [] : options.tools ?? [])
      const threadOptions = {
        cwd,
        sandbox: auxiliary ? 'read-only' as const : this.sandbox,
        approvalPolicy: auxiliary ? 'never' as const : this.approvalPolicy,
        ...(baseInstructions.length === 0 ? {} : { baseInstructions }),
        ...(toolSpecs.some((tool) => tool.name === 'run_code') ? { developerInstructions: dshToolInstructions(cwd) } : {}),
        ...(toolSpecs.length === 0 ? {} : { dynamicTools: toolSpecs }),
      }
      const thread = replay === undefined
        ? await this.client.startThread(threadOptions, { ...requestOptions(options.signal), timeoutMs: this.requestTimeoutMs })
        : await this.client.resumeThread({ ...threadOptions, threadId: replay.threadId, dynamicTools: toolSpecs }, { ...requestOptions(options.signal), timeoutMs: this.requestTimeoutMs })
      if (replay !== undefined && thread.id !== replay.threadId) {
        throw codexError('Codex did not resume the original thread; refusing to lose previous task context', 'SESSION_THREAD_MISMATCH')
      }
      state = {
        threadId: thread.id,
        cwd,
        toolNames: new Set(toolSpecs.map((tool) => tool.name)),
        catalogFingerprint: toolCatalogFingerprint(toolSpecs),
        baseInstructions,
        pendingCalls: new Map(),
        queue: [],
        wake: undefined,
        unsubscribe: undefined,
        turnId: undefined,
        lastUserMessageId: replay?.lastUserMessageId,
        pendingUserMessageId: undefined,
      }
      this.threads.set(key, state)
    } else if (state.pendingCalls.size === 0) {
      const toolSpecs = buildToolSpecs(options.tools ?? [])
      const fingerprint = toolCatalogFingerprint(toolSpecs)
      if (fingerprint !== state.catalogFingerprint || baseInstructions !== state.baseInstructions || cwd !== state.cwd) {
        if (state.turnId !== undefined) {
          throw codexError('Codex turn has not completed; cannot replace thread context', 'SESSION_BUSY')
        }
        const resumed = await this.client.resumeThread({
          threadId: state.threadId,
          cwd,
          sandbox: this.sandbox,
          approvalPolicy: this.approvalPolicy,
          baseInstructions,
          ...(toolSpecs.some((tool) => tool.name === 'run_code') ? { developerInstructions: dshToolInstructions(cwd) } : {}),
          dynamicTools: toolSpecs,
        }, { ...requestOptions(options.signal), timeoutMs: this.requestTimeoutMs })
        state.threadId = resumed.id
        state.cwd = cwd
        state.toolNames = new Set(toolSpecs.map((tool) => tool.name))
        state.catalogFingerprint = fingerprint
        state.baseInstructions = baseInstructions
      }
    }

    if (state === undefined) throw codexError('Codex thread state was not created', 'CODEX_THREAD_STATE')
    const activeState: ThreadState = state
    if (activeState.unsubscribe === undefined) {
      activeState.unsubscribe = this.client.onNotification((notification) => {
        const threadId = notification.params?.['threadId']
        if (threadId !== undefined && threadId !== activeState.threadId) return
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
        try {
          await resolveToolResults(activeState.pendingCalls, options.messages, this.attachments?.(), options.signal)
        } catch (error) {
          const failure = error instanceof Error ? error : codexError(safeErrorMessage(error), 'DYNAMIC_TOOL_RESULT_INVALID')
          for (const pending of [...activeState.pendingCalls.values()]) {
            if (!pending.responded) pending.reject(failure)
          }
          activeState.pendingCalls.clear()
          activeState.turnId = undefined
          activeState.pendingUserMessageId = undefined
          await this.interrupt(activeState.threadId, turnId)
          throw failure
        }
      } else {
        const turn = await this.client.startTurn(
          {
            threadId: activeState.threadId,
            input: input.length > 0 ? input : [{ type: 'text', text: 'Continue with the updated instructions and tools.' }],
            model: options.model,
            ...(options.reasoningEffort === undefined ? {} : { effort: String(options.reasoningEffort) }),
          },
          { ...requestOptions(options.signal), timeoutMs: this.requestTimeoutMs },
        )
        turnId = turn.id
        activeState.turnId = turnId
        const lastUser = freshMessages.at(-1)
        if (lastUser?.role === 'user' && lastUser.id !== undefined) activeState.pendingUserMessageId = String(lastUser.id)
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      let index = 0
      const blocks = new Map<number, { readonly kind: 'text' | 'reasoning'; text: string }>()
      let usage: CodexTokenUsageBreakdown | undefined
      while (true) {
        const notification = await nextNotification(queue, notify)
        if (notification.method === 'dsh/dynamic-tool-call') {
          const calls = [...activeState.pendingCalls.values()].filter((call) => !call.exposed && !call.responded)
          if (calls.length === 0) continue
          for (const call of calls) call.exposed = true
          for (const [offset, call] of calls.entries()) {
            const index = blocks.size + offset
            const id = toolCallId(call.callId)
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.argumentsText }
            yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: call.argumentsText } }
          }
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
          activeState.lastUserMessageId = activeState.pendingUserMessageId ?? activeState.lastUserMessageId
          activeState.pendingUserMessageId = undefined
          yield {
            type: 'finish',
            reason: { kind: 'stop' },
            ...(options.sessionId === undefined || auxiliary ? {} : { replayState: { response: {
              version: 1, threadId: activeState.threadId,
              lastUserMessageId: activeState.lastUserMessageId ?? null,
            } } }),
          }
        } else {
          activeState.pendingUserMessageId = undefined
          yield { type: 'finish', reason: { kind: completed.params.turn.status === 'interrupted' ? 'aborted' : 'error', failure: { code: 'CODEX_TURN_FAILED', message: safeErrorMessage(completed.params.turn.error?.message ?? 'Codex turn failed') } } }
        }
        return
      }
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('Codex request was aborted', 'ABORTED')
      throw error instanceof LlmError ? error : codexError(safeErrorMessage(error), 'CODEX_APP_SERVER')
    } finally {
      options.signal?.removeEventListener('abort', abort)
      if (activeState.pendingCalls.size === 0 || auxiliary || options.sessionId === undefined) {
        activeState.unsubscribe?.()
        activeState.unsubscribe = undefined
      }
      if (auxiliary || options.sessionId === undefined) this.threads.delete(key)
    }
  }

  private async buildAuxiliaryInput(messages: readonly RequestMessage[], signal: AbortSignal | undefined): Promise<readonly CodexUserInput[]> {
    const input: CodexUserInput[] = []
    for (const message of messages) {
      if (message.role === 'system' || message.role === 'developer') continue
      if (message.role === 'user') {
        input.push(...await this.buildUserInput([message], signal))
        continue
      }
      const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
      if (text.length > 0) input.push({ type: 'text', text: `${message.role}: ${text}` })
    }
    return input
  }

  private async buildUserInput(
    messages: readonly RequestMessage[],
    signal: AbortSignal | undefined,
  ): Promise<readonly CodexUserInput[]> {
    const input: CodexUserInput[] = []
    const store = this.attachments?.()
    const userMessages = messages.filter((message) => message.role === 'user')
    const ordered = [
      ...userMessages.filter((message) => message.source !== undefined && message.source.kind !== 'user'),
      ...userMessages.filter((message) => message.source === undefined || message.source.kind === 'user'),
    ]
    for (const message of ordered) {
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
      for (const pending of state.pendingCalls.values()) pending.reject(codexError('Codex adapter closed', 'ADAPTER_CLOSED'))
      state.unsubscribe?.()
    }
    this.threads.clear()
    await this.client.close()
  }



  private handleServerRequest(request: AppServerRequest, signal: AbortSignal): Promise<JsonValue> {
    if (request.method !== 'item/tool/call') return Promise.reject(codexError(`Unsupported Codex server request: ${request.method}`, 'UNSUPPORTED_SERVER_REQUEST'))
    const call = parseExperimentalDynamicToolCall(request.params)
    const state = [...this.threads.values()].find((candidate) => candidate.threadId === call.threadId)
    if (state === undefined || state.turnId !== call.turnId) return Promise.reject(codexError('Dynamic tool call has no active DSH thread', 'DYNAMIC_TOOL_STATE_LOST'))
    if (!state.toolNames.has(call.tool)) return Promise.reject(codexError(`Codex requested unknown dynamic tool "${call.tool}"`, 'DYNAMIC_TOOL_UNKNOWN'))
    if (Buffer.byteLength(call.callId, 'utf8') > MAX_DYNAMIC_TOOL_CALL_ID_BYTES) return Promise.reject(codexError('Dynamic tool call id is too large', 'DYNAMIC_TOOL_CALL_ID_TOO_LARGE'))
    if (state.pendingCalls.has(call.callId)) return Promise.reject(codexError('Duplicate dynamic tool call id', 'DYNAMIC_TOOL_DUPLICATE'))
    if (signal.aborted) return Promise.reject(new LlmError('Dynamic tool call was aborted', 'ABORTED'))
    if ([...state.pendingCalls.values()].filter((pending) => !pending.responded).length >= 16) return Promise.reject(codexError('Dynamic tool pending-call limit exceeded', 'DYNAMIC_TOOL_PENDING_LIMIT'))
    const argumentText = JSON.stringify(call.arguments)
    if (Buffer.byteLength(argumentText, 'utf8') > MAX_DYNAMIC_TOOL_ARGUMENT_BYTES) return Promise.reject(codexError('Dynamic tool arguments are too large', 'DYNAMIC_TOOL_ARGUMENTS_TOO_LARGE'))
    return new Promise<JsonValue>((resolve, reject) => {
      const onAbort = (): void => {
        state.pendingCalls.delete(call.callId)
        reject(new LlmError('Dynamic tool call was aborted', 'ABORTED'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      state.pendingCalls.set(call.callId, {
        callId: call.callId,
        name: call.tool,
        argumentsText: argumentText,
        resolve: (result) => { if (state.pendingCalls.get(call.callId)?.responded === true) return; signal.removeEventListener('abort', onAbort); const pending = state.pendingCalls.get(call.callId); if (pending !== undefined) pending.responded = true; resolve(dynamicResultJson(result)) },
        reject: (error) => { signal.removeEventListener('abort', onAbort); state.pendingCalls.delete(call.callId); reject(error) },
        responded: false,
        exposed: false,
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
    if (provider !== CODEX_PROVIDER) throw codexError(`Unknown provider: ${provider}`, 'INVALID_PROVIDER')
  }

  private async interrupt(threadId: string, turnId: string): Promise<void> {
    if (turnId.length === 0) return
    try { await this.client.interruptTurn({ threadId, turnId }, { timeoutMs: this.requestTimeoutMs }) } catch { /* cancellation is already authoritative */ }
  }
}

function buildToolSpecs(tools: readonly ToolSchema[]): readonly ExperimentalDynamicToolSpec[] {
  if (tools.length > MAX_DYNAMIC_TOOLS) throw codexError(`Dynamic tool catalog exceeds ${MAX_DYNAMIC_TOOLS} tools`, 'DYNAMIC_TOOL_CATALOG_LIMIT')
  const names = new Set<string>()
  return tools.map((tool) => {
    if (!DYNAMIC_TOOL_NAME.test(tool.name)) throw codexError(`Invalid dynamic tool name: ${tool.name}`, 'DYNAMIC_TOOL_NAME_INVALID')
    if (names.has(tool.name)) throw codexError(`Duplicate dynamic tool name: ${tool.name}`, 'DYNAMIC_TOOL_DUPLICATE_NAME')
    names.add(tool.name)
    if (!isJsonValue(tool.parameters) || Array.isArray(tool.parameters)) throw codexError(`Invalid schema for dynamic tool: ${tool.name}`, 'DYNAMIC_TOOL_SCHEMA_INVALID')
    return { type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters as JsonObject, ...(tool.deferLoading === true ? { deferLoading: true } : {}) }
  })
}

function toolCatalogFingerprint(specs: readonly ExperimentalDynamicToolSpec[]): string {
  return JSON.stringify([...specs].sort((left, right) => left.name.localeCompare(right.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    deferLoading: tool.deferLoading === true,
    schema: sortedJson(tool.inputSchema),
  })))
}

function sortedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value === null || typeof value !== 'object') return value
  const sorted: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const key of Object.keys(value).sort()) {
    const child = value[key]
    if (child !== undefined) sorted[key] = sortedJson(child)
  }
  return sorted
}

async function resolveToolResults(
  pending: Map<string, PendingToolCall>,
  messages: readonly RequestMessage[],
  store: AttachmentStore | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const batch = new Map<string, { readonly call: PendingToolCall; readonly result: ExperimentalDynamicToolResult }>()
  let totalBytes = 0
  let imageCount = 0
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const call = pending.get(message.toolCallId)
    if (call === undefined || call.responded || !call.exposed) continue
    if (batch.has(call.callId)) throw codexError(`Duplicate dynamic tool result: ${call.callId}`, 'DYNAMIC_TOOL_RESULT_DUPLICATE')
    const contentItems: ExperimentalDynamicToolOutput[] = []
    for (const block of message.content) {
      if (block.type === 'text') {
        totalBytes += Buffer.byteLength(block.text, 'utf8')
        contentItems.push({ type: 'inputText', text: block.text })
      } else if (block.type === 'image') {
        if (store === undefined) throw codexError('Dynamic tool image result requires a DSH attachment store', 'DYNAMIC_TOOL_IMAGE_UNAVAILABLE')
        if (++imageCount > MAX_DYNAMIC_TOOL_IMAGES) throw codexError('Dynamic tool image count exceeded', 'DYNAMIC_TOOL_RESULT_TOO_LARGE')
        const imageUrl = await imageDataUrl(store, block.attachment, signal)
        totalBytes += Buffer.byteLength(imageUrl, 'utf8')
        contentItems.push({ type: 'inputImage', imageUrl })
      } else {
        throw codexError(`Dynamic tool result block "${block.type}" is unsupported`, 'DYNAMIC_TOOL_RESULT_UNSUPPORTED')
      }
      if (totalBytes > MAX_DYNAMIC_TOOL_RESULT_BYTES) throw codexError('Dynamic tool result batch is too large', 'DYNAMIC_TOOL_RESULT_TOO_LARGE')
    }
    batch.set(call.callId, { call, result: { contentItems, success: message.isError !== true } })
  }
  const missing = [...pending.values()].filter((call) => call.exposed && !call.responded && !batch.has(call.callId))
  if (missing.length > 0) {
    throw codexError(`Missing dynamic tool results for ${missing.length} exposed call(s)`, 'DYNAMIC_TOOL_RESULT_MISSING')
  }
  for (const { call, result } of batch.values()) call.resolve(result)
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


function systemInstructions(options: GenerateOptions<string>): string {
  return options.system ?? options.messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => message.content)
    .filter((block) => block.type === 'text')
    .map((block) => block.text).join('\n\n')
}

function replayCandidate(messages: readonly RequestMessage[]): { readonly threadId: string; readonly lastUserMessageId?: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || message.source.provider !== CODEX_PROVIDER) continue
    const envelope = message.source.replayState
    if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return undefined
    const response = 'response' in envelope ? envelope.response : undefined
    if (response === null || typeof response !== 'object' || Array.isArray(response)) return undefined
    if (!('version' in response) || response.version !== 1 || !('threadId' in response) || typeof response.threadId !== 'string' || response.threadId.length === 0) return undefined
    const cursor = 'lastUserMessageId' in response ? response.lastUserMessageId : undefined
    if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor.length === 0)) return undefined
    return { threadId: response.threadId, ...(typeof cursor === 'string' ? { lastUserMessageId: cursor } : {}) }
  }
  return undefined
}

function newUserMessages(messages: readonly RequestMessage[], cursor: string | undefined): RequestMessage[] {
  let from = 0
  if (cursor !== undefined) {
    const index = messages.findIndex((message) => message.role === 'user' && message.id === cursor)
    if (index >= 0) {
      from = index + 1
    } else {
      const lastAnswered = messages.findLastIndex((message) => message.role === 'assistant' && message.source.provider === CODEX_PROVIDER)
      if (lastAnswered < 0) throw codexError('Codex input cursor is missing after history compaction', 'SESSION_CURSOR_MISSING')
      from = lastAnswered + 1
    }
  }
  return messages.slice(from).filter((message) => message.role === 'user')
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
