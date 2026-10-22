import type { MockSession } from '@mokup/runtime/http'
import { createMockSession } from '@mokup/runtime/http'

/** File refreshes share state within a server; each server generation owns its lifetime. */
export function createRouteSessions() {
  const servers = new WeakMap<object, MockSession>()
  const closed = new WeakSet<object>()
  let build: MockSession | undefined
  return {
    get(owner?: object): MockSession {
      if (!owner) {
        build ??= createMockSession()
        return build
      }
      if (closed.has(owner)) {
        throw new Error('Cannot access the mock session of a closed server.')
      }
      let session = servers.get(owner)
      if (!session) {
        session = createMockSession()
        servers.set(owner, session)
      }
      return session
    },
    async close(owner?: object) {
      const session = owner ? servers.get(owner) : build
      if (owner) {
        servers.delete(owner)
        closed.add(owner)
      }
      else {
        build = undefined
      }
      await session?.dispose()
    },
  }
}
