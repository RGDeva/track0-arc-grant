# Track0 Arc grant — Mainnet publication candidate

This grant-only source export demonstrates an operator-funded, single-use USDC
split design for Arc. It is **not** a production royalty payout. The existing
public [Testnet evidence viewer](https://track0-arc-grant-viewer.vercel.app/)
shows a separate completed Testnet demonstration. No Arc Mainnet contract or
payment has been deployed from this candidate.

The proposed Mainnet terms are 0.10 USDC and 0.20 USDC to two owner-controlled
demonstration accounts. Track0's global financial-write gate remains hard-disabled.
This grant-only candidate includes a separate sender restricted to the pinned
payer and reviewed terms, but has not been published, deployed, connected to a
signing wallet, or used for a Mainnet transaction. Publication, funding and each
transaction require separate authorization.

## Reproduce locally

Use the versions pinned in `bun.lock` and the Solidity compiler configured in
`foundry.toml`. From this directory:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bunx oxlint --type-aware src mainnet-app
bun run build:mainnet-release-candidate
bun run audit:mainnet-release-candidate
forge test --match-path contracts/test/GrantSplitDemo.t.sol
```

The production lockfile still has three disclosed advisories: Zod
GHSA-mrhx-c7xc-m3w5, UUID GHSA-w5hq-g745-h8pq, and decode-uri-component
GHSA-vcc3-ghjq-m6fr. The inspected Mainnet wallet bundle excludes their
vulnerable code paths, but that is not a clean dependency audit or an
independent security review. The owner accepted the risk for this exact demo;
the private decision record is intentionally excluded from this export.

## Publication boundary

`vercel.json` disables automatic Git deployments. Decision C proposes publishing
only the locally verified static artifact, not rebuilding source remotely. It does not confer
authorization to publish this repository, create a Vercel project, fund a
wallet, use the grant-specific sender, or transact. Never add private keys or wallet
recovery phrases to this repository or Vercel configuration.
