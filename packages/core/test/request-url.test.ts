import { describe, expect, it } from 'vitest'
import { parseRequestUrl } from '../src/shared/request-url'

describe('HTTP request URL parsing', () => {
  it.each([
    ['/ok?query=1', 'http://mokup.local/ok?query=1'],
    ['//[host/ok', 'http://mokup.local//[host/ok'],
    ['/ftp://path', 'http://mokup.local/ftp://path'],
    ['ordinary/path', 'http://mokup.local/ordinary/path'],
    ['*', 'http://mokup.local/*'],
    ['http://example.test/ok', 'http://example.test/ok'],
    ['hTtP://example.test/ok', 'http://example.test/ok'],
    ['https://example.test/ok', 'https://example.test/ok'],
    ['HTTPS://example.test/ok', 'https://example.test/ok'],
  ])('preserves supported target %j', (target, expected) => {
    expect(parseRequestUrl(target)?.href).toBe(expected)
  })

  it.each([
    'ftp://example.test/ok',
    'ws://example.test/ok',
    'wss://example.test/ok',
    'file:///ok',
    'javascript:alert(1)',
    'data:text/plain,ok',
    'custom:target',
    'http://[',
  ])('rejects unsupported or malformed target %j', (target) => {
    expect(parseRequestUrl(target)).toBeNull()
  })
})
