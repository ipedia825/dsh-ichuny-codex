import { lstat, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SiwcGrant } from './grant.js'

export const OAUTH_APP_SERVER_ARGS = Object.freeze([
  'app-server', '--listen', 'stdio://',
  '-c', 'model_provider="openai_chatgpt_plan"',
  '-c', 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
  '-c', 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
  '-c', 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
  '-c', 'model_providers.openai_chatgpt_plan.wire_api="responses"',
  '-c', 'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
  '-c', 'model_providers.openai_chatgpt_plan.supports_websockets=false',
] as const)

export function oauthCodexHome(): string {
  return join(homedir(), '.softspark', 'dsh-ichuny-codex', 'oauth-codex')
}

export async function ensureOAuthCodexHome(path = oauthCodexHome()): Promise<string> {
  for (const directory of [dirname(dirname(path)), dirname(path), path]) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const entry = await lstat(directory)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('OAuth Codex home must be a directory')
  }
  return path
}

export function oauthChildEnvironment(base: Readonly<NodeJS.ProcessEnv>, grant: SiwcGrant, home = oauthCodexHome()): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base, CODEX_HOME: home, ACCESS_TOKEN: grant.accessToken }
  delete environment['OPENAI_API_KEY']
  return environment
}
