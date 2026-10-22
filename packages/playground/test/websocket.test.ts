import { describe, expect, it, vi } from 'vitest'
import { parseWsMessage, resolvePlaygroundWsUrl } from '../src/hooks/playground-request/websocket'

describe('playground websocket helpers', () => {
  it('parses websocket payloads', () => {
    const snapshot = parseWsMessage('{"type":"snapshot","total":1,"perRoute":{"GET /a":2}}')
    expect(snapshot?.type).toBe('snapshot')

    const increment = parseWsMessage('{"type":"increment","routeKey":"GET /a","total":2}')
    expect(increment?.type).toBe('increment')

    const scenario = parseWsMessage('{"type":"scenario","scenario":{"names":["happy","error"],"active":"error"}}')
    expect(scenario?.type).toBe('scenario')

    const scenarioError = parseWsMessage('{"type":"scenario:error","message":"Unknown scenario"}')
    expect(scenarioError?.type).toBe('scenario:error')

    const missingFields = parseWsMessage('{"type":"snapshot","total":1}')
    expect(missingFields).toBeNull()

    const invalid = parseWsMessage('not-json')
    expect(invalid).toBeNull()
  })

  it('preserves handler coverage and aggregate diagnostics from snapshots', () => {
    const payload = parseWsMessage(JSON.stringify({
      type: 'snapshot',
      total: 2,
      perRoute: { 'GET /a': 2 },
      diagnostics: {
        timeline: [],
        handlers: [{ id: 'handler-1', method: 'GET', matcher: '/a', once: false, active: true, matched: 2, mocked: 2 }],
        totals: { started: 2, completed: 2, mocked: 2, bypassed: 0, unhandled: 0, errors: 0 },
      },
    }))
    expect(payload?.type).toBe('snapshot')
    if (payload?.type === 'snapshot') {
      expect(payload.diagnostics?.handlers[0]?.mocked).toBe(2)
      expect(payload.diagnostics?.totals.completed).toBe(2)
    }
  })

  it('resolves websocket URLs from base paths', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
    expect(resolvePlaygroundWsUrl('')).toBe('')
    expect(resolvePlaygroundWsUrl('/__mokup')).toBe('ws://localhost/__mokup/ws')
    expect(resolvePlaygroundWsUrl('mokup')).toBe('ws://localhost/mokup/ws')
  })

  it('disables websocket when env flags are off', () => {
    const original = { ...import.meta.env }
    Object.assign(import.meta.env, { DEV: false, VITE_MOKUP_PLAYGROUND_WS: '' })
    vi.stubGlobal('window', { location: { origin: 'https://example.com' } })

    expect(resolvePlaygroundWsUrl('/__mokup')).toBe('')

    Object.assign(import.meta.env, { DEV: false, VITE_MOKUP_PLAYGROUND_WS: 'true' })
    expect(resolvePlaygroundWsUrl('/__mokup')).toBe('wss://example.com/__mokup/ws')

    Object.assign(import.meta.env, { DEV: false, VITE_MOKUP_PLAYGROUND_WS: 'off' })
    expect(resolvePlaygroundWsUrl('/__mokup')).toBe('')

    Object.assign(import.meta.env, { DEV: false, VITE_MOKUP_PLAYGROUND_WS: 'maybe' })
    expect(resolvePlaygroundWsUrl('/__mokup')).toBe('')

    Object.assign(import.meta.env, original)
  })
})
