/* oxlint-disable typescript/require-await -- Mock RPC and wallet methods intentionally resolve immediately. */
import { describe, expect, it, vi } from 'vitest'
import { type Address, type Hex, type PublicClient, type Transaction } from 'viem'

vi.mock('./grantMainnetCandidate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./grantMainnetCandidate')>()
  const ceilings = { deploy: { gasLimit: 510_000n, maxFeePerGas: 40_000_000_000n },
    approve: { gasLimit: 71_000n, maxFeePerGas: 40_000_000_000n },
    execute: { gasLimit: 205_000n, maxFeePerGas: 40_000_000_000n } }
  return { ...actual, MAINNET_GRANT_WRITES_HARD_DISABLED: false,
    MAINNET_GRANT_IDENTITY: { payer: actual.MAINNET_PROPOSED_ROLES.payer, recipientA: actual.MAINNET_PROPOSED_ROLES.artist,
      recipientB: actual.MAINNET_PROPOSED_ROLES.producer, demoId: actual.MAINNET_PROPOSED_DEMO_ID, contract: null, gasCeilings: ceilings },
    MAINNET_GRANT_RELEASE: { reviewBasis: { kind: 'owner_demo_exception', reference: 'mock-review-only',
      sourceCommit: '1fc92860b9ec346b3b462d100e562112400b48d1',
      deploymentDataSha256: '0xb1ff3f460f34f6832eea6393ef68413a6c1cd30d00ceba2d508e7d56b500a6b8' },
      ownerActivationReference: 'mock-owner-only', payerControlReference: 'mock-payer-only',
      ownerRoleConfirmationReference: 'mock-roles-only', ceilings } }
})

import { MAINNET_GRANT_RELEASE, MAINNET_PROPOSED_DEMO_ID, MAINNET_PROPOSED_ROLES } from './grantMainnetCandidate'
import { mainnetDeploymentData, type MainnetReviewFacts } from './grantMainnetCandidate'
import { mainnetReviewFingerprint, submitReviewedMainnetStep, verifyMainnetSubmittedEnvelope, type MainnetSenderPorts,
  type MainnetSubmissionReview } from './mainnetSender'
import { prepareMainnetRequest, readMainnetJournal, type MainnetPreparedRequest, type MainnetStorage } from './mainnetWalletWorkflow'

const terms = { payer: MAINNET_PROPOSED_ROLES.payer, artist: MAINNET_PROPOSED_ROLES.artist,
  producer: MAINNET_PROPOSED_ROLES.producer, demoId: MAINNET_PROPOSED_DEMO_ID }
const hash: Hex = `0x${'a'.repeat(64)}`
function fixture() {
  const entries = new Map<string, string>()
  const storage: MainnetStorage = { getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value) } }
  const facts: MainnetReviewFacts = { chainId: 5042, walletChainId: 5042, payer: terms.payer, demoId: terms.demoId,
    tokenDecimals: 6, tokenBalance: 2_000_000n, nativeBalance: 2_000_000_000_000_000_000n,
    allowance: null, latestNonce: 0, pendingNonce: 0, estimatedGas: 400_000n,
    quotedMaxFeePerGas: 29_000_000_000n, baseFeePerGas: 20_000_000_000n, priorityFeePerGas: 5_000_000_000n,
    contract: null, runtimeCode: null, reviewedRuntimeHash: null, contractTermsMatch: false, executed: null,
    priorAttemptUnresolved: false, ceilings: MAINNET_GRANT_RELEASE.ceilings }
  const request = prepareMainnetRequest('deploy', terms, null, facts.ceilings.deploy!, facts.priorityFeePerGas!)
  const body = { step: 'deploy' as const, terms, facts, request, nonce: 0, aggregateMaximum: 331_440_000_000_000_000n }
  const review: MainnetSubmissionReview = { ...body, fingerprint: mainnetReviewFingerprint(body) }
  const send = vi.fn(async (_request: MainnetPreparedRequest & { nonce: number }) => hash)
  const client = { getChainId: async () => 5042, readContract: async ({ functionName }: { functionName: string }) =>
    functionName === 'decimals' ? 6 : 2_000_000n,
    getBalance: async () => 2_000_000_000_000_000_000n,
    getTransactionCount: async () => 0, estimateFeesPerGas: async () => ({ maxFeePerGas: 29_000_000_000n, maxPriorityFeePerGas: 5_000_000_000n }),
    getBlock: async () => ({ baseFeePerGas: 20_000_000_000n }),
    estimateGas: async ({ data }: { data: Hex }) => data === mainnetDeploymentData(terms.payer, terms.artist, terms.producer, terms.demoId) ? 400_000n : 999_999n,
    getTransaction: async () => null, getTransactionReceipt: async () => null } as unknown as PublicClient
  const wallet = { providerId: 'io.metamask', getAddresses: async () => [terms.payer] as Address[],
    getChainId: async () => 5042, sendTransaction: send }
  const ports: MainnetSenderPorts = { client, wallet, storage, now: () => 1,
    withOriginLock: async (_key, action) => action() }
  return { ports, review, send, storage, client, wallet }
}

