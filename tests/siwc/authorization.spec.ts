import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { buildSiwcAuthorizationUrl, exchangeSiwcAuthorizationCode } from '../../src/siwc/authorization.js'
import { SIWC_DYNAMIC_CLIENT_ID, SIWC_ENDPOINTS, SIWC_SCOPE } from '../../src/siwc/constants.js'
import { SiwcHttpClient } from '../../src/siwc/http-client.js'
import { startSiwcLoopback } from '../../src/siwc/loopback.js'
import { createSiwcPkceAttempt } from '../../src/siwc/pkce.js'

function signedIdToken(input: { readonly clientId: string; readonly nonce: string; readonly now: number }): { readonly token: string; readonly jwk: Record<string, unknown> } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'current' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({
    iss: SIWC_ENDPOINTS.issuer, aud: input.clientId, nonce: input.nonce,
    sub: 'verified-subject', email: 'person@example.com', iat: input.now - 1, exp: input.now + 3600,
  })).toString('base64url')
  const signingInput = `${header}.${claims}`
  return {
    token: `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), privateKey).toString('base64url')}`,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'current', alg: 'RS256', use: 'sig' },
  }
}

describe('SIWC authorization flow', () => {
  it('builds distinct initial and returning authorization URLs', () => {
    const attempt = createSiwcPkceAttempt()
    const initial = buildSiwcAuthorizationUrl({
      redirectUri: 'http://127.0.0.1:1234/auth/callback', hostId: 'urn:uuid:test', attempt, agentName: 'DSH Codex',
    })
    expect(initial.origin + initial.pathname).toBe(SIWC_ENDPOINTS.authorize)
    expect(initial.searchParams.get('client_id')).toBe(SIWC_DYNAMIC_CLIENT_ID)
    expect(initial.searchParams.get('scope')).toBe(SIWC_SCOPE)
    expect(initial.searchParams.get('agent_name_hint')).toBe('DSH Codex')
    expect(initial.searchParams.get('code_challenge_method')).toBe('S256')

    const returning = buildSiwcAuthorizationUrl({
      redirectUri: 'http://127.0.0.1:4321/auth/callback', hostId: 'urn:uuid:test', attempt,
      clientId: 'issued-client', idTokenHint: 'hint', loginHint: 'person@example.com',
    })
    expect(returning.searchParams.get('client_id')).toBe('issued-client')
    expect(returning.searchParams.has('agent_name_hint')).toBe(false)
    expect(returning.searchParams.get('id_token_hint')).toBe('hint')
    expect(() => buildSiwcAuthorizationUrl({ redirectUri: returning.toString(), hostId: 'host', attempt })).toThrow('agentName')
  })

  it('accepts one exact loopback callback and rejects state or client changes', async () => {
    const first = await startSiwcLoopback({ state: 'expected-state', timeoutMs: 5_000 })
    const callback = new URL(first.redirectUri)
    callback.searchParams.set('code', 'one-time-code')
    callback.searchParams.set('state', 'expected-state')
    callback.searchParams.set('client_id', 'issued-client')
    const response = await fetch(callback)
    expect(response.status).toBe(200)
    await expect(first.result).resolves.toEqual({ code: 'one-time-code', clientId: 'issued-client' })

    const second = await startSiwcLoopback({ state: 'expected-state', expectedClientId: 'issued-client', timeoutMs: 5_000 })
    const wrong = new URL(second.redirectUri)
    wrong.searchParams.set('code', 'code')
    wrong.searchParams.set('state', 'wrong-state')
    wrong.searchParams.set('client_id', 'different-client')
    const rejected = expect(second.result).rejects.toMatchObject({ code: 'SECURITY' })
    expect((await fetch(wrong)).status).toBe(400)
    await rejected
  })

  it('cancels the loopback listener through AbortSignal', async () => {
    const controller = new AbortController()
    const loopback = await startSiwcLoopback({ state: 'state', signal: controller.signal, timeoutMs: 5_000 })
    controller.abort()
    await expect(loopback.result).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('exchanges code, verifies JWKS signature, and returns no raw ID token', async () => {
    const now = 1_800_000_000
    const attempt = createSiwcPkceAttempt()
    const { token, jwk } = signedIdToken({ clientId: 'issued-client', nonce: attempt.nonce, now })
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === SIWC_ENDPOINTS.token) {
        expect(init?.method).toBe('POST')
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('client_id')).toBe('issued-client')
        expect(body.get('code_verifier')).toBe(attempt.verifier)
        expect(body.get('resource')).toBe(SIWC_ENDPOINTS.resource)
        return new Response(JSON.stringify({
          access_token: 'access-token', refresh_token: 'refresh-token', id_token: token,
          token_type: 'Bearer', expires_in: 3600, scope: SIWC_SCOPE, earliest_refresh_at: now + 300,
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (url === SIWC_ENDPOINTS.jwks) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })
      throw new Error('unexpected endpoint')
    })
    const registration = await exchangeSiwcAuthorizationCode({
      callback: { code: 'authorization-code', clientId: 'issued-client' },
      redirectUri: 'http://127.0.0.1:1234/auth/callback', attempt,
      http: new SiwcHttpClient(fetcher as typeof fetch), now,
    })
    expect(registration).toEqual({
      clientId: 'issued-client', accessToken: 'access-token', refreshToken: 'refresh-token',
      expiresAt: (now + 3600) * 1000, earliestRefreshAt: (now + 300) * 1000, scopes: SIWC_SCOPE.split(' '),
      identity: { subject: 'verified-subject', email: 'person@example.com' },
    })
    expect(registration).not.toHaveProperty('idToken')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
