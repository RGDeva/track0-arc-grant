import { keccak256, type Address, type Block, type Hex, type PublicClient, type Transaction, type TransactionReceipt } from 'viem'
import { validateGrantSplitTerms, verifyGrantSplitEvidence, type GrantSplitTerms } from './grantSplitProtocol'

export type PublicEvidenceStatus = 'pending' | 'failed' | 'confirmed' | 'inconsistent' | 'unavailable'
export interface PublicEvidenceResult {
  status: PublicEvidenceStatus
  findings: string[]
  rpcChainId?: number
  blockNumber?: bigint
  checkedAt: number
  verifiedAt?: number
}

/** A URL carries only a transaction identity, never payment facts or a receipt. */
export function parseGrantTransactionHash(value: string | null): Hex | null {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as Hex : null
}

const eq = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
/** Keep the grant route and verified contract bound to the transaction locator. */
export function grantEvidenceUrl(origin: string, pathname: string, hash: Hex, contract: Address): string {
  const url = new URL(pathname, origin)
  url.searchParams.set('mode', 'grant-split')
  url.searchParams.set('tx', hash)
  url.searchParams.set('contract', contract)
  return url.toString()
}
const hasBlockIdentity = (block: Block | null, receipt: TransactionReceipt) =>
  !!block && eq(block.hash, receipt.blockHash) && block.number === receipt.blockNumber

export interface GrantPublicEvidenceInput {
  terms: GrantSplitTerms
  hash: Hex
  rpcChainId: number
  expectedChainId: number
  expectedToken: Address
  codeHash: Hex | null
  codeHashAtBlock: Hex | null
  currentCodeHash: Hex | null
  expectedCodeHash: Hex | null
  transaction: Transaction | null
  receipt: TransactionReceipt | null
  blockBefore: Block | null
  blockAfter: Block | null
  checkedAt: number
}

/** Classify RPC facts; every missing, contradictory, or malformed path is unconfirmed. */
export function classifyGrantPublicEvidence(input: GrantPublicEvidenceInput): PublicEvidenceResult {
  const { terms, hash, rpcChainId, expectedChainId, expectedToken, codeHash, codeHashAtBlock,
    currentCodeHash, expectedCodeHash, transaction, receipt, blockBefore, blockAfter, checkedAt } = input
  const base = { rpcChainId, checkedAt }
  try {
    const findings = validateGrantSplitTerms({ ...terms, executed: false }, expectedChainId, expectedToken)
    if (rpcChainId !== expectedChainId) findings.push('RPC is on the wrong chain')
    if (!expectedCodeHash || !codeHash || !eq(codeHash, expectedCodeHash)) {
      findings.push('Reviewed deployed runtime bytecode hash is missing or mismatched')
    }
    if (findings.length) return { ...base, status: 'inconsistent', findings }
    if (!transaction && receipt) return { ...base, status: 'inconsistent', findings: ['Receipt exists without its transaction'] }
    if (!transaction) return { ...base, status: 'unavailable', findings: ['Transaction is not available on the selected Arc network'] }
    if (!receipt) return { ...base, status: 'pending', findings: ['Transaction has no receipt'] }
    if (typeof receipt.blockNumber !== 'bigint' || receipt.blockNumber < 0n || !eq(receipt.transactionHash, hash)) {
      return { ...base, status: 'inconsistent', findings: ['Malformed receipt identity'] }
    }
    if (!blockBefore || !blockAfter) return { ...base, status: 'unavailable', findings: ['Containing block is unavailable'] }
    const blockFindings: string[] = []
    if (!hasBlockIdentity(blockBefore, receipt) || !hasBlockIdentity(blockAfter, receipt) ||
        !eq(blockBefore.hash, blockAfter.hash) || blockBefore.number !== blockAfter.number) {
      blockFindings.push('Containing block changed or contradicts the receipt')
    }
    if (!Number.isSafeInteger(receipt.transactionIndex) || receipt.transactionIndex < 0 ||
        !Array.isArray(blockBefore.transactions) || !eq(blockBefore.transactions[receipt.transactionIndex], hash) ||
        !Array.isArray(blockAfter.transactions) || !eq(blockAfter.transactions[receipt.transactionIndex], hash)) {
      blockFindings.push('Transaction is absent at the claimed canonical block index')
    }
    if (blockFindings.length) return { ...base, status: 'inconsistent', findings: blockFindings }
    if (!codeHashAtBlock || !currentCodeHash || !eq(codeHashAtBlock, expectedCodeHash) || !eq(currentCodeHash, expectedCodeHash)) {
      return { ...base, status: 'inconsistent', findings: ['Deployed bytecode changed or differs from the reviewed runtime hash'], blockNumber: receipt.blockNumber }
    }
    if (receipt.status === 'reverted') {
      const failedFindings: string[] = []
      if (!eq(transaction.hash, hash) || !eq(transaction.blockHash, receipt.blockHash) || transaction.blockNumber !== receipt.blockNumber ||
          transaction.transactionIndex !== receipt.transactionIndex || !eq(transaction.from, terms.payer) || !eq(transaction.to, terms.contract) ||
          !eq(receipt.from, terms.payer) || !eq(receipt.to, terms.contract) || transaction.chainId !== expectedChainId) {
        failedFindings.push('Failed transaction identity is inconsistent')
      }
      return failedFindings.length
        ? { ...base, status: 'inconsistent', findings: failedFindings, blockNumber: receipt.blockNumber }
        : { ...base, status: 'failed', findings: ['Transaction reverted; no payment confirmed'], blockNumber: receipt.blockNumber }
    }
    const receiptFindings = verifyGrantSplitEvidence(terms, hash, transaction, receipt)
    if (receiptFindings.length) return { ...base, status: 'inconsistent', findings: receiptFindings, blockNumber: receipt.blockNumber }
    return { ...base, status: 'confirmed', findings: [], blockNumber: receipt.blockNumber, verifiedAt: checkedAt }
  } catch {
    return { ...base, status: 'inconsistent', findings: ['Malformed RPC evidence'] }
  }
}

