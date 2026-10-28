import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type Transaction,
  type TransactionReceipt,
} from 'viem'

export const GRANT_WRITES_HARD_DISABLED = false as const
export const GRANT_MAX_TOTAL_BASE_UNITS = 1_000_000n
export const GRANT_AMOUNT_A_BASE_UNITS = 100_000n
export const GRANT_AMOUNT_B_BASE_UNITS = 200_000n
export const grantSplitAbi = parseAbi([
  'function payer() view returns (address)',
  'function recipientA() view returns (address)',
  'function recipientB() view returns (address)',
  'function amountA() view returns (uint256)',
  'function amountB() view returns (uint256)',
  'function chainId() view returns (uint256)',
  'function demoId() view returns (bytes32)',
  'function executed() view returns (bool)',
  'function USDC() view returns (address)',
  'function execute()',
  'event DemoSplitExecuted(bytes32 indexed demoId,address indexed payer,address indexed token,address recipientA,uint256 amountA,address recipientB,uint256 amountB)',
])

export interface GrantSplitTerms {
  contract: Address
  chainId: number
  token: Address
  payer: Address
  recipientA: Address
  recipientB: Address
  amountA: bigint
  amountB: bigint
  demoId: Hex
  executed: boolean
}

const eq = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const zeroAddress = '0x0000000000000000000000000000000000000000'

export function validateGrantSplitTerms(terms: GrantSplitTerms, expectedChainId: number, expectedToken: Address): string[] {
  const problems: string[] = []
  if (terms.chainId !== expectedChainId) problems.push('Wrong contract chain')
  if (expectedChainId !== 5042 && expectedChainId !== 5042002) problems.push('Unsupported Arc chain')
  if (!eq(terms.token, expectedToken)) problems.push('Wrong token')
  if (eq(terms.payer, zeroAddress) || eq(terms.recipientA, zeroAddress) || eq(terms.recipientB, zeroAddress)) problems.push('Zero payer or recipient')
  if (eq(terms.recipientA, terms.payer) || eq(terms.recipientB, terms.payer)) problems.push('Recipient is payer')
  if (eq(terms.recipientA, terms.recipientB)) problems.push('Duplicate recipients')
  if (terms.amountA <= 0n || terms.amountB <= 0n || terms.amountA + terms.amountB > GRANT_MAX_TOTAL_BASE_UNITS) problems.push('Invalid or over-cap amount')
  if (terms.amountA !== GRANT_AMOUNT_A_BASE_UNITS || terms.amountB !== GRANT_AMOUNT_B_BASE_UNITS) problems.push('Unexpected grant split amount')
  if (/^0x0{64}$/i.test(terms.demoId)) problems.push('Empty demo identity')
  if (terms.executed) problems.push('Already executed')
  return problems
}

/** Receipt status alone is insufficient: verify the exact call, event and two USDC transfers. */
export function verifyGrantSplitEvidence(
  terms: GrantSplitTerms,
  submittedHash: Hex,
  transaction: Transaction,
  receipt: TransactionReceipt,
): string[] {
  const problems: string[] = []
  if (receipt.status !== 'success') problems.push('Transaction failed')
  if (!eq(receipt.transactionHash, submittedHash) || !eq(transaction.hash, submittedHash)) problems.push('Transaction hash mismatch')
  if (!transaction.to || !eq(transaction.to, terms.contract) || !eq(transaction.from, terms.payer)) problems.push('Wrong caller or contract')
  if (!receipt.to || !eq(receipt.to, terms.contract) || !eq(receipt.from, terms.payer)) problems.push('Receipt caller or contract mismatch')
  if (transaction.chainId !== terms.chainId) problems.push('Transaction chain mismatch')
  if (transaction.value !== 0n) problems.push('Unexpected native transaction value')
  if (transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber) problems.push('Inconsistent block inclusion')
  if (typeof transaction.transactionIndex !== 'number' || !Number.isSafeInteger(transaction.transactionIndex) || transaction.transactionIndex < 0 ||
      !Number.isSafeInteger(receipt.transactionIndex) || receipt.transactionIndex < 0 ||
      transaction.transactionIndex !== receipt.transactionIndex) problems.push('Transaction index mismatch')
  if (!eq(transaction.input, encodeFunctionData({ abi: grantSplitAbi, functionName: 'execute' }))) problems.push('Wrong contract calldata')

  const executionEvents: Array<Record<string, unknown>> = []
  const transfers: Array<Record<string, unknown>> = []
  const relevantOrder: string[] = []
  let previousLogIndex = -1
  if (!Array.isArray(receipt.logs)) return [...problems, 'Missing receipt logs']
  for (const log of receipt.logs) {
    if (!log || !eq(String(log.transactionHash), receipt.transactionHash) || !eq(String(log.blockHash), receipt.blockHash) ||
        log.blockNumber !== receipt.blockNumber || log.transactionIndex !== receipt.transactionIndex || log.removed !== false) {
      problems.push('Log transaction or block identity mismatch')
    }
    if (!Number.isSafeInteger(log?.logIndex) || log.logIndex < 0 ||
        (previousLogIndex >= 0 && log.logIndex !== previousLogIndex + 1)) {
      problems.push('Invalid or noncanonical log index')
    } else previousLogIndex = log.logIndex
    if (!log || !Array.isArray(log.topics)) { problems.push('Malformed receipt log'); continue }
    if (eq(log.address, terms.contract)) {
      try {
        const decoded = decodeEventLog({ abi: grantSplitAbi, data: log.data, topics: log.topics })
        if (decoded.eventName === 'DemoSplitExecuted') { executionEvents.push(decoded.args); relevantOrder.push('split') }
      } catch { problems.push('Unknown contract event') }
    }
    if (eq(log.address, terms.token)) {
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics })
        if (decoded.eventName === 'Transfer') { transfers.push(decoded.args); relevantOrder.push('transfer') }
      } catch { problems.push('Unknown USDC event') }
    }
  }
  // GrantSplitDemo executes transfer A, then B, and only then emits its own event.
  if (relevantOrder.join(',') !== 'transfer,transfer,split') problems.push('Split and transfer event order mismatch')
  if (executionEvents.length !== 1) problems.push('Expected exactly one split event')
  else {
    const event = executionEvents[0]
    if (!eq(String(event.demoId), terms.demoId) || !eq(String(event.payer), terms.payer) || !eq(String(event.token), terms.token) ||
        !eq(String(event.recipientA), terms.recipientA) || !eq(String(event.recipientB), terms.recipientB) ||
        event.amountA !== terms.amountA || event.amountB !== terms.amountB) problems.push('Split event does not match frozen terms')
  }
  if (transfers.length !== 2) problems.push('Expected exactly two USDC transfers')
  else {
    const matches = (entry: Record<string, unknown>, recipient: Address, amount: bigint) =>
      eq(String(entry.from), terms.payer) && eq(String(entry.to), recipient) && entry.value === amount
    if (!matches(transfers[0], terms.recipientA, terms.amountA) || !matches(transfers[1], terms.recipientB, terms.amountB)) {
      problems.push('USDC transfers do not match frozen terms')
    }
  }
  return problems
}

export function displayGrantAmount(amount: bigint): string {
  const whole = amount / 1_000_000n
  const fractional = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fractional ? `${whole}.${fractional}` : `${whole}`
}

export function asAddress(value: string): Address | null {
  try { return getAddress(value) } catch { return null }
}
