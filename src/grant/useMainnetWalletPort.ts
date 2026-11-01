import { useWalletClient } from 'wagmi'
import { arc } from 'viem/chains'
import { MAINNET_GRANT_CHAIN_ID } from './grantMainnetCandidate'
import type { MainnetWalletPort } from './mainnetSender'
import { assertMainnetWalletRequest } from './mainnetWalletWorkflow'

/** Candidate adapter; never bundled into the current public review build. */
export function useMainnetWalletPort(providerId: string | undefined): MainnetWalletPort | null {
  const { data: walletClient } = useWalletClient({ chainId: MAINNET_GRANT_CHAIN_ID })
  if (!walletClient || providerId !== 'io.metamask') return null
  return { providerId, getAddresses: () => walletClient.getAddresses(), getChainId: () => walletClient.getChainId(),
    sendTransaction: (request) => {
      assertMainnetWalletRequest(request)
      return walletClient.sendTransaction({ ...request, account: request.from, chain: arc })
    } }
}
