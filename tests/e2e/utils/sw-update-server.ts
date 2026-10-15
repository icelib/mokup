import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { injectPlaygroundHmr } from '../../../packages/core/src/playground/inject'
import { buildSwRegistrationScript } from '../../../packages/mokup/src/shared/sw-registration-script'
import { listen } from './http'

export async function startSwUpdateServer(mode: 'playground' | 'registration') {
  let revision = 1
  let released = false
  const gates = new Set<ServerResponse>()
  const fetchedRevisions: number[] = []
  const page = `<script>
    const listeners = new Map()
    let registrationChecks = 0
    let pendingUpdates = 0
    let activatedRevision = 0
    navigator.serviceWorker.addEventListener('message', event => {
      activatedRevision = event.data.revision
    })
    const update = ServiceWorkerRegistration.prototype.update
    ServiceWorkerRegistration.prototype.update = async function () {
      pendingUpdates++
      try {
        return await update.call(this)
      } finally {
        pendingUpdates--
      }
    }
    const getRegistrations = navigator.serviceWorker.getRegistrations.bind(navigator.serviceWorker)
    navigator.serviceWorker.getRegistrations = async () => {
      const registrations = await getRegistrations()
      registrationChecks++
      return registrations
    }
    globalThis.__mokupTest = {
      hot: {
        on(name, fn) { listeners.set(name, fn) },
        off(name) { listeners.delete(name) },
        dispose() {},
      },
      emit() { return listeners.get('mokup:routes-changed')?.() },
      listening() { return listeners.has('mokup:routes-changed') },
      checks() { return registrationChecks },
      pendingUpdates() { return pendingUpdates },
      activatedRevision() { return activatedRevision },
    }
    globalThis.__MOKUP_PLAYGROUND__ = { reloadRoutes() {} }
    </script>`
  const registerScript = `export function registerMokupServiceWorker() {
    return navigator.serviceWorker.register('/sw.js', { type: 'module', updateViaCache: 'none' })
  }`
  const lifecycle = buildSwRegistrationScript('/register.mjs', '/sw.js', '/')
  const html = mode === 'playground'
    ? injectPlaygroundHmr(`${page}<script type="module">
        import { registerMokupServiceWorker } from '/register.mjs'
        registerMokupServiceWorker()
      </script>`, '/')
    : `${page}<script type="module" src="/lifecycle.mjs"></script>`

  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store')
    if (request.url === '/install-gate' && !released) {
      gates.add(response)
      response.once('close', () => gates.delete(response))
      return
    }
    if (request.url === '/sw.js') {
      fetchedRevisions.push(revision)
      response.setHeader('content-type', 'text/javascript')
      response.end(`const revision = ${revision}
        self.addEventListener('install', event => {
          event.waitUntil((async () => {
            if (revision === 2) await fetch('/install-gate')
            await self.skipWaiting()
          })())
        })
        self.addEventListener('activate', event => {
          event.waitUntil((async () => {
            await self.clients.claim()
            for (const client of await self.clients.matchAll()) client.postMessage({ revision })
          })())
        })
        self.addEventListener('fetch', event => {
          if (new URL(event.request.url).pathname === '/value') {
            event.respondWith(Response.json({ revision }))
          }
        })`)
      return
    }
    const modules: Record<string, string> = {
      '/register.mjs': registerScript,
      '/lifecycle.mjs': `import.meta.hot = globalThis.__mokupTest.hot;\n${lifecycle}`,
      '/@vite/client': 'export const createHotContext = () => globalThis.__mokupTest.hot',
    }
    const module = modules[request.url ?? '']
    if (module) {
      response.setHeader('content-type', 'text/javascript')
      response.end(module)
      return
    }
    response.setHeader('content-type', 'text/html')
    response.end(html)
  })
  const { url, close } = await listen(server)
  const release = () => {
    if (released) {
      return
    }
    released = true
    for (const response of gates) {
      response.writeHead(204).end()
    }
  }
  return {
    url,
    fetchedRevisions,
    publish(value: number) { revision = value },
    isInstalling: () => gates.size > 0,
    release,
    async close() {
      release()
      server.closeAllConnections()
      await close()
    },
  }
}
