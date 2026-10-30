/* oxlint-disable typescript/require-await -- Promise-returning mock RPC methods have no asynchronous work. */
import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256,
  type Address, type Block, type Hex, type PublicClient, type Transaction, type TransactionReceipt } from 'viem'
import { GRANT_RUNTIME_TEMPLATE } from './frozenGrantSplitArtifact'
import { grantSplitAbi } from './grantSplitProtocol'
import { MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_TOTAL, MAINNET_GRANT_USDC, MAINNET_PROPOSED_DEMO_ID,
  MAINNET_PROPOSED_ROLES } from './grantMainnetCandidate'
import { assertMainnetSubmissionDisabled, beginMainnetAttempt, prepareMainnetRequest, readMainnetJournal,
  reconcileMainnetAttempt, saveMainnetJournal, transitionMainnetAttempt, validateMainnetTerms,
  type MainnetJournal, type MainnetStorage, type MainnetTerms } from './mainnetWalletWorkflow'

const h = (digit: string): Hex => `0x${digit.repeat(64)}`
const terms: MainnetTerms = { payer: MAINNET_PROPOSED_ROLES.payer, artist: MAINNET_PROPOSED_ROLES.artist,
  producer: MAINNET_PROPOSED_ROLES.producer, demoId: MAINNET_PROPOSED_DEMO_ID }
const contract = '0x4444444444444444444444444444444444444444' as Address
const caps = { gasLimit: 510_000n, maxFeePerGas: 40_000_000_000n }
const storage = (): MainnetStorage => { const data = new Map<string, string>(); return {
  getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) },
} }
const base = (): MainnetJournal => ({ version: 1, chainId: MAINNET_GRANT_CHAIN_ID, terms })
const verified = (): MainnetJournal => ({ ...base(), contract, runtimeHash: keccak256(GRANT_RUNTIME_TEMPLATE),
  deploy: { state: 'confirmed', hash: h('a'), at: 1, history: [] } })
const deployRequest = prepareMainnetRequest('deploy', terms, null, caps, 1n)
const deploymentTx = { hash: h('a'), from: terms.payer, to: null, input: deployRequest.data,
  chainId: 5042, value: 0n, blockHash: h('e'), blockNumber: 9n, transactionIndex: 0 } as unknown as Transaction
const deploymentReceipt = { status: 'success', transactionHash: h('a'), from: terms.payer, to: null,
  contractAddress: contract, blockHash: h('e'), blockNumber: 9n, transactionIndex: 0 } as unknown as TransactionReceipt
const deploymentBlock = { hash: h('e'), number: 9n, transactions: [h('a')] } as Block
function withDeployment(mock: PublicClient): PublicClient {
  return { ...mock,
    getTransaction: async ({ hash }: { hash: Hex }) => hash === h('a') ? deploymentTx : mock.getTransaction({ hash }),
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => hash === h('a') ? deploymentReceipt : mock.getTransactionReceipt({ hash }),
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => blockNumber === 9n ? deploymentBlock : mock.getBlock({ blockNumber, includeTransactions: false }),
  } as unknown as PublicClient
}

