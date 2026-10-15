import type { Context, MiddlewareHandler } from 'mokup'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'
import { defineConfig } from 'mokup'
import { schema } from '../db/schema'

interface Bindings {
  DB: D1Database
  AUTH_SECRET?: string
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
}

const middleware: MiddlewareHandler = async (
  c: Context,
  next: () => Promise<void>,
) => {
  const env = c.env as Bindings
  if (!env.DB) {
    return c.json({ error: 'Missing D1 binding: DB' }, 500)
  }

  const db = drizzle(env.DB, { schema })
  c.set('db', db)

  if (c.req.path.startsWith('/api/auth')) {
    const secret = env.BETTER_AUTH_SECRET ?? env.AUTH_SECRET
    if (!secret) {
      return c.json({ error: 'Missing BETTER_AUTH_SECRET (or AUTH_SECRET).' }, 500)
    }
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return c.json(
        {
          error: 'Missing GitHub OAuth vars: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET.',
        },
        500,
      )
    }

    const auth = betterAuth({
      baseURL: env.BETTER_AUTH_URL ?? new URL(c.req.url).origin,
      basePath: '/api/auth',
      secret,
      emailAndPassword: {
        enabled: true,
      },
      socialProviders: {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
        },
      },
      database: drizzleAdapter(db, {
        provider: 'sqlite',
        schema,
      }),
    })

    c.set('auth', auth)
  }

  return await next()
}

export default defineConfig({
  middleware,
})
