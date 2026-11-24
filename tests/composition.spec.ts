import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo, CredentialRef } from '@deepseek-ai/dsh-credentials'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'

import { CODEX_PROVIDER, CodexAdapter } from '../src/adapter.js'
import { AppServerClient } from '../src/app-server/client.js'
import { bundledCodexCommand } from '../src/codex-command.js'
import {
  apply,
  childEnvironment,
  name,
  resolveConfig,
} from '../src/index.js'
import * as DshCodexPlugin from '../src/index.js'
import SiwcRemoteController from '../src/oauth-controller.js'
import { CODEX_OAUTH_PROVIDER, OAuthCodexAdapter } from '../src/oauth-adapter.js'
import { TYPERT } from '../src/typert.js'

class TestCredentialProvider extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  async resolve(_ref: CredentialRef): Promise<undefined> { return undefined }
  async describe(_ref: CredentialRef): Promise<CredentialInfo> { return { configured: false, writable: true } }
  async set(_ref: CredentialRef, _value: string): Promise<void> {}
  async unset(_ref: CredentialRef): Promise<void> {}
  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return this.records.get(key) }
  async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this.records.get(key)
    return { configured: record !== undefined, ...(record === undefined ? {} : { kind: record.kind }), writable: true }
  }
  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return [...this.records].map(([key, record]) => ({ key, kind: record.kind }))
  }
  async modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> {
    const current = this.records.get(key)
    const next = await mutate(current)
    if (next !== undefined) { this.records.set(key, next); this.notifyRecordUpdated(key); return next }
    return current
  }
  async deleteRecord(key: CredentialKey): Promise<void> { this.records.delete(key); this.notifyRecordUpdated(key) }
}

interface TestContext {
  readonly llm: { readonly registerAdapter: ReturnType<typeof vi.fn> }
  readonly authorization: { readonly registerFlow: ReturnType<typeof vi.fn> }
  readonly credentials: { readonly readRecord: ReturnType<typeof vi.fn> }
  readonly inject: ReturnType<typeof vi.fn>
  readonly effect: ReturnType<typeof vi.fn>
  readonly provide: ReturnType<typeof vi.fn>
  readonly on: ReturnType<typeof vi.fn>
}

function createContext(): TestContext {
  return {
    llm: { registerAdapter: vi.fn(() => vi.fn()) },
    authorization: { registerFlow: vi.fn(() => vi.fn()) },
    credentials: { readRecord: vi.fn(async () => undefined) },
    inject: vi.fn(),
    provide: vi.fn(() => vi.fn()),
    on: vi.fn(() => vi.fn()),
    effect: vi.fn((execute: () => (() => void) | (() => Promise<void>)) => {
      execute()
      return vi.fn()
    }),
  }
}

