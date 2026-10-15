/** An unsuccessful HTTP response from the default Query Fetch executor. */
export class MokupHttpError extends Error {
  readonly response: Response
  readonly status: number
  readonly statusText: string

  constructor(response: Response) {
    super(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`)
    this.name = 'MokupHttpError'
    this.response = response
    this.status = response.status
    this.statusText = response.statusText
  }
}

export function defaultTransformResponse(response: Response, method?: string): Promise<unknown> {
  if (!response.ok) {
    throw new MokupHttpError(response)
  }
  if (method === 'HEAD' || response.status === 204 || response.status === 205) {
    return Promise.resolve('')
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return response.text()
}
