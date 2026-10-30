import { encodeDeployData, encodeFunctionData, erc20Abi, getAddress, keccak256, sha256, toHex, type Address, type Hex } from 'viem'
import { GRANT_CREATION_BYTECODE, grantConstructorAbi, matchesFrozenGrantRuntime } from './frozenGrantSplitArtifact'
import { grantSplitAbi } from './grantSplitProtocol'

/** B2 owner-exception candidate for local verification only; never publish without Decision C. */
export const MAINNET_GRANT_WRITES_HARD_DISABLED = false as const
export const MAINNET_GRANT_CHAIN_ID = 5042 as const
export const MAINNET_GRANT_RPC = 'https://rpc.mainnet.arc.io' as const
export const MAINNET_GRANT_USDC = '0x3600000000000000000000000000000000000000' as const
export const MAINNET_GRANT_AMOUNTS = [100_000n, 200_000n] as const
export const MAINNET_GRANT_TOTAL = 300_000n
/** Owner-confirmed for preparation only; not a transaction authorization. */
export const MAINNET_PROPOSED_DEMO_ID = keccak256(toHex('track0-arc-grant-mainnet-2026-v1'))
/** Never load the Testnet wallet journal under a Mainnet review identity. */
export const MAINNET_REVIEW_NAMESPACE = 'track0-arc-grant-mainnet-review-v1:5042' as const
/** Owner-confirmed demo roles, not independent payees or proof of wallet control. */
export const MAINNET_PROPOSED_ROLES = Object.freeze({
  payer: getAddress('0x2213B580914Ee4A07a80b3C7e911950165FCAd6B'),
  artist: getAddress('0x3743716d3162a129AE4DCC7BCb49c2B8314D9EF9'),
  producer: getAddress('0x7106384E4f8430677cEb3CA43Cb5C50Cf615591a'),
})
export const MAINNET_PROPOSED_CEILINGS = {
  deploy: { gasLimit: 510_000n, maxFeePerGas: 40_000_000_000n },
  approve: { gasLimit: 71_000n, maxFeePerGas: 40_000_000_000n },
  execute: { gasLimit: 205_000n, maxFeePerGas: 40_000_000_000n },
} as const
export const MAINNET_GRANT_IDENTITY = {
  payer: MAINNET_PROPOSED_ROLES.payer,
  recipientA: MAINNET_PROPOSED_ROLES.artist,
  recipientB: MAINNET_PROPOSED_ROLES.producer,
  demoId: MAINNET_PROPOSED_DEMO_ID,
  contract: null,
  gasCeilings: MAINNET_PROPOSED_CEILINGS,
} as const

export type MainnetReviewBasis = {
  kind: 'independent_human' | 'owner_demo_exception'
  reference: string
  sourceCommit: string
  deploymentDataSha256: Hex
}

/** B1 preparation evidence only. B2 approval is deliberately absent. */
export const MAINNET_GRANT_RELEASE = {
  reviewBasis: {
    kind: 'owner_demo_exception',
    reference: 'release/MAINNET_OWNER_DECISION_A_2026-10-27.md#sha256:a8c30b0e81a4902bbcf5f8a5f5697b9da381f09173119ee93ef3fc734b05c815',
    sourceCommit: '81dcc2bedce7fde5d365e5a04809f10745ffdf25',
    deploymentDataSha256: '0xb1ff3f460f34f6832eea6393ef68413a6c1cd30d00ceba2d508e7d56b500a6b8',
  } as const satisfies MainnetReviewBasis,
  ownerActivationReference: 'release/MAINNET_OWNER_DECISION_B2_2026-10-30.md#sha256:3fb62ccc9ae3af596de9332a42615388ceedcfe0fe1ee7bc7567819c9261ab7c' as string | null,
  payerControlReference: 'Decision A owner statement + documented read-only MetaMask payer/5042 check; revalidate at signing',
  ownerRoleConfirmationReference: 'Decision A owner-controlled demo-wallet statement; not independent recipient control',
  ceilings: MAINNET_PROPOSED_CEILINGS,
} as const

