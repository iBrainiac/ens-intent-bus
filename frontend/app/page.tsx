'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useEnsName, useEnsAvatar } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import Image from 'next/image'
import { AgentPanel } from '@/components/AgentPanel'
import { IntentFlow } from '@/components/IntentFlow'
import { IntentDashboard } from '@/components/IntentDashboard'

function Header() {
  return (
    <header className="border-b border-border px-6 py-4 flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-2xl italic text-gold tracking-tight">ens-intent-bus</span>
        <span className="text-ink-faint text-xs font-mono hidden sm:block">
          intent-based swaps · ens identity · uniswap
        </span>
      </div>
      <ConnectButton
        showBalance={false}
        chainStatus="icon"
        accountStatus="address"
      />
    </header>
  )
}

function EnsGate({ address }: { address: `0x${string}` }) {
  const { data: ensName, isLoading } = useEnsName({ address, chainId: mainnet.id })
  const { data: avatar } = useEnsAvatar({ name: ensName ?? undefined, chainId: mainnet.id })

  if (isLoading) {
    return (
      <div className="text-center py-16 text-ink-muted font-mono text-xs animate-pulse-soft">
        resolving ENS identity...
      </div>
    )
  }

  if (!ensName) {
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-fade-up">
        <div className="border border-gold-dim bg-gold-faint px-5 py-5 space-y-3">
          <p className="text-gold font-mono text-xs tracking-widest uppercase font-bold">ENS Name Required</p>
          <p className="text-ink-muted text-xs font-mono leading-relaxed">
            ens-intent-bus uses your ENS name as the authorization key. The agent verifies your identity
            by checking your ENS text record before executing any swap on your behalf.
          </p>
          <p className="text-ink-muted text-xs font-mono leading-relaxed">
            Your connected wallet{' '}
            <span className="text-gold font-mono">{address.slice(0, 8)}...{address.slice(-6)}</span>{' '}
            has no primary ENS name set.
          </p>
        </div>
        <a
          href="https://app.ens.domains"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-gold w-full flex items-center justify-center gap-2 text-center"
        >
          GET AN ENS NAME ↗
        </a>
        <p className="text-ink-faint text-xs text-center font-mono">
          After registering, set it as your primary ENS name and reconnect.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* User identity bar */}
      <div className="border border-border bg-card px-5 py-4 flex items-center gap-4">
        <div className="w-10 h-10 border border-border-strong overflow-hidden relative bg-elevated shrink-0">
          {avatar ? (
            <Image src={avatar} alt={ensName} fill className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-muted">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-ink font-mono text-sm font-bold truncate">{ensName}</p>
          <p className="text-ink-muted text-xs font-mono">{address.slice(0, 10)}...{address.slice(-8)}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse-soft" />
          <span className="text-teal text-xs font-mono label">verified</span>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid lg:grid-cols-[1fr_1fr] gap-6 items-start">
        <IntentFlow ensName={ensName} />
        <IntentDashboard />
      </div>
    </div>
  )
}

function ConnectPrompt() {
  return (
    <div className="max-w-md mx-auto text-center space-y-6 py-16 animate-fade-up">
      <div className="space-y-2">
        <p className="font-display text-4xl italic text-ink">Trade by intent.</p>
        <p className="font-display text-4xl italic text-gold">Authorized by name.</p>
      </div>
      <p className="text-ink-muted text-xs font-mono leading-relaxed max-w-sm mx-auto">
        Publish a swap intent via your ENS name. An AI agent verifies your identity and
        executes the best route via Uniswap — no approval of UI required.
      </p>
      <div className="flex justify-center">
        <ConnectButton label="CONNECT WALLET" />
      </div>
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
        {[
          { label: 'identity', desc: 'ENS text record' },
          { label: 'execution', desc: 'Uniswap Trading API' },
          { label: 'settlement', desc: 'Base Mainnet' },
        ].map(item => (
          <div key={item.label} className="space-y-1">
            <p className="label">{item.label}</p>
            <p className="text-ink-muted text-xs font-mono">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Page() {
  const { address, isConnected } = useAccount()

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 px-4 sm:px-6 py-8 max-w-6xl mx-auto w-full space-y-6">
        <AgentPanel />

        {!isConnected && <ConnectPrompt />}
        {isConnected && address && <EnsGate address={address} />}
      </main>

      <footer className="border-t border-border px-6 py-4 flex justify-end items-center">
        <div className="flex gap-4">
          <a
            href={`https://base.blockscout.com/address/0x2a7f100C6955a92785b886d2c33aa1F4C8339de2`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-faint text-xs font-mono hover:text-gold transition-colors"
          >
            contract ↗
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-faint text-xs font-mono hover:text-gold transition-colors"
          >
            github ↗
          </a>
        </div>
      </footer>
    </div>
  )
}
