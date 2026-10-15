import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from '../src/rolldown'

describe('rolldown build wrapper', () => {
  it('preserves explicit output names for entries with the same filename', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-rolldown-named-'))
    try {
      const sources = ['first', 'second']
      const entries: Record<string, string> = {}
      for (const source of sources) {
        const file = path.join(root, source, 'entry.ts')
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, `export default ${JSON.stringify(source)}\n`)
        entries[`named/${source}`] = file
      }
      const output = path.join(root, 'dist')
      await build({
        entryPoints: entries,
        entryNames: '[dir]/[name]',
        format: 'esm',
        outbase: path.join(root, 'unrelated'),
        outdir: output,
        outExtension: { '.js': '.mjs' },
        logLevel: 'silent',
      })
      for (const source of sources) {
        const code = await fs.readFile(path.join(output, 'named', `${source}.mjs`), 'utf8')
        expect(code).toContain(JSON.stringify(source))
      }
    }
    finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  it('bundles file entry points into the requested output directory', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-rolldown-files-'))
    const entryFile = path.join(root, 'mock', 'handler.get.ts')
    const handlersDir = path.join(root, '.mokup', 'mokup-handlers')

    try {
      await fs.mkdir(path.dirname(entryFile), { recursive: true })
      await fs.writeFile(entryFile, 'export default () => ({ ok: true })\n', 'utf8')

      await build({
        absWorkingDir: root,
        bundle: true,
        entryNames: '[name]',
        entryPoints: [entryFile],
        format: 'esm',
        logLevel: 'silent',
        outExtension: { '.js': '.mjs' },
        outbase: root,
        outdir: handlersDir,
        platform: 'neutral',
        target: 'es2020',
      })

      const bundled = await fs.readFile(path.join(handlersDir, 'mock', 'handler.get.mjs'), 'utf8')
      expect(bundled).toContain('ok')
    }
    finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  it('returns in-memory output files for stdin builds', async () => {
    const result = await build({
      absWorkingDir: process.cwd(),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      stdin: {
        contents: 'export const answer = 42',
        loader: 'js',
        resolveDir: process.cwd(),
        sourcefile: 'inline.js',
      },
      target: 'es2020',
      write: false,
    })

    expect(result.outputFiles).toHaveLength(1)
    expect(result.outputFiles[0]?.text).toContain('42')
  })
})
