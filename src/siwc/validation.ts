import { SIWC_ENDPOINTS, SIWC_LIMITS, SIWC_SCOPES } from './constants.js'
import { SiwcError, type SiwcIdentity, type SiwcJwt, type SiwcTokenResponse } from './types.js'

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SiwcError(`invalid ${label}`, 'INVALID_RESPONSE')
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new SiwcError(`invalid ${label}`, 'INVALID_RESPONSE')
  return value
}

function decodePart(value: string, label: string): Record<string, unknown> {
  let decoded: unknown
  try { decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { throw new SiwcError(`invalid ${label}`, 'INVALID_TOKEN') }
  return record(decoded, label)
}

export function parseSiwcTokenResponse(value: unknown): SiwcTokenResponse {
  const input = record(value, 'token response')
  const tokenType = boundedString(input['token_type'], 'token type', 32)
  if (tokenType !== 'Bearer') throw new SiwcError('invalid token type', 'INVALID_RESPONSE')
  const expiresIn = input['expires_in']
  if (!Number.isSafeInteger(expiresIn) || (expiresIn as number) <= 0) throw new SiwcError('invalid token expiry', 'INVALID_RESPONSE')
  const scope = boundedString(input['scope'], 'scope', SIWC_LIMITS.scopeChars)
  const scopes = scope.split(' ')
  if (scopes.some(item => item.length === 0) || new Set(scopes).size !== scopes.length) throw new SiwcError('invalid granted scopes', 'INVALID_RESPONSE')
  const expected = new Set<string>(SIWC_SCOPES)
  if (scopes.length !== expected.size || scopes.some(item => !expected.has(item))) throw new SiwcError('required scopes were not granted', 'SECURITY')
  const earliest = input['earliest_refresh_at']
  if (earliest !== undefined && (typeof earliest !== 'number' || !Number.isFinite(earliest))) throw new SiwcError('invalid earliest refresh time', 'INVALID_RESPONSE')
  return Object.freeze({
    accessToken: boundedString(input['access_token'], 'access token', SIWC_LIMITS.tokenChars),
    refreshToken: boundedString(input['refresh_token'], 'refresh token', SIWC_LIMITS.tokenChars),
    idToken: boundedString(input['id_token'], 'ID token', SIWC_LIMITS.tokenChars),
    tokenType: 'Bearer', expiresIn: expiresIn as number,
    ...(earliest === undefined ? {} : { earliestRefreshAt: earliest }),
    scopes: Object.freeze([...scopes]),
  })
}

export function parseSiwcJwt(value: string): SiwcJwt {
  if (value.length === 0 || value.length > SIWC_LIMITS.tokenChars) throw new SiwcError('invalid JWT length', 'INVALID_TOKEN')
  const parts = value.split('.')
  if (parts.length !== 3 || parts.some(part => part.length === 0)) throw new SiwcError('invalid JWT', 'INVALID_TOKEN')
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string]
  const header = decodePart(encodedHeader, 'JWT header')
  if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string' || header['kid'].length === 0 || header['crit'] !== undefined) throw new SiwcError('unsupported JWT header', 'SECURITY')
  let signature: Uint8Array
  try { signature = Buffer.from(encodedSignature, 'base64url') } catch { throw new SiwcError('invalid JWT signature', 'INVALID_TOKEN') }
  return Object.freeze({ signingInput: Buffer.from(`${encodedHeader}.${encodedClaims}`, 'ascii'), signature, header, claims: decodePart(encodedClaims, 'JWT claims') })
}

export function validateSiwcIdentity(jwt: SiwcJwt, expected: { readonly clientId: string; readonly nonce?: string; readonly now?: number }): SiwcIdentity {
  const { claims } = jwt
  const now = expected.now ?? Math.floor(Date.now() / 1000)
  const skew = SIWC_LIMITS.clockSkewSeconds
  if (claims['iss'] !== SIWC_ENDPOINTS.issuer) throw new SiwcError('invalid token issuer', 'SECURITY')
  const audience = claims['aud']
  const audiences = typeof audience === 'string' ? [audience] : Array.isArray(audience) && audience.every(item => typeof item === 'string') ? audience : []
  if (!audiences.includes(expected.clientId)) throw new SiwcError('invalid token audience', 'SECURITY')
  if (audiences.length > 1 && claims['azp'] !== expected.clientId) throw new SiwcError('invalid authorized party', 'SECURITY')
  if (expected.nonce !== undefined && claims['nonce'] !== expected.nonce) throw new SiwcError('invalid token nonce', 'SECURITY')
  const exp = claims['exp']; const nbf = claims['nbf']; const iat = claims['iat']
  if (typeof exp !== 'number' || exp < now - skew) throw new SiwcError('expired ID token', 'INVALID_TOKEN')
  if (nbf !== undefined && (typeof nbf !== 'number' || nbf > now + skew)) throw new SiwcError('ID token is not active', 'INVALID_TOKEN')
  if (typeof iat !== 'number' || iat > now + skew) throw new SiwcError('invalid ID token issue time', 'INVALID_TOKEN')
  const subject = boundedString(claims['sub'], 'token subject', 512)
  const email = claims['email']; const name = claims['name']
  if (email !== undefined && (typeof email !== 'string' || email.length > 512)) throw new SiwcError('invalid email claim', 'INVALID_TOKEN')
  if (name !== undefined && (typeof name !== 'string' || name.length > 512)) throw new SiwcError('invalid name claim', 'INVALID_TOKEN')
  return Object.freeze({ subject, ...(email === undefined ? {} : { email }), ...(name === undefined ? {} : { name }) })
}

export function validateSiwcDiscovery(value: unknown): void {
  const input = record(value, 'OpenID discovery')
  const expected = { issuer: SIWC_ENDPOINTS.issuer, authorization_endpoint: SIWC_ENDPOINTS.authorize, token_endpoint: SIWC_ENDPOINTS.token, revocation_endpoint: SIWC_ENDPOINTS.revoke, jwks_uri: SIWC_ENDPOINTS.jwks }
  for (const [key, endpoint] of Object.entries(expected)) if (input[key] !== endpoint) throw new SiwcError(`unexpected discovery ${key}`, 'SECURITY')
}
