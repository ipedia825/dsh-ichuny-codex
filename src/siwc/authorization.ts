import { SIWC_DYNAMIC_CLIENT_ID, SIWC_ENDPOINTS, SIWC_SCOPE } from './constants.js'
import { SiwcHttpClient } from './http-client.js'
import { parseSiwcJwks, verifySiwcJwtSignature } from './jwks.js'
import type { SiwcPkceAttempt } from './types.js'
import { parseSiwcJwt, parseSiwcTokenResponse, validateSiwcIdentity } from './validation.js'

export interface SiwcAuthorizationInput {
  readonly redirectUri: string
  readonly hostId: string
  readonly attempt: SiwcPkceAttempt
  readonly clientId?: string
  readonly agentName?: string
  readonly idTokenHint?: string
  readonly loginHint?: string
}

export interface SiwcCallbackCode {
  readonly code: string
  readonly clientId?: string
}

export interface SiwcValidatedRegistration {
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

export function buildSiwcAuthorizationUrl(input: SiwcAuthorizationInput): URL {
  const initial = input.clientId === undefined
  if (initial !== (input.agentName !== undefined)) throw new TypeError('agentName is required only for initial SIWC registration')
  const url = new URL(SIWC_ENDPOINTS.authorize)
  const values: Record<string, string> = {
    response_type: 'code', client_id: input.clientId ?? SIWC_DYNAMIC_CLIENT_ID,
    redirect_uri: input.redirectUri, scope: SIWC_SCOPE, resource: SIWC_ENDPOINTS.resource,
    code_challenge: input.attempt.challenge, code_challenge_method: 'S256',
    state: input.attempt.state, nonce: input.attempt.nonce, ext_agent_host_id: input.hostId,
  }
  if (input.agentName !== undefined) values['agent_name_hint'] = input.agentName
  if (input.idTokenHint !== undefined) values['id_token_hint'] = input.idTokenHint
  if (input.loginHint !== undefined) values['login_hint'] = input.loginHint
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value)
  return url
}

export async function exchangeSiwcAuthorizationCode(options: {
  readonly callback: SiwcCallbackCode
  readonly redirectUri: string
  readonly attempt: SiwcPkceAttempt
  readonly requestedClientId?: string
  readonly http?: SiwcHttpClient
  readonly now?: number
  readonly signal?: AbortSignal
}): Promise<SiwcValidatedRegistration> {
  const clientId = options.requestedClientId ?? options.callback.clientId
  if (clientId === undefined || clientId === SIWC_DYNAMIC_CLIENT_ID || clientId.length > 512) throw new TypeError('issued SIWC client ID is required')
  if (options.requestedClientId !== undefined && options.callback.clientId !== undefined && options.callback.clientId !== options.requestedClientId) throw new TypeError('SIWC callback client ID changed')
  const http = options.http ?? new SiwcHttpClient()
  const body = new URLSearchParams({
    grant_type: 'authorization_code', client_id: clientId, code: options.callback.code,
    code_verifier: options.attempt.verifier, redirect_uri: options.redirectUri, resource: SIWC_ENDPOINTS.resource,
  })
  const token = await http.postForm(SIWC_ENDPOINTS.token, body, parseSiwcTokenResponse, options.signal)
  const keys = await http.getJson(SIWC_ENDPOINTS.jwks, parseSiwcJwks, options.signal)
  const idToken = parseSiwcJwt(token.idToken)
  verifySiwcJwtSignature(idToken, keys)
  const identity = validateSiwcIdentity(idToken, { clientId, nonce: options.attempt.nonce, ...(options.now === undefined ? {} : { now: options.now }) })
  const nowMs = (options.now ?? Math.floor(Date.now() / 1000)) * 1000
  return Object.freeze({
    clientId, accessToken: token.accessToken, refreshToken: token.refreshToken,
    expiresAt: nowMs + token.expiresIn * 1000,
    ...(token.earliestRefreshAt === undefined ? {} : { earliestRefreshAt: token.earliestRefreshAt * 1000 }),
    scopes: token.scopes, identity,
  })
}
