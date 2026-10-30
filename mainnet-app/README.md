# Track0 Arc Mainnet grant app candidate

This unpublished, grant-only app is separate from the [live read-only Testnet viewer](https://track0-arc-grant-viewer.vercel.app/). It displays the owner-controlled 0.10/0.20 USDC proposal, read-only Arc RPC facts and fail-closed transaction evidence. It does not claim a Mainnet payout or a customer royalty settlement.

The `build:mainnet-review` variant substitutes disabled stubs for the sender and wallet adapter. The `build:mainnet-release-candidate` variant contains the grant-only sender for the pinned payer. Track0's global financial-write gate remains hard-disabled. The owner accepted three unresolved dependency risks for this exact demonstration, but this is not an independent audit. Publication, funding, contract deployment, exact-value USDC approval, and execution each require separate authorization.

The `?tx=<hash>&contract=<address>` evidence view requires no wallet or browser journal. URL parameters are locators, never authoritative proof: the page checks runtime code, immutable terms, receipt and transfer events against Arc Mainnet RPC. No Mainnet contract address is yet approved or deployed.

This sanitized export excludes private review documents, Studio metadata, wallet journals, credentials, customer data and the original Track0 financial system. No public repository, Vercel deployment or grant submission has been authorized.
