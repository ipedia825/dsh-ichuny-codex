import { createTypertRemoteInfo, type TypertRemoteMethodSpec, type TypertRemoteSpec } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

const connection = () => z.object({
  phase: z.enum(['disconnected', 'authorizing', 'connected', 'error']),
  email: z.string().optional(),
  expiresAt: z.number().optional(),
})
const authorization = () => connection().extend({ authorizationUrl: z.string().url() })

const spec: TypertRemoteSpec = {
  package: '@ipedia/dsh-ichuny-codex',
  methods: {
    'dshIchunyCodex/status': method('status', connection),
    'dshIchunyCodex/start': method('start', authorization),
    'dshIchunyCodex/cancel': method('cancel', connection),
    'dshIchunyCodex/disconnect': method('disconnect', connection),
  },
}

function method(name: string, create: () => z.ZodType): TypertRemoteMethodSpec {
  return {
    service: 'siwcRemote', description: `ChatGPT OAuth ${name}.`, invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: `@ipedia/dsh-ichuny-codex#dshIchunyCodex/${name}:result`, create, jsonSchema: { type: 'object' } },
    sourceLocation: { file: 'src/oauth-controller.ts', line: 1, column: 1 },
  }
}

const remote = createTypertRemoteInfo(spec, z)
export const TYPERT_REMOTE = remote
export default TYPERT_REMOTE
