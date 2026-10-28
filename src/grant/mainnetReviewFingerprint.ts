import { sha256, type Hex } from 'viem'
import type { MainnetSubmissionReview } from './mainnetSender'

/** Every owner-reviewed transaction fact is sealed before the wallet can be invoked. */
export function mainnetReviewFingerprint(review: Omit<MainnetSubmissionReview, 'fingerprint'>): Hex {
  return sha256(new TextEncoder().encode(JSON.stringify(review,
    (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)))
}
