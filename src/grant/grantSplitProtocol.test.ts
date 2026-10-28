import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, type Address, type Hex, type Transaction, type TransactionReceipt } from 'viem'
import { GRANT_WRITES_HARD_DISABLED, displayGrantAmount, grantSplitAbi, validateGrantSplitTerms, verifyGrantSplitEvidence, type GrantSplitTerms } from './grantSplitProtocol'

const address = (digit: string): Address => `0x${digit.repeat(40)}`
const hash = (digit: string): Hex => `0x${digit.repeat(64)}`
const terms: GrantSplitTerms = {
  contract: address('1'), chainId: 5042, token: '0x3600000000000000000000000000000000000000',
  payer: address('2'), recipientA: address('3'), recipientB: address('4'),
  amountA: 100_000n, amountB: 200_000n, demoId: hash('a'), executed: false,
}

function evidence() {
  const logMeta = (logIndex: number) => ({ transactionHash: hash('b'), blockHash: hash('c'), blockNumber: 10n, transactionIndex: 0, logIndex, removed: false })
  const split = {
    ...logMeta(2),
    address: terms.contract,
    topics: encodeEventTopics({ abi: grantSplitAbi, eventName: 'DemoSplitExecuted', args: { demoId: terms.demoId, payer: terms.payer, token: terms.token } }),
    data: encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
      [terms.recipientA, terms.amountA, terms.recipientB, terms.amountB],
    ),
  }
  const transfer = (to: Address, value: bigint, logIndex: number) => ({
    ...logMeta(logIndex),
    address: terms.token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: terms.payer, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  })
  const transaction = {
    hash: hash('b'), from: terms.payer, to: terms.contract,
    input: encodeFunctionData({ abi: grantSplitAbi, functionName: 'execute' }),
    blockHash: hash('c'), blockNumber: 10n, transactionIndex: 0, chainId: terms.chainId, value: 0n,
  } as Transaction
  const receipt = {
    status: 'success', transactionHash: hash('b'), blockHash: hash('c'), blockNumber: 10n,
    transactionIndex: 0, from: terms.payer, to: terms.contract,
    logs: [transfer(terms.recipientA, terms.amountA, 0), transfer(terms.recipientB, terms.amountB, 1), split],
  } as unknown as TransactionReceipt
  return { transaction, receipt }
}

describe('operator-funded grant split protocol', () => {
  it('requires the separately reviewed grant-only activation', () => expect(GRANT_WRITES_HARD_DISABLED).toBe(false))
  it('uses exact six-decimal ERC-20 amounts', () => {
    expect(displayGrantAmount(100_000n)).toBe('0.1')
    expect(displayGrantAmount(1_000_000n)).toBe('1')
  })
  it('rejects chain, token, cap, replay and recipient substitution', () => {
    expect(validateGrantSplitTerms(terms, 5042, terms.token)).toEqual([])
    expect(validateGrantSplitTerms({ ...terms, amountB: 950_000n }, 5042, terms.token)).toContain('Invalid or over-cap amount')
    expect(validateGrantSplitTerms({ ...terms, amountB: 300_000n }, 5042, terms.token)).toContain('Unexpected grant split amount')
    expect(validateGrantSplitTerms({ ...terms, recipientB: terms.recipientA }, 5042, terms.token)).toContain('Duplicate recipients')
    expect(validateGrantSplitTerms({ ...terms, recipientA: terms.payer }, 5042, terms.token)).toContain('Recipient is payer')
    expect(validateGrantSplitTerms({ ...terms, recipientB: terms.payer }, 5042, terms.token)).toContain('Recipient is payer')
    expect(validateGrantSplitTerms({ ...terms, recipientA: address('0') }, 5042, terms.token)).toContain('Zero payer or recipient')
    expect(validateGrantSplitTerms({ ...terms, recipientB: address('0') }, 5042, terms.token)).toContain('Zero payer or recipient')
    expect(validateGrantSplitTerms({ ...terms, executed: true }, 5042, terms.token)).toContain('Already executed')
    expect(validateGrantSplitTerms(terms, 5042002, terms.token)).toContain('Wrong contract chain')
    expect(validateGrantSplitTerms(terms, 5042, address('5'))).toContain('Wrong token')
  })
  it('requires exact successful call, split event and both USDC transfers', () => {
    const { transaction, receipt } = evidence()
    expect(verifyGrantSplitEvidence(terms, hash('b'), transaction, receipt)).toEqual([])
    expect(verifyGrantSplitEvidence(terms, hash('d'), transaction, receipt)).toContain('Transaction hash mismatch')
    expect(verifyGrantSplitEvidence(terms, hash('b'), transaction, { ...receipt, status: 'reverted' })).toContain('Transaction failed')
    expect(verifyGrantSplitEvidence(terms, hash('b'), transaction, { ...receipt, logs: receipt.logs.slice(0, 2) })).toContain('Expected exactly one split event')
    expect(verifyGrantSplitEvidence(terms, hash('b'), transaction, { ...receipt, logs: receipt.logs.slice(1) })).toContain('Expected exactly two USDC transfers')
    expect(verifyGrantSplitEvidence({ ...terms, amountB: 300_000n }, hash('b'), transaction, receipt)).toContain('USDC transfers do not match frozen terms')
    expect(verifyGrantSplitEvidence(terms, hash('b'), { ...transaction, from: address('5') }, receipt)).toContain('Wrong caller or contract')
    expect(verifyGrantSplitEvidence(terms, hash('b'), transaction, { ...receipt, logs: receipt.logs.map((log, index) => index === 0 ? { ...log, transactionHash: hash('d') } : log) })).toContain('Log transaction or block identity mismatch')
    expect(verifyGrantSplitEvidence(terms, hash('b'), transaction, { ...receipt, logs: [receipt.logs[1], receipt.logs[0], receipt.logs[2]] })).toContain('USDC transfers do not match frozen terms')
    expect(verifyGrantSplitEvidence(terms, hash('b'), transaction, { ...receipt, logs: receipt.logs.map((log, index) => index === 1 ? { ...log, logIndex: 0 } : log) })).toContain('Invalid or noncanonical log index')
    expect(verifyGrantSplitEvidence(terms, hash('b'), { ...transaction, value: 1n }, receipt)).toContain('Unexpected native transaction value')
  })
})
