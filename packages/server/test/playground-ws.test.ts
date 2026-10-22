import { EventEmitter } from 'node:events'
import { createMockSession } from '@mokup/runtime/http'
import { createScenario, createScenarioCatalog } from '@mokup/runtime/scenario'
import { describe, expect, it, vi } from 'vitest'
import { createPlaygroundWs } from '../src/fetch-server/playground-ws'

const wsMocks = vi.hoisted(() => ({
  handlers: null as null | { onOpen?: any, onClose?: any, onMessage?: any },
  server: null as unknown,
}))

vi.mock('@hono/node-server', () => ({
  upgradeWebSocket: (factory: () => any) => {
    const handlers: { onOpen?: any, onClose?: any, onMessage?: any } = {}
    wsMocks.handlers = handlers
    Object.assign(handlers, factory())
    return vi.fn()
  },
}))

vi.mock('ws', () => ({
  WebSocketServer: class MockWebSocketServer extends EventEmitter {
    options = { noServer: true }
    clients = new Set<{ terminate: () => void }>()
    close = vi.fn((callback: (error?: Error) => void) => {
      this.emit('close')
      callback()
    })

    constructor() {
      super()
      wsMocks.server = this
    }
  },
}))

describe('playground websocket server', () => {
  it('registers websocket handlers and broadcasts', async () => {
    const playground = { enabled: true }
    const ws = createPlaygroundWs(playground as any)

    await ws.setupPlaygroundWebSocket()

    const handler = ws.getWsHandler()
    expect(handler).toBeDefined()
    expect(ws.getWebSocketOptions()?.server).toBe(wsMocks.server)

    const client = { send: vi.fn() }
    const route = { method: 'GET', template: '/ping' }

    const handlers = wsMocks.handlers
    handlers?.onOpen({}, client)

    expect(client.send).toHaveBeenCalled()

    ws.handleRouteResponse(route as any)
    expect(client.send).toHaveBeenCalled()

    handlers?.onMessage?.({}, client)
    handlers?.onClose({}, client)
  })

  it('skips websocket setup when disabled', async () => {
    const ws = createPlaygroundWs({ enabled: false } as any)
    await ws.setupPlaygroundWebSocket()
    expect(ws.getWsHandler()).toBeUndefined()
  })

  it('exposes and controls named scenarios through the Playground socket', async () => {
    const playground = { enabled: true }
    const ws = createPlaygroundWs(playground as any)
    const session = createMockSession({
      scenario: createScenarioCatalog({
        happy: createScenario('happy', { status: 200 }),
        error: createScenario('error', { status: 500 }),
      }),
    })
    ws.attachSession(session)
    await ws.setupPlaygroundWebSocket()
    const client = { send: vi.fn() }
    const handlers = wsMocks.handlers
    handlers?.onOpen({}, client)
    const snapshot = JSON.parse(client.send.mock.calls[0]![0] as string) as { scenario?: { names: string[], active: string } }
    expect(snapshot.scenario).toEqual({ names: ['happy', 'error'], active: 'happy' })

    handlers?.onMessage({ data: JSON.stringify({ type: 'scenario', action: 'select', name: 'error' }) }, client)
    expect(session.scenario?.active()).toBe('error')
    const selected = JSON.parse(client.send.mock.calls.at(-1)![0] as string) as { type: string, scenario?: { active: string } }
    expect(selected).toEqual({ type: 'scenario', scenario: { names: ['happy', 'error'], active: 'error' } })

    handlers?.onMessage({ data: JSON.stringify({ type: 'scenario', action: 'select', name: 'missing' }) }, client)
    const failure = JSON.parse(client.send.mock.calls.at(-1)![0] as string) as { type: string, message: string }
    expect(failure.type).toBe('scenario:error')
    expect(failure.message).toContain('Unknown scenario')
    await ws.dispose()
    await session.dispose()
  })
})
