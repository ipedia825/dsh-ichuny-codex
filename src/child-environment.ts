const ALLOWED_ENV = new Set(['APPDATA', 'CODEX_HOME', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'])

export function childEnvironment(source: Readonly<NodeJS.ProcessEnv> = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && (ALLOWED_ENV.has(key.toUpperCase()) || key.toUpperCase().startsWith('LC_'))) result[key] = value
  }
  return result
}
