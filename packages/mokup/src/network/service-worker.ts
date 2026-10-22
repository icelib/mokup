import type { MockSession } from '@mokup/runtime/http'

export interface ServiceWorkerOptions {
  url?: string
  options?: RegistrationOptions
}

interface WorkerRequest {
  url: string
  method: string
  headers: [string, string][]
  body: ArrayBuffer | null
  credentials: RequestCredentials
  mode: RequestMode
  cache: RequestCache
  redirect: RequestRedirect
  referrer: string
  referrerPolicy: ReferrerPolicy
  integrity: string
  keepalive: boolean
}

interface Registration {
  session: () => MockSession
  pending: Set<Promise<void>>
  cancellations: Set<() => void>
}

interface Connection {
  url: string
  port: MessagePort
  registrations: Registration[]
  heartbeat: ReturnType<typeof setInterval>
}

let connection: Connection | undefined
let connecting: Promise<Connection> | undefined

async function answer(port: MessagePort, data: WorkerRequest, registration: Registration) {
  const abort = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let finished = false
  let pulling = false
  let cancel = () => {}
  let complete: () => void = () => {}
  const completion = new Promise<void>((resolve) => {
    complete = resolve
  })
  const finish = () => {
    if (!finished) {
      finished = true
      registration.cancellations.delete(cancel)
      port.close()
      complete()
    }
  }
  const fail = () => {
    port.postMessage({ type: 'error' })
    finish()
  }
  cancel = () => {
    abort.abort(new DOMException('Request cancelled.', 'AbortError'))
    void reader?.cancel().catch(() => undefined)
    if (!finished) {
      fail()
    }
  }
  registration.cancellations.add(cancel)
  port.onmessage = async ({ data: message }: MessageEvent<{ type: string }>) => {
    if (message.type === 'cancel') {
      cancel()
    }
    if (message.type === 'pull' && reader && !pulling && !finished) {
      pulling = true
      try {
        const next = await reader.read()
        if (finished) {
          return
        }
        if (next.done) {
          port.postMessage({ type: 'end' })
          finish()
        }
        else {
          port.postMessage({ type: 'chunk', value: next.value })
        }
      }
      catch {
        fail()
      }
      finally {
        pulling = false
      }
    }
  }
  try {
    const request = new Request(data.url, {
      method: data.method,
      headers: data.headers,
      body: data.body,
      credentials: data.credentials,
      mode: data.mode,
      cache: data.cache,
      redirect: data.redirect,
      referrer: data.referrer,
      referrerPolicy: data.referrerPolicy,
      integrity: data.integrity,
      keepalive: data.keepalive,
      signal: abort.signal,
    })
    const response = await registration.session().handle(request)
    if (finished) {
      await response?.body?.cancel()
      return
    }
    if (!response) {
      port.postMessage({ type: 'bypass' })
      finish()
    }
    else if (response.type === 'error') {
      fail()
    }
    else {
      reader = response.body?.getReader()
      port.postMessage({
        type: 'response',
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
        body: !!reader,
      })
      if (!reader) {
        finish()
      }
    }
  }
  catch {
    if (!finished) {
      fail()
    }
  }
  await completion
}

function waitForActive(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  if (registration.active) {
    return Promise.resolve(registration.active)
  }
  const worker = registration.installing ?? registration.waiting
  if (!worker) {
    return Promise.reject(new Error('[mokup] Service Worker registration has no worker.'))
  }
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const change = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        clearTimeout(timeout)
        worker.removeEventListener('statechange', change)
        if (worker.state === 'activated') {
          resolve(worker)
        }
        else {
          reject(new Error('[mokup] Service Worker activation failed.'))
        }
      }
    }
    timeout = setTimeout(() => {
      worker.removeEventListener('statechange', change)
      reject(new Error('[mokup] Service Worker activation timed out. Close other tabs using its old version and retry.'))
    }, 10_000)
    worker.addEventListener('statechange', change)
    change()
  })
}

