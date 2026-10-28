import { describe, expect, it } from 'vitest'
import { encodeFunctionData, erc20Abi, type Address, type Block, type Hex, type Transaction, type TransactionReceipt } from 'viem'
import { verifyExactApproval } from './grantApprovalEvidence'
import { GRANT_SPLIT_TOTAL, GRANT_TESTNET_CHAIN_ID, GRANT_TESTNET_USDC } from './grantTestnetSafety'

const address = (digit: string): Address => `0x${digit.repeat(40)}`
const hash = (digit: string): Hex => `0x${digit.repeat(64)}`
const payer = address('1'), contract = address('2')
const approvalHash = hash('a'), blockHash = hash('b')
const transaction = { hash: approvalHash, from: payer, to: GRANT_TESTNET_USDC,
  input: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [contract, GRANT_SPLIT_TOTAL] }),
  chainId: GRANT_TESTNET_CHAIN_ID, value: 0n, blockHash, blockNumber: 5n, transactionIndex: 0 } as Transaction
const receipt = { status: 'success', transactionHash: approvalHash, from: payer, to: GRANT_TESTNET_USDC,
  blockHash, blockNumber: 5n, transactionIndex: 0 } as TransactionReceipt
const block = { hash: blockHash, number: 5n, transactions: [approvalHash] } as Block
const valid = { payer, contract, hash: approvalHash, transaction, receipt, block, allowance: GRANT_SPLIT_TOTAL,
  rpcChainId: GRANT_TESTNET_CHAIN_ID }

describe('exact-value approval evidence', () => {
  it('requires the actual 300000-unit approval, canonical block and current exact allowance', () => {
    expect(verifyExactApproval(valid)).toEqual([])
    expect(verifyExactApproval({ ...valid, allowance: 0n })).not.toEqual([])
    expect(verifyExactApproval({ ...valid, allowance: 2n ** 256n - 1n })).not.toEqual([])
  })
  it('rejects wrong chain, wrong payer, unlimited approval, stale block and reverted receipt', () => {
    for (const change of [
      { rpcChainId: 5042 }, { transaction: { ...transaction, from: address('3') } },
      { transaction: { ...transaction, input: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [contract, 2n ** 256n - 1n] }) } },
      { block: { ...block, hash: hash('c') } }, { receipt: { ...receipt, status: 'reverted' as const } },
      { transaction: null }, { receipt: null },
    ]) expect(verifyExactApproval({ ...valid, ...change }).length).toBeGreaterThan(0)
  })
})
