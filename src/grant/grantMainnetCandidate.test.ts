import { describe, expect, it } from 'vitest'
import { encodeDeployData, encodeFunctionData, erc20Abi, sha256, toBytes } from 'viem'
import { GRANT_CREATION_BYTECODE, GRANT_CREATION_SHA256 } from './frozenGrantSplitArtifact'
import { GRANT_PROPOSED_DEMO_ID, grantWalletActionsEnabled, journalKey } from './grantTestnetSafety'
import { grantConstructorAbi } from './frozenGrantSplitArtifact'
import { assessMainnetReview, mainnetAttemptBlocked, mainnetCalldata, mainnetDeploymentData, mainnetMaximumExposure,
  mainnetReviewKey, mainnetReviewBasisMatchesTerms, MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_IDENTITY, MAINNET_GRANT_RELEASE,
  MAINNET_GRANT_WRITES_HARD_DISABLED, MAINNET_PROPOSED_DEMO_ID, MAINNET_PROPOSED_ROLES,
  MAINNET_REVIEW_NAMESPACE, MAINNET_PROPOSED_CEILINGS, mainnetGrantWalletActionsEnabled, type MainnetReviewFacts } from './grantMainnetCandidate'

describe('separate default-deny Mainnet candidate', () => {
  it('binds the B2 owner-exception reference to the frozen terms and ceilings', () => {
    expect(MAINNET_GRANT_WRITES_HARD_DISABLED).toBe(false)
    expect(MAINNET_GRANT_IDENTITY).toMatchObject({ payer: MAINNET_PROPOSED_ROLES.payer,
      recipientA: MAINNET_PROPOSED_ROLES.artist, recipientB: MAINNET_PROPOSED_ROLES.producer,
      demoId: MAINNET_PROPOSED_DEMO_ID, contract: null, gasCeilings: MAINNET_PROPOSED_CEILINGS })
    expect(MAINNET_GRANT_RELEASE.reviewBasis.kind).toBe('owner_demo_exception')
    expect(MAINNET_GRANT_RELEASE.ownerActivationReference).toMatch(/^release\/MAINNET_OWNER_DECISION_B2_2026-10-30\.md#sha256:[0-9a-f]{64}$/)
    expect(MAINNET_GRANT_RELEASE.ceilings).toEqual(MAINNET_PROPOSED_CEILINGS)
    expect(mainnetMaximumExposure(MAINNET_PROPOSED_CEILINGS)).toBe(331_440_000_000_000_000n)
    expect(mainnetGrantWalletActionsEnabled()).toBe(true)
  })
  it('rejects an unrecorded or mis-scoped owner-review exception', () => {
    const { payer, artist, producer } = MAINNET_PROPOSED_ROLES
    const basis = { kind: 'owner_demo_exception' as const, reference: 'owner decision',
      sourceCommit: '1fc92860b9ec346b3b462d100e562112400b48d1',
      deploymentDataSha256: sha256(mainnetDeploymentData(payer, artist, producer, MAINNET_PROPOSED_DEMO_ID)) }
    expect(mainnetReviewBasisMatchesTerms(null, payer, artist, producer, MAINNET_PROPOSED_DEMO_ID)).toBe(false)
    expect(mainnetReviewBasisMatchesTerms({ ...basis, reference: ' ' }, payer, artist, producer, MAINNET_PROPOSED_DEMO_ID)).toBe(false)
    expect(mainnetReviewBasisMatchesTerms({ ...basis, sourceCommit: 'not-a-commit' }, payer, artist, producer, MAINNET_PROPOSED_DEMO_ID)).toBe(false)
    expect(mainnetReviewBasisMatchesTerms(basis, payer, artist, producer, '0x01')).toBe(false)
    expect(mainnetReviewBasisMatchesTerms(basis, payer, artist, producer, MAINNET_PROPOSED_DEMO_ID)).toBe(true)
  })
  it('cannot activate the Testnet execution path on Mainnet', () => {
    expect(grantWalletActionsEnabled(MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_CHAIN_ID, true, false)).toBe(false)
    expect(MAINNET_REVIEW_NAMESPACE).not.toBe(journalKey('0x2213B580914Ee4A07a80b3C7e911950165FCAd6B', GRANT_PROPOSED_DEMO_ID))
    expect(MAINNET_PROPOSED_DEMO_ID).not.toBe(GRANT_PROPOSED_DEMO_ID)
  })
  it('keeps the reviewed frozen creation bytecode unchanged', () => {
    expect(sha256(toBytes(GRANT_CREATION_BYTECODE)).slice(2)).toBe(GRANT_CREATION_SHA256)
  })
  it('encodes the exact Mainnet constructor without changing frozen bytecode', () => {
    const { payer, artist, producer } = MAINNET_PROPOSED_ROLES
    const data = mainnetDeploymentData(payer, artist, producer, MAINNET_PROPOSED_DEMO_ID)
    expect(data).toBe(encodeDeployData({ abi: grantConstructorAbi, bytecode: GRANT_CREATION_BYTECODE,
      args: [payer, artist, producer, 100_000n, 200_000n, 5042n, MAINNET_PROPOSED_DEMO_ID] }))
    expect(data).toContain(GRANT_CREATION_BYTECODE.slice(2))
    expect(data.length).toBe(GRANT_CREATION_BYTECODE.length + 7 * 64)
    expect(sha256(data).slice(2)).toBe('b1ff3f460f34f6832eea6393ef68413a6c1cd30d00ceba2d508e7d56b500a6b8')
  })
  it('never derives an unlimited approval or argument-bearing execute call', () => {
    const contract = MAINNET_PROPOSED_ROLES.artist
    expect(mainnetCalldata('approve', contract)).toBe(encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [contract, 300_000n] }))
    expect(mainnetCalldata('approve', null)).toBeNull()
    expect(mainnetCalldata('execute', contract)).toBe('0x61461954')
  })
  it('isolates Mainnet UNKNOWN attempts from Testnet and fails closed on storage failure', () => {
    const { payer } = MAINNET_PROPOSED_ROLES
    const key = mainnetReviewKey(payer, MAINNET_PROPOSED_DEMO_ID)
    expect(key).toContain(':5042:')
    expect(key).not.toBe(journalKey(payer, GRANT_PROPOSED_DEMO_ID))
    expect(mainnetAttemptBlocked({ getItem: () => null }, payer, MAINNET_PROPOSED_DEMO_ID)).toBe(false)
    expect(mainnetAttemptBlocked({ getItem: () => 'UNKNOWN' }, payer, MAINNET_PROPOSED_DEMO_ID)).toBe(true)
    expect(mainnetAttemptBlocked({ getItem: () => { throw Error('storage denied') } }, payer, MAINNET_PROPOSED_DEMO_ID)).toBe(true)
  })
  it('blocks wrong chain, pending nonce, missing review limits, missing consent and unresolved attempts', () => {
    const facts: MainnetReviewFacts = {
      chainId: 5042002, walletChainId: 5042002, payer: MAINNET_PROPOSED_ROLES.payer, demoId: MAINNET_PROPOSED_DEMO_ID,
      tokenDecimals: 6, tokenBalance: 1_000_000n, nativeBalance: 10n ** 18n, allowance: 0n,
      latestNonce: 1, pendingNonce: 2, estimatedGas: 400_000n, quotedMaxFeePerGas: 40_000_000_000n,
      baseFeePerGas: 20_000_000_000n, priorityFeePerGas: 4_000_000_000n, contract: null, runtimeCode: null, contractTermsMatch: false,
      reviewedRuntimeHash: null, executed: null, priorAttemptUnresolved: true, ceilings: { deploy: null, approve: null, execute: null },
    }
    const review = assessMainnetReview('deploy', facts)
    expect(review.findings.join(' ')).toMatch(/Wrong chain.*pending transaction.*unresolved/)
    expect(review.findings).toContain('Mainnet transaction submission remains blocked without release readiness')
    expect(review.to).toBeNull()
    expect(review.value).toBe(0n)
    expect(review.dataSha256).toBe(sha256(mainnetDeploymentData(facts.payer!, MAINNET_PROPOSED_ROLES.artist, MAINNET_PROPOSED_ROLES.producer, MAINNET_PROPOSED_DEMO_ID)))
  })
  it('rejects insufficient balance, allowance mismatch, execution replay and excessive gas', () => {
    const caps = { deploy: { gasLimit: 500_000n, maxFeePerGas: 40_000_000_000n },
      approve: { gasLimit: 70_000n, maxFeePerGas: 40_000_000_000n },
      execute: { gasLimit: 200_000n, maxFeePerGas: 40_000_000_000n } }
    expect(mainnetMaximumExposure(caps)).toBe(330_800_000_000_000_000n)
    const facts: MainnetReviewFacts = {
      chainId: 5042, walletChainId: 5042002, payer: MAINNET_PROPOSED_ROLES.payer, demoId: MAINNET_PROPOSED_DEMO_ID,
      tokenDecimals: 6, tokenBalance: 100_000n, nativeBalance: 100_000_000_000_000_000n,
      allowance: 299_999n, latestNonce: 0, pendingNonce: 0, estimatedGas: 210_000n,
      quotedMaxFeePerGas: 41_000_000_000n, baseFeePerGas: 39_000_000_000n, priorityFeePerGas: 4_000_000_000n,
      contract: MAINNET_PROPOSED_ROLES.artist, runtimeCode: null, reviewedRuntimeHash: null, contractTermsMatch: false,
      executed: true, priorAttemptUnresolved: false, ceilings: caps,
    }
    const findings = assessMainnetReview('execute', facts).findings.join('; ')
    expect(findings).toMatch(/Insufficient.*balance/)
    expect(findings).toMatch(/already|executed/)
    expect(findings).toMatch(/exactly 300000/)
    expect(findings).toMatch(/estimate unavailable or exceeds ceiling|exceeds ceiling/)
    expect(findings).toMatch(/base fee plus capped priority fee unavailable or exceeds ceiling/)
    expect(findings).toMatch(/wallet is not on Arc Mainnet/)
  })
})
