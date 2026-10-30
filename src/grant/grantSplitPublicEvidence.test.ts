import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, keccak256, type Address, type Block, type Hex, type Transaction, type TransactionReceipt } from 'viem'
import { grantSplitAbi, type GrantSplitTerms } from './grantSplitProtocol'
import { classifyGrantPublicEvidence, evidenceClientIdentity, grantEvidenceUrl, parseGrantTransactionHash, readGrantPublicEvidence, visibleGrantEvidence, type GrantEvidenceReader, type GrantPublicEvidenceInput } from './grantSplitPublicEvidence'

const addr = (digit: string): Address => `0x${digit.repeat(40)}`
const hash = (digit: string): Hex => `0x${digit.repeat(64)}`
const terms: GrantSplitTerms = { contract: addr('1'), chainId: 5042002, token: '0x3600000000000000000000000000000000000000', payer: addr('2'), recipientA: addr('3'), recipientB: addr('4'), amountA: 100_000n, amountB: 200_000n, demoId: hash('a'), executed: true }
const code = '0x6001' as Hex
const codeHash = keccak256(code)
const meta = (logIndex: number) => ({ transactionHash: hash('b'), blockHash: hash('c'), blockNumber: 12n, transactionIndex: 0, logIndex, removed: false })
const tx = { hash: hash('b'), from: terms.payer, to: terms.contract, input: encodeFunctionData({ abi: grantSplitAbi, functionName: 'execute' }), blockHash: hash('c'), blockNumber: 12n, transactionIndex: 0, chainId: terms.chainId, value: 0n } as Transaction
const transfer = (to: Address, value: bigint, logIndex: number) => ({ ...meta(logIndex), address: terms.token, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: terms.payer, to } }), data: encodeAbiParameters([{ type: 'uint256' }], [value]) })
const split = { ...meta(2), address: terms.contract, topics: encodeEventTopics({ abi: grantSplitAbi, eventName: 'DemoSplitExecuted', args: { demoId: terms.demoId, payer: terms.payer, token: terms.token } }), data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }], [terms.recipientA, terms.amountA, terms.recipientB, terms.amountB]) }
const receipt = { status: 'success', transactionHash: tx.hash, blockHash: tx.blockHash, blockNumber: tx.blockNumber, transactionIndex: 0, from: terms.payer, to: terms.contract, logs: [transfer(terms.recipientA, terms.amountA, 0), transfer(terms.recipientB, terms.amountB, 1), split] } as unknown as TransactionReceipt
const block = { hash: tx.blockHash, number: tx.blockNumber, transactions: [tx.hash] } as Block
const baseline = { terms, hash: tx.hash, rpcChainId: 5042002, expectedChainId: 5042002, expectedToken: terms.token, codeHash, codeHashAtBlock: codeHash, currentCodeHash: codeHash, expectedCodeHash: codeHash, transaction: tx, receipt, blockBefore: block, blockAfter: block, checkedAt: 123 }
const status = (changes: Partial<GrantPublicEvidenceInput>) => classifyGrantPublicEvidence({ ...baseline, ...changes }).status
function reader(overrides: Partial<GrantEvidenceReader> = {}): GrantEvidenceReader {
  return { getChainId: () => Promise.resolve(terms.chainId), getTransaction: () => Promise.resolve(tx), getReceipt: () => Promise.resolve(receipt), getBlock: () => Promise.resolve(block), getBytecode: () => Promise.resolve(code), ...overrides }
}
describe('persistent read-only Arc evidence', () => {
  it('accepts only exact transaction hashes from a URL', () => {
    expect(parseGrantTransactionHash(tx.hash)).toBe(tx.hash)
    for (const bad of [null, '0x123', `${tx.hash}&other=1`, `0x${'a'.repeat(512)}`, '%'.repeat(512)])
      expect(parseGrantTransactionHash(bad)).toBeNull()
  })
  it('keeps the grant route, transaction and contract together on a fresh HTTPS origin', () => {
    const url = new URL(grantEvidenceUrl('https://demo.example', '/', tx.hash, terms.contract))
    expect(url.origin).toBe('https://demo.example')
    expect(url.searchParams.get('mode')).toBe('grant-split')
    expect(url.searchParams.get('tx')).toBe(tx.hash)
    expect(url.searchParams.get('contract')).toBe(terms.contract)
  })
  it('confirms only the exact canonical call, split event and two ERC-20 transfers', () => {
    expect(classifyGrantPublicEvidence(baseline)).toEqual({ status: 'confirmed', findings: [], rpcChainId: terms.chainId, blockNumber: 12n, checkedAt: 123, verifiedAt: 123 })
  })
  it('never infers success from absent, pending, failed or contradictory RPC data', () => {
    expect(status({ transaction: null, receipt: null })).toBe('unavailable')
    expect(status({ receipt: null })).toBe('pending')
    expect(status({ receipt: { ...receipt, status: 'reverted' } })).toBe('failed')
    expect(status({ transaction: null })).toBe('inconsistent')
    expect(status({ blockBefore: null })).toBe('unavailable')
  })
  it('rejects wrong chain, code, token, amount and canonical block', () => {
    for (const change of [
      { rpcChainId: 5042 }, { codeHash: hash('e') }, { codeHashAtBlock: hash('e') }, { currentCodeHash: hash('e') },
      { terms: { ...terms, token: addr('5') } }, { terms: { ...terms, amountB: 300_000n } },
      { blockAfter: { ...block, hash: hash('d') } }, { blockAfter: { ...block, transactions: [hash('d')] } },
    ]) expect(status(change)).toBe('inconsistent')
  })
  it('rejects fabricated, reordered, duplicated and partial event evidence', () => {
    const bad = (logs: TransactionReceipt['logs']) => status({ receipt: { ...receipt, logs } })
    for (const logs of [
      receipt.logs.slice(0, 2), receipt.logs.slice(1), [receipt.logs[0], receipt.logs[0], receipt.logs[2]],
      [receipt.logs[2], receipt.logs[0], receipt.logs[1]],
      ...(['transactionHash', 'blockHash', 'blockNumber', 'transactionIndex', 'removed', 'logIndex'] as const).map((field) =>
        receipt.logs.map((log, i) => i === 0 ? { ...log, [field]: ({ transactionHash: hash('d'), blockHash: hash('d'), blockNumber: 13n, transactionIndex: 1, removed: true, logIndex: 2 })[field] } : log)),
      receipt.logs.map((log, i) => ({ ...log, logIndex: i + (i === 0 ? 0 : 1) })),
      receipt.logs.map((log, i) => i === 1 ? { ...log, logIndex: undefined } : log),
      [receipt.logs[0], transfer(addr('5'), terms.amountB, 1), receipt.logs[2]],
      [receipt.logs[0], transfer(terms.recipientB, 300_000n, 1), receipt.logs[2]],
      [receipt.logs[0], { ...receipt.logs[1], address: addr('5') }, receipt.logs[2]],
      [receipt.logs[0], { ...receipt.logs[1], topics: [] }, receipt.logs[2]],
    ]) expect(bad(logs as TransactionReceipt['logs'])).toBe('inconsistent')
  })
  it('rejects altered payer, calldata, native value and receipt index', () => {
    for (const change of [
      { transaction: { ...tx, from: addr('5') } }, { transaction: { ...tx, input: '0x' as Hex } }, { transaction: { ...tx, value: 1n } },
      { receipt: { ...receipt, transactionHash: hash('d') } }, { receipt: { ...receipt, transactionIndex: 9 } },
    ]) expect(status(change)).toBe('inconsistent')
  })
  it('rechecks the canonical block and bytecode on every RPC read', async () => {
    const input = { terms, hash: tx.hash, expectedChainId: terms.chainId, expectedToken: terms.token, codeHash, expectedCodeHash: codeHash }
    expect((await readGrantPublicEvidence(reader(), input, () => 456)).status).toBe('confirmed')
    let reads = 0
    expect((await readGrantPublicEvidence(reader({ getBlock: () => Promise.resolve(++reads === 1 ? block : { ...block, hash: hash('d') }) }), input)).status).toBe('inconsistent')
    expect((await readGrantPublicEvidence(reader({ getBytecode: () => Promise.resolve(null) }), input)).status).toBe('inconsistent')
    expect((await readGrantPublicEvidence(reader({ getReceipt: () => Promise.resolve(null) }), input)).status).toBe('pending')
    expect((await readGrantPublicEvidence(reader({ getTransaction: () => Promise.reject(new Error('stale RPC')) }), input)).status).toBe('unavailable')
    const confirmed = await readGrantPublicEvidence(reader(), input, () => 456)
    const refreshed = await readGrantPublicEvidence(reader({ getReceipt: () => Promise.reject(new Error('RPC outage')) }), input, () => 789)
    expect(confirmed.status).toBe('confirmed')
    expect(refreshed).toMatchObject({ status: 'unavailable', checkedAt: 789 })
    expect(refreshed.verifiedAt).toBeUndefined()
  })
  it('invalidates a previously confirmed result when its evidence key changes', () => {
    const confirmed = classifyGrantPublicEvidence(baseline)
    expect(visibleGrantEvidence({ key: 'revision-1', result: confirmed }, 'revision-2')).toBeNull()
    expect(visibleGrantEvidence({ key: 'revision-1', result: confirmed }, 'revision-1')).toEqual(confirmed)
  })
  it('invalidates confirmation synchronously when the RPC client is replaced', () => {
    const first = {}
    const second = {}
    const confirmed = classifyGrantPublicEvidence(baseline)
    const firstKey = evidenceClientIdentity(first)
    expect(evidenceClientIdentity(first)).toBe(firstKey)
    expect(evidenceClientIdentity(second)).not.toBe(firstKey)
    expect(visibleGrantEvidence({ key: firstKey, result: confirmed }, evidenceClientIdentity(second))).toBeNull()
    expect(visibleGrantEvidence({ key: firstKey, result: confirmed }, evidenceClientIdentity(undefined))).toBeNull()
  })
})
