import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { SiwcCredentialManager } from './siwc/credential-manager.js'
import { SIWC_CREDENTIAL_KEY } from './siwc/flow.js'
import { OAUTH_RUNTIME_SERVICE } from './siwc/app-server-runtime.js'

export type SiwcConnectionPhase = 'disconnected' | 'authorizing' | 'connected' | 'error'

export interface SiwcConnectionView {
  readonly phase: SiwcConnectionPhase
  readonly email?: string
  readonly expiresAt?: number
}

export interface SiwcAuthorizationView extends SiwcConnectionView {
  readonly authorizationUrl: string
}

interface Attempt {
  readonly controller: AbortController
  readonly done: Promise<void>
  readonly url: Promise<string>
}

const remoteInitializers: Array<(this: SiwcRemoteController) => void> = []

declare module '@deepseek-ai/cordis' {
  interface Context {
    siwcRemote: SiwcRemoteController
  }
}

export class SiwcRemoteController extends TypertRemoteService {
  static inject = ['credentials', 'authorization', OAUTH_RUNTIME_SERVICE]
  private readonly manager: SiwcCredentialManager
  private attempt: Attempt | undefined
  private failed = false

  constructor(ctx: Context) {
    super(ctx, 'siwcRemote', { namespace: 'dshIchunyCodex' })
    for (const initialize of remoteInitializers) initialize.call(this)
    this.manager = new SiwcCredentialManager(ctx.credentials)
    ctx.effect(() => () => {
      this.attempt?.controller.abort()
      ctx.authorization.cancel(SIWC_CREDENTIAL_KEY)
    }, 'dsh-ichuny-codex: cancel authorization on controller unload')
  }

  async status(): Promise<SiwcConnectionView> {
    const grant = await this.manager.current()
    if (this.attempt !== undefined || this.ctx.authorization.describe(SIWC_CREDENTIAL_KEY)?.inFlight === true) return { phase: 'authorizing' }
    if (grant !== undefined) return { phase: 'connected', ...(grant.identity.email === undefined ? {} : { email: grant.identity.email }), expiresAt: grant.expiresAt }
    return { phase: this.failed ? 'error' : 'disconnected' }
  }

  async start(): Promise<SiwcAuthorizationView> {
    if (this.attempt === undefined) this.attempt = this.begin()
    const current = this.attempt
    const authorizationUrl = await Promise.race([
      current.url,
      current.done.then(() => { throw new RemoteError('gateway/internal', 'ChatGPT authorization ended before a browser URL was available', {}) }),
    ])
    return { ...await this.status(), phase: 'authorizing', authorizationUrl }
  }

  async cancel(): Promise<SiwcConnectionView> {
    const current = this.attempt
    current?.controller.abort()
    this.ctx.authorization.cancel(SIWC_CREDENTIAL_KEY)
    await current?.done
    return this.status()
  }

  async disconnect(): Promise<SiwcConnectionView> {
    const attempt = this.attempt
    attempt?.controller.abort()
    this.ctx.authorization.cancel(SIWC_CREDENTIAL_KEY)
    await attempt?.done
    await this.ctx.dshIchunyOAuthRuntime.close()
    await this.manager.revoke()
    this.failed = false
    return this.status()
  }

  private begin(): Attempt {
    this.failed = false
    const controller = new AbortController()
    let publishUrl: ((url: string) => void) | undefined
    const url = new Promise<string>(resolve => { publishUrl = resolve })
    const done = this.ctx.authorization.begin({
      key: SIWC_CREDENTIAL_KEY,
      signal: controller.signal,
      interaction: {
        notify: notice => { if (notice.url !== undefined) publishUrl?.(notice.url) },
        prompt: () => Promise.reject(new RemoteError('gateway/bad-request', 'SIWC does not accept pasted authorization codes', {})),
      },
    }).then((outcome) => {
      if (outcome.status !== 'authorized') this.failed = false
    }).catch(() => { this.failed = true }).then(() => {
      if (this.attempt?.controller === controller) this.attempt = undefined
    })
    return { controller, done, url }
  }
}

function markRemote(name: 'status' | 'start' | 'cancel' | 'disconnect'): void {
  const method = SiwcRemoteController.prototype[name]
  Remote(method, {
    kind: 'method', name, static: false, private: false,
    addInitializer: initializer => { remoteInitializers.push(initializer) },
  } as ClassMethodDecoratorContext<SiwcRemoteController, typeof method>)
}

for (const method of ['status', 'start', 'cancel', 'disconnect'] as const) markRemote(method)

export default SiwcRemoteController
