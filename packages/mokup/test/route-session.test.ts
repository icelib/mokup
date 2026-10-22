import { http, HttpResponse } from '@mokup/runtime/http'
import { describe, expect, it, vi } from 'vitest'
import { createRouteSessions } from '../src/shared/route-session'

describe('file-route server generation ownership', () => {
  it('reuses a generation across scans and isolates other servers', async () => {
    const sessions = createRouteSessions()
    const first = {}
    const second = {}
    const one = sessions.get(first)
    const two = sessions.get(second)
    one.use(http.get('/once', () => HttpResponse.text('first'), { once: true }))
    two.use(http.get('/once', () => HttpResponse.text('second'), { once: true }))
    try {
      expect(sessions.get(first)).toBe(one)
      expect(await (await one.handle(new Request('https://example.test/once')))?.text()).toBe('first')
      expect(await sessions.get(first).handle(new Request('https://example.test/once'))).toBeUndefined()
      await sessions.close(first)
      expect(() => sessions.get(first)).toThrow('closed server')
      expect(await (await two.handle(new Request('https://example.test/once')))?.text()).toBe('second')
      await sessions.close(first)
    }
    finally {
      await Promise.all([sessions.close(first), sessions.close(second)])
    }
  })

  it('cancels active streams before server disposal completes', async () => {
    const sessions = createRouteSessions()
    const owner = {}
    const session = sessions.get(owner)
    const cancelled = vi.fn()
    session.use(http.get('/stream', () => new HttpResponse(new ReadableStream({ cancel: cancelled }))))
    const response = await session.handle(new Request('https://example.test/stream'))
    try {
      await sessions.close(owner)
      expect(cancelled).toHaveBeenCalledOnce()
      await expect(response?.text()).rejects.toMatchObject({ name: 'AbortError' })
    }
    finally {
      await sessions.close(owner)
    }
  })
})
