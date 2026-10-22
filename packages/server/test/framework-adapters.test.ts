import { describe, expect, it } from 'vitest'
import { createAstroEndpoint } from '../src/astro'
import { createNextRouteHandler } from '../src/next'
import { createNuxtHandler } from '../src/nuxt'

const manifest = {
  version: 1,
  routes: [
    {
      method: 'GET',
      url: '/users/[id]',
      response: {
        type: 'json',
        body: { ok: true },
      },
    },
  ],
} as const

describe('framework route adapters', () => {
  it('creates Next App Router method exports and preserves route context', async () => {
    const handler = createNextRouteHandler({ manifest })
    const response = await handler.GET(new Request('https://example.test/users/42'), {
      params: { id: '42' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    await expect(handler.listHandlers()).resolves.toHaveLength(1)
    await handler.close()
  })

  it('returns an explicit 404 from Next route modules for unmatched requests', async () => {
    const handler = createNextRouteHandler({ manifest })
    try {
      const response = await handler.GET(new Request('https://example.test/missing'))
      expect(response.status).toBe(404)
    }
    finally {
      await handler.close()
    }
  })

  it('supports Nuxt Fetch events with the same runtime controls', async () => {
    const handler = createNuxtHandler({ manifest })
    try {
      const response = await handler({
        request: new Request('https://example.test/users/nuxt'),
        context: { requestId: 'nuxt-test' },
      })
      expect(response?.status).toBe(200)
      await expect(response?.json()).resolves.toEqual({ ok: true })
    }
    finally {
      await handler.close()
    }
  })

  it('creates Astro endpoint method exports and maps endpoint context', async () => {
    const handler = createAstroEndpoint({ manifest })
    try {
      const response = await handler.GET({
        request: new Request('https://example.test/users/astro'),
        params: { id: 'astro' },
        locals: { source: 'test' },
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
    }
    finally {
      await handler.close()
    }
  })
})
