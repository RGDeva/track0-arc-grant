import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { MAINNET_GRANT_WRITES_HARD_DISABLED, MAINNET_GRANT_RELEASE, MAINNET_GRANT_IDENTITY } from './grantMainnetCandidate'
import { WRITES_HARD_DISABLED } from '../lib/writeGates'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

it('keeps both shipped review builds unable to submit Mainnet transactions', () => {
  const publicConfig = source('../../vite.mainnet.config.ts')
  const privateConfig = source('../../vite.mainnet.activation-review.config.ts')
  const entry = source('../../mainnet-app/main.tsx')

  expect(WRITES_HARD_DISABLED).toBe(true)
  expect(MAINNET_GRANT_WRITES_HARD_DISABLED).toBe(true)
  expect(Object.values(MAINNET_GRANT_RELEASE).every((value) => value === null)).toBe(true)
  expect(MAINNET_GRANT_IDENTITY).toMatchObject({ contract: null, gasCeilings: null })
  expect(publicConfig).toContain('mainnetSender.disabled.ts')
  expect(publicConfig).toContain('useMainnetWalletPort.disabled.ts')
  expect(privateConfig).not.toContain('mainnetSender.disabled.ts')
  expect(privateConfig).not.toContain('useMainnetWalletPort.disabled.ts')
  expect(privateConfig).toContain('treeshake: false')
  expect(entry).toContain('disabled={MAINNET_GRANT_WRITES_HARD_DISABLED || review.findings.length > 0}')
  expect(entry).toContain('disabled={MAINNET_GRANT_WRITES_HARD_DISABLED || submitting')
})
