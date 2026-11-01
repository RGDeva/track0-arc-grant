import { erc20Abi, keccak256, sha256, type Address, type Hex, type PublicClient, type Transaction } from 'viem'
import { grantSplitAbi, validateGrantSplitTerms, type GrantSplitTerms } from './grantSplitProtocol'
import { matchesFrozenGrantRuntime } from './frozenGrantSplitArtifact'
import { assessMainnetReview, MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_IDENTITY, MAINNET_GRANT_RELEASE,
  MAINNET_GRANT_TOTAL, MAINNET_GRANT_USDC, MAINNET_GRANT_WRITES_HARD_DISABLED, MAINNET_PROPOSED_ROLES,
  MAINNET_GRANT_MAX_PRIORITY_FEE_PER_GAS, mainnetRequestedPriorityFee,
  mainnetMaximumExposure, mainnetReviewBasisMatchesTerms, type MainnetCeiling, type MainnetReviewFacts, type MainnetStep } from './grantMainnetCandidate'
import { beginMainnetAttempt, prepareMainnetRequest, readMainnetJournal, reconcileMainnetAttempt,
  transitionMainnetAttempt, type MainnetJournal, type MainnetPreparedRequest, type MainnetStorage,
  type MainnetTerms } from './mainnetWalletWorkflow'
import { mainnetReviewFingerprint } from './mainnetReviewFingerprint'
export { mainnetReviewFingerprint } from './mainnetReviewFingerprint'

/** No implementation in the current public app calls this while the source release record is unset. */
export interface MainnetWalletPort {
  providerId: string
  getAddresses(): Promise<readonly Address[]>
  getChainId(): Promise<number>
  sendTransaction(request: MainnetPreparedRequest & { nonce: number }): Promise<Hex>
}
export interface MainnetSubmissionReview {
  step: MainnetStep
  terms: MainnetTerms
  facts: MainnetReviewFacts
  request: MainnetPreparedRequest
  nonce: number
  aggregateMaximum: bigint
  /** Owner-approved review fingerprint, recomputed from a fresh preflight before any wallet request. */
  fingerprint: Hex
}
export interface MainnetSenderPorts {
  client: PublicClient
  wallet: MainnetWalletPort
  storage: MainnetStorage
  withOriginLock<T>(key: string, action: () => Promise<T>): Promise<T>
  now(): number
}
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const canonical = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)

export function assertMainnetRelease(terms: MainnetTerms, ceilings: MainnetReviewFacts['ceilings']): void {
  if (MAINNET_GRANT_WRITES_HARD_DISABLED) throw new Error('Mainnet transaction submission is hard-disabled in source')
  if (!mainnetReviewBasisMatchesTerms(MAINNET_GRANT_RELEASE.reviewBasis, terms.payer, terms.artist, terms.producer, terms.demoId) ||
      !MAINNET_GRANT_RELEASE.ownerActivationReference || !MAINNET_GRANT_RELEASE.payerControlReference ||
      !MAINNET_GRANT_RELEASE.ownerRoleConfirmationReference ||
      !MAINNET_GRANT_RELEASE.ceilings || !MAINNET_GRANT_IDENTITY.payer || !MAINNET_GRANT_IDENTITY.recipientA ||
      !MAINNET_GRANT_IDENTITY.recipientB || !MAINNET_GRANT_IDENTITY.demoId)
    throw new Error('Source-reviewed human activation, role consent and all spending ceilings are missing')
  if (!same(terms.payer, MAINNET_GRANT_IDENTITY.payer) || !same(terms.artist, MAINNET_GRANT_IDENTITY.recipientA) ||
      !same(terms.producer, MAINNET_GRANT_IDENTITY.recipientB) || !same(terms.demoId, MAINNET_GRANT_IDENTITY.demoId) ||
      !same(terms.payer, MAINNET_PROPOSED_ROLES.payer) || !same(terms.artist, MAINNET_PROPOSED_ROLES.artist) ||
      !same(terms.producer, MAINNET_PROPOSED_ROLES.producer) || canonical(ceilings) !== canonical(MAINNET_GRANT_RELEASE.ceilings))
    throw new Error('Mainnet terms or limits differ from the source-reviewed activation')
}

