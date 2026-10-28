/** Public review builds deliberately contain no transaction-sending implementation. */
export function submitReviewedMainnetStep(): Promise<never> {
  return Promise.reject(new Error('Mainnet wallet submission is excluded from this build'))
}
