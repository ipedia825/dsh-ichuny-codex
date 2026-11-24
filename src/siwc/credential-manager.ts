import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'

import { SIWC_ENDPOINTS } from './constants.js'
import { createSiwcGrant, parseSiwcGrantRecord, siwcGrantRecord, type SiwcGrant } from './grant.js'
import { SiwcHttpClient } from './http-client.js'
import { parseSiwcJwks, verifySiwcJwtSignature } from './jwks.js'
import { SIWC_CREDENTIAL_KEY } from './flow.js'
import { SiwcError } from './types.js'
import { parseSiwcJwt, parseSiwcTokenResponse, validateSiwcIdentity } from './validation.js'

export interface SiwcRevocationResult {
  readonly remoteRevocationConfirmed: boolean
}

const REFRESH_SKEW_MS = 5 * 60 * 1000

export class SiwcCredentialManager {
  private refreshTask: Promise<SiwcGrant> | undefined

  constructor(private readonly credentials: CredentialProvider, private readonly http = new SiwcHttpClient()) {}

  async current(): Promise<SiwcGrant | undefined> {
    return parseSiwcGrantRecord(await this.credentials.readRecord(SIWC_CREDENTIAL_KEY))
  }

  refresh(options: { readonly force?: boolean; readonly now?: number; readonly signal?: AbortSignal } = {}): Promise<SiwcGrant> {
    if (this.refreshTask !== undefined) return this.refreshTask
    const task = this.refreshLocked(options)
    this.refreshTask = task
    void task.finally(() => { if (this.refreshTask === task) this.refreshTask = undefined }).catch(() => {})
    return task
  }

  private async refreshLocked(options: { readonly force?: boolean; readonly now?: number; readonly signal?: AbortSignal }): Promise<SiwcGrant> {
    const now = options.now ?? Date.now()
    const record = await this.credentials.modifyRecord(SIWC_CREDENTIAL_KEY, async (current) => {
      const grant = parseSiwcGrantRecord(current)
      if (grant === undefined) throw new SiwcError('ChatGPT OAuth is not connected', 'SECURITY')
      const earliest = grant.earliestRefreshAt ?? 0
      if (options.force !== true && grant.expiresAt - now > REFRESH_SKEW_MS) return undefined
      if (now < earliest) throw new SiwcError('ChatGPT OAuth token cannot be refreshed yet', 'SECURITY')
      const body = new URLSearchParams({
        grant_type: 'refresh_token', client_id: grant.clientId,
        refresh_token: grant.refreshToken, resource: SIWC_ENDPOINTS.resource,
      })
      const token = await this.http.postForm(SIWC_ENDPOINTS.token, body, parseSiwcTokenResponse, options.signal)
      const keys = await this.http.getJson(SIWC_ENDPOINTS.jwks, parseSiwcJwks, options.signal)
      const idToken = parseSiwcJwt(token.idToken)
      verifySiwcJwtSignature(idToken, keys)
      const identity = validateSiwcIdentity(idToken, { clientId: grant.clientId, now: Math.floor(now / 1000) })
      if (identity.subject !== grant.identity.subject) throw new SiwcError('refreshed ChatGPT identity changed', 'SECURITY')
      return siwcGrantRecord(createSiwcGrant(grant.hostId, {
        clientId: grant.clientId, accessToken: token.accessToken, refreshToken: token.refreshToken,
        expiresAt: now + token.expiresIn * 1000,
        ...(token.earliestRefreshAt === undefined ? {} : { earliestRefreshAt: token.earliestRefreshAt * 1000 }),
        scopes: token.scopes, identity,
      }))
    })
    const refreshed = parseSiwcGrantRecord(record)
    if (refreshed === undefined) throw new SiwcError('ChatGPT OAuth credential disappeared', 'SECURITY')
    return refreshed
  }

  async revoke(signal?: AbortSignal): Promise<SiwcRevocationResult> {
    await this.refreshTask?.catch(() => {})
    let confirmed = false
    await this.credentials.modifyRecord(SIWC_CREDENTIAL_KEY, async (current) => {
      const grant = parseSiwcGrantRecord(current)
      if (grant === undefined) return undefined
      try {
        await this.http.postFormEmpty(SIWC_ENDPOINTS.revoke, new URLSearchParams({
          token: grant.refreshToken, token_type_hint: 'refresh_token', client_id: grant.clientId,
        }), signal)
        confirmed = true
      } catch {
        confirmed = false
      }
      const tombstone: CredentialRecord = { kind: 'grant', payload: { schemaVersion: 1, state: 'revoked', revokedAt: Date.now() } }
      return tombstone
    })
    return { remoteRevocationConfirmed: confirmed }
  }
}
