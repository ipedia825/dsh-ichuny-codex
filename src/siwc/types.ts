export type SiwcErrorCode =
  | 'CANCELLED' | 'HTTP' | 'INVALID_RESPONSE' | 'INVALID_TOKEN' | 'LIMIT' | 'SECURITY' | 'TIMEOUT'

export class SiwcError extends Error {
  constructor(message: string, readonly code: SiwcErrorCode, readonly status?: number) {
    super(message)
    this.name = 'SiwcError'
  }
}

export interface SiwcPkceAttempt {
  readonly state: string
  readonly nonce: string
  readonly verifier: string
  readonly challenge: string
}

export interface SiwcTokenResponse {
  readonly accessToken: string
  readonly refreshToken: string
  readonly idToken: string
  readonly tokenType: 'Bearer'
  readonly expiresIn: number
  readonly earliestRefreshAt?: number
  readonly scopes: readonly string[]
}

export interface SiwcJwt {
  readonly signingInput: Uint8Array
  readonly signature: Uint8Array
  readonly header: Readonly<Record<string, unknown>>
  readonly claims: Readonly<Record<string, unknown>>
}

export interface SiwcIdentity {
  readonly subject: string
  readonly email?: string
  readonly name?: string
}
