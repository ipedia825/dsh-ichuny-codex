import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppServerClient } from '../../src/app-server/client.js'
import type { SiwcGrant } from '../../src/siwc/grant.js'
import { OAuthAppServerRuntime } from '../../src/siwc/app-server-runtime.js'
import { ensureOAuthCodexHome } from '../../src/siwc/app-server.js'
import { describe, expect, it, vi } from 'vitest'

function grant(accessToken: string, subject = 'subject'): SiwcGrant {
  return {
    schemaVersion: 1, state: 'active', hostId: 'urn:uuid:host', clientId: 'client',
    accessToken, refreshToken: `refresh-${accessToken}`, expiresAt: 1_900_000_000_000,
    scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
    identity: { subject },
  }
}

function fakeClient() {
  const unregister = vi.fn()
  const disposeNotification = vi.fn()
  const client = {
    registerServerRequestHandler: vi.fn(() => unregister),
    onNotification: vi.fn(() => disposeNotification),
    onClose: vi.fn(() => () => {}),
    isClosed: false,
    close: vi.fn(async () => undefined),
  }
  return { client: client as unknown as AppServerClient, unregister, disposeNotification }
}

describe('OAuth app-server generation runtime', () => {
  it('creates the dedicated Codex home before first process startup', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-oauth-home-'))
    const home = join(base, 'softspark', 'dsh-ichuny-codex', 'oauth-codex')
    try {
      expect(await ensureOAuthCodexHome(home)).toBe(home)
      expect((await lstat(home)).isDirectory()).toBe(true)
      expect(await ensureOAuthCodexHome(home)).toBe(home)
      const file = join(base, 'invalid-home')
      await writeFile(file, '')
      await expect(ensureOAuthCodexHome(file)).rejects.toThrow()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('replaces only changed OAuth generations and rebinds handlers and listeners', async () => {
    const firstGrant = grant('access-1')
    const secondGrant = grant('access-2')
    const manager = {
      refresh: vi.fn().mockResolvedValueOnce(firstGrant).mockResolvedValueOnce(firstGrant).mockResolvedValueOnce(secondGrant),
      current: vi.fn(async () => secondGrant),
    }
    const first = fakeClient(); const second = fakeClient()
    const factory = vi.fn()
      .mockReturnValueOnce(first.client)
      .mockReturnValueOnce(second.client)
    const runtime = new OAuthAppServerRuntime({
      manager, command: 'codex', cwd: '/workspace', requestTimeoutMs: 1_000, clientFactory: factory,
    })
    const handler = vi.fn(); const listener = vi.fn()
    const unregisterHandler = runtime.registerServerRequestHandler(handler)
    const unsubscribe = runtime.onNotification(listener)

    await runtime.ensureReady()
    const initialRegistration = runtime.registrationId()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(first.client.registerServerRequestHandler).toHaveBeenCalledWith(handler)
    expect(first.client.onNotification).toHaveBeenCalledWith(listener)

    await runtime.ensureReady()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(first.client.close).not.toHaveBeenCalled()

    await runtime.ensureReady()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(first.unregister).toHaveBeenCalledOnce()
    expect(first.disposeNotification).toHaveBeenCalledOnce()
    expect(first.client.close).toHaveBeenCalledOnce()
    expect(second.client.registerServerRequestHandler).toHaveBeenCalledWith(handler)
    expect(second.client.onNotification).toHaveBeenCalledWith(listener)
    expect(runtime.registrationId()).toBe(initialRegistration)

    unsubscribe()
    unregisterHandler()
    await runtime.close()
    expect(second.client.close).toHaveBeenCalledOnce()
  })

  it('replaces a closed generation even when the access token is unchanged', async () => {
    const stableGrant = grant('access-1')
    const manager = { refresh: vi.fn(async () => stableGrant), current: vi.fn(async () => stableGrant) }
    const first = fakeClient(); const second = fakeClient()
    const factory = vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client)
    const runtime = new OAuthAppServerRuntime({ manager, command: 'codex', cwd: '/workspace', requestTimeoutMs: 1_000, clientFactory: factory })
    await runtime.ensureReady()
    ;(first.client as unknown as { isClosed: boolean }).isClosed = true
    await runtime.ensureReady()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(first.client.close).toHaveBeenCalledOnce()
    await runtime.close()
  })

  it('prevents a pending refresh from recreating a process after disconnect', async () => {
    let resolveRefresh: ((value: SiwcGrant) => void) | undefined
    const refreshed = new Promise<SiwcGrant>(resolve => { resolveRefresh = resolve })
    const manager = { refresh: vi.fn(() => refreshed), current: vi.fn(async () => grant('access-1')) }
    const factory = vi.fn(() => fakeClient().client)
    const runtime = new OAuthAppServerRuntime({ manager, command: 'codex', cwd: '/workspace', requestTimeoutMs: 1_000, clientFactory: factory })
    const pending = runtime.ensureReady()
    const closed = runtime.close()
    await expect(runtime.ensureReady()).rejects.toMatchObject({ code: 'CANCELLED' })
    resolveRefresh?.(grant('access-1'))
    await closed
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(factory).not.toHaveBeenCalled()
    expect(runtime.registrationId()).toBeUndefined()
  })

  it('defers refresh while an OAuth turn is active', async () => {
    const first = grant('access-1')
    const second = grant('access-2')
    const manager = { refresh: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second), current: vi.fn(async () => second) }
    const factory = vi.fn(() => fakeClient().client)
    const runtime = new OAuthAppServerRuntime({ manager, command: 'codex', cwd: '/workspace', requestTimeoutMs: 1_000, clientFactory: factory })
    await runtime.ensureReady()
    runtime.setCanReplace(() => false)
    await runtime.ensureReady()
    expect(manager.refresh).toHaveBeenCalledOnce()
    expect(manager.current).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledOnce()
    runtime.setCanReplace(() => true)
    await runtime.ensureReady()
    expect(factory).toHaveBeenCalledTimes(2)
    await runtime.close()
  })

  it('preserves the current process and registration when refresh is unsafe', async () => {
    const firstGrant = grant('access-1', 'subject-a')
    const changedGrant = grant('access-2', 'subject-b')
    const manager = {
      refresh: vi.fn(async () => firstGrant),
      current: vi.fn(async () => changedGrant),
    }
    const first = fakeClient()
    const factory = vi.fn(() => first.client)
    const runtime = new OAuthAppServerRuntime({
      manager, command: 'codex', cwd: '/workspace', requestTimeoutMs: 1_000, clientFactory: factory,
    })
    await runtime.ensureReady()
    const binding = runtime.registrationId()
    await expect(runtime.ensureReady(undefined, false)).rejects.toMatchObject({ code: 'SECURITY' })

    expect(manager.current).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledOnce()
    expect(first.client.close).not.toHaveBeenCalled()
    expect(runtime.registrationId()).toBe(binding)
    await runtime.close()
  })
})
