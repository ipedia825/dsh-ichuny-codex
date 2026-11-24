import { generateKeyPairSync, sign } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { SIWC_ENDPOINTS, SIWC_SCOPE, SIWC_SCOPES } from '../../src/siwc/constants.js'
import { SiwcHttpClient } from '../../src/siwc/http-client.js'
import { parseSiwcJwks, verifySiwcJwtSignature } from '../../src/siwc/jwks.js'
import { createSiwcHostId, createSiwcPkceAttempt } from '../../src/siwc/pkce.js'
import { safeSiwcErrorMessage } from '../../src/siwc/redaction.js'
import { SiwcError } from '../../src/siwc/types.js'
import { parseSiwcJwt, parseSiwcTokenResponse, validateSiwcDiscovery, validateSiwcIdentity } from '../../src/siwc/validation.js'

function jwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'test' }): string {
  return [header, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).concat(Buffer.from('signature').toString('base64url')).join('.')
}

function tokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'access', refresh_token: 'refresh', id_token: jwt({}), token_type: 'Bearer',
    expires_in: 3600, scope: SIWC_SCOPE, ...overrides,
  }
}

describe('SIWC protocol foundation', () => {
  it('creates independent PKCE attempts and stable-format host ids', () => {
    const first = createSiwcPkceAttempt()
    const second = createSiwcPkceAttempt()
    expect(first).not.toEqual(second)
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createSiwcHostId()).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
  })

  it('accepts only a complete exact scope set and bounded token fields', () => {
    const parsed = parseSiwcTokenResponse(tokenResponse({ earliest_refresh_at: 1_800_000_000 }))
    expect(parsed).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600, earliestRefreshAt: 1_800_000_000 })
    expect(parsed.scopes).toEqual(SIWC_SCOPES)
    expect(() => parseSiwcTokenResponse(tokenResponse({ scope: 'openid profile' }))).toThrow('required scopes')
    expect(() => parseSiwcTokenResponse(tokenResponse({ scope: `${SIWC_SCOPE} extra` }))).toThrow('required scopes')
    expect(() => parseSiwcTokenResponse(tokenResponse({ token_type: 'bearer' }))).toThrow('token type')
    expect(() => parseSiwcTokenResponse(tokenResponse({ access_token: '' }))).toThrow('access token')
  })

  it('parses RS256 JWTs and validates issuer audience nonce and time claims', () => {
    const now = 1_800_000_000
    const parsed = parseSiwcJwt(jwt({
      iss: SIWC_ENDPOINTS.issuer, aud: 'issued-client', nonce: 'expected', sub: 'subject',
      email: 'person@example.com', name: 'Person', iat: now - 1, exp: now + 3600,
    }))
    expect(validateSiwcIdentity(parsed, { clientId: 'issued-client', nonce: 'expected', now })).toEqual({
      subject: 'subject', email: 'person@example.com', name: 'Person',
    })
    expect(() => validateSiwcIdentity(parsed, { clientId: 'other', nonce: 'expected', now })).toThrow('audience')
    expect(() => validateSiwcIdentity(parsed, { clientId: 'issued-client', nonce: 'other', now })).toThrow('nonce')
    expect(() => parseSiwcJwt(jwt({}, { alg: 'none', kid: 'test' }))).toThrow('unsupported JWT header')
    expect(() => parseSiwcJwt('not-a-jwt')).toThrow('invalid JWT')
  })

  it('verifies RS256 signatures against one unique allowlisted JWKS key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'current' })).toString('base64url')
    const claims = Buffer.from(JSON.stringify({ sub: 'subject' })).toString('base64url')
    const signingInput = `${header}.${claims}`
    const token = `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), privateKey).toString('base64url')}`
    const exported = publicKey.export({ format: 'jwk' })
    const jwks = parseSiwcJwks({ keys: [{ ...exported, kid: 'current', alg: 'RS256', use: 'sig' }] })

    expect(() => verifySiwcJwtSignature(parseSiwcJwt(token), jwks)).not.toThrow()
    expect(() => verifySiwcJwtSignature(parseSiwcJwt(token.replace(claims, Buffer.from('{}').toString('base64url'))), jwks)).toThrow('signature')
    expect(() => verifySiwcJwtSignature(parseSiwcJwt(token), [])).toThrow('not found')
    expect(() => parseSiwcJwks({ keys: [{ ...exported, kid: 'same' }, { ...exported, kid: 'same' }] })).toThrow('duplicate')
    expect(() => parseSiwcJwks({ keys: [{ ...exported, kid: 'wrong', alg: 'HS256' }] })).toThrow('unsupported')
  })

  it('pins every discovery endpoint instead of trusting returned URLs', () => {
    const discovery = {
      issuer: SIWC_ENDPOINTS.issuer,
      authorization_endpoint: SIWC_ENDPOINTS.authorize,
      token_endpoint: SIWC_ENDPOINTS.token,
      revocation_endpoint: SIWC_ENDPOINTS.revoke,
      jwks_uri: SIWC_ENDPOINTS.jwks,
      userinfo_endpoint: 'https://auth.openai.com/api/accounts/oauth/userinfo',
    }
    expect(() => validateSiwcDiscovery(discovery)).not.toThrow()
    expect(() => validateSiwcDiscovery({ ...discovery, token_endpoint: 'https://example.test/token' })).toThrow('unexpected discovery')
  })

  it('uses no redirects and enforces endpoint, content type, status and body limits', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    })
    const client = new SiwcHttpClient(fetcher as typeof fetch)
    await expect(client.getJson(SIWC_ENDPOINTS.discovery, value => value)).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(client.getJson('https://example.test' as never, value => value)).rejects.toMatchObject({ code: 'SECURITY' })

    const wrongType = new SiwcHttpClient(vi.fn(async () => new Response('text', { headers: { 'content-type': 'text/plain' } })) as typeof fetch)
    await expect(wrongType.getJson(SIWC_ENDPOINTS.discovery, value => value)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })

    const oversized = new SiwcHttpClient(vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999' } })) as typeof fetch)
    await expect(oversized.getJson(SIWC_ENDPOINTS.discovery, value => value)).rejects.toMatchObject({ code: 'LIMIT' })

    const rejected = new SiwcHttpClient(vi.fn(async () => new Response(JSON.stringify({ error: 'denied' }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch)
    await expect(rejected.getJson(SIWC_ENDPOINTS.discovery, value => value)).rejects.toMatchObject({ code: 'HTTP', status: 401 })
  })

  it('redacts OAuth query and form secrets from diagnostics', () => {
    const message = safeSiwcErrorMessage(new Error('callback?code=secret&state=state id_token_hint=jwt nonce: hidden'))
    expect(message).not.toContain('secret')
    expect(message).not.toContain('state id')
    expect(message).not.toContain('jwt')
    expect(message).not.toContain('hidden')
    expect(message).toContain('[REDACTED]')
    expect(new SiwcError('safe', 'SECURITY').code).toBe('SECURITY')
  })
})
