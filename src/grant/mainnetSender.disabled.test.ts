import { expect, it, vi } from 'vitest'
import { MAINNET_PROPOSED_DEMO_ID, MAINNET_PROPOSED_ROLES } from './grantMainnetCandidate'
import { submitReviewedMainnetStep } from './mainnetSender'

it('the shipped Mainnet sender cannot reach a wallet request or even a preflight', async () => {
  const sendTransaction = vi.fn()
  const withOriginLock = vi.fn()
  const terms = { payer: MAINNET_PROPOSED_ROLES.payer, artist: MAINNET_PROPOSED_ROLES.artist,
    producer: MAINNET_PROPOSED_ROLES.producer, demoId: MAINNET_PROPOSED_DEMO_ID }
  await expect(submitReviewedMainnetStep({ wallet: { providerId: 'io.metamask', getAddresses: vi.fn(),
    getChainId: vi.fn(), sendTransaction }, client: {} as never, storage: {} as never, now: vi.fn(), withOriginLock },
  { step: 'deploy', terms, facts: {} as never, request: {} as never, nonce: 0, aggregateMaximum: 0n,
    fingerprint: '0x' as const })).rejects.toThrow('hard-disabled')
  expect(withOriginLock).not.toHaveBeenCalled()
  expect(sendTransaction).not.toHaveBeenCalled()
})
