import type { ServerResponse } from 'node:http'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getResponseCookies } from '@mokup/runtime'

/** Validate and read the first chunk before committing; then stream with backpressure. */
export async function sendNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  const reader = response.body?.getReader()
  let completed = false
  try {
    const cookies = getResponseCookies(response)
    const headers = Array.from(response.headers).filter(([key]) => key !== 'set-cookie')
    for (const [key, value] of headers) {
      validateHeaderName(key)
      validateHeaderValue(key, value)
    }
    for (const cookie of cookies) {
      validateHeaderValue('set-cookie', cookie)
    }
    const first = await reader?.read()
    res.statusCode = response.status
    for (const [key, value] of headers) {
      res.setHeader(key, value)
    }
    if (cookies.length) {
      res.setHeader('set-cookie', cookies)
    }
    if (!reader || first?.done) {
      completed = true
      res.end()
      return
    }
    async function* chunks() {
      yield first!.value!
      while (true) {
        const next = await reader!.read()
        if (next.done) {
          completed = true
          return
        }
        yield next.value
      }
    }
    await pipeline(Readable.from(chunks()), res)
  }
  finally {
    try {
      if (!completed) {
        await reader?.cancel()
      }
    }
    finally {
      reader?.releaseLock()
    }
  }
}
