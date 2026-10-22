import { createPackageConfig } from '../../scripts/tsdown-config.ts'

export default createPackageConfig({
  entries: [
    'src/index',
    'src/node',
    'src/connect',
    'src/express',
    'src/koa',
    'src/fastify',
    'src/fetch',
    'src/worker',
    'src/worker-node',
    'src/fetch-server',
    'src/hono',
    'src/next',
    'src/nuxt',
    'src/astro',
  ],
})
