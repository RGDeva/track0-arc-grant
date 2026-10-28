# Track0 Arc grant — Mainnet candidate (disabled)

This grant-only source export demonstrates an operator-funded, single-use USDC
split design for Arc. It is **not** a production royalty payout. The existing
public [Testnet evidence viewer](https://track0-arc-grant-viewer.vercel.app/)
shows a separate completed Testnet demonstration. No Arc Mainnet contract or
payment has been deployed from this candidate.

The proposed Mainnet terms are 0.10 USDC and 0.20 USDC to two owner-controlled
demonstration accounts. Both Mainnet wallet-write gates remain hard-disabled.
The owner self-review exception, financial limits and each transaction require
separate approval. This repository export has not been published or deployed.

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

The production lockfile audit still has disclosed advisories. The inspected
Mainnet wallet bundle excludes those packages, but that is not a clean
dependency audit or an independent security review.

## Publication boundary

`vercel.json` is an offline configuration candidate. It disables automatic Git
deployments and points at the still-disabled static build. It does not confer
authorization to publish this repository, create a Vercel project, fund a
wallet, activate writes, or transact. Never add private keys or wallet
recovery phrases to this repository or Vercel configuration.
