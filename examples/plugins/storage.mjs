import { createMemoryStore, createMockSession, createPluginHost, http, HttpResponse } from 'mokup/http'
import { setupServer } from 'mokup/node'

// A plugin owns the storage resource and exposes a normal HTTP handler. The
// same shape can wrap a database client in an application package.
const users = createMemoryStore([{ id: '1', name: 'Ada' }], 'id')

async function main() {
  const session = createMockSession()
  const plugins = createPluginHost(session)
  await plugins.use({
    name: 'users-storage',
    setup({ registerResource, use }) {
      registerResource({ kind: 'storage', name: 'users', value: users })
      use(http.get('/users', () => HttpResponse.json(users.list())))
    },
  })

  const server = setupServer()
  server.use(...session.listHandlers())
  server.listen()

  // Keep plugin disposal and the network session in the same teardown path.
  await server.close()
  await plugins.dispose()
  await session.dispose()
}

void main()
