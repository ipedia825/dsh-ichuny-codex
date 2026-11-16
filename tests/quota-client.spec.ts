import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function loadQuotaComponent(provider: string | undefined): {
  readonly render: () => unknown
  readonly fetchMock: ReturnType<typeof vi.fn>
  readonly effects: Array<() => unknown>
  readonly styles: string[]
  readonly setProvider: (provider: string | undefined) => void
  readonly remount: (provider: string | undefined) => void
} {
  let component: ((props: { modelDirectory: unknown }) => unknown) | undefined
  let props: { modelDirectory: unknown } | undefined
  const effects: Array<() => unknown> = []
  const styles: string[] = []
  const hookValues: unknown[] = []
  let hookIndex = 0
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ available: true, planType: 'plus', primary: { usedPercent: 20, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 30, resetsAt: 1_800_000_000 }, credits: { hasCredits: false, unlimited: false, balance: '0' } }) }))
  const selection: { current: { provider: string; model: string } | null; pending: null } = {
    current: provider === undefined ? null : { provider, model: 'test' },
    pending: null,
  }
  const face = { getSnapshot: () => selection, subscribe: () => () => {} }
  const slots = {
    inject: (_name: string, register: () => void) => register(),
    register: (options: { inject: (sessionId: string) => { modelDirectory: unknown } }, received: (props: { modelDirectory: unknown }) => unknown) => {
      component = received
      props = options.inject('test-session')
    },
  }
  const context = {
    window: {
      __ModuleLoader__: {
        load: ({ factory }: { factory: (require: (name: string) => unknown) => { apply: (ctx: unknown) => void } }) => {
          const plugin = factory((name) => {
            if (name === 'react') return {
              useState: (initial: unknown) => {
                const index = hookIndex++
                if (!(index in hookValues)) hookValues[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
                return [hookValues[index], (value: unknown) => { hookValues[index] = value }]
              },
              useRef: () => ({ current: {
                getBoundingClientRect: () => ({ top: 320, bottom: 342, right: 510 }),
                contains: () => false,
              } }),
              useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
              useEffect: (effect: () => unknown) => { effects.push(effect) },
            }
            if (name === 'react/jsx-runtime') return {
              jsx: (type: unknown, properties: unknown) => ({ type, properties }),
              jsxs: (type: unknown, properties: unknown) => ({ type, properties }),
            }
            if (name === 'react-dom') return { createPortal: (child: unknown) => ({ portal: child }) }
            throw new Error(`unexpected require: ${name}`)
          })
          plugin.apply({ slots, modelDirectories: { directoryFor: () => ({ store: face }) } })
        },
      },
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
      innerWidth: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    document: { body: {}, head: { appendChild: (node: { textContent: string }) => { styles.push(node.textContent) } }, getElementById: () => null, createElement: () => ({ id: '', textContent: '' }) },
    fetch: fetchMock,
  }
  runInNewContext(clientSource, context)
  return {
    render: () => {
      if (component === undefined || props === undefined) throw new Error('quota slot was not registered')
      hookIndex = 0
      return component(props)
    },
    fetchMock,
    effects,
    styles,
    setProvider: (nextProvider) => {
      selection.current = nextProvider === undefined ? null : { provider: nextProvider, model: 'next' }
    },
    remount: (nextProvider) => {
      hookValues.length = 0
      hookIndex = 0
      selection.current = nextProvider === undefined ? null : { provider: nextProvider, model: 'next' }
    },
  }
}

describe('Codex quota client', () => {
  it('hides quota and does not fetch for another provider', () => {
    const client = loadQuotaComponent('aodo')
    expect(client.render()).toBeNull()
    client.effects[0]?.()
    expect(client.fetchMock).not.toHaveBeenCalled()
  })

  it('fetches quota when Codex is selected', () => {
    const client = loadQuotaComponent('my-codex')
    client.render()
    client.effects[0]?.()
    expect(client.fetchMock).toHaveBeenCalledOnce()
  })

  it('renders remaining five-hour quota after a successful response', async () => {
    const client = loadQuotaComponent('my-codex')
    expect(client.render()).toBeNull()
    client.effects[0]?.()
    await vi.waitFor(() => {
      const tree = client.render() as { properties: { children: unknown[] } }
      expect(tree.properties.children[0]).toMatchObject({
        properties: { children: 'codex 80%' },
      })
    })
  })

  it('shows codex label and positions the detail portal after clicking', async () => {
    const client = loadQuotaComponent('my-codex')
    client.render()
    client.effects[0]?.()
    await vi.waitFor(() => expect(client.render()).not.toBeNull())
    const tree = client.render() as { properties: { children: unknown[] } }
    const button = tree.properties.children[0] as { properties: { children: string; onClick: () => void } }
    expect(button.properties.children).toBe('codex 80%')
    button.properties.onClick()
    const opened = client.render() as { properties: { children: unknown[] } }
    const portal = opened.properties.children[1] as { portal: { properties: { style: { position: string; top: number } } } }
    expect(client.styles).toHaveLength(1)
    expect(client.styles[0]).toContain('.ipedia-codex-value[data-reset]:hover::after')
    expect(client.styles[0]).toContain('.ipedia-codex-value[data-reset]:focus-visible::after')
    expect(client.styles[0]).toContain('content:attr(data-reset)')
    expect(portal.portal.properties.style).toMatchObject({ position: 'fixed', top: 312, width: 'min(264px, calc(100vw - 24px))' })
    const detail = portal.portal as unknown as { properties: { children: Array<{ properties: { children: unknown[] } }> } }
    for (const row of detail.properties.children.slice(1, 3)) {
      expect(row.properties).toMatchObject({ className: 'ipedia-codex-row' })
      const label = row.properties.children[0] as { properties: { children: Array<{ properties: { className: string } }> } }
      expect(label.properties.children[0]).toMatchObject({ properties: { className: 'ipedia-codex-swatch' } })
      const remaining = row.properties.children[1] as { properties: { children: string; 'data-reset': string; title?: string; tabIndex: number } }
      expect(remaining.properties.children).toMatch(/^剩余 \d+%$/)
      expect(remaining.properties['data-reset']).toMatch(/后重置$/)
      expect(remaining.properties.tabIndex).toBe(0)
      expect(remaining.properties.title).toBeUndefined()
    }
  })

  it('keeps the last quota visible while another Codex session mounts', async () => {
    const client = loadQuotaComponent('my-codex')
    client.render()
    client.effects[0]?.()
    await vi.waitFor(() => expect(client.render()).not.toBeNull())
    client.remount('my-codex')
    const tree = client.render() as { properties: { children: Array<{ properties: { children: string } }> } }
    expect(tree.properties.children[0]?.properties.children).toBe('codex 80%')
    client.remount('aodo')
    expect(client.render()).toBeNull()
  })

  it('refreshes when switching to Codex and hides on another provider', () => {
    const client = loadQuotaComponent('aodo')
    expect(client.render()).toBeNull()
    client.effects[0]?.()
    expect(client.fetchMock).not.toHaveBeenCalled()
    client.setProvider('my-codex')
    client.render()
    client.effects[2]?.()
    expect(client.fetchMock).toHaveBeenCalledOnce()
    client.setProvider('aodo')
    expect(client.render()).toBeNull()
    client.effects[4]?.()
    expect(client.fetchMock).toHaveBeenCalledOnce()
  })

  it('does not render without a selected provider', () => {
    const client = loadQuotaComponent(undefined)
    expect(client.render()).toBeNull()
  })
})
