import { safeErrorMessage } from '../app-server/redaction.js'

const QUERY_SECRET = /([?&](?:code|state|nonce|code_verifier|code_challenge|id_token_hint)=)[^&#\s]*/gi
const FORM_SECRET = /((?:code|state|nonce|code_verifier|code_challenge|id_token_hint)\s*[=:]\s*)[^&\s,}]*/gi

export function safeSiwcErrorMessage(error: unknown): string {
  return safeErrorMessage(error).replace(QUERY_SECRET, '$1[REDACTED]').replace(FORM_SECRET, '$1[REDACTED]')
}
