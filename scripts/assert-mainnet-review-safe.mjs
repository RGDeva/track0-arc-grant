import { readFileSync, readdirSync } from 'node:fs'

const entry = readFileSync(new URL('../mainnet-app/main.tsx', import.meta.url), 'utf8')
const config = readFileSync(new URL('../vite.mainnet.config.ts', import.meta.url), 'utf8')
const root = new URL('../dist-mainnet-review/assets/', import.meta.url)
const assets = readdirSync(root).filter((name) => name.endsWith('.js'))
const bundle = assets.map((name) => readFileSync(new URL(name, root), 'utf8')).join('\n')
const forbiddenSource = [
  'GrantSplitTestnetFlow', 'useDeployContract', 'useWriteContract', 'deployContractAsync',
  'writeContractAsync', 'eth_sendTransaction', 'wallet_sendTransaction',
]
const forbiddenBundle = [
  'deployContractAsync', 'writeContractAsync', 'eth_sendTransaction', 'wallet_sendTransaction',
  'AUTH0_CLIENT_SECRET', 'DATABASE_URL', 'PRIVATE_KEY', 'SETTLEMENT_DESTINATION_ENCRYPTION_KEY',
]
for (const marker of forbiddenSource) if (entry.includes(marker)) throw new Error(`Mainnet entrypoint imports a prohibited write path: ${marker}`)
for (const marker of forbiddenBundle) if (bundle.includes(marker)) throw new Error(`Mainnet review bundle contains a prohibited marker: ${marker}`)
if (!config.includes('mainnetSender.disabled.ts') || !config.includes('useMainnetWalletPort.disabled.ts'))
  throw new Error('Mainnet review build does not exclude both wallet-write modules')
if (!entry.includes('MAINNET_GRANT_WRITES_HARD_DISABLED') ||
    !entry.includes('disabled={MAINNET_GRANT_WRITES_HARD_DISABLED || submitting'))
  throw new Error('Mainnet review control is not visibly hard-disabled')
if (!bundle.includes('Owner activation recorded') || bundle.includes('sendTransaction'))
  throw new Error('Public Mainnet review build lacks owner-exception status or contains a sender')
console.log(`Mainnet review bundle scan PASS (${assets.length} JavaScript assets; no app wallet-write handlers or known secret names)`)
