import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'

import { CODEX_PROVIDER, CodexAdapter } from '../src/adapter.js'
import { bundledCodexCommand } from '../src/codex-command.js'
import {
  apply,
  childEnvironment,
  name,
  resolveConfig,
} from '../src/index.js'
import * as DshCodexPlugin from '../src/index.js'

interface TestContext {
  readonly llm: { readonly registerAdapter: ReturnType<typeof vi.fn> }
  readonly inject: ReturnType<typeof vi.fn>
  readonly effect: ReturnType<typeof vi.fn>
}

function createContext(): TestContext {
  return {
    llm: { registerAdapter: vi.fn(() => vi.fn()) },
    inject: vi.fn(),
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
  it('registers the my-codex provider and owns adapter cleanup', async () => {
    const ctx = createContext()
    let cleanup: (() => void) | (() => Promise<void>) | undefined
    ctx.effect.mockImplementationOnce((execute: () => (() => void) | (() => Promise<void>)) => {
      cleanup = execute()
      return vi.fn()
    })

    apply(ctx as never, { command: 'codex', cwd: '/workspace' })

    expect(ctx.llm.registerAdapter).toHaveBeenCalledWith(
      [CODEX_PROVIDER],
      expect.any(CodexAdapter),
    )
    expect(CODEX_PROVIDER).toBe('my-codex')
    expect(cleanup).toBeDefined()
    await cleanup?.()
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
  it('registers and disposes the my-codex provider through real Cordis composition', async () => {
    const ctx = new Context()
    const llmFiber = await ctx.plugin(LlmRuntime)
    const pluginFiber = await ctx.plugin(DshCodexPlugin, { command: 'codex', cwd: '/workspace' })

    expect(ctx.llm.listProviders()).toContainEqual({
      id: CODEX_PROVIDER,
      name: 'My Codex',
    })

    await pluginFiber.dispose()
    expect(ctx.llm.listProviders()).not.toContainEqual(expect.objectContaining({ id: CODEX_PROVIDER }))
    await llmFiber.dispose()
  })
})

describe('package composition metadata', () => {
  it('publishes the current plugin name, patch and peer contract', async () => {
    const root = process.cwd()
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      readonly name: string
      readonly dsh?: { readonly bundle?: { readonly patch?: string } }
      readonly peerDependencies?: Record<string, string>
      readonly devDependencies?: Record<string, string>
    }

    expect(name).toBe('dsh-ichuny-codex')
    expect(packageJson.name).toBe('@ipedia/dsh-ichuny-codex')
    expect(packageJson.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(packageJson.peerDependencies).toMatchObject({
      '@deepseek-ai/cordis': '~4.1.0',
      '@deepseek-ai/dsh-attachment': '0.2.2-rc.1 || 0.2.2-rc.3',
      '@deepseek-ai/dsh-llm': '0.2.2-rc.1 || 0.2.2-rc.3',
      '@deepseek-ai/dsh-session': '0.2.2-rc.1 || 0.2.2-rc.3',
    })
    expect(packageJson.peerDependencies?.['@deepseek-ai/dsh-host-webserver']).toBeUndefined()
    expect(packageJson.devDependencies?.['@deepseek-ai/dsh-host-webserver']).toBe('0.2.2-rc.3')
    expect(patch).toContain("name: '@ipedia/dsh-ichuny-codex'")
  })
})
