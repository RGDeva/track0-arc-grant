import { describe, expect, it } from 'vitest'
import type { Address, Block, Hex, Transaction, TransactionReceipt } from 'viem'
import { grantDeploymentData, GRANT_RUNTIME_TEMPLATE } from './frozenGrantSplitArtifact'
import { verifyGrantDeploymentEvidence, type GrantDeploymentEvidence } from './grantDeploymentEvidence'
const address = (digit: string): Address => `0x${digit.repeat(40)}`
const hash = (digit: string): Hex => `0x${digit.repeat(64)}`
const payer = address('1'), recipientA = address('2'), recipientB = address('3'), demoId = hash('a'), contract = address('4')
const transaction = { hash: hash('b'), from: payer, to: null, input: grantDeploymentData(payer, recipientA, recipientB, demoId), chainId: 5042002, value: 0n, blockHash: hash('c'), blockNumber: 12n, transactionIndex: 0 } as Transaction
const receipt = { status: 'success', transactionHash: hash('b'), from: payer, to: null, contractAddress: contract, blockHash: hash('c'), blockNumber: 12n, transactionIndex: 0, logs: [] } as unknown as TransactionReceipt
const block = { hash: hash('c'), number: 12n, transactions: [hash('b')] } as Block
const valid: GrantDeploymentEvidence = { payer, recipientA, recipientB, demoId, hash: hash('b'), transaction, receipt, block, runtimeCode: GRANT_RUNTIME_TEMPLATE, rpcChainId: 5042002 }
describe('reviewed Testnet deployment evidence', () => {
  it('accepts only exact creation input, block and frozen runtime', () => {
    expect(verifyGrantDeploymentEvidence(valid)).toMatchObject({ findings: [], contract })
  })
  it('rejects wrong chain, payer, constructor, failed receipt, block and runtime', () => {
    for (const change of [
      { rpcChainId: 5042 }, { transaction: { ...transaction, from: address('5') } },
      { transaction: { ...transaction, input: '0x' as Hex } }, { receipt: { ...receipt, status: 'reverted' as const } },
      { block: { ...block, hash: hash('d') } }, { runtimeCode: '0x6001' as Hex },
    ]) expect(verifyGrantDeploymentEvidence({ ...valid, ...change }).contract).toBeNull()
  })
  it('never interprets a pending or missing receipt as deployment', () => {
    expect(verifyGrantDeploymentEvidence({ ...valid, receipt: null }).findings.length).toBeGreaterThan(0)
    expect(verifyGrantDeploymentEvidence({ ...valid, transaction: null }).findings.length).toBeGreaterThan(0)
  })
})
