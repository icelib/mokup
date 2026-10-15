import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

async function smokeLinkedCommonJs(directory, loadModule) {
  const realDirectory = path.join(directory, 'commonjs-real')
  const aliasDirectory = path.join(directory, 'commonjs-alias')
  await fs.mkdir(realDirectory)
  await fs.symlink(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  const entry = path.join(aliasDirectory, 'entry.cjs')
  const child = path.join(realDirectory, 'child.cjs')
  await fs.writeFile(child, 'module.exports = { value: 1 }\n')
  await fs.writeFile(entry, 'module.exports = { value: 1, child: require("./child.cjs") }\n')
  const first = await loadModule(entry)
  await fs.writeFile(child, 'module.exports = { value: 2 }\n')
  await fs.writeFile(entry, 'module.exports = { value: 2, child: require("./child.cjs") }\n')
  const second = await loadModule(entry)
  assert.equal(first.value, 1)
  assert.equal(second.value, 2)
  assert.notEqual(first, second)
  assert.equal(second.child, first.child)
  assert.equal(second.child.value, 1)
}

async function smokeServerRefresh(directory, extension, createFetchServer) {
  const mockDir = path.join(directory, extension)
  await fs.mkdir(mockDir)
  const entry = path.join(mockDir, `value.get.${extension}`)
  const config = path.join(mockDir, `index.config.${extension}`)
  const exportPrefix = extension === 'cjs' ? 'module.exports = ' : 'export default '
  let app
  const originalNow = Date.now
  try {
    // Repeat and regress the clock to catch stale native import URLs in the built package.
    for (const [index, clock] of [1000, 1000, 1001, 1000].entries()) {
      const value = index + 1
      const valueDeclaration = `const value${extension === 'ts' ? ': number' : ''} = ${value}\n`
      await fs.writeFile(entry, `${valueDeclaration}${exportPrefix}{ handler: { value } }\n`)
      await fs.writeFile(config, `${exportPrefix}{ headers: { 'x-config-version': '${value}' } }\n`)
      Date.now = () => clock
      if (app) {
        await app.refresh()
      }
      else {
        app = await createFetchServer({ entries: { dir: mockDir, watch: false, log: false }, playground: false })
      }
      const response = await app.fetch(new Request('http://localhost/value'))
      assert.equal(response.status, 200, `${extension} route status after refresh ${value}`)
      assert.equal(response.headers.get('x-config-version'), String(value), `${extension} configuration freshness`)
      assert.deepEqual(await response.json(), { value }, `${extension} route freshness`)
      assert.equal(app.getRoutes().filter(route => route.template === '/value').length, 1)
    }
  }
  finally {
    Date.now = originalNow
    await app?.close?.()
  }
}

export async function smokeModuleRefresh(directory) {
  const { loadModule } = await import('@mokup/shared/module-loader')
  const { createFetchServer } = await import('mokup/server/node')
  const fixtures = await fs.mkdtemp(path.join(directory, 'module-refresh-'))
  try {
    await fs.writeFile(path.join(fixtures, 'package.json'), '{"type":"module"}\n')
    await smokeLinkedCommonJs(fixtures, loadModule)
    for (const extension of ['mjs', 'js', 'ts', 'cjs']) {
      await smokeServerRefresh(fixtures, extension, createFetchServer)
    }
  }
  finally {
    await fs.rm(fixtures, { recursive: true, force: true })
  }
}
