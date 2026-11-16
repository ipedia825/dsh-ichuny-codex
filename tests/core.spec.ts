import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { bundledCodexCommand, codexTarget } from '../src/codex-command.js'
import { childEnvironment, name, resolveConfig } from '../src/index.js'

describe('dsh-ichuny-codex configuration', () => {
  it('exports the name checked by the package smoke test', () => {
    expect(name).toBe('dsh-ichuny-codex')
  })

  it('uses the current DSH-compatible defaults', () => {
    const config = resolveConfig()
    expect(config.sandbox).toBe('workspace-write')
    expect(config.approvalPolicy).toBe('untrusted')
    expect(config.requestTimeoutMs).toBe(30_000)
  })

  it('resolves the native Codex binary from this plugin dependency tree', () => {
    const command = resolveConfig().command
    expect(command).toBe(bundledCodexCommand())
    expect(existsSync(command)).toBe(true)
    expect(command).toContain('codex')
  })

  it('maps the platform package without assuming Windows x64', () => {
    expect(codexTarget('win32', 'arm64')).toEqual({
      packageName: '@openai/codex-win32-arm64',
      triple: 'aarch64-pc-windows-msvc',
    })
    expect(codexTarget('darwin', 'arm64').triple).toBe('aarch64-apple-darwin')
    expect(() => codexTarget('win32', 'riscv64')).toThrow('configure command')
  })

  it('uses an explicit native command instead of the bundled CLI', () => {
    expect(resolveConfig({ command: 'C:\\custom\\codex.exe' }).command).toBe('C:\\custom\\codex.exe')
  })

  it('rejects an empty Codex command', () => {
    expect(() => resolveConfig({ command: '   ' })).toThrow('command must not be empty')
  })

  it('passes only the child-process environment allowlist', () => {
    const result = childEnvironment({ PATH: 'path', CODEX_HOME: 'home', SECRET_TOKEN: 'secret' })
    expect(result).toEqual({ PATH: 'path', CODEX_HOME: 'home' })
  })
})
