import type { OpenApiOperation } from '../src/contract'
import { describe, expect, it } from 'vitest'
import { createContractCrudHandlers } from '../src/contract'
import { createMockSession } from '../src/http'
import { createMemoryStore } from '../src/scenario'

const recordSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  additionalProperties: false,
} as const
const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
  additionalProperties: false,
} as const
const operations: OpenApiOperation[] = [
  {
    method: 'GET',
    path: '/users',
    requestRequired: false,
    responses: { 200: { 'application/json': { type: 'array', items: recordSchema } } },
  },
  {
    method: 'POST',
    path: '/users',
    requestRequired: true,
    requestBody: recordSchema,
    responses: { 201: { 'application/json': recordSchema } },
  },
  {
    method: 'GET',
    path: '/users/:id',
    requestRequired: false,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { 'application/json': recordSchema }, 404: { 'application/json': errorSchema } },
  },
  {
    method: 'PATCH',
    path: '/users/:id',
    requestRequired: true,
    requestBody: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false },
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { 'application/json': recordSchema }, 404: { 'application/json': errorSchema } },
  },
  {
    method: 'DELETE',
    path: '/users/:id',
    requestRequired: false,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 204: {}, 404: { 'application/json': errorSchema } },
  },
]

describe('contract-generated CRUD handlers', () => {
  it('uses the shared contract validation and a clone-isolated memory store', async () => {
    const store = createMemoryStore([{ id: '1', name: 'Ada' }], 'id')
    const session = createMockSession(...createContractCrudHandlers(operations, store, { idFactory: () => '2' }))
    try {
      expect(await (await session.handle(new Request('https://example.test/users')))?.json()).toEqual([{ id: '1', name: 'Ada' }])
      const created = await session.handle(new Request('https://example.test/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Grace', id: '2' }),
      }))
      expect(created?.status).toBe(201)
      expect(await created?.json()).toEqual({ id: '2', name: 'Grace' })
      const updated = await session.handle(new Request('https://example.test/users/2', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Grace Hopper' }),
      }))
      expect(await updated?.json()).toEqual({ id: '2', name: 'Grace Hopper' })
      expect(await (await session.handle(new Request('https://example.test/users/2')))?.json()).toEqual({ id: '2', name: 'Grace Hopper' })
      const deleted = await session.handle(new Request('https://example.test/users/2', { method: 'DELETE' }))
      expect(deleted?.status).toBe(204)
      expect(await deleted?.text()).toBe('')
      const missing = await session.handle(new Request('https://example.test/users/2'))
      expect(missing?.status).toBe(404)
      expect(await missing?.json()).toEqual({ error: 'not_found' })
    }
    finally {
      await session.dispose()
    }
    expect(store.list()).toEqual([{ id: '1', name: 'Ada' }])
  })

  it('accepts a persistent backend through the structural storage interface', async () => {
    const records = new Map<string, { id: string, name: string }>([['1', { id: '1', name: 'Ada' }]])
    const store = {
      list: () => [...records.values()].map(record => ({ ...record })),
      get: (id: string | number) => records.get(String(id)),
      create: (record: { id: string, name: string }) => {
        records.set(record.id, { ...record })
        return { ...record }
      },
      update: (id: string | number, changes: Partial<{ id: string, name: string }>) => {
        const current = records.get(String(id))
        if (!current) {
          return undefined
        }
        const next = { ...current, ...changes }
        records.set(String(id), next)
        return { ...next }
      },
      delete: (id: string | number) => records.delete(String(id)),
    }
    const [list] = createContractCrudHandlers(operations.slice(0, 1), store)
    const session = createMockSession(list)
    try {
      expect(await (await session.handle(new Request('https://example.test/users')))?.json()).toEqual([{ id: '1', name: 'Ada' }])
    }
    finally {
      await session.dispose()
    }
  })

  it('accepts the bundled source form with options as the second argument', () => {
    const store = createMemoryStore([{ id: '1', name: 'Ada' }], 'id')
    expect(createContractCrudHandlers({ operations: operations.slice(0, 1), store }, { strict: true })).toHaveLength(1)
  })
})
