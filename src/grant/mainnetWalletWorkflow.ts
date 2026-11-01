import { erc20Abi, getAddress, keccak256, type Address, type Hex, type PublicClient } from 'viem'
import { verifyExactApproval } from './grantApprovalEvidence'
import { verifyGrantDeploymentEvidence } from './grantDeploymentEvidence'
import { grantEvidenceReader, readGrantPublicEvidence } from './grantSplitPublicEvidence'
import { grantSplitAbi, validateGrantSplitTerms, type GrantSplitTerms } from './grantSplitProtocol'
import { matchesFrozenGrantRuntime } from './frozenGrantSplitArtifact'
import { mainnetCalldata, mainnetDeploymentData, mainnetReviewKey, MAINNET_GRANT_AMOUNTS,
  MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_TOTAL, MAINNET_GRANT_USDC, MAINNET_GRANT_WRITES_HARD_DISABLED,
  MAINNET_GRANT_MAX_PRIORITY_FEE_PER_GAS,
  type MainnetCeiling, type MainnetStep } from './grantMainnetCandidate'

/** This module prepares and reconciles Mainnet transactions. It does not send them. */
export interface MainnetTerms {
  payer: Address; artist: Address; producer: Address; demoId: Hex
}
export type MainnetAttemptState = 'authorizing' | 'submitted' | 'unknown' | 'rejected' | 'failed' | 'confirmed'
export interface MainnetAttempt { state: MainnetAttemptState; hash?: Hex; at: number; history: Array<{ state: MainnetAttemptState; at: number }>
  reviewedNonce?: number; reviewedGasLimit?: string; reviewedMaxFee?: string; reviewedPriorityFee?: string }
export interface MainnetJournal {
  version: 1; chainId: typeof MAINNET_GRANT_CHAIN_ID; terms: MainnetTerms
  contract?: Address; runtimeHash?: Hex
  deploy?: MainnetAttempt; approve?: MainnetAttempt; execute?: MainnetAttempt
}
export interface MainnetStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface MainnetPreparedRequest { from: Address; chainId: typeof MAINNET_GRANT_CHAIN_ID; to?: Address;
  data: Hex; value: 0n; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; type: 'eip1559' }
const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const validHash = (value: unknown): value is Hex => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value)

export function validateMainnetTerms(terms: MainnetTerms): string[] {
  const findings: string[] = []
  let payer: Address | null = null; let artist: Address | null = null; let producer: Address | null = null
  try { payer = getAddress(terms.payer) } catch { findings.push('Invalid payer') }
  try { artist = getAddress(terms.artist) } catch { findings.push('Invalid artist') }
  try { producer = getAddress(terms.producer) } catch { findings.push('Invalid producer') }
  if (payer && artist && producer && (same(payer, artist) || same(payer, producer) || same(artist, producer) ||
      [payer, artist, producer].some((address) => /^0x0{40}$/i.test(address)))) findings.push('Payer and recipients must be distinct and nonzero')
  if (!validHash(terms.demoId) || /^0x0{64}$/i.test(terms.demoId)) findings.push('Nonzero bytes32 Mainnet demo ID required')
  return findings
}

