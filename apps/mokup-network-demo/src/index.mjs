import assert from 'node:assert/strict'
import process from 'node:process'
import { graphql } from 'mokup/graphql'
import { http, HttpResponse } from 'mokup/http'
import { setupServer } from 'mokup/node'
import { createReplay, recordInteraction } from 'mokup/recording'
import { createMemoryStore, createScenario } from 'mokup/scenario'

async function main() {
  const state = createScenario(42, { mode: 'happy' })
  const users = createMemoryStore([{ id: '1', name: 'Ada' }], 'id')
  const server = setupServer(
    http.get('https://api.example.test/users', () => state.getState().mode === 'error'
      ? HttpResponse.json({ error: 'Unavailable' }, { status: 503 })
      : HttpResponse.json(users.list())),
    graphql.query('Users', () => HttpResponse.json({ data: { users: users.list() } })),
  )

  server.listen({ onUnhandled: 'error' })
  try {
    const request = new Request('https://api.example.test/users', { headers: { Authorization: 'Bearer development-only' } })
    const response = await fetch(request)
    const fixture = await recordInteraction(request, response)
    assert.deepEqual(await response.json(), [{ id: '1', name: 'Ada' }])
    const replay = createReplay([fixture])
    assert.deepEqual(await (await replay.handle(request)).json(), [{ id: '1', name: 'Ada' }])
    state.setState({ mode: 'error' })
    assert.equal((await fetch(request)).status, 503)
    const graph = await fetch('https://api.example.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query Users { users { id name } }' }),
    })
    assert.deepEqual(await graph.json(), { data: { users: [{ id: '1', name: 'Ada' }] } })
    process.stdout.write('HTTP, GraphQL, scenario switching and redacted record/replay passed.\n')
  }
  finally {
    await server.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error}\n`)
  process.exitCode = 1
})
