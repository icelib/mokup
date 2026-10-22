import type { HttpHandler } from '@mokup/runtime/http'
import type { WorkerStartOptions } from '../browser'
import { setupWorker } from '../browser'

export interface StorybookContext {
  [key: string]: unknown
}

export type StorybookStory<Result = unknown> = (context: StorybookContext) => Result
export type StorybookDecorator<Result = unknown> = (story: StorybookStory<Result>, context: StorybookContext) => Result

export interface StorybookMockOptions {
  handlers?: readonly HttpHandler[]
  /** Interceptor mode is the default because it starts synchronously in a story preview. */
  start?: Omit<WorkerStartOptions, 'mode'>
}

export interface StorybookMockController<Result = unknown> {
  decorator: StorybookDecorator<Result>
  ready: Promise<void>
  stop: () => Promise<void>
}

/** Create a Storybook decorator backed by an isolated in-page Mokup worker. */
export function createStorybookDecorator<Result = unknown>(options: StorybookMockOptions = {}): StorybookMockController<Result> {
  const worker = setupWorker(...(options.handlers ?? []))
  const ready = worker.start({ ...(options.start ?? {}), mode: 'interceptor' })
  return {
    decorator: (story, context) => story(context),
    ready,
    stop: worker.stop,
  }
}
