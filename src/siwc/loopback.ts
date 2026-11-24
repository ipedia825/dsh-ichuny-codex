import { timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'

import { SIWC_CALLBACK_PATH, SIWC_LIMITS } from './constants.js'
import { SiwcError } from './types.js'

export interface SiwcCallbackResult {
  readonly code: string
  readonly clientId?: string
}

export interface SiwcLoopback {
  readonly redirectUri: string
  readonly result: Promise<SiwcCallbackResult>
  close(): Promise<void>
}

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual); const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function single(url: URL, name: string, required = true): string | undefined {
  const values = url.searchParams.getAll(name)
  if (values.length > 1 || (required && values.length !== 1)) throw new SiwcError(`invalid callback ${name}`, 'SECURITY')
  const [value] = values
  if (value !== undefined && (value.length === 0 || value.length > SIWC_LIMITS.tokenChars)) throw new SiwcError(`invalid callback ${name}`, 'SECURITY')
  return value
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise(resolve => { server.close(() => resolve()) })
}

export async function startSiwcLoopback(options: {
  readonly state: string
  readonly expectedClientId?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}): Promise<SiwcLoopback> {
  let settle: ((value: SiwcCallbackResult) => void) | undefined
  let reject: ((error: unknown) => void) | undefined
  const result = new Promise<SiwcCallbackResult>((resolve, fail) => { settle = resolve; reject = fail })
  let completed = false
  let redirectUri = ''
  const finish = async (error?: unknown, value?: SiwcCallbackResult): Promise<void> => {
    if (completed) return
    completed = true
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    await closeServer(server)
    if (error !== undefined) reject?.(error)
    else if (value !== undefined) settle?.(value)
  }
  const respond = (response: ServerResponse, status: number, message: string): void => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', connection: 'close' })
    response.end(message)
  }
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (completed) { respond(response, 410, 'Authorization attempt is closed.'); return }
        if (request.method !== 'GET' || request.url === undefined || request.url.length > 8 * 1024) throw new SiwcError('invalid callback request', 'SECURITY')
        const host = request.headers.host
        const expectedHost = new URL(redirectUri).host
        if (host !== expectedHost) throw new SiwcError('invalid callback host', 'SECURITY')
        const url = new URL(request.url, redirectUri)
        if (url.pathname !== SIWC_CALLBACK_PATH || url.hash !== '') throw new SiwcError('invalid callback path', 'SECURITY')
        const state = single(url, 'state')
        if (state === undefined || !sameSecret(state, options.state)) throw new SiwcError('invalid callback state', 'SECURITY')
        const oauthError = single(url, 'error', false)
        if (oauthError !== undefined) {
          respond(response, 400, 'Authorization was not completed. You may close this window.')
          await finish(new SiwcError(oauthError === 'access_denied' ? 'authorization cancelled' : 'authorization failed', oauthError === 'access_denied' ? 'CANCELLED' : 'HTTP'))
          return
        }
        const code = single(url, 'code')
        const clientId = single(url, 'client_id', false)
        if (code === undefined) throw new SiwcError('missing authorization code', 'SECURITY')
        if (options.expectedClientId === undefined && clientId === undefined) throw new SiwcError('dynamic registration omitted client ID', 'SECURITY')
        if (options.expectedClientId !== undefined && clientId !== undefined && clientId !== options.expectedClientId) throw new SiwcError('callback client ID changed', 'SECURITY')
        respond(response, 200, 'Authorization completed. You may close this window.')
        await finish(undefined, { code, ...(clientId === undefined ? {} : { clientId }) })
      } catch (error) {
        respond(response, 400, 'Authorization callback was rejected. You may close this window.')
        await finish(error)
      }
    })()
  })
  server.maxHeadersCount = 32
  const onAbort = (): void => { void finish(new SiwcError('authorization cancelled', 'CANCELLED')) }
  const timer = setTimeout(() => { void finish(new SiwcError('authorization timed out', 'TIMEOUT')) }, options.timeoutMs ?? SIWC_LIMITS.authorizationTimeoutMs)
  try {
    await new Promise<void>((resolve, fail) => {
      server.once('error', fail)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new SiwcError('loopback listener has no TCP address', 'SECURITY')
    redirectUri = `http://127.0.0.1:${address.port}${SIWC_CALLBACK_PATH}`
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted === true) onAbort()
    return Object.freeze({ redirectUri, result, close: () => finish(new SiwcError('authorization cancelled', 'CANCELLED')) })
  } catch (error) {
    await finish(error)
    throw error
  }
}
