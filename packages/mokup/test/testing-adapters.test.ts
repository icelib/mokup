import { http, HttpResponse } from '@mokup/runtime/http'
import { afterEach, describe, expect, it } from 'vitest'
import { createCypressInterceptor } from '../src/testing/cypress'
import { createStorybookDecorator } from '../src/testing/storybook'

describe('framework adapters', () => {
  const disposers: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(disposers.splice(0).map(dispose => dispose()))
  })

  it('maps Cypress intercept requests through the shared session', async () => {
    const adapter = createCypressInterceptor({ handlers: [http.post('/users', async ({ request }) => HttpResponse.json({ name: await request.text() }, { status: 201 }))] })
    disposers.push(adapter.dispose)
    let reply: unknown
    let continued = false
    await adapter.handle({
      method: 'POST',
      url: 'https://example.test/users',
      headers: { 'content-type': 'text/plain' },
      body: 'Ada',
      reply: (value) => { reply = value },
      continue: () => { continued = true },
    })
    expect(continued).toBe(false)
    expect(reply).toMatchObject({ statusCode: 201, body: { name: 'Ada' } })
    let fellThrough = false
    await adapter.handle({
      method: 'GET',
      url: 'https://example.test/miss',
      reply: () => {},
      continue: () => { fellThrough = true },
    })
    expect(fellThrough).toBe(true)
  })

  it('starts Storybook interception before invoking the decorator', async () => {
    const controller = createStorybookDecorator({ handlers: [http.get('/storybook', () => HttpResponse.text('ready'))] })
    disposers.push(controller.stop)
    await controller.ready
    const result = controller.decorator(context => context.value, { value: 'story' })
    expect(result).toBe('story')
    expect(await (await fetch('https://example.test/storybook')).text()).toBe('ready')
  })
})