export function mainnetGrantWalletActionsEnabled(): boolean {
  return !MAINNET_GRANT_WRITES_HARD_DISABLED && !!MAINNET_GRANT_RELEASE.ownerActivationReference &&
    mainnetReviewBasisMatchesTerms(MAINNET_GRANT_RELEASE.reviewBasis, MAINNET_PROPOSED_ROLES.payer,
      MAINNET_PROPOSED_ROLES.artist, MAINNET_PROPOSED_ROLES.producer, MAINNET_PROPOSED_DEMO_ID)
}

export type MainnetStep = 'deploy' | 'approve' | 'execute'
export interface MainnetCeiling { gasLimit: bigint; maxFeePerGas: bigint }
export interface MainnetReviewFacts {
  chainId: number
  walletChainId: number | null
  payer: Address | null
  demoId: Hex
  tokenDecimals: number | null
  tokenBalance: bigint | null
  nativeBalance: bigint | null
  allowance: bigint | null
  latestNonce: number | null
  pendingNonce: number | null
  estimatedGas: bigint | null
  quotedMaxFeePerGas: bigint | null
  priorityFeePerGas: bigint | null
  contract: Address | null
  runtimeCode: Hex | null
  reviewedRuntimeHash: Hex | null
  contractTermsMatch: boolean
  executed: boolean | null
  priorAttemptUnresolved: boolean
  ceilings: Record<MainnetStep, MainnetCeiling | null>
}

/** Same frozen bytecode; only the constructor's reviewed chain argument changes. */
export function mainnetDeploymentData(payer: Address, artist: Address, producer: Address, demoId: Hex): Hex {
  return encodeDeployData({ abi: grantConstructorAbi, bytecode: GRANT_CREATION_BYTECODE,
    args: [payer, artist, producer, MAINNET_GRANT_AMOUNTS[0], MAINNET_GRANT_AMOUNTS[1], BigInt(MAINNET_GRANT_CHAIN_ID), demoId] })
}

export function mainnetReviewBasisMatchesTerms(basis: MainnetReviewBasis | null, payer: Address, artist: Address,
  producer: Address, demoId: Hex): boolean {
  if (!basis || (basis.kind !== 'independent_human' && basis.kind !== 'owner_demo_exception') ||
      !basis.reference.trim() || !/^[0-9a-f]{40}$/i.test(basis.sourceCommit)) return false
  try {
    return basis.deploymentDataSha256.toLowerCase() === sha256(mainnetDeploymentData(payer, artist, producer, demoId)).toLowerCase()
  } catch { return false }
}

export function mainnetCalldata(step: MainnetStep, contract: Address | null): Hex | null {
  if (step === 'deploy') return null
  if (!contract) return null
  return step === 'approve'
    ? encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [contract, MAINNET_GRANT_TOTAL] })
    : encodeFunctionData({ abi: grantSplitAbi, functionName: 'execute' })
}

export function mainnetReviewKey(payer: Address, demoId: Hex): string {
  return `${MAINNET_REVIEW_NAMESPACE}:${payer.toLowerCase()}:${demoId.toLowerCase()}`
}

/** This record is a local safety locator, never authoritative payment evidence. */
export function mainnetAttemptBlocked(storage: Pick<Storage, 'getItem'>, payer: Address, demoId: Hex): boolean {
  try { return storage.getItem(mainnetReviewKey(payer, demoId)) !== null } catch { return true }
}

export function mainnetMaximumExposure(ceilings: Record<MainnetStep, MainnetCeiling | null>): bigint | null {
  if (!ceilings.deploy || !ceilings.approve || !ceilings.execute) return null
  return MAINNET_GRANT_TOTAL * 1_000_000_000_000n +
    ceilings.deploy.gasLimit * ceilings.deploy.maxFeePerGas +
    ceilings.approve.gasLimit * ceilings.approve.maxFeePerGas +
    ceilings.execute.gasLimit * ceilings.execute.maxFeePerGas
}