describe('Mainnet sender with mock-only release record', () => {
  it('caps a 6.325-gwei recommendation at 6 gwei before the wallet request', async () => {
    const sample = fixture()
    sample.ports.client = { ...sample.client,
      estimateFeesPerGas: async () => ({ maxFeePerGas: 29_000_000_000n, maxPriorityFeePerGas: 6_325_000_000n }),
    } as unknown as PublicClient
    sample.review.facts = { ...sample.review.facts, priorityFeePerGas: 6_325_000_000n }
    sample.review.request = prepareMainnetRequest('deploy', terms, null, sample.review.facts.ceilings.deploy!, 6_000_000_000n)
    const { fingerprint: _oldFingerprint, ...reviewBody } = sample.review
    sample.review.fingerprint = mainnetReviewFingerprint(reviewBody)
    await submitReviewedMainnetStep(sample.ports, sample.review)
    expect(sample.send).toHaveBeenCalledOnce()
    expect(sample.send.mock.calls[0][0].maxPriorityFeePerGas).toBe(6_000_000_000n)
  })
  it('submits only the exact reviewed creation request on an explicit call and preserves UNKNOWN', async () => {
    const { ports, review, send, storage } = fixture()
    expect(send).not.toHaveBeenCalled()
    const result = await submitReviewedMainnetStep(ports, review)
    expect(result).toEqual({ hash, status: 'unknown' })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toMatchObject({ chainId: 5042, from: terms.payer, nonce: 0,
      gas: 510_000n, maxFeePerGas: 40_000_000_000n, value: 0n, to: undefined })
    expect(readMainnetJournal(storage, terms)?.deploy).toMatchObject({ state: 'unknown', hash })
    expect(readMainnetJournal(storage, terms)?.deploy).toMatchObject({ reviewedNonce: 0, reviewedGasLimit: '510000' })
    await expect(submitReviewedMainnetStep(ports, review)).rejects.toThrow('intent already exists')
    expect(send).toHaveBeenCalledOnce()
  })
  it('blocks a wrong signer, wrong network, stale nonce, altered calldata and excessive gas before a wallet request', async () => {
    const altered: Array<(sample: ReturnType<typeof fixture>) => void> = [
      (sample) => { sample.wallet.getAddresses = async () => ['0x4444444444444444444444444444444444444444'] },
      (sample) => { sample.wallet.getChainId = async () => 5042002 },
      (sample) => { sample.ports.client = { ...sample.client, getTransactionCount: async () => 1 } },
      (sample) => { sample.review.request = { ...sample.review.request, data: '0x1234' } },
      (sample) => { sample.ports.client = { ...sample.client, estimateGas: async () => 510_001n } },
      (sample) => { sample.ports.client = { ...sample.client,
        getBlock: async () => ({ baseFeePerGas: 39_000_000_000n }),
        estimateFeesPerGas: async () => ({ maxFeePerGas: 45_000_000_000n, maxPriorityFeePerGas: 6_325_000_000n }) } as unknown as PublicClient },
      (sample) => { sample.review.request = { ...sample.review.request, maxPriorityFeePerGas: 6_000_000_001n } },
      (sample) => { sample.ports.client = { ...sample.client,
        estimateFeesPerGas: async () => ({ maxFeePerGas: 5_000_000_000n, maxPriorityFeePerGas: 5_500_000_000n }) } as unknown as PublicClient },
      (sample) => { sample.ports.wallet.providerId = 'phantom' },
      (sample) => { let reads = 0; sample.ports.client = { ...sample.client,
        getTransactionCount: async () => ++reads > 2 ? 1 : 0 } },
    ]
    for (const alter of altered) {
      const sample = fixture(); alter(sample)
      await expect(submitReviewedMainnetStep(sample.ports, sample.review)).rejects.toThrow()
      expect(sample.send).not.toHaveBeenCalled()
      expect(readMainnetJournal(sample.storage, terms)).toBeNull()
    }
  })
  it('marks a wallet-altered transaction UNKNOWN without treating it as confirmed or resending', async () => {
    const sample = fixture()
    const changed = { hash, from: terms.payer, to: null, chainId: 5042, input: sample.review.request.data,
      nonce: 0, value: 0n, type: 'eip1559', gas: 510_001n,
      maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 5_000_000_000n } as Transaction
    expect(verifyMainnetSubmittedEnvelope(changed, hash, sample.review.request, 0)).toContain('Submitted gas type or fee exceeds the exact reviewed ceiling')
    sample.ports.client = { ...sample.client, getTransaction: async () => changed } as unknown as PublicClient
    expect((await submitReviewedMainnetStep(sample.ports, sample.review)).status).toBe('unknown')
    expect(readMainnetJournal(sample.storage, terms)?.deploy?.state).toBe('unknown')
    expect(sample.send).toHaveBeenCalledOnce()
  })
  it('serializes concurrent requests and records wallet rejection without automatic resend', async () => {
    const sample = fixture()
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let occupied = false
    sample.ports.withOriginLock = async (_key, action) => {
      if (occupied) throw new Error('Another Mainnet request is active')
      occupied = true
      try { await held; return await action() } finally { occupied = false }
    }
    const first = submitReviewedMainnetStep(sample.ports, sample.review)
    await expect(submitReviewedMainnetStep(sample.ports, sample.review)).rejects.toThrow('active')
    release(); await first
    expect(sample.send).toHaveBeenCalledOnce()
    const rejected = fixture()
    rejected.ports.wallet.sendTransaction = async () => { throw Object.assign(new Error('Rejected'), { code: 4001 }) }
    await expect(submitReviewedMainnetStep(rejected.ports, rejected.review)).rejects.toThrow('Rejected')
    expect(readMainnetJournal(rejected.storage, terms)?.deploy?.state).toBe('rejected')
    await expect(submitReviewedMainnetStep(rejected.ports, rejected.review)).rejects.toThrow('intent already exists')
  })
})
