import 'hono'

declare module 'hono' {
  interface ContextVariableMap {
    db: import('drizzle-orm/d1').DrizzleD1Database<typeof import('../db/schema')>
    auth: ReturnType<typeof import('better-auth').betterAuth>
  }
}
