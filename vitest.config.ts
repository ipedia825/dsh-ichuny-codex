import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/core.spec.ts', 'tests/attachments.spec.ts', 'tests/quota-client.spec.ts', 'tests/composition.spec.ts', 'tests/adapter-current.spec.ts', 'tests/dynamic-tools-current.spec.ts', 'tests/app-server/**/*.spec.ts', 'tests/session-permissions.spec.ts', 'tests/dsh-compat.spec.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
        'src/app-server/{validation,redaction}.ts': {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  },
})
