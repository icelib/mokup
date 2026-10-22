import type { HttpHandler as ForeignHttpHandler } from 'msw'
import { createMockSession } from 'mokup/http'
import { http as foreignHttp, passthrough as foreignPassthrough, HttpResponse as ForeignResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createHandlerAdapter, http } from '../src/handlers'
import { HttpResponse } from '../src/index'
import { setupServer } from '../src/node'

const url = 'https://compat.test/item'
const request = () => new Request(url)

async function compare(definition: ForeignHttpHandler, count: number) {
  const session = createMockSession(createHandlerAdapter()(definition))
  const expected: Array<string | undefined> = []
  const actual: Array<string | undefined> = []
  try {
    for (let index = 0; index < count; index++) {
      const result = await definition.run({ request: request(), requestId: `reference-${index}` })
      expected.push(await result?.response?.text())
      actual.push(await (await session.handle(request()))?.text())
    }
    expect(actual).toEqual(expected)
    return actual
  }
  finally {
    definition.reset()
    await session.dispose()
  }
}

describe('MSW 3.0.2 HTTP execution conformance', () => {
  it('repeats the last yielded response after exhaustion', async () => {
    const values = await compare(foreignHttp.get(url, function* () {
      yield ForeignResponse.text('first')
      yield undefined
      yield ForeignResponse.text('last')
    }), 5)
    expect(values).toEqual(['first', undefined, 'last', 'last', 'last'])
  })

  it('repeats a final returned response', async () => {
    const values = await compare(foreignHttp.get(url, async function* () {
      yield ForeignResponse.text('first')
      return ForeignResponse.text('returned')
    }), 4)
    expect(values).toEqual(['first', 'returned', 'returned', 'returned'])
  })

  it('keeps a once generator active until exhaustion, including its final replay', async () => {
    const values = await compare(foreignHttp.get(url, function* () {
      yield ForeignResponse.text('first')
      yield undefined
      yield ForeignResponse.text('last')
    }, { once: true }), 5)
    expect(values).toEqual(['first', undefined, 'last', 'last', undefined])
  })

  it('consumes an ordinary once resolver even if it returns undefined', async () => {
    const values = await compare(foreignHttp.get(url, () => undefined, { once: true }), 3)
    expect(values).toEqual([undefined, undefined, undefined])
  })

  it('delivers thrown Response values, including from generators', async () => {
    expect(await compare(foreignHttp.get(url, () => {
      throw ForeignResponse.text('thrown', { status: 418 })
    }, { once: true }), 2)).toEqual(['thrown', undefined])
    expect(await compare(foreignHttp.get(url, function* () {
      yield ForeignResponse.text('first')
      throw ForeignResponse.text('thrown')
    }), 2)).toEqual(['first', 'thrown'])
  })

  it('consumes a thrown ordinary once execution and restores it explicitly', async () => {
    const fail = vi.fn(() => {
      throw new Error('resolver failed')
    })
    const session = createMockSession(http.get(url, fail, { once: true }), http.get(url, () => HttpResponse.text('fallback')))
    try {
      await expect(session.handle(request())).rejects.toThrow('resolver failed')
      expect(await (await session.handle(request()))?.text()).toBe('fallback')
      expect(fail).toHaveBeenCalledOnce()
      session.restoreHandlers()
      await expect(session.handle(request())).rejects.toThrow('resolver failed')
      expect(fail).toHaveBeenCalledTimes(2)
    }
    finally {
      await session.dispose()
    }
  })

  it('migrates real foreign predicates, all methods and cookie/typed body resolvers', async () => {
    const definition = foreignHttp.all(async ({ request, cookies }) => ({ matches: cookies.role === 'admin', params: { method: request.method } }), async ({ request, params }) => ForeignResponse.json({ method: params.method, body: await request.json() }))
    const server = setupServer(definition)
    server.listen({ onUnhandledFrame: 'error' })
    try {
      expect(await (await fetch('https://compat.test/arbitrary', { method: 'PATCH', headers: { cookie: 'role=admin' }, body: '{"value":42}' })).json()).toEqual({ method: 'PATCH', body: { value: 42 } })
      expect(definition.isUsed).toBe(false)
      server.use(foreignHttp.get('https://compat.test/item', () => ForeignResponse.text('foreign once'), { once: true }))
      expect(await (await fetch('https://compat.test/item')).text()).toBe('foreign once')
      server.restoreHandlers()
      expect(await (await fetch('https://compat.test/item')).text()).toBe('foreign once')
    }
    finally {
      await server.close()
    }
  })

  it('maps foreign passthrough responses without emitting a mocked redirect', async () => {
    const session = createMockSession({ handlers: [createHandlerAdapter()(foreignHttp.get(url, () => foreignPassthrough()))], onUnhandled: 'error' })
    const mocked = vi.fn()
    session.events.on('response:mocked', mocked)
    try {
      expect(await session.handle(request())).toBeUndefined()
      expect(mocked).not.toHaveBeenCalled()
    }
    finally {
      await session.dispose()
    }
  })

  it('shares foreign definitions safely across parallel isolated boundaries', async () => {
    const definition = foreignHttp.get('https://compat.test/item', function* () {
      yield ForeignResponse.text('first')
      yield ForeignResponse.text('last')
    }, { once: true })
    const server = setupServer(definition)
    server.listen({ onUnhandledFrame: 'error' })
    const run = server.boundary(async () => {
      const values: string[] = []
      for (let index = 0; index < 3; index++) {
        values.push(await (await fetch('https://compat.test/item')).text())
      }
      return values
    })
    try {
      expect(await Promise.all([run(), run()])).toEqual([['first', 'last', 'last'], ['first', 'last', 'last']])
      expect(await (await fetch('https://compat.test/item')).text()).toBe('first')
      expect(definition.isUsed).toBe(false)
    }
    finally {
      await server.close()
    }
  })
})
