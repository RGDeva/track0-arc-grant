import { expect, it, vi } from 'vitest'
import { MAINNET_PROPOSED_ROLES } from './grantMainnetCandidate'
import { submitReviewedMainnetStep } from './mainnetSender'

it('the B2 sender rejects mismatched demo identity before any wallet request', async () => {
  const sendTransaction = vi.fn()
  const withOriginLock = vi.fn()
  const terms = { payer: MAINNET_PROPOSED_ROLES.payer, artist: MAINNET_PROPOSED_ROLES.artist,
    producer: MAINNET_PROPOSED_ROLES.producer, demoId: '0x01' as const }
  await expect(submitReviewedMainnetStep({ wallet: { providerId: 'io.metamask', getAddresses: vi.fn(),
    getChainId: vi.fn(), sendTransaction }, client: {} as never, storage: {} as never, now: vi.fn(), withOriginLock },
  { step: 'deploy', terms, facts: {} as never, request: {} as never, nonce: 0, aggregateMaximum: 0n,
    fingerprint: '0x' as const })).rejects.toThrow('human activation')
  expect(withOriginLock).not.toHaveBeenCalled()
  expect(sendTransaction).not.toHaveBeenCalled()
})