export function prepareMainnetRequest(step: MainnetStep, terms: MainnetTerms, journal: MainnetJournal | null,
  ceiling: MainnetCeiling, maxPriorityFeePerGas: bigint): MainnetPreparedRequest {
  const failures = validateMainnetTerms(terms)
  if (failures.length) throw new Error(failures.join('; '))
  if (ceiling.gasLimit <= 0n || ceiling.maxFeePerGas <= 0n || maxPriorityFeePerGas < 0n ||
      maxPriorityFeePerGas > MAINNET_GRANT_MAX_PRIORITY_FEE_PER_GAS || maxPriorityFeePerGas > ceiling.maxFeePerGas)
    throw new Error('Reviewed positive gas and EIP-1559 fee ceilings required')
  if (step === 'deploy' && (journal?.deploy || journal?.contract)) throw new Error('Deployment identity or attempt exists; no repeat deployment')
  if (step !== 'deploy' && (!journal || !journal.contract || !journal.runtimeHash || journal.deploy?.state !== 'confirmed' ||
      (step === 'execute' && journal.approve?.state !== 'confirmed') ||
      !same(journal.terms.payer, terms.payer) || !same(journal.terms.artist, terms.artist) ||
      !same(journal.terms.producer, terms.producer) || !same(journal.terms.demoId, terms.demoId) ||
      (step === 'execute' && journal.execute !== undefined)))
    throw new Error('Exact prior deployment, approval and immutable terms must be independently verified')
  const contract = journal?.contract ?? null
  if (step !== 'deploy' && (!contract || /^0x0{40}$/i.test(contract) ||
      [terms.payer, terms.artist, terms.producer].some((address) => same(address, contract))))
    throw new Error('A distinct reviewed contract address is required')
  const data = step === 'deploy' ? mainnetDeploymentData(terms.payer, terms.artist, terms.producer, terms.demoId) : mainnetCalldata(step, contract)
  if (!data) throw new Error('Exact transaction calldata unavailable')
  return { from: terms.payer, chainId: MAINNET_GRANT_CHAIN_ID, to: step === 'deploy' ? undefined : step === 'approve' ? MAINNET_GRANT_USDC : contract!,
    data, value: 0n, gas: ceiling.gasLimit, maxFeePerGas: ceiling.maxFeePerGas, maxPriorityFeePerGas, type: 'eip1559' }
}

/** Final grant-only envelope guard immediately before calling the injected wallet. */
export function assertMainnetWalletRequest(request: MainnetPreparedRequest): void {
  const stageGasLimit = request.to === undefined ? 510_000n
    : request.to.toLowerCase() === MAINNET_GRANT_USDC.toLowerCase() ? 71_000n : 205_000n
  if (request.chainId !== MAINNET_GRANT_CHAIN_ID || request.gas <= 0n || request.gas > stageGasLimit ||
      request.maxFeePerGas <= 0n || request.maxFeePerGas > 40_000_000_000n ||
      request.maxPriorityFeePerGas < 0n || request.maxPriorityFeePerGas > MAINNET_GRANT_MAX_PRIORITY_FEE_PER_GAS ||
      request.maxPriorityFeePerGas > request.maxFeePerGas || request.value !== 0n || request.type !== 'eip1559')
    throw new Error('Wallet request exceeds reviewed Mainnet grant limits')
}

/** Source edit and independent approval are required before a sender can even be wired here. */
export function assertMainnetSubmissionDisabled(): never {
  if (!MAINNET_GRANT_WRITES_HARD_DISABLED) throw new Error('Unreviewed Mainnet activation state')
  throw new Error('Mainnet transaction submission is hard-disabled; a separately reviewed release is required')
}

export function readMainnetJournal(storage: MainnetStorage, terms: MainnetTerms): MainnetJournal | null {
  const raw = storage.getItem(mainnetReviewKey(terms.payer, terms.demoId))
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as MainnetJournal
    if (value.version !== 1 || value.chainId !== MAINNET_GRANT_CHAIN_ID ||
        value.terms.payer.toLowerCase() !== terms.payer.toLowerCase() ||
        value.terms.artist.toLowerCase() !== terms.artist.toLowerCase() ||
        value.terms.producer.toLowerCase() !== terms.producer.toLowerCase() ||
        value.terms.demoId.toLowerCase() !== terms.demoId.toLowerCase() || validateMainnetTerms(value.terms).length)
      throw new Error('Conflicting Mainnet journal')
    return value
  } catch { throw new Error('Malformed or conflicting Mainnet journal; do not submit or retry') }
}

export function saveMainnetJournal(storage: MainnetStorage, journal: MainnetJournal): void {
  storage.setItem(mainnetReviewKey(journal.terms.payer, journal.terms.demoId), JSON.stringify(journal))
}

