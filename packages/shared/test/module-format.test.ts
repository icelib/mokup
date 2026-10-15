import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTypeScriptModule } from '../src/module-format'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mokup-package-scope-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('TypeScript package scope', () => {
  it.each([['module', true], ['commonjs', false], ['other', false], [undefined, false]])(
    'uses the nearest package type %s',
    async (type, expected) => {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ type }))
      await mkdir(join(directory, 'nested'))
      expect(isTypeScriptModule(join(directory, 'nested/value.ts'))).toBe(expected)
    },
  )

  it('stops at a nearer manifest without a type', async () => {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await mkdir(join(directory, 'nested'))
    await writeFile(join(directory, 'nested/package.json'), '{}')
    expect(isTypeScriptModule(join(directory, 'nested/value.ts'))).toBe(false)
  })

  it('does not inherit a package scope across node_modules', async () => {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await mkdir(join(directory, 'node_modules/dependency'), { recursive: true })
    await writeFile(join(directory, 'node_modules/package.json'), '{"type":"module"}')
    expect(isTypeScriptModule(join(directory, 'node_modules/dependency/value.ts'))).toBe(false)
  })

  it('reports an invalid manifest and reads it again after repair', async () => {
    const manifest = join(directory, 'package.json')
    const file = join(directory, 'value.ts')
    await writeFile(manifest, '{')
    expect(() => isTypeScriptModule(file)).toThrow(manifest)
    await writeFile(manifest, '{"type":"module"}')
    expect(isTypeScriptModule(file)).toBe(true)
  })

  it('does not silently inherit the parent type when the manifest cannot be read', async () => {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await mkdir(join(directory, 'nested/package.json'), { recursive: true })
    expect(() => isTypeScriptModule(join(directory, 'nested/value.ts'))).toThrow()
  })
})
