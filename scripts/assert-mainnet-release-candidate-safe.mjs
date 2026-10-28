import { readFileSync, readdirSync } from 'node:fs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const root = new URL('../dist-mainnet-release-candidate/assets/', import.meta.url)
const assets = readdirSync(root)
const bundle = assets.filter((name) => name.endsWith('.js')).map((name) => readFileSync(new URL(name, root), 'utf8')).join('\n')
const privateConfig = read('../vite.mainnet.activation-review.config.ts')
const releaseConfig = read('../vite.mainnet.release-candidate.config.ts')

if (!read('../src/grant/grantMainnetCandidate.ts').includes('MAINNET_GRANT_WRITES_HARD_DISABLED = true as const') ||
    !read('../src/lib/writeGates.ts').includes('WRITES_HARD_DISABLED = true as const'))
  throw new Error('Financial write gate changed')
if (!privateConfig.includes('treeshake: false') || !releaseConfig.includes('treeshake: false') ||
    releaseConfig.includes('mainnetSender.disabled.ts') || releaseConfig.includes('useMainnetWalletPort.disabled.ts'))
  throw new Error('Release import graph differs from inspected private build')
if (!bundle.includes('Mainnet transaction submission is hard-disabled in source') ||
    !bundle.includes('sendTransaction') || !bundle.includes('Selected provider is not EIP-6963 MetaMask'))
  throw new Error('Release candidate lacks real sender, MetaMask check or hard gate')
if (assets.some((name) => name.endsWith('.map')))
  throw new Error('Release candidate contains a source map')
for (const marker of ['AUTH0_CLIENT_SECRET', 'DATABASE_URL', 'SETTLEMENT_DESTINATION_ENCRYPTION_KEY', '$ZodArray', 'handleArrayResult'])
  if (bundle.includes(marker)) throw new Error(`Release candidate contains prohibited marker: ${marker}`)
console.log(`Mainnet release-candidate scan PASS (${assets.length} assets; real sender present, gates disabled, no maps or known secrets)`)
