// This standalone module is copied to an application's public directory.
// Only clients that explicitly connect are mocked; all others pass through.
interface WorkerMessage {
  data: { type: string, version?: number }
  ports: readonly MessagePort[]
  source: { id: string } | null
  waitUntil: (task: Promise<unknown>) => void
}

interface WorkerFetch {
  request: Request
  clientId: string
  respondWith: (response: Promise<Response>) => void
}

interface WorkerScope {
  addEventListener: ((type: 'message', listener: (event: WorkerMessage) => void) => void)
    & ((type: 'fetch', listener: (event: WorkerFetch) => void) => void)
  clients: {
    claim: () => Promise<void>
    get: (id: string) => Promise<unknown>
  }
}

interface ResponseMessage {
  type: string
  status: number
  statusText: string
  headers: [string, string][]
  body: boolean
  value: Uint8Array
}

const scope = globalThis as unknown as WorkerScope
const clients = new Map<string, MessagePort>()

async function resolveRequest(request: Request, connection: MessagePort) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().arrayBuffer()
  const channel = new MessageChannel()
  return new Promise<Response>((resolve) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let responded = false
    let pulled: (() => void) | undefined
    let cancel = () => {}
    const finish = () => {
      request.signal.removeEventListener('abort', cancel)
      channel.port1.close()
      pulled?.()
    }
    cancel = () => {
      channel.port1.postMessage({ type: 'cancel' })
      if (responded) {
        controller?.error(request.signal.reason)
      }
      else {
        resolve(Response.error())
      }
      finish()
    }
    channel.port1.onmessage = ({ data }: MessageEvent<ResponseMessage>) => {
      if (data.type === 'bypass') {
        resolve(fetch(request))
        finish()
      }
      if (data.type === 'error') {
        if (responded) {
          controller?.error(new TypeError('Mock response stream failed.'))
        }
        else {
          resolve(Response.error())
        }
        finish()
      }
      if (data.type === 'response') {
        const stream = data.body
          ? new ReadableStream<Uint8Array>({
              start(next) { controller = next },
              pull() {
                return new Promise<void>((resolve) => {
                  pulled = resolve
                  channel.port1.postMessage({ type: 'pull' })
                })
              },
              cancel() {
                channel.port1.postMessage({ type: 'cancel' })
                finish()
              },
            })
          : null
        responded = true
        resolve(new Response(stream, { status: data.status, statusText: data.statusText, headers: data.headers }))
        if (!stream) {
          finish()
        }
      }
      if (data.type === 'chunk') {
        controller?.enqueue(data.value)
        pulled?.()
        pulled = undefined
      }
      if (data.type === 'end') {
        controller?.close()
        finish()
      }
    }
    request.signal.addEventListener('abort', cancel, { once: true })
    connection.postMessage({
      type: 'request',
      request: {
        url: request.url,
        method: request.method,
        headers: [...request.headers],
        body,
        credentials: request.credentials,
        mode: request.mode,
        cache: request.cache,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        integrity: request.integrity,
        keepalive: request.keepalive,
      },
    }, [channel.port2])
    if (request.signal.aborted) {
      cancel()
    }
  })
}

scope.addEventListener('message', (event) => {
  const port = event.ports[0]
  const id = event.source?.id
  if (event.data?.type !== 'mokup:connect' || event.data.version !== 1 || !port || !id) {
    return
  }
  event.waitUntil((async () => {
    // Claim only after an explicit connection. The page refuses competing SWs.
    await scope.clients.claim()
    clients.get(id)?.close()
    clients.set(id, port)
    port.onmessage = ({ data }: MessageEvent<{ type: string }>) => {
      if (data.type === 'disconnect' && clients.get(id) === port) {
        clients.delete(id)
        port.close()
      }
    }
    for (const [clientId, clientPort] of clients) {
      if (!await scope.clients.get(clientId)) {
        clients.delete(clientId)
        clientPort.close()
      }
    }
    port.postMessage({ type: 'ready' })
  })())
})

scope.addEventListener('fetch', (event) => {
  const connection = clients.get(event.clientId)
  if (!connection || event.request.mode === 'navigate') {
    return
  }
  event.respondWith(resolveRequest(event.request, connection))
})

export {}
