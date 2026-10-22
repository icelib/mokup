import { createMockSession, http, HttpResponse } from '@mokup/runtime/http'
import { describe, expect, it } from 'vitest'
import { createDevframeBridge } from '../src/devframe'

describe('Devframe bridge', () => {
  it('publishes snapshots, events and scenario commands through a structural host', async () => {
    const session = createMockSession({
      handlers: [http.get('/health', () => HttpResponse.json({ ok: true }))],
    })
    const messages: unknown[] = []
    let receive: ((command: { type: 'snapshot' }) => void) | undefined
    const bridge = createDevframeBridge(session)
    const disconnect = bridge.connect({
      send: message => messages.push(message),
      onCommand: (listener) => {
        receive = listener as typeof receive
        return () => {
          receive = undefined
        }
      },
    })

    expect(messages).toHaveLength(1)
    expect((messages[0] as { type: string }).type).toBe('mokup:snapshot')
    await session.handle(new Request('http://local/health'))
    expect(messages).toContainEqual({ type: 'mokup:event', event: 'request:start' })
    receive?.({ type: 'snapshot' })
    expect(messages.filter(message => (message as { type: string }).type === 'mokup:snapshot')).toHaveLength(2)

    disconnect()
    bridge.dispose()
    await session.dispose()
  })

  it('does not require a Devframe dependency and rejects commands after disposal', () => {
    const session = createMockSession()
    const bridge = createDevframeBridge(session)
    bridge.dispose()
    expect(() => bridge.command({ type: 'snapshot' })).toThrow('disposed')
  })

  it('publishes plugin resource metadata without exposing resource values', async () => {
    const session = createMockSession()
    const resources = [{ kind: 'ui' as const, name: 'panel', plugin: 'demo' }]
    const bridge = createDevframeBridge(session, { plugins: { listResources: () => resources } })
    expect(bridge.snapshot().resources).toEqual(resources)
    await session.dispose()
    bridge.dispose()
  })
})
