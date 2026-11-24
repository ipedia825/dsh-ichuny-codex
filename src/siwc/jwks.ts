import { createPublicKey, verify } from 'node:crypto'
import type { webcrypto } from 'node:crypto'

import { SIWC_LIMITS } from './constants.js'
import { SiwcError, type SiwcJwt } from './types.js'

export interface SiwcJwk {
  readonly kid: string
  readonly key: webcrypto.JsonWebKey
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SiwcError('invalid JWKS response', 'INVALID_RESPONSE')
  return value as Record<string, unknown>
}

export function parseSiwcJwks(value: unknown): readonly SiwcJwk[] {
  const input = record(value)
  const keys = input['keys']
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > SIWC_LIMITS.maxJwksKeys) throw new SiwcError('invalid JWKS key count', 'INVALID_RESPONSE')
  const seen = new Set<string>()
  return Object.freeze(keys.map((candidate) => {
    const jwk = record(candidate)
    const kid = jwk['kid']
    if (typeof kid !== 'string' || kid.length === 0 || kid.length > 512 || seen.has(kid)) throw new SiwcError('invalid or duplicate JWKS key id', 'SECURITY')
    if (jwk['kty'] !== 'RSA' || (jwk['alg'] !== undefined && jwk['alg'] !== 'RS256') || (jwk['use'] !== undefined && jwk['use'] !== 'sig')) throw new SiwcError('unsupported JWKS key', 'SECURITY')
    if (typeof jwk['n'] !== 'string' || jwk['n'].length === 0 || typeof jwk['e'] !== 'string' || jwk['e'].length === 0) throw new SiwcError('invalid RSA JWKS key', 'INVALID_RESPONSE')
    seen.add(kid)
    return Object.freeze({ kid, key: { ...jwk } as webcrypto.JsonWebKey })
  }))
}

export function verifySiwcJwtSignature(jwt: SiwcJwt, keys: readonly SiwcJwk[]): void {
  const kid = jwt.header['kid']
  const matches = keys.filter(candidate => candidate.kid === kid)
  if (matches.length !== 1) throw new SiwcError('JWT signing key was not found', 'SECURITY')
  const [match] = matches
  if (match === undefined) throw new SiwcError('JWT signing key was not found', 'SECURITY')
  let publicKey
  try { publicKey = createPublicKey({ key: match.key, format: 'jwk' }) } catch { throw new SiwcError('invalid JWT signing key', 'SECURITY') }
  if (!verify('RSA-SHA256', jwt.signingInput, publicKey, jwt.signature)) throw new SiwcError('invalid JWT signature', 'SECURITY')
}
