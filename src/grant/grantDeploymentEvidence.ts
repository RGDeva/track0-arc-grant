import { getAddress, keccak256, type Address, type Block, type Hex, type Transaction, type TransactionReceipt } from 'viem'
import { grantDeploymentData, matchesFrozenGrantRuntime } from './frozenGrantSplitArtifact'
import { GRANT_TESTNET_CHAIN_ID } from './grantTestnetSafety'
const eq = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
export interface GrantDeploymentEvidence {
  payer: Address
  recipientA: Address
  recipientB: Address
  demoId: Hex
  hash: Hex
  transaction: Transaction | null
  receipt: TransactionReceipt | null
  block: Block | null
  runtimeCode: Hex | null
  rpcChainId: number
  expectedChainId?: number
  expectedDeploymentData?: Hex
}
export function verifyGrantDeploymentEvidence(input: GrantDeploymentEvidence): { findings: string[]; contract: Address | null; runtimeHash: Hex | null } {
  const { payer, recipientA, recipientB, demoId, hash, transaction, receipt, block, runtimeCode, rpcChainId } = input
  const expectedChainId = input.expectedChainId ?? GRANT_TESTNET_CHAIN_ID
  const expectedData = input.expectedDeploymentData ?? grantDeploymentData(payer, recipientA, recipientB, demoId)
  const findings: string[] = []
  if (rpcChainId !== expectedChainId) findings.push('Wrong RPC chain')
  if (!transaction || !receipt || !block) findings.push('Deployment transaction, receipt or block unavailable')
  if (transaction && (!eq(transaction.hash, hash) || !eq(transaction.from, payer) || transaction.to !== null ||
      transaction.chainId !== expectedChainId || transaction.value !== 0n ||
      !eq(transaction.input, expectedData))) findings.push('Deployment transaction differs from reviewed construction')
  if (receipt && (receipt.status !== 'success' || !eq(receipt.transactionHash, hash) || !eq(receipt.from, payer) ||
      receipt.to !== null || !receipt.contractAddress)) findings.push('Deployment receipt is not a successful contract creation')
  if (transaction && receipt && (!eq(transaction.blockHash, receipt.blockHash) || transaction.blockNumber !== receipt.blockNumber ||
      transaction.transactionIndex !== receipt.transactionIndex)) findings.push('Deployment transaction and receipt inclusion differ')
  if (receipt && block && (!eq(block.hash, receipt.blockHash) || block.number !== receipt.blockNumber ||
      !Number.isSafeInteger(receipt.transactionIndex) || !Array.isArray(block.transactions) ||
      !eq(block.transactions[receipt.transactionIndex], hash))) findings.push('Deployment is not in the claimed canonical block')
  if (!matchesFrozenGrantRuntime(runtimeCode)) findings.push('Deployed runtime differs from frozen artifact outside immutable slots')
  let contract: Address | null = null
  try { contract = receipt?.contractAddress ? getAddress(receipt.contractAddress) : null } catch { findings.push('Malformed deployed address') }
  return { findings, contract: findings.length ? null : contract, runtimeHash: findings.length || !runtimeCode ? null : keccak256(runtimeCode) }
}
