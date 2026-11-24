import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { SiwcCredentialManager } from '../../src/siwc/credential-manager.js'
import { SIWC_ENDPOINTS, SIWC_SCOPE, SIWC_SCOPES } from '../../src/siwc/constants.js'
import { SIWC_CREDENTIAL_KEY } from '../../src/siwc/flow.js'
import { siwcGrantRecord, type SiwcGrant } from '../../src/siwc/grant.js'
import { SiwcHttpClient } from '../../src/siwc/http-client.js'

function activeGrant(overrides: Partial<SiwcGrant> = {}): SiwcGrant {
  return {
    schemaVersion: 1, state: 'active', hostId: 'urn:uuid:host', clientId: 'issued-client',
    accessToken: 'EXAMPLE_OLD_ACCESS', refreshToken: 'old-refresh', expiresAt: 1_800_000_001_000,
    scopes: SIWC_SCOPES, identity: { subject: 'subject' }, ...overrides,
  }
}

function signedToken(now: number): { readonly token: string; readonly jwk: Record<string, unknown> } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'refresh' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({
    iss: SIWC_ENDPOINTS.issuer, aud: 'issued-client', sub: 'subject', iat: now - 1, exp: now + 3600,
  })).toString('base64url')
  const input = `${header}.${claims}`
  return { token: `${input}.${sign('RSA-SHA256', Buffer.from(input, 'ascii'), privateKey).toString('base64url')}`, jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'refresh', alg: 'RS256', use: 'sig' } }
}

function credentialStore(initial: SiwcGrant | undefined) {
  let record = initial === undefined ? undefined : siwcGrantRecord(initial)
  return {
    provider: {
      readRecord: vi.fn(async () => record),
      modifyRecord: vi.fn(async (_key: unknown, mutate: (current: typeof record) => Promise<typeof record>) => {
        const next = await mutate(record)
        if (next !== undefined) record = next
        return record
      }),
      deleteRecord: vi.fn(async () => { record = undefined }),
    },
    current: () => record,
  }
}

describe('SIWC credential manager', () => {
  it('single-flights rotating token refresh and atomically replaces the grant', async () => {
    const nowMs = 1_800_000_000_000
    const { token, jwk } = signedToken(Math.floor(nowMs / 1000))
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === SIWC_ENDPOINTS.token) return new Response(JSON.stringify({
        access_token: 'EXAMPLE_NEW_ACCESS', refresh_token: 'new-refresh', id_token: token,
        token_type: 'Bearer', expires_in: 3600, scope: SIWC_SCOPE,
      }), { headers: { 'content-type': 'application/json' } })
      if (String(input) === SIWC_ENDPOINTS.jwks) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })
      throw new Error('unexpected endpoint')
    })
    const store = credentialStore(activeGrant())
    const manager = new SiwcCredentialManager(store.provider as never, new SiwcHttpClient(fetcher as typeof fetch))
    const [first, second] = await Promise.all([manager.refresh({ force: true, now: nowMs }), manager.refresh({ force: true, now: nowMs })])

    expect(first).toEqual(second)
    expect(first).toMatchObject({ accessToken: 'EXAMPLE_NEW_ACCESS', refreshToken: 'new-refresh', expiresAt: nowMs + 3_600_000 })
    expect(fetcher.mock.calls.filter(call => String(call[0]) === SIWC_ENDPOINTS.token)).toHaveLength(1)
    expect(store.provider.modifyRecord).toHaveBeenCalledWith(SIWC_CREDENTIAL_KEY, expect.any(Function))
  })

  it('does not refresh a token with sufficient lifetime', async () => {
    const now = 1_800_000_000_000
    const store = credentialStore(activeGrant({ expiresAt: now + 3_600_000 }))
    const http = { postForm: vi.fn(), getJson: vi.fn(), postFormEmpty: vi.fn() }
    const result = await new SiwcCredentialManager(store.provider as never, http as never).refresh({ now })
    expect(result.accessToken).toBe('EXAMPLE_OLD_ACCESS')
    expect(http.postForm).not.toHaveBeenCalled()
  })

  it('does not delete a new authorization committed after revocation', async () => {
    const store = credentialStore(activeGrant())
    const replacement = siwcGrantRecord(activeGrant({ accessToken: 'EXAMPLE_NEW_ACCESS' }))
    const originalModify = store.provider.modifyRecord
    store.provider.modifyRecord = vi.fn(async (key, mutate) => {
      const result = await originalModify(key, mutate)
      if (result?.kind === 'grant' && (result.payload as { state?: string }).state === 'revoked') {
        await originalModify(key, async () => replacement)
      }
      return result
    })
    const manager = new SiwcCredentialManager(store.provider as never, { postFormEmpty: vi.fn(async () => undefined) } as never)
    await expect(manager.revoke()).resolves.toEqual({ remoteRevocationConfirmed: true })
    expect(store.provider.deleteRecord).not.toHaveBeenCalled()
    expect(await manager.current()).toMatchObject({ accessToken: 'EXAMPLE_NEW_ACCESS' })
  })

  it('replaces tokens with a non-secret revoked marker on remote failure', async () => {
    const store = credentialStore(activeGrant())
    const http = { postFormEmpty: vi.fn(async () => { throw new Error('offline') }) }
    const manager = new SiwcCredentialManager(store.provider as never, http as never)
    await expect(manager.revoke()).resolves.toEqual({ remoteRevocationConfirmed: false })
    expect(http.postFormEmpty).toHaveBeenCalledWith(SIWC_ENDPOINTS.revoke, expect.any(URLSearchParams), undefined)
    expect(store.provider.deleteRecord).not.toHaveBeenCalled()
    expect(store.current()).toMatchObject({ kind: 'grant', payload: { schemaVersion: 1, state: 'revoked' } })
    expect(JSON.stringify(store.current())).not.toContain('EXAMPLE_OLD_ACCESS')
    expect(await manager.current()).toBeUndefined()
    await expect(manager.refresh({ force: true })).rejects.toMatchObject({ code: 'SECURITY' })
  })
})
