import type { Context } from '@deepseek-ai/cordis'
import { AuthorizationDeclinedError, type AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

import { buildSiwcAuthorizationUrl, exchangeSiwcAuthorizationCode } from './authorization.js'
import { createSiwcGrant, parseSiwcGrantRecord, siwcGrantRecord } from './grant.js'
import { startSiwcLoopback } from './loopback.js'
import { createSiwcHostId, createSiwcPkceAttempt } from './pkce.js'
import { SiwcError } from './types.js'

export const SIWC_CREDENTIAL_KEY = credentialKey('dsh-ichuny-codex', 'my-codex-oauth')

export interface SiwcFlowOptions {
  readonly agentName: string
  readonly exchange?: typeof exchangeSiwcAuthorizationCode
  readonly startLoopback?: typeof startSiwcLoopback
}

async function runSiwcFlow(ctx: Context, session: AuthorizationSession, options: SiwcFlowOptions): Promise<void> {
  const existing = parseSiwcGrantRecord(await ctx.credentials.readRecord(SIWC_CREDENTIAL_KEY))
  const hostId = existing?.hostId ?? createSiwcHostId()
  const attempt = createSiwcPkceAttempt()
  const startLoopback = options.startLoopback ?? startSiwcLoopback
  const loopback = await startLoopback({
    state: attempt.state,
    ...(existing === undefined ? {} : { expectedClientId: existing.clientId }),
    signal: session.signal,
  })
  try {
    const authorizationUrl = buildSiwcAuthorizationUrl({
      redirectUri: loopback.redirectUri, hostId, attempt,
      ...(existing === undefined ? { agentName: options.agentName } : { clientId: existing.clientId, ...(existing.identity.email === undefined ? {} : { loginHint: existing.identity.email }) }),
    })
    session.notify({ message: 'Continue with ChatGPT in your browser.', url: authorizationUrl.toString() })
    const callback = await loopback.result
    const exchange = options.exchange ?? exchangeSiwcAuthorizationCode
    const registration = await exchange({
      callback, redirectUri: loopback.redirectUri, attempt,
      ...(existing === undefined ? {} : { requestedClientId: existing.clientId }), signal: session.signal,
    })
    if (existing !== undefined && registration.identity.subject !== existing.identity.subject) {
      throw new SiwcError('ChatGPT account changed during reauthorization', 'SECURITY')
    }
    await session.commit(siwcGrantRecord(createSiwcGrant(hostId, registration)))
  } catch (error) {
    if (error instanceof SiwcError && error.code === 'CANCELLED') throw new AuthorizationDeclinedError('ChatGPT authorization was cancelled')
    throw error
  } finally {
    await loopback.close()
  }
}

export function registerSiwcAuthorizationFlow(ctx: Context, options: SiwcFlowOptions): () => void {
  return ctx.authorization.registerFlow({
    key: SIWC_CREDENTIAL_KEY,
    label: 'ChatGPT (OAuth Preview)',
    methods: [{ id: 'siwc', label: 'Continue with ChatGPT' }],
    run: session => runSiwcFlow(ctx, session, options),
  })
}
