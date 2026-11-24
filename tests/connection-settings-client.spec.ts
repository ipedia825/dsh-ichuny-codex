import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

interface ElementNode {
  readonly type: unknown
  readonly properties: Record<string, unknown>
}

interface SettingsHarness {
  readonly render: () => ElementNode
  readonly effects: Array<() => unknown>
  readonly contextCleanups: Array<() => unknown>
  readonly fetchMock: ReturnType<typeof vi.fn>
  readonly formSet: ReturnType<typeof vi.fn>
  readonly oauthStart: ReturnType<typeof vi.fn>
  readonly openMock: ReturnType<typeof vi.fn>
  readonly popupReplace: ReturnType<typeof vi.fn>
  readonly closePopup: ReturnType<typeof vi.fn>
  readonly registration: Record<string, unknown>
  readonly styles: string[]
}

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === 'object' && value !== null && 'properties' in value
}

function childrenOf(node: ElementNode): unknown[] {
  const children = node.properties['children']
  if (Array.isArray(children)) return children
  return children === undefined || children === false ? [] : [children]
}

function flatten(value: unknown): ElementNode[] {
  if (!isElementNode(value)) return []
  return [value, ...childrenOf(value).flatMap(flatten)]
}

function byRole(tree: ElementNode, role: string): ElementNode[] {
  return flatten(tree).filter(node => node.properties['role'] === role)
}

function byText(tree: ElementNode, text: string): ElementNode | undefined {
  return flatten(tree).find(node => node.properties['children'] === text)
}

