import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import z from '@deepseek-ai/schemastery'

import { bundledCodexCommand } from './codex-command.js'
import { childEnvironment } from './child-environment.js'
import { AppServerClient, DEFAULT_CLIENT_INFO } from './app-server/client.js'
import { safeErrorMessage } from './app-server/redaction.js'
import { ChildProcessTransport } from './app-server/transport.js'
import { CodexAdapter, CODEX_PROVIDER } from './adapter.js'
import { OAuthCodexAdapter, CODEX_OAUTH_PROVIDER } from './oauth-adapter.js'
import { OAuthAppServerRuntime, OAUTH_RUNTIME_SERVICE } from './siwc/app-server-runtime.js'
import { SiwcCredentialManager } from './siwc/credential-manager.js'
import { SIWC_CREDENTIAL_KEY } from './siwc/flow.js'
import { parseSiwcGrantRecord } from './siwc/grant.js'
import { registerSiwcAuthorizationFlow } from './siwc/flow.js'
import type { JsonObject, JsonValue } from './app-server/types.js'

export const name = 'dsh-ichuny-codex'
export const inject = ['llm', 'credentials', 'authorization']

export type ConnectionPreference = 'local' | 'oauth'

export interface Config {
  readonly command?: string
  readonly cwd?: string
  readonly sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly approvalPolicy?: 'never' | 'on-request' | 'untrusted'
  readonly requestTimeoutMs?: number
  readonly preferredConnection?: Volatile<ConnectionPreference>
}

export const Config = z.object({
  command: z.string().default('bundled'),
  cwd: z.string(),
  sandbox: z.union([z.const('read-only'), z.const('workspace-write'), z.const('danger-full-access')]).default('workspace-write'),
  approvalPolicy: z.union([z.const('never'), z.const('on-request'), z.const('untrusted')]).default('untrusted'),
  requestTimeoutMs: z.number().min(1_000).max(300_000).default(30_000),
  preferredConnection: z.union([z.const('local'), z.const('oauth')]).default('local').volatile(),
})

export interface ResolvedConfig {
  readonly command: string
  readonly cwd: string
  readonly sandbox: NonNullable<Config['sandbox']>
  readonly approvalPolicy: NonNullable<Config['approvalPolicy']>
  readonly requestTimeoutMs: number
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const command = config.command === undefined || config.command === 'bundled' ? bundledCodexCommand() : config.command
  const cwd = config.cwd ?? process.cwd()
  const requestTimeoutMs = config.requestTimeoutMs ?? 30_000
  if (command.trim().length === 0) throw new TypeError('command must not be empty')
  if (cwd.trim().length === 0) throw new TypeError('cwd must not be empty')
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 300_000) throw new RangeError('requestTimeoutMs must be between 1000 and 300000')
  return { command, cwd, sandbox: config.sandbox ?? 'workspace-write', approvalPolicy: config.approvalPolicy ?? 'untrusted', requestTimeoutMs }
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.effect(() => registerSiwcAuthorizationFlow(ctx, { agentName: DEFAULT_CLIENT_INFO.name }), `${name}: register SIWC authorization flow`)
  const client = new AppServerClient({
    experimentalApi: true,
    transport: new ChildProcessTransport({ command: resolved.command, cwd: resolved.cwd, env: childEnvironment(process.env) }),
    requestTimeoutMs: resolved.requestTimeoutMs,
  })
  let attachments: AttachmentStore | undefined
  let sessions: SessionStore | undefined
  let workingDirectory: WorkingDirectoryService | undefined
  ctx.inject(['sessions'], (sessionCtx) => {
    sessions = sessionCtx.sessions
    sessionCtx.effect(() => () => { sessions = undefined }, `${name}: detach sessions`)
  })
  ctx.inject(['workingDirectory'], (directoryCtx) => {
    workingDirectory = directoryCtx.workingDirectory
    directoryCtx.effect(() => () => { workingDirectory = undefined }, `${name}: detach working directory`)
  })
  ctx.inject(['attachments'], (attachmentCtx) => {
    attachments = attachmentCtx.attachments
    attachmentCtx.effect(() => () => { attachments = undefined }, `${name}: detach attachments`)
  })
  const sessionCwd = (sessionId: Parameters<NonNullable<ConstructorParameters<typeof CodexAdapter>[0]['sessionCwd']>>[0]): string | undefined => {
    if (config.cwd !== undefined || sessionId === undefined) return undefined
    const session = sessions?.get(SessionId(String(sessionId)))
    if (session === undefined) return undefined
    return workingDirectory?.get(session) ?? session.header.cwd
  }
  const adapter = new CodexAdapter({
    client,
    cwd: resolved.cwd,
    sandbox: resolved.sandbox,
    approvalPolicy: resolved.approvalPolicy,
    requestTimeoutMs: resolved.requestTimeoutMs,
    sessionCwd,
    attachments: () => attachments,
  })
  const oauthRuntime = new OAuthAppServerRuntime({
    manager: new SiwcCredentialManager(ctx.credentials),
    command: resolved.command,
    cwd: resolved.cwd,
    requestTimeoutMs: resolved.requestTimeoutMs,
  })
  ctx.provide(OAUTH_RUNTIME_SERVICE, oauthRuntime)
  ctx.on('credentials/record-updated', (key) => {
    if (key !== SIWC_CREDENTIAL_KEY) return
    void (async () => {
      try {
        if (parseSiwcGrantRecord(await ctx.credentials.readRecord(key)) !== undefined) return
      } catch { /* Invalid credentials must not leave a running OAuth child. */ }
      await oauthRuntime.close()
    })().catch(error => { ctx.logger.warn('OAuth app-server close failed: %s', safeErrorMessage(error)) })
  })
  const oauthAdapter = new OAuthCodexAdapter({
    runtime: oauthRuntime,
    cwd: resolved.cwd,
    sandbox: resolved.sandbox,
    approvalPolicy: resolved.approvalPolicy,
    requestTimeoutMs: resolved.requestTimeoutMs,
    sessionCwd,
    attachments: () => attachments,
  })
  ctx.inject(['webServer'], (webCtx) => {
    const webServer: WebServer = webCtx.webServer
    webCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/dsh-ichuny-codex/rate-limits',
      resource: async () => {
        try {
          const snapshot = await adapter.readRateLimits()
          return new Response(JSON.stringify(rateLimitSummary(snapshot)), {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
        } catch (error) {
          return new Response(JSON.stringify({ error: safeErrorMessage(error) }), {
            status: 503,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
        }
      },
    }), `${name}: rate limit route`)
    webCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/dsh-ichuny-codex/connection-status',
      resource: async () => {
        try {
          return jsonResponse(await localConnectionSummary(client))
        } catch (error) {
          return jsonResponse({
            status: 'error',
            error: safeErrorMessage(error),
            checkedAt: Date.now(),
          }, 503)
        }
      },
    }), `${name}: connection status route`)
  })
  ctx.effect(() => {
    const unregister = ctx.llm.registerAdapter([CODEX_PROVIDER], adapter)
    return async () => { unregister(); await adapter.close() }
  }, `${name}: register Codex provider`)
  ctx.effect(() => {
    const unregister = ctx.llm.registerAdapter([CODEX_OAUTH_PROVIDER], oauthAdapter)
    return async () => { unregister(); await oauthAdapter.close() }
  }, `${name}: register OAuth Codex provider`)
}