export function beginMainnetAttempt(storage: MainnetStorage, journal: MainnetJournal, step: MainnetStep, at: number,
  reviewed?: { nonce: number; request: MainnetPreparedRequest }): MainnetJournal {
  const latest = readMainnetJournal(storage, journal.terms) ?? journal
  if (latest[step]) throw new Error(`${step} already has an attempt; reconcile it, never retry automatically`)
  if (step === 'approve' && (!latest.contract || !latest.runtimeHash || latest.deploy?.state !== 'confirmed')) throw new Error('Verified deployment required')
  if (step === 'execute' && (!latest.contract || latest.deploy?.state !== 'confirmed' || latest.approve?.state !== 'confirmed'))
    throw new Error('Verified deployment and exact approval required')
  const next = { ...latest, [step]: { state: 'authorizing' as const, at, history: [],
    ...(reviewed ? { reviewedNonce: reviewed.nonce, reviewedGasLimit: reviewed.request.gas.toString(),
      reviewedMaxFee: reviewed.request.maxFeePerGas.toString(),
      reviewedPriorityFee: reviewed.request.maxPriorityFeePerGas.toString() } : {}) } }
  saveMainnetJournal(storage, next)
  return next
}

export function transitionMainnetAttempt(storage: MainnetStorage, journal: MainnetJournal, step: MainnetStep,
  state: MainnetAttemptState, at: number, hash?: Hex): MainnetJournal {
  const latest = readMainnetJournal(storage, journal.terms) ?? journal
  const prior = latest[step]
  if (!prior) throw new Error('No durable Mainnet intent')
  if (prior.state === 'confirmed' && state !== 'confirmed') return latest
  if (prior.hash && hash && !same(prior.hash, hash)) throw new Error('Original transaction hash cannot change')
  if (['submitted', 'confirmed'].includes(state) && !validHash(hash ?? prior.hash)) throw new Error('Transaction hash required')
  if (prior.state === state && (!hash || same(prior.hash, hash))) return latest
  const next = { ...latest, [step]: { ...prior, state, hash: hash ?? prior.hash, at,
    history: [...prior.history, { state: prior.state, at: prior.at }] } }
  saveMainnetJournal(storage, next)
  return next
}

export type MainnetReconciliation = { status: 'confirmed' | 'pending' | 'unknown' | 'failed'; findings: string[];
  contract?: Address; runtimeHash?: Hex }

