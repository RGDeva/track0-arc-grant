/* oxlint-disable typescript/require-await -- In-memory read-only RPC fixture. */
import { describe, expect, it } from 'vitest'
import { type PublicClient } from 'viem'
import { GRANT_RUNTIME_TEMPLATE } from './frozenGrantSplitArtifact'
import { MAINNET_GRANT_USDC, MAINNET_PROPOSED_DEMO_ID, MAINNET_PROPOSED_ROLES } from './grantMainnetCandidate'
import { readMainnetPublicCandidate } from './mainnetPublicCandidate'

const contract = '0x4444444444444444444444444444444444444444'
function rpc(overrides: Record<string, unknown> = {}): PublicClient {
  const values: Record<string, unknown> = { payer: MAINNET_PROPOSED_ROLES.payer,
    recipientA: MAINNET_PROPOSED_ROLES.artist, recipientB: MAINNET_PROPOSED_ROLES.producer,
    amountA: 100_000n, amountB: 200_000n, chainId: 5042n, demoId: MAINNET_PROPOSED_DEMO_ID,
    executed: true, USDC: MAINNET_GRANT_USDC, ...overrides }
  return { getChainId: async () => 5042, getBytecode: async () => GRANT_RUNTIME_TEMPLATE,
    readContract: async ({ functionName }: { functionName: string }) => values[functionName] } as unknown as PublicClient
}

describe('fresh-browser Mainnet public contract locator', () => {
  it('resolves only exact frozen onchain terms, without a wallet or local journal', async () => {
    const result = await readMainnetPublicCandidate(rpc(), contract)
    expect(result.terms).toMatchObject({ payer: MAINNET_PROPOSED_ROLES.payer, recipientA: MAINNET_PROPOSED_ROLES.artist,
      recipientB: MAINNET_PROPOSED_ROLES.producer, amountA: 100_000n, amountB: 200_000n,
      demoId: MAINNET_PROPOSED_DEMO_ID, executed: true })
    expect(result.codeHash).toMatch(/^0x[\da-f]{64}$/i)
  })
  it('rejects malformed addresses, wrong chain, altered runtime and changed immutable terms', async () => {
    await expect(readMainnetPublicCandidate(rpc(), 'not-an-address')).rejects.toThrow()
    const unreachable = { ...rpc(), getChainId: async () => { throw new Error('RPC must not be called') } }
    await expect(readMainnetPublicCandidate(unreachable, `0x${'a'.repeat(512)}`)).rejects.not.toThrow('RPC must not be called')
    await expect(readMainnetPublicCandidate(unreachable, '%'.repeat(512))).rejects.not.toThrow('RPC must not be called')
    await expect(readMainnetPublicCandidate({ ...rpc(), getChainId: async () => 5042002 }, contract)).rejects.toThrow('Wrong Arc RPC chain')
    await expect(readMainnetPublicCandidate({ ...rpc(), getBytecode: async () => '0x6001' }, contract)).rejects.toThrow('runtime')
    await expect(readMainnetPublicCandidate(rpc({ amountB: 200_001n }), contract)).rejects.toThrow('immutable terms')
    await expect(readMainnetPublicCandidate(rpc({ recipientA: MAINNET_PROPOSED_ROLES.producer }), contract)).rejects.toThrow('immutable terms')
  })
})
