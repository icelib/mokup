import type { BrowserContext, Page } from '@playwright/test'
import { http, HttpResponse } from 'mokup/http'
import { attachPlaywright, createCypressInterceptor, createStorybookDecorator, registerMockHooks } from 'mokup/testing'
import { expectType } from 'tsd'

declare const context: BrowserContext
declare const page: Page
const handlers = [http.get('/api', () => HttpResponse.json({ ok: true }))]
attachPlaywright(context, { handlers }).then((byContext) => {
  expectType<Promise<void>>(byContext.detach())
  registerMockHooks({ beforeAll: () => {}, afterEach: () => {}, afterAll: () => {} }, {
    start: async () => {},
    reset: () => {},
    stop: () => byContext.detach(),
  })
})
attachPlaywright(page, { handlers, onUnhandled: 'error' }).then((byPage) => {
  expectType<readonly Error[]>(byPage.errors())
})
const cypress = createCypressInterceptor({ handlers })
expectType<Promise<void>>(cypress.handle({ method: 'GET', url: 'https://example.test/api', reply: () => {}, continue: () => {} }))
expectType<Promise<void>>(cypress.dispose())
const storybook = createStorybookDecorator({ handlers })
expectType<Promise<void>>(storybook.ready)
expectType<unknown>(storybook.decorator(() => 'story', {}))
