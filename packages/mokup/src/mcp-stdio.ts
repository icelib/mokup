import type { McpRequest, McpResponse, MokupMcpServer } from '@mokup/runtime/mcp'
import type { Writable } from 'node:stream'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'

export interface McpStdioServerOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

export interface McpStdioServer {
  start: () => Promise<void>
  stop: () => void
}

function responseForError(input: unknown, error: unknown, code = -32600): McpResponse {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
  const id = typeof value?.['id'] === 'string' || typeof value?.['id'] === 'number' || value?.['id'] === null ? value?.['id'] : null
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  }
}

function isMcpRequest(value: unknown): value is McpRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const request = value as Record<string, unknown>
  if (request['jsonrpc'] !== '2.0' || typeof request['method'] !== 'string') {
    return false
  }
  if ('id' in request && !(request['id'] === null || typeof request['id'] === 'string'
    || (typeof request['id'] === 'number' && Number.isFinite(request['id'])))) {
    return false
  }
  return !('params' in request) || request['params'] === undefined
    || (typeof request['params'] === 'object' && request['params'] !== null)
}

/** Host an MCP server over newline-delimited JSON on Node.js stdio streams. */
export function createMcpStdioServer(server: MokupMcpServer, options: McpStdioServerOptions = {}): McpStdioServer {
  const input = options.input ?? stdin
  const output = options.output ?? stdout
  let reader: ReturnType<typeof createInterface> | undefined
  let running: Promise<void> | undefined
  let stopped = false

  const writeResponse = (response: McpResponse): Promise<void> => {
    if (stopped) {
      return Promise.resolve()
    }
    const writable = output as Writable
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let onError: (error: unknown) => void
      const cleanup = () => {
        writable.removeListener('error', onError)
      }
      const settle = (callback: () => void) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback()
      }
      onError = (error: unknown) => settle(() => reject(error))
      writable.once('error', onError)
      try {
        writable.write(`${JSON.stringify(response)}\n`, () => settle(resolve))
      }
      catch (error) {
        settle(() => reject(error))
      }
    })
  }

  const start = () => {
    if (running) {
      return running
    }
    stopped = false
    reader = createInterface({ input, crlfDelay: Infinity })
    running = (async () => {
      for await (const line of reader!) {
        if (stopped) {
          break
        }
        if (!line.trim()) {
          continue
        }
        let inputValue: unknown
        let response: McpResponse | undefined
        try {
          inputValue = JSON.parse(line)
        }
        catch {
          response = responseForError(null, new TypeError('MCP request contains invalid JSON.'), -32700)
        }
        if (!response) {
          try {
            if (!isMcpRequest(inputValue)) {
              throw new TypeError('MCP request is not a valid JSON-RPC request.')
            }
            response = await server.handle(inputValue as McpRequest)
          }
          catch (error) {
            response = responseForError(inputValue, error)
          }
        }
        if (response) {
          await writeResponse(response)
        }
      }
    })().finally(() => {
      reader = undefined
      running = undefined
    })
    return running
  }
  return {
    start,
    stop() {
      stopped = true
      reader?.close()
    },
  }
}
