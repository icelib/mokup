import type {
  DiagnosticCategory,
  DiagnosticErrorMode,
  MokupPluginOptions,
  RequestHandler,
  RouteDirectoryConfig,
  RouteRule,
  VitePluginOptionsInput,
} from 'mokup'
import type { MockSession } from 'mokup/http'
import type { VitePluginOptions } from 'mokup/vite'
import type {
  WebpackConfig,
  WebpackPluginOptionsInput,
} from 'mokup/webpack'
import { defineConfig, defineHandler } from 'mokup'
import { http, HttpResponse } from 'mokup/http'
import mokup from 'mokup/vite'
import { createMokupWebpackPlugin, mokupWebpack } from 'mokup/webpack'
import { expectAssignable, expectType } from 'tsd'

const options: MokupPluginOptions = {
  entries: { dir: 'mock' },
  playground: true,
  errorOn: ['invalid-route'],
}
const viteOptionsInput: VitePluginOptionsInput = options
const viteEntry: VitePluginOptions = { dir: 'mock', mode: 'server' }
const diagnosticCategory: DiagnosticCategory = 'sw-conflict'
const diagnosticErrorMode: DiagnosticErrorMode = [diagnosticCategory]

expectType<MokupPluginOptions>(options)
expectType<VitePluginOptionsInput>(viteOptionsInput)
expectType<VitePluginOptions>(viteEntry)
expectAssignable<DiagnosticCategory>(diagnosticCategory)
expectAssignable<DiagnosticErrorMode>(diagnosticErrorMode)

const handler = defineHandler(c => ({ ok: true, method: c.req.method }))
expectAssignable<RequestHandler>(handler)

const rule = defineHandler({ handler: { ok: true }, status: 201 })
expectAssignable<RouteRule>(rule)

const configResult = defineConfig({ headers: { 'x-mokup': 'yes' } })
expectAssignable<RouteDirectoryConfig | Promise<RouteDirectoryConfig>>(configResult)

const plugin = mokup(options)
expectType<ReturnType<typeof mokup>>(plugin)
expectType<MockSession>(plugin.api.getMockSession())
expectType<AbortSignal>(plugin.api.getMockSession().signal)
expectAssignable<MokupPluginOptions>({ handlers: [http.get('/native', () => HttpResponse.text('native'))], onUnhandled: 'error' })

const webpackOptions: WebpackPluginOptionsInput = { entries: { dir: 'mock' } }
const webpackPlugin = createMokupWebpackPlugin(webpackOptions)
expectType<ReturnType<typeof createMokupWebpackPlugin>>(webpackPlugin)
declare const compiler: Parameters<typeof webpackPlugin.api.getMockSession>[0]
expectType<MockSession>(webpackPlugin.api.getMockSession(compiler))

const withMokup = mokupWebpack(webpackOptions)
const webpackConfig: WebpackConfig = withMokup({} as WebpackConfig)
expectType<WebpackConfig>(webpackConfig)
