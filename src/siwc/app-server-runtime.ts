import { createHash } from 'node:crypto'

import { AppServerClient } from '../app-server/client.js'
import { ChildProcessTransport } from '../app-server/transport.js'
import type { CodexAppServer } from '../adapter.js'
import { childEnvironment } from '../child-environment.js'
import { OAUTH_APP_SERVER_ARGS, ensureOAuthCodexHome, oauthChildEnvironment } from './app-server.js'
import type { SiwcGrant } from './grant.js'
import { SiwcError } from './types.js'

type NotificationListener = Parameters<AppServerClient['onNotification']>[0]
type ServerRequestHandler = Parameters<AppServerClient['registerServerRequestHandler']>[0]

interface Generation {
  readonly accessToken: string
  readonly client: AppServerClient
  unregisterServer?: () => void
  unregisterClose?: () => void
  readonly notificationDisposers: Map<NotificationListener, () => void>
}

export interface SiwcTokenManager {
  current(): Promise<SiwcGrant | undefined>
  refresh(options?: { readonly signal?: AbortSignal }): Promise<SiwcGrant>
}

export interface OAuthAppServerRuntimeOptions {
  readonly manager: SiwcTokenManager
  readonly command: string
  readonly cwd: string
  readonly requestTimeoutMs: number
  readonly environment?: Readonly<NodeJS.ProcessEnv>
  readonly clientFactory?: (grant: SiwcGrant) => AppServerClient
}

export const OAUTH_RUNTIME_SERVICE = 'dshIchunyOAuthRuntime'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshIchunyOAuthRuntime: OAuthAppServerRuntime
  }
}

export class OAuthAppServerRuntime implements CodexAppServer {
  private generation: Generation | undefined
  private ensureTask: Promise<void> | undefined
  private serverHandler: ServerRequestHandler | undefined
  private readonly notificationListeners = new Set<NotificationListener>()
  private readonly closeListeners = new Set<(error: Error) => void>()
  private lifecycleEpoch = 0
  private ensureAbort: AbortController | undefined
  private closeTask: Promise<void> | undefined
  private canReplace: () => boolean = () => true
  private registration: string | undefined
  private generationNumber = 0

  constructor(private readonly options: OAuthAppServerRuntimeOptions) {}

  registrationId(): string | undefined { return this.registration }
  generationId(): number { return this.generationNumber }
  setCanReplace(check: () => boolean): void { this.canReplace = check }

  ensureReady(signal?: AbortSignal, allowRefresh = true): Promise<void> {
    if (this.closeTask !== undefined) return Promise.reject(new SiwcError('OAuth app-server is closing', 'CANCELLED'))
    if (this.ensureTask !== undefined) return this.ensureTask
    const controller = new AbortController()
    this.ensureAbort = controller
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    const task = this.ensureGeneration(combined, allowRefresh && this.canReplace(), this.lifecycleEpoch)
    this.ensureTask = task
    void task.finally(() => {
      if (this.ensureTask === task) { this.ensureTask = undefined; this.ensureAbort = undefined }
    }).catch(() => {})
    return task
  }

  private async ensureGeneration(signal: AbortSignal, allowRefresh: boolean, epoch: number): Promise<void> {
    const grant = allowRefresh
      ? await this.options.manager.refresh({ signal })
      : await this.options.manager.current()
    if (epoch !== this.lifecycleEpoch || signal.aborted) throw new SiwcError('OAuth app-server generation was cancelled', 'CANCELLED')
    if (grant === undefined) throw new SiwcError('ChatGPT OAuth is not connected', 'SECURITY')
    const nextRegistration = registrationId(grant)
    if (this.generation !== undefined && (!allowRefresh || !this.canReplace())) {
      if (this.registration !== nextRegistration) throw new SiwcError('ChatGPT account changed during an active turn', 'SECURITY')
      return
    }
    if (this.generation?.accessToken === grant.accessToken && this.registration === nextRegistration && !this.generation.client.isClosed) return
    await this.replaceGeneration(grant, epoch)
    this.registration = nextRegistration
  }

