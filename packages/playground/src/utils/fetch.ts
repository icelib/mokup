import type { BuildCurlOptions } from './curl'
import { prepareCopyRequest } from './copy-request'

function buildFetch(options: BuildCurlOptions): string {
  const { method, url, headers, body } = prepareCopyRequest(options)
  const parts: string[] = [`fetch(${JSON.stringify(url)},`, '  {']
  parts.push(`    method: ${JSON.stringify(method)},`)

  if (headers.length > 0) {
    parts.push('    headers: [')
    for (const [key, value] of headers) {
      parts.push(`      [${JSON.stringify(key)}, ${JSON.stringify(value)}],`)
    }
    parts.push('    ],')
  }

  if (body?.type === 'text') {
    parts.push(`    body: ${JSON.stringify(body.value)},`)
  }
  else if (body?.type === 'form-data') {
    parts.push('    body: (() => {', '      const formData = new FormData()')
    for (const [key, value] of body.entries) {
      parts.push(`      formData.append(${JSON.stringify(key)}, ${JSON.stringify(value)})`)
    }
    parts.push('      return formData', '    })(),')
  }

  parts.push('  }')
  parts.push(')')

  return parts.join('\n')
}

export { buildFetch }
