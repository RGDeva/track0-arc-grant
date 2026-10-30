import { readFileSync, readdirSync } from 'node:fs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const root = new URL('../dist-mainnet-release-candidate/assets/', import.meta.url)
const assets = readdirSync(root)
const bundle = assets.filter((name) => name.endsWith('.js')).map((name) => readFileSync(new URL(name, root), 'utf8')).join('\n')
const releaseConfig = read('../vite.mainnet.release-candidate.config.ts')
const sealedDecisionHash = '3fb62ccc9ae3af596de9332a42615388ceedcfe0fe1ee7bc7567819c9261ab7c'
const ownerReference = `ownerActivationReference: 'release/MAINNET_OWNER_DECISION_B2_2026-10-30.md#sha256:${sealedDecisionHash}'`

if (!read('../src/grant/grantMainnetCandidate.ts').includes('MAINNET_GRANT_WRITES_HARD_DISABLED = false as const') ||
    !read('../src/grant/grantMainnetCandidate.ts').includes(ownerReference) ||
    !read('../src/lib/writeGates.ts').includes('WRITES_HARD_DISABLED = true as const'))
  throw new Error('B2 owner reference, grant candidate gate or global Track0 gate differs')
if (!releaseConfig.includes('treeshake: false') ||
    releaseConfig.includes('mainnetSender.disabled.ts') || releaseConfig.includes('useMainnetWalletPort.disabled.ts'))
  throw new Error('Release import graph differs from inspected private build')
if (!bundle.includes('Source-reviewed human activation, role consent and all spending ceilings are missing') ||
    !bundle.includes('sendTransaction') || !bundle.includes('Selected provider is not EIP-6963 MetaMask') ||
    !bundle.includes('MAINNET_OWNER_DECISION_B2_2026-10-30.md'))
  throw new Error('B2 candidate lacks real sender, MetaMask check or owner reference')
if (assets.some((name) => name.endsWith('.map')))
  throw new Error('Release candidate contains a source map')
for (const marker of ['AUTH0_CLIENT_SECRET', 'DATABASE_URL', 'SETTLEMENT_DESTINATION_ENCRYPTION_KEY', '$ZodArray', 'handleArrayResult'])
  if (bundle.includes(marker)) throw new Error(`Release candidate contains prohibited marker: ${marker}`)
console.log(`Mainnet B2 release-candidate scan PASS (${assets.length} assets; real grant sender present, global Track0 gate disabled, no maps or known secrets)`)
