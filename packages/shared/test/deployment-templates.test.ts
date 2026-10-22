import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

it('checks deployment templates relative to its script in paths requiring URL decoding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mokup deployment 中文 #-'))
  try {
    const scripts = join(directory, 'scripts')
    await mkdir(scripts)
    const script = join(scripts, 'check-deployment-templates.mjs')
    await cp(new URL('../../../scripts/check-deployment-templates.mjs', import.meta.url), script)
    await cp(new URL('../../../examples/deploy', import.meta.url), join(directory, 'examples', 'deploy'), { recursive: true })

    const run = () => execFileAsync(process.execPath, [script], { cwd: tmpdir(), timeout: 10000 })
    const result = await run()
    expect(result.stdout.trim()).toBe('Checked 6 Mokup deployment templates.')

    const template = join(directory, 'examples', 'deploy', 'node', 'server.mjs')
    const content = await readFile(template, 'utf8')
    await writeFile(template, content.replaceAll('/api/health', '/api/missing'))
    await expect(run()).rejects.toMatchObject({
      stderr: expect.stringContaining('Deployment template is missing the smoke route: examples/deploy/node/server.mjs'),
    })
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
