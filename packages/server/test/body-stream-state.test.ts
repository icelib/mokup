import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { toRuntimeRequestFromNode } from '../src/internal/request'

describe('body overrides and completed Node requests', () => {
  it('uses an existing body after upstream has consumed the stream', async () => {
    const body = { parsed: true }
    const req = Object.assign(new PassThrough(), { url: '/', headers: {}, body })
    try {
      const ended = once(req, 'end')
      req.resume()
      req.end('already consumed')
      await ended
      const result = await toRuntimeRequestFromNode(req)
      expect(result.body).toBe(body)
      expect(result.rawBody).toBeUndefined()
    }
    finally {
      req.destroy()
    }
  })

  it('keeps explicit body overrides ahead of request body and stream state', async () => {
    const req = Object.assign(new PassThrough(), {
      url: '/',
      headers: { 'content-type': 'application/json' },
      body: { stale: true },
    })
    try {
      req.destroy()
      const result = await toRuntimeRequestFromNode(req, '{"override":true}')
      expect(result.body).toEqual({ override: true })
      expect(result.rawBody).toBe('{"override":true}')
    }
    finally {
      req.destroy()
    }
  })
})
