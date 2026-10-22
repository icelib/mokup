import type { Manifest } from '../types'

/** A compiled generation owns its serializable metadata, including lazy responses. */
export function snapshotManifest(manifest: Manifest): Manifest {
  return structuredClone(manifest)
}
