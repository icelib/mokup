import { describe, expect, it } from 'vitest'
import {
  formatPlaygroundUrl,
  normalizeBase,
  resolveRegisterPath,
  resolveRegisterScope,
  resolveSwImportPath,
  resolveSwLoggerImportPath,
  resolveSwOutputFileName,
  resolveSwRuntimeImportPath,
} from '../src/vite/plugin/paths'

describe('vite plugin paths', () => {
  it('normalizes base paths', () => {
    expect(normalizeBase('')).toBe('/')
    expect(normalizeBase('.')).toBe('/')
    expect(normalizeBase('api')).toBe('/api/')
    expect(normalizeBase('/api')).toBe('/api/')
  })

  it('resolves register paths and scopes', () => {
    expect(resolveRegisterPath('/base/', '/sw.js')).toBe('/base/sw.js')
    expect(resolveRegisterPath('/base/', 'sw.js')).toBe('/base/sw.js')
    expect(resolveRegisterScope('/base/', '/scope/')).toBe('/base/scope/')
  })

  it.each([
    { base: '/', path: '/mokup-sw.js', requestPath: '/mokup-sw.js', fileName: 'mokup-sw.js' },
    { base: '/base/', path: '/base/mokup-sw.js', requestPath: '/base/mokup-sw.js', fileName: 'mokup-sw.js' },
    { base: '/base/', path: '/baseball/mokup-sw.js', requestPath: '/base/baseball/mokup-sw.js', fileName: 'baseball/mokup-sw.js' },
    { base: '/team/app/', path: '/team/app/nested/mokup-sw.js', requestPath: '/team/app/nested/mokup-sw.js', fileName: 'nested/mokup-sw.js' },
    { base: './', path: '/nested/mokup-sw.js', requestPath: '/nested/mokup-sw.js', fileName: 'nested/mokup-sw.js' },
    { base: '', path: 'nested/mokup-sw.js', requestPath: '/nested/mokup-sw.js', fileName: 'nested/mokup-sw.js' },
  ])('maps SW path $path under base "$base" to its request URL and output file', ({ base, path, requestPath, fileName }) => {
    expect(resolveRegisterPath(base, path)).toBe(requestPath)
    expect(resolveSwOutputFileName(base, path)).toBe(fileName)
  })

  it('formats playground URLs', () => {
    expect(formatPlaygroundUrl('http://localhost:5173/', '/__mokup')).toBe('http://localhost:5173/__mokup')
    expect(formatPlaygroundUrl(undefined, '/__mokup')).toBe('/__mokup')
  })

  it('resolves sw import paths', () => {
    expect(resolveSwImportPath('/base/')).toBe('/base/@id/mokup/sw')
    expect(resolveSwRuntimeImportPath('/base/')).toBe('/base/@id/mokup/runtime')
    expect(resolveSwLoggerImportPath('/base/')).toBe('/base/@id/@mokup/shared/logger')
  })
})
