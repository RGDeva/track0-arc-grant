/* oxlint-disable typescript/require-await -- Deterministic in-memory RPC fixtures return promises. */
import { describe, expect, it, vi } from 'vitest'
import { keccak256, type Hex, type PublicClient } from 'viem'

vi.mock('./grantMainnetCandidate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./grantMainnetCandidate')>()
  const ceilings = { deploy: { gasLimit: 510_000n, maxFeePerGas: 40_000_000_000n },
    approve: { gasLimit: 71_000n, maxFeePerGas: 40_000_000_000n },
    execute: { gasLimit: 205_000n, maxFeePerGas: 40_000_000_000n } }
  return { ...actual, MAINNET_GRANT_WRITES_HARD_DISABLED: false,
    MAINNET_GRANT_IDENTITY: { payer: actual.MAINNET_PROPOSED_ROLES.payer, recipientA: actual.MAINNET_PROPOSED_ROLES.artist,
      recipientB: actual.MAINNET_PROPOSED_ROLES.producer, demoId: actual.MAINNET_PROPOSED_DEMO_ID },
    MAINNET_GRANT_RELEASE: { reviewBasis: { kind: 'independent_human', reference: 'test',
      sourceCommit: '1fc92860b9ec346b3b462d100e562112400b48d1',
      deploymentDataSha256: '0xb1ff3f460f34f6832eea6393ef68413a6c1cd30d00ceba2d508e7d56b500a6b8' },
      ownerActivationReference: 'test', payerControlReference: 'test', ownerRoleConfirmationReference: 'test', ceilings } }
})
vi.mock('./mainnetWalletWorkflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mainnetWalletWorkflow')>()
  return { ...actual, reconcileMainnetAttempt: async (_client: unknown, journal: { approve?: { state: string } }, stage: string) =>
    stage === 'deploy' ? { status: 'confirmed', findings: [], contract: '0x4444444444444444444444444444444444444444',
      runtimeHash: keccak256((await import('./frozenGrantSplitArtifact')).GRANT_RUNTIME_TEMPLATE) }
      : stage === 'approve' && journal.approve?.state === 'confirmed' ? { status: 'confirmed', findings: [] }
        : { status: 'unknown', findings: ['receipt pending'] } }
})

import { MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_RELEASE, MAINNET_GRANT_USDC,
  MAINNET_PROPOSED_DEMO_ID, MAINNET_PROPOSED_ROLES, type MainnetReviewFacts, type MainnetStep } from './grantMainnetCandidate'
import { GRANT_RUNTIME_TEMPLATE } from './frozenGrantSplitArtifact'
import { mainnetReviewFingerprint, submitReviewedMainnetStep, type MainnetSenderPorts,
  type MainnetSubmissionReview } from './mainnetSender'
import { prepareMainnetRequest, readMainnetJournal, saveMainnetJournal, type MainnetPreparedRequest, type MainnetJournal,
  type MainnetStorage } from './mainnetWalletWorkflow'

const contract = '0x4444444444444444444444444444444444444444' as const
const terms = { payer: MAINNET_PROPOSED_ROLES.payer, artist: MAINNET_PROPOSED_ROLES.artist,
  producer: MAINNET_PROPOSED_ROLES.producer, demoId: MAINNET_PROPOSED_DEMO_ID }
const txHash: Hex = `0x${'b'.repeat(64)}`

