import type { McpGenerateStructuredContent, McpHttpHandler, McpValidationStructuredContent, MokupMcpServer } from 'mokup'
import { createDevframeBridge } from 'mokup/devframe'
import { createMcpHttpHandler, createMokupMcpServer } from 'mokup/mcp'
import { expectAssignable, expectType } from 'tsd'

expectType<typeof createDevframeBridge>(createDevframeBridge)
expectType<MokupMcpServer>(createMokupMcpServer())
expectType<McpHttpHandler>(createMcpHttpHandler(createMokupMcpServer()))
expectAssignable<McpGenerateStructuredContent>({
  schemaVersion: 1,
  source: '',
  fixtures: [],
  operations: [],
  review: { generatedBy: 'mokup', operationCount: 0, fixtureCount: 0, requiresHumanReview: true },
})
expectAssignable<McpValidationStructuredContent>({ schemaVersion: 1, valid: true, fixtures: [] })