export interface GrantEvidenceReader {
  getChainId(): Promise<number>
  getTransaction(hash: Hex): Promise<Transaction | null>
  getReceipt(hash: Hex): Promise<TransactionReceipt | null>
  getBlock(number: bigint): Promise<Block | null>
  getBytecode(address: Address, blockNumber?: bigint): Promise<Hex | null>
}

const clientIds = new WeakMap<object, number>()
let nextClientId = 0
/** A replacement RPC client invalidates visible evidence before its first response. */
export function evidenceClientIdentity(client: object | undefined): string {
  if (!client) return 'no-rpc-client'
  let id = clientIds.get(client)
  if (id === undefined) { id = ++nextClientId; clientIds.set(client, id) }
  return `rpc-client-${id}`
}

/** Shared by public display and post-submit recovery: one set of RPC reading rules. */
export function grantEvidenceReader(client: PublicClient): GrantEvidenceReader {
  return {
    getChainId: () => client.getChainId(),
    getTransaction: (hash) => client.getTransaction({ hash }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'TransactionNotFoundError') return null
      throw error
    }),
    getReceipt: (hash) => client.getTransactionReceipt({ hash }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null
      throw error
    }),
    getBlock: (number) => client.getBlock({ blockNumber: number, includeTransactions: false }),
    getBytecode: (address, blockNumber) => client.getBytecode({ address, ...(blockNumber === undefined ? {} : { blockNumber }) }).then((code) => code ?? null),
  }
}

/** Read the canonical block by number twice, bracketing code reads, to detect a changed chain view. */
export async function readGrantPublicEvidence(reader: GrantEvidenceReader, input: {
  terms: GrantSplitTerms
  hash: Hex
  expectedChainId: number
  expectedToken: Address
  codeHash: Hex | null
  expectedCodeHash: Hex | null
}, now: () => number = Date.now): Promise<PublicEvidenceResult> {
  const checkedAt = now()
  try {
    const rpcChainId = await reader.getChainId()
    const [transaction, receipt] = await Promise.all([reader.getTransaction(input.hash), reader.getReceipt(input.hash)])
    let blockBefore: Block | null = null
    let blockAfter: Block | null = null
    let codeHashAtBlock: Hex | null = null
    let currentCodeHash: Hex | null = null
    if (receipt && typeof receipt.blockNumber === 'bigint' && receipt.blockNumber >= 0n) {
      blockBefore = await reader.getBlock(receipt.blockNumber)
      const [blockCode, currentCode] = await Promise.all([
        reader.getBytecode(input.terms.contract, receipt.blockNumber),
        reader.getBytecode(input.terms.contract),
      ])
      codeHashAtBlock = blockCode && /^0x(?:[0-9a-fA-F]{2})+$/.test(blockCode) ? keccak256(blockCode) : null
      currentCodeHash = currentCode && /^0x(?:[0-9a-fA-F]{2})+$/.test(currentCode) ? keccak256(currentCode) : null
      blockAfter = await reader.getBlock(receipt.blockNumber)
    }
    return classifyGrantPublicEvidence({ ...input, rpcChainId, transaction, receipt, blockBefore, blockAfter,
      codeHashAtBlock, currentCodeHash, checkedAt })
  } catch {
    return { status: 'unavailable', findings: ['RPC evidence is unavailable; do not infer success or retry payment'], checkedAt }
  }
}

/** A refresh invalidates prior success immediately, before new asynchronous RPC reads finish. */
export function visibleGrantEvidence(state: { key: string; result: PublicEvidenceResult } | null, key: string): PublicEvidenceResult | null {
  return state?.key === key ? state.result : null
}
