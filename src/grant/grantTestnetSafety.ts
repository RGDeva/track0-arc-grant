import { getAddress, toHex, type Address, type Hex } from 'viem'
import { GRANT_AMOUNT_A_BASE_UNITS, GRANT_AMOUNT_B_BASE_UNITS, GRANT_WRITES_HARD_DISABLED } from './grantSplitProtocol'

export const GRANT_TESTNET_CHAIN_ID = 5042002
export const GRANT_TESTNET_USDC: Address = '0x3600000000000000000000000000000000000000'
export const GRANT_SPLIT_TOTAL = GRANT_AMOUNT_A_BASE_UNITS + GRANT_AMOUNT_B_BASE_UNITS
/** Owner-proposed public demo roles. Changing a role requires another reviewed source diff. */
export const GRANT_DEMO_PAYER = getAddress('0x2213B580914Ee4A07a80b3C7e911950165FCAd6B')
export const GRANT_DEMO_ARTIST = getAddress('0x3743716d3162a129AE4DCC7BCb49c2B8314D9EF9')
export const GRANT_DEMO_PRODUCER = getAddress('0x7106384E4f8430677cEb3CA43Cb5C50Cf615591a')
/** Owner-proposed decimal identifier, encoded as the contract's bytes32 argument. Not deployment approval. */
export const GRANT_PROPOSED_DEMO_ID = toHex(2026102501n, { size: 32 })
export function proposedDemoIdConfirmed(value: string, confirmed: boolean): boolean {
  return confirmed && value.toLowerCase() === GRANT_PROPOSED_DEMO_ID.toLowerCase()
}
export function validateProposedGrantDemoRoles(payer: string | undefined, artist: string, producer: string): string[] {
  const findings: string[] = []
  const matches = (value: string | undefined, expected: Address) => {
    try { return !!value && getAddress(value) === expected } catch { return false }
  }
  if (!matches(payer, GRANT_DEMO_PAYER)) findings.push('Connected payer differs from the proposed demo payer')
  if (!matches(artist, GRANT_DEMO_ARTIST)) findings.push('Artist differs from the proposed demo recipient')
  if (!matches(producer, GRANT_DEMO_PRODUCER)) findings.push('Producer differs from the proposed demo recipient')
  return findings
}
/** A separate, source-reviewed activation is required even if the grant hard gate is lifted. */
export const GRANT_TESTNET_ACTIVATION_ENABLED = true as const
export function grantWalletActionsEnabled(walletChainId: number | undefined, configuredChainId: number | undefined,
  activationEnabled: boolean = GRANT_TESTNET_ACTIVATION_ENABLED, writesHardDisabled: boolean = GRANT_WRITES_HARD_DISABLED): boolean {
  return activationEnabled && !writesHardDisabled && walletChainId === GRANT_TESTNET_CHAIN_ID && configuredChainId === GRANT_TESTNET_CHAIN_ID
}
/** Query the wallet provider again immediately before an authorization request. */
export function validateActiveGrantSigner(expectedPayer: Address, clientAccount: Address | undefined,
  providerAccounts: readonly Address[], providerChainId: number): string[] {
  const problems: string[] = []
  if (providerChainId !== GRANT_TESTNET_CHAIN_ID) problems.push('Wallet provider is not on Arc Testnet')
  const active = providerAccounts[0]
  if (!clientAccount || !active || !eq(clientAccount, expectedPayer) || !eq(active, expectedPayer))
    problems.push('Wallet signer changed since transaction review')
  return problems
}
/** Read-only EIP-6963 connector checks; this must not request account permissions. */
export function validateMetaMaskPermission(expectedPayer: Address, connectorId: string | undefined,
  permissionGranted: boolean, connectorAccounts: readonly Address[], connectorChainId: number,
  connectionPending: boolean): string[] {
  const problems: string[] = []
  if (connectionPending) problems.push('MetaMask connection permission is still pending')
  if (connectorId !== 'io.metamask') problems.push('Connected wallet is not the selected EIP-6963 MetaMask provider')
  if (!permissionGranted || !connectorAccounts[0] || !eq(connectorAccounts[0], expectedPayer))
    problems.push('MetaMask account permission is missing or belongs to another payer')
  if (connectorChainId !== GRANT_TESTNET_CHAIN_ID) problems.push('MetaMask provider is not on Arc Testnet')
  return problems
}
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export type GrantStep = 'deploy' | 'approve' | 'execute'
export type AttemptState = 'authorizing' | 'submitted' | 'unknown' | 'failed' | 'confirmed' | 'rejected'
export interface GrantAttempt { state: AttemptState; hash?: Hex; at: number; history?: Array<{ state: AttemptState; at: number }> }
export interface GrantJournal {
  version: 1
  chainId: typeof GRANT_TESTNET_CHAIN_ID
  payer: Address
  recipientA: Address
  recipientB: Address
  demoId: Hex
  contract?: Address
  runtimeHash?: Hex
  deploy?: GrantAttempt
  approve?: GrantAttempt
  execute?: GrantAttempt
}
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const validHash = (value: unknown): value is Hex => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
export function hasVerifiedExactExecutionAllowance(allowance: bigint, approvalVerified: boolean,
  journal: GrantJournal | null, contract: Address | null): boolean {
  return allowance === GRANT_SPLIT_TOTAL && approvalVerified && journal?.approve?.state === 'confirmed' &&
    validHash(journal.approve.hash) && !!journal.contract && !!contract && eq(journal.contract, contract)
}
export function validateGrantDeployment(payer: string | undefined, recipientA: string, recipientB: string,
  demoId: string, chainId: number | undefined): string[] {
  const problems: string[] = []
  if (chainId !== GRANT_TESTNET_CHAIN_ID) problems.push('Arc Testnet wallet connection required')
  let p: Address | null = null
  let a: Address | null = null
  let b: Address | null = null
  try { p = payer ? getAddress(payer) : null } catch { /* invalid */ }
  try { a = getAddress(recipientA) } catch { /* invalid */ }
  try { b = getAddress(recipientB) } catch { /* invalid */ }
  if (!p || eq(p, ZERO_ADDRESS)) problems.push('Connected payer address is missing or invalid')
  if (!a || !b || eq(a, ZERO_ADDRESS) || eq(b, ZERO_ADDRESS)) problems.push('Both recipient addresses must be valid and nonzero')
  if (p && a && eq(p, a) || p && b && eq(p, b)) problems.push('A recipient cannot be the payer')
  if (a && b && eq(a, b)) problems.push('Recipients must differ')
  if (!validHash(demoId) || /^0x0{64}$/i.test(demoId)) problems.push('Nonzero 32-byte demo ID required')
  return problems
}
export interface GasCeiling { gasLimit: bigint; maxFeePerGas: bigint }
export interface GasObservation { estimate: bigint | null; maxFeePerGas: bigint | null; maxPriorityFeePerGas: bigint | null }
export function validateGasCeiling(ceiling: GasCeiling | null, observed: GasObservation): string[] {
  if (!ceiling) return ['Reviewed gas limit and maximum fee are required']
  const failures: string[] = []
  if (ceiling.gasLimit <= 0n || ceiling.maxFeePerGas <= 0n) failures.push('Gas ceiling must be positive')
  if (observed.estimate === null || observed.maxFeePerGas === null || observed.maxPriorityFeePerGas === null)
    failures.push('Live gas estimate or fee quote unavailable')
  else {
    if (observed.estimate > ceiling.gasLimit) failures.push('Gas estimate exceeds reviewed limit')
    if (observed.maxFeePerGas > ceiling.maxFeePerGas) failures.push('Live maximum fee exceeds reviewed ceiling')
    if (observed.maxPriorityFeePerGas > ceiling.maxFeePerGas) failures.push('Priority fee exceeds reviewed ceiling')
  }
  return failures
}
export function maximumExposure(ceilings: Record<GrantStep, GasCeiling | null>): bigint | null {
  if (!ceilings.deploy || !ceilings.approve || !ceilings.execute) return null
  const gas = [ceilings.deploy, ceilings.approve, ceilings.execute].reduce((sum, ceiling) => sum + ceiling.gasLimit * ceiling.maxFeePerGas, 0n)
  return GRANT_SPLIT_TOTAL * 1_000_000_000_000n + gas // 6-decimal token units converted to 18-decimal native units
}
export function journalKey(payer: Address, demoId: Hex): string {
  return `track0-arc-grant-v1:${GRANT_TESTNET_CHAIN_ID}:${payer.toLowerCase()}:${demoId.toLowerCase()}`
}
export function readJournal(storage: StoragePort, payer: Address, demoId: Hex): GrantJournal | null {
  const raw = storage.getItem(journalKey(payer, demoId))
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as GrantJournal
    if (value.version !== 1 || value.chainId !== GRANT_TESTNET_CHAIN_ID || !eq(value.payer, payer) ||
        !eq(value.demoId, demoId) || !getAddress(value.recipientA) || !getAddress(value.recipientB)) return null
    return value
  } catch { return null }
}
export function saveJournal(storage: StoragePort, journal: GrantJournal): void {
  storage.setItem(journalKey(journal.payer, journal.demoId), JSON.stringify(journal))
}
/** Persist authorization intent before invoking the wallet. Unknown attempts are never retried automatically. */
export function beginAttempt(storage: StoragePort, journal: GrantJournal, step: GrantStep, now: number): GrantJournal {
  const existing = journal[step]
  if (existing && existing.state !== 'rejected') throw new Error(`${step} attempt already exists; reconcile it before any further signature`)
  const next = { ...journal, [step]: { state: 'authorizing' as const, at: now } }
  saveJournal(storage, next)
  return next
}
export function updateAttempt(storage: StoragePort, journal: GrantJournal, step: GrantStep,
  state: AttemptState, hash?: Hex): GrantJournal {
  // Re-read durable state: a delayed RPC response must never demote a confirmed payment.
  const latest = readJournal(storage, journal.payer, journal.demoId) ?? journal
  const existing = latest[step]
  if (!existing) throw new Error('No durable attempt exists')
  if (existing.hash && hash && !eq(existing.hash, hash)) throw new Error('Attempt hash cannot change')
  if ((state === 'submitted' || state === 'confirmed') && !validHash(hash ?? existing.hash)) throw new Error('Transaction hash required')
  if (existing.state === 'confirmed' && state !== 'confirmed') return latest
  if (existing.state === state && (!hash || (existing.hash && eq(existing.hash, hash)))) return latest
  const history = existing.state === state ? existing.history :
    [...(existing.history ?? []), { state: existing.state, at: existing.at }]
  const next = { ...latest, [step]: { ...existing, state, hash: hash ?? existing.hash,
    at: existing.state === state ? existing.at : Date.now(), history } }
  saveJournal(storage, next)
  return next
}
export function isExplicitWalletRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; name?: unknown; cause?: unknown }
  return candidate.code === 4001 || candidate.name === 'UserRejectedRequestError' || isExplicitWalletRejection(candidate.cause)
}
/** Browser-level serialization is required in addition to the contract's onchain one-shot check. */
export async function withGrantOriginLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new Error('Browser Lock Manager unavailable; wallet submission disabled')
  return navigator.locks.request(key, { mode: 'exclusive' }, action)
}
/** Never queue a second permission popup behind one already open in another frame or tab. */
export async function withMetaMaskPermissionLock<T>(action: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new Error('Browser Lock Manager unavailable; MetaMask connection disabled')
  return navigator.locks.request('track0-arc-grant-metamask-permission', { mode: 'exclusive', ifAvailable: true }, (lock) => {
    if (!lock) throw new Error('A MetaMask connection request is already pending in another view')
    return action()
  })
}
