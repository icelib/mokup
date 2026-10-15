import process from 'node:process'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import mokup from '../mokup/src/vite'

const mockDir = fileURLToPath(new URL('../../apps/mokup-docs/mock', import.meta.url))
const runtimeEntry = fileURLToPath(new URL('../runtime/src/index.ts', import.meta.url))

function resolveDocsSwRegister(command: string) {
  const env = process.env as NodeJS.ProcessEnv & { MOKUP_DOCS_SW_REGISTER?: string }
  const raw = env.MOKUP_DOCS_SW_REGISTER
  if (!raw) {
    return command === 'build'
  }
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }
  return command === 'build'
}

function routesAliasPlugin() {
  return {
    name: 'playground:routes-alias',
    configureServer(server: import('vite').ViteDevServer) {
      const middleware = (
        req: import('node:http').IncomingMessage,
        _res: import('node:http').ServerResponse,
        next: (err?: unknown) => void,
      ) => {
        const requestUrl = req.url ?? ''
        if (requestUrl === '/routes' || requestUrl.startsWith('/routes?')) {
          req.url = requestUrl.replace('/routes', '/__mokup/routes')
        }
        next()
      }

      const stack = (server.middlewares as { stack?: Array<{ route?: string, handle: typeof middleware }> }).stack
      if (Array.isArray(stack)) {
        stack.unshift({ route: '', handle: middleware })
        return
      }
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  resolve: {
    alias: {
      'mokup/runtime': runtimeEntry,
    },
  },
  plugins: [
    vue(),
    tailwindcss(),
    // Published assets are generic; only the development server uses docs mocks.
    ...(command === 'serve'
      ? [
          routesAliasPlugin(),
          mokup({
            entries: {
              dir: mockDir,
              prefix: '/api',
              mode: 'sw',
              sw: {
                register: resolveDocsSwRegister(command),
              },
            },
          }),
        ]
      : []),
  ],
  server: {
    port: 5174,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/playground.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}))
