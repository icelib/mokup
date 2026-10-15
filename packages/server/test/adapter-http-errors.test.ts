import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

it('keeps HTTP adapters alive after malformed input without unhandled rejections', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/adapter-errors.mjs', import.meta.url))
  const result = await execFileAsync(process.execPath, [
    '--unhandled-rejections=strict',
    '--import',
    'tsx',
    fixture,
  ], { timeout: 15000 })

  expect(result.stdout).toContain('HTTP adapters survived malformed requests')
}, 20000)
