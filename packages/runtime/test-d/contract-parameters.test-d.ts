import type { ContractParameters, OpenApiOperation, ParameterObject, ParameterStyle, ParameterValue } from '@mokup/runtime/contract'
import { createContractHandler, validateOpenApiParameters } from '@mokup/runtime/contract'
import { expectAssignable, expectType } from 'tsd'

declare const operation: OpenApiOperation
expectType<ContractParameters>(validateOpenApiParameters(operation, new Request('https://example.test/items/1')).values)
createContractHandler<{ name: string }>(operation, ({ body, parameters, params }) => {
  expectType<{ name: string }>(body)
  expectType<ContractParameters>(parameters)
  expectType<ParameterValue | undefined>(parameters.query['page'])
  const objectValue: ParameterObject = { role: 'admin', enabled: true, tags: ['a', 'b'] }
  expectAssignable<ParameterValue>(objectValue)
  const style: ParameterStyle = 'deepObject'
  expectAssignable<ParameterStyle>(style)
  expectType<string | string[] | undefined>(params['id'])
  return { status: 200, body: { ok: true } }
})