function waitForControl(container: ServiceWorkerContainer, url: string): Promise<void> {
  if (container.controller?.scriptURL === url) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const change = () => {
      if (container.controller?.scriptURL === url) {
        clearTimeout(timeout)
        container.removeEventListener('controllerchange', change)
        resolve()
      }
    }
    timeout = setTimeout(() => {
      container.removeEventListener('controllerchange', change)
      reject(new Error('[mokup] The Service Worker did not take control of this page. Check its scope.'))
    }, 10_000)
    container.addEventListener('controllerchange', change)
    change()
  })
}

async function connect(options: ServiceWorkerOptions): Promise<Connection> {
  if (!globalThis.navigator?.serviceWorker) {
    throw new Error('[mokup] Service Workers require a secure browser context. Use start({ mode: "interceptor" }) for the in-page fallback.')
  }
  const container = navigator.serviceWorker
  const url = new URL(options.url ?? '/mockServiceWorker.js', location.href).href
  const existing = await container.getRegistration(options.options?.scope ?? location.href)
  const existingWorker = existing?.active ?? existing?.waiting ?? existing?.installing
  if (existingWorker && existingWorker.scriptURL !== url) {
    throw new Error(`[mokup] Another Service Worker controls this scope: ${existingWorker.scriptURL}`)
  }
  const registration = await container.register(url, { ...options.options, type: 'module' })
  if (!location.href.startsWith(registration.scope)) {
    throw new Error('[mokup] The Service Worker scope does not include the current page.')
  }
  const worker = await waitForActive(registration)
  const channel = new MessageChannel()
  const registrations: Registration[] = []
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error('[mokup] Service Worker handshake timed out. Verify the mockServiceWorker.js asset.'))
      }, 10_000)
      channel.port1.onmessage = ({ data, ports }: MessageEvent<{ type: string, request: WorkerRequest }>) => {
        if (data.type === 'ready') {
          clearTimeout(timeout)
          resolve()
        }
        if (data.type === 'request') {
          const port = ports[0]
          if (!port) {
            return
          }
          const active = registrations.at(-1)
          if (!active) {
            port.postMessage({ type: 'bypass' })
            port.close()
            return
          }
          const task = answer(port, data.request, active)
          active.pending.add(task)
          void task.then(() => active.pending.delete(task), () => active.pending.delete(task))
        }
      }
      worker.postMessage({ type: 'mokup:connect', version: 1 }, [channel.port2])
    })
    await waitForControl(container, url)
  }
  catch (error) {
    clearTimeout(timeout)
    channel.port1.postMessage({ type: 'disconnect' })
    channel.port1.close()
    channel.port2.close()
    throw error
  }
  // A live page keeps the worker alive, including while an SSE response is open.
  const heartbeat = setInterval(() => worker.postMessage({ type: 'mokup:keepalive' }), 5000)
  return { url, port: channel.port1, registrations, heartbeat }
}

export async function attachServiceWorker(session: () => MockSession, options: ServiceWorkerOptions = {}) {
  if (!globalThis.navigator?.serviceWorker || !globalThis.location) {
    throw new Error('[mokup] Service Workers require a secure browser context. Use start({ mode: "interceptor" }) for the in-page fallback.')
  }
  const url = new URL(options.url ?? '/mockServiceWorker.js', globalThis.location?.href).href
  if (!connection) {
    connecting ??= connect(options)
    try {
      connection = await connecting
    }
    finally {
      connecting = undefined
    }
  }
  if (connection.url !== url) {
    throw new Error('[mokup] Active mock sessions must use the same Service Worker URL.')
  }
  const owned = connection
  const registration: Registration = { session, pending: new Set(), cancellations: new Set() }
  owned.registrations.push(registration)
  return async () => {
    const index = owned.registrations.indexOf(registration)
    if (index !== -1) {
      owned.registrations.splice(index, 1)
    }
    for (const cancel of [...registration.cancellations]) {
      cancel()
    }
    if (owned.registrations.length === 0 && connection === owned) {
      owned.port.postMessage({ type: 'disconnect' })
      owned.port.close()
      clearInterval(owned.heartbeat)
      connection = undefined
    }
    await Promise.allSettled(registration.pending)
  }
}
