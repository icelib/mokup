import type { PlaygroundRoute } from '../src/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { usePlaygroundRequest } from '../src/hooks/usePlaygroundRequest'
import { usePlaygroundRoutes } from '../src/hooks/usePlaygroundRoutes'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('usePlaygroundRequest', () => {
  const route: PlaygroundRoute = {
    method: 'GET',
    url: '/api/hello',
    file: 'mock.ts',
    type: 'handler',
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('increments counts after a response is received', async () => {
    const selected = ref<PlaygroundRoute | null>(route)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: vi.fn().mockResolvedValue('ok'),
    }))

    const { runRequest, getRouteCount, totalCount } = usePlaygroundRequest(selected)
    await runRequest()

    expect(getRouteCount(route)).toBe(1)
    expect(totalCount.value).toBe(1)
  })

  it('does not increment counts when fetch throws', async () => {
    const selected = ref<PlaygroundRoute | null>(route)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    const { runRequest, getRouteCount, totalCount } = usePlaygroundRequest(selected)
    await runRequest()

    expect(getRouteCount(route)).toBe(0)
    expect(totalCount.value).toBe(0)
  })

  it('returns empty requestUrl when no route is selected', () => {
    const selected = ref<PlaygroundRoute | null>(null)
    const { requestUrl } = usePlaygroundRequest(selected)
    expect(requestUrl.value).toBe('')
  })

  it('syncs params and builds request URLs', () => {
    const selected = ref<PlaygroundRoute | null>({
      method: 'GET',
      url: '/users/[id]',
      file: 'users.get.ts',
      type: 'handler',
    })

    const { requestUrl, queryText, paramValues, missingParams, setParamValue } = usePlaygroundRequest(selected)

    missingParams.value = ['id']
    setParamValue('id', '123')
    expect(paramValues.value.id).toBe('123')
    expect(missingParams.value).toEqual([])

    queryText.value = '{"q":"ok"}'
    expect(requestUrl.value).toContain('/users/123')
    expect(requestUrl.value).toContain('?q=ok')
  })

  it('keeps missing params when values are empty', () => {
    const selected = ref<PlaygroundRoute | null>({
      method: 'GET',
      url: '/users/[id]',
      file: 'users.get.ts',
      type: 'handler',
    })

    const { requestUrl, queryText, missingParams, setParamValue } = usePlaygroundRequest(selected)
    missingParams.value = ['id']
    setParamValue('id', '   ')
    expect(missingParams.value).toEqual(['id'])

    queryText.value = '{'
    expect(requestUrl.value).toBe('/users/[id]')
  })

  it('keeps missing params when name is not in list', () => {
    const selected = ref<PlaygroundRoute | null>({
      method: 'GET',
      url: '/users/[id]',
      file: 'users.get.ts',
      type: 'handler',
    })

    const { missingParams, setParamValue } = usePlaygroundRequest(selected)
    missingParams.value = ['id']
    setParamValue('name', 'Ada')
    expect(missingParams.value).toEqual(['id'])
  })

  it('syncs route params when selection changes', async () => {
    const selected = ref<PlaygroundRoute | null>({
      method: 'GET',
      url: '/users/[id]',
      file: 'users.get.ts',
      type: 'handler',
    })

    const { routeParams, paramValues } = usePlaygroundRequest(selected)
    selected.value = null
    await nextTick()
    expect(routeParams.value).toEqual([])
    expect(paramValues.value).toEqual({})

    selected.value = {
      method: 'GET',
      url: '/users/[id]',
      file: 'users.get.ts',
      type: 'handler',
    }
    await nextTick()
    expect(routeParams.value.length).toBe(1)
    expect(paramValues.value).toHaveProperty('id')
  })

  it('connects websocket and updates counts', async () => {
    const selected = ref<PlaygroundRoute | null>(route)
    const basePath = ref('/__mokup')
    const sockets: MockWebSocket[] = []

    class MockWebSocket {
      url: string
      listeners = new Map<string, Array<(event: MessageEvent) => void>>()
      constructor(url: string) {
        this.url = url
        sockets.push(this)
      }

      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        const list = this.listeners.get(type) ?? []
        list.push(handler)
        this.listeners.set(type, list)
      }

      emit(type: string, event: MessageEvent) {
        const list = this.listeners.get(type) ?? []
        for (const handler of list) {
          handler(event)
        }
      }

      close() {
        this.emit('close', {} as MessageEvent)
      }
    }

    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
    vi.stubGlobal('WebSocket', MockWebSocket as never)

    const { getRouteCount } = usePlaygroundRequest(selected, { basePath })
    await nextTick()

    const socket = sockets[0]
    expect(socket?.url).toContain('/__mokup/ws')
    socket.emit('message', {
      data: JSON.stringify({ type: 'increment', routeKey: 'GET /api/hello', total: 1 }),
    } as MessageEvent)
    expect(getRouteCount(route)).toBe(1)

    socket.emit('message', {
      data: JSON.stringify({
        type: 'snapshot',
        total: 1,
        perRoute: { 'GET /api/hello': 2 },
      }),
    } as MessageEvent)
    expect(getRouteCount(route)).toBe(2)

    socket.emit('message', {
      data: JSON.stringify({ type: 'increment', routeKey: 'GET /api/hello', total: 2 }),
    } as MessageEvent)
    expect(getRouteCount(route)).toBe(3)

    socket.emit('message', { data: 123 } as MessageEvent)
    socket.emit('message', { data: 'not-json' } as MessageEvent)
    expect(getRouteCount(route)).toBe(3)

    basePath.value = '/__mokup/'
    await nextTick()
    expect(sockets).toHaveLength(1)

    socket.close()
    socket.emit('error', {} as MessageEvent)
  })

  it('skips websocket when window is undefined', async () => {
    const selected = ref<PlaygroundRoute | null>(route)
    const basePath = ref('/__mokup')
    const request = () => usePlaygroundRequest(selected, { basePath })
    expect(request).not.toThrow()
    await nextTick()
  })

  it('skips websocket when basePath is empty', async () => {
    const selected = ref<PlaygroundRoute | null>(route)
    const basePath = ref('')
    const sockets: MockWebSocket[] = []

    class MockWebSocket {
      constructor() {
        sockets.push(this)
      }

      addEventListener() {}
    }

    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
    vi.stubGlobal('WebSocket', MockWebSocket as never)

    usePlaygroundRequest(selected, { basePath })
    await nextTick()

    expect(sockets).toHaveLength(0)
  })

  it.each(['/', '/index.html'])('connects enabled root metrics after initializing from %s', async (pathname) => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_MOKUP_PLAYGROUND_WS', 'true')
    const sockets: MockWebSocket[] = []
    class MockWebSocket {
      listeners = new Map<string, (event: MessageEvent) => void>()
      close = vi.fn()
      constructor(public url: string) {
        sockets.push(this)
      }

      addEventListener(event: string, handler: (event: MessageEvent) => void) {
        this.listeners.set(event, handler)
      }
    }
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    const scope = effectScope()
    try {
      const state = scope.run(() => {
        const routesState = usePlaygroundRoutes()
        const requestState = usePlaygroundRequest(routesState.selected, { basePath: routesState.basePath })
        return { routesState, requestState }
      })!
      expect(sockets).toHaveLength(0)

      state.routesState.setBasePath(pathname)
      await nextTick()

      expect(sockets).toHaveLength(1)
      const socket = sockets[0]!
      expect(socket.url).toBe('ws://localhost/ws')
      socket.listeners.get('message')?.({
        data: JSON.stringify({ type: 'snapshot', total: 2, perRoute: { 'GET /api/hello': 2 } }),
      } as MessageEvent)
      expect(state.requestState.getRouteCount(route)).toBe(2)

      state.routesState.setBasePath(pathname === '/' ? '/index.html' : '/')
      await nextTick()
      expect(sockets).toHaveLength(1)
    }
    finally {
      scope.stop()
      sockets.forEach(socket => socket.close())
    }
  })

  it('does not increment counts when server counts are active', async () => {
    const originalEnv = { ...import.meta.env }
    Object.assign(import.meta.env, { DEV: true })
    try {
      const selected = ref<PlaygroundRoute | null>(route)
      const basePath = ref('/__mokup')
      const sockets: MockWebSocket[] = []

      class MockWebSocket {
        url: string
        listeners = new Map<string, Array<(event: MessageEvent) => void>>()
        constructor(url: string) {
          this.url = url
          sockets.push(this)
        }

        addEventListener(type: string, handler: (event: MessageEvent) => void) {
          const list = this.listeners.get(type) ?? []
          list.push(handler)
          this.listeners.set(type, list)
        }

        emit(type: string, event: MessageEvent) {
          const list = this.listeners.get(type) ?? []
          for (const handler of list) {
            handler(event)
          }
        }

        close() {}
      }

      vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
      vi.stubGlobal('WebSocket', MockWebSocket as never)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'text/plain' },
        text: vi.fn().mockResolvedValue('ok'),
      }))

      const { runRequest, getRouteCount } = usePlaygroundRequest(selected, { basePath })
      await nextTick()

      const socket = sockets[0]
      socket?.emit('open', {} as MessageEvent)
      await runRequest()
      expect(getRouteCount(route)).toBe(0)

      socket?.emit('error', {} as MessageEvent)
    }
    finally {
      Object.assign(import.meta.env, originalEnv)
    }
  })

  it('reports missing params during requests', async () => {
    const selected = ref<PlaygroundRoute | null>({
      method: 'GET',
      url: '/users/[id]',
      file: 'users.get.ts',
      type: 'handler',
    })

    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })

    const { runRequest, missingParams, missingPulse, responseText } = usePlaygroundRequest(selected)
    await runRequest()

    expect(missingParams.value).toEqual(['id'])
    expect(missingPulse.value).toBe(1)
    expect(responseText.value).toContain('errors.routeParams')
  })

  it('handles websocket constructor failures', async () => {
    const selected = ref<PlaygroundRoute | null>(route)
    const basePath = ref('/__mokup')
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
    vi.stubGlobal('WebSocket', class {
      constructor() {
        throw new Error('boom')
      }
    } as never)

    const request = () => usePlaygroundRequest(selected, { basePath })
    expect(request).not.toThrow()
    await nextTick()
  })

  it('builds requestUrl before params are synced', () => {
    const selected = ref<PlaygroundRoute | null>(route)
    const { requestUrl } = usePlaygroundRequest(selected)
    expect(requestUrl.value).toContain('/api/hello')
  })

  it('uses cached route tokens when available', async () => {
    const routeWithParams: PlaygroundRoute = {
      method: 'GET',
      url: '/users/[id]',
      file: 'users.get.ts',
      type: 'handler',
    }
    const selected = ref<PlaygroundRoute | null>(routeWithParams)

    const { requestUrl, queryText } = usePlaygroundRequest(selected)
    selected.value = null
    await nextTick()
    selected.value = routeWithParams
    await nextTick()

    queryText.value = '{"q":"ok"}'
    expect(requestUrl.value).toContain('/users/[id]')
    expect(requestUrl.value).toContain('?q=ok')
  })
})
