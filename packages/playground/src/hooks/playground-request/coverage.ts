import type { InjectionKey, Ref } from 'vue'
import type { PlaygroundDiagnosticsTotals, PlaygroundHandlerCoverage } from './websocket'

export const requestCoverageKey: InjectionKey<Ref<PlaygroundHandlerCoverage[]>> = Symbol('mokup-request-coverage')
export const requestCoverageTotalsKey: InjectionKey<Ref<PlaygroundDiagnosticsTotals>> = Symbol('mokup-request-coverage-totals')
