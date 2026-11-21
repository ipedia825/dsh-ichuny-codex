import process from 'node:process'

import { bundledCodexCommand } from '../lib/codex-command.js'
import {
  AppServerClient,
  ChildProcessTransport,
  CODEX_PROVIDER,
  CodexAdapter,
  childEnvironment,
} from '../lib/index.js'

const REQUEST_TIMEOUT_MS = 120_000
const EXPECTED_TEXT = 'DSH CODEX SMOKE OK'

const cwd = process.cwd()
const client = new AppServerClient({
  experimentalApi: true,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  transport: new ChildProcessTransport({
    command: bundledCodexCommand(),
    cwd,
    env: childEnvironment(process.env),
  }),
})
const adapter = new CodexAdapter({
  client,
  cwd,
  sandbox: 'workspace-write',
  approvalPolicy: 'never',
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
})

try {
  const models = await adapter.listModels(CODEX_PROVIDER)
  if (models.length === 0) throw new Error('Codex returned no visible models')

  const requestedModel = process.env['CODEX_SMOKE_MODEL']
  const selected = requestedModel === undefined
    ? models[0]
    : models.find((model) => model.id === requestedModel)
  if (selected === undefined) throw new Error(`Requested smoke model was not found: ${requestedModel}`)

  const text = []
  let finished = false
  for await (const chunk of adapter.stream({
    provider: CODEX_PROVIDER,
    model: selected.id,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: `Reply with exactly: ${EXPECTED_TEXT}` }],
    }],
  })) {
    if (chunk.type === 'text-delta') text.push(chunk.text)
    if (chunk.type === 'finish' && chunk.reason.kind === 'stop') finished = true
  }

  const reply = text.join('').trim()
  if (!finished) throw new Error('Codex stream did not finish normally')
  if (!reply.includes(EXPECTED_TEXT)) throw new Error('Codex stream did not return the expected smoke marker')

  const quota = await adapter.readRateLimits()
  const hasRateLimits = quota['rateLimits'] !== undefined
  console.log(JSON.stringify({
    authenticated: true,
    visibleModels: models.length,
    selectedModel: selected.id,
    streamedReply: true,
    rateLimitsReturned: hasRateLimits,
  }))
} finally {
  await adapter.close()
}