export function assessMainnetReview(step: MainnetStep, facts: MainnetReviewFacts, releaseAuthorized = false): {
  findings: string[]; to: Address | null; data: Hex | null; dataSha256: Hex | null; value: bigint;
  maximumExposure: bigint | null; maximumStageFee: bigint | null
} {
  const findings: string[] = []
  const { payer, contract, demoId, ceilings } = facts
  if (facts.chainId !== MAINNET_GRANT_CHAIN_ID) findings.push('Wrong chain: Arc Mainnet 5042 required')
  if (facts.walletChainId !== MAINNET_GRANT_CHAIN_ID) findings.push('Connected wallet is not on Arc Mainnet 5042')
  if (!payer || payer.toLowerCase() !== MAINNET_PROPOSED_ROLES.payer.toLowerCase()) findings.push('Connected payer is not the proposed Mainnet payer')
  if (demoId.toLowerCase() !== MAINNET_PROPOSED_DEMO_ID.toLowerCase()) findings.push('Mainnet demo ID differs from the proposal')
  if (facts.tokenDecimals !== 6) findings.push('USDC ERC-20 decimals are not verified as six')
  if (facts.latestNonce === null || facts.pendingNonce === null || facts.latestNonce !== facts.pendingNonce)
    findings.push('Nonce unavailable or a pending transaction exists')
  if (facts.priorAttemptUnresolved) findings.push('A previous Mainnet attempt is unresolved; reconcile its hash and nonce first')
  const maximumExposure = mainnetMaximumExposure(ceilings)
  if (maximumExposure === null) findings.push('All three gas limits and fee ceilings require owner review')
  if (facts.tokenBalance === null || facts.tokenBalance < MAINNET_GRANT_TOTAL) findings.push('Insufficient or unverified ERC-20 USDC balance')
  if (facts.nativeBalance === null || maximumExposure === null || facts.nativeBalance < maximumExposure)
    findings.push('Insufficient or unverified native USDC balance for maximum aggregate exposure')
  if (step !== 'deploy') {
    if (!contract || !matchesFrozenGrantRuntime(facts.runtimeCode) || !facts.reviewedRuntimeHash ||
        !facts.runtimeCode || keccak256(facts.runtimeCode) !== facts.reviewedRuntimeHash || !facts.contractTermsMatch)
      findings.push('Reviewed Mainnet contract address, runtime and immutable terms are not verified')
    if (facts.executed !== false) findings.push('Contract is executed or its single-use state is unavailable')
    if (step === 'approve' && facts.allowance !== 0n) findings.push('Approval requires zero prior allowance')
    if (step === 'execute' && facts.allowance !== MAINNET_GRANT_TOTAL) findings.push('Execute requires exactly 300000 units of allowance')
  } else if (contract) findings.push('A Mainnet contract is already selected; do not deploy again')
  const ceiling = ceilings[step]
  if (!ceiling || ceiling.gasLimit <= 0n || ceiling.maxFeePerGas <= 0n) findings.push('Reviewed stage gas and fee ceilings are missing')
  if (facts.estimatedGas === null || !ceiling || facts.estimatedGas > ceiling.gasLimit) findings.push('Live gas estimate unavailable or exceeds ceiling')
  if (facts.quotedMaxFeePerGas === null || facts.priorityFeePerGas === null || !ceiling ||
      facts.quotedMaxFeePerGas > ceiling.maxFeePerGas || facts.priorityFeePerGas > ceiling.maxFeePerGas)
    findings.push('Live EIP-1559 fee quote unavailable or exceeds ceiling')
  // Grant-specific release readiness and live transaction-specific review remain mandatory.
  if (!releaseAuthorized) {
    findings.push('Grant-specific release readiness and transaction-specific authorization are not approved')
    findings.push('Mainnet transaction submission remains blocked without release readiness')
  }
  const data = step === 'deploy' && payer ? mainnetDeploymentData(payer, MAINNET_PROPOSED_ROLES.artist, MAINNET_PROPOSED_ROLES.producer, demoId)
    : mainnetCalldata(step, contract)
  return { findings, to: step === 'deploy' ? null : step === 'approve' ? MAINNET_GRANT_USDC : contract,
    data, dataSha256: data ? sha256(data) : null, value: 0n, maximumExposure,
    maximumStageFee: ceiling ? ceiling.gasLimit * ceiling.maxFeePerGas : null }
}
