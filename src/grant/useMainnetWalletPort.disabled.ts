import type { MainnetWalletPort } from './mainnetSender'

/** Public review builds cannot obtain a financial-signing wallet client. */
export function useMainnetWalletPort(_providerId: string | undefined): MainnetWalletPort | null { return null }
