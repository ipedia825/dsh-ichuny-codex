import { describe, expect, it, vi } from 'vitest'

import type { SiwcValidatedRegistration } from '../../src/siwc/authorization.js'
import { registerSiwcAuthorizationFlow, SIWC_CREDENTIAL_KEY } from '../../src/siwc/flow.js'
import { createSiwcGrant, parseSiwcGrant, parseSiwcGrantRecord, siwcGrantRecord } from '../../src/siwc/grant.js'
import { SIWC_SCOPES } from '../../src/siwc/constants.js'

const registration: SiwcValidatedRegistration = {
  clientId: 'issued-client', accessToken: 'access', refreshToken: 'refresh',
  expiresAt: 1_800_003_600_000, scopes: SIWC_SCOPES,
  identity: { subject: 'subject', email: 'person@example.com' },
}

describe('SIWC credential grant and authorization flow', () => {
  it('stores only the strict minimum active grant fields', () => {
    const grant = createSiwcGrant('urn:uuid:host', registration)
    expect(grant).toEqual({ schemaVersion: 1, state: 'active', hostId: 'urn:uuid:host', ...registration })
    expect(grant).not.toHaveProperty('idToken')
    expect(parseSiwcGrant({ ...grant, earliestRefreshAt: 1_800_000_300 })).toMatchObject({ earliestRefreshAt: 1_800_000_300_000 })
    expect(parseSiwcGrantRecord(siwcGrantRecord(grant))).toEqual(grant)
    expect(() => parseSiwcGrant({ ...grant, unexpected: true })).toThrow('unexpected')
    expect(() => parseSiwcGrant({ ...grant, scopes: ['openid'] })).toThrow('scopes')
    expect(() => parseSiwcGrantRecord({ kind: 'api-key', key: 'secret' })).toThrow('record kind')
  })

  it('rejects returning sign-in for a different verified subject', async () => {
    let run: ((session: unknown) => Promise<void>) | undefined
    const close = vi.fn(async () => {})
    const existing = siwcGrantRecord(createSiwcGrant('urn:uuid:host', registration))
    const ctx = {
      credentials: { readRecord: vi.fn(async () => existing) },
      authorization: { registerFlow: vi.fn((flow: { run: (session: unknown) => Promise<void> }) => { run = flow.run; return () => {} }) },
    }
    registerSiwcAuthorizationFlow(ctx as never, {
      agentName: 'DSH Codex',
      startLoopback: async () => ({ redirectUri: 'http://127.0.0.1:1234/auth/callback', result: Promise.resolve({ code: 'code', clientId: 'issued-client' }), close }),
      exchange: async () => ({ ...registration, identity: { subject: 'another-subject' } }),
    })
    const commit = vi.fn(async () => {})
    await expect(run?.({ method: 'siwc', signal: new AbortController().signal, notify: vi.fn(), commit })).rejects.toMatchObject({ code: 'SECURITY' })
    expect(commit).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('registers one DSH flow and commits a verified grant after callback', async () => {
    let flow: { readonly key: unknown; readonly label: string; readonly methods: readonly { readonly id: string }[]; readonly run: (session: unknown) => Promise<void> } | undefined
    const close = vi.fn(async () => {})
    const startLoopback = vi.fn(async () => ({
      redirectUri: 'http://127.0.0.1:1234/auth/callback',
      result: Promise.resolve({ code: 'authorization-code', clientId: 'issued-client' }), close,
    }))
    const exchange = vi.fn(async () => registration)
    const registerFlow = vi.fn((value: typeof flow) => { flow = value; return vi.fn() })
    const ctx = {
      credentials: { readRecord: vi.fn(async () => undefined) },
      authorization: { registerFlow },
    }
    const dispose = registerSiwcAuthorizationFlow(ctx as never, { agentName: 'DSH Codex', startLoopback, exchange })
    expect(flow).toMatchObject({ key: SIWC_CREDENTIAL_KEY, label: 'ChatGPT (OAuth Preview)', methods: [{ id: 'siwc' }] })
    const notify = vi.fn(); const commit = vi.fn(async () => {})
    await flow?.run({ method: 'siwc', signal: new AbortController().signal, notify, commit })

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.any(String), url: expect.stringContaining('auth.openai.com'),
    }))
    expect(exchange).toHaveBeenCalledOnce()
    expect(exchange).toHaveBeenCalledWith(expect.not.objectContaining({ requestedClientId: expect.anything() }))
    expect(commit).toHaveBeenCalledWith({ kind: 'grant', payload: expect.objectContaining({ clientId: 'issued-client', hostId: expect.stringMatching(/^urn:uuid:/) }) })
    expect(close).toHaveBeenCalledOnce()
    dispose()
  })
})
