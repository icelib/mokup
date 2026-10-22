import type {
  MockWebSocketConnection,
  WebSocketStartOptions,
  WebSocketUnhandledPolicy,
} from '@mokup/runtime/ws'
import { expectAssignable, expectType } from 'tsd'

const callback: WebSocketUnhandledPolicy = (event, context) => {
  expectType<string>(event.url)
  expectType<AbortSignal>(context.signal)
  expectType<MockWebSocketConnection>(context.connection)
}

expectAssignable<WebSocketStartOptions>({ onUnhandled: callback })
expectAssignable<WebSocketStartOptions>({ onUnhandledConnection: callback })
