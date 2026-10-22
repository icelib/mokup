import { createPackageConfig } from '../../scripts/tsdown-config.ts'

export default createPackageConfig({ entries: ['src/index', 'src/http', 'src/node', 'src/browser'] })
