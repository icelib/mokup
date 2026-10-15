import { describe, expect, it, vi } from 'vitest'
import { createFetchExecutor } from '../src/index'

const url = 'https://api.example.test/upload'

const nativeBodies: Array<[string, () => BodyInit | null | undefined, string, string | null]> = [
  ['string', () => 'unchanged text', 'unchanged text', 'text/plain;charset=UTF-8'],
  ['URLSearchParams', () => new URLSearchParams([['q', 'a b'], ['q', 'c']]), 'q=a+b&q=c', 'application/x-www-form-urlencoded;charset=UTF-8'],
  ['Blob', () => new Blob(['blob bytes'], { type: 'application/octet-stream' }), 'blob bytes', 'application/octet-stream'],
  ['File', () => new File(['file bytes'], 'example.txt', { type: 'text/plain' }), 'file bytes', 'text/plain'],
  ['ArrayBuffer', () => new Uint8Array([65, 66]).buffer, 'AB', null],
  ['Uint8Array slice', () => new Uint8Array([0, 65, 66, 0]).subarray(1, 3), 'AB', null],
  ['DataView slice', () => new DataView(new Uint8Array([0, 65, 66, 0]).buffer, 1, 2), 'AB', null],
  ['null', () => null, '', null],
  ['undefined', () => undefined, '', null],
]

describe('Fetch executor native request bodies', () => {
  it.each(nativeBodies)('preserves %s bytes and native content type', async (_label, createBody, text, contentType) => {
    const body = createBody()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init)
      expect(init?.body).toBe(body)
      expect(await request.text()).toBe(text)
      expect(request.headers.get('content-type')).toBe(contentType)
      return new Response('ok')
    })

    expect(await createFetchExecutor({ fetch })({ url, method: 'POST', body })).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves FormData fields, files and the generated multipart boundary', async () => {
    const body = new FormData()
    body.append('label', 'first')
    body.append('label', 'second')
    body.append('attachment', new File(['file contents'], 'example.txt', { type: 'text/plain' }))
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(init?.body).toBe(body)
      expect(new Headers(init?.headers).has('content-type')).toBe(false)
      const request = new Request(input, init)
      expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
      const decoded = await request.formData()
      expect(decoded.getAll('label')).toEqual(['first', 'second'])
      const file = decoded.get('attachment') as File
      expect(file.name).toBe('example.txt')
      expect(file.type).toBe('text/plain')
      expect(await file.text()).toBe('file contents')
      return new Response('ok')
    })

    expect(await createFetchExecutor({ fetch })({ url, method: 'POST', body })).toBe('ok')
    expect(body.getAll('label')).toEqual(['first', 'second'])
  })

  it('passes a ReadableStream through without buffering or changing its content type', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('stream bytes'))
        controller.close()
      },
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(init?.body).toBe(body)
      expect(body.locked).toBe(false)
      expect(new Headers(init?.headers).has('content-type')).toBe(false)
      // The injected transport supplies Node's duplex option to inspect the native stream.
      const nodeInit = { ...init, duplex: 'half' }
      const request = new Request(input, nodeInit)
      expect(await request.text()).toBe('stream bytes')
      return new Response('ok')
    })

    expect(await createFetchExecutor({ fetch })({ url, method: 'POST', body })).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not JSON-encode arbitrary class instances', async () => {
    class CustomBody {
      toString() {
        return 'custom body'
      }
    }
    const body = new CustomBody()
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(init?.body).toBe(body)
      const request = new Request(input, init)
      expect(await request.text()).toBe('custom body')
      expect(request.headers.get('content-type')).toBe('text/plain;charset=UTF-8')
      return new Response('ok')
    })

    expect(await createFetchExecutor({ fetch })({ url, method: 'POST', body })).toBe('ok')
  })

  it.each(['GET', 'HEAD'])('retains native %s body rejection', async (method) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      return new Response(await new Request(input, init).text())
    })

    await expect(createFetchExecutor({ fetch })({ url, method, body: { name: 'Ada' } })).rejects.toBeInstanceOf(TypeError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
