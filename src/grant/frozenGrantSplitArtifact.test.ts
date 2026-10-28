import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Address, Hex } from 'viem'
import { GRANT_CREATION_BYTECODE, GRANT_CREATION_SHA256, GRANT_RUNTIME_TEMPLATE, GRANT_SOURCE_SHA256, grantConstructorAbi, grantDeploymentData, matchesFrozenGrantRuntime } from './frozenGrantSplitArtifact'
import { readFileSync } from 'node:fs'
const address = (digit: string): Address => `0x${digit.repeat(40)}`
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
describe('frozen GrantSplitDemo artifact', () => {
  it('matches the reviewed contract source and exact creation/runtime bytes', () => {
    expect(sha(readFileSync('contracts/GrantSplitDemo.sol'))).toBe(GRANT_SOURCE_SHA256)
    expect(sha(Buffer.from(GRANT_CREATION_BYTECODE.slice(2), 'hex'))).toBe(GRANT_CREATION_SHA256)
    expect(GRANT_CREATION_BYTECODE.length).toBe(2 + 2494 * 2)
    expect(GRANT_RUNTIME_TEMPLATE.length).toBe(2 + 1570 * 2)
    expect(matchesFrozenGrantRuntime(GRANT_RUNTIME_TEMPLATE)).toBe(true)
  })
  it('rejects changed runtime logic while permitting constructor immutable patches', () => {
    const changedLogic = `${GRANT_RUNTIME_TEMPLATE.slice(0, 12)}ff${GRANT_RUNTIME_TEMPLATE.slice(14)}` as Hex
    expect(matchesFrozenGrantRuntime(changedLogic)).toBe(false)
    const patchedImmutable = `${GRANT_RUNTIME_TEMPLATE.slice(0, 2 + 246 * 2)}${'aa'.repeat(32)}${GRANT_RUNTIME_TEMPLATE.slice(2 + 278 * 2)}` as Hex
    expect(matchesFrozenGrantRuntime(patchedImmutable)).toBe(true)
    expect(matchesFrozenGrantRuntime(null)).toBe(false)
  })
  it('encodes seven exact Testnet constructor arguments and fixed 0.10+0.20 split', () => {
    const data = grantDeploymentData(address('1'), address('2'), address('3'), `0x${'a'.repeat(64)}`)
    expect(data.startsWith(GRANT_CREATION_BYTECODE)).toBe(true)
    expect(data.length).toBe(GRANT_CREATION_BYTECODE.length + 7 * 64)
    expect(grantConstructorAbi[0].inputs.length).toBe(7)
  })
})