describe('current plugin configuration', () => {
  it('resolves only the supported defaults', () => {
    const config = resolveConfig()

    expect(config).toEqual({
      command: bundledCodexCommand(),
      cwd: process.cwd(),
      sandbox: 'workspace-write',
      approvalPolicy: 'untrusted',
      requestTimeoutMs: 30_000,
    })
    expect(Object.keys(config)).toEqual([
      'command',
      'cwd',
      'sandbox',
      'approvalPolicy',
      'requestTimeoutMs',
    ])
    expect(existsSync(config.command)).toBe(true)
  })

  it('accepts the supported overrides and rejects invalid values', () => {
    expect(resolveConfig({
      command: 'C:\\codex.exe',
      cwd: 'C:\\workspace',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      requestTimeoutMs: 1_000,
    })).toEqual({
      command: 'C:\\codex.exe',
      cwd: 'C:\\workspace',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      requestTimeoutMs: 1_000,
    })

    expect(() => resolveConfig({ command: '   ' })).toThrow('command must not be empty')
    expect(() => resolveConfig({ cwd: '   ' })).toThrow('cwd must not be empty')
    expect(() => resolveConfig({ requestTimeoutMs: 999 })).toThrow('requestTimeoutMs')
    expect(() => resolveConfig({ requestTimeoutMs: 300_001 })).toThrow('requestTimeoutMs')
    expect(() => resolveConfig({ requestTimeoutMs: 1_000.5 })).toThrow('requestTimeoutMs')
  })

  it('does not expose obsolete configuration fields', () => {
    const resolved = resolveConfig({
      cwd: '/workspace',
      provider: 'codex',
      allowApiKeyAuth: true,
      inheritSessionPermissions: true,
      experimentalDynamicTools: false,
      dynamicToolTimeoutMs: 600_000,
      turnTimeoutMs: 600_000,
    } as Parameters<typeof resolveConfig>[0])

    expect(resolved).toEqual({
      command: bundledCodexCommand(),
      cwd: '/workspace',
      sandbox: 'workspace-write',
      approvalPolicy: 'untrusted',
      requestTimeoutMs: 30_000,
    })
    expect(Object.keys(resolved)).not.toEqual(expect.arrayContaining([
      'provider',
      'allowApiKeyAuth',
      'inheritSessionPermissions',
      'experimentalDynamicTools',
      'dynamicToolTimeoutMs',
      'turnTimeoutMs',
    ]))
  })

  it('filters the child environment using the current allowlist', () => {
    const source = {
      PATH: '/opt/bin',
      CODEX_HOME: '/home/tester/.codex',
      HOME: '/home/tester',
      LC_ALL: 'en_US.UTF-8',
      HTTP_PROXY: 'http://proxy.example.test',
      SECRET_TOKEN: 'synthetic-token',
      OPENAI_API_KEY: 'synthetic-key',
    }

    expect(childEnvironment(source)).toEqual({
      PATH: '/opt/bin',
      CODEX_HOME: '/home/tester/.codex',
      HOME: '/home/tester',
      LC_ALL: 'en_US.UTF-8',
      HTTP_PROXY: 'http://proxy.example.test',
    })
    expect(source).toEqual({
      PATH: '/opt/bin',
      CODEX_HOME: '/home/tester/.codex',
      HOME: '/home/tester',
      LC_ALL: 'en_US.UTF-8',
      HTTP_PROXY: 'http://proxy.example.test',
      SECRET_TOKEN: 'synthetic-token',
      OPENAI_API_KEY: 'synthetic-key',
    })
  })
})