function createHarness(options: { readonly writable?: boolean; readonly saveAccepted?: boolean; readonly oauthPhase?: 'disconnected' | 'connected'; readonly popupBlocked?: boolean; readonly authorizationUrl?: string } = {}): SettingsHarness {
  let component: ((props: Record<string, unknown>) => ElementNode) | undefined
  let props: Record<string, unknown> | undefined
  let registration: Record<string, unknown> = {}
  let hookIndex = 0
  const hookValues: unknown[] = []
  const effects: Array<() => unknown> = []
  const contextCleanups: Array<() => unknown> = []
  const styles: string[] = []
  const dictionaries: Record<string, Record<string, string>> = {}
  const formSet = vi.fn(async () => options.saveAccepted ?? true)
  const form = {
    getSnapshot: () => ({
      status: 'ready',
      value: { preferredConnection: 'local' },
      writable: options.writable ?? true,
    }),
    subscribe: () => () => {},
    set: formSet,
  }
  const popupReplace = vi.fn()
  const closePopup = vi.fn()
  const openMock = vi.fn(() => options.popupBlocked ? null : { opener: null, closed: false, location: { replace: popupReplace }, close: closePopup })
  const oauthStatus = vi.fn(async () => ({ ok: true, value: { phase: options.oauthPhase ?? 'disconnected' } }))
  const oauthStart = vi.fn(async () => ({ ok: true, value: { phase: 'authorizing', authorizationUrl: options.authorizationUrl ?? 'https://auth.openai.com/api/accounts/authorize?state=test' } }))
  const oauthCancel = vi.fn(async () => ({ ok: true, value: { phase: 'disconnected' } }))
  const oauthDisconnect = vi.fn(async () => ({ ok: true, value: { phase: 'disconnected' } }))
  const fetchMock = vi.fn(async (_url: string, request: { readonly signal: AbortSignal }) => ({
    ok: true,
    json: async () => ({
      status: 'connected', modelCount: 4,
      quota: { available: true, primary: { usedPercent: 20 } },
      checkedAt: 1_800_000_000_000,
      signalWasAborted: request.signal.aborted,
    }),
  }))
  const slots = {
    inject: (_name: string, register: () => void) => register(),
    register: (slot: Record<string, unknown>, received: (value: Record<string, unknown>) => ElementNode) => {
      if (slot['name'] === 'settings.section') {
        registration = slot
        component = received
        const inject = slot['inject']
        props = typeof inject === 'function' ? (inject as () => Record<string, unknown>)() : {}
      }
      return () => {}
    },
  }
  const context = {
    window: {
      __ModuleLoader__: {
        load: ({ factory }: { readonly factory: (require: (name: string) => unknown) => { readonly apply: (ctx: unknown) => void } }) => {
          const plugin = factory((name) => {
            if (name === 'react') return {
              useState: (initial: unknown) => {
                const index = hookIndex++
                if (!(index in hookValues)) hookValues[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
                return [hookValues[index], (value: unknown) => { hookValues[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(hookValues[index]) : value }]
              },
              useRef: (initial: unknown) => {
                const index = hookIndex++
                if (!(index in hookValues)) hookValues[index] = { current: initial }
                return hookValues[index]
              },
              useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
              useEffect: (effect: () => unknown) => { effects.push(effect) },
            }
            if (name === 'react/jsx-runtime') return {
              jsx: (type: unknown, properties: Record<string, unknown>) => ({ type, properties }),
              jsxs: (type: unknown, properties: Record<string, unknown>) => ({ type, properties }),
            }
            if (name === 'zod') return { z: {} }
            if (name === '@deepseek-ai/dsh-typert-protocol/remote-info') return { createTypertRemoteInfo: (spec: unknown) => spec }
            if (name === 'react-dom') return { createPortal: (child: unknown) => child }
            throw new Error(`unexpected require: ${name}`)
          })
          plugin.apply({
            slots,
            modelDirectories: { directoryFor: () => ({ store: { getSnapshot: () => ({ current: null, pending: null }), subscribe: () => () => {} } }) },
            effect: (execute: () => unknown) => {
              const cleanup = execute()
              if (typeof cleanup === 'function') contextCleanups.push(cleanup as () => unknown)
              return () => {}
            },
            locale: {
              register: (_namespace: string, value: { readonly zh: Record<string, string> }) => {
                Object.assign(dictionaries, { zh: value.zh })
                return () => {}
              },
              bind: () => (key: string) => dictionaries['zh']?.[key] ?? key,
            },
            configForms: { get: () => form },
            get: (key: string) => key === 'remote.dshIchunyCodex' ? { status: oauthStatus, start: oauthStart, cancel: oauthCancel, disconnect: oauthDisconnect } : undefined,
            remote: { $mount: vi.fn(async () => () => {}), dshIchunyCodex: { status: oauthStatus, start: oauthStart, cancel: oauthCancel, disconnect: oauthDisconnect } },
          })
        },
      },
      innerWidth: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
      open: openMock,
    },
    document: {
      body: {},
      head: { appendChild: (node: { readonly textContent: string }) => { styles.push(node.textContent) } },
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', remove: vi.fn() }),
    },
    fetch: fetchMock,
    AbortController,
    URL,
  }
  runInNewContext(clientSource, context)
  return {
    render: () => {
      if (component === undefined || props === undefined) throw new Error('settings section was not registered')
      hookIndex = 0
      return component(props)
    },
    effects,
    contextCleanups,
    fetchMock,
    formSet,
    oauthStart,
    openMock,
    popupReplace,
    closePopup,
    get registration() { return registration },
    styles,
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('ChatGPT connection settings client', () => {
  it('registers the settings section with accessible local and OAuth tabs', () => {
    const harness = createHarness()
    const tree = harness.render()

    expect(harness.registration).toMatchObject({
      name: 'settings.section', id: 'chatgpt-connections', order: 35,
    })
    expect(harness.styles.join('')).toContain('.ipedia-connections')
    expect(byRole(tree, 'tablist')).toHaveLength(1)
    expect(byRole(tree, 'tab')).toHaveLength(2)
    expect(byRole(tree, 'tab').map(tab => tab.properties['aria-selected'])).toEqual([true, false])
    expect(byRole(tree, 'tabpanel')).toHaveLength(1)
    expect(flatten(tree).some(node => node.properties['children'] === 'ChatGPT OAuth' && node.properties['disabled'] === true)).toBe(true)
  })

  it('loads local connection status and exposes model and quota summaries', async () => {
    const harness = createHarness()
    harness.render()
    const cleanup = harness.effects[0]?.()
    await settle()
    const tree = harness.render()

    expect(harness.fetchMock).toHaveBeenCalledWith('/api/dsh-ichuny-codex/connection-status', expect.objectContaining({ cache: 'no-store' }))
    expect(byText(tree, '已连接')).toBeDefined()
    expect(byText(tree, '4')).toBeDefined()
    expect(byText(tree, '80%')).toBeDefined()
    expect(typeof cleanup).toBe('function')
  })

  it('switches tabs with the keyboard and renders the OAuth connection state', async () => {
    const harness = createHarness()
    harness.render()
    harness.effects[0]?.()
    await settle()
    let tree = harness.render()
    const tablist = byRole(tree, 'tablist')[0]
    expect(tablist).toBeDefined()
    const preventDefault = vi.fn()
    ;(tablist?.properties['onKeyDown'] as (event: { key: string; preventDefault: () => void }) => void)({ key: 'End', preventDefault })
    tree = harness.render()

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(byRole(tree, 'tab').map(tab => tab.properties['aria-selected'])).toEqual([false, true])
    expect(byText(tree, '未登录')).toBeDefined()
  })

  it('starts OAuth through Remote and opens only the returned official authorization URL', async () => {
    const harness = createHarness()
    harness.render()
    harness.effects[0]?.()
    await settle()
    let tree = harness.render()
    const oauthTab = byRole(tree, 'tab')[1]
    ;(oauthTab?.properties['onClick'] as () => void)()
    tree = harness.render()
    const connect = byText(tree, '连接')
    const action = (connect?.properties['onClick'] as () => Promise<void>)()
    expect(harness.openMock).toHaveBeenCalledWith('about:blank', '_blank')
    await action
    tree = harness.render()

    expect(harness.oauthStart).toHaveBeenCalledOnce()
    expect(harness.popupReplace).toHaveBeenCalledWith('https://auth.openai.com/api/accounts/authorize?state=test')
    expect(byText(tree, '继续 ChatGPT 授权')).toBeDefined()
    expect(byText(tree, '取消授权')).toBeDefined()
  })

  it('offers a link when a browser blocks the synchronous OAuth popup', async () => {
    const harness = createHarness({ popupBlocked: true })
    harness.render()
    harness.effects[0]?.()
    await settle()
    let tree = harness.render()
    ;(byRole(tree, 'tab')[1]?.properties['onClick'] as () => void)()
    tree = harness.render()
    await (byText(tree, '连接')?.properties['onClick'] as () => Promise<void>)()
    tree = harness.render()
    expect(harness.openMock).toHaveBeenCalledWith('about:blank', '_blank')
    expect(byText(tree, '继续 ChatGPT 授权')?.properties['href']).toBe('https://auth.openai.com/api/accounts/authorize?state=test')
  })

  it('does not navigate a popup to an unexpected authorization origin', async () => {
    const harness = createHarness({ authorizationUrl: 'https://example.test/authorize' })
    harness.render()
    harness.effects[0]?.()
    await settle()
    let tree = harness.render()
    ;(byRole(tree, 'tab')[1]?.properties['onClick'] as () => void)()
    tree = harness.render()
    await (byText(tree, '连接')?.properties['onClick'] as () => Promise<void>)()
    tree = harness.render()
    expect(harness.popupReplace).not.toHaveBeenCalled()
    expect(harness.closePopup).toHaveBeenCalledOnce()
    expect(byText(tree, '操作失败，请重试。')).toBeDefined()
  })

  it('enables the OAuth preference only after connection', async () => {
    const harness = createHarness({ oauthPhase: 'connected' })
    harness.render()
    harness.effects[0]?.()
    await settle()
    const tree = harness.render()
    const oauthPreference = flatten(tree).find(node => node.properties['children'] === 'ChatGPT OAuth' && node.properties['aria-pressed'] === false)
    expect(oauthPreference?.properties['disabled']).toBe(false)
    await (oauthPreference?.properties['onClick'] as () => Promise<void>)()
    expect(harness.formSet).toHaveBeenCalledWith('preferredConnection', 'oauth')
  })

  it('reports preference save failures and disables writes for read-only forms', async () => {
    const failing = createHarness({ saveAccepted: false })
    let tree = failing.render()
    const localPreference = flatten(tree).find(node => node.properties['aria-pressed'] === true)
    await (localPreference?.properties['onClick'] as () => Promise<void>)()
    tree = failing.render()
    expect(failing.formSet).toHaveBeenCalledWith('preferredConnection', 'local')
    expect(byText(tree, '首选方式保存失败，请重试。')).toBeDefined()

    const readonly = createHarness({ writable: false })
    tree = readonly.render()
    const selected = flatten(tree).find(node => node.properties['aria-pressed'] === true)
    expect(selected?.properties['disabled']).toBe(true)
    expect(byText(tree, '此配置当前不可写。')).toBeDefined()
  })

  it('aborts the in-flight status request when the component unmounts', () => {
    const harness = createHarness()
    harness.render()
    const cleanup = harness.effects[0]?.() as (() => void) | undefined
    const request = harness.fetchMock.mock.calls[0]?.[1] as { readonly signal: AbortSignal } | undefined
    expect(request?.signal.aborted).toBe(false)
    cleanup?.()
    expect(request?.signal.aborted).toBe(true)
  })
})