describe('fail-closed Mainnet wallet candidate', () => {
  it('prepares only exact frozen transactions without a sender', () => {
    const deploy = prepareMainnetRequest('deploy', terms, null, caps, 1_000_000_000n)
    expect(deploy).toMatchObject({ from: terms.payer, chainId: 5042, to: undefined, value: 0n,
      gas: 510_000n, maxFeePerGas: 40_000_000_000n })
    expect(deploy.data).toMatch(/^0x[\da-f]+$/i)
    const approve = prepareMainnetRequest('approve', terms, verified(), caps, 1_000_000_000n)
    expect(approve.to).toBe(MAINNET_GRANT_USDC)
    expect(approve.data).toBe('0x095ea7b3' + contract.slice(2).padStart(64, '0') + MAINNET_GRANT_TOTAL.toString(16).padStart(64, '0'))
    const execution = prepareMainnetRequest('execute', terms, { ...verified(), approve: { state: 'confirmed', hash: h('b'), at: 2, history: [] } }, caps, 1_000_000_000n)
    expect(execution.to).toBe(contract)
    expect(execution.data).toBe('0x61461954')
    expect(() => assertMainnetSubmissionDisabled()).toThrow('Unreviewed Mainnet activation state')
  })
  it('rejects wrong identities, unlimited fees, unverified contracts and repeats', () => {
    expect(validateMainnetTerms({ ...terms, artist: terms.payer })).not.toEqual([])
    expect(() => prepareMainnetRequest('deploy', { ...terms, demoId: h('0') }, null, caps, 1n)).toThrow()
    expect(() => prepareMainnetRequest('deploy', terms, null, caps, caps.maxFeePerGas + 1n)).toThrow()
    expect(() => prepareMainnetRequest('approve', terms, null, caps, 1n)).toThrow()
    expect(() => prepareMainnetRequest('execute', terms, verified(), caps, 1n)).toThrow()
    expect(() => prepareMainnetRequest('deploy', terms, verified(), caps, 1n)).toThrow()
    expect(() => prepareMainnetRequest('execute', terms, { ...verified(), approve: { state: 'confirmed', hash: h('b'), at: 2, history: [] },
      execute: { state: 'unknown', at: 3, history: [] } }, caps, 1n)).toThrow()
  })
  it('persists UNKNOWN across refresh, rejects altered terms and never demotes CONFIRMED', () => {
    const db = storage()
    const started = beginMainnetAttempt(db, base(), 'deploy', 1)
    expect(() => beginMainnetAttempt(db, started, 'deploy', 2)).toThrow('never retry')
    const unknown = transitionMainnetAttempt(db, started, 'deploy', 'unknown', 3)
    expect(readMainnetJournal(db, terms)?.deploy?.state).toBe('unknown')
    expect(() => readMainnetJournal(db, { ...terms, artist: terms.producer })).toThrow()
    const located = transitionMainnetAttempt(db, unknown, 'deploy', 'submitted', 4, h('a'))
    const confirmed = transitionMainnetAttempt(db, located, 'deploy', 'confirmed', 5, h('a'))
    expect(transitionMainnetAttempt(db, unknown, 'deploy', 'unknown', 6, h('a')).deploy?.state).toBe('confirmed')
    expect(confirmed.deploy?.history.map((event) => event.state)).toEqual(['authorizing', 'unknown', 'submitted'])
    expect(() => transitionMainnetAttempt(db, confirmed, 'deploy', 'confirmed', 7, h('b'))).toThrow('cannot change')
    expect(() => beginMainnetAttempt(db, confirmed, 'approve', 8)).toThrow('Verified deployment')
  })
  it('never treats a pending or unavailable transaction as a verified deployment', async () => {
    const journal = { ...base(), deploy: { state: 'submitted' as const, hash: h('a'), at: 1, history: [] } }
    const client = { getChainId: async () => 5042, getTransaction: async () => null, getTransactionReceipt: async () => null } as unknown as PublicClient
    expect((await reconcileMainnetAttempt(client, journal, 'deploy')).status).toBe('unknown')
    expect((await reconcileMainnetAttempt({ ...client, getChainId: async () => 5042002 }, journal, 'deploy')).status).toBe('unknown')
  })
  it('checks Mainnet canonical deployment, frozen code and exact constructor', async () => {
    const txHash = h('a'), blockHash = h('b')
    const deploy = prepareMainnetRequest('deploy', terms, null, caps, 1n)
    const transaction = { hash: txHash, from: terms.payer, to: null, input: deploy.data, chainId: 5042, value: 0n,
      nonce: 0, type: 'eip1559', gas: 500_000n, maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 5_000_000_000n,
      blockHash, blockNumber: 9n, transactionIndex: 0 } as Transaction
    const receipt = { status: 'success', transactionHash: txHash, from: terms.payer, to: null,
      contractAddress: contract, blockHash, blockNumber: 9n, transactionIndex: 0 } as TransactionReceipt
    const block = { hash: blockHash, number: 9n, transactions: [txHash] } as Block
    const mock = { getChainId: async () => 5042, getTransaction: async () => transaction,
      getTransactionReceipt: async () => receipt, getBlock: async () => block, getBytecode: async () => GRANT_RUNTIME_TEMPLATE } as unknown as PublicClient
    const journal = { ...base(), deploy: { state: 'submitted' as const, hash: txHash, at: 1, history: [],
      reviewedNonce: 0, reviewedGasLimit: '510000', reviewedMaxFee: '40000000000', reviewedPriorityFee: '5000000000' } }
    expect(await reconcileMainnetAttempt(mock, journal, 'deploy')).toMatchObject({ status: 'confirmed', contract })
    expect((await reconcileMainnetAttempt({ ...mock, getTransaction: async () => ({ ...transaction, gas: 510_001n }) } as PublicClient, journal, 'deploy')).status).toBe('unknown')
    const bad = { ...mock, getTransaction: async () => ({ ...transaction, input: '0x' }) } as PublicClient
    expect((await reconcileMainnetAttempt(bad, journal, 'deploy')).status).toBe('unknown')
    expect((await reconcileMainnetAttempt({ ...mock, getBytecode: async () => '0x6001' }, journal, 'deploy')).status).toBe('unknown')
  })
  it('rejects a mismatched approval and requires exact current allowance', async () => {
    const journal = { ...verified(), approve: { state: 'submitted' as const, hash: h('c'), at: 2, history: [] } }
    const request = prepareMainnetRequest('approve', terms, verified(), caps, 1n)
    const transaction = { hash: h('c'), from: terms.payer, to: MAINNET_GRANT_USDC, input: request.data,
      chainId: 5042, value: 0n, blockHash: h('b'), blockNumber: 10n, transactionIndex: 0 } as unknown as Transaction
    const receipt = { status: 'success', transactionHash: h('c'), from: terms.payer, to: MAINNET_GRANT_USDC,
      blockHash: h('b'), blockNumber: 10n, transactionIndex: 0 } as unknown as TransactionReceipt
    const block = { hash: h('b'), number: 10n, transactions: [h('c')] } as Block
    const mock = { getChainId: async () => 5042, getTransaction: async () => transaction,
      getTransactionReceipt: async () => receipt, getBlock: async () => block,
      getBytecode: async () => GRANT_RUNTIME_TEMPLATE, readContract: async () => 300_000n } as unknown as PublicClient
    expect((await reconcileMainnetAttempt(withDeployment(mock), journal, 'approve')).status).toBe('confirmed')
    expect((await reconcileMainnetAttempt(withDeployment({ ...mock, readContract: async () => 0n } as PublicClient), journal, 'approve')).status).toBe('unknown')
    expect((await reconcileMainnetAttempt(withDeployment({ ...mock, getTransaction: async () => ({ ...transaction, input: '0x' }) } as PublicClient), journal, 'approve')).status).toBe('unknown')
    const approvalEvent = { address: MAINNET_GRANT_USDC, transactionHash: h('c'), blockHash: h('b'),
      blockNumber: 10n, transactionIndex: 0, logIndex: 0, removed: false,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Approval', args: { owner: terms.payer, spender: contract } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [300_000n]) }
    const afterExecution = { ...journal, execute: { state: 'submitted' as const, hash: h('d'), at: 3, history: [] } }
    const consumed = { ...mock, getTransactionReceipt: async () => ({ ...receipt, logs: [approvalEvent] }), readContract: async () => 0n } as PublicClient
    expect((await reconcileMainnetAttempt(withDeployment(consumed), afterExecution, 'approve')).status).toBe('confirmed')
    expect((await reconcileMainnetAttempt(withDeployment({ ...consumed, getTransactionReceipt: async () => ({ ...receipt, logs: [] }) }), afterExecution, 'approve')).status).toBe('unknown')
    const badReceipt = { ...receipt, logs: [{ ...approvalEvent, transactionHash: h('f') }] } as unknown as TransactionReceipt
    expect((await reconcileMainnetAttempt(withDeployment({ ...consumed, getTransactionReceipt: async () => badReceipt }), afterExecution, 'approve')).status).toBe('unknown')
  })
  it('requires the exact Mainnet split and two ordered USDC transfers', async () => {
    const journal = { ...verified(), approve: { state: 'confirmed' as const, hash: h('c'), at: 2, history: [] },
      execute: { state: 'submitted' as const, hash: h('d'), at: 3, history: [] } }
    const tx = { hash: h('d'), from: terms.payer, to: contract, input: '0x61461954', chainId: 5042, value: 0n,
      blockHash: h('b'), blockNumber: 11n, transactionIndex: 0 } as unknown as Transaction
    const meta = (logIndex: number) => ({ transactionHash: h('d'), blockHash: h('b'), blockNumber: 11n, transactionIndex: 0, logIndex, removed: false })
    const transfer = (to: Address, amount: bigint, index: number) => ({ ...meta(index), address: MAINNET_GRANT_USDC,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: terms.payer, to } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [amount]) })
    const split = { ...meta(2), address: contract,
      topics: encodeEventTopics({ abi: grantSplitAbi, eventName: 'DemoSplitExecuted',
        args: { demoId: terms.demoId, payer: terms.payer, token: MAINNET_GRANT_USDC } }),
      data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
        [terms.artist, 100_000n, terms.producer, 200_000n]) }
    const receipt = { status: 'success', transactionHash: h('d'), from: terms.payer, to: contract,
      blockHash: h('b'), blockNumber: 11n, transactionIndex: 0,
      logs: [transfer(terms.artist, 100_000n, 0), transfer(terms.producer, 200_000n, 1), split] } as unknown as TransactionReceipt
    const block = { hash: h('b'), number: 11n, transactions: [h('d')] } as Block
    const names = ['payer', 'recipientA', 'recipientB', 'amountA', 'amountB', 'chainId', 'demoId', 'executed', 'USDC']
    const values = [terms.payer, terms.artist, terms.producer, 100_000n, 200_000n, 5042n, terms.demoId, true, MAINNET_GRANT_USDC]
    const approvalRequest = prepareMainnetRequest('approve', terms, verified(), caps, 1n)
    const approvalTx = { hash: h('c'), from: terms.payer, to: MAINNET_GRANT_USDC, input: approvalRequest.data,
      chainId: 5042, value: 0n, blockHash: h('f'), blockNumber: 10n, transactionIndex: 0 } as unknown as Transaction
    const approvalLog = { address: MAINNET_GRANT_USDC, transactionHash: h('c'), blockHash: h('f'), blockNumber: 10n,
      transactionIndex: 0, logIndex: 0, removed: false,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Approval', args: { owner: terms.payer, spender: contract } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [300_000n]) }
    const approvalReceipt = { status: 'success', transactionHash: h('c'), from: terms.payer, to: MAINNET_GRANT_USDC,
      blockHash: h('f'), blockNumber: 10n, transactionIndex: 0, logs: [approvalLog] } as unknown as TransactionReceipt
    const approvalBlock = { hash: h('f'), number: 10n, transactions: [h('c')] } as Block
    const mock = { getChainId: async () => 5042, getTransaction: async ({ hash }: { hash: Hex }) => hash === h('c') ? approvalTx : tx,
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => hash === h('c') ? approvalReceipt : receipt,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => blockNumber === 10n ? approvalBlock : block,
      getBytecode: async () => GRANT_RUNTIME_TEMPLATE,
      readContract: async ({ functionName }: { functionName: string }) => functionName === 'allowance' ? 0n : values[names.indexOf(functionName)] } as unknown as PublicClient
    expect((await reconcileMainnetAttempt(withDeployment(mock), journal, 'execute')).status).toBe('confirmed')
    expect((await reconcileMainnetAttempt(withDeployment({ ...mock, getTransactionReceipt: async ({ hash }: { hash: Hex }) =>
      hash === h('c') ? approvalReceipt : { ...receipt, logs: receipt.logs.slice(0, 2) } }), journal, 'execute')).status).toBe('unknown')
    expect((await reconcileMainnetAttempt(withDeployment({ ...mock, getTransaction: async ({ hash }: { hash: Hex }) =>
      hash === h('c') ? approvalTx : { ...tx, chainId: 5042002 } } as PublicClient), journal, 'execute')).status).toBe('unknown')
  })
  it('rejects malformed recovery records without falling back to a fresh attempt', () => {
    const db = storage()
    saveMainnetJournal(db, verified())
    expect(readMainnetJournal(db, terms)?.contract).toBe(contract)
    const bad: MainnetStorage = { getItem: () => '{', setItem: () => undefined }
    expect(() => readMainnetJournal(bad, terms)).toThrow('Malformed')
  })
})
