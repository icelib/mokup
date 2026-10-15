import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export async function smokeExternalHandlers(directory, cli, run) {
  const fixture = await fs.mkdtemp(path.join(directory, 'external-handlers-'))
  const app = path.join(fixture, 'app')
  const output = path.join(app, '.mokup')
  try {
    for (const [source, scope] of [['app', 'local'], ['shared-a/a', 'a'], ['shared-b/b', 'b']]) {
      const target = path.join(fixture, source)
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, 'ping.get.ts'), `export default (c) => c.json({ source: ${JSON.stringify(scope)} })\n`)
      const configDir = scope === 'local' ? app : path.dirname(target)
      await fs.writeFile(path.join(configDir, 'index.config.ts'), [
        'export default { middleware: [async (c, next) => {',
        '  await next()',
        `  c.header('x-middleware', ${JSON.stringify(scope)})`,
        '}] }',
        '',
      ].join('\n'))
    }
    await run(process.execPath, [cli, 'build', '--dir', '.', '--dir', '../shared-a', '--dir', '../shared-b'], app)
    const { default: bundle } = await import(pathToFileURL(path.join(output, 'mokup.bundle.mjs')).href)
    assert.equal(bundle.manifest.routes.length, 3)
    const modules = new Set(bundle.manifest.routes.flatMap(route => [
      route.response.module,
      ...route.middleware.map(entry => entry.module),
    ]))
    assert.equal(modules.size, 6, 'Handler and middleware sources must keep distinct outputs')
    for (const module of modules) {
      const target = path.resolve(output, module)
      const relative = path.relative(path.join(output, 'mokup-handlers'), target)
      assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      await fs.access(target)
    }
    const { createFetchHandler } = await import('mokup/server/fetch')
    const handler = createFetchHandler({ ...bundle, onNotFound: 'response' })
    for (const [pathname, source] of [['/ping', 'local'], ['/a/ping', 'a'], ['/b/ping', 'b']]) {
      const response = await handler(new Request(`http://localhost${pathname}`))
      assert.equal(response.status, 200, pathname)
      assert.deepEqual(await response.json(), { source }, pathname)
      assert.equal(response.headers.get('x-middleware'), source, pathname)
    }
  }
  finally {
    await fs.rm(fixture, { recursive: true, force: true })
  }
}
