import { decodeEventLog, encodeFunctionData, erc20Abi, type Address, type Block, type Hex, type Transaction, type TransactionReceipt } from 'viem'
import { GRANT_SPLIT_TOTAL, GRANT_TESTNET_CHAIN_ID, GRANT_TESTNET_USDC } from './grantTestnetSafety'
const eq = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
export function verifyExactApproval(input: { payer: Address; contract: Address; hash: Hex; transaction: Transaction | null;
  receipt: TransactionReceipt | null; block: Block | null; allowance: bigint | null; rpcChainId: number;
  expectedChainId?: number; expectedToken?: Address; expectedAmount?: bigint; allowanceMayBeConsumed?: boolean }): string[] {
  const { payer, contract, hash, transaction, receipt, block, allowance, rpcChainId } = input
  const expectedChainId = input.expectedChainId ?? GRANT_TESTNET_CHAIN_ID
  const expectedToken = input.expectedToken ?? GRANT_TESTNET_USDC
  const expectedAmount = input.expectedAmount ?? GRANT_SPLIT_TOTAL
  const findings: string[] = []
  const expectedInput = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [contract, expectedAmount] })
  if (rpcChainId !== expectedChainId) findings.push('Wrong Arc chain')
  if (!transaction || !receipt || !block) findings.push('Approval chain evidence unavailable')
  if (transaction && (!eq(transaction.hash, hash) || !eq(transaction.from, payer) || !eq(transaction.to, expectedToken) ||
      !eq(transaction.input, expectedInput) || transaction.chainId !== expectedChainId || transaction.value !== 0n))
    findings.push('Approval transaction is not the exact reviewed call')
  if (receipt && (receipt.status !== 'success' || !eq(receipt.transactionHash, hash) || !eq(receipt.from, payer) ||
      !eq(receipt.to, expectedToken))) findings.push('Approval receipt did not succeed at the exact token')
  if (transaction && receipt && (!eq(transaction.blockHash, receipt.blockHash) || transaction.blockNumber !== receipt.blockNumber ||
      transaction.transactionIndex !== receipt.transactionIndex)) findings.push('Approval transaction/receipt inclusion mismatch')
  if (receipt && block && (!eq(block.hash, receipt.blockHash) || block.number !== receipt.blockNumber ||
      !Number.isSafeInteger(receipt.transactionIndex) || !Array.isArray(block.transactions) ||
      !eq(block.transactions[receipt.transactionIndex], hash))) findings.push('Approval is absent from the canonical block')
  if (input.allowanceMayBeConsumed) {
    if (allowance !== expectedAmount && allowance !== 0n) findings.push('Current allowance contradicts exact approval or its consumption')
    const tokenLogs = (receipt?.logs ?? []).filter((log) => eq(log.address, expectedToken))
    const approvals = tokenLogs.flatMap((log) => {
      if (!receipt || !eq(log.transactionHash, receipt.transactionHash) || !eq(log.blockHash, receipt.blockHash) ||
          log.blockNumber !== receipt.blockNumber || log.transactionIndex !== receipt.transactionIndex || log.removed !== false) {
        findings.push('Approval log transaction or block identity mismatch')
      }
      try {
        const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics })
        return event.eventName === 'Approval' ? [event.args] : []
      } catch { return [] }
    })
    if (tokenLogs.length !== 1 || approvals.length !== 1 || !eq(approvals[0]?.owner, payer) || !eq(approvals[0]?.spender, contract) ||
        approvals[0]?.value !== expectedAmount) findings.push('Exact Approval event absent or contradictory')
  } else if (allowance !== expectedAmount) findings.push('Current allowance is not exactly 0.30 USDC')
  return findings
}
