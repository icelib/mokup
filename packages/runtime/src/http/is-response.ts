const originalResponse = globalThis.Response
const getStatus = Object.getOwnPropertyDescriptor(originalResponse.prototype, 'status')?.get

/** Recognize Fetch responses across native realms and legitimate global replacements. */
export function isResponse(value: unknown): value is Response {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (value instanceof originalResponse || value instanceof globalThis.Response) {
    return true
  }
  try {
    // Native accessors perform an internal brand check; a status/body lookalike
    // cannot pass this test, including objects with a forged toStringTag.
    return typeof getStatus?.call(value) === 'number'
  }
  catch {
    return false
  }
}
