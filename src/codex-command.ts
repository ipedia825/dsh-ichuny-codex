import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const requireFromPlugin = createRequire(import.meta.url)

interface CodexTarget {
  readonly packageName: string
  readonly triple: string
}

export function codexTarget(platform: string, arch: string): CodexTarget {
  if (platform === 'win32' && arch === 'x64') return { packageName: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc' }
  if (platform === 'win32' && arch === 'arm64') return { packageName: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' }
  if (platform === 'darwin' && arch === 'x64') return { packageName: '@openai/codex-darwin-x64', triple: 'x86_64-apple-darwin' }
  if (platform === 'darwin' && arch === 'arm64') return { packageName: '@openai/codex-darwin-arm64', triple: 'aarch64-apple-darwin' }
  if ((platform === 'linux' || platform === 'android') && arch === 'x64') return { packageName: '@openai/codex-linux-x64', triple: 'x86_64-unknown-linux-musl' }
  if ((platform === 'linux' || platform === 'android') && arch === 'arm64') return { packageName: '@openai/codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' }
  throw new Error(`Bundled Codex does not support ${platform}/${arch}; configure command with a native Codex executable`)
}

export function bundledCodexCommand(platform = process.platform, arch = process.arch): string {
  const target = codexTarget(platform, arch)
  let platformPackageJson: string
  try {
    const codexPackageJson = requireFromPlugin.resolve('@openai/codex/package.json')
    platformPackageJson = createRequire(codexPackageJson).resolve(`${target.packageName}/package.json`)
  } catch {
    throw new Error(`Bundled Codex platform package ${target.packageName} is missing; reinstall with optional dependencies enabled or configure command with a native Codex executable`)
  }
  const binary = join(dirname(platformPackageJson), 'vendor', target.triple, 'bin', platform === 'win32' ? 'codex.exe' : 'codex')
  if (!existsSync(binary)) {
    throw new Error(`Bundled Codex executable is missing for ${platform}/${arch}; reinstall the plugin or configure command with a native Codex executable`)
  }
  return binary
}
