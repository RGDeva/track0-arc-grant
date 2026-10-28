import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createConfig, http, injected, WagmiProvider, useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { arc } from 'viem/chains'
import { createPublicClient, erc20Abi, formatUnits, keccak256, type Address, type Hex } from 'viem'
import { ARC_NETWORKS } from '../src/lib/arcNetwork'
import { GRANT_CREATION_SHA256, matchesFrozenGrantRuntime } from '../src/grant/frozenGrantSplitArtifact'
import { GrantSplitPublicEvidence } from '../src/grant/GrantSplitEvidenceView'
import { grantSplitAbi, validateGrantSplitTerms, type GrantSplitTerms } from '../src/grant/grantSplitProtocol'
import { readMainnetJournal, reconcileMainnetAttempt, saveMainnetJournal, transitionMainnetAttempt,
  prepareMainnetRequest, type MainnetJournal } from '../src/grant/mainnetWalletWorkflow'
import { submitReviewedMainnetStep, type MainnetSubmissionReview } from '../src/grant/mainnetSender'
import { mainnetReviewFingerprint } from '../src/grant/mainnetReviewFingerprint'
import { useMainnetWalletPort } from '../src/grant/useMainnetWalletPort'
import { readMainnetPublicCandidate } from '../src/grant/mainnetPublicCandidate'
import { assessMainnetReview, mainnetAttemptBlocked, MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_TOTAL, MAINNET_GRANT_USDC,
  MAINNET_PROPOSED_DEMO_ID, MAINNET_PROPOSED_ROLES, MAINNET_GRANT_WRITES_HARD_DISABLED, MAINNET_GRANT_RELEASE,
  mainnetMaximumExposure,
  mainnetDeploymentData, mainnetReviewBasisMatchesTerms, type MainnetReviewFacts, type MainnetStep } from '../src/grant/grantMainnetCandidate'
import '../src/index.css'

const config = createConfig({ chains: [arc], connectors: [injected()], transports: { [arc.id]: http('https://rpc.mainnet.arc.io') }, multiInjectedProviderDiscovery: true })
const client = createPublicClient({ chain: arc, transport: http('https://rpc.mainnet.arc.io') })
const query = new URLSearchParams(window.location.search)
// A contract or receipt supplied by a URL is never a reviewed Mainnet identity.
const steps: MainnetStep[] = ['deploy', 'approve', 'execute']
const queryContract = query.get('contract')

