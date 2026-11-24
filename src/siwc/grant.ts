import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'

import type { SiwcValidatedRegistration } from './authorization.js'
import { SIWC_SCOPES } from './constants.js'
import { SiwcError } from './types.js'

const UNIX_MILLISECONDS_FLOOR = 1_000_000_000_000

export interface SiwcGrant {
  readonly schemaVersion: 1
  readonly state: 'active'
  readonly hostId: string
  readonly clientId: string
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly earliestRefreshAt?: number
  readonly scopes: readonly string[]
  readonly identity: {
    readonly subject: string
    readonly email?: string
    readonly name?: string
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SiwcError(`invalid ${label}`, 'INVALID_RESPONSE')
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new SiwcError(`unexpected ${label} field`, 'SECURITY')
}

function text(value: unknown, label: string, max = 64 * 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new SiwcError(`invalid ${label}`, 'INVALID_RESPONSE')
  return value
}

export function createSiwcGrant(hostId: string, registration: SiwcValidatedRegistration): SiwcGrant {
  return parseSiwcGrant({ schemaVersion: 1, state: 'active', hostId, ...registration })
}

export function siwcGrantRecord(grant: SiwcGrant): CredentialRecord {
  return { kind: 'grant', payload: grant }
}

export function parseSiwcGrantRecord(record: CredentialRecord | undefined): SiwcGrant | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant') throw new SiwcError('unexpected SIWC credential record kind', 'SECURITY')
  const payload = object(record.payload, 'SIWC grant')
  if (payload['state'] === 'revoked') {
    exact(payload, ['schemaVersion', 'state', 'revokedAt'], 'SIWC revoked grant')
    if (payload['schemaVersion'] !== 1 || !Number.isSafeInteger(payload['revokedAt'])) throw new SiwcError('invalid SIWC revoked grant', 'SECURITY')
    return undefined
  }
  return parseSiwcGrant(payload)
}

export function parseSiwcGrant(value: unknown): SiwcGrant {
  const input = object(value, 'SIWC grant')
  exact(input, ['schemaVersion', 'state', 'hostId', 'clientId', 'accessToken', 'refreshToken', 'expiresAt', 'earliestRefreshAt', 'scopes', 'identity'], 'SIWC grant')
  if (input['schemaVersion'] !== 1 || input['state'] !== 'active') throw new SiwcError('unsupported SIWC grant version or state', 'SECURITY')
  const scopes = input['scopes']
  if (!Array.isArray(scopes) || scopes.length !== SIWC_SCOPES.length || scopes.some(item => typeof item !== 'string') || scopes.some(item => !SIWC_SCOPES.includes(item as typeof SIWC_SCOPES[number])) || new Set(scopes).size !== scopes.length) throw new SiwcError('invalid SIWC grant scopes', 'SECURITY')
  const expiresAt = input['expiresAt']
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw new SiwcError('invalid SIWC grant expiry', 'INVALID_RESPONSE')
  const earliest = input['earliestRefreshAt']
  if (earliest !== undefined && (typeof earliest !== 'number' || !Number.isSafeInteger(earliest) || earliest <= 0)) throw new SiwcError('invalid SIWC earliest refresh time', 'INVALID_RESPONSE')
  const earliestMs = earliest === undefined ? undefined : earliest < UNIX_MILLISECONDS_FLOOR ? earliest * 1000 : earliest
  if (earliestMs !== undefined && (!Number.isSafeInteger(earliestMs) || earliestMs > expiresAt)) throw new SiwcError('invalid SIWC earliest refresh time', 'INVALID_RESPONSE')
  const identity = object(input['identity'], 'SIWC identity')
  exact(identity, ['subject', 'email', 'name'], 'SIWC identity')
  const email = identity['email']; const name = identity['name']
  if (email !== undefined && (typeof email !== 'string' || email.length > 512)) throw new SiwcError('invalid SIWC email', 'INVALID_RESPONSE')
  if (name !== undefined && (typeof name !== 'string' || name.length > 512)) throw new SiwcError('invalid SIWC name', 'INVALID_RESPONSE')
  return Object.freeze({
    schemaVersion: 1, state: 'active', hostId: text(input['hostId'], 'SIWC host ID', 512),
    clientId: text(input['clientId'], 'SIWC client ID', 512),
    accessToken: text(input['accessToken'], 'SIWC access token'), refreshToken: text(input['refreshToken'], 'SIWC refresh token'),
    expiresAt, ...(earliestMs === undefined ? {} : { earliestRefreshAt: earliestMs }), scopes: Object.freeze([...scopes] as string[]),
    identity: Object.freeze({ subject: text(identity['subject'], 'SIWC subject', 512), ...(email === undefined ? {} : { email }), ...(name === undefined ? {} : { name }) }),
  })
}