function fixture(step: 'approve' | 'execute') {
  const records = new Map<string, string>()
  const storage: MainnetStorage = { getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => { records.set(key, value) } }
  const journal: MainnetJournal = { version: 1, chainId: MAINNET_GRANT_CHAIN_ID, terms,
    contract, runtimeHash: keccak256(GRANT_RUNTIME_TEMPLATE),
    deploy: { state: 'confirmed', hash: `0x${'a'.repeat(64)}`, at: 1, history: [] },
    ...(step === 'execute' ? { approve: { state: 'confirmed' as const, hash: `0x${'c'.repeat(64)}`, at: 2, history: [] } } : {}) }
  saveMainnetJournal(storage, journal)
  const allowance = step === 'execute' ? 300_000n : 0n
  const facts: MainnetReviewFacts = { chainId: 5042, walletChainId: 5042, payer: terms.payer, demoId: terms.demoId,
    tokenDecimals: 6, tokenBalance: 2_000_000n, nativeBalance: 2_000_000_000_000_000_000n,
    allowance, latestNonce: 1, pendingNonce: 1, estimatedGas: step === 'execute' ? 150_000n : 50_000n,
    quotedMaxFeePerGas: 29_000_000_000n, baseFeePerGas: 20_000_000_000n, priorityFeePerGas: 5_000_000_000n,
    contract, runtimeCode: GRANT_RUNTIME_TEMPLATE, reviewedRuntimeHash: journal.runtimeHash!,
    contractTermsMatch: true, executed: false, priorAttemptUnresolved: false,
    ceilings: MAINNET_GRANT_RELEASE.ceilings }
  const request = prepareMainnetRequest(step, terms, journal, facts.ceilings[step]!, facts.priorityFeePerGas!)
  const body = { step, terms, facts, request, nonce: 1, aggregateMaximum: 331_440_000_000_000_000n }
  const review: MainnetSubmissionReview = { ...body, fingerprint: mainnetReviewFingerprint(body) }
  const names = ['payer', 'recipientA', 'recipientB', 'amountA', 'amountB', 'chainId', 'demoId', 'executed', 'USDC']
  const values = [terms.payer, terms.artist, terms.producer, 100_000n, 200_000n, 5042n, terms.demoId, false, MAINNET_GRANT_USDC]
  const client = { getChainId: async () => 5042, getBalance: async () => 2_000_000_000_000_000_000n,
    getTransactionCount: async () => 1,
    getTransaction: async () => null,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 29_000_000_000n, maxPriorityFeePerGas: 5_000_000_000n }),
    getBlock: async () => ({ baseFeePerGas: 20_000_000_000n }),
    estimateContractGas: async () => facts.estimatedGas,
    getBytecode: async () => GRANT_RUNTIME_TEMPLATE,
    readContract: async ({ functionName }: { functionName: string }) => functionName === 'decimals' ? 6 :
      functionName === 'balanceOf' ? 2_000_000n : functionName === 'allowance' ? allowance : values[names.indexOf(functionName)] } as unknown as PublicClient
  const send = vi.fn(async (_request: MainnetPreparedRequest & { nonce: number }) => txHash)
  const ports: MainnetSenderPorts = { client, storage, now: () => 3,
    withOriginLock: async (_key, action) => action(),
    wallet: { providerId: 'io.metamask', getAddresses: async () => [terms.payer], getChainId: async () => 5042,
      sendTransaction: send } }
  return { ports, review, send, storage, client }
}

describe('Mainnet sender exact stage requests under mocked release', () => {
  for (const step of ['approve', 'execute'] as MainnetStep[]) it(`submits only one exact ${step} request`, async () => {
    const sample = fixture(step as 'approve' | 'execute')
    const result = await submitReviewedMainnetStep(sample.ports, sample.review)
    expect(result.status).toBe('unknown')
    expect(sample.send).toHaveBeenCalledOnce()
    expect(sample.send.mock.calls[0][0]).toMatchObject({ chainId: 5042, from: terms.payer,
      to: step === 'approve' ? MAINNET_GRANT_USDC : contract, data: sample.review.request.data, nonce: 1, value: 0n })
    expect(readMainnetJournal(sample.storage, terms)?.[step]?.state).toBe('unknown')
    await expect(submitReviewedMainnetStep(sample.ports, sample.review)).rejects.toThrow('previous Mainnet attempt is unresolved')
    expect(sample.send).toHaveBeenCalledOnce()
  })
  it('rejects an allowance changed since review before contacting the wallet', async () => {
    const sample = fixture('execute')
    sample.ports.client = { ...sample.client, readContract: async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? 299_999n : sample.client.readContract({ functionName } as never) } as unknown as PublicClient
    await expect(submitReviewedMainnetStep(sample.ports, sample.review)).rejects.toThrow()
    expect(sample.send).not.toHaveBeenCalled()
  })
})