describe('plugin composition', () => {
  it('registers both providers and owns independent cleanup', async () => {
    const ctx = createContext()
    const cleanups: Array<(() => void) | (() => Promise<void>)> = []
    ctx.effect.mockImplementation((execute: () => (() => void) | (() => Promise<void>)) => {
      const cleanup = execute()
      cleanups.push(cleanup)
      return vi.fn()
    })

    apply(ctx as never, { command: 'codex', cwd: '/workspace' })

    expect(ctx.llm.registerAdapter).toHaveBeenCalledWith(
      [CODEX_PROVIDER],
      expect.any(CodexAdapter),
    )
    expect(ctx.llm.registerAdapter).toHaveBeenCalledWith(
      [CODEX_OAUTH_PROVIDER],
      expect.any(OAuthCodexAdapter),
    )
    expect(CODEX_PROVIDER).toBe('my-codex')
    expect(CODEX_OAUTH_PROVIDER).toBe('my-codex-oauth')
    expect(ctx.authorization.registerFlow).toHaveBeenCalledWith(expect.objectContaining({
      key: 'dsh-ichuny-codex/my-codex-oauth', label: 'ChatGPT (OAuth Preview)',
    }))
    expect(cleanups).toHaveLength(3)
    for (const cleanup of cleanups.reverse()) await cleanup()
  })

  it('resolves the current DSH session directory without overriding explicit cwd', () => {
    const ctx = createContext()
    const session = { header: { cwd: 'F:\\dsh\\projects\\dsh-work' } }
    const get = vi.fn(() => session)
    const current = vi.fn(() => 'F:\\dsh\\projects\\dsh-work\\src')
    ctx.inject.mockImplementation((services: readonly string[], callback: (scope: unknown) => void) => {
      if (services[0] === 'sessions') callback({ sessions: { get }, effect: vi.fn() })
      if (services[0] === 'workingDirectory') callback({ workingDirectory: { get: current }, effect: vi.fn() })
    })
    apply(ctx as never, { command: 'codex' })
    const adapter = ctx.llm.registerAdapter.mock.calls[0]?.[1] as { sessionCwd: (id: string) => string | undefined }
    expect(adapter.sessionCwd('test-session')).toBe('F:\\dsh\\projects\\dsh-work\\src')
    expect(current).toHaveBeenCalledWith(session)
    expect(adapter.sessionCwd(undefined as never)).toBeUndefined()

    const headerOnly = createContext()
    headerOnly.inject.mockImplementation((services: readonly string[], callback: (scope: unknown) => void) => {
      if (services[0] === 'sessions') callback({ sessions: { get }, effect: vi.fn() })
    })
    apply(headerOnly as never, { command: 'codex' })
    const fallback = headerOnly.llm.registerAdapter.mock.calls[0]?.[1] as { sessionCwd: (id: string) => string | undefined }
    expect(fallback.sessionCwd('test-session')).toBe(session.header.cwd)

    const override = createContext()
    override.inject.mockImplementation((services: readonly string[], callback: (scope: unknown) => void) => {
      if (services[0] === 'sessions') callback({ sessions: { get }, effect: vi.fn() })
      if (services[0] === 'workingDirectory') callback({ workingDirectory: { get: current }, effect: vi.fn() })
    })
    apply(override as never, { command: 'codex', cwd: 'F:\\explicit' })
    const explicit = override.llm.registerAdapter.mock.calls[0]?.[1] as { sessionCwd: (id: string) => string | undefined }
    expect(explicit.sessionCwd('test-session')).toBeUndefined()
  })

  it('requests attachments and webServer through optional injection', () => {
    const ctx = createContext()
    const webServer = { register: vi.fn() }
    const attachmentContext = { attachments: { readImageRequest: vi.fn() }, effect: vi.fn() }
    const webContext = { webServer, effect: vi.fn((execute: () => unknown) => execute()) }
    ctx.inject.mockImplementation((services: readonly string[], callback: (value: unknown) => void) => {
      if (services[0] === 'attachments') callback(attachmentContext)
      if (services[0] === 'webServer') callback(webContext)
    })

    apply(ctx as never, { command: 'codex', cwd: '/workspace' })

    expect(ctx.inject).toHaveBeenCalledWith(['attachments'], expect.any(Function))
    expect(ctx.inject).toHaveBeenCalledWith(['webServer'], expect.any(Function))
    expect(webServer.register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'exact',
      path: '/api/dsh-ichuny-codex/rate-limits',
      resource: expect.any(Function),
    }))
    expect(webServer.register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'exact',
      path: '/api/dsh-ichuny-codex/connection-status',
      resource: expect.any(Function),
    }))
    expect(attachmentContext.effect).toHaveBeenCalledWith(expect.any(Function), expect.stringContaining('detach attachments'))
  })

  it('returns only selected quota fields from the optional web route', async () => {
    const readRateLimits = vi.spyOn(CodexAdapter.prototype, 'readRateLimits').mockResolvedValueOnce({
      accountId: 'private-account',
      rateLimits: {
        planType: 'plus',
        accountId: 'private-account',
        primary: { usedPercent: 25, resetsAt: 100, windowDurationMins: 300, token: 'private' },
        secondary: null,
        credits: { hasCredits: true, unlimited: false, balance: '10', token: 'private' },
      },
    })
    try {
      const ctx = createContext()
      const webServer = { register: vi.fn() }
      ctx.inject.mockImplementation((services: readonly string[], callback: (value: unknown) => void) => {
        if (services[0] === 'webServer') callback({ webServer, effect: (execute: () => unknown) => execute() })
      })
      apply(ctx as never, { command: 'codex', cwd: '/workspace' })
      const route = webServer.register.mock.calls[0]?.[0] as { readonly resource: () => Promise<Response> }

      const response = await route.resource()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        available: true,
        planType: 'plus',
        primary: { usedPercent: 25, resetsAt: 100, windowDurationMins: 300 },
        secondary: null,
        credits: { hasCredits: true, unlimited: false, balance: '10' },
      })
    } finally {
      readRateLimits.mockRestore()
    }
  })

  it('redacts quota route errors before returning 503', async () => {
    const readRateLimits = vi.spyOn(CodexAdapter.prototype, 'readRateLimits')
      .mockRejectedValueOnce(new Error('Bearer private-token'))
    try {
      const ctx = createContext()
      const webServer = { register: vi.fn() }
      ctx.inject.mockImplementation((services: readonly string[], callback: (value: unknown) => void) => {
        if (services[0] === 'webServer') callback({ webServer, effect: (execute: () => unknown) => execute() })
      })
      apply(ctx as never, { command: 'codex', cwd: '/workspace' })
      const route = webServer.register.mock.calls[0]?.[0] as { readonly resource: () => Promise<Response> }

      const response = await route.resource()

      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Bearer [REDACTED]' })
    } finally {
      readRateLimits.mockRestore()
    }
  })
  it('returns a redacted local connection status without account identifiers', async () => {
    const readAccount = vi.spyOn(AppServerClient.prototype, 'readAccount')
      .mockResolvedValueOnce({ authenticated: true, kind: 'chatgpt', requiresOpenaiAuth: false })
    const listModels = vi.spyOn(AppServerClient.prototype, 'listModels').mockResolvedValueOnce([
      { id: 'visible', model: 'visible', displayName: 'Visible', description: '', hidden: false, isDefault: true, inputModalities: ['text'], reasoningEfforts: [], defaultReasoningEffort: 'medium' },
      { id: 'hidden', model: 'hidden', displayName: 'Hidden', description: '', hidden: true, isDefault: false, inputModalities: ['text'], reasoningEfforts: [], defaultReasoningEffort: 'medium' },
    ])
    const readRateLimits = vi.spyOn(AppServerClient.prototype, 'readRateLimits').mockResolvedValueOnce({
      accountId: 'private-account',
      rateLimits: {
        planType: 'plus',
        primary: { usedPercent: 20, resetsAt: 100, token: 'private' },
        secondary: null,
        credits: null,
      },
    })
    try {
      const ctx = createContext()
      const webServer = { register: vi.fn() }
      ctx.inject.mockImplementation((services: readonly string[], callback: (value: unknown) => void) => {
        if (services[0] === 'webServer') callback({ webServer, effect: (execute: () => unknown) => execute() })
      })
      apply(ctx as never, { command: 'codex', cwd: '/workspace' })
      const route = webServer.register.mock.calls
        .map(call => call[0] as { readonly path: string; readonly resource: () => Promise<Response> })
        .find(candidate => candidate.path === '/api/dsh-ichuny-codex/connection-status')
      expect(route).toBeDefined()

      const response = await route?.resource()
      expect(response?.status).toBe(200)
      expect(await response?.json()).toEqual({
        status: 'connected',
        modelCount: 1,
        quota: {
          available: true,
          planType: 'plus',
          primary: { usedPercent: 20, resetsAt: 100, windowDurationMins: null },
          secondary: null,
          credits: null,
        },
        checkedAt: expect.any(Number),
      })
    } finally {
      readAccount.mockRestore()
      listModels.mockRestore()
      readRateLimits.mockRestore()
    }
  })

  it('distinguishes signed-out state and redacts connection errors', async () => {
    const readAccount = vi.spyOn(AppServerClient.prototype, 'readAccount')
      .mockResolvedValueOnce({ authenticated: false, kind: 'chatgpt', requiresOpenaiAuth: true })
      .mockRejectedValueOnce(new Error('Bearer private-token'))
    try {
      const ctx = createContext()
      const webServer = { register: vi.fn() }
      ctx.inject.mockImplementation((services: readonly string[], callback: (value: unknown) => void) => {
        if (services[0] === 'webServer') callback({ webServer, effect: (execute: () => unknown) => execute() })
      })
      apply(ctx as never, { command: 'codex', cwd: '/workspace' })
      const route = webServer.register.mock.calls
        .map(call => call[0] as { readonly path: string; readonly resource: () => Promise<Response> })
        .find(candidate => candidate.path === '/api/dsh-ichuny-codex/connection-status')
      expect(route).toBeDefined()

      const signedOut = await route?.resource()
      expect(signedOut?.status).toBe(200)
      expect(await signedOut?.json()).toEqual({
        status: 'signed-out', modelCount: 0, quota: null, checkedAt: expect.any(Number),
      })

      const failed = await route?.resource()
      expect(failed?.status).toBe(503)
      expect(await failed?.json()).toEqual({
        status: 'error', error: 'Bearer [REDACTED]', checkedAt: expect.any(Number),
      })
    } finally {
      readAccount.mockRestore()
    }
  })

  it('registers and disposes the my-codex provider through real Cordis composition', async () => {
    const ctx = new Context()
    const llmFiber = await ctx.plugin(LlmRuntime)
    const credentialsFiber = await ctx.plugin(TestCredentialProvider)
    const authorizationFiber = await ctx.plugin(AuthorizationService)
    const pluginFiber = await ctx.plugin(DshCodexPlugin, { command: 'codex', cwd: '/workspace' })
    const controllerFiber = await ctx.plugin(SiwcRemoteController)

    expect(ctx.llm.listProviders()).toContainEqual({
      id: CODEX_PROVIDER,
      name: 'ChatGPT（本地）',
    })
    expect(ctx.llm.listProviders()).toContainEqual({
      id: CODEX_OAUTH_PROVIDER,
      name: 'ChatGPT（OAuth Preview）',
    })

    expect(await ctx.siwcRemote.status()).toEqual({ phase: 'disconnected' })
    const authorizing = await ctx.siwcRemote.start()
    expect(authorizing).toMatchObject({ phase: 'authorizing', authorizationUrl: expect.stringMatching(/^https:\/\/auth\.openai\.com\//) })
    expect(await ctx.siwcRemote.cancel()).toEqual({ phase: 'disconnected' })
    expect(await ctx.siwcRemote.disconnect()).toEqual({ phase: 'disconnected' })
    expect(ctx.llm.listProviders()).toContainEqual({ id: CODEX_PROVIDER, name: 'ChatGPT（本地）' })
    expect(TYPERT.invocations.map(invocation => `${invocation.namespace}/${invocation.method}`)).toEqual(expect.arrayContaining([
      'dshIchunyCodex/status', 'dshIchunyCodex/start', 'dshIchunyCodex/cancel', 'dshIchunyCodex/disconnect',
    ]))

    await ctx.siwcRemote.start()
    await controllerFiber.dispose()
    expect(ctx.authorization.describe('dsh-ichuny-codex/my-codex-oauth' as never)?.inFlight).toBe(false)
    await pluginFiber.dispose()
    expect(ctx.llm.listProviders()).not.toContainEqual(expect.objectContaining({ id: CODEX_PROVIDER }))
    expect(ctx.llm.listProviders()).not.toContainEqual(expect.objectContaining({ id: CODEX_OAUTH_PROVIDER }))
    await authorizationFiber.dispose()
    await credentialsFiber.dispose()
    await llmFiber.dispose()
  })
})

describe('package composition metadata', () => {
  it('publishes the current plugin name, patch and peer contract', async () => {
    const root = process.cwd()
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      readonly name: string
      readonly exports?: Record<string, unknown>
      readonly dsh?: {
        readonly bundle?: { readonly patch?: string }
        readonly client?: { readonly entry?: string; readonly inject?: readonly string[] }
      }
      readonly peerDependencies?: Record<string, string>
      readonly devDependencies?: Record<string, string>
    }

    expect(name).toBe('dsh-ichuny-codex')
    expect(packageJson.name).toBe('@ipedia/dsh-ichuny-codex')
    expect(packageJson.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(packageJson.dsh?.client).toMatchObject({
      entry: './client.js',
      inject: expect.arrayContaining([
        '@deepseek-ai/dsh-client-ui-settings',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-api-remotes',
      ]),
    })
    expect(packageJson.peerDependencies).toMatchObject({
      '@deepseek-ai/cordis': '~4.1.0',
      '@deepseek-ai/dsh-attachment': '0.2.2-rc.5',
      '@deepseek-ai/dsh-authorization': '0.2.2-rc.5',
      '@deepseek-ai/dsh-credentials': '0.2.2-rc.5',
      '@deepseek-ai/dsh-llm': '0.2.2-rc.5',
      '@deepseek-ai/dsh-session': '0.2.2-rc.5',
      '@deepseek-ai/dsh-typert-protocol': '0.2.2-rc.5',
    })
    expect(packageJson.exports).toMatchObject({ './oauth-controller': expect.any(Object), './typert': expect.any(Object), './remote': expect.any(Object) })
    expect(packageJson.peerDependencies?.['@deepseek-ai/dsh-host-webserver']).toBeUndefined()
    expect(packageJson.devDependencies?.['@deepseek-ai/dsh-host-webserver']).toBe('0.2.2-rc.5')
    expect(patch).toContain("name: '@ipedia/dsh-ichuny-codex'")
    expect(patch).toContain("name: '@ipedia/dsh-ichuny-codex/oauth-controller'")
  })
})
