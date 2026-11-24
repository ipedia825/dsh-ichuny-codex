import { SIWC_ENDPOINTS, SIWC_LIMITS } from './constants.js'
import { SiwcError } from './types.js'

export type SiwcGetEndpoint = typeof SIWC_ENDPOINTS.discovery | typeof SIWC_ENDPOINTS.jwks
export type SiwcPostEndpoint = typeof SIWC_ENDPOINTS.token | typeof SIWC_ENDPOINTS.revoke
const ALLOWED = new Set<string>([SIWC_ENDPOINTS.discovery, SIWC_ENDPOINTS.jwks, SIWC_ENDPOINTS.token, SIWC_ENDPOINTS.revoke])

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (type !== 'application/json') throw new SiwcError('unexpected SIWC response content type', 'INVALID_RESPONSE', response.status)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) throw new SiwcError('SIWC response exceeded size limit', 'LIMIT', response.status)
  if (response.body === null) throw new SiwcError('empty SIWC response', 'INVALID_RESPONSE', response.status)
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  while (true) {
    const part = await reader.read(); if (part.done) break
    total += part.value.byteLength
    if (total > maxBytes) { await reader.cancel(); throw new SiwcError('SIWC response exceeded size limit', 'LIMIT', response.status) }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new SiwcError('invalid SIWC JSON response', 'INVALID_RESPONSE', response.status) }
}

export class SiwcHttpClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async getJson<T>(endpoint: SiwcGetEndpoint, parser: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    return this.request(endpoint, { method: 'GET' }, endpoint === SIWC_ENDPOINTS.jwks ? SIWC_LIMITS.jwksBytes : SIWC_LIMITS.responseBytes, parser, signal)
  }

  async postForm<T>(endpoint: SiwcPostEndpoint, body: URLSearchParams, parser: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    return this.request(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, SIWC_LIMITS.responseBytes, parser, signal)
  }

  async postFormEmpty(endpoint: SiwcPostEndpoint, body: URLSearchParams, signal?: AbortSignal): Promise<void> {
    if (!ALLOWED.has(endpoint)) throw new SiwcError('SIWC endpoint is not allowed', 'SECURITY')
    const timeout = AbortSignal.timeout(SIWC_LIMITS.requestTimeoutMs)
    let response: Response
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(),
        redirect: 'error', signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      })
    } catch { throw new SiwcError('SIWC request failed', 'HTTP') }
    if (!response.ok) throw new SiwcError('SIWC endpoint rejected the request', 'HTTP', response.status)
    await response.body?.cancel()
  }

  private async request<T>(endpoint: string, init: RequestInit, maxBytes: number, parser: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    if (!ALLOWED.has(endpoint) || new URL(endpoint).protocol !== 'https:') throw new SiwcError('SIWC endpoint is not allowed', 'SECURITY')
    const timeout = AbortSignal.timeout(SIWC_LIMITS.requestTimeoutMs)
    let response: Response
    try { response = await this.fetcher(endpoint, { ...init, redirect: 'error', signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) }) }
    catch (error) { throw new SiwcError(error instanceof DOMException && error.name === 'TimeoutError' ? 'SIWC request timed out' : 'SIWC request failed', error instanceof DOMException && error.name === 'TimeoutError' ? 'TIMEOUT' : 'HTTP') }
    const value = await boundedJson(response, maxBytes)
    if (!response.ok) throw new SiwcError('SIWC endpoint rejected the request', 'HTTP', response.status)
    return parser(value)
  }
}