function App() {
  const { address, chainId, connector } = useAccount()
  const walletPort = useMainnetWalletPort(connector?.id)
  const { connect, connectors, isPending, error: connectionError } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const metaMask = connectors.find((item) => item.id === 'io.metamask' && item.name === 'MetaMask')
  const [facts, setFacts] = useState<Partial<MainnetReviewFacts>>({})
  const [terms, setTerms] = useState<GrantSplitTerms | null>(null)
  const [runtimeHash, setRuntimeHash] = useState<Hex | null>(null)
  const [publicCandidate, setPublicCandidate] = useState<{ terms: GrantSplitTerms; codeHash: Hex } | null>(null)
  const [trustedDeployment, setTrustedDeployment] = useState<{ payer: Address; revision: number; contract: Address; runtimeHash: Hex } | null>(null)
  const [journal, setJournal] = useState<MainnetJournal | null>(null)
  const [recoveryStatus, setRecoveryStatus] = useState('No Mainnet transaction has been submitted by this candidate.')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [step, setStep] = useState<MainnetStep>('deploy')
  const [gasObservation, setGasObservation] = useState<{ key: string; value: bigint | null } | null>(null)
  const [submissionReview, setSubmissionReview] = useState<MainnetSubmissionReview | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const gasKey = `${address ?? 'none'}:${step}:${revision}`
  const estimatedGas = gasObservation?.key === gasKey ? gasObservation.value : null
  const reviewedContract = trustedDeployment && trustedDeployment.payer.toLowerCase() === address?.toLowerCase() && trustedDeployment.revision === revision
    ? trustedDeployment.contract : null
  const reviewedRuntimeHash = reviewedContract ? trustedDeployment?.runtimeHash ?? null : null

  useEffect(() => {
    let active = true
    if (!address || address.toLowerCase() !== MAINNET_PROPOSED_ROLES.payer.toLowerCase()) return () => { active = false }
    void (async () => {
      try {
        const proposed = { payer: MAINNET_PROPOSED_ROLES.payer, artist: MAINNET_PROPOSED_ROLES.artist,
          producer: MAINNET_PROPOSED_ROLES.producer, demoId: MAINNET_PROPOSED_DEMO_ID }
        let current = readMainnetJournal(window.localStorage, proposed)
        if (!active || !current) return
        setJournal(current)
        for (const stage of steps) {
          if (!current[stage]?.hash) continue
          const result = await reconcileMainnetAttempt(client, current, stage)
          if (!active) return
          if (stage === 'deploy' && result.status === 'confirmed' && result.contract && result.runtimeHash) {
            current = { ...current, contract: result.contract, runtimeHash: result.runtimeHash }
            saveMainnetJournal(window.localStorage, current)
            setTrustedDeployment({ payer: address, revision, contract: result.contract, runtimeHash: result.runtimeHash })
          }
          if (result.status === 'confirmed' && current[stage]?.state !== 'confirmed')
            current = transitionMainnetAttempt(window.localStorage, current, stage, 'confirmed', Date.now(), current[stage]?.hash)
          setJournal(current)
          setRecoveryStatus(`${stage.toUpperCase()}: ${result.status.toUpperCase()} — ${result.findings.join('; ') || 'canonical RPC checks passed'}`)
          if (result.status !== 'confirmed') break
        }
      } catch { if (active) setRecoveryStatus('UNKNOWN — local record or RPC evidence unavailable; no retry permitted') }
    })()
    return () => { active = false }
  }, [address, revision])

  useEffect(() => {
    if (!queryContract || !query.get('tx')) return
    let active = true
    void readMainnetPublicCandidate(client, queryContract).then((candidate) => {
      if (active) setPublicCandidate(candidate)
    }).catch(() => { if (active) setPublicCandidate(null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [rpcChain, decimals, tokenBalance, nativeBalance, latestNonce, pendingNonce, fee] = await Promise.all([
          client.getChainId(), client.readContract({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'decimals' }),
          address ? client.readContract({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) : Promise.resolve(null),
          address ? client.getBalance({ address }) : Promise.resolve(null),
          address ? client.getTransactionCount({ address, blockTag: 'latest' }) : Promise.resolve(null),
          address ? client.getTransactionCount({ address, blockTag: 'pending' }) : Promise.resolve(null), client.estimateFeesPerGas(),
        ])
        let observedTerms: GrantSplitTerms | null = null
        let codeHash: Hex | null = null
        let code: Hex | null = null
        if (reviewedContract) {
          const [runtime, payer, artist, producer, amountA, amountB, contractChain, demoId, executed, token] = await Promise.all([
            client.getBytecode({ address: reviewedContract }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'payer' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'recipientA' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'recipientB' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'amountA' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'amountB' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'chainId' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'demoId' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'executed' }),
            client.readContract({ address: reviewedContract, abi: grantSplitAbi, functionName: 'USDC' }),
          ])
          code = runtime ?? null
          if (code && matchesFrozenGrantRuntime(code)) codeHash = keccak256(code)
          observedTerms = { contract: reviewedContract, chainId: Number(contractChain), token, payer, recipientA: artist,
            recipientB: producer, amountA, amountB, demoId, executed }
        }
        const allowance = address && reviewedContract
          ? await client.readContract({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'allowance', args: [address, reviewedContract] }) : null
        if (!active) return
        setTerms(observedTerms); setRuntimeHash(codeHash)
        setFacts({ chainId: rpcChain, payer: address ?? null, demoId: MAINNET_PROPOSED_DEMO_ID, tokenDecimals: decimals,
          tokenBalance, nativeBalance, latestNonce, pendingNonce, quotedMaxFeePerGas: fee.maxFeePerGas ?? null,
          priorityFeePerGas: fee.maxPriorityFeePerGas ?? null, contract: reviewedContract, runtimeCode: code,
          contractTermsMatch: !!observedTerms && validateGrantSplitTerms({ ...observedTerms, executed: false }, MAINNET_GRANT_CHAIN_ID, MAINNET_GRANT_USDC).length === 0 &&
            observedTerms.payer.toLowerCase() === MAINNET_PROPOSED_ROLES.payer.toLowerCase() &&
            observedTerms.recipientA.toLowerCase() === MAINNET_PROPOSED_ROLES.artist.toLowerCase() &&
            observedTerms.recipientB.toLowerCase() === MAINNET_PROPOSED_ROLES.producer.toLowerCase() &&
            observedTerms.demoId.toLowerCase() === MAINNET_PROPOSED_DEMO_ID.toLowerCase() && codeHash === reviewedRuntimeHash,
          executed: observedTerms?.executed ?? null, allowance,
        })
        setError(null)
      } catch (cause) { if (active) { setFacts({}); setTerms(null); setRuntimeHash(null); setError(cause instanceof Error ? cause.message : 'Mainnet RPC unavailable') } }
    })()
    return () => { active = false }
  }, [address, revision, reviewedContract, reviewedRuntimeHash])

  useEffect(() => {
    if (!address || facts.chainId !== MAINNET_GRANT_CHAIN_ID) return
    let active = true
    void (async () => {
      try {
        const estimate = step === 'deploy'
          ? await client.estimateGas({ account: address, data: mainnetDeploymentData(address, MAINNET_PROPOSED_ROLES.artist, MAINNET_PROPOSED_ROLES.producer, MAINNET_PROPOSED_DEMO_ID) })
          : step === 'approve' && reviewedContract
            ? await client.estimateContractGas({ address: MAINNET_GRANT_USDC, abi: erc20Abi, functionName: 'approve', args: [reviewedContract, MAINNET_GRANT_TOTAL], account: address })
            : step === 'execute' && reviewedContract
              ? await client.estimateContractGas({ address: reviewedContract, abi: grantSplitAbi, functionName: 'execute', account: address }) : null
        if (active) setGasObservation({ key: gasKey, value: estimate })
      } catch { if (active) setGasObservation({ key: gasKey, value: null }) }
    })()
    return () => { active = false }
  }, [address, facts.chainId, step, revision, gasKey, reviewedContract])

  const reviewFacts = useMemo((): MainnetReviewFacts => ({
    chainId: facts.chainId ?? -1, walletChainId: chainId ?? null, payer: address ?? null, demoId: MAINNET_PROPOSED_DEMO_ID,
    tokenDecimals: facts.tokenDecimals ?? null, tokenBalance: facts.tokenBalance ?? null,
    nativeBalance: facts.nativeBalance ?? null, allowance: facts.allowance ?? null,
    latestNonce: facts.latestNonce ?? null, pendingNonce: facts.pendingNonce ?? null,
    estimatedGas, quotedMaxFeePerGas: facts.quotedMaxFeePerGas ?? null,
    priorityFeePerGas: facts.priorityFeePerGas ?? null, contract: reviewedContract,
    runtimeCode: facts.runtimeCode ?? null, reviewedRuntimeHash, contractTermsMatch: facts.contractTermsMatch ?? false,
    executed: facts.executed ?? null,
    priorAttemptUnresolved: address ? (() => { try { return MAINNET_GRANT_WRITES_HARD_DISABLED
      ? mainnetAttemptBlocked(window.localStorage, address, MAINNET_PROPOSED_DEMO_ID) : !!journal?.[step] } catch { return true } })() : false,
    ceilings: MAINNET_GRANT_RELEASE.ceilings ?? { deploy: null, approve: null, execute: null },
  }), [address, chainId, facts, estimatedGas, step, reviewedContract, reviewedRuntimeHash, journal])
  const releaseReady = !MAINNET_GRANT_WRITES_HARD_DISABLED &&
    mainnetReviewBasisMatchesTerms(MAINNET_GRANT_RELEASE.reviewBasis, MAINNET_PROPOSED_ROLES.payer,
      MAINNET_PROPOSED_ROLES.artist, MAINNET_PROPOSED_ROLES.producer, MAINNET_PROPOSED_DEMO_ID) &&
    !!MAINNET_GRANT_RELEASE.ownerActivationReference && !!MAINNET_GRANT_RELEASE.payerControlReference &&
    !!MAINNET_GRANT_RELEASE.ownerRoleConfirmationReference &&
    !!MAINNET_GRANT_RELEASE.ceilings
  const review = useMemo(() => assessMainnetReview(step, reviewFacts, releaseReady), [step, reviewFacts, releaseReady])

  function prepareSubmissionReview() {
    try {
      if (MAINNET_GRANT_WRITES_HARD_DISABLED || !MAINNET_GRANT_RELEASE.ceilings || !address ||
          !connector || connector.id !== 'io.metamask' || !walletPort || review.findings.length)
        throw new Error('Mainnet release approval, payer and exact live review are required')
      const ceiling = reviewFacts.ceilings[step]
      if (!ceiling || reviewFacts.latestNonce === null || reviewFacts.priorityFeePerGas === null)
        throw new Error('Reviewed gas ceiling, nonce and fee quote are missing')
      const terms = { payer: MAINNET_PROPOSED_ROLES.payer, artist: MAINNET_PROPOSED_ROLES.artist,
        producer: MAINNET_PROPOSED_ROLES.producer, demoId: MAINNET_PROPOSED_DEMO_ID }
      const request = prepareMainnetRequest(step, terms, journal, ceiling, reviewFacts.priorityFeePerGas)
      const aggregateMaximum = mainnetMaximumExposure(reviewFacts.ceilings)
      if (aggregateMaximum === null) throw new Error('Aggregate spending ceiling is missing')
      const body = { step, terms, facts: reviewFacts, request, nonce: reviewFacts.latestNonce, aggregateMaximum }
      setSubmissionReview({ ...body, fingerprint: mainnetReviewFingerprint(body) })
      setError(null)
    } catch (cause) { setSubmissionReview(null); setError(cause instanceof Error ? cause.message : 'Review unavailable') }
  }

  async function authorizeSubmission() {
    if (!submissionReview || !walletPort || !connector || connector.id !== 'io.metamask' || submitting) return
    setSubmitting(true)
    try {
      const result = await submitReviewedMainnetStep({ client, storage: window.localStorage,
        now: () => Date.now(),
        withOriginLock: async (key, action) => {
          if (!navigator.locks?.request) throw new Error('Browser Lock Manager unavailable; submission disabled')
          return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, (lock) => {
            if (!lock) throw new Error('Another Mainnet wallet request is already active')
            return action()
          })
        },
        wallet: walletPort,
      }, submissionReview)
      setRecoveryStatus(`${submissionReview.step.toUpperCase()}: ${result.status.toUpperCase()} · ${result.hash}`)
      setRevision((value) => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNKNOWN wallet outcome; reconcile the original nonce') }
    finally { setSubmissionReview(null); setSubmitting(false) }
  }

  return <main className="mx-auto max-w-3xl px-4 pb-24 pt-12" style={{ color: 'var(--ink)' }}>
    <header className="grant-hero rounded-3xl p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-widest">Track0 × Arc · Mainnet release candidate</p>
      <h1 className="display mt-3 text-3xl font-bold">A payment you can review before it exists.</h1>
      <p className="mt-3 text-sm">Proposed operator-funded split: artist 0.10 USDC, producer 0.20 USDC. No Mainnet contract or payment has been confirmed. This is not a royalty settlement.</p>
      <div className="grant-hero-facts mt-5 flex flex-wrap gap-2 text-xs"><span>Arc Mainnet · 5042</span><span>0.30 USDC proposed</span><span>Wallet writes hard-disabled</span></div>
    </header>
    <section className="mt-6 rounded-2xl p-5" style={{ background: 'var(--surface)' }}>
      <h2 className="font-semibold">1. Public, pinned payment terms</h2>
      <p className="mono mt-2 break-all text-xs">Proposed payer {MAINNET_PROPOSED_ROLES.payer}</p>
      <p className="mono mt-1 break-all text-xs">Artist {MAINNET_PROPOSED_ROLES.artist} · 100000 base units</p>
      <p className="mono mt-1 break-all text-xs">Producer {MAINNET_PROPOSED_ROLES.producer} · 200000 base units</p>
      <p className="mono mt-1 break-all text-xs">Proposed Mainnet demo ID {MAINNET_PROPOSED_DEMO_ID}</p>
      <p className="mono mt-1 break-all text-xs">USDC ERC-20 {MAINNET_GRANT_USDC} · 6 decimals; native gas uses 18 decimals</p>
      <p className="mt-2 text-xs">The owner confirmed these three owner-controlled demonstration wallets and demo ID for review, not for a transaction. They are not independent artist or producer accounts; wallet control has not been independently verified. Visitors cannot edit them.</p>
    </section>
    <section className="mt-5 rounded-2xl p-5" style={{ background: 'var(--surface)' }}>
      <h2 className="font-semibold">2. Connect the proposed payer for read-only review</h2>
      <button className="mt-3 rounded-xl border px-3 py-2 text-xs" disabled={!address && (!metaMask || isPending)} onClick={() => { setSubmissionReview(null); if (address) disconnect(); else if (metaMask) connect({ connector: metaMask }) }}>{address ? 'Disconnect wallet' : 'Connect MetaMask'}</button>
      {address && chainId !== MAINNET_GRANT_CHAIN_ID && <button className="ml-2 rounded-xl border px-3 py-2 text-xs" onClick={() => { setSubmissionReview(null); switchChain({ chainId: MAINNET_GRANT_CHAIN_ID }) }}>Request Arc Mainnet switch</button>}
      {connectionError && <p role="alert" className="mt-2 text-xs">Wallet connection was not completed. No financial request was made.</p>}
      <p className="mono mt-2 break-all text-xs">Connected {address ?? 'UNSET'} · wallet chain {chainId ?? 'UNSET'} · RPC chain {facts.chainId ?? 'UNVERIFIED'}</p>
      <p className="mt-1 text-xs">USDC balance {facts.tokenBalance == null ? 'UNVERIFIED' : formatUnits(facts.tokenBalance, 6)}. Native gas accounting uses 18 decimals for this same asset; the gas-unit read is {facts.nativeBalance == null ? 'UNVERIFIED' : formatUnits(facts.nativeBalance, 18)} USDC, not additional funds.</p>
      <p className="mt-1 text-xs">Latest/pending nonce {facts.latestNonce ?? 'UNVERIFIED'} / {facts.pendingNonce ?? 'UNVERIFIED'}</p>
      <p className="mt-1 text-xs">Local recovery: {recoveryStatus}</p>
      {journal && journal.terms.payer.toLowerCase() === address?.toLowerCase() && <p className="mono mt-1 break-all text-xs">Original hashes · deploy {journal.deploy?.hash ?? 'UNSET'} · approve {journal.approve?.hash ?? 'UNSET'} · execute {journal.execute?.hash ?? 'UNSET'}</p>}
      <button className="mt-2 text-xs underline" onClick={() => { setSubmissionReview(null); setRevision((value) => value + 1) }}>Refresh RPC review</button>
      {error && <p role="alert" className="mt-2 text-xs">RPC unavailable: {error}</p>}
    </section>
    <section className="mt-5 rounded-2xl p-5" style={{ background: 'var(--surface)' }}>
      <h2 className="font-semibold">3. Exact unsigned transaction review</h2>
      <div className="mt-3 flex flex-wrap gap-2">{steps.map((item) => <button key={item} className="rounded-xl border px-3 py-2 text-xs" aria-pressed={item === step} onClick={() => { setSubmissionReview(null); setStep(item) }}>{item}</button>)}</div>
      <p className="mono mt-3 break-all text-xs">To {review.to ?? 'contract creation'} · value {review.value.toString()} · data SHA-256 {review.dataSha256 ?? 'UNSET'}</p>
      <p className="mono mt-1 break-all text-xs">{step === 'deploy' ? `Frozen creation-bytecode SHA-256 ${GRANT_CREATION_SHA256}` : `Exact calldata ${review.data ?? 'UNSET'}`}</p>
      <p className="mt-2 text-xs">Live gas estimate {estimatedGas?.toString() ?? 'UNAVAILABLE'} · fee quote {facts.quotedMaxFeePerGas?.toString() ?? 'UNAVAILABLE'} wei/gas. Reviewed gas limit, max fee, aggregate spending and funding route: UNSET.</p>
      <p className="mt-1 text-xs">Current allowance {facts.allowance === undefined || facts.allowance === null ? 'UNVERIFIED' : formatUnits(facts.allowance, 6)} USDC · contract {reviewedContract ?? 'UNSET'}</p>
      {review.findings.map((finding) => <p key={finding} className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>BLOCKED · {finding}</p>)}
      <button className="mt-3 rounded-xl border px-3 py-2 text-xs disabled:opacity-40" disabled={MAINNET_GRANT_WRITES_HARD_DISABLED || review.findings.length > 0} onClick={prepareSubmissionReview}>Prepare exact {step} wallet review</button>
      {submissionReview && <div className="mt-3 rounded-xl border p-3 text-xs">
        <p className="mono break-all">Exact {step}: from {submissionReview.request.from} · to {submissionReview.request.to ?? 'contract creation'} · nonce {submissionReview.nonce} · calldata hash {review.dataSha256}</p>
        <p>Gas limit {submissionReview.request.gas.toString()} · max fee {submissionReview.request.maxFeePerGas.toString()} wei/gas · stage ceiling {formatUnits(submissionReview.request.gas * submissionReview.request.maxFeePerGas, 18)} USDC · aggregate ceiling {formatUnits(submissionReview.aggregateMaximum, 18)} USDC.</p>
        <button className="mt-3 rounded-xl border px-3 py-2 disabled:opacity-40" disabled={MAINNET_GRANT_WRITES_HARD_DISABLED || submitting || chainId !== MAINNET_GRANT_CHAIN_ID || address?.toLowerCase() !== submissionReview.terms.payer.toLowerCase() || step !== submissionReview.step} onClick={() => void authorizeSubmission()}>Authorize exact {step} in MetaMask</button>
      </div>}
    </section>
    <section className="mt-5 rounded-2xl p-5" style={{ background: 'var(--surface)' }}>
      <h2 className="font-semibold">Owner-controlled demo roles · not transaction authorization</h2>
      <p className="mt-2 text-xs">Payer wallet control: {address?.toLowerCase() === MAINNET_PROPOSED_ROLES.payer.toLowerCase() ? 'CONNECTED, NOT ATTESTED' : 'UNVERIFIED'} · both recipients: owner-reported demo accounts, not independently controlled or verified.</p>
      <p className="mt-1 text-xs">Exact owner-confirmed preparation terms: 0.10 + 0.20 USDC and the Mainnet demo ID above. Maximum aggregate expenditure: UNSET until all three gas ceilings and funding costs are reviewed.</p>
      <p className="mt-1 text-xs">This screen records no approval and requests no financial signature. The internal review requirement remains in force unless the owner explicitly accepts the limited self-review exception; every financial action still needs its own authorization.</p>
    </section>
    {queryContract && !publicCandidate &&
      <p className="mt-5 text-xs">URL-supplied contract is not verified against frozen Mainnet runtime and terms; no payment is confirmed.</p>}
    {publicCandidate && <p className="mt-5 text-xs">This URL identifies a contract whose live runtime and immutable terms match the frozen operator-funded proposal. It is not an approved Track0 royalty settlement or owner authorization.</p>}
    {publicCandidate
      ? <GrantSplitPublicEvidence client={client} network={ARC_NETWORKS.mainnet} terms={publicCandidate.terms} codeHash={publicCandidate.codeHash} expectedCodeHash={publicCandidate.codeHash} submittedHash={null} />
      : reviewedContract && reviewedRuntimeHash && terms
      ? <GrantSplitPublicEvidence client={client} network={ARC_NETWORKS.mainnet} terms={terms} codeHash={runtimeHash} expectedCodeHash={reviewedRuntimeHash} submittedHash={null} />
      : <section className="mt-6 rounded-2xl p-5" style={{ background: 'var(--surface)' }}>
        <h2 className="font-semibold">Mainnet evidence · UNCONFIRMED</h2>
        <p className="mt-2 text-xs">No reviewed Mainnet contract and runtime identity exists. A URL, wallet, or cached screenshot cannot establish a payment.</p>
      </section>}
    <p className="mt-6 text-xs">UNKNOWN outcomes require reconciliation of the original hash and nonce. This build has no Mainnet transaction submission path.</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><WagmiProvider config={config}><QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider></WagmiProvider></StrictMode>)