async function localConnectionSummary(client: AppServerClient): Promise<JsonObject> {
  const checkedAt = Date.now()
  const account = await client.readAccount()
  if (!account.authenticated || account.kind !== 'chatgpt') {
    return { status: 'signed-out', modelCount: 0, quota: null, checkedAt }
  }
  const models = await client.listModels()
  let quota: JsonValue = null
  try {
    const summary = rateLimitSummary(await client.readRateLimits())
    if (summary['available'] === true) quota = summary
  } catch {
    // Connection state and model discovery remain useful when quota is unavailable.
  }
  return {
    status: 'connected',
    modelCount: models.filter(model => !model.hidden).length,
    quota,
    checkedAt,
  }
}

function jsonResponse(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function rateLimitSummary(snapshot: JsonObject): JsonObject {
  const limits = snapshot['rateLimits']
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) return { available: false }
  const primary = limits['primary']
  const secondary = limits['secondary']
  const credits = limits['credits']
  return {
    available: true,
    planType: typeof limits['planType'] === 'string' ? limits['planType'] : null,
    primary: rateWindowSummary(primary),
    secondary: rateWindowSummary(secondary),
    credits: credits !== null && typeof credits === 'object' && !Array.isArray(credits) ? {
      hasCredits: credits['hasCredits'] === true,
      unlimited: credits['unlimited'] === true,
      balance: typeof credits['balance'] === 'string' ? credits['balance'] : null,
    } : null,
  }
}

function rateWindowSummary(value: JsonValue | undefined): JsonValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    usedPercent: typeof value['usedPercent'] === 'number' ? value['usedPercent'] : null,
    resetsAt: typeof value['resetsAt'] === 'number' ? value['resetsAt'] : null,
    windowDurationMins: typeof value['windowDurationMins'] === 'number' ? value['windowDurationMins'] : null,
  }
}

export { childEnvironment } from './child-environment.js'
export { CodexAdapter, CODEX_PROVIDER } from './adapter.js'
export { OAuthCodexAdapter, CODEX_OAUTH_PROVIDER } from './oauth-adapter.js'
export { AppServerClient } from './app-server/client.js'
export { ChildProcessTransport } from './app-server/transport.js'
export type * from './app-server/types.js'
