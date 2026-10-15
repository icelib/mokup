import { describe, expect, it } from 'vitest'
import { normalizeHeaders, normalizeNodeHeaders, normalizeQuery } from '../src/internal/normalize'
import { toRuntimeRequestFromFetch, toRuntimeRequestFromNode } from '../src/internal/request'

describe('request dictionaries', () => {
  it('preserves query keys that also name Object prototype members', () => {
    const pairs = [
      ['__proto__', 'first'],
      ['__proto__', 'second'],
      ['constructor', 'custom'],
      ['toString', 'one'],
      ['toString', 'two'],
      ['hasOwnProperty', 'own'],
    ] as const
    const result = normalizeQuery(new URLSearchParams(pairs.map(([key, value]) => [key, value])))

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.keys(result)).toEqual(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    expect(result).toEqual(Object.fromEntries([
      ['__proto__', ['first', 'second']],
      ['constructor', 'custom'],
      ['toString', ['one', 'two']],
      ['hasOwnProperty', 'own'],
    ]))
  })

  it.each([normalizeHeaders, (headers: Headers) => normalizeNodeHeaders(Object.fromEntries(headers))])('preserves special header names without changing the result prototype', (normalize) => {
    const result = normalize(new Headers([
      ['__proto__', 'prototype-value'],
      ['constructor', 'constructor-value'],
      ['x-normal', 'normal-value'],
    ]))

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe('prototype-value')
    expect(result.constructor).toBe('constructor-value')
    expect(result['x-normal']).toBe('normal-value')
  })

  it('keeps Node header arrays, omitted values, and case normalization', () => {
    const headers: Record<string, string | string[] | undefined> = Object.fromEntries([
      ['__proto__', ['one', 'two']],
      ['X-Custom', 'value'],
      ['omit', undefined],
    ])
    expect(normalizeNodeHeaders(headers)).toEqual(Object.fromEntries([
      ['__proto__', 'one,two'],
      ['x-custom', 'value'],
    ]))
    expect(normalizeNodeHeaders()).toEqual({})
  })

  it('passes special query keys through both Fetch and Node request conversion', async () => {
    const url = '/route?__proto__=first&__proto__=second&constructor=value&toString=text'
    const fetchRequest = await toRuntimeRequestFromFetch(new Request(`http://localhost${url}`))
    const nodeRequest = await toRuntimeRequestFromNode({ url, body: '', on: () => {} })
    const expected = Object.fromEntries([
      ['__proto__', ['first', 'second']],
      ['constructor', 'value'],
      ['toString', 'text'],
    ])

    expect(fetchRequest.query).toEqual(expected)
    expect(nodeRequest.query).toEqual(expected)
    expect(Object.getPrototypeOf(fetchRequest.query)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(nodeRequest.query)).toBe(Object.prototype)
  })
})