/** A wallet can change gas or nonce in its confirmation UI; never silently accept the changed transaction. */
export function verifyMainnetSubmittedEnvelope(transaction: Transaction | null, hash: Hex,
  request: MainnetPreparedRequest, nonce: number): string[] {
  if (!transaction) return ['Submitted transaction is not yet available from RPC']
  const findings: string[] = []
  if (!same(transaction.hash, hash) || !same(transaction.from, request.from) || transaction.chainId !== request.chainId ||
      !same(transaction.to, request.to) && !(transaction.to === null && request.to === undefined))
    findings.push('Submitted transaction identity, chain, payer or destination changed')
  if (!same(transaction.input, request.data) || transaction.value !== 0n || transaction.nonce !== nonce)
    findings.push('Submitted calldata, value or nonce changed')
  if (transaction.type !== 'eip1559' || transaction.gas > request.gas || transaction.maxFeePerGas == null ||
      transaction.maxFeePerGas > request.maxFeePerGas || transaction.maxPriorityFeePerGas == null ||
      transaction.maxPriorityFeePerGas > request.maxPriorityFeePerGas ||
      transaction.maxPriorityFeePerGas > MAINNET_GRANT_MAX_PRIORITY_FEE_PER_GAS ||
      transaction.maxPriorityFeePerGas > transaction.maxFeePerGas)
    findings.push('Submitted gas type or fee exceeds the exact reviewed ceiling')
  return findings
}

async function freshFacts(ports: MainnetSenderPorts, review: MainnetSubmissionReview, journal: MainnetJournal | null): Promise<MainnetReviewFacts> {
  const { client, wallet } = ports
  const { terms, step } = review
  if (wallet.providerId !== 'io.metamask') throw new Error('Selected provider is not EIP-6963 MetaMask')
  const [chainId, walletChainId, accounts, decimals, tokenBalance, nativeBalance, latestNonce, pendingNonce, fee, block] = await Promise.all([
    client.getChainId(), wallet.getChainId(), wallet.getAddresses(),
    client.readContract({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [terms.payer] }),
    client.getBalance({ address: terms.payer }), client.getTransactionCount({ address: terms.payer, blockTag: 'latest' }),
    client.getTransactionCount({ address: terms.payer, blockTag: 'pending' }), client.estimateFeesPerGas(), client.getBlock({ blockTag: 'latest' }),
  ])
  if (!same(accounts[0], terms.payer)) throw new Error('Active MetaMask account is not the reviewed payer')
  const contract = journal?.contract ?? null
  let runtimeCode: Hex | null = null
  let contractTermsMatch = false
  let executed: boolean | null = null
  let allowance: bigint | null = null
  if (step !== 'deploy') {
    if (!journal || !contract || !journal.runtimeHash) throw new Error('Verified deployment required')
    const deployed = await reconcileMainnetAttempt(client, journal, 'deploy')
    if (deployed.status !== 'confirmed' || !same(deployed.contract, contract) || !same(deployed.runtimeHash, journal.runtimeHash))
      throw new Error('Original deployment is not canonically verified')
    if (step === 'execute' && (await reconcileMainnetAttempt(client, journal, 'approve')).status !== 'confirmed')
      throw new Error('Original exact approval is not canonically verified')
    const [code, payer, artist, producer, amountA, amountB, contractChain, demoId, state, token, currentAllowance] = await Promise.all([
      client.getBytecode({ address: contract }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'payer' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'recipientA' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'recipientB' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'amountA' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'amountB' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'chainId' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'demoId' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'executed' }),
      client.readContract({ address: contract, abi: grantSplitAbi, functionName: 'USDC' }),
      client.readContract({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'allowance', args: [terms.payer, contract] }),
    ])
    runtimeCode = code ?? null; executed = state; allowance = currentAllowance
    const chainTerms: GrantSplitTerms = { contract, payer, recipientA: artist, recipientB: producer,
      amountA, amountB, chainId: Number(contractChain), demoId, token, executed: false }
    contractTermsMatch = !!code && matchesFrozenGrantRuntime(code) && keccak256(code) === journal.runtimeHash &&
      validateGrantSplitTerms(chainTerms, MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_USDC).length === 0 &&
      same(payer, terms.payer) && same(artist, terms.artist) && same(producer, terms.producer) && same(demoId, terms.demoId)
  }
  const estimatedGas = step === 'deploy'
    ? await client.estimateGas({ account: terms.payer, data: review.request.data })
    : step === 'approve'
      ? await client.estimateContractGas({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'approve', args: [contract!, MAINNET_GRANT_TOTAL], account: terms.payer })
      : await client.estimateContractGas({ address: contract!, abi: grantSplitAbi, functionName: 'execute', account: terms.payer })
  return { chainId, walletChainId, payer: accounts[0] ?? null, demoId: terms.demoId, tokenDecimals: decimals,
    tokenBalance, nativeBalance, allowance, latestNonce, pendingNonce, estimatedGas,
    quotedMaxFeePerGas: fee.maxFeePerGas ?? null, baseFeePerGas: block.baseFeePerGas ?? null,
    priorityFeePerGas: fee.maxPriorityFeePerGas ?? null,
    contract, runtimeCode, reviewedRuntimeHash: journal?.runtimeHash ?? null, contractTermsMatch, executed,
    priorAttemptUnresolved: !!journal?.[step], ceilings: review.facts.ceilings }
}

