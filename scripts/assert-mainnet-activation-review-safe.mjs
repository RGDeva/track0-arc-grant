import { readFileSync, readdirSync } from 'node:fs'

const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const sourceGate = source('../src/grant/grantMainnetCandidate.ts')
const globalGate = source('../src/lib/writeGates.ts')
const config = source('../vite.mainnet.activation-review.config.ts')
const root = new URL('../dist-mainnet-activation-review/assets/', import.meta.url)
const assets = readdirSync(root).filter((name) => name.endsWith('.js'))
const bundle = assets.map((name) => readFileSync(new URL(name, root), 'utf8')).join('\n')
const sources = assets.flatMap((name) => {
  const map = JSON.parse(readFileSync(new URL(`${name}.map`, root), 'utf8'))
  return map.sources
})

if (!sourceGate.includes('MAINNET_GRANT_WRITES_HARD_DISABLED = true as const') ||
    !globalGate.includes('WRITES_HARD_DISABLED = true as const'))
  throw new Error('A financial write gate changed in source')
if (config.includes('mainnetSender.disabled.ts') || config.includes('useMainnetWalletPort.disabled.ts'))
  throw new Error('Private review build still aliases out the real sender or wallet adapter')
if (!bundle.includes('Mainnet transaction submission is hard-disabled in source') ||
    !bundle.includes('walletClient.sendTransaction') ||
    !bundle.includes('Selected provider is not EIP-6963 MetaMask'))
  throw new Error('Private review bundle is missing a required sender, wallet adapter or hard gate')
if (!sources.some((name) => name.includes('/node_modules/viem/')))
  throw new Error('Private review source maps do not identify bundled dependencies')
for (const vulnerable of [
  'zod', 'uuid', 'decode-uri-component', 'elliptic',
  'postcss-selector-parser', 'qs', 'stream-json',
])
  if (sources.some((name) => name.includes(`/node_modules/${vulnerable}/`)))
    throw new Error(`Private review bundle includes audited dependency: ${vulnerable}`)
// Unminified wallet SDK dependencies contain generic PRIVATE_KEY identifier names;
// that token alone is not a credential. Scan application-only secret identifiers here.
for (const marker of ['AUTH0_CLIENT_SECRET', 'DATABASE_URL', 'SETTLEMENT_DESTINATION_ENCRYPTION_KEY'])
  if (bundle.includes(marker)) throw new Error(`Private review bundle contains prohibited secret name: ${marker}`)
console.log(`Mainnet private activation-review bundle scan PASS (${assets.length} JavaScript assets; sender present, audited dependencies excluded, write gates hard-disabled)`)
