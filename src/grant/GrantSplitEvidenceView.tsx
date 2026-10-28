import { useEffect, useState } from 'react'
import type { Hex, PublicClient } from 'viem'
import type { ArcNetwork } from '@/lib/arcNetwork'
import type { GrantSplitTerms } from './grantSplitProtocol'
import { evidenceClientIdentity, grantEvidenceReader, grantEvidenceUrl, parseGrantTransactionHash, readGrantPublicEvidence, visibleGrantEvidence, type PublicEvidenceResult } from './grantSplitPublicEvidence'

export function GrantSplitPublicEvidence({ client, network, terms, codeHash, expectedCodeHash, submittedHash }: {
  client: PublicClient | undefined
  network: ArcNetwork | null
  terms: GrantSplitTerms | null
  codeHash: Hex | null
  expectedCodeHash: Hex | null
  submittedHash: Hex | null
}) {
  const rawQueryHash = new URLSearchParams(window.location.search).get('tx')
  const queryHash = parseGrantTransactionHash(rawQueryHash)
  const hash = rawQueryHash === null ? submittedHash : queryHash
  const [state, setState] = useState<{ key: string; result: PublicEvidenceResult } | null>(null)
  const [revision, setRevision] = useState(0)
  const key = [hash, evidenceClientIdentity(client), codeHash, expectedCodeHash, network?.chainId, terms?.contract, terms?.token, terms?.payer,
    terms?.recipientA, terms?.recipientB, terms?.amountA, terms?.amountB, terms?.demoId, revision].join(':')
  const result = visibleGrantEvidence(state, key)

  useEffect(() => {
    if (!hash) return
    const interval = window.setInterval(() => setRevision((value) => value + 1), 20_000)
    const onVisible = () => { if (document.visibilityState === 'visible') setRevision((value) => value + 1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [hash])

  useEffect(() => {
    if (!hash || !client || !network || !terms) return
    let active = true
    void (async () => {
      try {
        const result = await readGrantPublicEvidence(grantEvidenceReader(client),
          { terms, hash, expectedChainId: network.chainId, expectedToken: network.usdc, codeHash, expectedCodeHash })
        if (active) setState({ key, result })
      } catch {
        if (active) setState({ key, result: { status: 'unavailable', findings: ['RPC evidence is unavailable; do not infer success or retry payment'], checkedAt: Date.now() } })
      }
    })()
    return () => { active = false }
  }, [client, network, terms, codeHash, expectedCodeHash, hash, key])

  if (!hash) return <section className="mt-6 rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
    <h2 className="font-semibold">Public transaction evidence</h2>
    <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>{rawQueryHash ? 'Invalid transaction hash; no payment is confirmed.' : 'No transaction has been supplied. A verified payment will appear here only after an actual Arc transaction is checked against Arc RPC.'}</p>
  </section>

  const permalink = terms ? grantEvidenceUrl(window.location.origin, window.location.pathname, hash, terms.contract) : null
  return <section className="mt-6 rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} aria-live="polite">
    <h2 className="font-semibold">Public transaction evidence</h2>
    <p className="mono mt-2 break-all text-xs">Transaction: {hash}</p>
    <p className="mt-2 text-sm font-semibold">Status: {result?.status === 'confirmed' ? 'CONFIRMED' : result?.status?.toUpperCase() ?? 'CHECKING RPC EVIDENCE'}</p>
    <p className="mt-1 text-xs">Network checked: {network?.name ?? 'UNVERIFIED'} · RPC chain {result?.rpcChainId ?? 'UNVERIFIED'}</p>
    {result && <p className="mt-1 text-xs">Last check: {new Date(result.checkedAt).toLocaleString()}</p>}
    {result?.verifiedAt !== undefined && <p className="mt-1 text-xs">Last successful verification: {new Date(result.verifiedAt).toLocaleString()}</p>}
    {result?.blockNumber !== undefined && <p className="mt-1 text-xs">Block: {result.blockNumber.toString()}</p>}
    {result?.findings.map((finding) => <p className="mt-1 text-xs" key={finding} style={{ color: 'var(--danger)' }}>{finding}</p>)}
    <div className="mt-3 flex flex-wrap gap-4 text-xs underline">
      {permalink && <a href={permalink}>Permanent verification link</a>}
      {network && <a href={`${network.explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer">View on Arc explorer</a>}
      <button onClick={() => setRevision((value) => value + 1)}>Recheck RPC evidence</button>
    </div>
  </section>
}
