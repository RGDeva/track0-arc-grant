# Track0 × Arc — operator-funded USDC split demo

Track0's [public Arc Mainnet app](https://track0-arc-mainnet-grant.vercel.app/) is a grant-only demonstration of an operator-funded, single-use USDC split. It is **not** a production royalty payout. The separate [Testnet evidence viewer](https://track0-arc-grant-viewer.vercel.app/) documents a completed Testnet demonstration. No Mainnet contract deployment or payment is verified as of November 1, 2026; the Mainnet evidence view must remain unconfirmed until receipts and token events pass live RPC verification.

The proposed Mainnet terms are 0.10 USDC and 0.20 USDC to two owner-controlled
demonstration accounts. Track0's global financial-write gate remains hard-disabled.
The isolated Mainnet app includes a grant-specific sender restricted to chain 5042, the pinned payer, fixed recipients, exact 100,000/200,000 base-unit amounts, and one-use contract execution. The original Track0 global financial-write gate remains hard-disabled. Funding, contract deployment, exact-value approval, and execution each require separate authorization and an owner-confirmed wallet action. The public site being live does not authorize any transaction.

## Built with Arc Studio

The [Arc Studio project](https://studio.arc.io/app/ed1adc73-a213-458d-af8a-42816e97f4f2) contains the original app and reviewed `GrantSplitDemo` contract. The constructor fixes payer, two distinct recipients, amounts, chain ID, and demo ID. The payer alone may call the argument-free `execute()` once; the contract pulls exactly 0.30 USDC and emits split evidence. A fresh browser can inspect a verified payment using `?tx=<hash>&contract=<address>` without connecting a wallet. URL parameters are locators, never proof; receipt, runtime code, contract terms, and USDC transfer logs must match RPC data.

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

`vercel.json` disables automatic Git deployments. The public Vercel app was published from a reviewed static build, separately from this public source repository. Do not place private keys, recovery phrases, wallet journals, or internal Track0 data in this repository or Vercel configuration.
