import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { SiwcPkceAttempt } from './types.js'

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

export function createSiwcPkceAttempt(): SiwcPkceAttempt {
  const verifier = base64Url(randomBytes(32))
  return Object.freeze({
    state: base64Url(randomBytes(32)),
    nonce: base64Url(randomBytes(32)),
    verifier,
    challenge: base64Url(createHash('sha256').update(verifier, 'ascii').digest()),
  })
}

export function createSiwcHostId(): string {
  return `urn:uuid:${randomUUID()}`
}