  private async replaceGeneration(grant: SiwcGrant, epoch: number): Promise<void> {
    const previous = this.generation
    if (previous !== undefined) {
      previous.unregisterServer?.()
      previous.unregisterClose?.()
      for (const dispose of previous.notificationDisposers.values()) dispose()
      await previous.client.close()
    }
    if (epoch !== this.lifecycleEpoch) throw new SiwcError('OAuth app-server generation was cancelled', 'CANCELLED')
    const home = this.options.clientFactory === undefined ? await ensureOAuthCodexHome() : undefined
    const client = this.options.clientFactory?.(grant) ?? new AppServerClient({
      experimentalApi: true,
      transport: new ChildProcessTransport({
        command: this.options.command,
        cwd: this.options.cwd,
        args: OAUTH_APP_SERVER_ARGS,
        env: oauthChildEnvironment(childEnvironment(this.options.environment ?? process.env), grant, home),
      }),
      requestTimeoutMs: this.options.requestTimeoutMs,
    })
    if (epoch !== this.lifecycleEpoch) { await client.close(); throw new SiwcError('OAuth app-server generation was cancelled', 'CANCELLED') }
    const generation: Generation = { accessToken: grant.accessToken, client, notificationDisposers: new Map() }
    generation.unregisterClose = client.onClose(error => {
      for (const listener of this.closeListeners) {
        try { listener(error) } catch { /* one listener cannot block shutdown */ }
      }
    })
    if (this.serverHandler !== undefined) generation.unregisterServer = client.registerServerRequestHandler(this.serverHandler)
    for (const listener of this.notificationListeners) generation.notificationDisposers.set(listener, client.onNotification(listener))
    this.generation = generation
    this.generationNumber += 1
  }

  registerServerRequestHandler(handler: ServerRequestHandler): () => void {
    if (this.serverHandler !== undefined) throw new Error('OAuth app-server handler is already registered')
    this.serverHandler = handler
    if (this.generation !== undefined) this.generation.unregisterServer = this.generation.client.registerServerRequestHandler(handler)
    return () => {
      if (this.serverHandler !== handler) return
      this.serverHandler = undefined
      this.generation?.unregisterServer?.()
      if (this.generation !== undefined) delete this.generation.unregisterServer
    }
  }

  onClose(listener: (error: Error) => void): () => void {
    this.closeListeners.add(listener)
    return () => { this.closeListeners.delete(listener) }
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener)
    if (this.generation !== undefined) this.generation.notificationDisposers.set(listener, this.generation.client.onNotification(listener))
    return () => {
      this.notificationListeners.delete(listener)
      this.generation?.notificationDisposers.get(listener)?.()
      this.generation?.notificationDisposers.delete(listener)
    }
  }

  listModels(...args: Parameters<AppServerClient['listModels']>): ReturnType<AppServerClient['listModels']> { return this.client().listModels(...args) }
  startThread(...args: Parameters<AppServerClient['startThread']>): ReturnType<AppServerClient['startThread']> { return this.client().startThread(...args) }
  resumeThread(...args: Parameters<AppServerClient['resumeThread']>): ReturnType<AppServerClient['resumeThread']> { return this.client().resumeThread(...args) }
  startTurn(...args: Parameters<AppServerClient['startTurn']>): ReturnType<AppServerClient['startTurn']> { return this.client().startTurn(...args) }
  readRateLimits(...args: Parameters<AppServerClient['readRateLimits']>): ReturnType<AppServerClient['readRateLimits']> { return this.client().readRateLimits(...args) }
  readAccount(...args: Parameters<AppServerClient['readAccount']>): ReturnType<AppServerClient['readAccount']> { return this.client().readAccount(...args) }
  interruptTurn(...args: Parameters<AppServerClient['interruptTurn']>): ReturnType<AppServerClient['interruptTurn']> { return this.client().interruptTurn(...args) }

  close(): Promise<void> {
    if (this.closeTask !== undefined) return this.closeTask
    const task = this.closeGeneration()
    this.closeTask = task
    void task.finally(() => { if (this.closeTask === task) this.closeTask = undefined }).catch(() => {})
    return task
  }

  private async closeGeneration(): Promise<void> {
    this.lifecycleEpoch += 1
    this.ensureAbort?.abort()
    await this.ensureTask?.catch(() => {})
    const generation = this.generation
    this.generation = undefined
    this.registration = undefined
    this.generationNumber += 1
    generation?.unregisterServer?.()
    if (generation !== undefined) {
      for (const dispose of generation.notificationDisposers.values()) dispose()
      await generation.client.close()
    }
  }

  private client(): AppServerClient {
    if (this.generation === undefined) throw new SiwcError('OAuth app-server is not initialized', 'SECURITY')
    return this.generation.client
  }
}

function registrationId(grant: SiwcGrant): string {
  return createHash('sha256').update(grant.clientId).update('\0').update(grant.identity.subject).digest('base64url')
}
