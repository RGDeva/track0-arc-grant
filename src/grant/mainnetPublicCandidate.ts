import { getAddress, keccak256, type Hex, type PublicClient } from 'viem'
import { grantSplitAbi, validateGrantSplitTerms, type GrantSplitTerms } from './grantSplitProtocol'
import { matchesFrozenGrantRuntime } from './frozenGrantSplitArtifact'
import { MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_USDC, MAINNET_PROPOSED_DEMO_ID, MAINNET_PROPOSED_ROLES } from './grantMainnetCandidate'

/** A URL locates a candidate. Every identity and runtime fact comes from Mainnet RPC. */
export async function readMainnetPublicCandidate(client: PublicClient, suppliedContract: string): Promise<{
  terms: GrantSplitTerms; codeHash: Hex
}> {
  const contract = getAddress(suppliedContract)
  if (await client.getChainId() !== MAINNET_GRANT_CHAIN_ID) throw new Error('Wrong Arc RPC chain')
  const [code, payer, artist, producer, amountA, amountB, chain, demoId, executed, token] = await Promise.all([
    client.getBytecode({ address: contract }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'payer' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'recipientA' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'recipientB' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'amountA' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'amountB' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'chainId' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'demoId' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'executed' }),
    client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'USDC' }),
  ])
  if (!code || !matchesFrozenGrantRuntime(code)) throw new Error('Unreviewed Mainnet runtime bytecode')
  const terms: GrantSplitTerms = { contract, payer, recipientA: artist, recipientB: producer,
    amountA, amountB, chainId: Number(chain), demoId, executed, token }
  const findings = validateGrantSplitTerms({ ...terms, executed: false }, MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_USDC)
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  if (findings.length || !same(payer, MAINNET_PROPOSED_ROLES.payer) || !same(artist, MAINNET_PROPOSED_ROLES.artist) ||
      !same(producer, MAINNET_PROPOSED_ROLES.producer) || !same(demoId, MAINNET_PROPOSED_DEMO_ID))
    throw new Error('Mainnet contract immutable terms disagree with the proposed grant split')
  return { terms, codeHash: keccak256(code) }
}
