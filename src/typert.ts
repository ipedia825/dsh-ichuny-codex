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
    service: 'siwcRemote',
    description: `ChatGPT OAuth ${name}.`,
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: `@ipedia/dsh-ichuny-codex#dshIchunyCodex/${name}:result`,
      create,
      jsonSchema: { type: 'object' },
    },
    sourceLocation: { file: 'src/oauth-controller.ts', line: 1, column: 1 },
  }
}

const remote = createTypertRemoteInfo(spec, z)

export const TYPERT = {
  package: '@ipedia/dsh-ichuny-codex',
  face: 'host',
  schemas: [],
  get invocations() { return remote.descriptors },
  model: {
    services: [{
      description: 'Authenticated SIWC actions for the ChatGPT connections settings page.',
      summary: 'Authenticated SIWC connection controller.',
      tags: [],
      jsDoc: '/** Authenticated SIWC connection controller. */',
      key: 'siwcRemote',
      exportName: 'SiwcRemoteController',
      members: ['status', 'start', 'cancel', 'disconnect'].map(name => ({
        kind: 'method',
        name,
        signature: `@Remote ${name}(): Promise<SiwcConnectionView>`,
        summary: `ChatGPT OAuth ${name}.`,
        jsDoc: `/** ChatGPT OAuth ${name}. */`,
      })),
      types: [
        { name: 'SiwcConnectionView', declaration: "export interface SiwcConnectionView { phase: 'disconnected' | 'authorizing' | 'connected' | 'error'; email?: string; expiresAt?: number }" },
        { name: 'SiwcAuthorizationView', declaration: "export interface SiwcAuthorizationView extends SiwcConnectionView { authorizationUrl: string }" },
      ],
    }],
    events: [],
    objects: [],
  },
}
