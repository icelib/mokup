import type { PreviewServer, ViteDevServer } from 'vite'
import { normalizeBase } from './config'

function injectPlaygroundHmr(html: string, base: string) {
  if (html.includes('mokup-playground-hmr')) {
    return html
  }
  const normalizedBase = normalizeBase(base)
  const clientPath = `${normalizedBase}/@vite/client`
  const snippet = [
    '<script type="module" id="mokup-playground-hmr">',
    `import(${JSON.stringify(clientPath)}).then(({ createHotContext }) => {`,
    '  const hot = createHotContext(\'/@mokup/playground\')',
    '  let active = true',
    '  let pending = false',
    '  let running = false',
    '  let readyCheckScheduled = false',
    '  const installations = new Map()',
    '  const watchInstallation = (registration) => {',
    '    let installation = installations.get(registration)',
    '    if (!installation) {',
    '      const workers = new Set()',
    '      const resume = () => {',
    '        watchInstallation(registration)',
    '        if (registration.installing && registration.installing.state !== \'redundant\') return',
    '        installation.stop()',
    '        updateMokupServiceWorker()',
    '      }',
    '      const stop = () => {',
    '        registration.removeEventListener(\'updatefound\', resume)',
    '        for (const worker of workers) worker.removeEventListener(\'statechange\', resume)',
    '        installations.delete(registration)',
    '      }',
    '      installation = { workers, resume, stop }',
    '      installations.set(registration, installation)',
    '      registration.addEventListener(\'updatefound\', resume)',
    '    }',
    '    for (const worker of [registration.installing, registration.waiting, registration.active]) {',
    '      if (worker && !installation.workers.has(worker)) {',
    '        installation.workers.add(worker)',
    '        worker.addEventListener(\'statechange\', installation.resume)',
    '      }',
    '    }',
    '  }',
    '  const updateMokupServiceWorker = async () => {',
    '    if (typeof navigator === \"undefined\" || !(\'serviceWorker\' in navigator)) {',
    '      return',
    '    }',
    '    pending = true',
    '    if (running || !active) return',
    '    running = true',
    '    try {',
    '      while (active && pending) {',
    '        pending = false',
    '        try {',
    '          const registrations = await navigator.serviceWorker.getRegistrations()',
    '          if (!active) return',
    '          for (const [registration, installation] of installations) {',
    '            if (!registrations.includes(registration)) installation.stop()',
    '          }',
    '          if (registrations.length) {',
    '            const results = await Promise.allSettled(registrations.map(async (registration) => {',
    // An update promise can resolve before installation ends; its browser job still merges new updates.
    '              const installing = registration.installing && registration.installing.state !== \'redundant\'',
    '              if (installing || ![registration.waiting, registration.active].some((worker) => worker && worker.state !== \'redundant\')) {',
    '                watchInstallation(registration)',
    '                return',
    '              }',
    '              installations.get(registration)?.stop()',
    '              await registration.update()',
    '            }))',
    '            for (const result of results) {',
    '              if (result.status === \'rejected\') console.warn(\'Failed to update mokup service worker:\', result.reason)',
    '            }',
    '          } else if (!readyCheckScheduled) {',
    '            readyCheckScheduled = true',
    '            navigator.serviceWorker.ready.then(updateMokupServiceWorker).catch(() => {})',
    '          }',
    '        } catch (error) {',
    '          console.warn(\'Failed to update mokup service worker:\', error)',
    '        }',
    '      }',
    '    } finally {',
    '      running = false',
    '    }',
    '  }',
    '  const reloadRoutes = () => {',
    '    updateMokupServiceWorker()',
    '    const api = window.__MOKUP_PLAYGROUND__',
    '    if (api && typeof api.reloadRoutes === \'function\') {',
    '      api.reloadRoutes()',
    '      if (typeof api.notifyHotReload === \'function\') {',
    '        api.notifyHotReload()',
    '      }',
    '      return',
    '    }',
    '    window.location.reload()',
    '  }',
    '  hot.on(\'mokup:routes-changed\', reloadRoutes)',
    '  hot.on(\'vite:ws:connect\', updateMokupServiceWorker)',
    '  hot.dispose(() => {',
    '    active = false',
    '    for (const installation of installations.values()) installation.stop()',
    '    hot.off(\'mokup:routes-changed\', reloadRoutes)',
    '    hot.off(\'vite:ws:connect\', updateMokupServiceWorker)',
    '  })',
    // A route event can arrive before the HMR client or SW registration is ready.
    '  updateMokupServiceWorker()',
    '}).catch(() => {})',
    '</script>',
  ].join('\n')
  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}\n</body>`)
  }
  return `${html}\n${snippet}`
}

function injectPlaygroundSw(html: string, script: string | null | undefined) {
  if (!script) {
    return html
  }
  if (html.includes('mokup-playground-sw')) {
    return html
  }
  const snippet = [
    '<script type="module" id="mokup-playground-sw">',
    script,
    '</script>',
  ].join('\n')
  if (html.includes('</head>')) {
    return html.replace('</head>', `${snippet}\n</head>`)
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}\n</body>`)
  }
  return `${html}\n${snippet}`
}

function isViteDevServer(
  server: ViteDevServer | PreviewServer | undefined | null,
): server is ViteDevServer {
  return !!server && 'ws' in server
}

export { injectPlaygroundHmr, injectPlaygroundSw, isViteDevServer }
