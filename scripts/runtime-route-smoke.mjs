import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export async function smokeRouteGrammar(directory, cli, run) {
  const mockDir = path.join(directory, 'grammar-mock')
  const outputDir = path.join(directory, 'grammar-output')
  const handler = 'export default { handler: c => c.json(c.req.param()) }\n'
  const files = {
    'health.get.json': '"healthy"',
    'numeric/[123].get.ts': handler,
    'users/[user-id].get.ts': handler,
    'repeat/[id]/[id].get.ts': handler,
    'literal/a{2}.get.json': '"literal"',
    'literal/[id].get.json': '"dynamic"',
  }
  for (const [filename, content] of Object.entries(files)) {
    const target = path.join(mockDir, filename)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  const checked = JSON.parse(await run(process.execPath, [cli, 'check', '--dir', mockDir, '--json'], directory))
  assert.equal(checked.valid, true)
  assert.equal(checked.routeCount, 6)
  await run(process.execPath, [cli, 'build', '--dir', mockDir, '--out', outputDir], directory)
  const { default: bundle } = await import(pathToFileURL(path.join(outputDir, 'mokup.bundle.mjs')).href)
  const { createFetchHandler } = await import('mokup/server/fetch')
  const fetchHandler = createFetchHandler({ ...bundle, onNotFound: 'response' })
  const { createFetchServer } = await import('mokup/server/node')
  const server = await createFetchServer({ entries: { dir: mockDir, watch: false, log: false }, playground: false })
  try {
    for (const fetch of [fetchHandler, server.fetch]) {
      for (const [pathname, expected] of [
        ['/health', 'healthy'],
        ['/numeric/7', { 123: '7' }],
        ['/users/a%252Fb', { 'user-id': 'a%2Fb' }],
        ['/repeat/first/last', { id: 'last' }],
        ['/literal/a{2}', 'literal'],
        ['/literal/aa', 'dynamic'],
      ]) {
        const response = await fetch(new Request(`http://localhost${pathname}`))
        assert.equal(response.status, 200, pathname)
        assert.deepEqual(await (typeof expected === 'string' ? response.text() : response.json()), expected, pathname)
      }
    }
  }
  finally {
    await server.close?.()
  }
}
