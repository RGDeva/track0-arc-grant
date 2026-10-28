/**
 * writeGates — source-level write-disable constants.
 *
 * Extracted from App.tsx so that:
 *   1. App.tsx only exports a default component — Vite Fast Refresh can
 *      hot-reload it without invalidating the full module tree.
 *   2. The integration test imports from this stable path, not from App.tsx.
 *
 * WRITES_HARD_DISABLED must remain `true as const` until all four blockers
 * listed in App.tsx are resolved through a deliberate code-review commit.
 * No env var can override it; its TypeScript type is the literal `true`.
 */

/** Source-level write-disable flag. Type is `true` (literal), not `boolean`. */
export const WRITES_HARD_DISABLED = true as const