/** Exact-click sender, deliberately unreachable in the current hard-disabled build. No automatic retry. */
export async function submitReviewedMainnetStep(ports: MainnetSenderPorts, review: MainnetSubmissionReview): Promise<{ hash: Hex; status: string }> {
  assertMainnetRelease(review.terms, review.facts.ceilings)
  return ports.withOriginLock(`track0-mainnet:5042:${review.terms.payer.toLowerCase()}:${review.terms.demoId.toLowerCase()}`, async () => {
    const prior = readMainnetJournal(ports.storage, review.terms)
    if (review.step === 'deploy' && prior) throw new Error('A Mainnet deployment intent already exists')
    if (review.step !== 'deploy' && !prior) throw new Error('No original deployment journal')
    const facts = await freshFacts(ports, review, prior)
    const assessment = assessMainnetReview(review.step, facts, true)
    if (assessment.findings.length) throw new Error(assessment.findings.join('; '))
    if (canonical(facts) !== canonical(review.facts) || review.nonce !== facts.latestNonce ||
        review.aggregateMaximum !== mainnetMaximumExposure(facts.ceilings))
      throw new Error('Fresh transaction preflight differs from the owner-reviewed snapshot')
    const ceiling: MainnetCeiling = facts.ceilings[review.step]!
    const request = prepareMainnetRequest(review.step, review.terms, prior, ceiling, mainnetRequestedPriorityFee(facts.priorityFeePerGas!))
    const { fingerprint: _fingerprint, ...reviewBody } = review
    if (canonical(request) !== canonical(review.request) ||
        mainnetReviewFingerprint({ ...reviewBody, request, facts }) !== review.fingerprint ||
        assessment.dataSha256 !== sha256(request.data) || !same(assessment.to, request.to) && !(assessment.to === null && request.to === undefined))
      throw new Error('Calldata, destination or transaction review changed')
    const [latestAgain, pendingAgain, walletChainAgain, accountsAgain] = await Promise.all([
      ports.client.getTransactionCount({ address: review.terms.payer, blockTag: 'latest' }),
      ports.client.getTransactionCount({ address: review.terms.payer, blockTag: 'pending' }),
      ports.wallet.getChainId(), ports.wallet.getAddresses(),
    ])
    if (latestAgain !== review.nonce || pendingAgain !== review.nonce || walletChainAgain !== MAINNET_GRANT_CHAIN_ID ||
        !same(accountsAgain[0], review.terms.payer)) throw new Error('Nonce, chain or signer changed just before wallet authorization')
    const current = beginMainnetAttempt(ports.storage, prior ?? { version: 1, chainId: MAINNET_GRANT_CHAIN_ID, terms: review.terms }, review.step, ports.now(),
      { nonce: review.nonce, request })
    let hash: Hex | undefined
    try {
      hash = await ports.wallet.sendTransaction({ ...request, nonce: review.nonce })
      const submitted = transitionMainnetAttempt(ports.storage, current, review.step, 'submitted', ports.now(), hash)
      const envelopeFindings = verifyMainnetSubmittedEnvelope(await ports.client.getTransaction({ hash }), hash, request, review.nonce)
      if (envelopeFindings.length) {
        transitionMainnetAttempt(ports.storage, submitted, review.step, 'unknown', ports.now(), hash)
        return { hash, status: 'unknown' }
      }
      const result = await reconcileMainnetAttempt(ports.client, submitted, review.step)
      if (result.status === 'confirmed') transitionMainnetAttempt(ports.storage, submitted, review.step, 'confirmed', ports.now(), hash)
      else if (result.status === 'unknown' || result.status === 'failed')
        transitionMainnetAttempt(ports.storage, submitted, review.step, result.status, ports.now(), hash)
      return { hash, status: result.status }
    } catch (cause) {
      const rejection = !hash && isExplicitRejection(cause)
      transitionMainnetAttempt(ports.storage, current, review.step, rejection ? 'rejected' : 'unknown', ports.now(), hash)
      throw cause
    }
  })
}

function isExplicitRejection(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const error = cause as { code?: unknown; name?: unknown; cause?: unknown }
  return error.code === 4001 || error.name === 'UserRejectedRequestError' || isExplicitRejection(error.cause)
}
