'use client'

import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, base } from 'wagmi/chains'
import { http } from 'wagmi'

export const config = getDefaultConfig({
  appName: 'ens-intent-bus',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'placeholder',
  chains: [base, mainnet],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? 'https://eth.llamarpc.com'),
  },
  ssr: true,
})
