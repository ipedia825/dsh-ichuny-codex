export const SIWC_ENDPOINTS = Object.freeze({
  issuer: 'https://auth.openai.com',
  authorize: 'https://auth.openai.com/api/accounts/authorize',
  token: 'https://auth.openai.com/api/accounts/oauth/token',
  revoke: 'https://auth.openai.com/api/accounts/oauth/revoke',
  discovery: 'https://auth.openai.com/.well-known/openid-configuration',
  jwks: 'https://auth.openai.com/.well-known/jwks.json',
  resource: 'https://api.openai.com/v1',
  models: 'https://api.openai.com/v1/models',
  responses: 'https://api.openai.com/v1/responses',
} as const)

export const SIWC_SCOPES = Object.freeze([
  'openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct',
] as const)

export const SIWC_SCOPE = SIWC_SCOPES.join(' ')
export const SIWC_DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const SIWC_CALLBACK_PATH = '/auth/callback'
export const SIWC_LIMITS = Object.freeze({
  requestTimeoutMs: 20_000,
  authorizationTimeoutMs: 300_000,
  responseBytes: 64 * 1024,
  jwksBytes: 256 * 1024,
  tokenChars: 64 * 1024,
  scopeChars: 2 * 1024,
  clientIdChars: 512,
  maxJwksKeys: 32,
  clockSkewSeconds: 60,
})
