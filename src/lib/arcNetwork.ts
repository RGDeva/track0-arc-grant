/** Public network facts only. Selecting mainnet never enables wallet writes. */
export const ARC_NETWORKS = Object.freeze({
  testnet: Object.freeze({
    key: 'testnet', name: 'Arc Testnet', chainId: 5042002,
    usdc: '0x3600000000000000000000000000000000000000',
    explorer: 'https://explorer.testnet.arc.io',
  }),
  mainnet: Object.freeze({
    key: 'mainnet', name: 'Arc Mainnet', chainId: 5042,
    usdc: '0x3600000000000000000000000000000000000000',
    explorer: 'https://explorer.arc.io',
  }),
})

export type ArcNetwork = typeof ARC_NETWORKS[keyof typeof ARC_NETWORKS]

/** Default testnet; unknown values fail closed instead of selecting a chain. */
export function parseArcNetwork(value: string | undefined): ArcNetwork | null {
  if (value === undefined || value === 'testnet') return ARC_NETWORKS.testnet
  if (value === 'mainnet') return ARC_NETWORKS.mainnet
  return null
}
