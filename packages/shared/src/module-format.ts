import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// The first package scope wins, including manifests without a type field.
export function isTypeScriptModule(file: string): boolean {
  let directory = dirname(file)
  while (basename(directory) !== 'node_modules') {
    const manifest = join(directory, 'package.json')
    let contents: string
    try {
      contents = readFileSync(manifest, 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      const parent = dirname(directory)
      if (parent === directory) {
        return false
      }
      directory = parent
      continue
    }
    try {
      return JSON.parse(contents)?.type === 'module'
    }
    catch (error) {
      throw new Error(`Invalid package configuration: ${manifest}`, { cause: error })
    }
  }
  return false
}
