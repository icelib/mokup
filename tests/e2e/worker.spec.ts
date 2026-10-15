import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { createMokupWorker } from '../../packages/server/src/node'
import { runMokup } from './utils/command'
import { ensureEmptyDir } from './utils/fs'
import { repoRoot } from './utils/paths'

const mockDir = 'apps/mokup-web-demo/mock'

test('worker bundle serves json and handler responses', async ({ request: _request }, testInfo) => {
  const outDir = testInfo.outputPath('worker-build')
  await ensureEmptyDir(outDir)

  await runMokup(
    ['build', '--dir', mockDir, '--out', outDir],
    { cwd: repoRoot },
  )

  const worker = await createMokupWorker(outDir)

  const profileResponse = await worker.fetch(
    new Request('http://localhost/profile'),
  )
  const profileJson = await profileResponse.json() as Record<string, unknown>
  expect(profileJson['name']).toBe('Orion Vale')

  const loginResponse = await worker.fetch(
    new Request('http://localhost/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'mokup',
        password: '123456',
      }),
    }),
  )
  const loginJson = await loginResponse.json() as Record<string, unknown>
  expect(loginJson['token']).toMatch(/^[a-z0-9]{18}$/)
})

test('built worker helpers preserve binary and multipart uploads from CLI bundles', async ({ request: _request }, testInfo) => {
  const root = testInfo.outputPath('binary-upload')
  const mockDir = join(root, 'mock')
  const outDir = join(root, 'build')
  await mkdir(mockDir, { recursive: true })
  try {
    await writeFile(join(mockDir, 'echo.post.mjs'), `
      export default {
        handler: async c => new Response(await c.req.arrayBuffer(), {
          headers: { 'content-type': 'application/octet-stream' },
        }),
      }
    `)
    await writeFile(join(mockDir, 'upload.post.mjs'), `
      export default {
        handler: async c => {
          const form = await c.req.formData()
          const file = form.get('file')
          if (!(file instanceof File)) return new Response('Missing file', { status: 400 })
          return new Response(await file.arrayBuffer(), {
            headers: {
              'content-type': 'application/octet-stream',
              'x-upload-name': file.name,
              'x-upload-note': String(form.get('note')),
            },
          })
        },
      }
    `)
    await runMokup(['build', '--dir', mockDir, '--out', outDir], { cwd: repoRoot })
    const { default: bundle } = await import(pathToFileURL(join(outDir, 'mokup.bundle.mjs')).href)
    const { createMokupWorker: createBuiltWorker } = await import(pathToFileURL(join(repoRoot, 'packages/server/dist/worker.mjs')).href) as typeof import('../../packages/server/src/worker')
    const { createMokupWorker: createBuiltNodeWorker } = await import(pathToFileURL(join(repoRoot, 'packages/server/dist/worker-node.mjs')).href) as typeof import('../../packages/server/src/worker-node')
    const workers = [createBuiltWorker(bundle), await createBuiltNodeWorker(outDir)]
    const bytes = new Uint8Array([0, 255, 128, 65, 13, 10])

    for (const worker of workers) {
      const binary = await worker.fetch(new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
      }))
      expect(binary.status).toBe(200)
      expect(new Uint8Array(await binary.arrayBuffer())).toEqual(bytes)

      const form = new FormData()
      form.append('file', new File([bytes], 'bytes.bin', { type: 'application/octet-stream' }))
      form.append('note', 'multipart-file')
      const upload = await worker.fetch(new Request('http://localhost/upload', { method: 'POST', body: form }))
      expect(upload.status).toBe(200)
      expect(upload.headers.get('x-upload-name')).toBe('bytes.bin')
      expect(upload.headers.get('x-upload-note')).toBe('multipart-file')
      expect(new Uint8Array(await upload.arrayBuffer())).toEqual(bytes)
    }
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
