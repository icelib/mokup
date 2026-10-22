import { createMockSession, http, HttpResponse } from '../../../packages/runtime/src/http'

const session = createMockSession(http.get('https://api.example.test/worker/:id', ({ params }) => HttpResponse.json(params)))
globalThis.onmessage = async ({ data }: MessageEvent<string>) => {
  try {
    const response = await session.handle(new Request(data))
    globalThis.postMessage(await response?.json())
  }
  finally {
    await session.dispose()
  }
}
