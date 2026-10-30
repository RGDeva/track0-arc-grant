import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { MAINNET_GRANT_WRITES_HARD_DISABLED, MAINNET_GRANT_RELEASE, MAINNET_GRANT_IDENTITY } from './grantMainnetCandidate'
import { WRITES_HARD_DISABLED } from '../lib/writeGates'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

it('binds the local B2 owner exception while preserving the public disabled build and Track0 global gate', () => {
  const publicConfig = source('../../vite.mainnet.config.ts')
  const releaseConfig = source('../../vite.mainnet.release-candidate.config.ts')
  const entry = source('../../mainnet-app/main.tsx')
  const sealedDecisionHash = '3fb62ccc9ae3af596de9332a42615388ceedcfe0fe1ee7bc7567819c9261ab7c'

  expect(WRITES_HARD_DISABLED).toBe(true)
  expect(MAINNET_GRANT_WRITES_HARD_DISABLED).toBe(false)
  expect(MAINNET_GRANT_RELEASE.ownerActivationReference).toBe(`release/MAINNET_OWNER_DECISION_B2_2026-10-30.md#sha256:${sealedDecisionHash}`)
  expect(MAINNET_GRANT_RELEASE.ceilings).not.toBeNull()
  expect(MAINNET_GRANT_IDENTITY).toMatchObject({ contract: null })
  expect(publicConfig).toContain('mainnetSender.disabled.ts')
  expect(publicConfig).toContain('useMainnetWalletPort.disabled.ts')
  expect(releaseConfig).not.toContain('mainnetSender.disabled.ts')
  expect(releaseConfig).not.toContain('useMainnetWalletPort.disabled.ts')
  expect(releaseConfig).toContain('treeshake: false')
  expect(entry).toContain('disabled={MAINNET_GRANT_WRITES_HARD_DISABLED || review.findings.length > 0}')
  expect(entry).toContain('disabled={MAINNET_GRANT_WRITES_HARD_DISABLED || submitting')
  expect(entry).toContain('disabled={!releaseReady || (!address && (!metaMask || isPending))}')
  expect(entry).toContain('disabled={!releaseReady} onClick={() => { setSubmissionReview(null); switchChain')
})