/** A locator is not proof; use transaction, receipt, canonical block and frozen terms. */
export async function reconcileMainnetAttempt(client: PublicClient, journal: MainnetJournal,
  step: MainnetStep): Promise<MainnetReconciliation> {
  const attempt = journal[step]
  if (!validHash(attempt?.hash)) return { status: 'unknown', findings: ['Original transaction hash unavailable; do not retry'] }
  try {
    const rpcChainId = await client.getChainId()
    if (rpcChainId !== MAINNET_GRANT_CHAIN_ID) return { status: 'unknown', findings: ['Wrong RPC chain'] }
    if (step !== 'deploy') {
      const deployment = await reconcileMainnetAttempt(client, journal, 'deploy')
      if (deployment.status !== 'confirmed' || !journal.contract || !journal.runtimeHash ||
          !same(deployment.contract, journal.contract) || !same(deployment.runtimeHash, journal.runtimeHash))
        return { status: 'unknown', findings: ['Canonical frozen deployment is not independently verified'] }
      if (step === 'execute') {
        const approval = await reconcileMainnetAttempt(client, journal, 'approve')
        if (approval.status !== 'confirmed') return { status: 'unknown', findings: ['Exact approval is not independently verified'] }
      }
    }
    const reader = grantEvidenceReader(client)
    const [transaction, receipt] = await Promise.all([reader.getTransaction(attempt.hash), reader.getReceipt(attempt.hash)])
    if (!transaction || !receipt) return { status: transaction && !receipt ? 'pending' : 'unknown', findings: ['Transaction or receipt unavailable'] }
    if (attempt.reviewedNonce !== undefined) {
      if (!Number.isSafeInteger(attempt.reviewedNonce) || !attempt.reviewedGasLimit || !attempt.reviewedMaxFee || !attempt.reviewedPriorityFee ||
          transaction.nonce !== attempt.reviewedNonce || transaction.type !== 'eip1559' ||
          transaction.gas > BigInt(attempt.reviewedGasLimit) || transaction.maxFeePerGas == null ||
          transaction.maxFeePerGas > BigInt(attempt.reviewedMaxFee) || transaction.maxPriorityFeePerGas == null ||
          transaction.maxPriorityFeePerGas > BigInt(attempt.reviewedPriorityFee))
        return { status: 'unknown', findings: ['Submitted nonce or fee exceeded the persisted exact review'] }
    }
    const block = await reader.getBlock(receipt.blockNumber)
    if (step === 'deploy') {
      const code = receipt.contractAddress ? await reader.getBytecode(receipt.contractAddress) : null
      const result = verifyGrantDeploymentEvidence({ payer: journal.terms.payer, recipientA: journal.terms.artist,
        recipientB: journal.terms.producer, demoId: journal.terms.demoId, hash: attempt.hash, transaction, receipt, block,
        runtimeCode: code, rpcChainId, expectedChainId: MAINNET_GRANT_CHAIN_ID,
        expectedDeploymentData: mainnetDeploymentData(journal.terms.payer, journal.terms.artist, journal.terms.producer, journal.terms.demoId) })
      return result.findings.length ? { status: receipt.status === 'reverted' ? 'failed' : 'unknown', findings: result.findings }
        : { status: 'confirmed', findings: [], contract: result.contract!, runtimeHash: result.runtimeHash! }
    }
    if (!journal.contract || !journal.runtimeHash) return { status: 'unknown', findings: ['Verified deployment identity missing'] }
    const runtime = await reader.getBytecode(journal.contract)
    if (!matchesFrozenGrantRuntime(runtime) || !runtime || keccak256(runtime) !== journal.runtimeHash)
      return { status: 'unknown', findings: ['Frozen runtime does not match verified deployment'] }
    if (step === 'approve') {
      const allowance = await client.readContract({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'allowance',
        args: [journal.terms.payer, journal.contract] })
      const findings = verifyExactApproval({ payer: journal.terms.payer, contract: journal.contract,
        hash: attempt.hash, transaction, receipt, block, allowance, rpcChainId,
        expectedChainId: MAINNET_GRANT_CHAIN_ID, expectedToken: MAINNET_GRANT_USDC, expectedAmount: MAINNET_GRANT_TOTAL,
        allowanceMayBeConsumed: !!journal.execute?.hash })
      return { status: findings.length ? receipt.status === 'reverted' ? 'failed' : 'unknown' : 'confirmed', findings }
    }
    const [payer, artist, producer, amountA, amountB, chain, demoId, executed, token] = await Promise.all([
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'payer' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'recipientA' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'recipientB' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'amountA' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'amountB' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'chainId' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'demoId' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'executed' }),
      client.readContract({ address: journal.contract, abi: grantSplitAbi, functionName: 'USDC' }),
    ])
    const terms: GrantSplitTerms = { contract: journal.contract, chainId: Number(chain), token, payer,
      recipientA: artist, recipientB: producer, amountA, amountB, demoId, executed: false }
    const expected = journal.terms
    const findings = validateGrantSplitTerms(terms, MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_USDC)
    if (!same(payer, expected.payer) || !same(artist, expected.artist) || !same(producer, expected.producer) ||
        !same(demoId, expected.demoId) || amountA !== MAINNET_GRANT_AMOUNTS[0] || amountB !== MAINNET_GRANT_AMOUNTS[1] || !executed)
      findings.push('Immutable split terms or executed state disagree with reviewed intent')
    if (findings.length) return { status: 'unknown', findings }
    const evidence = await readGrantPublicEvidence(reader, { terms, hash: attempt.hash,
      expectedChainId: MAINNET_GRANT_CHAIN_ID, expectedToken: MAINNET_GRANT_USDC,
      codeHash: keccak256(runtime), expectedCodeHash: journal.runtimeHash })
    return { status: evidence.status === 'confirmed' ? 'confirmed' : evidence.status === 'failed' ? 'failed' :
      evidence.status === 'pending' ? 'pending' : 'unknown', findings: evidence.findings }
  } catch { return { status: 'unknown', findings: ['RPC or chain evidence unavailable; do not retry'] } }
}
